import {globalTargetReference,globalHumanText} from "@pulse/domain";
import {applyGlobalTradeMap,applySingleGlobalSetup} from "./globalTradeMap.js";
import {applyGlobalStrategyMap,globalStrategyPivots} from "./globalStrategyMap.js";
import {globalStrategyProfile,globalWavePhase,globalDefaultChartLayers} from "@pulse/domain";
import { deriveGlobalTradePlan, selectGlobalTradePlan, globalPlanCandidates, globalDecision, globalContextRelation, globalConfirmationEvidence, globalSetupAttemptEvidence,globalPrimaryAttemptEvidence, globalLocalLevels, globalEligibility, globalRiskMeasurement, globalRemoteLevels, globalTradePlanTitle, globalTradePlanLines } from "@pulse/domain";
import { GlobalReportSchema, candleTimeframeMs, candleCloseTime, parseCandleTimeframe, type GlobalReport, type GlobalCandle, type GlobalAnchor, type GlobalLevel, type GlobalPath, type GlobalNarrative, type GlobalOrderFlow } from "@pulse/schemas";
import {globalEntryTimeframe} from "@pulse/domain";
import {globalPriceStructures,globalPriceRange} from "./globalStructures.js";
import {globalSetupEmas,globalSetupVwap,globalHorizonVwap} from "./globalSetupStudies.js";
import {applyGlobalHorizonContext} from "./globalHorizonContext.js";
import {applyGlobalDiscretionaryPlan} from "./globalDiscretionaryPlan.js";

export const GLOBAL_HISTORY_LIMIT = 520;
/** Preparation consumes completed candles and their identity, never a live
 * ticker. This also permits exact, network-free saved-snapshot reviews. */
export type GlobalPreparationMarket={instId:string;bar:string;source:string;fetchedAt:string;candles:ReadonlyArray<Omit<GlobalCandle,"confirmed">&{confirmed?:boolean}>;ticker:{priceCurrency?:string;last?:number;ts?:string};orderFlow?:GlobalOrderFlow};
type Point = { ts: number; value: number };
const rounded = (n: number) => Number(n.toPrecision(12));
export function globalBarMs(bar: string): number {
  return candleTimeframeMs(bar);
}
export function globalContextTimeframe(bar: string): string | null {
  const frame = parseCandleTimeframe(bar);
  if (frame?.unit === "week") return "1Mutc";
  const ms = globalBarMs(bar);
  return !ms ? null : ms < 900_000 ? "15m" : ms < 3_600_000 ? "1H" : ms < 14_400_000 ? "4H" : ms < 86_400_000 ? "1Dutc" : ms < 604_800_000 ? "1Wutc" : null;
}
export function completedGlobalCandles(market: Pick<GlobalPreparationMarket,"candles"|"bar"|"fetchedAt">): GlobalCandle[] {
  const observed = Date.parse(market.fetchedAt);
  return [...new Map(market.candles.filter(c => c.confirmed === true && [c.ts, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && c.ts >= 0 && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.volume >= 0
    && (!Number.isFinite(observed) || candleCloseTime(c.ts, market.bar) === null || candleCloseTime(c.ts, market.bar)! <= observed))
    .map(c => [c.ts, { ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, confirmed: true }])).values()]
    .sort((a, b) => a.ts - b.ts).slice(-GLOBAL_HISTORY_LIMIT);
}
export function globalSma(candles: readonly GlobalCandle[], period: number): Point[] {
  let sum = 0;
  return candles.flatMap((c, i) => { sum += c.close; if (i >= period) sum -= candles[i - period].close; return i >= period - 1 ? [{ ts: c.ts, value: rounded(sum / period) }] : []; });
}
export function globalWilderIndicators(candles: readonly GlobalCandle[]) {
  const atr: Point[] = [], rsi: Point[] = []; let averageTR = 0, gain = 0, loss = 0;
  candles.forEach((c, i) => {
    const previous = candles[i - 1], tr = previous ? Math.max(c.high - c.low, Math.abs(c.high - previous.close), Math.abs(c.low - previous.close)) : c.high - c.low;
    if (i < 14) averageTR += tr / 14; else averageTR = (averageTR * 13 + tr) / 14;
    if (i >= 13) atr.push({ ts: c.ts, value: rounded(averageTR) });
    if (previous) { const change = c.close - previous.close;
      if (i <= 14) { gain += Math.max(0, change) / 14; loss += Math.max(0, -change) / 14; }
      else { gain = (gain * 13 + Math.max(0, change)) / 14; loss = (loss * 13 + Math.max(0, -change)) / 14; }
      if (i >= 14) rsi.push({ ts: c.ts, value: rounded(gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)) });
    }
  });
  return { atr, rsi };
}
/** A pivot becomes observable only after its three right-hand bars close. */
export function globalConfirmedPivots(candles: readonly GlobalCandle[], minimumMove = 0): GlobalAnchor[] {
  const pivots: GlobalAnchor[] = [];
  for (let i = 3; i < candles.length - 3; i += 1) {
    const c = candles[i], around = candles.slice(i - 3, i + 4).filter((_, j) => j !== 3);
    const high = around.every(a => c.high > a.high), low = around.every(a => c.low < a.low);
    if (high === low) continue; // No arbitrary label for equal highs or an outside bar.
    const kind = high ? "high" : "low", price = high ? c.high : c.low;
    const anchor: GlobalAnchor = { id: `pivot-${c.ts}-${kind}`, ts: c.ts, price: rounded(price), kind, confirmedAt: candles[i + 3].ts };
    const prior = pivots.at(-1);
    if (prior?.kind === kind) { if (kind === "high" ? price > prior.price : price < prior.price) pivots[pivots.length - 1] = anchor; }
    else if (!prior || Math.abs(price - prior.price) >= minimumMove) pivots.push(anchor);
  }
  return pivots;
}
function waveCandidate(pivots: GlobalAnchor[]): GlobalReport["waveCount"] {
  const unclear: GlobalReport["waveCount"] = { id: "unclear", status: "unclear", structure: "unclear", direction: "unclear", degree: "minor", activeWave: "unclear", anchors: [], invalidationLevelId: null, validation: ["insufficient_validated_swings"] };
  const recent = pivots.slice(-24);
  let found: GlobalReport["waveCount"] | null = null;
  for (let i = 0; i + 5 < recent.length; i += 1) {
    const a = recent.slice(i, i + 6), up = a[0].kind === "low", sign = up ? 1 : -1, p = a.map(x => x.price * sign);
    if (!(p[1] > p[0] && p[2] > p[0] && p[2] < p[1] && p[3] > p[1] && p[4] > p[1] && p[4] < p[3] && p[5] > p[3])) continue;
    if (p[3] - p[2] < Math.min(p[1] - p[0], p[5] - p[4])) continue;
    const after = recent.slice(i + 6, i + 9), abc = after.length === 3 && after[0].kind !== a[5].kind && after[1].price * sign < p[5] && after[1].price * sign > after[0].price * sign && after[2].price * sign < after[0].price * sign;
    // Old completed impulses are useful anchors, not a claim that the last
    // candle is still in wave 5 after many unrelated swings.
    if (recent.length - (i + 6) > 3) continue;
    const partialCorrection = after.length > 0 && after.length < 3 && after[0].price * sign < p[5] && (after.length === 1 || after[1].price * sign > after[0].price * sign && after[1].price * sign < p[5]);
    if (after.length && !abc && !partialCorrection) continue;
    const selected = abc || partialCorrection ? [...a, ...after] : a;
    found = { id: `count-${a[0].ts}-${selected.at(-1)!.ts}`, status: "candidate", structure: abc ? "abc_correction" : "impulse", direction: up ? "up" : "down", degree: "minor",
      activeWave: abc ? "C?" : after.length === 2 ? "B?" : after.length === 1 ? "A?" : "5?", anchors: selected.map((x, j) => ({ ...x, label: ["0", "1", "2", "3", "4", "5", "A", "B", "C?"][j] })), invalidationLevelId: null,
      validation: ["wave_2_holds_origin", "wave_3_not_shortest", "wave_4_no_overlap", "alternating_confirmed_pivots", ...(abc ? ["candidate_abc_after_impulse"] : [])] };
  }
  if (found) return found;
  // A partial 1-2-3 hypothesis needs an actual origin and three alternating
  // swings. It does not claim that the unobserved 4/5 rules have passed.
  const a = recent.slice(-4);
  if (a.length === 4) { const up = a[0].kind === "low", sign = up ? 1 : -1, p = a.map(x => x.price * sign);
    if (p[1] > p[0] && p[2] > p[0] && p[2] < p[1] && p[3] > p[1]) return { id: `count-${a[0].ts}-${a[3].ts}`, status: "candidate", structure: "impulse", direction: up ? "up" : "down", degree: "minor", activeWave: "3?",
      anchors: a.map((x, i) => ({ ...x, label: String(i) })), invalidationLevelId: null, validation: ["wave_2_holds_origin", "alternating_confirmed_pivots", "partial_count_4_5_unobserved"] };
  }
  const two=recent.slice(-3);
  if(two.length===3){const up=two[0].kind==="low",sign=up?1:-1,p=two.map(a=>a.price*sign);
    if(p[1]>p[0]&&p[2]>p[0]&&p[2]<p[1])return {id:`count-${two[0].ts}-${two[2].ts}`,status:"candidate",structure:"impulse",direction:up?"up":"down",degree:"minor",activeWave:"2?",anchors:two.map((a,i)=>({...a,label:String(i)})),invalidationLevelId:null,validation:["wave_2_holds_origin","alternating_confirmed_pivots","partial_count_3_4_5_unobserved"]};
  }
  return unclear;
}
/** Search local swing scales instead of assigning every 3-bar fractal the same
 * wave degree. Each deviation uses ATR known when that pivot was confirmed. */
