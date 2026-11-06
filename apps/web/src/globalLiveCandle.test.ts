import test from "node:test";
import assert from "node:assert/strict";
import type { GlobalReport } from "@pulse/domain";
import { globalLiveCandle, type GlobalLiveCandle } from "./globalLiveCandle";
const now=Date.UTC(2026,10,5,15),day=Date.UTC(2026,10,5);
const report={snapshot:{instId:"BTC-USDT",timeframe:"1Dutc"},candles:[{ts:day-86400000,close:80000}]} as GlobalReport;
const live:GlobalLiveCandle={instId:"BTC-USDT",timeframe:"1Dutc",observedAt:now,candle:{ts:day,open:79000,high:79500,low:76000,close:77000,volume:45,confirmed:false}};
test("a real developing candle follows the same-period quote without changing saved history",()=>{
 const before=JSON.stringify(report),next=globalLiveCandle(report,live,{price:75500,ts:now,observedAt:now},now)!;
 assert.equal(next.open,79000);assert.equal(next.close,75500);assert.equal(next.low,75500);assert.equal(next.volume,45);assert.equal(JSON.stringify(report),before);
});
test("wrong assets, old candles, stale observations and past/future-period quotes cannot manufacture a live bar",()=>{
 assert.equal(globalLiveCandle(report,{...live,instId:"ETH-USDT"},undefined,now),null);
 assert.equal(globalLiveCandle(report,{...live,observedAt:now-90001},undefined,now),null);
 assert.equal(globalLiveCandle(report,{...live,candle:{...live.candle,ts:day-86400000}},undefined,now),null);
 assert.equal(globalLiveCandle(report,live,{price:1,ts:day-1},now)!.close,77000);
 assert.equal(globalLiveCandle(report,undefined,{price:1,ts:now},now),null);
});
