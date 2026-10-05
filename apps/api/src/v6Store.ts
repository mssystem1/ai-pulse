import { isKvUnavailableError, kvCircuitStatus, kvConfigured, runKvCommand } from "./resilientKv.js";
import { executionPublicClient, executionRpcUrls, type ExecutionNetwork } from "./onchainDiscovery.js";
import { executionContractAddress, executionContracts } from "./executionContracts.js";
import { keccak256, toHex, parseAbi } from "viem";
import { verifiedAutopilotReceipt } from "./autopilotExecutionRecovery.js";
import { getNetwork } from "@pulse/config";
import { applyConfirmedPassPause, mutateAutopilotPass } from "./autopilotPassStore.js";

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
  fillSide?: "buy" | "sell";
  fillQuantity?: number;
  fillQuoteValue?: number;
  fillBaseAsset?: string;
  fillQuoteAsset?: string;
  passTimerReconciledAt?: string;
  createdAt: string;
  updatedAt: string;
};

const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
const PAUSED_TOPIC = keccak256(toHex("Paused(bool)"));
const erc20MetadataAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

type ReceiptLog = { address: string; topics: readonly string[]; data: string };
type FillReceipt = { status?: string; from?: string; to?: string | null; blockNumber?: string; transactionIndex?: string | number; logs?: ReceiptLog[] };

export function receiptPauseState(receipt: FillReceipt, owner: string, account: string): boolean | null {
  if (!["0x1", "success"].includes(receipt.status || "") || receipt.from?.toLowerCase() !== owner.toLowerCase()
    || receipt.to?.toLowerCase() !== account.toLowerCase()) return null;
  const log = receipt.logs?.filter(log => log.address.toLowerCase() === account.toLowerCase() && log.topics[0] === PAUSED_TOPIC).at(-1);
  if (!log || !/^0x[0-9a-f]{64}$/i.test(log.data)) return null;
  const decoded = BigInt(log.data);
  return decoded === 0n ? false : decoded === 1n ? true : null;
}

async function reconcilePassTimer(item: Activity, receipt?: FillReceipt | null): Promise<Activity> {
  if (item.passTimerReconciledAt || item.source !== "autopilot" || !item.account || !item.txHash
    || !/^vault_(pause|resume|policy_update|asset_configure|configure|limits_configure)$/.test(item.kind)
    || !["base", "arbitrum", "xlayer", "robinhood", "arc"].includes(item.network)) return item;
  const client = executionPublicClient(item.network as ExecutionNetwork);
  const verifiedReceipt = receipt || await client.getTransactionReceipt({ hash: item.txHash as `0x${string}` }) as unknown as FillReceipt;
  const paused = receiptPauseState(verifiedReceipt, item.owner, item.account);
  if (paused == null || !verifiedReceipt.blockNumber) return item;
  const block = await client.getBlock({ blockNumber: BigInt(verifiedReceipt.blockNumber) });
  await mutateAutopilotPass(item.network as ExecutionNetwork, item.account, current =>
    current?.owner.toLowerCase() === item.owner.toLowerCase()
      ? applyConfirmedPassPause(current, { txHash: item.txHash!, paused, at: Number(block.timestamp) * 1000, order: Number(verifiedReceipt.transactionIndex || 0) }) : current);
  return { ...item, passTimerReconciledAt: new Date().toISOString() };
}

function topicAddress(value?: string) {
  return value && value.length === 66 ? `0x${value.slice(-40)}`.toLowerCase() : "";
}

export async function enrichExecutionFill(item: Activity, receipt?: FillReceipt | null, reader?: ReturnType<typeof executionPublicClient>): Promise<Activity> {
  if ((item.fillPrice && item.fillSide && item.fillQuantity && item.fillQuoteValue) || !item.txHash || !(item.network === "xlayer" || item.network === "base" || item.network === "arbitrum" || item.network === "robinhood" || item.network === "arc")) return item;
  const executionKind = /market_(buy|sell)|automatic_(entry|take_profit|stop_loss|fill)|^(buy|sell)(_partial)?_filled$/i.test(item.kind);
  if (!executionKind) return item;
  const client = reader || executionPublicClient(item.network as ExecutionNetwork);
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
    // Arc emits a native system-ledger mirror alongside the canonical 6-decimal
    // USDC Transfer. It is not another ERC-20 output and must not be counted.
    if (item.network === "arc" && token === "0xfffffffffffffffffffffffffffffffffffffffe") continue;
    if (topicAddress(log.topics[1]) === actor) outgoing.set(token, (outgoing.get(token) || 0n) + amount);
    if (topicAddress(log.topics[2]) === actor) incoming.set(token, (incoming.get(token) || 0n) + amount);
  }
  // Net refunds before computing execution amounts. Gross transfers can count
  // returned settlement tokens as purchased inventory and produce false PnL.
  for (const token of new Set([...outgoing.keys(), ...incoming.keys()])) {
    const net = (outgoing.get(token) || 0n) - (incoming.get(token) || 0n);
    outgoing.set(token, net > 0n ? net : 0n);
    incoming.set(token, net < 0n ? -net : 0n);
  }
  const outgoingTokens = [...outgoing.keys()].filter(token => outgoing.get(token)! > 0n);
  const incomingTokens = [...incoming.keys()].filter(token => incoming.get(token)! > 0n);
  // Ambiguous multi-asset receipts need explicit trade-event decoding, not a
  // guess based on which token happens to have the largest human-unit amount.
  if (outgoingTokens.length !== 1 || incomingTokens.length !== 1) return item;
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
  const settlement = getNetwork(item.network).paymentAsset.address?.toLowerCase();
  const isBuy = input.token === settlement;
  if (!isBuy && output.token !== settlement) return item;
  const fillPrice = isBuy ? input.human / output.human : output.human / input.human;
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return item;
  // Receipt ordering matters for cost basis and chart placement. Never substitute
  // a later UI refresh time for a trade's block time; retry incomplete enrichment.
  if (!fullReceipt.blockNumber) return item;
  const block = await client.getBlock({ blockNumber: BigInt(fullReceipt.blockNumber) });
  const fillObservedAt = new Date(Number(block.timestamp) * 1000).toISOString();
  return {
    ...item,
    fillPrice,
    fillInputAmount: String(input.atomic),
    fillOutputAmount: String(output.atomic),
    fillInputSymbol: input.symbol,
    fillOutputSymbol: output.symbol,
    fillObservedAt,
    fillSide: isBuy ? "buy" : "sell",
    fillQuantity: isBuy ? output.human : input.human,
    fillQuoteValue: isBuy ? input.human : output.human,
    fillBaseAsset: isBuy ? output.token : input.token,
    fillQuoteAsset: settlement,
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
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
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
  const items = [item, ...(await listV6Activity(input.owner, input.network))];
  memory.set(storageKey, items);
  if (kvConfigured()) {
    try { await writeActivityHash(input.owner, input.network, [item]); }
    catch (error) { if (!isKvUnavailableError(error)) throw error; }
  }
  return item;
}

