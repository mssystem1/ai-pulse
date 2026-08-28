type StrategyMetric = {
  status: string;
  paused?: boolean;
  targetBalance?: string;
  portfolioValueAtomic?: string;
  baselineValueAtomic?: string;
  pnlAtomic?: string | null;
  activeTakeProfit?: number;
  activeStopLoss?: number;
  lastTxHash?: string;
  evaluations?: Array<{
    action: "buy" | "sell" | "hold";
    status: "held" | "filled" | "failed";
    txHash?: string;
  }>;
};

export function aggregateAutopilotMetrics(strategies: StrategyMetric[]) {
  let portfolioValueAtomic = 0n;
  let baselineValueAtomic = 0n;
  let pnlAtomic = 0n;
  let hasPortfolio = false;
  let hasPnl = false;

  for (const strategy of strategies) {
    try {
      if (strategy.portfolioValueAtomic && /^-?\d+$/.test(strategy.portfolioValueAtomic)) {
        portfolioValueAtomic += BigInt(strategy.portfolioValueAtomic);
        hasPortfolio = true;
      }
      if (strategy.baselineValueAtomic && /^\d+$/.test(strategy.baselineValueAtomic)) {
        baselineValueAtomic += BigInt(strategy.baselineValueAtomic);
      }
      if (strategy.pnlAtomic && /^-?\d+$/.test(strategy.pnlAtomic)) {
        pnlAtomic += BigInt(strategy.pnlAtomic);
        hasPnl = true;
      }
    } catch {
      // A malformed telemetry field must not make the whole dashboard unusable.
    }
  }

  return {
    portfolioValueAtomic: hasPortfolio ? portfolioValueAtomic.toString() : undefined,
    pnlAtomic: hasPnl ? pnlAtomic.toString() : undefined,
    pnlPct:
      hasPnl && baselineValueAtomic > 0n
        ? Number((pnlAtomic * 1_000_000n) / baselineValueAtomic) / 10_000
        : null,
  };
}

type ActivityMetric = {
  status: string;
  kind: string;
  txHash?: string;
};

export function hasProtectedAutopilotPosition(item: StrategyMetric) {
  if (item.status !== "active" || item.paused) return false;
  try {
    return BigInt(item.targetBalance || "0") > 0n
      && typeof item.activeTakeProfit === "number"
      && typeof item.activeStopLoss === "number";
  } catch {
    return false;
  }
}

export function countExecutedAutopilotFills(activity: ActivityMetric[], strategies: StrategyMetric[]) {
  const protectedEntries = new Set(
    strategies
      .filter(hasProtectedAutopilotPosition)
      .map((item) =>
        [...(item.evaluations || [])]
          .reverse()
          .find(
            (evaluation) =>
              evaluation.action === "buy" &&
              evaluation.status === "filled" &&
              evaluation.txHash,
          )?.txHash || item.lastTxHash,
      )
      .filter((hash): hash is string => Boolean(hash)),
  );
  return activity.filter((item) =>
    item.status === "confirmed"
    && (item.kind === "buy_filled" || item.kind === "sell_filled")
    && !(item.kind === "buy_filled" && item.txHash && protectedEntries.has(item.txHash)),
  ).length;
}

export function averageKnownPnl(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

export type BalanceAmountState =
  | "empty"
  | "balance_unavailable"
  | "insufficient"
  | "ready";

/** Fail-closed amount state shared by wallet-funded and vault-withdrawal UI. */
export function assessBalanceAmount(
  amountAtomic: string,
  availableAtomic: string | null | undefined,
): BalanceAmountState {
  if (!/^\d+$/.test(amountAtomic)) return "empty";
  try {
    const amount = BigInt(amountAtomic);
    if (amount <= 0n) return "empty";
    if (availableAtomic == null || !/^\d+$/.test(availableAtomic))
      return "balance_unavailable";
    return amount > BigInt(availableAtomic) ? "insufficient" : "ready";
  } catch {
    return "empty";
  }
}
