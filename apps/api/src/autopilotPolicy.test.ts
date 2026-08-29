import assert from "node:assert/strict";
import test from "node:test";
import { boundedTargetSellAmount, evaluateAutopilotEntryCandidate, evaluateAutopilotPolicy, evaluateAutopilotRiskExit, identifyAutopilotStrategy, minimumOracleOutput } from "./autopilotPolicy.js";

const candles = (kind: "trend" | "breakout" | "range") => Array.from({ length: 60 }, (_, index) => {
  const base = kind === "range" ? 100 + Math.sin(index / 3) * 2 : 80 + index * .4;
  const close = kind === "breakout" && index === 59 ? 112 : base;
  return { ts: index, open: close - .2, high: close + .3, low: close - .5, close, volume: kind === "breakout" && index === 59 ? 2_000 : 1_000, volumeCcy: close * 1_000 };
});
const report = (bias = "bullish", confidence = 80, regime = "trend_up") => ({ analysis: { bias, confidence, regime, keyLevels: { support: [99] } }, executionPlan: { buy: { takeProfit: 120, stopLoss: 90 } } });

test("identifies every trader-facing strategy preset", () => {
  assert.equal(identifyAutopilotStrategy("Trend-following with Premium analysis"), "trend_following");
  assert.equal(identifyAutopilotStrategy("Breakout continuation"), "breakout");
  assert.equal(identifyAutopilotStrategy("Mean-reversion entries"), "mean_reversion");
});

test("trend following buys only when report and moving-average rules all pass", () => {
  const decision = evaluateAutopilotPolicy({ strategyType: "trend_following", candles: candles("trend"), report: report(), minConfidence: 70, hasPosition: false });
  assert.equal(decision.action, "buy");
  assert.equal(decision.rules.every((rule) => rule.passed), true);
  assert.equal(evaluateAutopilotPolicy({ strategyType: "trend_following", candles: candles("trend"), report: report("neutral", 80), minConfidence: 70, hasPosition: false }).action, "hold");
});

test("deterministic prefilter avoids AI unless the selected strategy has a plausible entry", () => {
  assert.equal(evaluateAutopilotEntryCandidate({ strategyType: "trend_following", candles: candles("trend") }).candidate, true);
  assert.equal(evaluateAutopilotEntryCandidate({ strategyType: "breakout", candles: candles("range") }).candidate, false);
  assert.equal(evaluateAutopilotEntryCandidate({ strategyType: "breakout", candles: candles("breakout") }).candidate, true);
});

test("breakout requires both a range break and volume confirmation", () => {
  const decision = evaluateAutopilotPolicy({ strategyType: "breakout", candles: candles("breakout"), report: report("bullish", 80, "transition"), minConfidence: 70, hasPosition: false });
  assert.equal(decision.action, "buy");
  assert.equal(decision.rules.find((rule) => rule.id === "breakout_volume")?.passed, true);
});

test("mean reversion requires support/RSI and a range-like regime", () => {
  const rangeCandles = candles("range");
  const meanReport = report("bullish", 80, "range");
  meanReport.analysis.keyLevels.support = [rangeCandles.at(-1)!.close];
  const decision = evaluateAutopilotPolicy({ strategyType: "mean_reversion", candles: rangeCandles, report: meanReport, minConfidence: 70, hasPosition: false });
  assert.equal(decision.action, "buy");
});

test("an owned position sells on TP, SL, bearish confirmation or strategy structure exit", () => {
  const takeProfit = evaluateAutopilotPolicy({ strategyType: "trend_following", candles: candles("trend"), report: report(), minConfidence: 70, hasPosition: true, activeTakeProfit: 100, activeStopLoss: 70 });
  assert.equal(takeProfit.action, "sell");
  assert.equal(takeProfit.rules.find((rule) => rule.id === "take_profit")?.passed, true);
  const noExit = evaluateAutopilotPolicy({ strategyType: "trend_following", candles: candles("trend"), report: report(), minConfidence: 70, hasPosition: true, activeTakeProfit: 200, activeStopLoss: 70 });
  assert.equal(noExit.action, "hold");
});

