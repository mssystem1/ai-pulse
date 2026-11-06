import { candleCloseTime, GlobalAssessmentSchema, type GlobalAssessment, type GlobalCandle, type GlobalReport, type GlobalScenario } from "@pulse/schemas";
import type { SpotMarketContext } from "@pulse/market";
import { globalArtifactReference, globalContextRelation, globalFrameReference,globalSetupAdmission } from "@pulse/domain";
import { completedGlobalCandles, globalFrameEvidence, globalSma, globalWilderIndicators } from "./globalReport.js";
import { advanceGlobalScenario, applyGlobalScenario } from "./globalScenarioLifecycle.js";
import { globalEntryOpposition } from "./globalRouteObstacles.js";

const merged = (before: readonly GlobalCandle[], after: readonly GlobalCandle[]) => [...new Map([...before, ...after].map(c => [c.ts, c])).values()].sort((a, b) => a.ts - b.ts);
const revised = (before: readonly GlobalCandle[], after: readonly GlobalCandle[]) => after.some(c => {
  const old = before.find(o => o.ts === c.ts);
  return old && (["open", "high", "low", "close"] as const).some(k => old[k] !== c[k]);
});
function freshThrough(bars: readonly GlobalCandle[], timeframe: string, asOf: number, since?: number) {
  const last = bars.at(-1), closed = last ? candleCloseTime(last.ts, timeframe) : null;
  const next = closed === null ? null : candleCloseTime(closed, timeframe);
  if (!last || closed === null || next === null || asOf > next + 60_000) return false;
  const relevant = since === undefined ? bars.slice(-64) : bars.filter(c => (candleCloseTime(c.ts, timeframe) ?? 0) > since);
  if (since !== undefined && closed > since && (!relevant.length || relevant[0].ts > since)) return false;
  return !relevant.some((c, i) => i > 0 && candleCloseTime(relevant[i - 1].ts, timeframe) !== c.ts);
}

/** Recheck the saved v8 priced contract. No new strategy, source zone, stop or
 * target is selected here. Candle observations never stand in for order fills. */
