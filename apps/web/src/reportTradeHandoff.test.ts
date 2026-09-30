import test from "node:test";
import assert from "node:assert/strict";
import { rebaseReportTrade, buildReportBuyIntent } from "./reportTradeHandoff";

// Minimal, non-sensitive reproduction of the saved XADBE report in the HAR.
const savedReport = { instId: "XADBE-USDT", tier: "premium", analysis: { bias: "bearish", confidence: 35 },
  executionPlan: { pair: "XADBE-USDT", timeframe: "1H", observedPrice: 229.24, recommendation: { action: "wait" },
    buy: { trigger: 229.07, takeProfit: 236.6, stopLoss: 228.742437 } } };
for (const orderType of ["market", "limit"] as const) {
  test(`saved Wait report carries conditional protection into ${orderType} tickets on all execution chains`, () => {
    for (const network of ["base", "arbitrum", "xlayer", "robinhood"]) {
      const draft = buildReportBuyIntent(savedReport, orderType);
      const ticket = network === "robinhood" ? rebaseReportTrade(draft, "ADBE.232B8ED6377BE978-USDG", 458.48) : draft;
      const factor = network === "robinhood" ? 2 : 1;
      assert.equal(ticket.entryPrice, 229.07 * factor);
      assert.equal(ticket.takeProfit, 236.6 * factor);
      assert.equal(ticket.stopLoss, 228.742437 * factor);
      assert.equal(ticket.orderType, orderType);
      assert.match(ticket.rationale, /Manual trade selected with risk acceptance/);
      assert.doesNotMatch(ticket.rationale, /\bWAIT\b/);
    }
  });
}
test("invalid long protection is not copied from a historical report", () => {
  const draft = buildReportBuyIntent({ ...savedReport, executionPlan: { ...savedReport.executionPlan, buy: { trigger: 229, takeProfit: 240, stopLoss: 235 } } }, "limit");
  assert.equal(draft.stopLoss, undefined);
  assert.match(draft.rationale, /no valid long protection/);
});

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
