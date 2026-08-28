import { isKvUnavailableError, kvCircuitStatus, kvConfigured, runKvCommand } from "./resilientKv.js";
import { executionRpcUrls, type ExecutionNetwork } from "./onchainDiscovery.js";

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
  amount?: string;
  createdAt: string;
  updatedAt: string;
};

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
      const body = await response.json() as Array<{ id: number; result?: { status?: string; from?: string } | null; error?: { message?: string } }>;
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
  let receipts = new Map<number, { status?: string; from?: string } | null>();
  try { receipts = await receiptBatch(network, rpcUrl, pending.map(({ item }) => item.txHash!)); } catch { return items; }
  const pendingByIndex = new Map(pending.map((entry, batchIndex) => [entry.index, batchIndex]));
  const next = items.map((item, index) => {
    const batchIndex = pendingByIndex.get(index);
    if (batchIndex === undefined) return item;
    const receipt = receipts.get(batchIndex);
    if (!receipt) return item;
    const status: Activity["status"] = receipt.from?.toLowerCase() === owner.toLowerCase() && receipt.status === "0x1" ? "confirmed" : "failed";
    changed = true; return { ...item, status, updatedAt: new Date().toISOString() };
  });
  if (changed) await writeActivities(owner, network, next);
  return next;
}

export type { Activity };
export function v6ActivityPersistenceStatus() { return kvCircuitStatus(); }
