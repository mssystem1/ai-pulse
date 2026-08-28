import { createPublicClient, fallback, http, type PublicClient } from "viem";

export type ExecutionNetwork = "xlayer" | "base" | "arbitrum";

const NETWORKS = {
  xlayer: { id: 196, primary: () => process.env.X_LAYER_RPC || "https://rpc.xlayer.tech", fallback: () => process.env.X_LAYER_RPC_FALLBACK || "https://xlayerrpc.okx.com", prefix: "XLAYER" },
  base: { id: 8453, primary: () => process.env.BASE_RPC_URL || "https://mainnet.base.org", fallback: () => process.env.BASE_RPC_FALLBACK_URL || "https://1rpc.io/base", prefix: "BASE" },
  arbitrum: { id: 42161, primary: () => process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc", fallback: () => process.env.ARBITRUM_RPC_FALLBACK_URL || "https://arbitrum-one-rpc.publicnode.com", prefix: "ARBITRUM" },
} as const;

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ZERO = /^0x0{40}$/i;
const factoryAccountAbi = [{ type: "function", name: "accountOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "account", type: "address" }] }] as const;
const vaultFactoryAbi = [{ type: "function", name: "vaultsOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "vaults", type: "address[]" }] }] as const;
const vaultAbi = [
  { type: "function", name: "settlementAsset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export function executionRpcUrls(network: ExecutionNetwork) {
  const cfg = NETWORKS[network];
  return [...new Set([cfg.primary(), cfg.fallback()].map((value) => value.trim()).filter(Boolean))];
}

export function executionPublicClient(network: ExecutionNetwork): PublicClient {
  const cfg = NETWORKS[network];
  const urls = executionRpcUrls(network);
  const chain = { id: cfg.id, name: network, nativeCurrency: { name: "Native", symbol: network === "xlayer" ? "OKB" : "ETH", decimals: 18 }, rpcUrls: { default: { http: urls } }, contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const, blockCreated: 0 } } } as const;
  return createPublicClient({ chain, transport: fallback(urls.map((url) => http(url, { retryCount: 2, retryDelay: 450 })), { retryCount: 1 }) });
}

export type OnchainAccountSnapshot = {
  network: ExecutionNetwork;
  owner: string;
  accounts: { protection: string | null; limit: string | null; bracket: string | null };
  vaults: Array<{ address: string; settlementAsset: string | null; settlementSymbol: string | null; settlementDecimals: number | null; balanceAtomic: string | null; paused: boolean | null }>;
  observedAt: string;
  stale: boolean;
};

const snapshots = new Map<string, { value: OnchainAccountSnapshot; expiresAt: number }>();
const inflight = new Map<string, Promise<OnchainAccountSnapshot>>();

function configuredAddress(name: string) {
  const value = process.env[name]?.trim() || "";
  return ADDRESS.test(value) ? value as `0x${string}` : null;
}

async function readSnapshot(network: ExecutionNetwork, owner: string): Promise<OnchainAccountSnapshot> {
  const cfg = NETWORKS[network];
  const client = executionPublicClient(network);
  const protectionFactory = configuredAddress(`${cfg.prefix}_SPOT_ORDER_FACTORY_ADDRESS`);
  const limitFactory = configuredAddress(`${cfg.prefix}_SPOT_LIMIT_FACTORY_ADDRESS`);
  const bracketFactory = configuredAddress(`${cfg.prefix}_SPOT_BRACKET_FACTORY_ADDRESS`);
  const autopilotFactory = configuredAddress(`${cfg.prefix}_AUTOPILOT_VAULT_FACTORY_ADDRESS`);
  const contracts = [
    ...(protectionFactory ? [{ address: protectionFactory, abi: factoryAccountAbi, functionName: "accountOf" as const, args: [owner as `0x${string}`] }] : []),
    ...(limitFactory ? [{ address: limitFactory, abi: factoryAccountAbi, functionName: "accountOf" as const, args: [owner as `0x${string}`] }] : []),
    ...(bracketFactory ? [{ address: bracketFactory, abi: factoryAccountAbi, functionName: "accountOf" as const, args: [owner as `0x${string}`] }] : []),
    ...(autopilotFactory ? [{ address: autopilotFactory, abi: vaultFactoryAbi, functionName: "vaultsOf" as const, args: [owner as `0x${string}`] }] : []),
  ];
  const results = contracts.length ? await client.multicall({ contracts, allowFailure: true }) : [];
  let cursor = 0;
  const account = (configured: string | null) => {
    if (!configured) return null;
    const result = results[cursor++];
    const value = result?.status === "success" ? String(result.result) : "";
    return ADDRESS.test(value) && !ZERO.test(value) ? value : null;
  };
  const protection = account(protectionFactory);
  const limit = account(limitFactory);
  const bracket = account(bracketFactory);
  let vaultAddresses: string[] = [];
  if (autopilotFactory) {
    const result = results[cursor++];
    if (result?.status === "success" && Array.isArray(result.result)) vaultAddresses = result.result.map(String).filter((value) => ADDRESS.test(value) && !ZERO.test(value));
  }
  const vaults = await Promise.all(vaultAddresses.slice(-25).map(async (vault) => {
    try {
      const [settlementResult, pausedResult] = await client.multicall({ contracts: [
        { address: vault as `0x${string}`, abi: vaultAbi, functionName: "settlementAsset" },
        { address: vault as `0x${string}`, abi: vaultAbi, functionName: "paused" },
      ], allowFailure: false });
      const settlementAsset = String(settlementResult);
      const [balance, decimals, symbol] = await client.multicall({ contracts: [
        { address: settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [vault as `0x${string}`] },
        { address: settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
        { address: settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
      ], allowFailure: false });
      return { address: vault, settlementAsset, settlementSymbol: String(symbol), settlementDecimals: Number(decimals), balanceAtomic: String(balance), paused: Boolean(pausedResult) };
    } catch {
      return { address: vault, settlementAsset: null, settlementSymbol: null, settlementDecimals: null, balanceAtomic: null, paused: null };
    }
  }));
  return { network, owner, accounts: { protection, limit, bracket }, vaults, observedAt: new Date().toISOString(), stale: false };
}

/** One cached, coalesced contract snapshot replaces independent browser factory polling. */
export async function getOnchainAccountSnapshot(network: ExecutionNetwork, owner: string, fresh = false) {
  const key = `${network}:${owner.toLowerCase()}`;
  const cached = snapshots.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = readSnapshot(network, owner)
    .then((value) => { snapshots.set(key, { value, expiresAt: Date.now() + 30_000 }); return value; })
    .catch((error) => {
      if (cached) return { ...cached.value, stale: true };
      throw error;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}
