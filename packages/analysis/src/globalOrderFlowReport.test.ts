import test from "node:test";
import assert from "node:assert/strict";
import type {MarketTradeCapture} from "@pulse/market";
import {GlobalReportSchema} from "@pulse/schemas";
import {globalReportChartSvg,globalOrderFlowStudy,globalOrderFlowAnnotations,globalArtifactReference,presentResearch,researchText} from "@pulse/domain";
import {prepareGlobalReport,globalPromptEvidence,rebuildSavedGlobalCandidates} from "./globalReport.js";
import {buildGlobalOrderFlow} from "./globalOrderFlow.js";

const hour=3600000;
function example(){
  const start=126*hour,end=150*hour;
  const capture:MarketTradeCapture={source:"okx-public-spot",instId:"HYPE-USDT",priceCurrency:"USDT",marketType:"spot",quantityUnit:"base",capturedAt:new Date(end).toISOString(),coverage:{start,end,knownAt:end,complete:true,sha256:["a".repeat(64)]},trades:[10,20,40,20,10].map((size,i)=>({id:String(i),ts:start+[0,6,12,18,23][i]*hour,price:100.5+i,size,side:i%2===0?"buy":"sell"}))};
  let prior=100;
  const candles=Array.from({length:150},(_,i)=>{const ts=i*hour,trade=capture.trades.find(t=>t.ts===ts),price=trade?.price??prior;prior=price;return {ts,open:price,high:price,low:price,close:price,volume:trade?.size??0,confirmed:true};});
  const flow=buildGlobalOrderFlow(capture,{timeframe:"1H",start,end,asOf:end,rowSize:1})!;
  const market={instId:"HYPE-USDT",bar:"1H",source:"okx-public-spot",fetchedAt:new Date(end).toISOString(),ticker:{priceCurrency:"USDT"},candles};
  const report=prepareGlobalReport({market:{...market,orderFlow:flow},tier:"premium"});return {report,flow,market};
}

test("a matched executed profile survives preparation, saved reviews, TXT and exports",()=>{
  const {report,flow,market}=example(),plain=prepareGlobalReport({market,tier:"premium"});
  assert.deepEqual(report.orderFlow,flow);assert.deepEqual(report.discretionaryPlan,plain.discretionaryPlan);assert.deepEqual(report.tradePlan,plain.tradePlan);
  assert.notEqual(globalArtifactReference(report),globalArtifactReference(plain));
  assert.deepEqual(rebuildSavedGlobalCandidates(report).orderFlow,flow);
  const text=researchText(presentResearch(report));assert.match(text,/POC 102.5/);assert.match(text,/Taker buy 60/);
  const svg=globalReportChartSvg(report)!;assert.match(svg,/data-order-flow-profile="executed_trades"/);assert.match(svg,/data-profile-level="POC" data-price="102.5"/);assert.match(svg,/data-executed-footprint="1H"/);
  assert.doesNotMatch(globalReportChartSvg(report,{layers:{volumeProfile:false,footprint:false}})!,/data-order-flow-profile=|data-executed-footprint=/);
  const evidence=globalPromptEvidence(report).orderFlow!;assert.equal(evidence.restingOrderBook,false);assert.equal(evidence.profile.rows,undefined);assert.equal(evidence.recentFootprints.length,3);
});

test("other venues, instruments, timeframes, quantities and future evidence cannot enter a report",()=>{
  const {report}=example();
  for(const mutate of [(r:typeof report)=>{r.orderFlow!.source="other"},(r:typeof report)=>{r.orderFlow!.instId="BTC-USDT"},(r:typeof report)=>{r.orderFlow!.profile.timeframe="4H"},(r:typeof report)=>{r.orderFlow!.quantityUnit="contracts"},(r:typeof report)=>{r.orderFlow!.profile.knownAt++},(r:typeof report)=>{r.orderFlow!.footprints[0].volume++},(r:typeof report)=>{r.candles.find(c=>c.ts===r.orderFlow!.footprints[0].start)!.high++}]){
    const changed=structuredClone(report);mutate(changed);assert.equal(GlobalReportSchema.safeParse(changed).success,false);
  }
});

