import test from "node:test";
import assert from "node:assert/strict";
import { indicatorMarketCatalog, evaluateIndicator } from "@pulse/domain";
import { indicatorInputFromMarket, installIndicator, loadInstalledIndicators } from "./terminalIndicatorClient";
import type { TerminalMarket } from "./terminalClient";

test("Portable indicators stay bound to the selected stream and exact source window", () => {
  const now = Date.now(), start = now - 120000, end = now - 60000;
  const flow = { source: "real-spot", status: "partial", knownAt: now, windowStart: start, windowEnd: end, marketType: "spot", points: [{ ts: start, buy: 4, sell: 2, delta: 2, cvd: 2 }] };
  const market = { instId: "ETH-USDT", timeframe: "1H", tools: { flow } } as unknown as TerminalMarket;
  const input = indicatorInputFromMarket(market, "spot", now), result = evaluateIndicator(indicatorMarketCatalog()[0], input);
  assert.equal(result.status, "partial"); assert.equal(result.provenance.windowStart, start); assert.equal(result.provenance.units, "base"); assert(Math.abs(result.summary.cvd! - 2) < .001);
  const missing = indicatorInputFromMarket(market, "perpetual", now); assert.equal(missing.status, "unavailable"); assert.equal(missing.units, "contracts"); assert.equal(missing.points.length, 0);
});
test("Live assessment display buckets clip to actual sample edges without losing executed quantities", () => {
  const now = Date.now(), start = now - 120000, end = now - 60000;
  const market = { instId:"BTC-USDT",timeframe:"1H",tools:{flow:{source:"captured-trades",status:"partial",knownAt:now,windowStart:start,windowEnd:end,marketType:"spot",points:[],displayPoints:[{ts:start-17000,end:end+20000,buy:12,sell:8}]}} } as unknown as TerminalMarket;
  const input=indicatorInputFromMarket(market,"spot",now);
  assert.deepEqual(input.points,[{ts:start,end,buy:12,sell:8}]);
  const result=evaluateIndicator(indicatorMarketCatalog()[0],input);
  assert.equal(result.status,"partial");assert(Math.abs(result.summary.cvd!-4)<.001);
});
test("Installed library validates imported packages, preserves explicit empty state and detects version conflicts", () => {
  const seeds = indicatorMarketCatalog();
  assert.equal(loadInstalledIndicators({ getItem: () => null }, seeds).length, 1);
  assert.equal(loadInstalledIndicators({ getItem: () => "[]" }, seeds).length, 0);
  assert.equal(installIndicator(seeds, seeds[0]), seeds);
  assert.throws(() => installIndicator(seeds, { ...seeds[0], title: "Changed content" }), /different content/);
  assert.throws(() => loadInstalledIndicators({ getItem: () => JSON.stringify([{ ...seeds[0], runtime: { ...seeds[0].runtime, netlist: "0x00" } }]) }, seeds), /unreviewed/);
});
