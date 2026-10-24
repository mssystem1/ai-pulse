import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GlobalReportSchema,candleCloseTime} from "@pulse/schemas";
import {globalReportChartSvg,globalHorizonContextLines,globalArtifactReference} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe,globalPromptEvidence} from "./globalReport.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";
import {restoreGlobalSetupStudies} from "./globalSetupStudies.js";
import {tradePlanFixture} from "./globalTrade.fixtures.js";

const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
const make=(frame:string)=>prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium"});

test("each horizon has its own reading and only confirmed primary-frame context",()=>{
  for(const [frame,reading] of [["15m","session"],["1H","intraday"],["4H","swing"],["1Dutc","position"],["1Wutc","macro"]]){
    const r=make(frame),h=r.horizonContext!,svg=globalReportChartSvg(r)!;
    assert.equal(h.reading,reading);assert.equal(h.timeframe,frame);assert.ok(h.knownAt<=Date.parse(r.snapshot.observedAt));
    assert.ok(h.zones.length>0,frame);
    for(const z of h.zones){
      assert.ok(z.role==="support"?z.upper<=r.snapshot.price!:z.lower>=r.snapshot.price!);
      assert.ok(z.anchorIds.every(id=>r.indicators.pivots.some(a=>a.id===id&&a.confirmedAt!==null&&candleCloseTime(a.confirmedAt,frame)!<=h.knownAt)));
    }
    assert.ok(svg.includes(`data-horizon-context="${reading}"`));assert.ok(svg.includes('data-context-zone="support"'));
    assert.equal(GlobalReportSchema.safeParse(r).success,true);assert.ok(globalHorizonContextLines(r).length>2);
  }
});

test("weekly value covers the confirmed cycle rather than a five-candle local anchor",()=>{
  const r=make("1Wutc"),v=r.indicators.vwap!,h=r.horizonContext!;
  assert.equal(v.anchorReason,"cycle_low");assert.equal(v.anchorTs,Date.UTC(2022,10,21));assert.ok(v.points.length>150);
  assert.deepEqual(h.ranges.map(x=>[x.kind,x.lower,x.upper]),[["cycle",15450,124500],["decline_leg",57809.4,124500],["recovery_leg",57809.4,87399]]);
  assert.ok(h.zones.some(z=>z.role==="support"&&z.lower<=74955.5&&z.upper>=74955.5));
  const d=make("1Dutc");assert.equal(d.indicators.vwap!.anchorReason,"swing_low");assert.equal(d.indicators.vwap!.anchorTs,Date.UTC(2026,6,1));
  assert.deepEqual(d.horizonContext!.ranges.map(x=>[x.kind,x.lower,x.upper]),[["recovery_leg",57809.4,87399],["balance",79775.1,87399]]);
});

test("fast and hourly value use different completed calendar anchors",()=>{
  const fast=make("15m"),hourly=make("1H");
  assert.equal(fast.indicators.vwap!.anchorReason,"session_open");assert.equal(fast.indicators.vwap!.anchorTs,Date.UTC(2026,9,20));
  assert.equal(hourly.indicators.vwap!.anchorReason,"week_open");assert.equal(hourly.indicators.vwap!.anchorTs,Date.UTC(2026,9,19));
  const mixed=make("1Wutc");mixed.horizonContext!.timeframe="4H";assert.equal(GlobalReportSchema.safeParse(mixed).success,false);
});

test("context rejects padded price zones, reversed roles and later confirmation",()=>{
  for(const mutate of [(r:ReturnType<typeof make>)=>{r.horizonContext!.zones[0].lower-=1},(r:ReturnType<typeof make>)=>{r.horizonContext!.zones[0].role="resistance"},(r:ReturnType<typeof make>)=>{r.horizonContext!.zones[0].knownAt=0}]){
    const r=make("1Wutc");mutate(r);assert.equal(GlobalReportSchema.safeParse(r).success,false);
  }
});