export function globalWaveCandidate(candles: GlobalCandle[], pivots: GlobalAnchor[], atr: Point[]): GlobalReport["waveCount"] {
  const atrAt = new Map(atr.map(p => [p.ts,p.value]));
  const candidates: GlobalReport["waveCount"][] = [];
  let originInvalidated=false;
  for (const scale of [0,1,2,3]) {
    const swings: GlobalAnchor[] = [];
    for (const anchor of pivots) {
      const prior = swings.at(-1);
      if (prior?.kind === anchor.kind) {if (anchor.kind === "high" ? anchor.price > prior.price : anchor.price < prior.price) swings[swings.length-1]=anchor;}
      else if (!prior || ((anchor.kind === "high" ? anchor.price > prior.price : anchor.price < prior.price) && Math.abs(anchor.price-prior.price) >= scale * (atrAt.get(anchor.confirmedAt!) ?? Infinity))) swings.push(anchor);
    }
    const candidate = waveCandidate(swings), origin = candidate.anchors[0];
    const invalid=origin&&candles.some(c=>c.ts>origin.ts&&(candidate.direction==="up"?c.low<=origin.price:c.high>=origin.price));
    if(invalid)originInvalidated=true;
    if (origin && !invalid) candidates.push({...candidate,degree:"local",swingScaleAtr:scale,validation:[...candidate.validation,"swing_pattern_only_subdivisions_unverified"]});
  }
  // Prefer recent validated anchors. A complete older pattern cannot hide a
  // current partial count; ties favor the larger, less noisy measured swings.
  candidates.sort((a,b) => b.anchors.at(-1)!.ts-a.anchors.at(-1)!.ts || (b.swingScaleAtr ?? 0)-(a.swingScaleAtr ?? 0));
  return candidates[0] ?? {...waveCandidate([]),degree:"local",validation:[originInvalidated?"origin_invalidated_by_completed_close":pivots.length>=4?"no_rule_compliant_recent_pattern":"insufficient_validated_swings","swing_pattern_only_subdivisions_unverified"]};
}
function regression(candles: GlobalCandle[]): GlobalReport["indicators"]["regression"] {
  if (candles.length < 120) return null;
  const c = candles.slice(-120), mean = c.reduce((s, x) => s + x.close, 0) / 120, xMean = 59.5;
  const slope = c.reduce((s, x, i) => s + (i - xMean) * (x.close - mean), 0) / c.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  const predicted = c.map((x, i) => ({ ts: x.ts, value: mean + slope * (i - xMean) }));
  const residualSigma = Math.sqrt(c.reduce((s, x, i) => s + (x.close - predicted[i].value) ** 2, 0) / 120);
  return { bars: 120, residualSigma: rounded(residualSigma), mid: predicted.map(x => ({ ...x, value: rounded(x.value) })), upper: predicted.map(x => ({ ...x, value: rounded(x.value + 2 * residualSigma) })), lower: predicted.map(x => ({ ...x, value: rounded(x.value - 2 * residualSigma) })) };
}
export function evaluateGlobalSetup(report: GlobalReport, costsBps: number | null): GlobalReport["setup"] {
  const path = report.paths.find(p => p.direction === "up" && p.state !== "cancelled");
  const empty: GlobalReport["setup"] = { state: "none", pathId: null, triggerLevelId: null, retestLevelId: null, invalidationLevelId: null, targetIds: [], entryZone: null, protectiveStop: null, grossRewardRisk: null, netRewardRisk: null, costsBps, confirmationTs: null, retestTs: null, expiresAt: null, missing: [] };
  if (!path || !path.triggerLevelId || !path.invalidationLevelId || !report.candles.length) return { ...empty, missing: report.candles.length ? ["targets"] : ["completed_history"] };
  const setup = { ...empty, state: "watching" as const, pathId: path.id, triggerLevelId: path.triggerLevelId, retestLevelId: path.triggerLevelId, invalidationLevelId: path.invalidationLevelId, targetIds: [...path.targetIds] };
  const level = (id: string) => report.levels.find(l => l.id === id)!;
  const trigger = level(path.triggerLevelId), floor = level(path.invalidationLevelId), candles = report.candles, last = candles.at(-1)!, interval = globalBarMs(report.snapshot.timeframe);
  if(last.close<floor.price)return {...setup,state:"cancelled"};
  const anchor = report.indicators.pivots.find(a => trigger.anchorIds.includes(a.id));
  if (!anchor?.confirmedAt) return { ...setup, missing: ["trigger", "retest"] };
  const evidence=globalConfirmationEvidence(report,{side:"long",condition:path.confirmation==="support_hold"?"support_hold":"close_retest",triggerLevelId:trigger.id,invalidationLevelId:floor.id});
  if(evidence.failure&&!evidence.confirmation)return {...setup,state:"cancelled",confirmationTs:evidence.failedConfirmation?.ts??null,expiresAt:evidence.failedConfirmation?evidence.failedConfirmation.ts+interval*4:null};
  const confirmationIndex = evidence.confirmation ? candles.indexOf(evidence.confirmation) : -1;
  if (confirmationIndex < 0) return { ...setup, missing: ["trigger", "retest", ...(path.targetIds.length ? [] : ["targets" as const])] };
  const confirmation = candles[confirmationIndex], expiry = evidence.expiresAt!;
  const confirmedSetup = { ...setup, confirmationTs: confirmation.ts, expiresAt: expiry };
  if (Number.isFinite(Date.parse(report.snapshot.observedAt)) && Date.parse(report.snapshot.observedAt) >= expiry) return { ...confirmedSetup, state: "expired" };
  const retest = evidence.retest;
  if (!retest) return { ...confirmedSetup, missing: ["retest"] };
  const atr = report.indicators.atr.points.find(p => p.ts === retest.ts)?.value;
  if (!atr) return { ...confirmedSetup, retestTs: retest.ts, missing: ["protection"] };
  const protectiveStop = rounded((report.evaluationVersion === "completed-v2" ? Math.min(retest.low,floor.price) : retest.low) - atr * .2), entryZone: [number, number] = [rounded(trigger.price), rounded(retest.close)];
  if (candles.some(c => c.ts > retest.ts && c.low <= protectiveStop)) return { ...confirmedSetup, state:"cancelled", retestTs:retest.ts };
  const target = report.levels.find(l => l.id === path.targetIds[0]);
  if (protectiveStop <= 0 || protectiveStop >= entryZone[0] || !target || target.price <= Math.max(entryZone[1], last.close)) return { ...confirmedSetup, retestTs: retest.ts, missing: ["reward"] };
  // Use the high end of the observed entry zone and the NEAREST obstacle.
  const risk = entryZone[1] - protectiveStop, reward = target.price - entryZone[1], cost = costsBps === null ? null : entryZone[1] * costsBps / 10_000;
  const grossRewardRisk = rounded(reward / risk), netRewardRisk = cost === null ? null : rounded(Math.max(0, reward - cost) / (risk + cost));
  const missing: GlobalReport["setup"]["missing"] = [];
  if (cost === null) missing.push("execution_costs");
  if (last.close < entryZone[0] || last.close > entryZone[1]) missing.push("entry_price");
  if (grossRewardRisk < 1.5 || (netRewardRisk !== null && netRewardRisk < 1.5)) missing.push("reward");
  if ((report.decisionVersion||report.tier==="pro")&&["opposing","unavailable"].includes(globalContextRelation(report,"long")))missing.push("context");
  return { ...confirmedSetup, state: missing.length ? "watching" : "ready", retestTs: retest.ts, entryZone, protectiveStop, grossRewardRisk, netRewardRisk, missing };
}

