import test from "node:test";
import assert from "node:assert/strict";
import {loadTerminalParticipation} from "./terminalParticipation.js";

test("source retains actual spot/perpetual units and bounded interior trade window",async()=>{
  const now=Date.now();
  const fetchImpl:typeof fetch=async input=>{
    const url=new URL(String(input)),instId=url.searchParams.get("instId")!;let data:unknown[]=[];
    if(url.pathname.endsWith("history-trades"))data=[1000,2000,3000,4000].map((age,i)=>({instId,tradeId:String(100-i),ts:String(now-age),px:String(100+i),sz:"2",side:i%2?"sell":"buy"}));
    else if(url.pathname.endsWith("open-interest"))data=[{instId,oi:"120",oiUsd:"24000",ts:String(now)}];
    else if(url.pathname.endsWith("funding-rate"))data=[{instId,fundingRate:"-0.0001",fundingTime:String(now+3600000),ts:String(now)}];
    else if(url.pathname.endsWith("mark-price"))data=[{instId,markPx:"102",ts:String(now-500)}];
    else if(url.pathname.endsWith("books"))data=[{ts:String(now),seqId:"12",bids:[["100","2","0","1"]],asks:[["101","3","0","1"]]}];
    return new Response(JSON.stringify({code:"0",data}),{status:200});
  };
  const result=await loadTerminalParticipation({instId:"BTC-USDT",start:now-2500,end:now,fetchImpl});
  assert.equal(result.capture?.quantityUnit,"base");assert.equal(result.perpetualCapture?.quantityUnit,"contracts");assert.equal(result.capture?.marketType,"spot");assert.equal(result.perpetualCapture?.marketType,"perpetual");
  assert.equal(result.capture?.coverage.start,now-2500);assert.equal(result.capture?.coverage.end,now-1000);assert.ok(result.capture?.trades.every(t=>t.ts>=now-2500&&t.ts<now-1000));
  assert.equal(result.derivatives.openInterest,120);assert.equal(result.derivatives.fundingRate,-.0001);assert.equal(result.liquidity.sequence,12);
  assert.equal(result.derivatives.markPrice,102);assert.equal(result.derivatives.markPriceAt,now-500);assert.equal(result.derivatives.knownAt,now);
});
test("source outage never creates zero flow or candle-derived footprint",async()=>{
  const fetchImpl:typeof fetch=async()=>new Response("unavailable",{status:503}),now=Date.now();
  const result=await loadTerminalParticipation({instId:"BTC-USDT",start:now-1000,end:now,fetchImpl});
  assert.equal(result.capture,null);assert.equal(result.perpetualCapture,null);assert.equal(result.derivatives.openInterest,undefined);assert.equal(result.liquidity.bids,undefined);
});
