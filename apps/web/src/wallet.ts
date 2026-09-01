const X_LAYER_ID = 196;
const X_LAYER_HEX = "0xc4"; // 196
const WALLET_DISCONNECTED_KEY = "pulse.wallet.disconnected";

async function waitForWalletSignature<T>(operation: Promise<T>): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("The wallet did not return the x402 signature within 120 seconds. No report job was created; reopen the wallet and retry.")), 120_000);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void> | void;
  chainId?: string;
  selectedAddress?: string | null;
  isOkxWallet?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: InjectedProvider[];
};

export type WalletConnectionMethod = "auto" | "okx" | "other";

type Eip6963ProviderDetail = {
  info?: { name?: string; rdns?: string };
  provider?: InjectedProvider;
};

type WalletWindow = Window & {
  ethereum?: InjectedProvider;
  okxwallet?: InjectedProvider;
  __pulseCircleProvider?: InjectedProvider;
  __pulseAppKitProvider?: InjectedProvider;
  __pulseDirectProvider?: InjectedProvider;
};

const announcedProviders: Eip6963ProviderDetail[] = [];

function isProvider(value: unknown): value is InjectedProvider {
  return Boolean(value && typeof (value as InjectedProvider).request === "function");
}

function isOkxDetail(detail: Eip6963ProviderDetail): boolean {
  const identity = `${detail.info?.name || ""} ${detail.info?.rdns || ""}`.toLowerCase();
  return Boolean(detail.provider?.isOkxWallet || /\bokx\b|okex/.test(identity));
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", ((event: CustomEvent<Eip6963ProviderDetail>) => {
    const detail = event.detail;
    if (!isProvider(detail?.provider)) return;
    if (!announcedProviders.some((item) => item.provider === detail.provider)) announcedProviders.push(detail);
  }) as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

type PaymentRequirementLike = { scheme?: unknown; network?: unknown; asset?: unknown; amount?: unknown; payTo?: unknown };
type PaymentRequiredLike = { x402Version?: unknown; resource?: unknown; accepts?: PaymentRequirementLike[] };

const EXPECTED_ROUTE_AMOUNTS: Readonly<Record<string, string>> = Object.freeze({
  "/v1/analysis/base": "200000", "/v1/analysis/premium": "300000",
  "/v1/analysis/spot/standard": "200000", "/v1/analysis/spot/premium": "300000",
  "/v1/analysis/prediction/standard": "200000", "/v1/analysis/prediction/premium": "300000",
  "/v1/analysis/fused/standard": "250000", "/v1/analysis/fused/premium": "400000",
  "/v1/analysis/divergence": "200000", "/v1/preflight/event-risk": "300000",
  "/v1/token/scan": "200000", "/v1/wallet/scan": "110000", "/v1/market/pulse": "110000",
  "/v1/swap/quote": "120000", "/v1/preflight": "200000",
  "/v1/autopilot/pass/24h": "1500000", "/v1/autopilot/pass/7d": "10500000", "/v1/autopilot/pass/30d": "45000000",
});

function canonicalPaidPath(input: RequestInfo | URL): string {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
  const pathname = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, base).pathname;
  return pathname.replace(/^\/(xlayer|base|arbitrum|arc)(?=\/)/, "");
}

export function validatePaymentChallenge(required: PaymentRequiredLike, input: RequestInfo | URL, selected: import("./networks").WebNetworkKey, network: { caip2: string; label: string; payment: { address: string } }, approvedAmount?: string) {
  if (Number(required.x402Version) !== 2 || !Array.isArray(required.accepts)) throw new Error("Unsupported or malformed x402 challenge");
  const expectedPath = canonicalPaidPath(input);
  const expectedAmount = approvedAmount || EXPECTED_ROUTE_AMOUNTS[expectedPath];
  if (!expectedAmount) throw new Error(`PULSE has no approved browser price for ${expectedPath}`);
  const browserEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env || {};
  const expectedPayee = selected === "arc-testnet" ? String(browserEnv.VITE_CIRCLE_GATEWAY_SELLER_ADDRESS || "") : String(browserEnv.VITE_PAY_TO_ADDRESS || "");
  if (browserEnv.PROD === true && !expectedPayee) throw new Error("Production payment recipient is not configured in the web deployment");
  const acceptable = required.accepts.some((entry) =>
    entry.scheme === "exact" && entry.network === network.caip2
    && String(entry.asset || "").toLowerCase() === network.payment.address.toLowerCase()
    && String(entry.amount || "") === expectedAmount
    && (!expectedPayee || String(entry.payTo || "").toLowerCase() === expectedPayee.toLowerCase()));
  if (!acceptable) throw new Error(`Payment challenge does not match approved ${network.label} asset, price, network, or recipient`);
  const resource = typeof required.resource === "string" ? required.resource : (required.resource as { url?: unknown } | null)?.url;
  if (resource && canonicalPaidPath(String(resource)) !== expectedPath) throw new Error("Payment challenge resource does not match the requested service");
}

