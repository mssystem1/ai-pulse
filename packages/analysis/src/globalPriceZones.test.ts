import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {globalTradeCards,globalPriceZonePayoff,globalDecision,globalReportChartSvg,globalEntryStudySvg,globalTargetReference,globalSections} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";
const fixture=JSON.parse(readFileSync(new URL("./globalReport.zones-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const cutoffs:Record<string,string>={"1H":"2026-10-25T08:12:13.313Z","4H":"2026-10-25T08:09:25.782Z","1Dutc":"2026-10-25T08:06:37.691Z","1Wutc":"2026-10-25T08:13:19.668Z"};
function make(tf:string,quote?:number,lang:"en"|"zh"="en",legacy=false){
  const observedAt=cutoffs[tf]??fixture.observedAt;
  const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:observedAt,ticker:{priceCurrency:"USDT",...(quote===undefined?{}:{last:quote,ts:String(Date.parse(observedAt)-1000)})},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)!<=Date.parse(observedAt)).slice(-520)}));
  return prepareGlobalReport({market:markets.find(m=>m.bar===tf)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(tf)),hierarchyMarkets:markets,tier:"premium",lang,...(legacy?{executionSettings:{fillWindowBars:4,sourceSelection:"legacy-v4" as const}}:{})});
}
test("a quote crossing 80,639 does not flip a mixed daily thesis without new primary evidence",()=>{
  const a=make("1Dutc",80617.5),b=make("1Dutc",80650.7);
  assert.deepEqual(a.candles,b.candles);assert.deepEqual(a.horizonContext,b.horizonContext);assert.equal(a.setupSelection!.side,b.setupSelection!.side);
  for(const r of [a,b]){const p=r.discretionaryPlan!;assert.equal(p.entryReaction?.kind,"completed_break");assert.ok(p.entryReaction.level);const source=r.entryStudy!.candles.find(c=>c.ts===p.entryReaction!.anchorTs)!,prior=r.entryStudy!.candles.find(c=>c.ts===p.entryReaction!.previousTs)!;assert.equal(p.entry,p.entryReaction.level.price);assert.ok(p.side==="long"?prior.close<=p.entry&&source.close>p.entry:prior.close>=p.entry&&source.close<p.entry);}
  const last=a.candles.at(-1)!,support=a.horizonContext!.zones.find(z=>z.role==="support"&&z.upper===80018.2)!;
  assert.ok(last.low<=support.upper&&last.close>support.upper,"The completed daily candle actually tested and recovered the source support");
});
test("the hourly resting limit keeps the full source context, fixed stop and nearest route obstacle",()=>{
  const r=make("1H",80628.4),p=r.discretionaryPlan!,z=p.priceZones!,payoff=globalPriceZonePayoff(r)!;
  assert.deepEqual([z.entry.sourceLower,z.entry.sourceUpper],[80458.5,80627.5]);
  assert.deepEqual([z.entry.lower,z.entry.upper],[80458.5,80458.5]);
  assert.equal(p.executionPolicy!.sourceBoundary,80458.5);assert.equal(p.entryBasis.price,80627.5);
  assert.ok(Math.abs(p.stop-80400.2077822)<1e-7);
  assert.deepEqual(z.targets[0],{lower:80774.5,upper:80847});assert.ok(z.targets.length>=1&&z.targets.length<=3);
  const near=p.barriers.find(b=>b.price===80740.3&&b.timeframe==="15m")!,anchor=r.entryStudy!.pivots.find(a=>a.price===80740.3&&a.kind==="high")!;
  assert.ok(near&&anchor);assert.equal(near.anchorTs,anchor.ts);assert.equal(near.knownAt,candleCloseTime(anchor.confirmedAt!,"15m"));
  assert.equal(payoff.worstToObstacle,(80740.3-p.entry)/(p.entry-p.stop));
  assert.equal(payoff.bestToTP1,payoff.worstToTP1);assert.equal(z.payoffLimited,false);
  assert.ok(p.targets.length>=1&&p.targets.length<=3);assert.match(globalTradeCards(r)[0].condition,/Passive limit plan/);
  assert.match(globalTradeCards(r)[0].condition,/does not require a later confirmation/);
});
test("4H and weekly structural limits use their own first active obstacle and fixed protection",()=>{
  const swing=make("4H",80610.9),weekly=make("1Wutc",80612.3),s=swing.discretionaryPlan!,w=weekly.discretionaryPlan!;
  assert.equal(s.side,"short");assert.equal(s.family,"level_retest");assert.equal(s.entry,82060);
  assert.deepEqual([s.priceZones!.entry.sourceLower,s.priceZones!.entry.sourceUpper],[80809.5,82060]);
  assert.ok(Math.abs(s.stop-82208.0534754)<1e-7);assert.equal(s.targets[0].price,80680.5);assert.ok(s.targets.length>=1&&s.targets.length<=3);
  assert.ok(s.targets.every((t,i)=>i===0||(s.side==="long"?1:-1)*(t.price-s.targets[i-1].price)>0));
  const anchor=swing.indicators.pivots.find(a=>a.price===80680.5&&a.kind==="low")!;
  assert.equal(s.targets[0].anchorTs,anchor.ts);assert.equal(s.targets[0].knownAt,candleCloseTime(anchor.confirmedAt!,"4H"));
  assert.ok(swing.currentMarket!.quote!.price<80680.5&&swing.candles.at(-1)!.close>=80680.5,"A quote below support does not erase opposition after a future limit entry");
  assert.equal(w.side,"short");assert.ok(w.entryReaction);const reactionSource=weekly.entryStudy!.candles.find(c=>c.ts===w.entryReaction!.anchorTs)!,reactionPrior=weekly.entryStudy!.candles.find(c=>c.ts===w.entryReaction!.previousTs)!;assert.equal(w.entryReaction.knownAt,candleCloseTime(reactionSource.ts,w.entryReaction.timeframe));if(w.entryReaction.kind==="completed_break"){assert.ok(w.entryReaction.level);assert.equal(w.entry,w.entryReaction.level.price);assert.ok(reactionPrior.close>=w.entry&&reactionSource.close<w.entry);}else{assert.equal(w.entryReaction.kind,"completed_rejection");assert.equal(w.entry,Math.max(reactionSource.open,reactionSource.close));assert.ok(reactionSource.close<reactionPrior.close);}
  assert.equal(w.targets[0].timeframe,"1Wutc");assert.equal(w.priceZones!.payoffLimited,true);
  const payoff=globalPriceZonePayoff(weekly)!;
  assert.equal(payoff.worstToTP1,(w.priceZones!.targets[0].lower-w.entry)/(w.entry-w.stop));
  assert.equal(w.stopBasis.timeframe,weekly.entryStudy!.timeframe);assert.ok(w.stopBasis.price<w.stop&&w.stop>w.entry);
  assert.ok(Math.abs(w.entry-w.stop)>Math.abs(s.entry-s.stop),"Macro protection does not inherit an intraday stop distance");
});
test("forged intervals, favorable-fill-only payoff, overlapping targets and altered hard stops are rejected",()=>{
  const r=make("1H",80628.4);
  for(const change of [
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.entry.upper-=10;p.entry=p.priceZones!.entry.upper;},
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.entry.sourceLower-=100;},
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.targets[0].lower+=1;},
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.targets.push({...p.targets[0]});p.priceZones!.targets.push({...p.priceZones!.targets[0]});p.executionPolicy!.targetAllocations=[.5,.5];},
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.stop.lower+=1;},
  ]){const forged=structuredClone(r);change(forged.discretionaryPlan!);assert.equal(GlobalReportSchema.safeParse(forged).success,false);}
});
for(const tf of ["15m","1H","4H","1Dutc","1Wutc"])test(`${tf} shows source-backed Entry/SL/TP ranges across TXT, native annotations and entry study`,()=>{
  const r=make(tf),p=r.discretionaryPlan!,z=p.priceZones!,before=JSON.stringify(r),card=globalTradeCards(r)[0],decision=globalDecision(r),svg=globalReportChartSvg(r)!;
  assert.equal(p.version,"discretionary-plan-v8");assert.equal(GlobalReportSchema.safeParse(r).success,true);assert.equal(card.plan.referenceStop,p.stop);
  assert.deepEqual(card.plan.referenceEntry,[z.entry.lower,z.entry.upper]);assert.deepEqual(decision.nextSetup.watchArea,card.plan.referenceEntry);
  assert.deepEqual(card.targets.map(t=>t.price),p.targets.map((_t,i)=>globalTargetReference(r,i)));
  assert.ok(svg.includes('data-trade-zone="Entry"'));assert.ok(svg.includes('data-trade-zone="SL"'));assert.match(svg,/Hard SL/);
  const text=globalSections(r).flatMap(s=>s.lines).join("\n");assert.ok(text.includes(card.entry)&&text.includes(card.stop));assert.match(text,/Least to most favorable fill/);
  assert.ok(globalEntryStudySvg(r));assert.equal(JSON.stringify(r),before);assert.equal(card.confirmed,false);
});
test("free range review leaves the paid report and its captured market clocks intact",()=>{
  const saved=make("1Dutc",80650.7,"en",true);saved.discretionaryPlan!.version="discretionary-plan-v6";delete saved.scenario;delete saved.strategyMix;delete saved.discretionaryPlan!.executionPolicy;saved.setupPolicyVersion="source-limits-v3";saved.discretionaryPlan!.requiresNewTestAfter=Date.parse(saved.snapshot.observedAt);saved.discretionaryPlan!.entryBasis.price=saved.discretionaryPlan!.entry;assert.equal(GlobalReportSchema.safeParse(saved).success,true,"A v6 archive predating reaction metadata remains readable before review");
  const before=structuredClone(saved),review=reviewGlobalTargetReport(saved);assert.deepEqual(saved,before);assert.deepEqual(review.candles,saved.candles);assert.deepEqual(review.currentMarket,saved.currentMarket);
  assert.equal(review.discretionaryPlan!.version,"discretionary-plan-v8");assert.equal(reviewGlobalTargetReport(review),review);
});
test("Chinese setup and confirmation text contains actual translations",()=>{
  const r=make("1H",80628.4,"zh"),card=globalTradeCards(r)[0];assert.match(card.state,/结构价位回测/);assert.match(card.condition,/被动限价计划/);assert.doesNotMatch(card.condition,/\?{3}/);
});
