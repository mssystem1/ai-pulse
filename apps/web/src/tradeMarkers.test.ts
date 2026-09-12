import test from "node:test";
import assert from "node:assert/strict";
import { confirmedTradeMarkers, visibleTradeMarkers, type ChartActivity } from "./marketPreview.js";
const fill: ChartActivity = { id: "a", source: "spot", kind: "market_buy", status: "confirmed", pair: "ETH-USDT", fillPrice: 2000, txHash: "0xabc", createdAt: "2026-09-11T08:00:00Z" };
test("chart markers exclude pending transactions, other pairs and Autopilot accounts", () => {
  const items = [fill, { ...fill, id: "duplicate" }, { ...fill, status: "pending" }, { ...fill, pair: "BTC-USDT" }, { ...fill, source: "autopilot", account: "0x1", txHash: "0xdef" }];
  assert.equal(confirmedTradeMarkers(items, "ETH-USDT").length, 1);
  assert.equal(confirmedTradeMarkers(items, "ETH-USDT", "0x1").length, 1);
  assert.equal(confirmedTradeMarkers(items, "ETH-USDT", "0x2").length, 0);
});
test("limit fills require a verified side and use receipt time", () => {
  assert.equal(confirmedTradeMarkers([{ ...fill, kind: "automatic_fill" }], "ETH-USDT").length, 0);
  const result = confirmedTradeMarkers([{ ...fill, kind: "automatic_fill", fillSide: "sell", fillObservedAt: "2026-09-11T07:00:00Z" }], "ETH-USDT");
  assert.equal(result[0].side, "sell");
  assert.equal(result[0].ts, Date.parse("2026-09-11T07:00:00Z"));
});
test("out-of-window fills are not clamped onto the newest candle", () => {
  const candles = [1000, 2000].map(ts => ({ ts, open: 1, high: 2, low: 1, close: 2, volume: 1 }));
  const markers = [500, 1500, 2500, 3500].map(ts => ({ id: String(ts), ts, price: 1, side: "buy" as const, txHash: "0xabc" }));
  assert.deepEqual(visibleTradeMarkers(markers, candles).map(m => m.ts), [1500, 2500]);
});