type FrameMetrics=Pick<NonNullable<GlobalReport["hierarchy"]>[number],"completedAt"|"price"|"sma55"|"smaChange"|"structure"|"bias"|"candles">;
// Cache only pure numeric evidence. The complete sanitized candle content and
// timeframe form the key; source identity, observation and freshness stay live.
// At most 64 bounded keys are retained, without keeping source objects alive.
const frameMetricsCache=new Map<string,FrameMetrics>();
function globalFrameMetrics(bars:GlobalCandle[],timeframe:string):FrameMetrics {
  const key=JSON.stringify([timeframe,bars.map(c=>[c.ts,c.open,c.high,c.low,c.close,c.volume])]),cached=frameMetricsCache.get(key);
  if(cached){frameMetricsCache.delete(key);frameMetricsCache.set(key,cached);return cached;}
  const mean=globalSma(bars,55),p=globalConfirmedPivots(bars).filter(p=>p.ts>=(bars.at(-64)?.ts??0)),hi=p.filter(p=>p.kind==="high").slice(-2),lo=p.filter(p=>p.kind==="low").slice(-2);
  const structure=hi.length===2&&lo.length===2?(hi[1].price>hi[0].price&&lo[1].price>lo[0].price?"up":hi[1].price<hi[0].price&&lo[1].price<lo[0].price?"down":"range"):"mixed";
  const price=bars.at(-1)?.close??null,sma55=mean.at(-1)?.value??null,smaChange=mean.length>10?mean.at(-1)!.value-mean.at(-11)!.value:null;
  const trend=price!==null&&sma55!==null&&smaChange!==null?(price>sma55&&smaChange>0?"up":price<sma55&&smaChange<0?"down":"mixed"):"mixed";
  const range=globalPriceRange(bars,p,globalWilderIndicators(bars).atr.at(-1)?.value??0,timeframe);
  const bias=range?"range":structure!=="mixed"&&structure!=="range"&&(trend===structure||trend==="mixed")?structure:"mixed";
  const completedAt=bars.length?candleCloseTime(bars.at(-1)!.ts,timeframe):null,metrics:FrameMetrics={completedAt,price,sma55,smaChange,structure,bias,candles:bars.length};
  if(key.length<=131072){frameMetricsCache.set(key,metrics);if(frameMetricsCache.size>64)frameMetricsCache.delete(frameMetricsCache.keys().next().value!);}
  return metrics;
}

export function globalFrameEvidence(source:Pick<GlobalPreparationMarket,"bar"|"source"|"fetchedAt"|"candles">,observedAt=source.fetchedAt):NonNullable<GlobalReport["hierarchy"]>[number] {
  const timeframe=source.bar,bars=completedGlobalCandles({...source,fetchedAt:observedAt}),{completedAt,price,sma55,smaChange,structure,bias}=globalFrameMetrics(bars,timeframe),next=completedAt===null?null:candleCloseTime(completedAt,timeframe);
  return {timeframe,status:bars.length>=55&&next!==null&&Date.parse(observedAt)<=next+60_000?"available":"unavailable",source:source.source,observedAt,completedAt,price,sma55,smaChange,structure,bias,candles:bars.length};
}

