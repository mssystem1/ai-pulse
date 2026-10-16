import type { SpotMarketContext } from "@pulse/market";
import { deriveGlobalTradePlan, globalConfirmationEvidence, globalSetupAttemptEvidence,globalPrimaryAttemptEvidence, globalLocalLevels, globalEligibility, globalRiskMeasurement, globalRemoteLevels, globalTradePlanTitle, globalTradePlanLines } from "@pulse/domain";
import { GlobalReportSchema, candleTimeframeMs, candleCloseTime, parseCandleTimeframe, type GlobalReport, type GlobalCandle, type GlobalAnchor, type GlobalLevel, type GlobalPath, type GlobalNarrative } from "@pulse/schemas";

export const GLOBAL_HISTORY_LIMIT = 520;
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
export function completedGlobalCandles(market: SpotMarketContext): GlobalCandle[] {
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
  if (report.tier === "pro" && (report.context.status !== "available" || report.context.agreement === "conflicts" || report.context.agreement === "unknown")) missing.push("context");
  return { ...confirmedSetup, state: missing.length ? "watching" : "ready", retestTs: retest.ts, entryZone, protectiveStop, grossRewardRisk, netRewardRisk, missing };
}

/** Calculate a saved market map before prompting. No generic TA fallback is used. */
export function prepareGlobalReport(input: { market: SpotMarketContext; tier: "base" | "premium"; lang?: "en" | "zh"; contextMarket?: SpotMarketContext | null; executionCostsBps?: number }): GlobalReport {
  const { market } = input, candles = completedGlobalCandles(market), last = candles.at(-1), close = last?.close ?? null, tier = input.tier === "premium" ? "pro" : "quick", lang = input.lang ?? "en";
  const { atr, rsi } = globalWilderIndicators(candles), latestAtr = atr.at(-1)?.value ?? (close ?? 1) * .01;
  // Pivot confirmation uses only local completed bars, not today's ATR applied
  // retrospectively to older swings.
  const pivots = globalConfirmedPivots(candles), levels: GlobalLevel[] = [];
  let waveCount = globalWaveCandidate(candles,pivots,atr);
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
  const leg = waveCount.anchors.length >= 6 ? [waveCount.anchors[0], waveCount.anchors[5]] : waveCount.anchors.length>=3 ? [waveCount.anchors[0],waveCount.anchors[waveCount.anchors.length===3?1:3]] : pivots.length >= 2 ? pivots.slice(-2) : [];
  const fibonacci: GlobalReport["indicators"]["fibonacci"] = [];
  if (leg.length === 2 && Math.abs(leg[1].price - leg[0].price) >= latestAtr * 2) {
    const [a, b] = leg, delta = b.price - a.price;
    for (const ratio of [0, .236, .382, .5, .618, .786, 1]) { const price = b.price - delta * ratio; if (price > 0) fibonacci.push({ ratio, price: rounded(price), anchorIds: [a.id, b.id] }); }
    // Extension levels are measured projections of an observed leg, not
    // fabricated support, a guaranteed wave target, or a liquidity claim.
    for (const ratio of [1.272, 1.618]) { const price = a.price + delta * ratio; if (price > 0) addLevel({ ...b, price: rounded(price) }, "extension", ratio, [a.id, b.id]); }
  }
  const sma = [21, 55, 89, 144, 233].map(period => ({ period, points: globalSma(candles, period) })), average = sma.find(s => s.period === 55)!.points;
  const slope = average.length >= 11 ? average.at(-1)!.value - average.at(-11)!.value : 0;
  const trend = close === null || !average.length ? "range" : close < average.at(-1)!.value && slope < 0 ? "down" : close > average.at(-1)!.value && slope > 0 ? "up" : "range";
  const below = levels.filter(l => close !== null && l.price < close).sort((a, b) => b.price - a.price), above = levels.filter(l => close !== null && l.price > close).sort((a, b) => a.price - b.price);
  // A recently reclaimed swing remains the setup threshold even when it is
  // already below price. Its timestamp and confirmation must precede the break.
  const recentReclaimed = pivots.filter(a => a.kind === "high" && close !== null && a.price < close && a.confirmedAt !== null
    && candles.slice(-4).some((c, j, tail = candles.slice(-4)) => j > 0 && c.ts > a.confirmedAt! && tail[j - 1].close <= a.price && c.close > a.price)).at(-1);
  const triggerUp = recentReclaimed ? levels.find(l => l.anchorIds.includes(recentReclaimed.id)) : above[0];
  const localAbove=globalLocalLevels(above,close??0,latestAtr),localBelow=globalLocalLevels(below,close??0,latestAtr);
  const floor = below.find(l => l.price < (triggerUp?.price ?? close ?? 0)), materialAbove=localAbove, upTargets = materialAbove.filter(l => l.id !== triggerUp?.id && l.price > (triggerUp?.price ?? 0)).slice(0, 2);
  const paths: GlobalPath[] = [];
  if (triggerUp && floor && upTargets.length) paths.push({ id: "recovery", role: trend === "up" ? "main" : "alternative", direction: "up", kind: trend === "up" ? "continuation" : "recovery", state: "conditional", triggerLevelId: triggerUp.id, targetIds: upTargets.map(l => l.id), invalidationLevelId: floor.id, confirmation: "close_retest", thesis: "" });
  // A rising market with one overhead obstacle can still have a support-hold
  // plan. Do not manufacture a breakout target beyond the known resistance.
  if (!paths.some(p=>p.direction==="up") && trend==="up" && below.length>=2 && materialAbove.length) paths.push({id:"pullback",role:"main",direction:"up",kind:"pullback",state:"conditional",triggerLevelId:below[0].id,targetIds:materialAbove.slice(0,2).map(l=>l.id),invalidationLevelId:below[1].id,confirmation:"support_hold",thesis:""});
  const downTargets=(trend==="down"?localBelow:localBelow.slice(1)).slice(0,2);
  if (downTargets.length && above.length) paths.push({ id: "correction", role: trend === "down" ? "main" : "alternative", direction: "down", kind: "correction", state: trend === "down" ? "active" : "conditional", triggerLevelId: trend === "down" ? above[0].id : below[0].id, targetIds: downTargets.map(l => l.id), invalidationLevelId: above[0].id, confirmation: trend === "down" ? "hold" : "close_retest", thesis: "" });
  if(tier==="pro"){const down=paths.find(p=>p.direction==="down"),deep=down?.targetIds.at(-1),threshold=levels.find(l=>l.id===deep),stress=threshold?localBelow.find(l=>l.price<threshold.price):null;if(down&&threshold&&stress)down.stress={triggerLevelId:threshold.id,targetIds:[stress.id]};}
  if (trend === "range" && below.length && above.length) paths.unshift({ id: "range", role: "main", direction: "range", kind: "range", state: "active", triggerLevelId: below[0].id, targetIds: [above[0].id], invalidationLevelId: below[0].id, confirmation: "hold", thesis: "" });
  if (!paths.some(p => p.role === "main") && paths.length) paths[0].role = "main";
  paths.sort((a, b) => Number(b.role === "main") - Number(a.role === "main"));
  if (paths.length < 3 && paths.some(p => p.direction === "up") && upTargets.length === 2) {
    const target = upTargets.at(-1)!, further = localAbove.filter(l => l.price > target.price).slice(0, 2);
    if (further.length) paths.push({ id: "recount", role: "alternative", direction: "up", kind: "recount", state: "conditional", triggerLevelId: target.id, targetIds: further.map(l => l.id), invalidationLevelId: target.id, confirmation: "close_retest", thesis: "" });
  }
  const contextFrame = globalContextTimeframe(market.bar), contextCandles = input.contextMarket && input.contextMarket.instId === market.instId && input.contextMarket.source === market.source && input.contextMarket.bar === contextFrame && (input.contextMarket.ticker.priceCurrency ?? market.instId.split("-").at(-1)) === (market.ticker.priceCurrency ?? market.instId.split("-").at(-1)) ? completedGlobalCandles({ ...input.contextMarket, fetchedAt: market.fetchedAt }) : [];
  const contextAverage = globalSma(contextCandles, 55), contextClose = contextCandles.at(-1)?.close, contextSma = contextAverage.at(-1)?.value;
  const vwapAnchor = waveCount.anchors[0] ?? pivots.at(-2), vwap: Point[] = []; let pv = 0, volume = 0;
  if (vwapAnchor) for (const c of candles.filter(c => c.ts >= vwapAnchor.ts)) { pv += (c.high + c.low + c.close) / 3 * c.volume; volume += c.volume; if (volume > 0) vwap.push({ ts: c.ts, value: rounded(pv / volume) }); }
  const lowAnchors = pivots.filter(a => a.kind === "low").slice(-2), highAnchors = pivots.filter(a => a.kind === "high").slice(-2);
  const precedingVolume = candles.slice(-21, -1), meanVolume = precedingVolume.length === 20 ? precedingVolume.reduce((s, c) => s + c.volume, 0) / 20 : 0;
  const report: GlobalReport = {
    version: "pulse-global-v3", evaluationVersion: "completed-v2", tier, lang,
    snapshot: { instId: market.instId, timeframe: market.bar, source: market.source, venue: market.source === "okx-public-spot" ? "OKX Spot" : market.source === "okx-robinhood-dex" ? "Robinhood DEX" : "Arc DEX", priceCurrency: market.ticker.priceCurrency ?? market.instId.split("-").at(-1) ?? "Unknown", observedAt: market.fetchedAt, lastCandleTs: last?.ts ?? null, price: close,
      pricePrecision: close === null ? 2 : Math.min(10, Math.max(2, 4 - Math.floor(Math.log10(close)))), completedOnly: true },
    candles, levels, waveCount, paths: paths.slice(0, 3),
    setup: { state: "none", pathId: null, triggerLevelId: null, retestLevelId: null, invalidationLevelId: null, targetIds: [], entryZone: null, protectiveStop: null, grossRewardRisk: null, netRewardRisk: null, costsBps: null, confirmationTs: null, retestTs: null, expiresAt: null, missing: [] },
    indicators: { sma, atr: { period: 14, points: atr }, rsi: { period: 14, points: rsi }, volumeRatio: meanVolume > 0 && last ? rounded(last.volume / meanVolume) : null, regression: regression(candles), fibonacci, vwap: vwapAnchor && vwap.length ? { anchorId: vwapAnchor.id, points: vwap } : null, pivots, channel: lowAnchors.length === 2 && highAnchors.length === 2 ? { lower: lowAnchors as [GlobalAnchor, GlobalAnchor], upper: highAnchors as [GlobalAnchor, GlobalAnchor] } : null },
    context: { timeframe: contextFrame, status: tier === "quick" ? "not_requested" : contextAverage.length ? "available" : "unavailable", source: contextAverage.length ? input.contextMarket!.source : null, candles: tier === "pro" ? contextCandles : [], sma55: tier === "pro" ? contextAverage : [], agreement: tier === "quick" || contextClose === undefined || contextSma === undefined ? "unknown" : contextClose < contextSma ? "conflicts" : contextClose > contextSma ? "supports" : "neutral" },
    narrative: { headline: "", summary: "", reasons: [], riskNotes: [], limitations: [], disclaimer: "" },
    view: { levelIds: [], pathIds: [], smaPeriods: [55], defaultLayers: tier === "pro" ? ["sma", "channel", "rsi", "context"] : ["sma", "channel"] },
  };
  report.setup = evaluateGlobalSetup(report, Number.isFinite(input.executionCostsBps) && input.executionCostsBps! >= 0 ? input.executionCostsBps! : null);
  const includedPaths = report.paths.slice(0, tier === "quick" ? 2 : 3);
  // Quick must include its selected setup, not hide its corresponding path.
  const selected = report.paths.find(p => p.id === report.setup.pathId);
  if (selected && !includedPaths.includes(selected)) includedPaths[includedPaths.length - 1] = selected;
  report.view.pathIds = includedPaths.map(p => p.id);
  report.view.levelIds = [...new Set(includedPaths.flatMap(p => [p.triggerLevelId, p.invalidationLevelId, ...p.targetIds,...(p.stress?[p.stress.triggerLevelId,...p.stress.targetIds]:[])]).filter((id): id is string => id !== null))];
  report.tradePlan = deriveGlobalTradePlan(report);
  report.view.levelIds = [...new Set([...report.view.levelIds,report.tradePlan.triggerLevelId,report.tradePlan.invalidationLevelId,...report.tradePlan.targetIds].filter((id):id is string=>id!==null))];
  return GlobalReportSchema.parse(report);
}