export function assessGlobalScenarioReport(saved: GlobalReport, market: SpotMarketContext, context?: SpotMarketContext | null, entry?: SpotMarketContext | null): GlobalAssessment {
  const plan = saved.discretionaryPlan, policy = plan?.executionPolicy;
  if (!plan || plan.version !== "discretionary-plan-v8" || !policy) throw new Error("A saved v8 execution policy is required");
  const at = market.fetchedAt, asOf = Date.parse(at), published = Date.parse(saved.snapshot.observedAt);
  const identity = (source: SpotMarketContext | null | undefined, timeframe: string) => !!source && source.instId === saved.snapshot.instId && source.bar === timeframe && source.source === saved.snapshot.source && (source.ticker.priceCurrency ?? source.instId.split("-").at(-1)) === saved.snapshot.priceCurrency;
  if (!identity(market, saved.snapshot.timeframe)) throw new Error("Recheck market identity does not match the purchased report");
  if (!Number.isFinite(asOf) || asOf < published) throw new Error("Recheck evidence predates the saved report");
  const initialReport = structuredClone(saved), initial = saved.scenario ?? applyGlobalScenario(initialReport);
  if (!initial) throw new Error("The saved execution policy has no research scenario");
  const definition = initial.definition, timeframe = definition.eventTimeframe;
  const source = identity(market, timeframe) ? market : entry;
  const validEntry = identity(source, timeframe) && Date.parse(source!.fetchedAt) <= asOf;
  const currentPrimary = completedGlobalCandles(market);
  const currentEntry = validEntry ? completedGlobalCandles({ ...source!, fetchedAt: at }) : [];
  const savedEntry = saved.entryStudy?.timeframe === timeframe ? saved.entryStudy.candles : saved.snapshot.timeframe === timeframe ? saved.candles : saved.currentMarket?.frames.find(f => f.timeframe === timeframe)?.candles ?? [];
  const primaryBars = merged(saved.candles, currentPrimary), eventBars = merged(savedEntry, currentEntry);
  const last = currentEntry.at(-1), closed = last ? candleCloseTime(last.ts, timeframe) : null;
  const next = closed === null ? null : candleCloseTime(closed, timeframe);
  const blockers: string[] = [], lines: string[] = [], zh = saved.lang === "zh";
  const price = (n: number) => n.toLocaleString(zh ? "zh-CN" : "en-US", { maximumFractionDigits: saved.snapshot.pricePrecision });
  if (!validEntry || !freshThrough(currentEntry, timeframe, asOf) || !freshThrough(eventBars, timeframe, asOf, initial.updatedAt) || !freshThrough(currentPrimary, market.bar, asOf) || !freshThrough(primaryBars, market.bar, asOf, initial.updatedAt)) blockers.push("history");
  if (revised(saved.candles, currentPrimary) || revised(savedEntry, currentEntry)) blockers.push("source_revised");
  const report = structuredClone(saved);
  report.snapshot = { ...report.snapshot, observedAt: at, lastCandleTs: currentPrimary.at(-1)?.ts ?? null, price: currentPrimary.at(-1)?.close ?? null };
  report.candles = primaryBars;
  report.entryStudy = { timeframe, source: validEntry ? source!.source : null, status: validEntry ? "available" : "unavailable", observedAt: at, candles: eventBars, pivots: saved.entryStudy?.pivots ?? [], atr: globalWilderIndicators(eventBars).atr };
  const expectedContext = saved.context.timeframe;
  if (expectedContext && identity(context, expectedContext) && Date.parse(context!.fetchedAt) <= asOf) {
    const bars = completedGlobalCandles({ ...context!, fetchedAt: at }), frame = globalFrameEvidence(context!, at);
    report.context = { ...saved.context, status: freshThrough(bars, expectedContext, asOf) ? frame.status : "unavailable", agreement: frame.bias === "up" ? "supports" : frame.bias === "down" ? "conflicts" : "neutral", candles: bars, sma55: globalSma(bars, 55) };
    report.hierarchy = [...(saved.hierarchy ?? []).filter(f => f.timeframe !== expectedContext), frame];
  } else report.context = { ...saved.context, status: "unavailable", agreement: "unknown" };
  const relation = globalContextRelation(report, definition.side);
  if (relation === "unavailable" || relation === "opposing") blockers.push("context");
  const opposing = globalEntryOpposition(report, definition.side, { lower: definition.entryZone[0], upper: definition.entryZone[1] });
  if (opposing.length) blockers.push("opposing_zone_overlap");
  const quote = market.ticker.last, quoteAt = Number(market.ticker.ts);
  // The geometry gate must see this recheck's quote, never the old quote saved
  // with the purchased report. It does not rewrite the saved report itself.
  if(Number.isFinite(quote)&&quote>0&&Number.isFinite(quoteAt)&&quoteAt<=asOf+5000&&asOf-quoteAt<=60000)report.currentMarket={...(report.currentMarket??{source:market.source,frames:[]}),quote:{price:quote,ts:quoteAt}};
  const admission=globalSetupAdmission(report);
  if(admission.blockers.includes("reward"))blockers.push("reward");
  if(admission.blockers.includes("geometry"))blockers.push("levels");
  if(admission.blockers.includes("objective_already_reached"))blockers.push("objective_already_reached");
  // Match report capture's bounded exchange-clock tolerance. A genuine quote
  // a few milliseconds ahead is not a future completed candle or a stale tick.
  const freshQuote = Number.isFinite(quote) && quote > 0 && Number.isFinite(quoteAt) && quoteAt <= asOf + 5_000 && asOf - quoteAt <= 60_000;
  if (!freshQuote) blockers.push("quote");
  const inEntry = freshQuote && quote >= definition.entryZone[0] && quote <= definition.entryZone[1];
  if (freshQuote && !inEntry) blockers.push("entry_price");
  // Never persist a replay cursor beyond unknown or revised candles. A later
  // complete request must still inspect that interval, rather than skip it.
  const integrity = blockers.some(b => b === "history" || b === "source_revised");
  let scenario: GlobalScenario | undefined;
  if (!integrity) scenario = applyGlobalScenario(report, initial) ?? undefined;
  const assessed = scenario ?? advanceGlobalScenario(definition, initial, [], asOf);
  let state: GlobalAssessment["state"];
  if (assessed.state === "invalidated") { state = "invalidated"; blockers.push(assessed.reason ?? "invalidated"); }
  else if (assessed.state === "expired") { state = "expired"; blockers.push(assessed.reason ?? "expired"); }
  else if (assessed.state === "completed") { state = "no_trade"; blockers.push("scenario_completed"); }
  else if (assessed.state === "entry_observed") { state = "no_trade"; blockers.push("entry_already_observed", "observation_only"); }
  else if (integrity || blockers.includes("context") || blockers.includes("quote") || blockers.includes("opposing_zone_overlap") || blockers.includes("reward") || blockers.includes("levels") || blockers.includes("objective_already_reached")) state = "no_trade";
  else if (definition.mode === "passive_limit") state = "waiting_retest";
  else if (assessed.state === "confirmed_awaiting_fill") state = inEntry ? "technical_valid" : "waiting_retest";
  else state = "waiting_confirmation";
  const sign = definition.side === "long" ? 1 : -1, worst = definition.side === "long" ? definition.entryZone[1] : definition.entryZone[0];
  const targets = definition.targets.map(t => definition.side === "long" ? t.lower : t.upper), distance = Math.abs(worst - definition.hardStop);
  const rewardRisk = sign * (targets[0] - worst) / distance;
  const firstObstacle = plan.barriers.filter(b => sign * (b.price - worst) > 0 && sign * (targets[0] - b.price) > 0).sort((a, b) => sign * (a.price - b.price))[0]?.price ?? targets[0];
  const firstObstacleRewardRisk = admission.firstObstacleRewardRisk??(opposing.length ? 0 : sign * (firstObstacle - worst) / distance);
  const agreement: GlobalAssessment["context"] = relation === "aligned" ? "supports" : relation === "opposing" ? "conflicts" : relation === "mixed" ? "neutral" : "unknown";
  const retestDeadline = assessed.confirmationAt === undefined ? null : assessed.confirmationAt + definition.fillWindowMs;
  const entryDeadline = Math.min(definition.expiresAt, retestDeadline ?? definition.expiresAt);
  lines.push(zh ? `按原执行规则于 ${at} 复核；主图 ${globalFrameReference(saved.snapshot.timeframe)}，入场证据 ${globalFrameReference(timeframe)}。` : `Rechecked the saved execution policy at ${at}; analysis ${globalFrameReference(saved.snapshot.timeframe)}, entry evidence ${globalFrameReference(timeframe)}.`);
  lines.push(zh ? `入场截止：${new Date(entryDeadline).toISOString()}；整体计划截止：${new Date(definition.expiresAt).toISOString()}。` : `Entry deadline: ${new Date(entryDeadline).toISOString()}; overall setup expiry: ${new Date(definition.expiresAt).toISOString()}.`);
  lines.push(`${definition.side === "long" ? "LONG" : "SHORT"} Entry ${price(definition.entryZone[0])}–${price(definition.entryZone[1])}; Hard SL ${price(definition.hardStop)}; ${targets.map((n, i) => `TP${i + 1} ${price(n)}`).join(" → ")}.`);
  if (definition.mode === "passive_limit") lines.push(zh ? "被动限价计划使用原入场区域，不借用后续确认；区域内报价仍需人工审核订单。" : "The passive limit plan uses its saved entry region and does not borrow later confirmation. A quote in this region still requires manual order review.");
  else lines.push(assessed.confirmationAt === undefined ? (zh ? "等待原边界上的接纳与受保护回测；当前报价不会改变方向。" : "Await acceptance and a defended retest at the saved boundary; a changing quote does not switch direction.") : (zh ? `原确认保留于 ${new Date(assessed.confirmationAt).toISOString()}；确认收盘不是成交。` : `The original confirmation at ${new Date(assessed.confirmationAt).toISOString()} is retained; its close is not a fill.`));
  if (!inEntry && freshQuote) lines.push(zh ? `当前报价 ${price(quote)} 不在原入场区域，不追价。` : `The current quote ${price(quote)} is outside the saved entry region; no chase entry is inferred.`);
  if (assessed.state === "entry_observed" || assessed.state === "completed") lines.push(zh ? "K线仅记录价格路径，不能证明实际成交或盈亏；此情景不再作为新的入场信号。" : "Candles record a price path, not an exchange fill or realized PnL. This scenario is not a fresh entry signal.");
  if (assessed.state === "invalidated" || assessed.state === "expired") lines.push(zh ? `此情景已结束（${assessed.reason ?? assessed.state}）；复核不会重置事件时钟。` : `This scenario ended (${assessed.reason ?? assessed.state}); rechecking does not reset its event clock.`);
  if (integrity) lines.push(zh ? "历史数据不完整、过期或被修订；不推进情景记录，避免跳过未知价格路径。" : "History is incomplete, stale or revised. The scenario cursor is not advanced across an unknown price path.");
  if (blockers.includes("context")) lines.push(zh ? "高周期背景缺失或与此方向相反；原价格计划保留，入场授权受阻。" : "Higher-timeframe context is unavailable or opposing; the saved prices remain intact and entry authorization is blocked.");
  if (opposing.length) lines.push(zh ? "原入场区域与主周期反向区域重叠；价格回测本身不证明已突破该区域，不能授权入场。" : "The saved Entry overlaps primary-timeframe opposition. A price retest alone does not prove acceptance through that zone and cannot authorize entry.");
  if(blockers.includes("reward"))lines.push(zh?`最近障碍仅提供 ${firstObstacleRewardRisk.toFixed(2)}R；本计划的最低要求为 ${admission.minimumRewardRisk.toFixed(2)}R。已观察的价格确认不能弥补不足的收益空间；需要新的有依据结构。`:`The nearest opposing level offers only ${firstObstacleRewardRisk.toFixed(2)}R; this saved policy requires ${admission.minimumRewardRisk.toFixed(2)}R. An observed price confirmation cannot repair insufficient reward; a new supported structure is required.`);
  if(blockers.includes("objective_already_reached"))lines.push(zh?"当前报价已到达或越过原首目标区域；不能通过改用更远的目标来重新授权本次入场。":"The current quote has reached or passed the saved first target area. A farther target cannot make this a fresh entry opportunity.");
  if (blockers.includes("quote")) lines.push(zh ? "需要更新的同市场报价，不能用旧收盘替代当前报价。" : "A fresh quote from the same market is required; an old close does not replace the current quote.");
  if (next !== null && next > asOf) lines.push(zh ? `下一根 ${globalFrameReference(timeframe)} 收盘：${new Date(next).toISOString()}。` : `Next ${globalFrameReference(timeframe)} close: ${new Date(next).toISOString()}.`);
  const atr = globalWilderIndicators(primaryBars).atr.at(-1)?.value;
  return GlobalAssessmentSchema.parse({
    version: "pulse-global-assessment-v1", sourceRef: globalArtifactReference(saved), sourceObservedAt: saved.snapshot.observedAt, assessedAt: at,
    instId: saved.snapshot.instId, priceCurrency: saved.snapshot.priceCurrency, timeframe: saved.snapshot.timeframe, analysisTimeframe: saved.snapshot.timeframe,
    entryTimeframe: timeframe, family: definition.family, strategyId: definition.policyId, pathId: null, state, side: definition.side,
    lastCompletedClose: last?.close ?? null, lastCompletedAt: closed, confirmationTs: assessed.confirmationAt ?? null,
    retestTs: assessed.events.find(e => e.kind === "confirmation" && e.at === assessed.confirmationAt)?.candleTs ?? null,
    retestDeadline, expiresAt: entryDeadline,
    permittedEntry: state === "technical_valid" ? definition.entryZone : null, observedStop: state === "technical_valid" ? definition.hardStop : null,
    targets, grossRewardRisk: rewardRisk, firstObstacleRewardRisk, checkpointTargets: plan.barriers.map(b => b.price),
    stopDistancePercent: distance / worst * 100, stopDistanceAtr: atr ? distance / atr : null,
    context: agreement, blockers: [...new Set(blockers)], lines, ...(scenario ? { scenario } : {}),
  });
}
