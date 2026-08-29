import { isKvUnavailableError, kvCircuitStatus, kvConfigured, runKvCommand } from "./resilientKv.js";
import { executionPublicClient, executionRpcUrls, type ExecutionNetwork } from "./onchainDiscovery.js";
import { executionContractAddress } from "./executionContracts.js";
import { keccak256, toHex } from "viem";

type Activity = {
  id: string;
  owner: string;
  network: string;
  source: "wallet" | "spot" | "autopilot" | "limit";
  kind: string;
  status: "pending" | "confirmed" | "failed";
  txHash?: string;
  account?: string;
  pair?: string;
  executionPair?: string;
  amount?: string;
  fillPrice?: number;
  fillInputAmount?: string;
  fillOutputAmount?: string;
  fillInputSymbol?: string;
  fillOutputSymbol?: string;
  fillObservedAt?: string;
  createdAt: string;
  updatedAt: string;
};

const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
const erc20MetadataAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

type ReceiptLog = { address: string; topics: readonly string[]; data: string };
type FillReceipt = { status?: string; from?: string; to?: string | null; blockNumber?: string; logs?: ReceiptLog[] };

function topicAddress(value?: string) {
  return value && value.length === 66 ? `0x${value.slice(-40)}`.toLowerCase() : "";
}

async function enrichExecutionFill(item: Activity, receipt?: FillReceipt | null): Promise<Activity> {
  if (item.fillPrice || !item.txHash || !(item.network === "xlayer" || item.network === "base" || item.network === "arbitrum")) return item;
  const executionKind = /market_(buy|sell)|automatic_(entry|take_profit|stop_loss|fill)|^(buy|sell)(_partial)?_filled$/i.test(item.kind);
  if (!executionKind) return item;
  const client = executionPublicClient(item.network as ExecutionNetwork);
  const fullReceipt = receipt || await client.getTransactionReceipt({ hash: item.txHash as `0x${string}` }) as unknown as FillReceipt;
  const actor = (item.account || item.owner).toLowerCase();
  const expectedTo = item.account || executionContractAddress(item.network as ExecutionNetwork, "okxRouter");
  if (fullReceipt.status !== "0x1" && fullReceipt.status !== "success") return item;
  if (!expectedTo || fullReceipt.to?.toLowerCase() !== expectedTo.toLowerCase()) return item;
  if (!item.account && fullReceipt.from?.toLowerCase() !== item.owner.toLowerCase()) return item;
  const outgoing = new Map<string, bigint>();
  const incoming = new Map<string, bigint>();
  for (const log of fullReceipt.logs || []) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue;
    const amount = BigInt(log.data || "0x0");
    const token = log.address.toLowerCase();
    if (topicAddress(log.topics[1]) === actor) outgoing.set(token, (outgoing.get(token) || 0n) + amount);
    if (topicAddress(log.topics[2]) === actor) incoming.set(token, (incoming.get(token) || 0n) + amount);
  }
  const outgoingTokens = [...outgoing.keys()].filter((token) => !incoming.has(token) || outgoing.get(token) !== incoming.get(token));
  const incomingTokens = [...incoming.keys()].filter((token) => !outgoing.has(token) || outgoing.get(token) !== incoming.get(token));
  if (!outgoingTokens.length || !incomingTokens.length) return item;
  const tokenAddresses = [...new Set([...outgoingTokens, ...incomingTokens])] as `0x${string}`[];
  const metadata = new Map<string, { symbol: string; decimals: number }>();
  await Promise.all(tokenAddresses.map(async (token) => {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: erc20MetadataAbi, functionName: "symbol" }),
      client.readContract({ address: token, abi: erc20MetadataAbi, functionName: "decimals" }),
    ]);
    metadata.set(token.toLowerCase(), { symbol: String(symbol), decimals: Number(decimals) });
  }));
  const normalized = (tokens: string[], amounts: Map<string, bigint>) => tokens
    .map((token) => {
      const meta = metadata.get(token)!;
      const atomic = amounts.get(token) || 0n;
      return { token, atomic, ...meta, human: Number(atomic) / 10 ** meta.decimals };
    })
    .filter((entry) => Number.isFinite(entry.human) && entry.human > 0)
    .sort((left, right) => right.human - left.human)[0];
  const input = normalized(outgoingTokens, outgoing);
  const output = normalized(incomingTokens, incoming);
  if (!input || !output) return item;
  const isBuy = /buy|entry_protected/i.test(item.kind);
  const fillPrice = isBuy ? input.human / output.human : output.human / input.human;
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return item;
  let fillObservedAt = item.updatedAt;
  if (fullReceipt.blockNumber) {
    try {
      const block = await client.getBlock({ blockNumber: BigInt(fullReceipt.blockNumber) });
      fillObservedAt = new Date(Number(block.timestamp) * 1000).toISOString();
    } catch { /* Receipt remains authoritative even if timestamp lookup degrades. */ }
  }
  return {
    ...item,
    fillPrice,
    fillInputAmount: String(input.atomic),
    fillOutputAmount: String(output.atomic),
    fillInputSymbol: input.symbol,
    fillOutputSymbol: output.symbol,
    fillObservedAt,
    updatedAt: new Date().toISOString(),
  };
}

const memory = new Map<string, Activity[]>();

function key(owner: string, network: string) {
  return `pulse:v6:activity:${network}:${owner.toLowerCase()}`;
}

function hashKey(owner: string, network: string) {
  return `pulse:v6:activity-map:${network}:${owner.toLowerCase()}`;
}

