import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalPriceZonePayoff,globalTradeCards} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {globalEntryOpposition,globalRouteObstacles} from "./globalRouteObstacles.js";
import {applyGlobalPriceZones} from "./globalPriceZones.js";

// Start with the tracked public OHLCV fixture, then replace the few inputs
// under review with explicit synthetic routes. No private report or live feed.
const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
type Zone=NonNullable<GlobalReport["horizonContext"]>["zones"][number];
const start=Date.UTC(2026,8,7);
const candle=(ts:number,open:number,high:number,low:number,close:number)=>({ts,open,high,low,close,volume:1,confirmed:true});
const make=(tf:string)=>prepareGlobalReport({market:markets.find(m=>m.bar===tf)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(tf)),hierarchyMarkets:markets,tier:"premium"});

function synthetic(tf="1H",price=105){
  const report=make(tf),step=candleCloseTime(start,tf)!-start;
  report.candles=Array.from({length:4},(_,i)=>candle(start+i*step,price,price+2,price-2,price));
  const last=report.candles.at(-1)!,closed=candleCloseTime(last.ts,tf)!;
  report.snapshot={...report.snapshot,timeframe:tf,lastCandleTs:last.ts,price,observedAt:new Date(closed+960_000).toISOString(),pricePrecision:2};
  report.indicators.pivots=[];report.indicators.atr.points=[{ts:last.ts,value:2}];
  report.horizonContext={...report.horizonContext!,timeframe:tf,knownAt:closed,zones:[],ranges:[]};
  report.currentMarket={source:report.snapshot.source,quote:{price,ts:closed+950_000},frames:[]};
  delete report.entryStudy;delete report.discretionaryPlan;
  return report;
}

function zone(report:GlobalReport,id:string,role:Zone["role"],lower:number,upper:number):Zone{
  return{id,role,lower,upper,basis:"confirmed_pivot_wicks",anchorIds:[id+"-source"],startTs:report.candles[0].ts,knownAt:candleCloseTime(report.candles.at(-1)!.ts,report.snapshot.timeframe)!};
}

function mirror(report:GlobalReport,around:number){
  const reflect=(c:GlobalReport["candles"][number])=>({...c,open:around-c.open,high:around-c.low,low:around-c.high,close:around-c.close});
  report.candles=report.candles.map(reflect);report.snapshot.price=around-report.snapshot.price!;
  report.indicators.pivots=report.indicators.pivots.map(p=>({...p,price:around-p.price,kind:p.kind==="high"?"low":"high"}));
  for(const ema of report.indicators.ema??[])ema.points=ema.points.map(p=>({...p,value:around-p.value}));
  if(report.entryStudy){report.entryStudy.candles=report.entryStudy.candles.map(reflect);report.entryStudy.pivots=report.entryStudy.pivots.map(p=>({...p,price:around-p.price,kind:p.kind==="high"?"low":"high"}));}
  if(report.currentMarket?.quote)report.currentMarket.quote.price=around-report.currentMarket.quote.price;
  report.horizonContext!.zones=report.horizonContext!.zones.map(z=>({...z,role:z.role==="resistance"?"support":"resistance",lower:around-z.upper,upper:around-z.lower}));
  const p=report.discretionaryPlan;
  if(p){p.side=p.side==="long"?"short":"long";p.entry=around-p.entry;p.stop=around-p.stop;p.entryBasis.price=around-p.entryBasis.price;p.stopBasis.price=around-p.stopBasis.price;p.reference.price=around-p.reference.price;p.targets=p.targets.map(t=>({...t,price:around-t.price}));if(p.evidence){p.evidence.level=around-p.evidence.level;p.evidence.extreme=around-p.evidence.extreme;}}
  return report;
}

function pivotRoute(side:"long"|"short"){
  const report=synthetic(),[a,b,c,d]=report.candles;
  report.candles=[candle(a.ts,105,110,104,105),candle(b.ts,105,109,104,106),candle(c.ts,106,109,105,108),candle(d.ts,108,109.5,107,109)];
  report.indicators.pivots=[{id:"primary-opposition",ts:a.ts,price:110,kind:"high",confirmedAt:b.ts}];
  const lowerStart=candleCloseTime(d.ts,"1H")!;
  const preparedStudy=make("1H").entryStudy!;
  report.entryStudy={...preparedStudy,status:"available",source:report.snapshot.source,timeframe:"15m",candles:[candle(lowerStart,109,115,108,109)],pivots:[],atr:[]};
  report.snapshot.price=109;report.currentMarket!.quote!.price=114;
  return side==="long"?report:mirror(report,210);
}