export function globalPromptEvidence(report: GlobalReport) {
  return { snapshot: report.snapshot, eligibility:globalEligibility(report),riskMeasurement:globalRiskMeasurement(report),distantContextLevelIds:globalRemoteLevels(report).map(l=>l.id), priceReference:{kind:"last_completed_close",price:report.snapshot.price,candleTs:report.snapshot.lastCandleTs,completedAt:report.snapshot.lastCandleTs===null?null:candleCloseTime(report.snapshot.lastCandleTs,report.snapshot.timeframe),liveQuote:false},waveCandidate: report.waveCount, levels: report.levels, paths: report.paths.filter(p => report.view.pathIds.includes(p.id)), setup: report.setup, setupAttemptEvidence:globalSetupAttemptEvidence(report), tradePlan: report.tradePlan,primaryAttemptEvidence:globalPrimaryAttemptEvidence(report),
    indicators: { sma: report.indicators.sma.filter(s => report.tier === "pro" || s.period === 55).map(s => ({ period: s.period, displayedByDefault: report.view.smaPeriods.includes(s.period), value: s.points.at(-1)?.value ?? null, change10Bars: s.points.length > 10 ? rounded(s.points.at(-1)!.value - s.points.at(-11)!.value) : null })), rsi14: report.tier === "pro" ? report.indicators.rsi.points.at(-1)?.value ?? null : null, atr14: report.indicators.atr.points.at(-1)?.value ?? null, volumeRatio: report.indicators.volumeRatio, fibonacci: report.indicators.fibonacci, regression: report.tier === "pro" ? { bars: report.indicators.regression?.bars, residualSigma: report.indicators.regression?.residualSigma } : null },
    context: { timeframe: report.context.timeframe, status: report.context.status, agreement: report.context.agreement, close: report.context.candles.at(-1)?.close ?? null, sma55: report.context.sma55.at(-1)?.value ?? null },
    recentCandles: report.candles.slice(-48).map(c => [c.ts, c.open, c.high, c.low, c.close, c.volume, c.confirmed]), note: "Only completed candles. All candidate anchors and level prices are supplied evidence. Projection timing is schematic." };
}
/** Apply validated narrative selections, keeping every numeric field immutable. */
export function finishGlobalReport(prepared: GlobalReport, narrative: GlobalNarrative): GlobalReport {
  const report = structuredClone(prepared), shown = report.paths.filter(p => report.view.pathIds.includes(p.id));
  if (report.waveCount.status!=="unclear"&&narrative.waveCandidateId !== report.waveCount.id) report.waveCount = { ...report.waveCount, id: "unclear", status: "unclear", structure: "unclear", direction: "unclear", activeWave: "unclear", anchors: [], invalidationLevelId: null, validation: ["model_did_not_accept_candidate"] };
  if (narrative.mainPathId && shown.some(p => p.id === narrative.mainPathId)) { report.paths.forEach(p => p.role = p.id === narrative.mainPathId ? "main" : "alternative"); report.paths.sort((a, b) => Number(b.role === "main") - Number(a.role === "main")); }
  report.view.pathIds=report.paths.filter(p=>report.view.pathIds.includes(p.id)).map(p=>p.id);
  // A model may explain a cancelled or unconfirmed setup, but cannot erase its
  // observed state, protection or missing evidence by selecting null.
  report.tradePlan = deriveGlobalTradePlan(report);
  report.view.levelIds = [...new Set([...report.view.levelIds,report.tradePlan.triggerLevelId,report.tradePlan.invalidationLevelId,...report.tradePlan.targetIds].filter((id):id is string=>id!==null))];
  for (const path of report.paths) path.thesis = narrative.pathNotes.find(n => n.pathId === path.id)?.thesis ?? "";
  const missing = report.candles.length < 55 ? report.lang === "zh" ? "完整 K 线不足，SMA55 和波浪结构可能不可用。" : "Insufficient completed history for SMA55 or a defensible wave count." : "";
  const contextMissing = report.tier === "pro" && report.context.status !== "available" ? report.lang === "zh" ? "未取得同一标的、同一报价货币的独立高周期背景。" : "Independent context for this instrument and quote currency is unavailable." : "";
  report.narrative = { headline: narrative.headline, summary: narrative.summary, reasons: narrative.reasons, riskNotes: narrative.riskNotes, limitations: [...new Set([...narrative.limitations, missing, contextMissing].filter(Boolean))], disclaimer: narrative.disclaimer };
  return GlobalReportSchema.parse(report);
}

