const X_LAYER_ID = 196;
const X_LAYER_HEX = "0xc4"; // 196
const WALLET_DISCONNECTED_KEY = "pulse.wallet.disconnected";

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
};

type PaymentRequirementLike = { scheme?: unknown; network?: unknown; asset?: unknown; amount?: unknown; payTo?: unknown };
type PaymentRequiredLike = { x402Version?: unknown; resource?: unknown; accepts?: PaymentRequirementLike[] };

const EXPECTED_ROUTE_AMOUNTS: Readonly<Record<string, string>> = Object.freeze({
  "/v1/analysis/base": "30000", "/v1/analysis/premium": "60000",
  "/v1/analysis/spot/standard": "30000", "/v1/analysis/spot/premium": "60000",
  "/v1/analysis/prediction/standard": "30000", "/v1/analysis/prediction/premium": "60000",
  "/v1/analysis/fused/standard": "50000", "/v1/analysis/fused/premium": "100000",
  "/v1/analysis/divergence": "40000", "/v1/preflight/event-risk": "70000",
  "/v1/token/scan": "10000", "/v1/wallet/scan": "10000", "/v1/market/pulse": "10000",
  "/v1/swap/quote": "20000", "/v1/preflight": "50000",
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

export function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const circleProvider = (window as Window & { __pulseCircleProvider?: InjectedProvider }).__pulseCircleProvider;
  if (circleProvider) return circleProvider;
  const appKitProvider = (window as Window & { __pulseAppKitProvider?: InjectedProvider }).__pulseAppKitProvider;
  if (appKitProvider) return appKitProvider;
  // Prefer OKX Wallet when available
  if (window.okxwallet) return window.okxwallet;
  if (window.ethereum) return window.ethereum as unknown as InjectedProvider;
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
  const { appKitEnabled, disconnectAppKit } = await import("./appkit");
  if (appKitEnabled) await disconnectAppKit();
  const provider = getInjectedProvider();
  if (!provider) return;

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
  delete (window as Window & { __pulseCircleProvider?: InjectedProvider }).__pulseCircleProvider;
}

export async function connectWallet(networkKey: import("./networks").WebNetworkKey = "xlayer"): Promise<{ address: string; providerName: string }> {
  const appkit = await import("./appkit");
  if (appkit.appKitEnabled) {
    const connected = await appkit.connectAppKit();
    const provider = appkit.getAppKitProvider();
    if (provider) (window as Window & { __pulseAppKitProvider?: InjectedProvider }).__pulseAppKitProvider = provider;
    await selectWalletNetwork(networkKey);
    return connected;
  }
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      "No wallet found. Install OKX Wallet (recommended) or MetaMask, then refresh.",
    );
  }

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account");

  // Preserve the existing X Layer fallback, while allowing an explicit V5 network.
  if (networkKey !== "xlayer") {
    const { switchWalletNetwork } = await import("./networks");
    await switchWalletNetwork(provider, networkKey);
    return { address, providerName: walletProviderName(provider) };
  }
  // Switch / add X Layer (eip155:196)
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: X_LAYER_HEX }],
    });
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code;
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: X_LAYER_HEX,
            chainName: "X Layer",
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            rpcUrls: ["https://rpc.xlayer.tech"],
            blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer"],
          },
        ],
      });
    } else {
      // Surface rejection and provider failures; never continue toward signing on the wrong chain.
      throw e;
    }
  }

  const providerName = walletProviderName(provider);

  return { address, providerName };
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
      return (walletClient as unknown as {
        signTypedData: (a: unknown) => Promise<`0x${string}`>;
      }).signTypedData({
        account,
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
      });
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
