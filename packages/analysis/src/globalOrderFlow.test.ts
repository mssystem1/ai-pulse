import test from "node:test";
import assert from "node:assert/strict";
import type {MarketTradeCapture} from "@pulse/market";
import {buildGlobalOrderFlow} from "./globalOrderFlow.js";

const hour=3600000,day=24*hour;
const capture=():MarketTradeCapture=>({source:"okx-public-spot",instId:"HYPE-USDT",priceCurrency:"USDT",marketType:"spot",quantityUnit:"base",capturedAt:new Date(day).toISOString(),coverage:{start:0,end:day,knownAt:day,complete:true,sha256:["a".repeat(64)]},trades:[10,20,40,20,10].map((size,i)=>({id:String(i),ts:[0,6,12,18,23][i]*hour,price:100.5+i,size,side:i%2===0?"buy":"sell"}))});
const options={timeframe:"4H",start:0,end:day,asOf:day,rowSize:1};

test("executed profile conserves taker volume and uses documented no-overshoot value area",()=>{
  const flow=buildGlobalOrderFlow(capture(),options)!;
  assert.deepEqual([flow.profile.buy,flow.profile.sell,flow.profile.volume,flow.profile.delta,flow.profile.trades],[60,40,100,20,5]);
  assert.deepEqual([flow.profile.poc,flow.profile.val,flow.profile.vah],[102.5,102,104]);
  assert.deepEqual(flow.footprints.map(f=>[f.start/hour,f.end/hour]),[[0,4],[4,8],[12,16],[16,20],[20,24]]);
  assert.equal(flow.footprints.reduce((sum,f)=>sum+f.volume,0),flow.profile.volume);
});

test("incomplete or not-yet-known capture cannot support a trade profile",()=>{
  const c=capture();c.coverage.complete=false;assert.equal(buildGlobalOrderFlow(c,options),null);
  c.coverage.complete=true;assert.equal(buildGlobalOrderFlow(c,{...options,asOf:day-1}),null);
  c.coverage.start=1;assert.equal(buildGlobalOrderFlow(c,options),null);
});

test("trade identity, ordering and price-bin precision are checked before aggregation",()=>{
  const duplicate=capture();duplicate.trades=[...duplicate.trades,duplicate.trades[0]];
  assert.throws(()=>buildGlobalOrderFlow(duplicate,options),/duplicate or unordered/);
  const c=capture();c.trades=[{id:"1",ts:0,price:.3,size:2,side:"buy"},{id:"2",ts:1,price:.4,size:1,side:"sell"}];
  const f=buildGlobalOrderFlow(c,{...options,rowSize:.1})!;
  assert.deepEqual(f.profile.rows.map(r=>[r.low,r.high,r.buy,r.sell]),[[.3,.4,2,0],[.4,.5,0,1]]);
});

test("weekly footprints use Monday UTC and unsuffixed daily footprints use UTC+8",()=>{
  const start=Date.UTC(2026,6,5,16),end=start+day,c=capture();c.coverage={...c.coverage,start,end,knownAt:end};c.capturedAt=new Date(end).toISOString();c.trades=[{id:"1",ts:start,price:100,size:2,side:"buy"}];
  const daily=buildGlobalOrderFlow(c,{...options,timeframe:"1D",start,end,asOf:end})!;
  assert.deepEqual(daily.footprints.map(f=>[f.start,f.end]),[[start,end]]);
  const monday=Date.UTC(2026,6,6),weekEnd=monday+7*day;c.coverage={...c.coverage,start:monday,end:weekEnd,knownAt:weekEnd};c.capturedAt=new Date(weekEnd).toISOString();c.trades=[{id:"1",ts:monday+day,price:100,size:2,side:"buy"}];
  const weekly=buildGlobalOrderFlow(c,{...options,timeframe:"1Wutc",start:monday,end:weekEnd,asOf:weekEnd})!;
  assert.deepEqual(weekly.footprints.map(f=>[f.start,f.end]),[[monday,weekEnd]]);
});
