export const AUTOPILOT_STRATEGY_HASH_KEY = "pulse:v6:autopilot:strategy-map";

type StrategyRecord = { id: string } & Record<string, unknown>;
type ExecutionActivity = {
  status?: string;
  source?: string;
  kind?: string;
  account?: string;
  txHash?: string;
  createdAt?: string;
  amount?: string;
  fillPrice?: number;
};

export type AutopilotRuntimeState =
  | "running"
  | "paused"
  | "protecting_position"
  | "entry_pass_expired"
  | "entry_signals_exhausted"
  | "telemetry_unavailable"
  | "failed"
  | "inactive";

/**
 * Strategy registration and live vault state are deliberately separate. The
 * durable strategy may remain registered as `active` while its on-chain vault
 * is paused or while its prepaid entry entitlement has expired. Expose one
 * unambiguous effective state to dashboards and audit exports without
 * rewriting the owner's signed strategy configuration.
 */
export function deriveAutopilotRuntimeState(input: {
  configuredStatus?: string;
  paused: boolean;
  targetBalance: bigint;
  pass?: { expiresAt: string; pausedAt?: string; signalLimit: number; signalsUsed: number } | null;
  now?: number;
}): AutopilotRuntimeState {
  if (input.configuredStatus === "failed") return "failed";
  if (input.paused) return "paused";
  if (input.configuredStatus !== "active") return "inactive";
  const reference = input.pass?.pausedAt ? Date.parse(input.pass.pausedAt) : input.now ?? Date.now();
  const passActive = Boolean(input.pass && Number.isFinite(reference) && Date.parse(input.pass.expiresAt) > reference);
  if (input.targetBalance > 0n) return passActive ? "running" : "protecting_position";
  if (!passActive) return "entry_pass_expired";
  if (input.pass!.signalsUsed >= input.pass!.signalLimit) return "entry_signals_exhausted";
  return "running";
}

export function cashFlowAdjustedPnl(
  portfolioValueAtomic: bigint,
  baselineValueAtomic: bigint,
  activity: readonly ExecutionActivity[],
) {
  let contributionsAtomic = 0n;
  let withdrawalsAtomic = 0n;
  for (const item of activity) {
    if (item.status !== "confirmed" || !/^\d+$/.test(item.amount || "")) continue;
    if (item.kind === "vault_fund") contributionsAtomic += BigInt(item.amount!);
    if (item.kind === "vault_withdraw") withdrawalsAtomic += BigInt(item.amount!);
  }
  const netCashFlowAtomic = contributionsAtomic - withdrawalsAtomic;
  const pnlAtomic = portfolioValueAtomic - baselineValueAtomic - netCashFlowAtomic;
  // Withdrawals reduce capital still at risk, but they are not losses. Return
  // is measured against gross owner contributions so a nearly/full withdrawn
  // vault cannot turn harmless token dust into a misleading -100% reading.
  const pnlBasisAtomic = baselineValueAtomic + contributionsAtomic;
  return {
    contributionsAtomic,
    withdrawalsAtomic,
    netCashFlowAtomic,
    pnlAtomic: pnlBasisAtomic > 0n ? pnlAtomic : null,
    pnlBasisAtomic,
    pnlPct:
      pnlBasisAtomic > 0n
        ? Number((pnlAtomic * 1_000_000n) / pnlBasisAtomic) / 10_000
        : null,
  };
}

const RUNTIME_FIELDS = [
  "lastRunAt",
  "lastDecision",
  "lastError",
  "lastTxHash",
  "evidenceUrl",
  "evidenceHash",
  "activeTakeProfit",
  "activeStopLoss",
  "positionEntryPrice",
  "lastEntryPrice",
  "lastExitPrice",
  "realizedPositionPnlPct",
  "exitPending",
  "lastRiskCheckAt",
  "lastEvaluatedCandleTs",
  "lastAiSignalAt",
  "lastAiAttemptAt",
  "lastAiSignalCandleTs",
  "aiFailureStreak",
  "aiRetryAt",
  "aiSignalSource",
  "aiBudgetDay",
  "aiCallsToday",
  "aiActualCostTodayUsd",
  "aiReservedCostTodayUsd",
  "aiBudgetStatus",
  "aiNextEligibleAt",
  "evaluations",
  "evaluationCount",
  "holdCount",
  "filledBuyCount",
  "filledSellCount",
  "failureCount",
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
  const reconciled = (currentIsSameOrNewerExecution ? { ...strategy } : {
    ...strategy,
    lastDecision: latest.kind,
    lastRunAt: latest.createdAt,
    ...(latest.txHash ? { lastTxHash: latest.txHash } : {}),
  }) as T;
  const latestBuy = activity
    .filter((item) => item.status === "confirmed"
      && item.source === "autopilot"
      && item.account?.toLowerCase() === vault
      && item.kind === "buy_filled"
      && typeof item.fillPrice === "number"
      && typeof item.createdAt === "string")
    .sort((left, right) => Date.parse(right.createdAt!) - Date.parse(left.createdAt!))[0];
  if (latestBuy?.fillPrice) {
    (reconciled as Record<string, unknown>).lastEntryPrice = latestBuy.fillPrice;
    if (targetBalance > 0n) (reconciled as Record<string, unknown>).positionEntryPrice = latestBuy.fillPrice;
  }
  if (latest.kind === "sell_filled" && targetBalance === 0n) {
    (reconciled as Record<string, unknown>).exitPending = false;
    delete (reconciled as Record<string, unknown>).activeTakeProfit;
    delete (reconciled as Record<string, unknown>).activeStopLoss;
    delete (reconciled as Record<string, unknown>).positionEntryPrice;
    if (typeof latest.fillPrice === "number") {
      (reconciled as Record<string, unknown>).lastExitPrice = latest.fillPrice;
      if (latestBuy?.fillPrice) {
        (reconciled as Record<string, unknown>).realizedPositionPnlPct = ((latest.fillPrice - latestBuy.fillPrice) / latestBuy.fillPrice) * 100;
      }
    }
  } else if (latest.kind === "sell_partial_filled" && targetBalance > 0n) {
    (reconciled as Record<string, unknown>).exitPending = true;
  }
  return reconciled;
}
