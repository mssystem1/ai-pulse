import test from "node:test";
import assert from "node:assert/strict";
import { terminalPositionQuantity, terminalDurationLabel, terminalCoverageLabel, terminalNextRadarClose, terminalPricePrecision, terminalValueReading } from "./terminalTradeReading";
import type { TerminalMarket } from "./terminalClient";

test("position size converts notional or margin once, and preserves actual base quantities", () => {
  assert.equal(terminalPositionQuantity(1000, "quote", 80000), .0125);
  assert.equal(terminalPositionQuantity(100, "margin", 80000, 10), .0125);
  assert.equal(terminalPositionQuantity(.02, "base", 80000, 10), .02);
  for (const size of [0, -1, NaN, Infinity]) assert.equal(terminalPositionQuantity(size, "quote", 80000), null);
  assert.equal(terminalPositionQuantity(100, "quote", 0), null);
  assert.equal(terminalPositionQuantity(100, "margin", 80000, 201), null);
});
test("coverage names distinguish a recent sample, a book snapshot and stale evidence", () => {
  assert.equal(terminalCoverageLabel({ id: "value", source: "test", status: "partial", knownAt: 1 }), "Recent executions");
  assert.equal(terminalCoverageLabel({ id: "liquidity", source: "test", status: "partial", knownAt: 1 }), "Order book now");
  assert.equal(terminalCoverageLabel({ id: "liquidity", source: "test", status: "stale", knownAt: 1 }), "Update needed");
  assert.equal(terminalDurationLabel(90500), "1m 30s");
});
test("low-price assets retain enough precision to distinguish quote and value-area levels", () => {
  assert.equal(terminalPricePrecision(80301.123), 2);
  assert.equal(terminalPricePrecision(1.01234), 4);
  assert.equal(terminalPricePrecision(.123456), 6);
  assert.equal(terminalPricePrecision(.00001234), 8);
});
test("Radar discloses the first wholly new completed candle, including a macro daily wait", () => {
  const started = Date.UTC(2026, 10, 5, 8, 21);
  assert.equal(terminalNextRadarClose("5m", started), Date.UTC(2026, 10, 5, 8, 30));
  assert.equal(terminalNextRadarClose("1Dutc", started), Date.UTC(2026, 10, 7));
  assert.equal(terminalNextRadarClose("5m", Date.UTC(2026, 10, 5, 8, 20)), Date.UTC(2026, 10, 5, 8, 25));
  assert.equal(terminalNextRadarClose("not-a-frame", started), null);
});
test("value reading follows quote/profile location and never substitutes an entry signal", () => {
  const market = { report: { currentMarket: { quote: { price: 101 } } }, tools: { value: { status: "partial", orderFlow: { profile: { val: 100, vah: 102 } } } } } as unknown as TerminalMarket;
  assert.match(terminalValueReading(market).title, /inside/);
  market.report.currentMarket!.quote!.price = 103; assert.match(terminalValueReading(market).title, /above/);
  market.report.currentMarket!.quote!.price = 99; assert.match(terminalValueReading(market).title, /below/);
  market.tools.value.status = "stale"; assert.match(terminalValueReading(market).title, /source first/);
});