/** Calculate a saved market map before prompting. No generic TA fallback is used. */
export function prepareGlobalReport(input: { market: GlobalPreparationMarket; tier: "base" | "premium"; lang?: "en" | "zh"; contextMarket?: GlobalPreparationMarket | null; hierarchyMarkets?:GlobalPreparationMarket[]; executionCostsBps?: number; targetPolicy?:"active-zones-v1"|"legacy-pivots-v1"; retainCandidates?:boolean; decisionVersion?:"decision-v2"|"decision-v3"|"decision-v4"|"decision-v5" }): GlobalReport {
  const { market } = input, candles = completedGlobalCandles(market), last = candles.at(-1), close = last?.close ?? null, tier = input.tier === "premium" ? "pro" : "quick", lang = input.lang ?? "en";
  const cutoff=Date.parse(market.fetchedAt),quoteTs=Number(market.ticker.ts),quotePrice=market.ticker.last;
  const currentFrames=(input.hierarchyMarkets??[]).filter(m=>["5m","15m","1H"].includes(m.bar)&&m.instId===market.instId&&m.source===market.source&&(m.ticker.priceCurrency??m.instId.split("-").at(-1))===(market.ticker.priceCurrency??market.instId.split("-").at(-1))).flatMap(m=>{const rows=completedGlobalCandles({...m,fetchedAt:market.fetchedAt}).slice(-96),last=rows.at(-1),end=last?candleCloseTime(last.ts,m.bar):null,next=end===null?null:candleCloseTime(end,m.bar);return next!==null&&cutoff<=next+60000?[{timeframe:m.bar as "5m"|"15m"|"1H",candles:rows}]:[];});
  const quote=quotePrice!==undefined&&Number.isFinite(quotePrice)&&quotePrice>0&&Number.isSafeInteger(quoteTs)&&quoteTs>0&&quoteTs<=cutoff+5000&&cutoff-quoteTs<=120000?{price:quotePrice,ts:quoteTs}:undefined;
  const { atr, rsi } = globalWilderIndicators(candles), latestAtr = atr.at(-1)?.value ?? (close ?? 1) * .01;
  // Pivot confirmation uses only local completed bars, not today's ATR applied
  // retrospectively to older swings.
  const decisionVersion=input.decisionVersion??(globalStrategyProfile(market.bar)?"decision-v5":"decision-v3");
  const activePolicy=decisionVersion==="decision-v5"&&input.targetPolicy!=="legacy-pivots-v1";
  const pivots = globalConfirmedPivots(candles), levels: GlobalLevel[] = [],strategyPivots=["decision-v4","decision-v5"].includes(decisionVersion)?globalStrategyPivots(candles,pivots,atr,market.bar):pivots;
  let waveCount = globalWaveCandidate(candles,strategyPivots,atr);
  if(["decision-v4","decision-v5"].includes(decisionVersion)&&waveCount.status==="candidate")waveCount.swingScaleAtr=Math.max(waveCount.swingScaleAtr??0,globalStrategyProfile(market.bar)!.majorSwingAtr);
  const origin=waveCount.anchors[0];
  if(origin&&candles.some(c=>c.ts>origin.ts&&(waveCount.direction==="up"?c.close<=origin.price:c.close>=origin.price)))waveCount={...waveCount,id:"unclear",status:"unclear",structure:"unclear",direction:"unclear",activeWave:"unclear",anchors:[],invalidationLevelId:null,validation:["origin_invalidated_by_completed_close"]};
  const addLevel = (anchor: GlobalAnchor, basis: GlobalLevel["basis"] = "swing", ratio?: number, anchors = [anchor.id]) => {
    const existing = levels.find(l => Math.abs(l.price - anchor.price) <= Math.max(latestAtr * .12, anchor.price * 1e-8));
    if (existing) { existing.anchorIds = [...new Set([...existing.anchorIds, ...anchors])]; return existing.id; }
    const id = basis === "swing" ? `level-${anchor.id}` : `level-${basis}-${anchors.join("-")}-${ratio}`;
    levels.push({ id, price: rounded(anchor.price), role: basis === "extension" ? "projection" : anchor.price <= (close ?? anchor.price) ? "support" : "resistance", basis, anchorIds: anchors, ...(ratio !== undefined ? { ratio } : {}) }); return id;
  };
  pivots.slice(-18).forEach(a => addLevel(a));
  if (candles.length) for (const kind of ["low", "high"] as const) { const c = candles.reduce((best, c) => kind === "low" ? c.low < best.low ? c : best : c.high > best.high ? c : best, candles[0]);
    addLevel({ id: `range-${c.ts}-${kind}`, ts: c.ts, price: c[kind], kind, confirmedAt: null }); }
  if (waveCount.anchors.length) waveCount.invalidationLevelId = addLevel(waveCount.anchors[0]);
  const leg = waveCount.anchors.length >= 6 ? [waveCount.anchors[0], waveCount.anchors[5]] : waveCount.anchors.length>=3 ? [waveCount.anchors[0],waveCount.anchors[waveCount.anchors.length===3?1:3]] : strategyPivots.length >= 2 ? strategyPivots.slice(-2) : [];
  const fibonacci: GlobalReport["indicators"]["fibonacci"] = [];
  if (leg.length === 2 && Math.abs(leg[1].price - leg[0].price) >= latestAtr * 2) {
    const [a, b] = leg, delta = b.price - a.price;
    for (const ratio of [0, .236, .382, .5, .618, .786, 1]) { const price = b.price - delta * ratio; if (price > 0) fibonacci.push({ ratio, price: rounded(price), anchorIds: [a.id, b.id] }); }
    // Extension levels are measured projections of an observed leg, not
    // fabricated support, a guaranteed wave target, or a liquidity claim.
    const correction=pivots.find(p=>p.ts>b.ts&&p.kind===a.kind);
    for (const ratio of [1.272, 1.618]) { const price = (correction?.price??a.price) + delta * ratio; if (price > 0) addLevel({ ...b, price: rounded(price) }, "extension", ratio, correction?[a.id,b.id,correction.id]:[a.id,b.id]); }
  }
  const sma = [21, 55, 89, 144, 233].map(period => ({ period, points: globalSma(candles, period) })), average = sma.find(s => s.period === 55)!.points;
  const slope = average.length >= 11 ? average.at(-1)!.value - average.at(-11)!.value : 0;

  const trend = decisionVersion==="decision-v2"?(close === null || !average.length ? "range" : close < average.at(-1)!.value && slope < 0 ? "down" : close > average.at(-1)!.value && slope > 0 ? "up" : "range"):globalFrameEvidence(market,market.fetchedAt).bias;
  const structures=globalPriceStructures(candles,pivots,latestAtr,market.bar);
  // A projection is explanatory evidence, not an automatically tested support
  // or resistance level. Entries and their first obstacles use price structure.
  const below = levels.filter(l => l.basis==="swing"&&close !== null && l.price < close).sort((a, b) => b.price - a.price), above = levels.filter(l => l.basis==="swing"&&close !== null && l.price > close).sort((a, b) => a.price - b.price);
  // A recently reclaimed swing remains the setup threshold even when it is
  // already below price. Its timestamp and confirmation must precede the break.
  const crossBars=candles.slice(activePolicy?-8:-4);
  const recentReclaimed = pivots.filter(a => a.kind === "high" && close !== null && a.price < close && a.confirmedAt !== null
    && crossBars.some((c,j)=>j>0&&c.ts>=(candleCloseTime(a.confirmedAt!,market.bar)??Infinity)&&crossBars[j-1].close<=a.price&&c.close>a.price)).at(-1);
  const recentBroken=activePolicy?pivots.filter(a=>a.kind==="low"&&close!==null&&a.price>close&&a.confirmedAt!==null&&crossBars.some((c,j)=>j>0&&c.ts>=(candleCloseTime(a.confirmedAt!,market.bar)??Infinity)&&crossBars[j-1].close>=a.price&&c.close<a.price)).sort((a,b)=>a.price-b.price)[0]:undefined;
  const triggerUp = recentReclaimed ? levels.find(l => l.anchorIds.includes(recentReclaimed.id)) : above[0];
  const localAbove=globalLocalLevels(above,close??0,latestAtr),localBelow=globalLocalLevels(below,close??0,latestAtr);
  const floor = below.find(l => l.price < (triggerUp?.price ?? close ?? 0)), materialAbove=localAbove, upTargets = materialAbove.filter(l => l.id !== triggerUp?.id && l.price > (triggerUp?.price ?? 0)).slice(0, 2);
  const paths: GlobalPath[] = [];
  if (triggerUp && floor && upTargets.length) paths.push({ id: "recovery", role: trend === "up" ? "main" : "alternative", direction: "up", kind: trend === "up" ? "continuation" : "recovery", state: "conditional", triggerLevelId: triggerUp.id, targetIds: upTargets.map(l => l.id), invalidationLevelId: floor.id, confirmation: "close_retest", thesis: "" });
  // A rising market with one overhead obstacle can still have a support-hold
  // plan. Do not manufacture a breakout target beyond the known resistance.
  if (!paths.some(p=>p.direction==="up") && trend==="up" && below.length>=2 && materialAbove.length) paths.push({id:"pullback",role:"main",direction:"up",kind:"pullback",state:"conditional",triggerLevelId:below[0].id,targetIds:materialAbove.slice(0,2).map(l=>l.id),invalidationLevelId:below[1].id,confirmation:"support_hold",thesis:""});
  const downTargets=(trend==="down"||recentBroken?localBelow:localBelow.slice(1)).slice(0,2),brokenLevel=recentBroken?levels.find(l=>l.anchorIds.includes(recentBroken.id)):undefined;
  if (downTargets.length && above.length) paths.push({ id: "correction", role: trend === "down" ? "main" : "alternative", direction: "down", kind: "correction", state: trend === "down" ? "active" : "conditional", triggerLevelId: brokenLevel?.id??(trend === "down" ? above[0].id : below[0].id), targetIds: downTargets.map(l => l.id), invalidationLevelId: above.find(l=>!brokenLevel||l.price>brokenLevel.price)?.id??above[0].id, confirmation: recentBroken?"close_retest":trend === "down" ? "hold" : "close_retest", thesis: "" });
  if(tier==="pro"){const down=paths.find(p=>p.direction==="down"),deep=down?.targetIds.at(-1),threshold=levels.find(l=>l.id===deep),stress=threshold?localBelow.find(l=>l.price<threshold.price):null;if(down&&threshold&&stress)down.stress={triggerLevelId:threshold.id,targetIds:[stress.id]};}
  if (structures.range){
    const lows=pivots.filter(p=>structures.range!.anchorIds.includes(p.id)&&p.kind==="low"),highs=pivots.filter(p=>structures.range!.anchorIds.includes(p.id)&&p.kind==="high");
    // Preserve the measured zone edges exactly. ATR-based display clustering
    // must not silently move the range boundary to a nearby swing price.
    const lowId="range-support",highId="range-resistance";
    levels.push({id:lowId,price:rounded(structures.range.lower[1]),role:"support",basis:"swing",anchorIds:lows.map(p=>p.id)},{id:highId,price:rounded(structures.range.upper[0]),role:"resistance",basis:"swing",anchorIds:highs.map(p=>p.id)});
    paths.forEach(p=>p.role="alternative");paths.unshift({id:"range",role:"main",direction:"range",kind:"range",state:"active",triggerLevelId:lowId,targetIds:[highId],invalidationLevelId:lowId,confirmation:"hold",thesis:""});
  }
  // Mixed structure has no directional priority. The main role is only a
  // serialization/display slot; consumers use the evidenced market bias.
  if (!paths.some(p => p.role === "main") && paths.length) (decisionVersion==="decision-v2"?paths[0]:paths.find(p=>p.direction==="down")??paths[0]).role = "main";
  paths.sort((a, b) => Number(b.role === "main") - Number(a.role === "main"));
  if (!["decision-v4","decision-v5"].includes(decisionVersion) && paths.length < 3 && paths.some(p => p.direction === "up") && upTargets.length === 2) {
    const target = upTargets.at(-1)!, further = localAbove.filter(l => l.price > target.price).slice(0, 2);
    if (further.length) paths.push({ id: "recount", role: "alternative", direction: "up", kind: "recount", state: "conditional", triggerLevelId: target.id, targetIds: further.map(l => l.id), invalidationLevelId: target.id, confirmation: "close_retest", thesis: "" });
  }
  const contextFrame = globalContextTimeframe(market.bar), contextCandles = input.contextMarket && input.contextMarket.instId === market.instId && input.contextMarket.source === market.source && input.contextMarket.bar === contextFrame && (input.contextMarket.ticker.priceCurrency ?? market.instId.split("-").at(-1)) === (market.ticker.priceCurrency ?? market.instId.split("-").at(-1)) ? completedGlobalCandles({ ...input.contextMarket, fetchedAt: market.fetchedAt }) : [];
  const contextAverage = globalSma(contextCandles, 55), contextClose = contextCandles.at(-1)?.close, contextSma = contextAverage.at(-1)?.value;
  const vwapAnchor = waveCount.anchors[0] ?? pivots.at(-2), vwap=decisionVersion==="decision-v5"&&input.targetPolicy!=="legacy-pivots-v1"?globalHorizonVwap(candles,pivots,market.bar):globalSetupVwap(candles,vwapAnchor,market.bar);
  const lowAnchors = pivots.filter(a => a.kind === "low").slice(-2), highAnchors = pivots.filter(a => a.kind === "high").slice(-2);
  const precedingVolume = candles.slice(-21, -1), meanVolume = precedingVolume.length === 20 ? precedingVolume.reduce((s, c) => s + c.volume, 0) / 20 : 0;
  const hierarchyFrames=[...new Set(["1Wutc","1Dutc","4H","1H",market.bar,...(contextFrame?[contextFrame]:[])])];
  const hierarchy=hierarchyFrames.map<NonNullable<GlobalReport["hierarchy"]>[number]>(timeframe=>{
    const source=[market,...(input.hierarchyMarkets??[]),...(input.contextMarket?[input.contextMarket]:[])].find(m=>m.bar===timeframe&&m.instId===market.instId&&m.source===market.source&&(m.ticker.priceCurrency??m.instId.split("-").at(-1))===(market.ticker.priceCurrency??market.instId.split("-").at(-1)));
    if(!source)return {timeframe,status:"unavailable" as const,source:null,observedAt:market.fetchedAt,completedAt:null,price:null,sma55:null,smaChange:null,structure:"mixed" as const,bias:"mixed" as const,candles:0};
    return globalFrameEvidence(source,market.fetchedAt);
  });
  const entryFrame=["decision-v4","decision-v5"].includes(decisionVersion)?globalStrategyProfile(market.bar)!.entryTimeframe:globalEntryTimeframe(market.bar),entrySource=[market,...(input.hierarchyMarkets??[])].find(m=>m.bar===entryFrame&&m.source===market.source&&m.instId===market.instId&&(m.ticker.priceCurrency??m.instId.split("-").at(-1))===(market.ticker.priceCurrency??market.instId.split("-").at(-1)));
  const entryBars=entrySource?completedGlobalCandles({...entrySource,fetchedAt:market.fetchedAt}):[],entryAtr=globalWilderIndicators(entryBars).atr;
  const entryClosed=entryBars.length?candleCloseTime(entryBars.at(-1)!.ts,entryFrame):null,entryNext=entryClosed===null?null:candleCloseTime(entryClosed,entryFrame);
  const entryStudy:NonNullable<GlobalReport["entryStudy"]>={timeframe:entryFrame,source:entrySource?.source??null,status:entryBars.length>=55&&entryNext!==null&&Date.parse(market.fetchedAt)<=entryNext+60000?"available":"unavailable",observedAt:market.fetchedAt,candles:entryBars,pivots:globalConfirmedPivots(entryBars),atr:entryAtr};
  const report: GlobalReport = {
    version: "pulse-global-v3", evaluationVersion: "completed-v2", tier, lang,
    decisionVersion,hierarchy,entryStudy,range:structures.range,
    snapshot: { instId: market.instId, timeframe: market.bar, source: market.source, venue: market.source === "okx-public-spot" ? "OKX Spot" : market.source === "okx-robinhood-dex" ? "Robinhood DEX" : "Arc DEX", priceCurrency: market.ticker.priceCurrency ?? market.instId.split("-").at(-1) ?? "Unknown", observedAt: market.fetchedAt, lastCandleTs: last?.ts ?? null, price: close,
      pricePrecision: close === null ? 2 : Math.min(10, Math.max(2, 4 - Math.floor(Math.log10(close)))), completedOnly: true },
    candles, levels, waveCount, paths: paths.slice(0, 3),...((quote||currentFrames.length)?{currentMarket:{source:market.source,...(quote?{quote}:{}),frames:currentFrames}}:{}),...(market.orderFlow?{orderFlow:structuredClone(market.orderFlow)}:{}),
    setup: { state: "none", pathId: null, triggerLevelId: null, retestLevelId: null, invalidationLevelId: null, targetIds: [], entryZone: null, protectiveStop: null, grossRewardRisk: null, netRewardRisk: null, costsBps: null, confirmationTs: null, retestTs: null, expiresAt: null, missing: [] },
    indicators: { sma, ema:globalSetupEmas(candles,market.bar), atr: { period: 14, points: atr }, rsi: { period: 14, points: rsi }, volumeRatio: meanVolume > 0 && last ? rounded(last.volume / meanVolume) : null, regression: regression(candles), fibonacci, vwap, pivots, channel:null,channels:structures.channels },
    context: { timeframe: contextFrame, status: contextAverage.length ? "available" : "unavailable", source: contextAverage.length ? input.contextMarket!.source : null, candles:contextCandles,sma55:contextAverage,agreement:contextClose === undefined || contextSma === undefined ? "unknown" : contextClose < contextSma ? "conflicts" : contextClose > contextSma ? "supports" : "neutral" },
    narrative: { headline: "", summary: "", reasons: [], riskNotes: [], limitations: [], disclaimer: "" },
    view: { levelIds: [], pathIds: [], smaPeriods: tier==="pro"&&["decision-v3","decision-v4","decision-v5"].includes(decisionVersion)?[21,55,89,144,233]:[55], defaultLayers: tier === "pro" ? ["sma", "channel", "regression", "fibonacci", "rsi", "context"] : ["sma", "channel"] },
  };
  if(decisionVersion==="decision-v5"&&input.targetPolicy!=="legacy-pivots-v1")applyGlobalHorizonContext(report);
  if(decisionVersion==="decision-v4")applyGlobalStrategyMap(report);
  if(decisionVersion==="decision-v5")applyGlobalTradeMap(report,input.targetPolicy);
  const observedBias=hierarchy.find(r=>r.timeframe===market.bar)?.bias,marketMain=observedBias==="up"||observedBias==="down"?report.paths.find(p=>p.direction===observedBias):undefined;
  if(marketMain&&!report.range){report.paths.forEach(p=>p.role=p.id===marketMain.id?"main":"alternative");report.paths.sort((a,b)=>Number(b.role==="main")-Number(a.role==="main"));}
  // Structure-v2 has one directional calculator. The legacy buy-only setup
  // field stays empty; fresh authenticated review supplies observed protection.
  const includedPaths = report.paths.slice(0, tier === "quick" ? 2 : 3);
  // Quick must include its selected setup, not hide its corresponding path.
  const selected = report.paths.find(p => p.id === report.setup.pathId);
  if (selected && !includedPaths.includes(selected)) includedPaths[includedPaths.length - 1] = selected;
  report.view.pathIds = includedPaths.map(p => p.id);
  report.view.levelIds = [...new Set(includedPaths.flatMap(p => [p.triggerLevelId, p.invalidationLevelId, ...p.targetIds,...(p.stress?[p.stress.triggerLevelId,...p.stress.targetIds]:[])]).filter((id): id is string => id !== null))];
  if(report.strategy)report.view.levelIds=[...new Set([...report.view.levelIds,...report.strategy.routes.flatMap(r=>[r.protectionLevelId,...r.objectiveIds,...r.checkpointIds]).filter((id):id is string=>id!==null)])];
  if(decisionVersion==="decision-v5"&&report.strategy?.targetPolicy==="active-zones-v1"&&!input.retainCandidates)applySingleGlobalSetup(report);
  else report.tradePlan = selectGlobalTradePlan(report);
  applyGlobalDiscretionaryPlan(report);
  if(globalDefaultChartLayers(report).ema){
    report.view.smaPeriods=[];
    report.view.defaultLayers=["ema","volume",...(report.indicators.vwap?["vwap","vwapBands"]:[]),...(report.horizonContext||report.range?["range"]:[]),...(report.orderFlow?["volumeProfile"]:[]),...(report.orderFlow?.footprints.length?["footprint"]:[]),"rsi","context"];
  }
  const plan=report.tradePlan!;
  report.view.levelIds = [...new Set([...report.view.levelIds,plan.triggerLevelId,plan.invalidationLevelId,...plan.targetIds].filter((id):id is string=>id!==null))];
  return GlobalReportSchema.parse(report);
}

