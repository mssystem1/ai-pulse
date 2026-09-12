import test from "node:test";
import assert from "node:assert/strict";
import { spotTradePerformance, type PerformanceFill } from "./tradePerformance.js";
const fill = (id: string, side: "buy" | "sell", quantity: number, value: number): PerformanceFill => ({ id, source: "spot", kind: `market_${side}`, status: "confirmed", txHash: id, pair: "ETH-USDT", fillSide: side, fillQuantity: quantity, fillQuoteValue: value, fillBaseAsset: "0xbase", fillQuoteAsset: "0xquote", createdAt: `2026-09-11T0${id}:00:00Z` });
test("realized Spot return weights cost and handles partial exits", () => {
  const result = spotTradePerformance([fill("1", "buy", 1, 100), fill("2", "buy", 3, 600), fill("3", "sell", 2, 400)]);
  assert.equal(result.realized, 50);
  assert.equal(result.matchedCost, 350);
  assert.equal(result.openCost, 350);
  assert.equal(result.realizedPct, 50 / 350 * 100);
});
test("limit fills count once, pending and Autopilot fills do not count", () => {
  const buy = fill("1", "buy", 1, 100), sell = { ...fill("2", "sell", 1, 110), source: "limit", kind: "automatic_fill" };
  const result = spotTradePerformance([buy, sell, { ...sell, id: "duplicate" }, { ...fill("3", "sell", 1, 150), status: "pending" }, { ...fill("4", "sell", 1, 150), source: "autopilot" }]);
  assert.equal(result.realized, 10);
  assert.equal(result.verifiedFills, 2);
});
test("unknown cost basis is not shown as profit", () => {
  assert.equal(spotTradePerformance([fill("1", "sell", 2, 200)]).realizedPct, null);
  assert.equal(spotTradePerformance([{ ...fill("1", "buy", 1, 100), fillQuantity: undefined }, fill("2", "sell", 1, 120)]).realizedPct, null);
});
test("empty history has unknown realized PnL, not a fabricated zero", () => {
  assert.equal(spotTradePerformance([]).realized, null);
});

test("open PnL uses remaining cost and needs every open market mark", () => {
  const history = [fill("1", "buy", 2, 200), fill("2", "sell", 1, 110)];
  assert.equal(spotTradePerformance(history).openPnlPct, null);
  const marked = spotTradePerformance(history, { "ETH-USDT": 120 });
  assert.equal(marked.openPnl, 20);
  assert.equal(marked.openPnlPct, 20);
});

test("different quote assets cannot be summed into one currency return", () => {
  const history = [fill("1", "buy", 1, 100), fill("2", "sell", 1, 110), { ...fill("3", "buy", 1, 50), fillQuoteAsset: "0xotherquote" }];
  assert.equal(spotTradePerformance(history).realizedPct, null);
});
