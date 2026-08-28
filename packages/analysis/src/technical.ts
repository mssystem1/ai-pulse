import type { Candle } from "@pulse/market";

const round = (value: number) => Number(value.toPrecision(10));

type ScenarioLike = { name?: unknown; target?: unknown; invalidation?: unknown; thesis?: unknown };
type WavePathLike = { type?: unknown; label?: unknown; target?: unknown; invalidation?: unknown; trigger?: unknown; thesis?: unknown; sequence?: unknown };
type AnalysisLike = {
  bias?: unknown;
  confidence?: unknown;
  invalidation?: unknown;
  scenarios?: unknown;
  elliottWave?: unknown;
  keyLevels?: unknown;
};

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nearest(values: unknown, reference: number, direction: "below" | "above") {
  if (!Array.isArray(values)) return null;
  const candidates = values.map(finite).filter((value): value is number => value !== null)
    .filter((value) => direction === "below" ? value < reference : value > reference)
    .sort((a, b) => direction === "below" ? b - a : a - b);
  return candidates[0] ?? null;
}

/** Deterministic chart annotations. Elliott output is explicitly a candidate count, never a fact. */
export function buildTechnicalStructure(candles: readonly Candle[]) {
  if (candles.length < 5) throw new Error("At least five candles are required for technical structure");
  const recent = candles.slice(-Math.min(120, candles.length));
  const high = Math.max(...recent.map((c) => c.high));
  const low = Math.min(...recent.map((c) => c.low));
  const last = recent.at(-1)!;
  const previous = recent.at(-2)!;
  const range = high - low;
  const upward = last.close >= recent[0].open;
  const ratios = [0, .236, .382, .5, .618, .786, 1];
  const fibonacci = ratios.map((ratio) => ({
    ratio,
    price: round(upward ? high - range * ratio : low + range * ratio),
  }));
  const pivot = (previous.high + previous.low + previous.close) / 3;
  const r1 = 2 * pivot - previous.low; const s1 = 2 * pivot - previous.high;
  const r2 = pivot + (previous.high - previous.low); const s2 = pivot - (previous.high - previous.low);
  const radius = Math.max(2, Math.floor(recent.length / 30));
  const pivots = recent.flatMap((candle, index) => {
    if (index < radius || index >= recent.length - radius) return [];
    const around = recent.slice(index - radius, index + radius + 1);
    const highPivot = around.every((candidate) => candle.high >= candidate.high);
    const lowPivot = around.every((candidate) => candle.low <= candidate.low);
    if (!highPivot && !lowPivot) return [];
    return [{ kind: highPivot ? "high" as const : "low" as const, ts: candle.ts, price: highPivot ? candle.high : candle.low }];
  }).reduce<Array<{ kind: "high" | "low"; ts: number; price: number }>>((alternating, pivotPoint) => {
    const prior = alternating.at(-1);
    if (!prior || prior.kind !== pivotPoint.kind) return [...alternating, pivotPoint];
    const replace = pivotPoint.kind === "high" ? pivotPoint.price > prior.price : pivotPoint.price < prior.price;
    return replace ? [...alternating.slice(0, -1), pivotPoint] : alternating;
  }, []);
  const selectedPivots = pivots.slice(-5);
  const window = Math.max(2, Math.floor(recent.length / 5));
  const fallback = Array.from({ length: 5 }, (_, index) => {
    const slice = recent.slice(index * window, index === 4 ? recent.length : (index + 1) * window);
    const takeHigh = index % 2 === (upward ? 0 : 1);
    const extreme = takeHigh
      ? slice.reduce((best, candle) => candle.high > best.high ? candle : best, slice[0])
      : slice.reduce((best, candle) => candle.low < best.low ? candle : best, slice[0]);
    return { kind: takeHigh ? "high" as const : "low" as const, ts: extreme.ts, price: takeHigh ? extreme.high : extreme.low };
  });
  const waves = (selectedPivots.length === 5 ? selectedPivots : fallback).map((wave, index) => ({ label: String(index + 1), ts: wave.ts, price: round(wave.price), kind: wave.kind }));
  const atr = recent.slice(1).reduce((sum, candle, index) => {
    const priorClose = recent[index].close;
    return sum + Math.max(candle.high - candle.low, Math.abs(candle.high - priorClose), Math.abs(candle.low - priorClose));
  }, 0) / (recent.length - 1);
  const observedSwingCount = pivots.length;
  const lastSwing = waves.at(-1)!;
  const retracedFromLastExtreme = upward
    ? last.close < lastSwing.price - range * .236
    : last.close > lastSwing.price + range * .236;
  const currentWave = retracedFromLastExtreme
    ? "A"
    : observedSwingCount >= 5
      ? "5"
      : observedSwingCount >= 3
        ? "3"
        : "unclear";
  const correctionTarget = upward
    ? round(high - range * .5)
    : round(low + range * .5);
  const continuationTarget = upward
    ? round(high + range * .272)
    : round(Math.max(0, low - range * .272));
  const wavePaths = currentWave === "A"
    ? [
        { type: "abc_correction", label: "A-B-C correction developing", trigger: round(last.close), target: correctionTarget, invalidation: round(upward ? high : low), sequence: ["Wave A extends from the completed impulse", "Wave B retraces part of A", "Wave C tests the Fibonacci correction zone"] },
        { type: "recount", label: "Impulse count resumes after recount", trigger: round(upward ? high : low), target: continuationTarget, invalidation: correctionTarget, sequence: ["Price reclaims the prior impulse extreme", "The corrective count is invalidated", "The impulse extension becomes the active count"] },
      ]
    : [
        { type: currentWave === "3" ? "wave_3_continuation" : "wave_5_continuation", label: currentWave === "3" ? "Wave 3 continuation" : "Wave 5 continuation", trigger: round(upward ? Math.max(last.close, r1) : Math.min(last.close, s1)), target: continuationTarget, invalidation: correctionTarget, sequence: currentWave === "3" ? ["Wave 2 holds its origin", "Wave 3 expands through resistance", "Wave 4 retracement follows"] : ["Wave 4 support holds", "Wave 5 extends beyond the wave 3 extreme", "An A-B-C correction becomes the next structure"] },
        { type: "abc_correction", label: "Impulse completes into A-B-C", trigger: correctionTarget, target: round(upward ? high - range * .618 : low + range * .618), invalidation: round(upward ? high : low), sequence: ["The impulse high/low rejects", "Wave A breaks the continuation structure", "Waves B and C develop toward the retracement zone"] },
      ];
  return Object.freeze({
    methodology: "pulse-deterministic-ta-v2",
    range: { high: round(high), low: round(low), direction: upward ? "up" : "down" },
    fibonacci,
    pivots: { pivot: round(pivot), r1: round(r1), r2: round(r2), s1: round(s1), s2: round(s2) },
    elliott: {
      status: "candidate",
      direction: upward ? "impulse-up" : "impulse-down",
      currentWave,
      phase: currentWave === "3" ? "wave-3-continuation" : currentWave === "5" ? "wave-5-continuation" : currentWave === "A" ? "abc-correction" : "unclear-count",
      waves,
      invalidation: round(upward ? low : high),
      next: upward
        ? { correctionZone: [round(high - range * .382), round(high - range * .5)], continuationTarget: round(high + range * .272) }
        : { correctionZone: [round(low + range * .382), round(low + range * .5)], continuationTarget: round(Math.max(0, low - range * .272)) },
      paths: wavePaths,
      explanation: "The dominant candidate count is derived from alternating pivots across the complete supplied candle window. PULSE distinguishes wave 3 continuation, wave 5 continuation and A-B-C correction paths; every count remains a hypothesis until its trigger holds and its invalidation does not break.",
    },
    possibleMoves: {
      bullish: { trigger: round(Math.max(last.close, r1)), target: round(Math.max(r2, high + atr)), invalidation: round(Math.min(pivot, last.close - atr)) },
      bearish: { trigger: round(Math.min(last.close, s1)), target: round(Math.min(s2, low - atr)), invalidation: round(Math.max(pivot, last.close + atr)) },
    },
    generatedFrom: { candleCount: recent.length, fromTs: recent[0].ts, toTs: last.ts },
  });
}