test("display row consolidation conserves the profile and selected footprint volumes",()=>{
  const {report}=example(),flow=report.orderFlow!,svg=globalOrderFlowStudy(report,660)!.svg;
  const sum=(kind:string)=>[...svg.matchAll(new RegExp(`data-${kind}="[^"]+" data-buy="([^"]+)" data-sell="([^"]+)"`,"g"))].reduce((s,m)=>[s[0]+Number(m[1]),s[1]+Number(m[2])],[0,0]);
  assert.deepEqual(sum("footprint-profile-row"),[flow.profile.buy,flow.profile.sell]);
  assert.deepEqual(sum("footprint-cell"),flow.footprints.slice(-4).reduce((s,b)=>[s[0]+b.buy,s[1]+b.sell],[0,0]));
});

test("zoomed-out captions separate without moving POC, VAL or VAH price lines",()=>{
  const {report}=example(),svg=globalOrderFlowAnnotations(report,{left:0,right:700,historyEnd:500,top:0,bottom:400,x:()=>0,y:p=>p*.01+100});
  const labels=[...svg.matchAll(/<text x="23" y="([^"]+)"/g)].map(m=>Number(m[1])).sort((a,b)=>a-b);
  assert.equal(labels.length,3);assert.ok(labels[1]-labels[0]>=12);assert.ok(labels[2]-labels[1]>=12);
  assert.ok(svg.includes('data-price="102.5"><line x1="0" x2="500" y1="101.025"'));
});

test("a short profile starts at its own source window and disappears when panning before it",()=>{
  const {report}=example(),before=structuredClone(report.orderFlow);
  const coordinates={left:0,right:700,historyEnd:500,top:0,bottom:400,x:(ts:number)=>ts/hour*3,y:(price:number)=>price};
  const svg=globalOrderFlowAnnotations(report,coordinates);
  assert.match(svg,/data-profile-level="POC" data-price="102.5"><line x1="378" x2="500"/);
  assert.doesNotMatch(svg,/data-profile-level="[^"]+" data-price="[^"]+"><line x1="0"/);
  assert.equal(globalOrderFlowAnnotations(report,{...coordinates,x:ts=>1000+ts/hour*3}),"");
  assert.deepEqual(report.orderFlow,before,"Rendering keeps the original profile prices and executed rows");
});

test("a one-day profile after the last completed weekly candle remains compact recent context",()=>{
  const origin=Date.UTC(2025,0,6),week=7*24*hour,start=origin+30*week+hour,end=start+24*hour;
  const capture:MarketTradeCapture={source:"okx-public-spot",instId:"HYPE-USDT",priceCurrency:"USDT",marketType:"spot",quantityUnit:"base",capturedAt:new Date(end).toISOString(),coverage:{start,end,knownAt:end,complete:true,sha256:["b".repeat(64)]},trades:[10,20,40,20,10].map((size,i)=>({id:String(i),ts:start+[0,6,12,18,23][i]*hour,price:100.5+i,size,side:i%2===0?"buy":"sell"}))};
  const flow=buildGlobalOrderFlow(capture,{timeframe:"1Wutc",start,end,asOf:end,rowSize:1})!;
  const market={source:capture.source,instId:capture.instId,bar:"1Wutc",fetchedAt:capture.capturedAt,ticker:{priceCurrency:"USDT"},orderFlow:flow,candles:Array.from({length:30},(_,i)=>({ts:origin+i*week,open:100,high:110,low:90,close:100,volume:1000,confirmed:true}))};
  const report=prepareGlobalReport({market,tier:"premium"});
  assert.equal(GlobalReportSchema.safeParse(report).success,true);assert.equal(flow.footprints.length,0);
  const svg=globalOrderFlowAnnotations(report,{left:0,right:700,historyEnd:500,top:0,bottom:400,x:ts=>(ts-origin)/week*10,y:price=>price});
  assert.match(svg,/data-profile-location="recent_context"/);
  const starts=[...svg.matchAll(/data-profile-level="[^"]+" data-price="[^"]+"><line x1="([^"]+)"/g)].map(match=>Number(match[1]));
  assert.equal(starts.length,3);assert.ok(starts.every(x=>x>350&&x<500),"One day of trades must not label the entire weekly history");
  assert.deepEqual(report.orderFlow,flow);
});

test("shorter context history remains visible even when SMA55 has not warmed up",()=>{
  const {market}=example(),contextMarket={...market,bar:"4H",candles:market.candles.filter((_,i)=>i%4===0)};
  const r=prepareGlobalReport({market,contextMarket,tier:"premium"});
  assert.equal(r.context.status,"unavailable");assert.equal(r.context.sma55.length,0);assert.ok(r.context.candles.length>2);
  assert.ok(globalReportChartSvg(r)!.includes(`${r.context.candles.length} completed candles`));
});
