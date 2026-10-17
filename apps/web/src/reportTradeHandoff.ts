import type { ReportTradeIntent } from "./Report";
import { readGlobalReport, globalTradePlan, globalDecision } from "@pulse/domain";

export function buildReportBuyIntent(data: Record<string, unknown>, orderType: "market" | "limit"): ReportTradeIntent {
  const global = readGlobalReport(data);
  if (global) {
    const s = global.setup, target = global.levels.find(l => l.id === s.targetIds[0])?.price;
    if (globalDecision(global).currentAction!=="BUY" || s.state !== "ready" || !s.expiresAt || Date.now() >= s.expiresAt || !s.entryZone || s.protectiveStop === null || !target || s.netRewardRisk === null || s.netRewardRisk < 1.5)
      throw new Error("This saved setup is not ready. Fresh confirmation, protection and execution costs are required.");
    return { pair: global.snapshot.instId, timeframe: global.snapshot.timeframe, side: "buy", orderType, entryPrice: s.entryZone[1], observedPrice: global.snapshot.price ?? undefined, takeProfit: target, stopLoss: s.protectiveStop, rationale: "Observed report retest and protection. Recheck the current quote, costs and invalidation before wallet approval.", sourceTier: global.tier, reportSetupMode: "confirmed" };
  }
  if (data.version === "pulse-global-v3" || (data.global as Record<string, unknown> | undefined)?.version === "pulse-global-v3")
    throw new Error("This saved Global setup is invalid. Reopen a valid report before preparing an order.");
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

/** Explicit manual review preserves observed protection without upgrading
 * Watching to Ready or pricing an unobserved retest. */
export function buildReportManualBuyIntent(data: Record<string, unknown>, orderType: "market" | "limit"): ReportTradeIntent {
  const global=readGlobalReport(data);
  if (!global) {
    if (data.version === "pulse-global-v3" || (data.global as Record<string, unknown> | undefined)?.version === "pulse-global-v3") throw new Error("This saved Global setup is invalid. Reopen a valid report before preparing an order.");
    return {...buildReportBuyIntent(data,orderType),reportSetupMode:"manual"};
  }
  const s=global.setup,target=global.levels.find(l=>l.id===s.targetIds[0])?.price;
  const observed=["watching","ready"].includes(s.state) && s.expiresAt!==null && Date.now()<s.expiresAt && s.entryZone!==null && s.protectiveStop!==null && s.protectiveStop<s.entryZone[0] && target!==undefined && target>s.entryZone[1];
  return {pair:global.snapshot.instId,timeframe:global.snapshot.timeframe,side:"buy",orderType,observedPrice:global.snapshot.price??undefined,
    ...(observed?{entryPrice:s.entryZone![1],takeProfit:target,stopLoss:s.protectiveStop!}:{}),
    rationale:`Manual trade selected with risk acceptance. Saved report setup: ${s.state}. ${observed?"Observed entry, TP and SL are loaded for review; confirmation, execution costs and current conditions still require your checks.":"The report has no current confirmed protection to copy. Configure entry, TP and SL in Spot before signing."}`,
    sourceTier:global.tier,reportSetupMode:"manual"};
}
/** A bearish research plan can reduce owned Spot inventory. Its hypothetical
 * short TP/SL must not be attached to a Spot exit or inverted into a buy. */
export function buildReportSellIntent(data: Record<string,unknown>,orderType:"market"|"limit"):ReportTradeIntent {
  const report=readGlobalReport(data);
  if(!report)throw new Error("A valid Global report is required to prepare an owned Spot sell.");
  return {pair:report.snapshot.instId,timeframe:report.snapshot.timeframe,side:"sell",orderType,observedPrice:report.snapshot.price ?? undefined,sourceTier:report.tier,reportSetupMode:"manual",rationale:"Manual sell/reduce of owned Spot inventory, independently of the research direction. This ticket does not open a leveraged short or copy short TP/SL. Choose the quantity and current execution price before signing."};
}

/** Carry only the order-type choice; prices always come from the saved report. */
export function buildTelegramReportBuyIntent(data: Record<string, unknown>, fragment: string): ReportTradeIntent {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const orderType=params.get("orderType") === "market" ? "market" : "limit";
  if(params.get("side")==="sell")return buildReportSellIntent(data,orderType);
  return params.get("manual")==="1"?buildReportManualBuyIntent(data,orderType):buildReportBuyIntent(data,orderType);
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
