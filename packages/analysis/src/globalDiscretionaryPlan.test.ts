import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GlobalReportSchema,candleCloseTime} from "@pulse/schemas";
import {globalTradeCards,globalRiskMeasurement,globalSetupStrategyProfile,globalReportChartSvg,globalEntryStudySvg,globalArtifactReference,globalDecision,globalSections} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {applyGlobalDiscretionaryPlan} from "./globalDiscretionaryPlan.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";
import {selectGlobalSetupContext} from "./globalSetupContext.js";

const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
const make=(frame:string)=>prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium"});

test("all five horizons retain their own objective and protection frames with a complete priced setup",()=>{
  for(const [frame,entry] of [["15m","5m"],["1H","15m"],["4H","1H"],["1Dutc","4H"],["1Wutc","1D"]]){
    const report=make(frame),p=report.discretionaryPlan!,card=globalTradeCards(report)[0],risk=globalRiskMeasurement(report)!;
    assert.ok(p,frame);assert.equal(globalSetupStrategyProfile(frame)!.entry,entry);
    assert.equal(p.objectiveTimeframe,frame);assert.equal(p.stopBasis.timeframe,frame);assert.equal(risk.timeframe,frame);
    const decision=globalDecision(report);
    assert.equal(decision.nextSetup.trigger,p.entry);assert.equal(decision.nextSetup.planningStop,p.stop);
    assert.deepEqual(decision.nextSetup.targets.map(t=>t.price),p.targets.map(t=>t.price));assert.equal(decision.currentAction,"WAIT");
    assert.ok(decision.changeView.includes(p.stopBasis.price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})));
    assert.deepEqual(globalSections(report).find(s=>s.title==="Setup route")!.lines,[decision.route,decision.entryInstruction,decision.changeView]);
    assert.ok(p.targets.every(t=>t.timeframe===frame));assert.equal(card.confirmed,false);
    const sign=p.side==="long"?1:-1;assert.ok(sign*(p.entry-p.stop)>0);assert.ok(sign*(p.stopBasis.price-p.stop)>0);
    assert.ok(p.targets.every((t,i)=>sign*(t.price-p.entry)>0&&(i===0||sign*(t.price-p.targets[i-1].price)>0)));
    assert.equal(GlobalReportSchema.safeParse(report).success,true);assert.ok(Number.isFinite(card.rr));
    assert.match(globalReportChartSvg(report)!,/data-trade-price-ledger=/);assert.doesNotMatch(globalReportChartSvg(report)!,/NO VALIDATED ENTRY|No validated entry/);
    if(report.entryStudy?.status==="available"){
      const detail=globalEntryStudySvg(report)!;assert.ok(detail.includes('data-entry-local-scale="true"'));
      assert.ok(detail.includes(`data-entry-price-role="SL" data-price="${p.stop}"`)||/data-entry-offscale-levels="[^"]*SL/.test(detail));
    }
  }
});

test("a distant weekly SL cannot flatten the daily entry detail or change any plan price",()=>{
  const report=make("1Wutc"),before=structuredClone(report),detail=globalEntryStudySvg(report)!;
  assert.ok(detail.includes('data-entry-local-scale="true"'));assert.deepEqual(report,before);
  const stretched=structuredClone(report),p=stretched.discretionaryPlan!;p.stop=Math.max(1,p.entry*.15);p.stopBasis.price=p.stop+1;
  const far=globalEntryStudySvg(stretched)!;
  assert.ok(far.includes('data-entry-offscale-levels="SL"')||/data-entry-offscale-levels="[^"]*SL/.test(far));
  assert.doesNotMatch(far,/data-entry-price-role="SL"/);assert.match(far,/Full Entry, SL and targets remain on the main chart/);
  const main=globalReportChartSvg(stretched)!;assert.ok(main.includes(`data-trade-role="SL" data-price="${p.stop}"`));
  const firstCandle=/<rect x="[^\"]+" y="[^\"]+" width="[^\"]+" height="([^\"]+)" fill="#(?:35d0aa|ef6b85)"\/>/;
  assert.equal(far.match(firstCandle)?.[1],detail.match(firstCandle)?.[1],'Moving only off-scale primary protection must not shrink entry candles');
});

test("daily range protection uses the daily low and daily volatility; 4H barriers never become daily targets",()=>{
  const report=make("1Dutc"),p=report.discretionaryPlan!,atr=report.indicators.atr.points.at(-1)!.value;
  assert.equal(p.family,"breakout_retest");assert.equal(p.entry,82291.1);
  assert.equal(p.stopBasis.price,79775.1);assert.ok(Math.abs(p.stop-(79775.1-atr*.2))<1e-6);
  assert.ok(p.stop<79775.1);assert.ok(Math.abs(p.entry-p.stop)>atr);
  assert.deepEqual(p.targets.map(t=>t.price),[84361.6,87238.3]);assert.ok(p.barriers.some(t=>t.price===83168.2&&t.timeframe==="4H"));
  assert.ok(globalTradeCards(report)[0].rr!<1.5,"A priced setup is not hidden by the legacy reward gate");
  const changed=structuredClone(report);changed.discretionaryPlan!.targets[0].price+=1;
  assert.notEqual(globalArtifactReference(changed),globalArtifactReference(report));
});

