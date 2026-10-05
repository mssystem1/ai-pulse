import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { executionContractAddress } from "./executionContracts.js";

export type { ExecutionNetwork } from "./executionContracts.js";
import type { ExecutionNetwork } from "./executionContracts.js";

const NETWORKS = {
  arc: { id: 5042, primary: () => process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io", fallback: () => process.env.ARC_RPC_FALLBACK_URL || "https://rpc.quicknode.mainnet.arc.io", prefix: "ARC" },
  robinhood: { id: 4663, primary: () => process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", fallback: () => process.env.ROBINHOOD_RPC_FALLBACK_URL || "https://rpc.mainnet.chain.robinhood.com", prefix: "ROBINHOOD" },
  xlayer: { id: 196, primary: () => process.env.X_LAYER_RPC || "https://rpc.xlayer.tech", fallback: () => process.env.X_LAYER_RPC_FALLBACK || "https://xlayerrpc.okx.com", prefix: "XLAYER" },
  base: { id: 8453, primary: () => process.env.BASE_RPC_URL || "https://mainnet.base.org", fallback: () => process.env.BASE_RPC_FALLBACK_URL || "https://base-rpc.publicnode.com", prefix: "BASE" },
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

export function normalizeExecutionRpcUrls(network: string, values: readonly string[]) {
  // This public endpoint permanently returns HTTP 410. Also migrate explicit
  // legacy environment values; changing only the default leaves them broken.
  return [...new Set(values.map(value => value.trim()).filter(Boolean).map(value =>
    network === "base" && /^https?:\/\/1rpc\.io\/base\/?$/i.test(value)
      ? "https://base-rpc.publicnode.com" : value))];
}

export function executionRpcUrls(network: ExecutionNetwork) {
  const cfg = NETWORKS[network];
  return normalizeExecutionRpcUrls(network, [cfg.primary(), cfg.fallback()]);
}

export function executionPublicClient(network: ExecutionNetwork): PublicClient {
  const cfg = NETWORKS[network];
  const urls = executionRpcUrls(network);
  const chain = { id: cfg.id, name: network, nativeCurrency: { name: "Native", symbol: network === "xlayer" ? "OKB" : network === "arc" ? "USDC" : "ETH", decimals: 18 }, rpcUrls: { default: { http: urls } }, contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const, blockCreated: 0 } } } as const;
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

export async function readSnapshot(network: ExecutionNetwork, owner: string, client: PublicClient = executionPublicClient(network)): Promise<OnchainAccountSnapshot> {
  const protectionFactory = executionContractAddress(network, "spotFactory");
  const limitFactory = executionContractAddress(network, "spotLimitFactory");
  const bracketFactory = executionContractAddress(network, "spotBracketFactory");
  const autopilotFactory = executionContractAddress(network, "autopilotFactory");
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
    if (result?.status !== "success" || !Array.isArray(result.result)) throw new Error("Autopilot account discovery is unavailable; existing accounts must not be treated as absent.");
    vaultAddresses = result.result.map(String).filter((value) => ADDRESS.test(value) && !ZERO.test(value));
  }
  const vaults: OnchainAccountSnapshot["vaults"] = [];
  // Bounded batches, not two concurrent RPC calls per vault. Keep factory order
  // and every account: slicing the last 25 silently changed account numbering.
  for (let offset = 0; offset < vaultAddresses.length; offset += 20) {
    const addresses = vaultAddresses.slice(offset, offset + 20);
    const state = await client.multicall({ contracts: addresses.flatMap(vault => [
        { address: vault as `0x${string}`, abi: vaultAbi, functionName: "settlementAsset" },
        { address: vault as `0x${string}`, abi: vaultAbi, functionName: "paused" },
      ]), allowFailure: true });
    const group = addresses.map((address, index) => {
      const asset = state[index * 2];
      const pause = state[index * 2 + 1];
      return { address, settlementAsset: asset?.status === "success" && ADDRESS.test(String(asset.result)) ? String(asset.result) : null,
        paused: pause?.status === "success" ? Boolean(pause.result) : null,
        settlementSymbol: null, settlementDecimals: null, balanceAtomic: null } as OnchainAccountSnapshot["vaults"][number];
    });
    const readable = group.filter(vault => vault.settlementAsset);
    const balances = readable.length ? await client.multicall({ contracts: readable.flatMap(vault => [
      { address: vault.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [vault.address as `0x${string}`] },
      { address: vault.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
      { address: vault.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
    ]), allowFailure: true }) : [];
    readable.forEach((vault, index) => {
      const [balance, decimals, symbol] = balances.slice(index * 3, index * 3 + 3);
      if (balance?.status === "success") vault.balanceAtomic = String(balance.result);
      if (decimals?.status === "success") vault.settlementDecimals = Number(decimals.result);
      if (symbol?.status === "success") vault.settlementSymbol = String(symbol.result);
    });
    vaults.push(...group);
  }
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