const publishedPrices = new Map<string, Promise<Record<string, string>>>();
async function publishedAmount(input: RequestInfo | URL): Promise<string> {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
  const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, base);
  const origin = requestUrl.origin;
  if (!publishedPrices.has(origin)) publishedPrices.set(origin, fetch(`${origin}/v1/meta`, { headers: { Accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error(`Could not verify published PULSE prices (${response.status})`);
    const body = await response.json() as { routes?: Array<{ route?: string; priceUsd?: number }> };
    return Object.fromEntries((body.routes || []).filter((route) => route.route?.startsWith("POST ") && Number.isFinite(route.priceUsd)).map((route) => [route.route!.slice(5), String(Math.round(Number(route.priceUsd) * 1_000_000))]));
  }));
  const prices = await publishedPrices.get(origin)!;
  const amount = prices[canonicalPaidPath(input)];
  if (!amount) throw new Error(`The requested service has no published PULSE price`);
  return amount;
}

declare global {
  interface Window {
    okxwallet?: InjectedProvider;
  }
}

export const xLayer = {
  id: X_LAYER_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
} as const;

/** Resolve OKX even when another extension owns window.ethereum. */
export function findOkxProvider(scope?: { okxwallet?: InjectedProvider; ethereum?: InjectedProvider }, eip6963: readonly Eip6963ProviderDetail[] = announcedProviders): InjectedProvider | null {
  const host = scope || (typeof window === "undefined" ? undefined : window as WalletWindow);
  if (!host) return null;
  if (isProvider(host.okxwallet)) return host.okxwallet;
  if (isProvider(host.ethereum) && host.ethereum.isOkxWallet) return host.ethereum;
  const multiplexed = host.ethereum?.providers?.find((provider) => isProvider(provider) && provider.isOkxWallet);
  if (multiplexed) return multiplexed;
  return eip6963.find(isOkxDetail)?.provider || null;
}

async function discoverOkxProvider(): Promise<InjectedProvider | null> {
  const immediate = findOkxProvider();
  if (immediate || typeof window === "undefined") return immediate;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 100));
  return findOkxProvider();
}

export function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const target = window as WalletWindow;
  const circleProvider = target.__pulseCircleProvider;
  if (circleProvider) return circleProvider;
  if (target.__pulseDirectProvider) return target.__pulseDirectProvider;
  const appKitProvider = target.__pulseAppKitProvider;
  if (appKitProvider) return appKitProvider;
  const okxProvider = findOkxProvider(target);
  if (okxProvider) return okxProvider;
  if (isProvider(target.ethereum)) return target.ethereum;
  return null;
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function walletProviderName(provider: InjectedProvider): string {
  return provider.isOkxWallet
    ? "OKX Wallet"
    : provider.isRabby
      ? "Rabby"
      : provider.isCoinbaseWallet
        ? "Base Account / Coinbase Wallet"
    : provider.isMetaMask
      ? "MetaMask"
      : "Browser wallet";
}

export function wasWalletDisconnected(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WALLET_DISCONNECTED_KEY) === "1";
}

export function clearWalletDisconnected(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(WALLET_DISCONNECTED_KEY);
}

/**
 * EIP-1193 has no universal disconnect method. Persist the user's app-level
 * choice and also revoke account permissions when the wallet supports it.
 */
export async function disconnectWallet(): Promise<void> {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(WALLET_DISCONNECTED_KEY, "1");
  }
  const provider = getInjectedProvider();
  const { appKitEnabled, disconnectAppKit } = await import("./appkit");
  if (appKitEnabled) await disconnectAppKit();

  if (provider) {
    try {
      await provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Not every injected wallet implements EIP-2255 permission revocation.
    }

    try {
      await provider.disconnect?.();
    } catch {
      // App-level disconnect above remains authoritative.
    }
  }
  const target = window as WalletWindow;
  delete target.__pulseCircleProvider;
  delete target.__pulseDirectProvider;
  delete target.__pulseAppKitProvider;
}

async function connectInjectedProvider(provider: InjectedProvider, networkKey: import("./networks").WebNetworkKey): Promise<{ address: string; providerName: string }> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account");
  const { switchWalletNetwork } = await import("./networks");
  await switchWalletNetwork(provider, networkKey);
  (window as WalletWindow).__pulseDirectProvider = provider;
  return { address, providerName: walletProviderName(provider) };
}

