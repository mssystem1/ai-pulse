export const AUTOPILOT_STRATEGY_HASH_KEY = "pulse:v6:autopilot:strategy-map";

type StrategyRecord = { id: string } & Record<string, unknown>;
type ExecutionActivity = {
  status?: string;
  source?: string;
  kind?: string;
  account?: string;
  txHash?: string;
  createdAt?: string;
};

const RUNTIME_FIELDS = [
  "lastRunAt",
  "lastDecision",
  "lastError",
  "lastTxHash",
  "evidenceUrl",
  "evidenceHash",
  "activeTakeProfit",
  "activeStopLoss",
  "exitPending",
  "lastRiskCheckAt",
  "evaluations",
  "updatedAt",
] as const;

function parseRecord(value: unknown): StrategyRecord | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && typeof (parsed as { id?: unknown }).id === "string"
      ? parsed as StrategyRecord
      : null;
  } catch {
    return null;
  }
}

/** Upstash REST may encode HGETALL as alternating entries or an object. */
export function decodeStrategyHash(raw: unknown): StrategyRecord[] {
  const values = Array.isArray(raw)
    ? raw.filter((_value, index) => index % 2 === 1)
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [];
  return values.map(parseRecord).filter((value): value is StrategyRecord => value !== null);
}

/**
 * A worker cycle may have started before the owner changed the policy. Only
 * worker-owned telemetry may be merged back; the latest signed configuration
 * always remains authoritative.
 */
export function mergeStrategyRuntime<T extends StrategyRecord>(current: T, incoming: T): T {
  if (
    typeof current.configurationHash === "string" &&
    incoming.configurationHash !== current.configurationHash
  ) {
    return current;
  }
  const currentUpdatedAt = Date.parse(typeof current.updatedAt === "string" ? current.updatedAt : "");
  const incomingUpdatedAt = Date.parse(typeof incoming.updatedAt === "string" ? incoming.updatedAt : "");
  if (
    Number.isFinite(currentUpdatedAt) &&
    Number.isFinite(incomingUpdatedAt) &&
    incomingUpdatedAt < currentUpdatedAt
  ) {
    return current;
  }
  const merged = { ...current } as T;
  for (const field of RUNTIME_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(incoming, field)) {
      if (field === "evaluations" && Array.isArray(current.evaluations) && Array.isArray(incoming.evaluations)) {
        const byId = new Map<string, Record<string, unknown>>();
        for (const evaluation of [...current.evaluations, ...incoming.evaluations]) {
          if (!evaluation || typeof evaluation !== "object") continue;
          const item = evaluation as Record<string, unknown>;
          const id = typeof item.id === "string" ? item.id : JSON.stringify(item);
          byId.set(id, item);
        }
        (merged as Record<string, unknown>)[field] = [...byId.values()]
          .sort((left, right) => Date.parse(String(left.evaluatedAt || "")) - Date.parse(String(right.evaluatedAt || "")))
          .slice(-100);
      } else {
        (merged as Record<string, unknown>)[field] = incoming[field];
      }
    } else {
      delete (merged as Record<string, unknown>)[field];
    }
  }
  return merged;
}

/**
 * Confirmed activity is the durable execution ledger. Use it to heal runtime
 * telemetry when a worker restarted or a stale concurrent risk cycle retained
 * an older partial-exit label after the vault had already closed on-chain.
 */
export function reconcileStrategyExecution<T extends StrategyRecord>(strategy: T, activity: readonly ExecutionActivity[], targetBalance: bigint): T {
  const vault = typeof strategy.vault === "string" ? strategy.vault.toLowerCase() : "";
  if (!vault) return strategy;
  const latest = activity
    .filter((item) => item.status === "confirmed"
      && item.source === "autopilot"
      && item.account?.toLowerCase() === vault
      && /^(buy_filled|sell_partial_filled|sell_filled)$/.test(item.kind || "")
      && typeof item.createdAt === "string")
    .sort((left, right) => Date.parse(right.createdAt!) - Date.parse(left.createdAt!))[0];
  if (!latest?.kind || !latest.createdAt) return strategy;

  const currentRunAt = Date.parse(typeof strategy.lastRunAt === "string" ? strategy.lastRunAt : "");
  const executionAt = Date.parse(latest.createdAt);
  const currentIsSameOrNewerExecution = strategy.lastDecision === latest.kind
    && Number.isFinite(currentRunAt)
    && currentRunAt >= executionAt;
  if (currentIsSameOrNewerExecution) return strategy;

  const reconciled = {
    ...strategy,
    lastDecision: latest.kind,
    lastRunAt: latest.createdAt,
    ...(latest.txHash ? { lastTxHash: latest.txHash } : {}),
  } as T;
  if (latest.kind === "sell_filled" && targetBalance === 0n) {
    (reconciled as Record<string, unknown>).exitPending = false;
    delete (reconciled as Record<string, unknown>).activeTakeProfit;
    delete (reconciled as Record<string, unknown>).activeStopLoss;
  } else if (latest.kind === "sell_partial_filled" && targetBalance > 0n) {
    (reconciled as Record<string, unknown>).exitPending = true;
  }
  return reconciled;
}
