import test from "node:test";
import assert from "node:assert/strict";
import { terminalAcceptLiveQuote, type TerminalLiveQuote } from "./terminalLiveQuote";
const now = Date.UTC(2026, 10, 5, 12), quote: TerminalLiveQuote = { instId: "BTC-USDT", price: 80301, ts: now, observedAt: now, source: "okx-public-spot" };
test("one asset quote stays monotonic across chart frames and delayed responses", () => {
  const first = terminalAcceptLiveQuote(null, quote, "BTC-USDT", now)!;
  assert.equal(terminalAcceptLiveQuote(first, { ...quote, ts: now - 1000, price: 77742.9 }, "BTC-USDT", now), first);
  assert.equal(terminalAcceptLiveQuote(first, { ...quote, price: 1 }, "BTC-USDT", now), first);
  assert.equal(terminalAcceptLiveQuote(first, { ...quote, ts: now + 1000, price: 80302 }, "BTC-USDT", now)?.price, 80302);
});
test("a quote must belong to this market and a fresh real source, never another asset or candle close", () => {
  assert.equal(terminalAcceptLiveQuote(null, quote, "ETH-USDT", now), null);
  assert.equal(terminalAcceptLiveQuote(null, { ...quote, source: "completed-weekly-close" }, "BTC-USDT", now), null);
  for (const ts of [now - 30001, now + 5001, NaN, 1.1]) assert.equal(terminalAcceptLiveQuote(null, { ...quote, ts }, "BTC-USDT", now), null);
  assert.equal(terminalAcceptLiveQuote(null, { ...quote, price: Infinity }, "BTC-USDT", now), null);
});