export function globalPromptEvidence(report: GlobalReport) {
  const f=report.orderFlow,orderFlow=f?{source:f.source,marketType:f.marketType,quantityUnit:f.quantityUnit,profile:{...f.profile,rows:undefined},recentFootprints:f.footprints.slice(-3).map(({rows,...bar})=>bar),restingOrderBook:false}:null;
  return { snapshot: report.snapshot,currentMarket:report.currentMarket?{...report.currentMarket,frames:report.currentMarket.frames.map(f=>({...f,candles:f.candles.slice(-12)}))}:null,decision:globalDecision(report),displayedSetup:report.discretionaryPlan?{...report.discretionaryPlan,targets:report.discretionaryPlan.targets.map((t,i)=>({...t,price:globalTargetReference(report,i),sourceReferencePrice:t.price,zone:report.discretionaryPlan!.priceZones?.targets[i]}))}:null,method:report.decisionVersion,strategy:report.strategy,setupSelection:report.setupSelection,wavePhase:globalWavePhase(report),range:report.range,horizonContext:report.horizonContext??null,orderFlow,channels:report.tier==="pro"?report.indicators.channels:report.indicators.channels?.filter(c=>c.scope==="broad"),entryStudy:report.entryStudy?{timeframe:report.entryStudy.timeframe,status:report.entryStudy.status,source:report.entryStudy.source,lastCompleted:report.entryStudy.candles.at(-1),atr14:report.entryStudy.atr.at(-1)?.value}:null,planCandidates:globalPlanCandidates(report),hierarchy:report.hierarchy, eligibility:globalEligibility(report),riskMeasurement:globalRiskMeasurement(report),distantContextLevelIds:globalRemoteLevels(report).map(l=>l.id), priceReference:{kind:"last_completed_close",price:report.snapshot.price,candleTs:report.snapshot.lastCandleTs,completedAt:report.snapshot.lastCandleTs===null?null:candleCloseTime(report.snapshot.lastCandleTs,report.snapshot.timeframe),liveQuote:false},waveCandidate: report.waveCount, levels: report.levels, paths: report.paths.filter(p => report.view.pathIds.includes(p.id)), setup: report.setup, setupAttemptEvidence:["decision-v2","decision-v3","decision-v4","decision-v5"].includes(report.decisionVersion??"")?null:globalSetupAttemptEvidence(report), tradePlan: report.tradePlan,primaryAttemptEvidence:["decision-v2","decision-v3","decision-v4","decision-v5"].includes(report.decisionVersion??"")?null:globalPrimaryAttemptEvidence(report),
    indicators: { ema:report.tier==="pro"?report.indicators.ema?.map(s=>({period:s.period,displayedByDefault:report.view.defaultLayers.includes("ema"),value:s.points.at(-1)?.value??null})):undefined, anchoredVwap:report.tier==="pro"&&report.indicators.vwap?{anchorTs:report.indicators.vwap.anchorTs,knownAt:report.indicators.vwap.knownAt,anchorReason:report.indicators.vwap.anchorReason,selectedAt:report.indicators.vwap.selectedAt,basis:report.indicators.vwap.basis,bands:report.indicators.vwap.bands?.map(b=>({multiple:b.multiple,upper:b.upper.at(-1)?.value??null,lower:b.lower.at(-1)?.value??null})),value:report.indicators.vwap.points.at(-1)?.value,displayedByDefault:report.view.defaultLayers.includes("vwap")}:null, sma: report.indicators.sma.filter(s => report.tier === "pro" || s.period === 55).map(s => ({ period: s.period, displayedByDefault: report.view.smaPeriods.includes(s.period), value: s.points.at(-1)?.value ?? null, change10Bars: s.points.length > 10 ? rounded(s.points.at(-1)!.value - s.points.at(-11)!.value) : null })), rsi14: report.tier === "pro" ? report.indicators.rsi.points.at(-1)?.value ?? null : null, atr14: report.indicators.atr.points.at(-1)?.value ?? null, volumeRatio: report.indicators.volumeRatio, fibonacci: report.indicators.fibonacci, regression: report.tier === "pro" ? { bars: report.indicators.regression?.bars, residualSigma: report.indicators.regression?.residualSigma } : null },
    context: { timeframe: report.context.timeframe, status: report.context.status, agreement: report.context.agreement, close: report.context.candles.at(-1)?.close ?? null, sma55: report.context.sma55.at(-1)?.value ?? null },
    recentCandles: report.candles.slice(-48).map(c => [c.ts, c.open, c.high, c.low, c.close, c.volume, c.confirmed]), note: "Only completed candles. Horizon context, VWAP anchors/bands, protection and objectives retain their primary timeframe; the entry study refines execution. Recovery/cycle ranges and current balance are distinct. Executed profiles retain their own venue and time window and do not establish resting-book liquidity. All candidate anchors and level prices are supplied evidence. Projection timing is schematic." };
}
/** Reconstruct discarded candidates from the exact saved OHLCV, without a
 * network, ticker, model or payment. Preserve the original analyst wave choice
 * and hierarchy rather than pretending this is a newly fetched analysis. */
