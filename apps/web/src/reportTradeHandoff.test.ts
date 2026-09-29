import test from "node:test";
import assert from "node:assert/strict";
import { rebaseReportTrade } from "./reportTradeHandoff";

const intent = { pair: "XAVGO-USDT", timeframe: "15m", side: "buy" as const, orderType: "limit" as const,
  observedPrice: 100, entryPrice: 95, takeProfit: 110, stopLoss: 90, rationale: "Report setup", sourceTier: "premium" };
test("Robinhood handoff carries trigger and protection with consistent USDG conversion", () => {
  const converted = rebaseReportTrade(intent, "AVGO.156E175DD063A8CE-USDG", 200);
  assert.equal(converted.entryPrice, 190);
  assert.equal(converted.takeProfit, 220);
  assert.equal(converted.stopLoss, 180);
  assert.equal(converted.orderType, "limit");
  assert.match(converted.rationale, /adjusted levels/);
  assert.equal(intent.entryPrice, 95);
});
test("missing or invalid references never silently copy raw research prices", () => {
  for (const observedPrice of [undefined, 0, NaN, Infinity]) assert.throws(() => rebaseReportTrade({ ...intent, observedPrice }, "target", 200));
  assert.throws(() => rebaseReportTrade(intent, "target", 0));
});