test("a primary pivot survives a newer lower-frame wick and a quote beyond the level, symmetrically",()=>{
  for(const side of ["long","short"] as const){
    const report=pivotRoute(side),price=side==="long"?110:100,before=JSON.stringify(report);
    assert.ok(globalRouteObstacles(report,side).some(b=>b.price===price&&b.timeframe==="1H"));
    assert.equal(JSON.stringify(report),before);
  }
});

test("a previous own-frame crossing followed by return reactivates point opposition",()=>{
  for(const side of ["long","short"] as const){
    const report=pivotRoute(side),cross=report.candles[2];
    cross.close=side==="long"?112:98;cross.high=Math.max(cross.high,cross.close);cross.low=Math.min(cross.low,cross.close);
    assert.ok(globalRouteObstacles(report,side).some(b=>b.price===(side==="long"?110:100)&&b.timeframe==="1H"));
  }
});

test("latest completed own-frame acceptance can remove point opposition without erasing a retained zone",()=>{
  for(const side of ["long","short"] as const){
    const report=pivotRoute(side),last=report.candles.at(-1)!;
    last.close=side==="long"?111:99;last.high=Math.max(last.high,last.close);last.low=Math.min(last.low,last.close);
    assert.ok(!globalRouteObstacles(report,side).some(b=>b.price===(side==="long"?110:100)&&b.timeframe==="1H"));
    const opposing=zone(report,"retained-zone",side==="long"?"resistance":"support",side==="long"?110:95,side==="long"?115:100);
    report.horizonContext!.zones=[opposing];
    for(const edge of [opposing.lower,opposing.upper])assert.ok(globalRouteObstacles(report,side).some(b=>b.price===edge&&b.timeframe==="1H"));
  }
});

function macroRoute(tf:"1Dutc"|"1Wutc"){
  const daily=tf==="1Dutc",entryBand=daily?[78649.3,80018.2]:[76430.1744788,78735.79038],stop=daily?78243.7472469:73733.5761366;
  const report=synthetic(tf,entryBand[1]),closed=candleCloseTime(report.candles.at(-1)!.ts,tf)!;
  const firstResistance=daily?zone(report,"near-daily-resistance","resistance",81260.1,83500.1):zone(report,"near-weekly-resistance","resistance",82213.9,82842);
  report.horizonContext!.zones=[zone(report,"source-support","support",entryBand[0],entryBand[1]),firstResistance];
  if(daily)report.horizonContext!.zones.push(zone(report,"daily-target","resistance",83763.7,84361.6));
  else{const first=report.candles[0];Object.assign(first,{open:83000,close:84479,high:87399,low:82000});report.indicators.ema=[12,25].map((period,i)=>({period,points:[{ts:report.candles.at(-1)!.ts,value:entryBand[1-i]}]}));}
  report.currentMarket!.quote!.price=daily?83600:83000;
  report.discretionaryPlan={version:"discretionary-plan-v5",side:"long",family:daily?"level_retest":"ema_pullback",objectiveTimeframe:tf,entry:entryBand[1],stop,entryBasis:{kind:daily?"structure_zone":"ema_ribbon",price:entryBand[1],timeframe:tf,knownAt:closed},reference:{timeframe:tf,candleTs:report.candles.at(-1)!.ts,completedAt:closed,price:entryBand[1]},stopBasis:{timeframe:tf,price:daily?entryBand[0]:74955.5,anchorTs:report.candles[0].ts,knownAt:closed},targets:[{timeframe:tf,price:daily?83763.7:87399,anchorTs:report.candles[0].ts,knownAt:closed,basis:daily?"structure_zone":"confirmed_swing"}],barriers:[],requiresNewTestAfter:Date.parse(report.snapshot.observedAt)};
  return report;
}

