import assert from "node:assert/strict";
import test from "node:test";
import { buildSpotExecutionPlan, buildTechnicalStructure } from "./technical.js";

const candles = Array.from({ length: 80 }, (_, index) => {
  const close = 1800 + index * 6 + Math.sin(index / 3) * 45;
  return {
    ts: 1_700_000_000_000 + index * 14_400_000,
    open: close - 8,
    high: close + 24,
    low: close - 27,
    close,
    volume: 1_000 + index * 10,
    volumeCcy: 2_000_000 + index * 1_000,
  };
});

test("Elliott annotations use alternating market pivots and expose next-move context", () => {
  const technical = buildTechnicalStructure(candles);
  assert.equal(technical.elliott.status, "candidate");
  assert.equal(technical.elliott.waves.length, 5);
  for (let index = 1; index < technical.elliott.waves.length; index += 1) {
    assert.notEqual(technical.elliott.waves[index].kind, technical.elliott.waves[index - 1].kind);
  }
  assert.equal(technical.elliott.next.correctionZone.length, 2);
  assert.ok(Number.isFinite(technical.elliott.next.continuationTarget));
});

test("report execution uses Elliott wave paths for the chart and Spot ticket", () => {
  const technical = buildTechnicalStructure(candles);
  const plan = buildSpotExecutionPlan({
    instId: "ETH-USDT",
    timeframe: "4H",
    tier: "premium",
    lastPrice: 2_337,
    analysis: {
      bias: "bullish",
      confidence: 74,
      keyLevels: { support: [2_200, 2_067.8], resistance: [2_337] },
      invalidation: { price: 2_067.8, condition: "daily close below breakout low" },
      elliottWave: {
        invalidation: 2_067.8,
        paths: [
          { type: "wave_3_continuation", label: "Wave 3 continuation", target: 2_550, thesis: "Sustained momentum" },
          { type: "abc_correction", label: "A-B-C correction", target: 1_905, thesis: "Failure to hold breakout" },
        ],
      },
    },
    technical,
  });
  assert.equal(plan.recommendation.action, "buy");
  assert.equal(plan.buy.takeProfit, 2_550);
  assert.equal(plan.buy.stopLoss, 2_067.8);
  assert.equal(plan.riskExit.downsideReference, 1_905);
  assert.equal("sell" in plan, false);
  assert.equal(plan.baseCase.target, 1_905);
});

test("bearish invalidations never become buy stops and 60% is not above the recommendation threshold", () => {
  const technical = buildTechnicalStructure(candles);
  for (const confidence of [40, 60, 61]) {
    const plan = buildSpotExecutionPlan({ instId: "BTC-USDT", timeframe: "1H", tier: "premium", lastPrice: 76938,
      analysis: { bias: confidence === 40 ? "bearish" : "bullish", confidence, keyLevels: { support: [76500] }, invalidation: { price: 78000 }, elliottWave: { invalidation: 79600, paths: [{ type: "recount", target: 80200, invalidation: 79600 }] } }, technical });
    assert.ok(plan.buy.stopLoss === null || plan.buy.stopLoss < plan.buy.trigger);
    if (confidence <= 60) assert.equal(plan.recommendation.action, "wait");
    if (plan.recommendation.action === "buy") assert.ok(plan.buy.valid);
  }
});

test("Autopilot protection uses its actual market entry rather than a conditional Spot entry", () => {
  const structure = buildTechnicalStructure(candles);
  const technical = { ...structure, possibleMoves: { ...structure.possibleMoves,
    bullish: { ...structure.possibleMoves.bullish, trigger: 95, target: 110, invalidation: 96 } } };
  const input = { instId: "ETH-USDT", timeframe: "1H", tier: "premium", lastPrice: 100,
    analysis: { bias: "bullish", confidence: 90, keyLevels: { support: [95], resistance: [110] } }, technical };
  const conditional = buildSpotExecutionPlan(input);
  assert.equal(conditional.buy.trigger, 95);
  assert.equal(conditional.buy.stopLoss, null);
  const immediate = buildSpotExecutionPlan({ ...input, entryMode: "market" });
  assert.equal(immediate.buy.trigger, 100);
  assert.equal(immediate.buy.orderType, "market");
  assert.equal(immediate.buy.stopLoss, 96);
  assert.equal(immediate.buy.takeProfit, 110);
  assert.equal(immediate.buy.valid, true);
});
