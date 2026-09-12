import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarketPreviewLoader, loadHistoricalCandles, sparklinePoints } from "./marketPreview";

test("historical chart pages exclude overlaps, deduplicate, and distinguish failure from end of history", async () => {
  let path = "";
  const read = async (url: string) => { path = url; return { ok: true, status: 200, data: { candles: [...candles, candles[1], { ...candles[0], ts: 3 }] } }; };
  assert.deepEqual((await loadHistoricalCandles(read, "BTC-USDT", "1H", 3)).map(c => c.ts), [1, 2]);
  assert.match(path, /before=3/);
  assert.deepEqual(await loadHistoricalCandles(async () => ({ok:true,status:200,data:{candles:[]}}), "BTC-USDT", "1H", 3), []);
  await assert.rejects(loadHistoricalCandles(async () => ({ok:false,status:502,data:{}}), "BTC-USDT", "1H", 3), /temporarily unavailable/);
  await assert.rejects(loadHistoricalCandles(async () => ({ok:true,status:200,data:{candles:[{...candles[0],ts:NaN}]}}), "BTC-USDT", "1H", 3), /valid older candles/);
});

const ticker = { instId: "BTC-USDT", last: 100, change24hPct: 1, high24h: 110, low24h: 90, volCcy24h: 500, ts: "1000" };
const candles = [2, 1].map(ts => ({ ts, open: 100, high: 105, low: 95, close: 102, volume: 10 }));

test("Global and Spot share in-flight reads and expire the cached snapshot after 30s", async () => {
  let calls = 0, now = 1000;
  const load = createMarketPreviewLoader(async path => { calls++; return { ok: true, status: 200, data: path.includes("ticker") ? { ticker } : { candles } }; }, () => now);
  const [one, two] = await Promise.all([load("BTC-USDT", "1H"), load("BTC-USDT", "1H")]);
  assert.equal(calls, 2);
  assert.equal(one, two);
  assert.deepEqual(one.candles.map(c => c.ts), [1, 2]);
  await load("BTC-USDT", "1H");
  assert.equal(calls, 2);
  now += 30_001;
  await load("BTC-USDT", "1H");
  assert.equal(calls, 4);
  await load("BTC-USDT", "4H");
  assert.equal(calls, 6);
});

test("a missing or mismatched pair never receives another pair's market data", async () => {
  const load = createMarketPreviewLoader(async path => ({ ok: true, status: 200, data: path.includes("ticker") ? { ticker } : { candles } }));
  await assert.rejects(load("ETH-USDT", "1H"), /incomplete/);
});

test("provider failures have a brief negative cache but can recover", async () => {
  let calls = 0, now = 0, failed = true;
  const load = createMarketPreviewLoader(async path => { calls++; return { ok: !failed, status: failed ? 503 : 200, data: path.includes("ticker") ? { ticker } : { candles } }; }, () => now);
  await assert.rejects(load("BTC-USDT", "1H"));
  await assert.rejects(load("BTC-USDT", "1H"));
  assert.equal(calls, 2);
  failed = false; now = 5001;
  assert.equal((await load("BTC-USDT", "1H")).ticker.last, 100);
  assert.equal(calls, 4);
});

test("sparklines preserve flat and micro-price data without invented movements", () => {
  assert.equal(sparklinePoints([1, 1]), "0.00,28.00 240.00,28.00");
  assert.equal(sparklinePoints([.000001, .000002]), "0.00,52.00 240.00,4.00");
  assert.equal(sparklinePoints([NaN, 2]), "");
  assert.equal(sparklinePoints([]), "");
});