test("a technical review restores missing setup studies without modifying the saved report",()=>{
  const saved=make("1Dutc"),expected=structuredClone(saved.indicators);
  delete saved.discretionaryPlan;delete saved.indicators.ema;
  if(saved.indicators.vwap){delete saved.indicators.vwap.bands;delete saved.indicators.vwap.anchorTs;delete saved.indicators.vwap.knownAt;delete saved.indicators.vwap.basis;}
  const before=structuredClone(saved),review=reviewGlobalTargetReport(saved);
  assert.deepEqual(saved,before);assert.deepEqual(review.candles,saved.candles);
  assert.deepEqual(review.indicators.ema,expected.ema);assert.deepEqual(review.indicators.vwap,expected.vwap);
  assert.ok(review.discretionaryPlan);assert.equal(review.targetReviewOf,globalArtifactReference(saved));
  assert.equal(reviewGlobalTargetReport(review),review);
});

test("entry-frame data cannot fabricate a priced setup without primary history",()=>{
  const report=make("1Dutc");assert.equal(report.entryStudy!.status,"available");
  report.candles=[];applyGlobalDiscretionaryPlan(report);assert.equal(report.discretionaryPlan,undefined);
});

test("a displayed daily setup rejects lower-frame protection and future barrier evidence",()=>{
  const report=make("1Dutc"),wrong=structuredClone(report);
  wrong.discretionaryPlan!.stopBasis.timeframe="4H";
  assert.equal(GlobalReportSchema.safeParse(wrong).success,false);
  const future=structuredClone(report);future.discretionaryPlan!.barriers[0].knownAt=Date.parse(future.snapshot.observedAt)+1;
  assert.equal(GlobalReportSchema.safeParse(future).success,false);
});

test("VWAP rejection uses primary-frame band entry, outer-band protection and first-band/center exits",()=>{
  const report=make("1Dutc"),primary=report.candles.at(-1)!,vwap=report.indicators.vwap!,two=vwap.bands!.find(b=>b.multiple===2)!.upper.at(-1)!.value;
  const three=vwap.bands!.find(b=>b.multiple===3)!.upper.at(-1)!.value,one=vwap.bands!.find(b=>b.multiple===1)!.upper.at(-1)!.value;
  primary.high=two+100;primary.close=two-100;report.snapshot.price=primary.close;
  applyGlobalDiscretionaryPlan(report);const p=report.discretionaryPlan!;
  assert.equal(p.family,"vwap_reversion");assert.equal(p.side,"short");assert.equal(p.entry,two);assert.ok(p.stop>three);
  assert.deepEqual(p.targets.map(t=>[t.price,t.timeframe,t.basis]),[[one,"1Dutc","vwap_band"],[vwap.points.at(-1)!.value,"1Dutc","vwap_band"]]);
  assert.equal(p.entryBasis.knownAt,candleCloseTime(primary.ts,"1Dutc"));assert.equal(p.stopBasis.timeframe,"1Dutc");
  const lowerOnly=make("1Dutc"),bar=lowerOnly.entryStudy!.candles.at(-1)!;bar.high=two+100;bar.close=two-100;
  applyGlobalDiscretionaryPlan(lowerOnly);assert.notEqual(lowerOnly.discretionaryPlan!.family,"vwap_reversion","An entry-frame excursion alone cannot create a daily band rejection");
});

function balanced(){
  const report=make("1Dutc");report.indicators.vwap=null;report.indicators.pivots=[];report.entryStudy!.pivots=[];
  return report;
}
function choose(report:ReturnType<typeof make>){
  const study=report.entryStudy!,bars=study.candles;
  return selectGlobalSetupContext(report,{bars,timeframe:study.timeframe,completedAt:candleCloseTime(bars.at(-1)!.ts,study.timeframe)!,primaryClosed:candleCloseTime(report.candles.at(-1)!.ts,report.snapshot.timeframe)!,primaryAtr:report.indicators.atr.points.at(-1)!.value,cutoff:Date.parse(report.snapshot.observedAt)});
}

test("range location and structural reclaim do not change with the last candle color",()=>{
  for(const structural of [false,true]){
    const report=structural?make("1Dutc"):balanced(),last=report.entryStudy!.candles.at(-1)!;
    const first=choose(report);last.open=last.close-1;const green=choose(report);last.open=last.close+1;const red=choose(report);
    assert.deepEqual(green,first);assert.deepEqual(red,first);assert.equal(first.side,"long");
    assert.equal(first.family,structural?"breakout_retest":"range_rotation");
  }
});

