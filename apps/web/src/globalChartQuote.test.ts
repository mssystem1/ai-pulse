import test from "node:test";
import assert from "node:assert/strict";
import type { GlobalReport } from "@pulse/domain";
import { globalVisibleCandleExtrema, resolveGlobalChartQuote } from "./globalChartQuote.js";

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