test("bearish weekly and daily context retains the peak-to-trough leg and high-anchored value",()=>{
  const ceiling=300000,reflected=markets.map(m=>({...m,candles:m.candles.map(c=>({...c,open:ceiling-c.open,high:ceiling-c.low,low:ceiling-c.high,close:ceiling-c.close}))}));
  for(const frame of ["1Wutc","1Dutc"]){
    const r=prepareGlobalReport({market:reflected.find(m=>m.bar===frame)!,contextMarket:reflected.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:reflected,tier:"premium"}),h=r.horizonContext!;
    assert.equal(h.ranges.filter(x=>x.kind!=="balance").at(-1)!.kind,"decline_leg",frame);
    for(const leg of h.ranges.filter(x=>x.kind==="cycle"||x.kind==="decline_leg")){
      const a=leg.anchorIds.map(id=>r.indicators.pivots.find(p=>p.id===id)!);assert.equal(leg.lower,a.find(p=>p.kind==="low")!.price);assert.equal(leg.upper,a.find(p=>p.kind==="high")!.price);assert.ok(leg.startTs<leg.endTs);
    }
    assert.equal(r.indicators.vwap!.anchorReason,frame==="1Wutc"?"cycle_high":"swing_high");
    assert.ok(globalHorizonContextLines(r).some(line=>line.startsWith("Decline structure:")));
    assert.ok(globalReportChartSvg(r)!.includes('data-context-range="decline_leg"'));
    assert.equal(GlobalReportSchema.safeParse(r).success,true);
  }
});

test("range context rejects invented boundaries, reversed leg chronology and premature knowledge",()=>{
  for(const mutate of [(r:ReturnType<typeof make>)=>{r.horizonContext!.ranges[0].lower-=1},(r:ReturnType<typeof make>)=>{r.horizonContext!.ranges[2].kind="decline_leg"},(r:ReturnType<typeof make>)=>{r.horizonContext!.ranges[0].knownAt=r.horizonContext!.ranges[0].endTs}]){
    const r=make("1Wutc");mutate(r);assert.equal(GlobalReportSchema.safeParse(r).success,false);
  }
});

test("saved confirmed signals receive a separate context review without changing their prices",()=>{
  const {report}=tradePlanFixture("4H"),saved=GlobalReportSchema.parse(report);assert.equal(saved.tradePlan!.state,"confirmed");
  const before=structuredClone(saved),ref=globalArtifactReference(saved),review=reviewGlobalTargetReport(saved);
  assert.deepEqual(saved,before);assert.deepEqual(review.tradePlan,saved.tradePlan);assert.deepEqual(review.candles,saved.candles);
  assert.ok(review.horizonContext);assert.equal(review.targetReviewOf,ref);assert.notEqual(globalArtifactReference(review),ref);assert.equal(reviewGlobalTargetReport(review),review);
});

test("calendar-anchored bands can be restored from the same saved session",()=>{
  for(const frame of ["15m","1H"]){const r=make(frame),before=structuredClone(r.indicators.vwap);delete r.indicators.vwap!.bands;restoreGlobalSetupStudies(r);assert.deepEqual(r.indicators.vwap,before);}
});

test("narrative evidence receives the same primary cycle context and VWAP bands as the chart",()=>{
  const r=make("1Wutc"),e=globalPromptEvidence(r),v=e.indicators.anchoredVwap!;
  assert.deepEqual(e.horizonContext,r.horizonContext);assert.equal(e.horizonContext!.reading,"macro");
  assert.equal(v.anchorReason,"cycle_low");assert.equal(v.anchorTs,Date.UTC(2022,10,21));
  assert.deepEqual(v.bands,r.indicators.vwap!.bands!.map(b=>({multiple:b.multiple,upper:b.upper.at(-1)!.value,lower:b.lower.at(-1)!.value})));
  assert.equal(e.entryStudy!.timeframe,"1Dutc");assert.notEqual(e.entryStudy!.timeframe,e.horizonContext!.timeframe);
});
