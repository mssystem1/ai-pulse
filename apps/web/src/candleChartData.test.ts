import test from "node:test";
import assert from "node:assert/strict";
import { candlePriceStep, chartCandles, chartFillMarkers, readableCandleCount, timeframeSeconds } from "./candleChartData";
import type { MarketCandle, TradeMarker } from "./marketPreview";

const bar = (ts: number): MarketCandle => ({ ts, open: 100, high: 103, low: 98, close: 102, volume: 50 });
const fill = (id: string, ts: number, side: "buy" | "sell" = "buy"): TradeMarker => ({ id, ts, side, price: 100, txHash: `0x${id}` });

test("chart rows use ascending unique UTC seconds and reject malformed OHLC", () => {
  const rows=chartCandles([bar(7200000),bar(3600000),{...bar(3600100),close:101},{...bar(9000000),low:104}]);
  assert.deepEqual(rows.map(row=>row.time),[3600,7200]);
  assert.equal(rows[0].close,101);
});

test("confirmed fills align with their candle, never a missing interval or unrelated time", () => {
  const bars=chartCandles([bar(3600000),bar(10800000)]);
  const markers=chartFillMarkers([fill("a",3600100),fill("a",3600100),fill("b",3600200),fill("s",3600300,"sell"),fill("gap",7200010),fill("old",1000),fill("future",14400000)],bars,"1H");
  assert.equal(markers.length,2);
  assert.equal(markers[0].text,"B ×2");
  assert.equal(markers[0].position,"belowBar");
  assert.equal(markers[1].position,"aboveBar");
  assert.ok(markers.every(marker=>marker.time===3600&&!Object.hasOwn(marker,"price")));
  assert.equal(chartFillMarkers([fill("single",3600100)],bars.slice(0,1),"1H").length,1);
});

test("micro-priced assets retain meaningful price precision; mobile starts with readable spacing", () => {
  assert.equal(candlePriceStep(chartCandles([bar(3600000)])),.001);
  const tiny=chartCandles([{...bar(3600000),open:1e-8,high:1.1e-8,low:.9e-8,close:1.01e-8}]);
  assert.ok(candlePriceStep(tiny)<1e-10);
  assert.ok(readableCandleCount(310)<=30);
  assert.ok(readableCandleCount(900)>60);
  assert.equal(timeframeSeconds("15m"),900);
  assert.equal(timeframeSeconds("4H"),14400);
  assert.equal(timeframeSeconds("1D"),86400);
});