export async function connectWallet(networkKey: import("./networks").WebNetworkKey = "xlayer", method: WalletConnectionMethod = "auto"): Promise<{ address: string; providerName: string }> {
  const appkit = await import("./appkit");
  const okxProvider = method === "other" ? null : await discoverOkxProvider();
  if (okxProvider) return connectInjectedProvider(okxProvider, networkKey);
  if (method === "okx") {
    throw new Error("OKX Wallet was not detected. Install or enable the OKX Wallet extension, or open PULSE in the OKX Wallet DApp browser, then retry.");
  }
  if (appkit.appKitEnabled) {
    delete (window as WalletWindow).__pulseDirectProvider;
    const connected = await appkit.connectAppKit();
    const provider = appkit.getAppKitProvider();
    if (provider) (window as WalletWindow).__pulseAppKitProvider = provider;
    await selectWalletNetwork(networkKey);
    return connected;
  }
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      "No wallet found. Install OKX Wallet (recommended) or MetaMask, then refresh.",
    );
  }

  return connectInjectedProvider(provider, networkKey);
}

export async function selectWalletNetwork(key: import("./networks").WebNetworkKey): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("Wallet not connected");
  const { switchWalletNetwork } = await import("./networks");
  await switchWalletNetwork(provider, key);
}

/**
 * Browser x402 pay: user signs EIP-3009 auth with their wallet; no server private key.
 */
export async function createWalletPaidFetch(userAddress: string, networkKey: import("./networks").WebNetworkKey = "xlayer"): Promise<typeof fetch> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("Wallet not connected");

  const [{ createWalletClient, custom }, { WEB_NETWORKS }] =
    await Promise.all([
      import("viem"),
      import("./networks"),
    ]);

  await selectWalletNetwork(networkKey);
  const selected = WEB_NETWORKS[networkKey];

  const account = userAddress as `0x${string}`;
  const walletClient = createWalletClient({
    account,
    chain: networkKey === "xlayer" ? xLayer : { id: selected.chainId, name: selected.label, nativeCurrency: selected.native, rpcUrls: { default: { http: [selected.rpc] } } },
    transport: custom(provider as never),
  });

  const signer = {
    address: account,
    async signTypedData(params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) {
      return waitForWalletSignature((walletClient as unknown as {
        signTypedData: (a: unknown) => Promise<`0x${string}`>;
      }).signTypedData({
        account,
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
      }));
    },
  };

  if (networkKey !== "xlayer") {
    const [{ x402Client }, { x402HTTPClient }, { ExactEvmScheme: StandardExact }, circle] = await Promise.all([
      import("@x402/core/client"), import("@x402/core/http"), import("@x402/evm/exact/client"), import("@circle-fin/x402-batching/client"),
    ]);
    const exact = new StandardExact(signer);
    const scheme = networkKey === "arc-testnet" ? new circle.CompositeEvmScheme(new circle.BatchEvmScheme(signer), exact) : exact;
    // Circle's SDK intentionally exposes a minimal compatible client type;
    // runtime protocol shape is the same x402 v2 SchemeNetworkClient contract.
    const core = new x402Client().register(selected.caip2, scheme as never);
    const http = new x402HTTPClient(core);
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const first = await fetch(input, init);
      if (first.status !== 402) return first;
      const body = await first.clone().json().catch(() => ({}));
      const required = http.getPaymentRequiredResponse((name) => first.headers.get(name), body);
      validatePaymentChallenge(required as PaymentRequiredLike, input, networkKey, selected, await publishedAmount(input));
      const payload = await http.createPaymentPayload(required);
      const headers = new Headers(init?.headers);
      Object.entries(http.encodePaymentSignatureHeader(payload)).forEach(([name, value]) => headers.set(name, value));
      return fetch(input, { ...init, headers });
    }) as typeof fetch;
  }

  const [{ wrapFetchWithPaymentFromConfig }, { ExactEvmScheme }] = await Promise.all([
    import("@okxweb3/x402-fetch"), import("@okxweb3/x402-evm"),
  ]);
  const paidFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: selected.caip2, client: new ExactEvmScheme(signer) }] }) as typeof fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const first = await fetch(input, init);
    if (first.status !== 402) return first;
    const header = first.headers.get("PAYMENT-REQUIRED");
    const body = await first.clone().json().catch(() => ({}));
    let required: PaymentRequiredLike = body as PaymentRequiredLike;
    if (header) {
      try { required = JSON.parse(atob(header.replace(/-/g, "+").replace(/_/g, "/"))) as PaymentRequiredLike; }
      catch { throw new Error("Malformed PAYMENT-REQUIRED header"); }
    }
    validatePaymentChallenge(required, input, networkKey, selected, await publishedAmount(input));
    return paidFetch(input, init);
  }) as typeof fetch;
}
