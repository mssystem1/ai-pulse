import type { ReportTradeIntent } from "./Report";

export function buildReportBuyIntent(data: Record<string, unknown>, orderType: "market" | "limit"): ReportTradeIntent {
  const analysis = (data.analysis || {}) as Record<string, unknown>;
  const plan = (data.executionPlan || {}) as Record<string, unknown>;
  const buy = (plan.buy || {}) as Record<string, unknown>;
  const recommendation = (plan.recommendation || {}) as Record<string, unknown>;
  const entryPrice = Number(buy.trigger), takeProfit = Number(buy.takeProfit), stopLoss = Number(buy.stopLoss);
  const valid = [entryPrice, takeProfit, stopLoss].every(Number.isFinite) && stopLoss > 0 && stopLoss < entryPrice && takeProfit > entryPrice;
  const recommended = recommendation.action === "buy" && Number(analysis.confidence) > 60;
  return { pair: String(plan.pair || data.instId || ""), timeframe: String(plan.timeframe || data.timeframe || ""), side: "buy", orderType,
    observedPrice: Number(plan.observedPrice), ...(valid ? { entryPrice, takeProfit, stopLoss } : {}),
    rationale: recommended ? String(buy.scenario || recommendation.reason || "Report buy setup")
      : `Manual trade selected with risk acceptance. Report context: ${String(analysis.bias || "unknown")}, ${String(analysis.confidence ?? "unknown")}% confidence. ${valid ? "Valid trigger, TP and SL are loaded for your review and wallet approval." : "The report has no valid long protection setup. Configure entry and protection yourself."}`,
    sourceTier: String(data.tier || data.service || "").toLowerCase() };
}

/** Preserve report distances, not nominal prices of a different representation. */
export function rebaseReportTrade(intent: ReportTradeIntent, pair: string, executionPrice: number): ReportTradeIntent {
  const reference = intent.observedPrice;
  if (!reference || !Number.isFinite(reference) || reference <= 0 || !Number.isFinite(executionPrice) || executionPrice <= 0)
    throw new Error("A fresh token price and the report's reference price are required to convert its order levels.");
  const scale = executionPrice / reference;
  const convert = (value: number | undefined) => {
    if (value === undefined) return undefined;
    const converted = value * scale;
    if (!Number.isFinite(converted) || converted <= 0) throw new Error("The report contains an invalid order level.");
    return Number(converted.toPrecision(12));
  };
  return { ...intent, pair, observedPrice: executionPrice,
    entryPrice: convert(intent.entryPrice), takeProfit: convert(intent.takeProfit), stopLoss: convert(intent.stopLoss),
    downsideReference: convert(intent.downsideReference),
    rationale: `Rebased from ${intent.pair} to this token's current USDG price. Entry, TP and SL preserve the report's percentage distances from its reference price; these are adjusted levels, not the original research prices. Review before signing. ${intent.rationale}` };
}