test("an owned position exits independently on stop-loss and a confirmed bearish report", () => {
  const stopCandles = candles("trend").map((candle, index) => index === 59
    ? { ...candle, close: 75, high: 76, low: 74 }
    : candle);
  const stopped = evaluateAutopilotPolicy({
    strategyType: "trend_following",
    candles: stopCandles,
    report: report(),
    minConfidence: 70,
    hasPosition: true,
    activeTakeProfit: 200,
    activeStopLoss: 90,
  });
  assert.equal(stopped.action, "sell");
  assert.equal(stopped.rules.find((rule) => rule.id === "stop_loss")?.passed, true);

  const bearish = evaluateAutopilotPolicy({
    strategyType: "breakout",
    candles: candles("trend"),
    report: report("bearish", 78, "trend_down"),
    minConfidence: 70,
    hasPosition: true,
    activeTakeProfit: 200,
    activeStopLoss: 70,
  });
  assert.equal(bearish.action, "sell");
  assert.equal(bearish.rules.find((rule) => rule.id === "bearish_report")?.passed, true);
});

test("every entry preset fails closed below its signed confidence threshold", () => {
  for (const strategyType of ["trend_following", "breakout", "mean_reversion"] as const) {
    const source = strategyType === "breakout" ? candles("breakout") : strategyType === "mean_reversion" ? candles("range") : candles("trend");
    const lowConfidence = report("bullish", 69, strategyType === "mean_reversion" ? "range" : "trend_up");
    if (strategyType === "mean_reversion") lowConfidence.analysis.keyLevels.support = [source.at(-1)!.close];
    const decision = evaluateAutopilotPolicy({ strategyType, candles: source, report: lowConfidence, minConfidence: 70, hasPosition: false });
    assert.equal(decision.action, "hold", strategyType);
    assert.equal(decision.rules.find((rule) => rule.id === "confidence")?.passed, false, strategyType);
  }
});

test("an initial hold does not block a later qualified buy", () => {
  const source = candles("trend");
  const watching = evaluateAutopilotPolicy({
    strategyType: "trend_following",
    candles: source,
    report: report("neutral", 55, "transition"),
    minConfidence: 70,
    hasPosition: false,
  });
  assert.equal(watching.action, "hold");

  const laterQualifiedEntry = evaluateAutopilotPolicy({
    strategyType: "trend_following",
    candles: source,
    report: report("bullish", 80, "trend_up"),
    minConfidence: 70,
    hasPosition: false,
  });
  assert.equal(laterQualifiedEntry.action, "buy");
  assert.equal(laterQualifiedEntry.rules.every((rule) => rule.passed), true);
});

test("the deterministic lifecycle is buy, hold while protected, then sell on take-profit", () => {
  const entryCandles = candles("trend");
  const entry = evaluateAutopilotPolicy({ strategyType: "trend_following", candles: entryCandles, report: report(), minConfidence: 70, hasPosition: false });
  assert.equal(entry.action, "buy");

  const protectedHold = evaluateAutopilotPolicy({ strategyType: "trend_following", candles: entryCandles, report: report(), minConfidence: 70, hasPosition: true, activeTakeProfit: 120, activeStopLoss: 70 });
  assert.equal(protectedHold.action, "hold");

  const takeProfitCandles = entryCandles.map((candle, index) => index === 59 ? { ...candle, close: 121, high: 122, low: 120 } : candle);
  const exit = evaluateAutopilotPolicy({ strategyType: "trend_following", candles: takeProfitCandles, report: report(), minConfidence: 70, hasPosition: true, activeTakeProfit: 120, activeStopLoss: 70 });
  assert.equal(exit.action, "sell");
  assert.equal(exit.reason, "Take-profit reached");
});