/** Confirm a worker-submitted activity in place after verifying its receipt. */
export async function confirmV6Activity(submitted: Activity): Promise<Activity> {
  const items = await listV6Activity(submitted.owner, submitted.network);
  const current = items.find(item => item.id === submitted.id);
  if (!current || current.txHash !== submitted.txHash || current.account !== submitted.account
    || current.source !== submitted.source || current.kind !== submitted.kind)
    throw new Error("Submitted activity is unavailable or its execution identity changed");
  if (current.status === "confirmed") return current;
  const confirmed: Activity = { ...current, status: "confirmed", updatedAt: new Date().toISOString() };
  memory.set(key(submitted.owner, submitted.network), items.map(item => item.id === confirmed.id ? confirmed : item));
  if (kvConfigured()) {
    try { await writeActivityHash(submitted.owner, submitted.network, [confirmed]); }
    catch (error) { if (!isKvUnavailableError(error)) throw error; }
  }
  return confirmed;
}

async function writeActivityHash(owner: string, network: string, items: Activity[]) {
  if (!items.length) return;
  await upstash(["HSET", hashKey(owner, network), ...items.flatMap((item) => [item.id, JSON.stringify(item)])]);
}

async function writeActivities(owner: string, network: string, items: Activity[]) {
  const storageKey = key(owner, network);
  const next = items;
  memory.set(storageKey, next);
  if (kvConfigured()) {
    try { await writeActivityHash(owner, network, next); }
    catch (error) { if (!isKvUnavailableError(error)) throw error; }
  }
}

async function receiptBatch(network: string, rpcUrl: string, hashes: string[]) {
  const urls = network === "xlayer" || network === "base" || network === "arbitrum" || network === "robinhood" || network === "arc" ? executionRpcUrls(network as ExecutionNetwork) : [rpcUrl];
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
  let ownedAutopilotVaults: Promise<readonly string[]> | undefined;
  let next = await Promise.all(items.map(async (item, index) => {
    const batchIndex = pendingByIndex.get(index);
    if (batchIndex === undefined) return item;
    const receipt = receipts.get(batchIndex);
    if (!receipt) return item;
    let status: Activity["status"] = receipt.from?.toLowerCase() === owner.toLowerCase() && receipt.status === "0x1" ? "confirmed" : "failed";
    if (item.source === "autopilot" && item.account && /^(buy_filled|sell_partial_filled|sell_filled)$/.test(item.kind)
      && ["xlayer", "base", "arbitrum", "robinhood", "arc"].includes(network) && receipt.status === "0x1") {
      try {
        const chain = network as ExecutionNetwork;
        const factory = executionContracts(chain).autopilotFactory;
        if (!factory) return item;
        ownedAutopilotVaults ??= executionPublicClient(chain).readContract({ address: factory,
          abi: parseAbi(["function vaultsOf(address) view returns(address[])"]), functionName: "vaultsOf", args: [owner as `0x${string}`] });
        const owned = await ownedAutopilotVaults;
        status = verifiedAutopilotReceipt(receipt, item.account, owned) ? "confirmed" : "failed";
      } catch { return item; } // Missing ownership evidence is pending, not failure.
    }
    changed = true; return { ...item, status, updatedAt: new Date().toISOString() };
  }));
  const enrich = async (item: Activity, index: number) => {
    if (item.status !== "confirmed" || (item.fillPrice && item.fillSide && item.fillQuantity && item.fillQuoteValue)) return item;
    const batchIndex = pendingByIndex.get(index);
    try {
      const receipt = batchIndex === undefined ? null : receipts.get(batchIndex);
      const timerReconciled = await reconcilePassTimer(item, receipt);
      const enriched = await enrichExecutionFill(timerReconciled, receipt);
      if (enriched !== item) changed = true;
      return enriched;
    } catch { return item; }
  };
  // Bound RPC concurrency when legacy histories need receipt enrichment. The
  // complete journal is retained; it must not become a burst of thousands of calls.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, next.length) }, async () => {
    while (cursor < next.length) {
      const index = cursor++;
      next[index] = await enrich(next[index], index);
    }
  }));
  if (changed) await writeActivities(owner, network, next);
  return next;
}

export type { Activity };
export function v6ActivityPersistenceStatus() { return kvCircuitStatus(); }
