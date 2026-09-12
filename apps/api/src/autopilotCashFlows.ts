import { keccak256, toHex, type PublicClient } from "viem";
import { executionPublicClient, type ExecutionNetwork } from "./onchainDiscovery.js";
import { kvConfigured, runKvCommand } from "./resilientKv.js";

export type CashFlowStrategy = { network: ExecutionNetwork; owner: string; vault: string; settlementAsset: string; targetAsset?: string; createdAt: string; baselineBlockNumber?: string };
export type RecoveredCashFlow = { id: string; txHash: string; logIndex: number; blockNumber: string; token: string; kind: "vault_fund" | "vault_withdraw"; amount: string; status: "confirmed"; createdAt: string };
export type CashFlowCheckpoint = {
  version: 1; identity: string; fromBlock: string; throughBlock: string; throughHash: string;
  targetBlock: string; baselineSource: "block" | "legacy_timestamp"; flows: RecoveredCashFlow[]; updatedAt: string;
};
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const EXECUTED = new Set([
  keccak256(toHex("Executed(bytes32,address,uint256,bytes32)")),
  keccak256(toHex("Executed(bytes32,address,uint256,address,address,uint256,uint256,bytes32)")),
]);
const topic = (address: string): `0x${string}` => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const addressFromTopic = (value: string) => `0x${value.slice(-40)}`.toLowerCase();
const identity = (s: CashFlowStrategy) => `${s.network}:${s.owner.toLowerCase()}:${s.vault.toLowerCase()}:${s.settlementAsset.toLowerCase()}:${s.targetAsset?.toLowerCase() || ""}:${s.baselineBlockNumber || s.createdAt}`;
const key = (s: CashFlowStrategy) => `pulse:v6:cash-flow-proof:${s.network}:${s.vault.toLowerCase()}`;
const memory = new Map<string, CashFlowCheckpoint>();
type ChainLog = { address: string; topics: readonly string[]; data: string; transactionHash: string | null; logIndex: number | null; blockNumber: bigint | null; blockHash: string | null; removed?: boolean };

export function decodeOwnerCashFlow(log: ChainLog, s: CashFlowStrategy): Omit<RecoveredCashFlow, "createdAt"> | null {
  return decodeCashFlow(log, s, true);
}

function decodeCashFlow(log: ChainLog, s: CashFlowStrategy, ownerOnly: boolean): Omit<RecoveredCashFlow, "createdAt"> | null {
  if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER.toLowerCase() || !/^0x[0-9a-f]{64}$/i.test(log.data)) return null;
  const from = addressFromTopic(log.topics[1]), to = addressFromTopic(log.topics[2]);
  const kind = from !== to && (!ownerOnly || from === s.owner.toLowerCase()) && to === s.vault.toLowerCase() ? "vault_fund"
    : from !== to && from === s.vault.toLowerCase() && (!ownerOnly || to === s.owner.toLowerCase()) ? "vault_withdraw" : null;
  if (!kind || BigInt(log.data) === 0n) return null;
  if (log.removed || !log.transactionHash || log.logIndex === null || log.blockNumber === null || !log.blockHash) throw new Error("Cash-flow log is not confirmed");
  return { id: `${log.transactionHash.toLowerCase()}:${log.logIndex}`, txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: String(log.blockNumber), token: log.address.toLowerCase(), kind, amount: String(BigInt(log.data)), status: "confirmed" };
}

export async function readCashFlowCheckpoint(s: CashFlowStrategy): Promise<CashFlowCheckpoint | null> {
  const durable = kvConfigured();
  const raw = durable ? await runKvCommand(["GET", key(s)], "cash-flow proof") : undefined;
  const result = durable ? (raw ? JSON.parse(String(raw)) as CashFlowCheckpoint : undefined) : memory.get(key(s));
  return result?.version === 1 && result.identity === identity(s) ? result : null;
}

/** First block at/after legacy registration; new registrations have an exact balance block. */
async function firstBlock(client: PublicClient, s: CashFlowStrategy, tip: bigint) {
  if (s.baselineBlockNumber && /^\d+$/.test(s.baselineBlockNumber)) return BigInt(s.baselineBlockNumber) + 1n;
  const time = Date.parse(s.createdAt);
  if (!Number.isFinite(time)) throw new Error("Missing registration time for cash-flow recovery");
  let low = 0n, high = tip + 1n;
  while (low < high) {
    const mid = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (Number(block.timestamp) * 1000 < time) low = mid + 1n; else high = mid;
  }
  return low;
}