/** Legacy fields are projections of the canonical map, never a second planner. */
export function globalCompatibility(report: GlobalReport, narrative?: Pick<GlobalNarrative, "bias" | "regime" | "confidence">) {
  const level = (id: string | null) => report.levels.find(l => l.id === id)?.price ?? null;
  const setup = report.setup, firstTarget = level(setup.targetIds[0] ?? null), entry = setup.entryZone?.[1] ?? null;
  const researchPlan=report.tradePlan;
  const eligibility=globalEligibility(report),action=eligibility==="no_trade"?"No trade at these references; sufficient nearest-obstacle reward and valid structure are required":eligibility==="expired"||eligibility==="invalidated"?"Recheck completed candles; the old attempt does not authorize entry":eligibility==="technical_valid"?"Technical evidence observed; recheck a fresh amount-specific quote and observed protection before order review":researchPlan?.side==="short"?"Wait for rejection confirmation and a subsequent test; only owned Spot inventory can be sold":"Wait for a qualifying completed confirmation and a subsequent held retest";
  return { analysis: { ...report.narrative, bias: narrative?.bias ?? "neutral", regime: narrative?.regime ?? "transition", confidence: narrative?.confidence ?? 0,
    keyLevels: { support: report.levels.filter(l => l.role === "support").map(l => l.price), resistance: report.levels.filter(l => l.role === "resistance").map(l => l.price) },
    targets: [], invalidation: { price: level(report.waveCount.invalidationLevelId), condition: "Use the canonical path and setup cancellation conditions." },
    elliottWave: { degree: report.waveCount.degree, structure: report.waveCount.structure, direction: report.waveCount.direction, currentWave: report.waveCount.activeWave, rationale: report.narrative.summary, invalidation: level(report.waveCount.invalidationLevelId), paths: report.paths.filter(p => report.view.pathIds.includes(p.id)).map(p => ({ type: p.kind, label: p.id, thesis: p.thesis, trigger: level(p.triggerLevelId), target: level(p.targetIds[0] ?? null), invalidation: level(p.invalidationLevelId), sequence: [] })) }, agentAction: action, agentChecklist: [] },
    technical: { methodology: report.version, eligibility, referenceRisk:globalRiskMeasurement(report), elliott: { status: report.waveCount.status, currentWave: report.waveCount.activeWave, direction: report.waveCount.direction, waves: report.waveCount.anchors, invalidation: level(report.waveCount.invalidationLevelId) } },
    executionPlan: { version: report.version, pair: report.snapshot.instId, timeframe: report.snapshot.timeframe, tier: report.tier, observedPrice: report.snapshot.price,
      researchPlan,
      recommendation: { action: setup.state === "ready" ? "buy" : "wait", status:eligibility, label:globalTradePlanTitle(report), reason:globalTradePlanLines(report).at(-1)??action },
      buy: { valid: setup.state === "ready", side: "buy", orderType: "limit", trigger: entry, entryZone: setup.entryZone, takeProfit: firstTarget, stopLoss: setup.protectiveStop, riskReward: setup.netRewardRisk }, riskExit: { trigger: level(setup.invalidationLevelId), downsideReference: null } } };
}
