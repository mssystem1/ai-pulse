import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,candleLevelTouchedAfter,GlobalReportSchema} from "@pulse/schemas";
import {globalHistoricalLevelLines,globalHorizonContextLines,globalTradeCards} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe,finishGlobalReport} from "./globalReport.js";
import {applyGlobalDiscretionaryPlan} from "./globalDiscretionaryPlan.js";
import {systemPrompt} from "./prompts.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";
const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct24-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const cutoffs:Record<string,string>={"1H":"2026-10-24T17:22:32.073Z","4H":"2026-10-24T17:15:09.327Z","1Dutc":"2026-10-24T17:16:40.754Z","1Wutc":"2026-10-24T17:18:56.595Z"};
const make=(frame:string)=>{const observedAt=cutoffs[frame],markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));return prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium"});};

test("attached hourly setup drops the wick-consumed target while retaining the current EMA entry",()=>{
  const r=make("1H"),p=r.discretionaryPlan!;assert.equal(r.snapshot.price,80217.2);assert.equal(p.reference.price,80159.9);
  assert.ok(Math.abs(p.entry-80510.7249428)<1e-6);assert.ok(!p.targets.some(t=>t.price===79775.1));
  assert.equal(p.targets[0].price,79220.1);assert.equal(p.targets[0].basis,"observed_extreme");
  const old=r.indicators.pivots.find(a=>a.price===79775.1)!,knownAt=candleCloseTime(old.confirmedAt!,"1H")!;
  assert.equal(candleLevelTouchedAfter(r.candles,"1H",old.price,"short",knownAt,Date.parse(r.snapshot.observedAt)),true);
  assert.match(globalHorizonContextLines(r).join(" "),/Week range/);
});

test("daily objectives stay ahead of newer execution data and keep its nearer observed barrier",()=>{
  const r=make("1Dutc"),p=r.discretionaryPlan!;assert.equal(p.reference.price,79803.6);
  assert.ok(!p.targets.some(t=>t.price===80400));assert.ok(p.targets.every(t=>t.price<p.reference.price));
  assert.ok(p.barriers.some(b=>b.price===79220.1&&b.timeframe==="4H"));
  const invalid=structuredClone(r);invalid.discretionaryPlan!.targets[0]={...p.targets[0],price:80400};assert.equal(GlobalReportSchema.safeParse(invalid).success,false);
});

test("4H keeps the latest primary low before distant old objectives",()=>{
  const r=make("4H"),p=r.discretionaryPlan!;assert.equal(p.targets[0].price,79220.1);assert.equal(p.targets[0].timeframe,"4H");
  assert.ok(!p.targets.some(t=>t.price===64163.6));
});

test("all attached horizons require a new post-snapshot test and preserve their distinct source clocks",()=>{
  for(const frame of Object.keys(cutoffs)){
    const r=make(frame),p=r.discretionaryPlan!;assert.equal(p.version,"discretionary-plan-v3");assert.equal(p.requiresNewTestAfter,Date.parse(cutoffs[frame]));
    assert.ok(p.reference.completedAt<=p.requiresNewTestAfter!);assert.ok(p.targets.every(t=>(p.side==="long"?1:-1)*(t.price-p.reference.price)>0));
    assert.match(globalTradeCards(r)[0].condition,/new test formed after this snapshot/);assert.equal(GlobalReportSchema.safeParse(r).success,true);
  }
});

test("free review repairs v2 target freshness without rewriting the purchased source or confirmed prices",()=>{
  const r=make("1H");r.discretionaryPlan!.version="discretionary-plan-v2";r.discretionaryPlan!.targets=[{...r.discretionaryPlan!.targets[0],price:79775.1}];
  r.narrative.reasons=["TP1 79,775.10 is the current objective."];
  const before=structuredClone(r),fixed=reviewGlobalTargetReport(r);assert.deepEqual(r,before);assert.deepEqual(fixed.candles,r.candles);assert.deepEqual(fixed.entryStudy,r.entryStudy);
  assert.equal(fixed.discretionaryPlan!.version,"discretionary-plan-v3");assert.equal(fixed.discretionaryPlan!.targets[0].price,79220.1);
  assert.deepEqual(fixed.narrative.reasons,[]);assert.match(fixed.narrative.summary,/79,220.10/);
});

test("a displayed setup price is not contradicted as context-only historical data",()=>{
  const r=make("1Dutc"),p=r.discretionaryPlan!;p.targets[0].price=80400;
  assert.ok(!globalHistoricalLevelLines(r).some(line=>line.includes("80,400")));
});

test("level consumption counts exact wick touches and excludes partial or earlier candles",()=>{
  const ts=Date.UTC(2026,9,24,16),bars=[{ts,high:110,low:90}];
  assert.equal(candleLevelTouchedAfter(bars,"1H",90,"short",ts,ts+3600000),true);
  assert.equal(candleLevelTouchedAfter(bars,"1H",110,"long",ts,ts+3600000),true);
  assert.equal(candleLevelTouchedAfter(bars,"1H",90,"short",ts,ts+3599999),false);
  assert.equal(candleLevelTouchedAfter(bars,"1H",90,"short",ts+1,ts+3600000),false);
});

test("short lower-frame history still supplies objective-consumption evidence and its latest source close",()=>{
  const r=make("1H");r.entryStudy!.status="unavailable";r.entryStudy!.candles=r.entryStudy!.candles.slice(-8);
  applyGlobalDiscretionaryPlan(r);const p=r.discretionaryPlan!;
  assert.equal(p.reference.timeframe,"15m");assert.equal(p.reference.price,80159.9);
  assert.ok(p.targets.every(t=>t.price<p.reference.price));assert.equal(GlobalReportSchema.safeParse(r).success,true);
});

test("model explanation preserves the computed plan and strips implementation names",()=>{
  const r=make("1H"),original=structuredClone(r.discretionaryPlan),finished=finishGlobalReport(r,{headline:"Example",summary:"Example",regime:"trend_down",bias:"bearish",confidence:50,waveCandidateId:r.waveCount.id,mainPathId:null,setupPathId:null,reasons:["Frozen setup uses (structure-v5) protection and the supplied targets."],pathNotes:[],riskNotes:[],limitations:[],disclaimer:"Research only."});
  assert.deepEqual(finished.discretionaryPlan,original);assert.doesNotMatch(finished.narrative.reasons.join(" "),/frozen|structure-v5/i);
  const prompt=systemPrompt("premium","en");assert.match(prompt,/primary-horizon stopBasis/);assert.match(prompt,/new test after requiresNewTestAfter/);assert.doesNotMatch(prompt,/structure-v5 uses confirmed entry-frame protection/);
});
