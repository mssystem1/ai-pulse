import test from "node:test";
import assert from "node:assert/strict";
import {candleCloseTime,candleTimeframeMs,parseCandleTimeframe} from "@pulse/schemas";
import {globalFrameEvidence} from "./globalReport.js";

test("fixed and calendar clocks preserve minutes, month case and UTC+8 boundaries",()=>{
  assert.equal(candleTimeframeMs("5m"),300000);assert.equal(candleTimeframeMs("1M"),0);assert.equal(candleTimeframeMs("2H"),7200000);
  assert.equal(candleCloseTime(Date.UTC(2024,1,1),"1Mutc"),Date.UTC(2024,2,1));
  assert.equal(candleCloseTime(Date.UTC(2025,11,31,16),"1M"),Date.UTC(2026,0,31,16));
  assert.equal(candleCloseTime(Date.UTC(2026,0,1),"3Mutc"),Date.UTC(2026,3,1));
});

test("mutating a public parse result cannot poison cached close-time metadata",()=>{
  const at=Date.UTC(2026,0,1);assert.equal(candleCloseTime(at,"1H"),at+3600000);
  const publicFrame=parseCandleTimeframe("1H")!;publicFrame.count=99;publicFrame.unit="month";
  assert.equal(candleTimeframeMs("1H"),3600000);assert.equal(candleCloseTime(at,"1H"),at+3600000);
  for(let i=0;i<150;i++)assert.equal(candleCloseTime(at,`invalid-${i}`),null);
  assert.equal(candleCloseTime(at,"1H"),at+3600000);assert.equal(candleCloseTime(Infinity,"1H"),null);
});

test("reused frame evidence retains fresh source identity, observation and expiry",()=>{
  const start=Date.UTC(2026,0,1),candles=Array.from({length:55},(_,i)=>({ts:start+i*3600000,open:100+i,high:103+i,low:98+i,close:101+i,volume:10,confirmed:true})),closed=start+55*3600000;
  const source={bar:"1H",source:"venue-one",fetchedAt:new Date(closed).toISOString(),candles},first=globalFrameEvidence(source);
  assert.equal(first.price,155);assert.equal(first.sma55,128);assert.equal(first.status,"available");
  const other=globalFrameEvidence({...source,source:"venue-two"},new Date(closed+1800000).toISOString());assert.equal(other.source,"venue-two");assert.equal(other.observedAt,new Date(closed+1800000).toISOString());assert.equal(other.price,155);
  const stale=globalFrameEvidence(source,new Date(closed+3600000+60001).toISOString());assert.equal(stale.status,"unavailable");assert.equal(stale.completedAt,closed);
  first.price=1;first.sma55=1;assert.equal(globalFrameEvidence(source).sma55,128);
});

test("mutated source prices, different source frames and future cutoffs cannot borrow cached metrics",()=>{
  const start=Date.UTC(2026,0,1),candles=Array.from({length:56},(_,i)=>({ts:start+i*3600000,open:100+i,high:103+i,low:98+i,close:101+i,volume:10,confirmed:true})),closed=start+55*3600000,source={bar:"1H",source:"venue",fetchedAt:new Date(closed).toISOString(),candles};
  const first=globalFrameEvidence(source);assert.equal(first.price,155);assert.equal(first.candles,55);
  candles[54].close=156;const changed=globalFrameEvidence(source);assert.equal(changed.price,156);assert.equal(changed.sma55,Number((128+1/55).toPrecision(12)));
  const later=globalFrameEvidence(source,new Date(closed+3600000).toISOString());assert.equal(later.price,156);assert.equal(later.candles,56);assert.notEqual(later.sma55,changed.sma55);
  const different=globalFrameEvidence({...source,bar:"4H"});assert.equal(different.candles,52);assert.equal(different.sma55,null);
});
