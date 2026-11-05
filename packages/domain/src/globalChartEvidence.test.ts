import test from "node:test";
import assert from "node:assert/strict";
import { globalDesignFixture } from "./globalReport.fixtures.js";
import { globalReportChartSvg } from "./globalChart.js";
import { globalOrderFlowAnnotations, globalOrderFlowCoverageLabel } from "./globalOrderFlow.js";

test("saved and explicit live quote markers stay distinct from candle closes without changing the report", () => {
  const report = globalDesignFixture("pro");
  const ts = Date.parse(report.snapshot.observedAt);
  report.currentMarket = { source: "captured-source", quote: { price: 125, ts }, frames: [] };
  const before = JSON.stringify(report);
  const saved = globalReportChartSvg(report)!;
  assert.match(saved, /data-quote-kind="snapshot" data-quote-price="125"/);
  assert.match(saved, /SNAPSHOT QUOTE/);
  assert.match(saved, /LAST CLOSE/);
  const current = globalReportChartSvg(report, { quoteMarker: { price: 130, ts: ts + 1000, kind: "current" } })!;
  assert.match(current, /data-quote-kind="current" data-quote-price="130"/);
  assert.match(current, /CURRENT QUOTE/);
  assert.equal(JSON.stringify(report), before);
});

test("a compressed recent profile discloses its real window and separates labels without moving levels", () => {
  const report = globalDesignFixture("pro"), start = Date.parse("2026-11-05T08:10:01Z"), end = start + 184_000;
  report.orderFlow = {
    version: "trade-flow-v1", source: "captured-test-source", instId: report.snapshot.instId, priceCurrency: "USDT", marketType: "spot", quantityUnit: "base", capturedAt: new Date(end).toISOString(),
    coverage: { start, end, knownAt: end, complete: true, sha256: ["0".repeat(64)] },
    profile: { timeframe: "1Wutc", start, end, knownAt: end, rowSize: 1, valueFraction: .7, poc: 80550, val: 80549, vah: 80551, open: 80550, high: 80551, low: 80549, close: 80550, buy: 1, sell: 1, volume: 2, delta: 0, trades: 600, rows: [{ low: 80549, high: 80550, buy: 1, sell: 1, trades: 600 }] }, footprints: [],
  };
  const label = globalOrderFlowCoverageLabel(report);
  assert.match(label, /600 trades/); assert.match(label, /2026-11-05 08:10:01/); assert.match(label, /2026-11-05 08:13:05/);
  const svg = globalOrderFlowAnnotations(report, { x: () => 200, y: price => 300 - price / 100_000, left: 10, right: 900, top: 20, bottom: 500, historyEnd: 700 });
  assert.match(svg, /data-profile-trades="600"/); assert.match(svg, /Execution sample/);
  const labels = [...svg.matchAll(/data-profile-level="(POC|VAL|VAH)" data-price="([^"]+)" data-label-y="([^"]+)"/g)];
  assert.equal(labels.length, 3);
  assert.deepEqual(new Set(labels.map(row => Number(row[2]))), new Set([80549, 80550, 80551]));
  const ys = labels.map(row => Number(row[3])).sort((a, b) => a - b);
  assert.ok(ys[1] - ys[0] >= 16 && ys[2] - ys[1] >= 16);
});