export function decodeActivityHash(raw: unknown): Activity[] {
  const values = Array.isArray(raw)
    ? raw.filter((_value, index) => index % 2 === 1)
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [];
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value) as Activity;
      return parsed && typeof parsed.id === "string" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export function mergeActivityRecords(remote: Activity[], cached: Activity[]) {
  const byId = new Map<string, Activity>();
  for (const item of [...remote, ...cached]) {
    const current = byId.get(item.id);
    if (!current || Date.parse(item.updatedAt) > Date.parse(current.updatedAt)) byId.set(item.id, item);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 500);
}

async function upstash(command: unknown[]): Promise<unknown> {
  return runKvCommand(command, "trading activity");
}

export async function listV6Activity(owner: string, network: string): Promise<Activity[]> {
  const storageKey = key(owner, network);
  if (!kvConfigured()) return memory.get(storageKey) || [];
  const cached = memory.get(storageKey) || [];
  try {
    let remote = decodeActivityHash(await upstash(["HGETALL", hashKey(owner, network)]));
    if (!remote.length) {
      const legacy = await upstash(["GET", storageKey]);
      if (typeof legacy === "string") {
        try { remote = JSON.parse(legacy) as Activity[]; } catch { remote = []; }
      }
      if (remote.length) await writeActivityHash(owner, network, remote);
    }
    // The process mirror doubles as a short-lived outbox, but a newer write
    // from another API worker must win over this process's stale cache.
    const merged = mergeActivityRecords(remote, cached);
    memory.set(storageKey, merged);
    const remoteById = new Map(remote.map((item) => [item.id, item.updatedAt]));
    const changed = merged.filter((item) => remoteById.get(item.id) !== item.updatedAt);
    if (changed.length) await writeActivityHash(owner, network, changed);
    return merged;
  } catch (error) {
    if (!isKvUnavailableError(error)) throw error;
    return cached;
  }
}

export async function recordV6Activity(input: Omit<Activity, "id" | "createdAt" | "updatedAt">): Promise<Activity> {
  const now = new Date().toISOString();
  const item: Activity = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  const storageKey = key(input.owner, input.network);
  const items = [item, ...(await listV6Activity(input.owner, input.network))].slice(0, 500);
  memory.set(storageKey, items);
  if (kvConfigured()) {
    try { await writeActivityHash(input.owner, input.network, [item]); }
    catch (error) { if (!isKvUnavailableError(error)) throw error; }
  }
  return item;
}

async function writeActivityHash(owner: string, network: string, items: Activity[]) {
  if (!items.length) return;
  await upstash(["HSET", hashKey(owner, network), ...items.flatMap((item) => [item.id, JSON.stringify(item)])]);
}

async function writeActivities(owner: string, network: string, items: Activity[]) {
  const storageKey = key(owner, network);
  const next = items.slice(0, 500);
  memory.set(storageKey, next);
  if (kvConfigured()) {
    try { await writeActivityHash(owner, network, next); }
    catch (error) { if (!isKvUnavailableError(error)) throw error; }
  }
}

async function receiptBatch(network: string, rpcUrl: string, hashes: string[]) {
  const urls = network === "xlayer" || network === "base" || network === "arbitrum" ? executionRpcUrls(network as ExecutionNetwork) : [rpcUrl];
  let lastError: unknown;
  for (const url of [...new Set([rpcUrl, ...urls])]) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hashes.map((txHash, index) => ({ jsonrpc: "2.0", id: index + 1, method: "eth_getTransactionReceipt", params: [txHash] }))), signal: AbortSignal.timeout(10_000) });
      const body = await response.json() as Array<{ id: number; result?: FillReceipt | null; error?: { message?: string } }>;
      if (!response.ok || !Array.isArray(body)) throw new Error(`RPC ${response.status}`);
      return new Map(body.map((item) => [item.id - 1, item.error ? null : item.result || null]));
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Receipt RPC unavailable");
}

/** Reconcile client-announced hashes against chain receipts; KV/UI is never treated as settlement truth. */
export async function reconcileV6Activity(owner: string, network: string, rpcUrl: string): Promise<Activity[]> {
  const items = await listV6Activity(owner, network); let changed = false;
  const pending = items.map((item, index) => ({ item, index })).filter(({ item }) => item.status === "pending" && item.txHash).slice(0, 80);
  let receipts = new Map<number, FillReceipt | null>();
  if (pending.length) {
    try { receipts = await receiptBatch(network, rpcUrl, pending.map(({ item }) => item.txHash!)); }
    catch { /* Keep existing state and still enrich previously confirmed fills. */ }
  }
  const pendingByIndex = new Map(pending.map((entry, batchIndex) => [entry.index, batchIndex]));
  let next = items.map((item, index) => {
    const batchIndex = pendingByIndex.get(index);
    if (batchIndex === undefined) return item;
    const receipt = receipts.get(batchIndex);
    if (!receipt) return item;
    const status: Activity["status"] = receipt.from?.toLowerCase() === owner.toLowerCase() && receipt.status === "0x1" ? "confirmed" : "failed";
    changed = true; return { ...item, status, updatedAt: new Date().toISOString() };
  });
  next = await Promise.all(next.map(async (item, index) => {
    if (item.status !== "confirmed" || item.fillPrice) return item;
    const batchIndex = pendingByIndex.get(index);
    try {
      const enriched = await enrichExecutionFill(item, batchIndex === undefined ? null : receipts.get(batchIndex));
      if (enriched !== item) changed = true;
      return enriched;
    } catch { return item; }
  }));
  if (changed) await writeActivities(owner, network, next);
  return next;
}

export type { Activity };
export function v6ActivityPersistenceStatus() { return kvCircuitStatus(); }