/** Bounded, read-only chain scan. A failed page never advances the durable cursor. */
export async function recoverCashFlowPage(s: CashFlowStrategy, previous: CashFlowCheckpoint | null, client: PublicClient, maxPages = 4): Promise<CashFlowCheckpoint> {
  const tip = await client.getBlockNumber();
  // Keep a reorg buffer; the exact checkpoint hash is checked on every continuation.
  const target = tip > 64n ? tip - 64n : 0n;
  let current = previous?.identity === identity(s) ? previous : null;
  if (current && BigInt(current.throughBlock) > target) current = null;
  if (current && BigInt(current.throughBlock) >= 0n) {
    const checkpoint = await client.getBlock({ blockNumber: BigInt(current.throughBlock) });
    if (checkpoint.hash !== current.throughHash) current = null;
  }
  const from = current ? BigInt(current.fromBlock) : await firstBlock(client, s, target);
  let through = current ? BigInt(current.throughBlock) : from - 1n;
  let throughHash = current?.throughHash || "";
  const flows = new Map((current?.flows || []).map(flow => [flow.id, flow]));
  const pageLimit = Math.max(1, Math.min(8, Math.floor(maxPages)));
  for (let page = 0; page < pageLimit && through < target; page++) {
    const start = through + 1n, end = start + 1999n < target ? start + 1999n : target;
    // X Layer's public RPC accepts at most 100 blocks per eth_getLogs request.
    // Keep the logical checkpoint page at 2,000 blocks so historical catch-up
    // does not become 20x slower. Pace X Layer subranges to avoid public-RPC
    // rate limits: one range / two directional reads at a time, 500ms apart.
    // Every subrange must succeed before this page can advance its checkpoint.
    const rangeSize = s.network === "xlayer" ? 100n : 2000n;
    const ranges: Array<{ from: bigint; to: bigint }> = [];
    for (let from = start; from <= end; from += rangeSize) ranges.push({ from, to: from + rangeSize - 1n < end ? from + rangeSize - 1n : end });
    const request = (from: bigint, to: bigint, fromAddress: string | null, toAddress: string | null) => client.request({ method: "eth_getLogs", params: [{ fromBlock: toHex(from), toBlock: toHex(to), topics: [TRANSFER, fromAddress ? topic(fromAddress) : null, toAddress ? topic(toAddress) : null] }] });
    const raw: Awaited<ReturnType<typeof request>> = [];
    const concurrency = s.network === "xlayer" ? 1 : 4;
    for (let offset = 0; offset < ranges.length; offset += concurrency) {
      if (s.network === "xlayer" && offset > 0) await new Promise(resolve => setTimeout(resolve, 500));
      const batch = await Promise.allSettled(ranges.slice(offset, offset + concurrency).map(async ({ from, to }) => {
        // Settle both directions before returning, including on RPC failures.
        const results = await Promise.allSettled([request(from, to, null, s.vault), request(from, to, s.vault, null)]);
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
      }));
      const failure = batch.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      raw.push(...batch.flatMap(result => result.status === "fulfilled" ? result.value : []));
    }
    const pageFlows: RecoveredCashFlow[] = [];
    for (const entry of raw) {
      const log: ChainLog = { ...entry, blockNumber: entry.blockNumber == null ? null : BigInt(entry.blockNumber), logIndex: entry.logIndex == null ? null : Number(BigInt(entry.logIndex)) };
      const ownerFlow = decodeOwnerCashFlow(log, s);
      // External deposits of either portfolio asset are capital, not trading profit.
      // Unrelated spam tokens do not affect the portfolio valuation.
      const relevantToken = [s.settlementAsset, s.targetAsset].some(token => token?.toLowerCase() === log.address.toLowerCase());
      const flow = ownerFlow || (relevantToken ? decodeCashFlow(log, s, false) : null);
      if (!flow) continue;
      if (log.blockNumber! < start || log.blockNumber! > end) throw new Error("Provider returned a cash flow outside the requested range");
      const receipt = await client.getTransactionReceipt({ hash: flow.txHash as `0x${string}` });
      const matching = receipt.logs.find(item => item.logIndex === flow.logIndex && item.address.toLowerCase() === flow.token && item.data.toLowerCase() === log.data.toLowerCase() && item.topics.join(":").toLowerCase() === log.topics.join(":").toLowerCase());
      if (receipt.status !== "success" || receipt.blockHash !== log.blockHash || !matching || receipt.blockNumber !== log.blockNumber) throw new Error("Cash-flow receipt verification failed");
      if (!ownerFlow && receipt.logs.some(item => item.address.toLowerCase() === s.vault.toLowerCase() && EXECUTED.has(item.topics[0] as `0x${string}`))) continue;
      const block = await client.getBlock({ blockNumber: log.blockNumber! });
      if (block.hash !== log.blockHash) throw new Error("Cash-flow block changed during verification");
      pageFlows.push({ ...flow, createdAt: new Date(Number(block.timestamp) * 1000).toISOString() });
    }
    const endBlock = await client.getBlock({ blockNumber: end });
    if (!endBlock.hash) throw new Error("Cash-flow checkpoint block unavailable");
    for (const flow of pageFlows) flows.set(flow.id, flow);
    through = end; throughHash = endBlock.hash;
  }
  return { version: 1, identity: identity(s), fromBlock: String(from), throughBlock: String(through), throughHash, targetBlock: String(target), baselineSource: s.baselineBlockNumber ? "block" : "legacy_timestamp", flows: [...flows.values()].sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || a.logIndex - b.logIndex), updatedAt: new Date().toISOString() };
}

