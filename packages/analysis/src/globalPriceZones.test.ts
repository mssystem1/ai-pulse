import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {globalTradeCards,globalPriceZonePayoff,globalDecision,globalReportChartSvg,globalEntryStudySvg,globalTargetReference,globalSections} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";
const fixture=JSON.parse(readFileSync(new URL("./globalReport.zones-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const cutoffs:Record<string,string>={"1H":"2026-10-25T08:12:13.313Z","4H":"2026-10-25T08:09:25.782Z","1Dutc":"2026-10-25T08:06:37.691Z","1Wutc":"2026-10-25T08:13:19.668Z"};
function make(tf:string,quote?:number,lang:"en"|"zh"="en"){
  const observedAt=cutoffs[tf]??fixture.observedAt;
  const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:observedAt,ticker:{priceCurrency:"USDT",...(quote===undefined?{}:{last:quote,ts:String(Date.parse(observedAt)-1000)})},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)!<=Date.parse(observedAt)).slice(-520)}));
  return prepareGlobalReport({market:markets.find(m=>m.bar===tf)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(tf)),hierarchyMarkets:markets,tier:"premium",lang});
}
test("a quote crossing 80,639 does not flip a mixed daily thesis without new primary evidence",()=>{
  const a=make("1Dutc",80617.5),b=make("1Dutc",80650.7);
  assert.deepEqual(a.candles,b.candles);assert.deepEqual(a.horizonContext,b.horizonContext);assert.equal(a.discretionaryPlan!.side,"long");assert.equal(b.discretionaryPlan!.side,"long");
  assert.deepEqual(a.discretionaryPlan,b.discretionaryPlan);
  const last=a.candles.at(-1)!,support=a.horizonContext!.zones.find(z=>z.role==="support"&&z.upper===80018.2)!;
  assert.ok(last.low<=support.upper&&last.close>support.upper,"The completed daily candle actually tested and recovered the source support");
});
test("the supplied hourly support band retains its full source and discloses weak clearance",()=>{
  const r=make("1H",80628.4),p=r.discretionaryPlan!,z=p.priceZones!,payoff=globalPriceZonePayoff(r)!;
  assert.equal(z.entry.sourceLower,80458.5);assert.equal(z.entry.sourceUpper,80627.5);assert.equal(z.entry.lower,80458.5);assert.equal(z.entry.upper,80627.5);
  assert.ok(Math.abs(p.stop-80400.2077822)<1e-7);assert.deepEqual(z.targets,[{lower:80774.5,upper:80847},{lower:80913.6,upper:81279.7}]);
  const near=p.barriers.find(b=>b.price===80740.3&&b.timeframe==="15m")!,anchor=r.entryStudy!.pivots.find(a=>a.price===80740.3&&a.kind==="high")!;
  assert.ok(near&&anchor);assert.equal(near.anchorTs,anchor.ts);assert.equal(near.knownAt,candleCloseTime(anchor.confirmedAt!,"15m"));
  assert.ok(r.entryStudy!.candles.at(-1)!.close<=near.price&&near.price<z.targets[0].lower);
  assert.equal(p.entryBasis.price,80627.5);assert.equal(z.entry.sourcePrice,p.entryBasis.price);assert.equal(p.entry,p.entryBasis.price);
  assert.ok((near.price-z.entry.upper)/(z.entry.upper-p.stop)<1);
  assert.ok(payoff.worstToObstacle<1);assert.equal(z.payoffLimited,true);assert.ok(payoff.bestToTP1>payoff.worstToTP1);assert.equal(p.targets.length,2,"The overlapping third point must not pretend to be a distinct target zone");
  assert.equal(p.executionPolicy!.mode,"passive_limit");
  assert.match(globalTradeCards(r)[0].condition,/Passive limit plan/);
  assert.match(globalTradeCards(r)[0].condition,/does not require a later confirmation/);
  assert.doesNotMatch(globalTradeCards(r)[0].condition,/new test formed after this snapshot/);
});
test("4H and weekly payoff use their true stop and nearest obstacle rather than distant target references",()=>{
  const swing=make("4H",80610.9),weekly=make("1Wutc",80612.3),s=swing.discretionaryPlan!,w=weekly.discretionaryPlan!;
  const ribbon=swing.indicators.ema!.filter(e=>e.period===12||e.period===25).map(e=>e.points.at(-1)!.value);
  assert.equal(s.side,"short");assert.equal(s.priceZones!.entry.lower,Number(Math.min(...ribbon).toPrecision(12)));assert.deepEqual(s.priceZones!.targets,[{lower:79220.1,upper:79803.6}]);
  assert.ok(Math.abs(s.stop-82208.0534754)<1e-7);assert.deepEqual(s.targets.map(t=>t.price),[79803.6]);
  const near=s.barriers.find(b=>b.price===80680.5&&b.timeframe==="4H")!,anchor=swing.indicators.pivots.find(a=>a.price===80680.5&&a.kind==="low")!;
  assert.ok(near&&anchor);assert.equal(near.anchorTs,anchor.ts);assert.equal(near.knownAt,candleCloseTime(anchor.confirmedAt!,"4H"));
  assert.ok(swing.currentMarket!.quote!.price<near.price&&swing.candles.at(-1)!.close>=near.price,"A quote below support cannot erase opposition for a future overhead entry");
  assert.deepEqual([s.priceZones!.entry.sourceLower,s.priceZones!.entry.sourceUpper],[Math.min(...ribbon),Math.max(...ribbon)]);assert.equal(s.entryBasis.price,Math.min(...ribbon));
  assert.ok((s.priceZones!.entry.lower-near.price)/(s.stop-s.priceZones!.entry.lower)<1);
  assert.equal(w.side,"long","A countertrend daily reaction does not replace intact weekly recovery");
  assert.equal(w.barriers[0].price,82213.9);assert.equal(w.priceZones!.entry.upper,w.priceZones!.entry.sourceUpper);
  const payoff=globalPriceZonePayoff(weekly)!,sign=w.side==="long"?1:-1,target=w.side==="long"?w.priceZones!.targets[0].lower:w.priceZones!.targets[0].upper;
  assert.ok(payoff.worstToObstacle<1);assert.equal(payoff.worstToTP1,sign*(target-w.entry)/Math.abs(w.entry-w.stop));
  assert.equal(w.stopBasis.timeframe,"1Wutc");assert.ok(sign*(w.stopBasis.price-w.stop)>0);assert.ok(Math.abs(w.entry-w.stop)>Math.abs(s.entry-s.stop),"Macro protection must not inherit an intraday stop distance");
});
test("forged intervals, favorable-fill-only payoff, overlapping targets and altered hard stops are rejected",()=>{
  const r=make("1H",80628.4);
  for(const change of [
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.entry.upper-=10;p.entry=p.priceZones!.entry.upper;},
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.entry.sourceLower-=100;},
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.targets[0].lower+=1;},
    (p:NonNullable<typeof r.discretionaryPlan>)=>{p.priceZones!.targets[1].lower=p.priceZones!.targets[0].upper;},
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
  const saved=make("1Dutc",80650.7);saved.discretionaryPlan!.version="discretionary-plan-v6";delete saved.scenario;delete saved.strategyMix;delete saved.discretionaryPlan!.executionPolicy;saved.discretionaryPlan!.requiresNewTestAfter=Date.parse(saved.snapshot.observedAt);saved.discretionaryPlan!.entryBasis.price=saved.discretionaryPlan!.entry;assert.equal(GlobalReportSchema.safeParse(saved).success,true,"A real v6 source remains readable before review");
  const before=structuredClone(saved),review=reviewGlobalTargetReport(saved);assert.deepEqual(saved,before);assert.deepEqual(review.candles,saved.candles);assert.deepEqual(review.currentMarket,saved.currentMarket);
  assert.equal(review.discretionaryPlan!.version,"discretionary-plan-v8");assert.equal(reviewGlobalTargetReport(review),review);
});
test("Chinese setup and confirmation text contains actual translations",()=>{
  const r=make("1H",80628.4,"zh"),card=globalTradeCards(r)[0];assert.match(card.state,/结构价位回测/);assert.match(card.condition,/被动限价计划/);assert.doesNotMatch(card.condition,/\?{3}/);
});
