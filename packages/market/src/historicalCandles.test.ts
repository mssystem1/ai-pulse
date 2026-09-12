import test from "node:test";
import assert from "node:assert/strict";
import { getHistoricalCandles } from "./index.js";

test("older candle requests use history-candles with OKX's after cursor", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async input => {
    urls.push(String(input));
    return new Response(JSON.stringify({ code: "0", data: [["2000","10","12","9","11","1","1","1","1"],["1000","9","11","8","10","1","1","1","1"]] }));
  }) as typeof fetch;
  try {
    const rows = await getHistoricalCandles("HISTORYTEST-USDT", "1H", 100, 2000);
    assert.match(urls[0], /history-candles\?.*after=2000/);
    assert.deepEqual(rows.map(row => row.ts), [1000]);
    assert.equal(rows[0].confirmed, true);
    await assert.rejects(getHistoricalCandles("HISTORYTEST-USDT", "1H", -1, 2000));
    await assert.rejects(getHistoricalCandles("HISTORYTEST-USDT", "1H", 100, NaN));
    await assert.rejects(getHistoricalCandles("HISTORYCURSORTEST-USDT", "1H", 100, 500), /did not advance/);
    globalThis.fetch = (async () => new Response(JSON.stringify({code:"0",data:[["bad","10","12","9","11"]]}))) as typeof fetch;
    await assert.rejects(getHistoricalCandles("HISTORYINVALIDTEST-USDT", "1H", 100, 2000), /Invalid historical candle data/);
  } finally { globalThis.fetch = original; }
});