export function rebuildSavedGlobalCandidates(saved:GlobalReport):GlobalReport{
  const source=(bar:string,candles:GlobalReport["candles"]):GlobalPreparationMarket=>({instId:saved.snapshot.instId,bar,source:saved.snapshot.source,fetchedAt:saved.snapshot.observedAt,candles,ticker:{priceCurrency:saved.snapshot.priceCurrency},...(bar===saved.snapshot.timeframe&&saved.orderFlow?{orderFlow:structuredClone(saved.orderFlow)}:{})});
  const market=source(saved.snapshot.timeframe,saved.candles),context=saved.context.timeframe?source(saved.context.timeframe,saved.context.candles):null,entry=saved.entryStudy?source(saved.entryStudy.timeframe,saved.entryStudy.candles):null;
  const rebuilt=prepareGlobalReport({market,contextMarket:context,hierarchyMarkets:[market,...(context?[context]:[]),...(entry?[entry]:[])],tier:saved.tier==="pro"?"premium":"base",lang:saved.lang,retainCandidates:true});
  rebuilt.snapshot=structuredClone(saved.snapshot);rebuilt.candles=structuredClone(saved.candles);rebuilt.indicators=structuredClone(saved.indicators);rebuilt.entryStudy=structuredClone(saved.entryStudy);rebuilt.context=structuredClone(saved.context);rebuilt.hierarchy=structuredClone(saved.hierarchy);rebuilt.waveCount=structuredClone(saved.waveCount);
  return rebuilt;
}
/** Apply validated narrative selections, keeping every numeric field immutable. */
export function finishGlobalReport(prepared: GlobalReport, narrative: GlobalNarrative): GlobalReport {
  const report = structuredClone(prepared), shown = report.paths.filter(p => report.view.pathIds.includes(p.id));
  if (report.waveCount.status!=="unclear"&&narrative.waveCandidateId !== report.waveCount.id) report.waveCount = { ...report.waveCount, id: "unclear", status: "unclear", structure: "unclear", direction: "unclear", activeWave: "unclear", anchors: [], invalidationLevelId: null, validation: ["model_did_not_accept_candidate"] };
  report.view.pathIds=report.paths.filter(p=>report.view.pathIds.includes(p.id)).map(p=>p.id);
  // A model may explain a cancelled or unconfirmed setup, but cannot erase its
  // observed state, protection or missing evidence by selecting null.
  report.tradePlan = structuredClone(prepared.tradePlan??deriveGlobalTradePlan(prepared));
  report.view.levelIds = [...new Set([...report.view.levelIds,report.tradePlan.triggerLevelId,report.tradePlan.invalidationLevelId,...report.tradePlan.targetIds].filter((id):id is string=>id!==null))];
  for (const path of report.paths) path.thesis = narrative.pathNotes.find(n => n.pathId === path.id)?.thesis ?? "";
  const missing = report.candles.length < 55 ? report.lang === "zh" ? "完整 K 线不足，SMA55 和波浪结构可能不可用。" : "Insufficient completed history for SMA55 or a defensible wave count." : "";
  const contextMissing = report.tier === "pro" && report.context.status !== "available" ? report.lang === "zh" ? "未取得同一标的、同一报价货币的独立高周期背景。" : "Independent context for this instrument and quote currency is unavailable." : "";
  const decision=globalDecision(report),unsafe=(line:string)=>/\b(?:no_trade|technical_valid|tradePlan|setup\.state|mainPathId|eligibility)\b|\b(?:buy|sell|enter) (?:now|immediately)\b|\bgo (?:long|short)\b/i.test(line);
  const clean=(lines:string[])=>lines.filter(line=>!unsafe(line)&&!(/\bdecision is frozen\b|\bsetup selection\b/i.test(line))).map(line=>globalHumanText(report,line.replace(/\bfrozen\s+/gi,"").replace(/\s*\(?\b(?:structure-v\d+|discretionary-plan-v\d+|single-setup-v\d+)\b\)?/gi,"").trim()));
  report.narrative = { headline:`${report.snapshot.instId} · ${report.snapshot.timeframe} · ${decision.heading}`, summary:`${decision.entryInstruction} ${decision.route}`,
    reasons:clean(narrative.reasons).slice(0,report.tier==="pro"?4:2),riskNotes:clean(narrative.riskNotes), limitations: [...new Set([...clean(narrative.limitations), missing, contextMissing].filter(Boolean))], disclaimer: narrative.disclaimer };
  return GlobalReportSchema.parse(report);
}

