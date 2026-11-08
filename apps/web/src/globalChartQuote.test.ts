import test from "node:test";
import assert from "node:assert/strict";
import type { GlobalReport } from "@pulse/domain";
import { globalLogicalSetupWindow, globalVisibleCandleExtrema, globalVisibleTimeCandleExtrema, resolveGlobalChartQuote } from "./globalChartQuote.js";

const now = Date.parse("2026-11-05T08:00:00Z");
const report = { snapshot: { price: 82_109 }, candles: [{ close: 82_109 }], currentMarket: { source: "saved-source", quote: { price: 80_600, ts: now - 3_600_000 } } } as unknown as GlobalReport;

test("one fresh market quote stays independent of the completed candle or timeframe", () => {
  const quote = { price: 80_400, ts: now - 1_000, source: "live-source" };
  for (const timeframe of ["15m", "1H", "4H", "1Dutc", "1Wutc"]) {
    const selected = { ...report, snapshot: { ...report.snapshot, timeframe } } as GlobalReport;
    assert.deepEqual(resolveGlobalChartQuote(selected, quote, now), { ...quote, kind: "current" });
  }
  assert.equal(report.snapshot.price, 82_109);
});

test("stale, future and invalid live quotes fall back to a clearly identified saved quote", () => {
  for (const quote of [{ price: 1, ts: now - 90_001 }, { price: 1, ts: now + 5_001 }, { price: NaN, ts: now }, { price: 0, ts: now }]) {
    assert.deepEqual(resolveGlobalChartQuote(report, quote, now), { ...report.currentMarket!.quote!, source: "saved-source", kind: "snapshot" });
  }
  assert.equal(resolveGlobalChartQuote({ ...report, currentMarket: undefined }, undefined, now), null);
});

test("visible weekly wicks are always included without fitting all saved history", () => {
  const candles = [{ low: 100, high: 120 }, { low: 80, high: 124_500 }, { low: 75, high: 90 }, { low: 70, high: 95 }];
  assert.deepEqual(globalVisibleCandleExtrema(candles, { from: .5, to: 2.5 }), { minValue: 70, maxValue: 124_500 });
  assert.deepEqual(globalVisibleCandleExtrema(candles, { from: 2, to: 303 }), { minValue: 70, maxValue: 95 });
  assert.equal(globalVisibleCandleExtrema(candles, { from: 4, to: 300 }), null);
});

test("daily and weekly autoscale follows UTC time when minute studies expand the shared logical axis", () => {
  const day = 86_400_000, start = Date.parse("2026-11-02T00:00:00Z");
  for (const candleInterval of [day, 7 * day]) {
    const candles = [
      { ts: start, low: 10, high: 1_000 },
      { ts: start + candleInterval, low: 74_000, high: 83_000 },
      { ts: start + 2 * candleInterval, low: 72_000, high: 124_500 },
      { ts: start + 3 * candleInterval, low: 1, high: 200_000 },
    ];
    // A minute series contributes 1,440 (or 10,080) timestamps between
    // candles. Those union indices cannot be used as candle-array indices.
    const minuteLogicalIndex = candleInterval / 60_000;
    assert(minuteLogicalIndex > candles.length);
    assert.deepEqual(globalVisibleTimeCandleExtrema(candles, {
      from: (start + candleInterval) / 1000,
      to: (start + 2 * candleInterval) / 1000,
    }), { minValue: 72_000, maxValue: 124_500 });
    assert.equal(globalVisibleTimeCandleExtrema(candles, {
      from: (start + candleInterval + 60_000) / 1000,
      to: (start + 2 * candleInterval - 60_000) / 1000,
    }), null, "minute-only time does not manufacture a price candle");
    assert.equal(globalVisibleTimeCandleExtrema(candles, {
      from: (start + 4 * candleInterval) / 1000,
      to: (start + 5 * candleInterval) / 1000,
    }), null, "setup whitespace does not expand the wick range");
  }
});

test("UTC candle selection rejects unsupported business-day ranges and keeps inclusive boundary wicks", () => {
  const candles = [{ ts: 60_000, low: 12, high: 18 }, { ts: 120_000, low: 2, high: 25 }];
  assert.deepEqual(globalVisibleTimeCandleExtrema(candles, { from: 120, to: 120 }), { minValue: 2, maxValue: 25 });
  assert.equal(globalVisibleTimeCandleExtrema(candles, null), null);
  assert.equal(globalVisibleTimeCandleExtrema(candles, { from: "2026-11-02", to: "2026-11-03" }), null);
});

test("setup reset reserves plan space from actual union indices and retains a shifted daily viewport", () => {
  const first = 1_440, last = 4_320, width = 1_000;
  const reset = globalLogicalSetupWindow(first, last, width);
  assert.deepEqual(reset, { from: first, to: 5_555 });
  const shifted = globalLogicalSetupWindow(first + 20_000, last + 20_000, width);
  assert.deepEqual(shifted, { from: reset.from + 20_000, to: reset.to + 20_000 });
  assert.deepEqual(globalLogicalSetupWindow(first, last, width, true), { from: first - 5, to: reset.to });
  assert(reset.to > last, "the plan gets right-side space without hiding the selected candle interval");
});