export function cashFlowCoverage(checkpoint: CashFlowCheckpoint | null, settlementAsset: string, now = Date.now()) {
  if (!checkpoint) return { state: "recovering" as const, progressPct: 0, detail: "Recovering vault deposits and withdrawals from chain receipts." };
  const from = BigInt(checkpoint.fromBlock), through = BigInt(checkpoint.throughBlock), target = BigInt(checkpoint.targetBlock);
  const progressPct = target >= from ? Math.min(100, Math.max(0, Number((through - from + 1n) * 100n / (target - from + 1n)))) : 0;
  if (!checkpoint.throughHash || through < target) return { state: "recovering" as const, progressPct, detail: "Historical cash-flow recovery is in progress; PnL waits for complete coverage." };
  if (now - Date.parse(checkpoint.updatedAt) > 10 * 60_000) return { state: "stale" as const, progressPct, detail: "Cash-flow recovery has not refreshed recently. PnL is unavailable until synchronization resumes." };
  if (checkpoint.flows.some(flow => flow.token.toLowerCase() !== settlementAsset.toLowerCase())) return { state: "unpriced_transfer" as const, progressPct, detail: "A non-settlement asset was deposited or withdrawn. Its historical value is not verified, so PnL is withheld." };
  return { state: "synced" as const, progressPct, detail: checkpoint.baselineSource === "legacy_timestamp" ? "Vault cash flows recovered through the checkpoint. Legacy starting value uses its original registration timestamp." : "Vault cash flows and starting balance are anchored to chain blocks." };
}

let running = false, offset = 0;
export async function runCashFlowRecoveryCycle(strategies: CashFlowStrategy[]) {
  if (running || !strategies.length) return;
  running = true;
  try {
    // Rotate through accounts independently from entry/exit scheduling, including paused vaults.
    for (let i = 0; i < Math.min(2, strategies.length); i++) {
      const s = strategies[offset++ % strategies.length], storageKey = key(s), leaseKey = `${storageKey}:lease`, lease = crypto.randomUUID();
      try {
        if (kvConfigured() && await runKvCommand(["SET", leaseKey, lease, "NX", "EX", 120], "cash-flow proof") !== "OK") continue;
        const before = await readCashFlowCheckpoint(s);
        // Leave time for paced public-RPC reads within the 120-second lease.
        const after = await recoverCashFlowPage(s, before, executionPublicClient(s.network), s.network === "xlayer" ? 2 : 4);
        if (kvConfigured()) {
          const saved = await runKvCommand(["EVAL", "if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[2]); redis.call('DEL', KEYS[2]); return 1", 2, storageKey, leaseKey, lease, JSON.stringify(after)], "cash-flow proof");
          if (Number(saved) !== 1) throw new Error("Cash-flow recovery lease expired before persistence");
        } else memory.set(storageKey, after);
      } catch { console.warn(`[cash-flow recovery] ${s.network} ${s.vault}: receipt/RPC/storage verification incomplete; keeping the previous checkpoint and retrying.`); }
      finally { if (kvConfigured()) await runKvCommand(["EVAL", "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, leaseKey, lease], "cash-flow proof").catch(() => undefined); }
    }
  } finally { running = false; }
}