/** Converts narrative analysis into one coherent, spot-only execution map. */
export function buildSpotExecutionPlan(input: {
  instId: string;
  timeframe: string;
  tier: string;
  lastPrice: number;
  analysis: AnalysisLike;
  technical: ReturnType<typeof buildTechnicalStructure>;
}) {
  const { analysis, technical } = input;
  const last = finite(input.lastPrice) || 0;
  const bias = analysis.bias === "bullish" || analysis.bias === "bearish" ? analysis.bias : "neutral";
  const confidence = Math.max(0, Math.min(100, Number(analysis.confidence) || 0));
  const scenarios = Array.isArray(analysis.scenarios) ? analysis.scenarios as ScenarioLike[] : [];
  const scenario = (name: "bull" | "base" | "bear") => scenarios.find((item) => item.name === name);
  const wave = analysis.elliottWave && typeof analysis.elliottWave === "object" ? analysis.elliottWave as { invalidation?: unknown; paths?: unknown } : {};
  const wavePaths = Array.isArray(wave.paths) ? wave.paths as WavePathLike[] : [];
  const continuationPath = wavePaths.find((item) => ["wave_3_continuation", "wave_5_continuation"].includes(String(item.type)) && Number(item.target) > last)
    || wavePaths.find((item) => Number(item.target) > last);
  const correctionPath = wavePaths.find((item) => ["abc_correction", "wave_c_continuation", "count_invalidation", "recount"].includes(String(item.type)) && Number(item.target) < last)
    || wavePaths.find((item) => Number(item.target) < last);
  const levels = analysis.keyLevels && typeof analysis.keyLevels === "object" ? analysis.keyLevels as { support?: unknown; resistance?: unknown } : {};
  const reportInvalidation = analysis.invalidation && typeof analysis.invalidation === "object"
    ? finite((analysis.invalidation as { price?: unknown }).price) : null;
  const buyEntry = nearest(levels.support, last, "below") || finite(technical.pivots.pivot) || last;
  const sellTrigger = nearest(levels.support, last, "below") || finite(technical.possibleMoves.bearish.trigger) || last;
  const bullTarget = finite(continuationPath?.target) || finite(scenario("bull")?.target) || finite(technical.possibleMoves.bullish.target) || last;
  const bearTarget = finite(correctionPath?.target) || finite(scenario("bear")?.target) || finite(technical.possibleMoves.bearish.target) || last;
  const stop = finite(wave.invalidation) || reportInvalidation || finite(continuationPath?.invalidation) || finite(scenario("bull")?.invalidation) || finite(technical.possibleMoves.bullish.invalidation) || last;
  const risk = Math.abs(buyEntry - stop);
  const reward = Math.max(0, bullTarget - buyEntry);
  const recommendedAction = confidence >= 55 && bias === "bullish" ? "buy" : "wait";
  return Object.freeze({
    version: "pulse-spot-plan-v1",
    pair: input.instId,
    timeframe: input.timeframe,
    tier: input.tier,
    observedPrice: round(last),
    recommendation: {
      action: recommendedAction,
      confidence,
      label: recommendedAction === "buy" ? "Conditional spot buy setup" : "No new buy · wait for confirmation",
      reason: recommendedAction === "wait" ? `The ${bias} bias/confidence does not justify opening a new spot buy. Existing holdings remain under the owner's control.` : "The bullish report bias supports a conditional buy; execution still depends on the trigger and stop below.",
    },
    buy: {
      side: "buy",
      orderType: buyEntry < last * .997 ? "limit" : "market",
      trigger: round(buyEntry),
      entryZone: [round(Math.min(buyEntry, last)), round(Math.max(buyEntry, last))],
      takeProfit: round(bullTarget),
      stopLoss: round(stop),
      riskReward: risk > 0 ? round(reward / risk) : null,
      scenario: String(continuationPath?.thesis || continuationPath?.label || scenario("bull")?.thesis || "The primary Elliott continuation path is valid only after the stated trigger holds."),
    },
    riskExit: {
      trigger: round(sellTrigger),
      downsideReference: round(bearTarget),
      scenario: String(correctionPath?.thesis || correctionPath?.label || scenario("bear")?.thesis || "The Elliott correction/recount path is the risk reference if support fails; it is not a short recommendation."),
    },
    baseCase: {
      target: finite(correctionPath?.target) || finite(scenario("base")?.target),
      thesis: String(correctionPath?.label || scenario("base")?.thesis || "Wait while the Elliott continuation and correction counts remain unresolved."),
    },
    noTrade: [
      `Do not enter when the live price has already crossed the stop at ${round(stop)}.`,
      "Refresh the quote and report when market data, route liquidity or the selected network changes.",
      "Targets are conditional scenarios, not guaranteed outcomes.",
    ],
  });
}