/** Legacy fields are projections of the canonical map, never a second planner. */
export function globalCompatibility(report: GlobalReport, narrative?: Pick<GlobalNarrative, "bias" | "regime" | "confidence">) {
  const level = (id: string | null) => report.levels.find(l => l.id === id)?.price ?? null;
  const setup = report.setup, firstTarget = level(setup.targetIds[0] ?? null), entry = setup.entryZone?.[1] ?? null;
  const researchPlan=report.tradePlan,decision=globalDecision(report);
  const eligibility=globalEligibility(report),action=globalTradePlanTitle(report);
  const executableBuy=decision.currentAction==="BUY"&&setup.state==="ready";
  const direction=report.paths.find(p=>p.role==="main")?.direction;
  return { analysis: { ...report.narrative, bias: report.hierarchy?.find(r=>r.timeframe===report.snapshot.timeframe)?.bias==="mixed"?"neutral":direction==="up"?"bullish":direction==="down"?"bearish":"neutral", regime: direction==="range"?"range":narrative?.regime??"transition", confidence: narrative?.confidence ?? 0,
    keyLevels: { support: report.levels.filter(l => l.role === "support").map(l => l.price), resistance: report.levels.filter(l => l.role === "resistance").map(l => l.price) },
    targets: [], invalidation: { price: level(report.waveCount.invalidationLevelId), condition: "Use the canonical path and setup cancellation conditions." },
    elliottWave: { degree: report.waveCount.degree, structure: report.waveCount.structure, direction: report.waveCount.direction, currentWave: report.waveCount.activeWave, rationale: report.narrative.summary, invalidation: level(report.waveCount.invalidationLevelId), paths: report.paths.filter(p => report.view.pathIds.includes(p.id)).map(p => ({ type: p.kind, label: p.id, thesis: p.thesis, trigger: level(p.triggerLevelId), target: level(p.targetIds[0] ?? null), invalidation: level(p.invalidationLevelId), sequence: [] })) }, agentAction: action, agentChecklist: decision.checklist },
    technical: { methodology: report.version, eligibility, currentAction:decision.currentAction,marketView:decision.marketView,hierarchy:report.hierarchy,referenceRisk:globalRiskMeasurement(report), elliott: { status: report.waveCount.status, currentWave: report.waveCount.activeWave, direction: report.waveCount.direction, waves: report.waveCount.anchors, invalidation: level(report.waveCount.invalidationLevelId) } },
    executionPlan: { version: report.version, pair: report.snapshot.instId, timeframe: report.snapshot.timeframe, tier: report.tier, observedPrice: report.snapshot.price,
      researchPlan,
      recommendation: { action: decision.currentAction.toLowerCase(), status:eligibility, label:action, reason:decision.reason },
      buy: { valid: executableBuy, side: "buy", orderType: "limit", trigger: executableBuy?entry:null, entryZone: executableBuy?setup.entryZone:null, takeProfit: executableBuy?firstTarget:null, stopLoss: executableBuy?setup.protectiveStop:null, riskReward: executableBuy?setup.netRewardRisk:null }, riskExit: { trigger: level(setup.invalidationLevelId), downsideReference: null } } };
}
