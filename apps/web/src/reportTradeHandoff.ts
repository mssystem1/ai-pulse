import type { ReportTradeIntent } from "./Report";

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
