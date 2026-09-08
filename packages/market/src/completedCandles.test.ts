import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketContext, getCandles } from "./index.js";

test("Autopilot receives completed candles while chart context retains the live candle", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const data = String(input).includes("/candles?")
      ? [["2000", "100", "110", "99", "109", "1", "100", "100", "0"], ["1000", "95", "101", "94", "100", "1000", "100000", "100000", "1"]]
      : [{ instId: "TEST-USDT", last: "109", open24h: "95", high24h: "110", low24h: "94", vol24h: "1000", volCcy24h: "100000", ts: "2000" }];
    return new Response(JSON.stringify({ code: "0", data }), { status: 200 });
  };
  try {
    const raw = await getCandles("TEST-USDT");
    assert.equal(raw.length, 2);
    assert.equal(raw[1].confirmed, false);
    const closed = await buildMarketContext({ instId: "TEST-USDT", completedOnly: true });
    assert.equal(closed.candles.length, 1);
    assert.equal(closed.candles[0].ts, 1000);
    assert.equal(closed.ticker.last, 109);
    assert.equal((await buildMarketContext({ instId: "TEST-USDT" })).candles.length, 2);
  } finally { globalThis.fetch = previous; }
});
