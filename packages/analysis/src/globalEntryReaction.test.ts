import test from "node:test";
import assert from "node:assert/strict";
import {globalEntryReactions} from "./globalEntryReaction.js";
import type {GlobalReport} from "@pulse/schemas";

const HOUR=3600000,BORN=Date.UTC(2026,10,17,12);
function fixture():GlobalReport{
  return {snapshot:{observedAt:new Date(BORN).toISOString(),source:"okx-public-spot",pricePrecision:2},currentMarket:{quote:{price:99,ts:BORN}},entryStudy:{status:"available",observedAt:new Date(BORN).toISOString(),source:"okx-public-spot",timeframe:"4H",atr:[{ts:BORN-4*HOUR,value:4}],candles:[
    {ts:BORN-8*HOUR,open:104,high:107,low:99,close:103,volume:1,confirmed:true},
    {ts:BORN-4*HOUR,open:103,high:105,low:98,close:100,volume:1,confirmed:true},
  ]}} as GlobalReport;
}

test("a daily plan can inspect the actual 4H rejection without moving entry to a distant daily EMA",()=>{
  const report=fixture(),before=structuredClone(report),[p]=globalEntryReactions(report);
  assert.equal(p.side,"short");assert.equal(p.timeframe,"4H");assert.equal(p.entry,103);
  assert.equal(p.invalidation,105);assert.equal(p.stop,105.8);assert.equal(p.atr.value,4);
  assert.equal(p.knownAt,BORN);assert.equal(p.expiresAt,BORN+16*4*HOUR);
  assert.deepEqual(report,before);
});

test("reflection creates a source-backed buy limit with reflected protection",()=>{
  const report=fixture();report.currentMarket!.quote!.price=201;
  report.entryStudy!.candles=report.entryStudy!.candles.map(c=>({...c,open:300-c.open,high:300-c.low,low:300-c.high,close:300-c.close}));
  const [p]=globalEntryReactions(report);assert.equal(p.side,"long");assert.equal(p.entry,197);assert.equal(p.stop,194.2);
});

test("an executed-frame sweep and reclaim gives an independent opposing location without another candle",()=>{
  const report=fixture();
  report.entryStudy!.candles[1]={ts:BORN-4*HOUR,open:103,high:109,low:98,close:100,volume:1,confirmed:true};
  const [short]=globalEntryReactions(report);
  assert.equal(short.kind,"completed_sweep");assert.equal(short.entry,103);assert.equal(short.invalidation,109);assert.equal(short.stop,109.8);
  report.currentMarket!.quote!.price=201;
  report.entryStudy!.candles=report.entryStudy!.candles.map(c=>({...c,open:300-c.open,high:300-c.low,low:300-c.high,close:300-c.close}));
  const [long]=globalEntryReactions(report);assert.equal(long.kind,"completed_sweep");assert.equal(long.side,"long");assert.equal(long.entry,197);
});

test("unconfirmed and not-yet-closed bars or ATR values cannot supply a current location",()=>{
  for(const mutate of [(r:GlobalReport)=>{r.entryStudy!.candles[1].confirmed=false},(r:GlobalReport)=>{r.entryStudy!.candles[1].ts+=1},(r:GlobalReport)=>{r.entryStudy!.atr[0].ts+=1}]){
    const report=fixture();mutate(report);assert.deepEqual(globalEntryReactions(report),[]);
  }
});

test("a later failure invalidates the source, and missing source intervals cannot prove a held reaction",()=>{
  for(const next of [{ts:BORN,open:100,high:106,low:99,close:105.5,volume:1,confirmed:true},{ts:BORN+4*HOUR,open:100,high:102,low:99,close:100,volume:1,confirmed:true}]){
    const report=fixture();report.snapshot.observedAt=new Date(BORN+8*HOUR).toISOString();report.entryStudy!.observedAt=report.snapshot.observedAt;report.currentMarket!.quote!.ts=BORN+8*HOUR;report.entryStudy!.candles.push(next);
    assert.ok(!globalEntryReactions(report).some(p=>p.anchorTs===BORN-4*HOUR));
  }
});

test("source expiry cannot be reset by a newer report clock",()=>{
  const report=fixture();report.snapshot.observedAt=new Date(BORN+16*4*HOUR).toISOString();report.entryStudy!.observedAt=report.snapshot.observedAt;report.currentMarket!.quote!.ts=BORN+16*4*HOUR;
  assert.deepEqual(globalEntryReactions(report),[]);
});

test("a later ATR cannot change protection and a future quote cannot choose the passive side",()=>{
  const report=fixture(),before=globalEntryReactions(report)[0];
  report.entryStudy!.atr.push({ts:BORN,value:100});
  report.currentMarket!.quote={price:200,ts:BORN+1};
  assert.deepEqual(globalEntryReactions(report)[0],{...before,referencePrice:100});
});

test("a completed break uses the previously known boundary, not the impulse open, with reflected stops",()=>{
  const r=fixture(),s=r.entryStudy!;
  s.pivots=[{id:"known-low",kind:"low",price:102,ts:BORN-16*HOUR,confirmedAt:BORN-12*HOUR}];
  const p=globalEntryReactions(r).find(p=>p.kind==="completed_break")!;
  assert.equal(p.entry,102);assert.equal(p.invalidation,102);assert.equal(p.stop,104);assert.equal(p.level!.knownAt,BORN-8*HOUR);
  s.pivots[0].confirmedAt=BORN-4*HOUR;
  assert.ok(!globalEntryReactions(r).some(p=>p.kind==="completed_break"),"A pivot learned at the break close was not available before the break");
});