test("balanced long and short rotations use geometric midpoint, quartile and opposite edge",()=>{
  for(const side of ["long","short"] as const){
    const report=balanced(),range=report.range!,low=range.lower[1],high=range.upper[0],span=high-low;
    report.entryStudy!.candles.at(-1)!.close=side==="long"?low+span*.2:low+span*.8;
    applyGlobalDiscretionaryPlan(report);const p=report.discretionaryPlan!;
    assert.equal(p.family,"range_rotation");assert.equal(p.side,side);
    assert.equal(p.entry,side==="long"?low:high);
    assert.deepEqual(p.targets.map(t=>[t.price,t.basis]),[[low+span*.5,"range_midpoint"],[low+span*(side==="long"?.75:.25),"range_quartile"],[side==="long"?high:low,"range_boundary"]]);
    assert.equal(p.stopBasis.price,side==="long"?range.lower[0]:range.upper[1]);
    assert.match(globalTradeCards(report)[0].targets[0].source,/geometric range midpoint/);
  }
});

test("range escapes use broken-edge protection and external objectives on both sides",()=>{
  for(const side of ["long","short"] as const){
    const report=balanced(),range=report.range!,sign=side==="long"?1:-1;
    const edge=side==="long"?range.upper[1]:range.lower[0];
    report.entryStudy!.candles.at(-1)!.close=edge+sign*100;
    applyGlobalDiscretionaryPlan(report);const p=report.discretionaryPlan!;
    assert.equal(p.family,"breakout_retest");assert.equal(p.entryBasis.kind,"range_edge");assert.equal(p.entry,edge);
    assert.equal(p.stopBasis.price,side==="long"?range.upper[0]:range.lower[1]);
    assert.ok(p.targets.every(t=>sign*(t.price-edge)>0));
  }
});

test("a lost structural cross and future pivot cannot supply the current entry",()=>{
  const report=balanced(),bars=report.entryStudy!.candles,anchor=make("1Dutc").entryStudy!.pivots.find(a=>a.price===82291.1)!;
  report.entryStudy!.pivots=[anchor];assert.equal(choose(report).entryBasis.kind,"reclaimed_level");
  bars.at(-1)!.close=anchor.price-1;assert.equal(choose(report).family,"range_rotation");
  bars.at(-1)!.close=anchor.price+1;report.entryStudy!.pivots[0]={...anchor,confirmedAt:bars.at(-1)!.ts};
  assert.equal(choose(report).family,"range_rotation","A pivot learned at the close cannot establish the break earlier in that same candle");
});

test("an obsolete crossed level cannot override the latest local structural sequence",()=>{
  const report=make("4H"),p=report.discretionaryPlan!;
  assert.equal(p.side,"long");assert.equal(p.family,"breakout_retest");assert.equal(p.entry,82276.2);
  assert.notEqual(p.entry,82800);assert.ok(p.targets.every(t=>t.price<=report.range!.upper[1]));
});

test("old conditional plans receive an explicit v2 review without changing saved source data",()=>{
  const original=make("1Dutc");original.discretionaryPlan!.version="discretionary-plan-v1";
  original.discretionaryPlan!.entry=80400;original.discretionaryPlan!.entryBasis.price=80400;
  const before=structuredClone(original),review=reviewGlobalTargetReport(original);
  assert.deepEqual(original,before);assert.deepEqual(review.candles,before.candles);assert.deepEqual(review.entryStudy,before.entryStudy);
  assert.equal(review.discretionaryPlan!.version,"discretionary-plan-v2");assert.equal(review.discretionaryPlan!.entry,82291.1);
  assert.equal(review.targetReviewOf,globalArtifactReference(original));assert.equal(reviewGlobalTargetReport(review),review);
});

test("conditional barriers retain both primary and entry evidence, rejecting foreign frames",()=>{
  const report=balanced(),study=report.entryStudy!,bar=report.candles.at(-1)!,price=bar.high;
  const entryAnchor=make("1Dutc").entryStudy!.pivots.find(a=>a.price===83168.2)!;
  report.indicators.pivots=[{id:"primary-barrier",kind:"high",price,ts:bar.ts,confirmedAt:bar.ts}];
  study.pivots=[entryAnchor];
  applyGlobalDiscretionaryPlan(report);
  assert.ok(report.discretionaryPlan!.barriers.some(b=>b.timeframe==="1Dutc"));
  assert.ok(report.discretionaryPlan!.barriers.some(b=>b.timeframe==="4H"));
  const wrong=make("1Dutc");wrong.discretionaryPlan!.barriers[0].timeframe="15m";
  assert.equal(GlobalReportSchema.safeParse(wrong).success,false);
});

test("v2 range geometry is validated against its source rather than accepted as arbitrary targets",()=>{
  const report=make("1Dutc");report.entryStudy!.pivots=[];report.indicators.vwap=null;applyGlobalDiscretionaryPlan(report);
  assert.equal(report.discretionaryPlan!.family,"range_rotation");assert.equal(GlobalReportSchema.safeParse(report).success,true);
  report.discretionaryPlan!.targets[0].price+=10;assert.equal(GlobalReportSchema.safeParse(report).success,false);
});
