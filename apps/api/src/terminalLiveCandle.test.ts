import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalLiveCandles } from "./terminalLiveCandle.js";
const day=Date.UTC(2026,10,5),now=day+15*3600000;
test("only an actual developing exchange bar is returned and cache is exact pair/frame scoped",async()=>{
 let calls=0;const load=createTerminalLiveCandles({now:()=>now,load:async()=>{calls++;return[{ts:day,open:8,high:9,low:6,close:7,volume:4,volumeCcy:28,confirmed:false}];}});
 const a=await load("BTC-USDT","1Dutc");assert.equal(a.candle.confirmed,false);assert.equal(a.candle.open,8);await load("BTC-USDT","1Dutc");assert.equal(calls,1);
 await assert.rejects(load("BTCUSDT","1Dutc"));
});
test("completed, crossed-OHLC and obsolete source bars never replace a forming candle",async()=>{
 for(const change of [{confirmed:true},{ts:day-86400000},{high:2}]){
  const load=createTerminalLiveCandles({now:()=>now,load:async()=>[{ts:day,open:8,high:9,low:6,close:7,volume:4,volumeCcy:28,confirmed:false,...change}]});
  await assert.rejects(load("BTC-USDT","1Dutc"));
 }
});
