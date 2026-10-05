import { createBalanceReader } from "./balanceReader";
const readBalance = createBalanceReader();

export const WEB_NETWORKS = {
  robinhood: { key: "robinhood", route: "robinhood", label: "Robinhood Chain", chainId: 4663, chainHex: "0x1237", caip2: "eip155:4663", rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", native: { name: "Ether", symbol: "ETH", decimals: 18 }, payment: { symbol: "USDG", decimals: 6, address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" }, provider: "PULSE x402", fundingUrl: "https://web3.okx.com/dex-swap", fundingLabel: "Fund USDG on Robinhood", fundingNote: "Use Robinhood USDG and keep ETH for swaps and contract transactions." },
  xlayer: { key: "xlayer", route: "xlayer", label: "X Layer", chainId: 196, chainHex: "0xc4", caip2: "eip155:196", rpc: "https://rpc.xlayer.tech", explorer: "https://www.okx.com/web3/explorer/xlayer", native: { name: "OKB", symbol: "OKB", decimals: 18 }, payment: { symbol: "USDT0", decimals: 6, address: "0x779ded0c9e1022225f8e0630b35a9b54be713736" }, provider: "OKX x402", fundingUrl: "https://web3.okx.com/dex-swap", fundingLabel: "Swap OKB to USDT0", fundingNote: "Use native USDT0 and keep a small OKB balance for network gas." },
  base: { key: "base", route: "base", label: "Base", chainId: 8453, chainHex: "0x2105", caip2: "eip155:8453", rpc: "https://mainnet.base.org", explorer: "https://basescan.org", native: { name: "Ether", symbol: "ETH", decimals: 18 }, payment: { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, provider: "CDP x402", fundingUrl: "https://bridge.base.org/deposit", fundingLabel: "Bridge or fund USDC", fundingNote: "Use native Base USDC; bridged USDbC is not the payment asset." },
  arbitrum: { key: "arbitrum", route: "arbitrum", label: "Arbitrum One", chainId: 42161, chainHex: "0xa4b1", caip2: "eip155:42161", rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", native: { name: "Ether", symbol: "ETH", decimals: 18 }, payment: { symbol: "USDC", decimals: 6, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" }, provider: "CDP x402", fundingUrl: "https://bridge.arbitrum.io", fundingLabel: "Bridge native USDC", fundingNote: "Use native Arbitrum USDC, not USDC.e." },
  "arc": { key: "arc", route: "arc", label: "Arc Mainnet", chainId: 5042, chainHex: "0x13b2", caip2: "eip155:5042", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io", native: { name: "USD Coin", symbol: "USDC", decimals: 18 }, payment: { symbol: "USDC", decimals: 6, address: "0x3600000000000000000000000000000000000000" }, provider: "Circle Gateway", fundingUrl: "https://docs.arc.io/arc/references/connect-to-arc", fundingLabel: "Fund USDC on Arc mainnet", fundingNote: "Use Arc mainnet USDC for gas and trading. Deposit USDC into Circle Gateway for research payments." },
} as const;

export type WebNetworkKey = keyof typeof WEB_NETWORKS;

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env || {};
export function parseEnabledWebNetworks(value: unknown): WebNetworkKey[] {
  const requested = String(value || "xlayer").split(",").map(value => value.trim()).map(value => value === "arc-testnet" ? "arc" : value);
  const enabled = [...new Set(requested.filter((key): key is WebNetworkKey => key in WEB_NETWORKS))];
  return enabled.length ? enabled : ["xlayer"];
}
export const ENABLED_WEB_NETWORKS = parseEnabledWebNetworks(viteEnv.VITE_ENABLED_NETWORKS);
export const NETWORK_STORAGE_KEY = "pulse:selected-network";

export function readPreferredNetwork(storage: Pick<Storage, "getItem">, enabled: readonly WebNetworkKey[] = ENABLED_WEB_NETWORKS): WebNetworkKey {
  const saved = storage.getItem(NETWORK_STORAGE_KEY) as WebNetworkKey | null;
  if (String(saved) === "arc-testnet" && enabled.includes("arc")) return "arc";
  return saved && enabled.includes(saved) ? saved : (enabled[0] || "xlayer");
}

export function savePreferredNetwork(storage: Pick<Storage, "setItem">, key: WebNetworkKey) {
  if (!(key in WEB_NETWORKS)) throw new Error(`Cannot persist unsupported PULSE network: ${key}`);
  storage.setItem(NETWORK_STORAGE_KEY, key);
}

export function networkKeyForChainId(value: unknown): WebNetworkKey | null {
  const text = String(value ?? "");
  const chainId = typeof value === "number" ? value : /^(?:0x[\da-f]+|\d+)$/i.test(text) ? Number(text) : NaN;
  return (Object.keys(WEB_NETWORKS) as WebNetworkKey[]).find((key) => WEB_NETWORKS[key].chainId === chainId) || null;
}

export function assertPaymentBalance(available: number | null | undefined, required: number, asset: string, network: string) {
  if (!Number.isFinite(required) || required <= 0) throw new Error("This service has no valid published price and cannot be purchased.");
  if (available === null || available === undefined || !Number.isFinite(available)) throw new Error(`Unable to verify ${asset} balance on ${network}; payment signing was not requested.`);
  if (available + 1e-9 < required) throw new Error(`Insufficient ${asset} on ${network}. Required ${required.toFixed(2)}, available ${available.toFixed(4)}.`);
}