test("daily and weekly future-entry routes keep nearer resistance despite a higher quote and clip only source-bounded fills",()=>{
  for(const tf of ["1Dutc","1Wutc"] as const)for(const side of ["long","short"] as const){
    const report=side==="long"?macroRoute(tf):mirror(macroRoute(tf),170000),original=structuredClone(report.discretionaryPlan!),source=report.horizonContext!.zones.find(z=>z.id==="source-support")!;
    const opposing=report.horizonContext!.zones.find(z=>z.id.startsWith("near-"))!,near=side==="long"?opposing.lower:opposing.upper;
    assert.ok(side==="long"?report.currentMarket!.quote!.price>opposing.upper:report.currentMarket!.quote!.price<opposing.lower);
    applyGlobalPriceZones(report);const p=report.discretionaryPlan!,z=p.priceZones!,worst=side==="long"?z.entry.upper:z.entry.lower;
    assert.equal(p.version,"discretionary-plan-v7");assert.equal(z.payoffLimited,false);
    assert.ok(z.entry.lower>=source.lower&&z.entry.upper<=source.upper);assert.notEqual(worst,original.entry);
    assert.equal(z.entry.sourceLower,source.lower);assert.equal(z.entry.sourceUpper,source.upper);assert.equal(z.entry.sourcePrice,original.entryBasis.price);
    assert.deepEqual(p.entryBasis,original.entryBasis);assert.equal(p.stop,original.stop);assert.deepEqual(p.targets,original.targets);
    assert.ok(p.barriers.some(b=>b.price===near&&b.timeframe===tf));
    assert.ok((side==="long"?near-worst:worst-near)/Math.abs(worst-p.stop)>=1-1e-9);
    const allowed=globalRouteObstacles(report,side);assert.ok(p.barriers.every(b=>allowed.some(a=>a.price===b.price&&a.timeframe===b.timeframe)));
  }
});

test("unavoidable opposing-zone overlap is limited at zero reward while preserving the genuine reclaim source",()=>{
  for(const side of ["long","short"] as const){
    let report=synthetic("1H",109),closed=candleCloseTime(report.candles.at(-1)!.ts,"1H")!;
    Object.assign(report.candles.at(-1)!,{open:99,high:112,low:95,close:110});
    report.candles[0].low=95;report.currentMarket!.quote!.price=120;
    report.horizonContext!.zones=[zone(report,"blocking-zone","resistance",105,115)];
    report.discretionaryPlan={version:"discretionary-plan-v5",side:"long",family:"breakout_retest",objectiveTimeframe:"1H",entry:100,stop:90,entryBasis:{kind:"reclaimed_level",price:100,timeframe:"1H",knownAt:closed},reference:{timeframe:"1H",candleTs:report.candles.at(-1)!.ts,completedAt:closed,price:110},stopBasis:{timeframe:"1H",price:95,anchorTs:report.candles[0].ts,knownAt:closed},targets:[{price:140,timeframe:"1H",anchorTs:report.candles[0].ts,knownAt:closed,basis:"measured_projection"}],barriers:[],evidence:{kind:"local_reclaim",timeframe:"1H",level:100,testTs:report.candles.at(-1)!.ts,completedAt:closed,extreme:95},requiresNewTestAfter:Date.parse(report.snapshot.observedAt)};
    if(side==="short")report=mirror(report,210);
    const original=structuredClone(report.discretionaryPlan!);
    applyGlobalPriceZones(report);const p=report.discretionaryPlan!,z=p.priceZones!;
    assert.equal(p.version,"discretionary-plan-v7");assert.equal(z.payoffLimited,true);assert.equal(globalPriceZonePayoff(report)!.worstToObstacle,0);
    const card=globalTradeCards(report)[0];assert.ok(card,"A payoff-limited priced plan remains visible");assert.equal(card.confirmed,false);
    assert.deepEqual([z.entry.lower,z.entry.upper],[100,110]);assert.ok(globalEntryOpposition(report,side,z.entry).length>0);
    assert.deepEqual(p.entryBasis,original.entryBasis);assert.equal(z.entry.sourcePrice,original.entryBasis.price);assert.notEqual(p.entry,original.entryBasis.price);
    assert.equal(p.stop,original.stop);assert.deepEqual(p.targets,original.targets);
    assert.ok(p.barriers.every(b=>globalRouteObstacles(report,side).some(a=>a.price===b.price&&a.timeframe===b.timeframe)));
  }
});