test("an exit is split into vault-bounded chunks without losing target decimal precision", () => {
  const fullBalance = 2n * 10n ** 18n;
  const oneHundredUsdcAt2500 = boundedTargetSellAmount({
    targetBalance: fullBalance,
    maxTradeValue: 100n * 10n ** 6n,
    priceE18: 2_500n * 10n ** 18n,
    targetDecimals: 18,
    settlementDecimals: 6,
  });
  assert.equal(oneHundredUsdcAt2500, 4n * 10n ** 16n);
  assert.equal(boundedTargetSellAmount({ targetBalance: 1n, maxTradeValue: 100n * 10n ** 6n, priceE18: 2_500n * 10n ** 18n, targetDecimals: 18, settlementDecimals: 6 }), 1n);
});

test("an appreciated position is split evenly instead of leaving unquotable dust", () => {
  const targetBalance = 1_035_205n;
  const first = boundedTargetSellAmount({
    targetBalance,
    maxTradeValue: 100_000n,
    priceE18: 96_640_000_000_000_000_000n,
    targetDecimals: 9,
    settlementDecimals: 6,
  });
  const second = boundedTargetSellAmount({
    targetBalance: targetBalance - first,
    maxTradeValue: 100_000n,
    priceE18: 96_640_000_000_000_000_000n,
    targetDecimals: 9,
    settlementDecimals: 6,
  });

  assert.equal(first, 517_603n);
  assert.equal(second, 517_602n);
  assert.equal(first + second, targetBalance);
});

test("a triggered partial exit stays latched until the target balance is closed", () => {
  const decision = evaluateAutopilotPolicy({
    strategyType: "trend_following",
    candles: candles("trend"),
    report: report("neutral", 55, "trend_up"),
    minConfidence: 70,
    hasPosition: true,
    exitPending: true,
    activeTakeProfit: 200,
    activeStopLoss: 70,
  });

  assert.equal(decision.action, "sell");
  assert.equal(decision.reason, "Complete triggered bounded exit");
  assert.equal(decision.rules.find((rule) => rule.id === "exit_completion")?.passed, true);
});

test("the fast risk monitor executes live TP/SL without another Premium report", () => {
  const takeProfit = evaluateAutopilotRiskExit({ strategyType: "trend_following", mark: 103.2, hasPosition: true, activeTakeProfit: 103.16, activeStopLoss: 93.26, cooldownReady: true });
  const stopLoss = evaluateAutopilotRiskExit({ strategyType: "trend_following", mark: 93.2, hasPosition: true, activeTakeProfit: 103.16, activeStopLoss: 93.26, cooldownReady: true });

  assert.equal(takeProfit.action, "sell");
  assert.equal(takeProfit.reason, "Live take-profit reached");
  assert.equal(stopLoss.action, "sell");
  assert.equal(stopLoss.reason, "Live stop-loss reached");
});

test("a latched partial exit waits for cooldown then resumes without xAI", () => {
  const coolingDown = evaluateAutopilotRiskExit({ strategyType: "trend_following", mark: 101, hasPosition: true, exitPending: true, activeTakeProfit: 103.16, activeStopLoss: 93.26, cooldownReady: false, cooldownRemainingSeconds: 61 });
  const ready = evaluateAutopilotRiskExit({ strategyType: "trend_following", mark: 101, hasPosition: true, exitPending: true, activeTakeProfit: 103.16, activeStopLoss: 93.26, cooldownReady: true });

  assert.equal(coolingDown.action, "hold");
  assert.match(coolingDown.reason, /cooldown/i);
  assert.equal(ready.action, "sell");
  assert.equal(ready.reason, "Complete triggered bounded exit");
});

test("oracle minimum output matches the vault for buys and sells", () => {
  assert.equal(minimumOracleOutput({ action: "sell", sellAmount: 517603n, priceE18: 104090000000000000000n, targetDecimals: 9, settlementDecimals: 6, slippageBps: 150n }), 53068n);
  assert.equal(minimumOracleOutput({ action: "buy", sellAmount: 100000n, priceE18: 100000000000000000000n, targetDecimals: 9, settlementDecimals: 6, slippageBps: 150n }), 985000n);
});