export async function switchWalletNetwork(provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> }, key: WebNetworkKey) {
  const network = WEB_NETWORKS[key];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: network.chainHex }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: network.chainHex, chainName: network.label, nativeCurrency: network.native, rpcUrls: [network.rpc], ...(network.explorer ? { blockExplorerUrls: [network.explorer] } : {}) }] });
    // Adding a custom chain does not guarantee that the wallet selected it.
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: network.chainHex }] });
  }
  const active = await provider.request({ method: "eth_chainId" });
  if (networkKeyForChainId(active) !== key) throw new Error(`Your wallet did not switch to ${network.label}. Select that network in your wallet and try again.`);
}

function units(raw: bigint, decimals: number) { return Number(raw) / 10 ** decimals; }
function balanceData(address: string) { return `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`; }

export async function fetchTokenBalance(owner: string, token: string, decimals: number, key: WebNetworkKey, fresh = false): Promise<number> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner) || !/^0x[a-fA-F0-9]{40}$/.test(token)) throw new Error("Invalid balance lookup address");
  return units(await readBalance(WEB_NETWORKS[key].rpc, "eth_call", [{ to: token.toLowerCase(), data: balanceData(owner) }, "latest"], fresh), decimals);
}

export async function fetchNetworkBalances(address: string, key: WebNetworkKey, fresh = false) {
  const network = WEB_NETWORKS[key];
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("Invalid wallet balance address");
  const [native, payment] = await Promise.all([
    readBalance(network.rpc, "eth_getBalance", [address.toLowerCase(), "latest"], fresh),
    fetchTokenBalance(address, network.payment.address, network.payment.decimals, key, fresh),
  ]);
  return { native: units(native, network.native.decimals), payment };
}

export async function fetchArcGatewayBalance(address: string): Promise<number> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("Invalid Gateway depositor address");
  const response = await fetch("https://gateway-api.circle.com/v1/balances", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: 26, depositor: address }] }),
  });
  if (!response.ok) throw new Error(`Circle Gateway balance request failed (${response.status})`);
  const body = await response.json() as { balances?: Array<{ domain?: number; balance?: string }> };
  if (!Array.isArray(body.balances)) throw new Error("Circle Gateway returned no balance evidence");
  let atomic = 0n;
  for (const item of body.balances) {
    if ((item.domain !== undefined && Number(item.domain) !== 26) || typeof item.balance !== "string" || !/^\d{1,30}(?:\.\d{1,6})?$/.test(item.balance)) throw new Error("Circle Gateway returned invalid Arc balance evidence");
    const [whole, fraction = ""] = item.balance.split(".");
    atomic += BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  }
  return units(atomic, 6);
}

export const ARC_GATEWAY_WALLET = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" as const;

/** Native gas and ERC-20 USDC spend consume the same Arc wallet balance. */
export async function assertArcUsdcGasReserve(provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> }, owner: string, spendAtomic: bigint, gasLimit: bigint, nativeValue = 0n) {
  const [balance, gasPrice] = await Promise.all([
    provider.request({ method: "eth_getBalance", params: [owner, "latest"] }),
    provider.request({ method: "eth_gasPrice" }),
  ]);
  const required = spendAtomic * 1_000_000_000_000n + nativeValue + gasLimit * BigInt(String(gasPrice)) * 2n;
  if (spendAtomic < 0n || gasLimit < 0n || nativeValue < 0n || BigInt(String(balance)) < required) throw new Error("Keep enough wallet USDC for the amount and Arc transaction gas; reduce the amount or add USDC");
}
const gatewayAbi = [{ type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;

export function parseGatewayDepositAmount(amount: string): bigint {
  if (!/^\d{1,30}(?:\.\d{1,6})?$/.test(amount)) throw new Error("Enter a positive USDC amount with at most 6 decimal places");
  const [whole, fraction = ""] = amount.split(".");
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (value <= 0n) throw new Error("Enter a positive Gateway deposit amount");
  return value;
}

export async function depositArcGateway(provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> }, address: string, amount: string) {
  const value = parseGatewayDepositAmount(amount);
  await switchWalletNetwork(provider, "arc");
  const { createWalletClient, createPublicClient, custom, http, erc20Abi, defineChain } = await import("viem");
  const arc = defineChain({ id: WEB_NETWORKS.arc.chainId, name: WEB_NETWORKS.arc.label, nativeCurrency: WEB_NETWORKS.arc.native, rpcUrls: { default: { http: [WEB_NETWORKS.arc.rpc] } } });
  const account = address as `0x${string}`;
  const wallet = createWalletClient({ account, chain: arc, transport: custom(provider as never) });
  const publicClient = createPublicClient({ chain: arc, transport: http(WEB_NETWORKS["arc"].rpc) });
  if (await publicClient.getChainId() !== 5042) throw new Error("Arc RPC returned the wrong network; no deposit submitted");
  const [balance, gasPrice] = await Promise.all([publicClient.getBalance({ address: account }), publicClient.getGasPrice()]);
  if (balance < value * 1_000_000_000_000n + 470_000n * gasPrice * 2n) throw new Error("Keep enough wallet USDC for approval and deposit gas fees");
  const approvalHash = await wallet.writeContract({ account, address: WEB_NETWORKS["arc"].payment.address, abi: erc20Abi, functionName: "approve", args: [ARC_GATEWAY_WALLET, value], gas: 120_000n });
  const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
  if (approvalReceipt.status !== "success") throw new Error("Gateway USDC approval reverted; no deposit submitted");
  const depositHash = await wallet.writeContract({ account, address: ARC_GATEWAY_WALLET, abi: gatewayAbi, functionName: "deposit", args: [WEB_NETWORKS["arc"].payment.address, value], gas: 350_000n });
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  if (depositReceipt.status !== "success") throw new Error("Gateway deposit reverted");
  return { approvalHash, depositHash, amount: Number(amount) };
}
