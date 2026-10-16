import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { candleCloseTime, GlobalReportSchema } from "@pulse/schemas";
import { globalConfirmationEvidence, globalEligibility, globalRemoteLevels, globalSetupMap, globalReportChartSvg, reviewGlobalOrder, globalRiskLines, globalRemoteLevelLines, globalPrimaryAttemptEvidence } from "@pulse/domain";
import { summarizeCandles, type SpotMarketContext } from "@pulse/market";
import { assessGlobalReport } from "./globalAssessment.js";
import { qualifiedGlobalFixture } from "./globalAssessment.fixtures.js";
import { prepareGlobalReport } from "./globalReport.js";

const rows=JSON.parse(readFileSync(new URL("./globalReport.oct16-fixtures.json",import.meta.url),"utf8")) as Array<{date:string;frame:string;observedAt:string;candles:number[][];contextFrame:string;contextCandles:number[][]}>;
const market=(r:typeof rows[number],context=false):SpotMarketContext=>{
  const candles=(context?r.contextCandles:r.candles).map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));
  return {source:"okx-public-spot",instId:"BTC-USDT",bar:context?r.contextFrame:r.frame,candles,summary:summarizeCandles(candles),fetchedAt:r.observedAt,ticker:{instId:"BTC-USDT",last:candles.at(-1)!.close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:String(Date.parse(r.observedAt)),priceCurrency:"USDT"}};
};
test("invalidated primary attempts name their own failure candle and derived remote levels name their anchors",()=>{
  const r=rows.find(row=>row.date==="oct16"&&row.frame==="1W")!,report=prepareGlobalReport({market:market(r),contextMarket:market(r,true),tier:"premium"});
  const attempt=globalPrimaryAttemptEvidence(report)!;assert.equal(attempt.failure?.reason,"floor");
  const lines=globalRiskLines(report),failure=lines.find(line=>line.startsWith("Previous primary attempt"))!;
  assert.ok(failure.includes(new Date(attempt.failure!.completedAt!).toISOString()));assert.ok(failure.includes("80,400.00"));assert.ok(failure.includes("80,636.30"));
  assert.ok(globalReportChartSvg(report)!.includes("Previous primary attempt invalidated"));
  assert.ok(!lines.some(line=>line.startsWith("Latest disqualified")),"Older rejected tests must not obscure the later primary failure");
  const remote=globalRemoteLevelLines(report);assert.ok(remote.some(line=>line.includes("derived Fibonacci extension")&&line.includes("anchor date")));assert.ok(remote.some(line=>line.includes("historical price")));
});
for(const r of rows)test(`${r.date} ${r.frame}: local endpoints, nearest obstacles and immutable replay`,()=>{
  const input=market(r),report=prepareGlobalReport({market:input,contextMarket:market(r,true),tier:"premium"}),before=JSON.stringify(report),atr=report.indicators.atr.points.at(-1)!.value;
  assert.ok(GlobalReportSchema.safeParse(report).success);
  const above=report.levels.filter(l=>l.price>report.snapshot.price!).sort((a,b)=>a.price-b.price)[0]?.id,below=report.levels.filter(l=>l.price<report.snapshot.price!).sort((a,b)=>b.price-a.price)[0]?.id;
  for(const path of report.paths)for(const id of [...path.targetIds,...(path.stress?.targetIds??[])]){
    const level=report.levels.find(l=>l.id===id)!;
    assert.ok(Math.abs(level.price-report.snapshot.price!)<=4*atr || id===above || id===below,`Out-of-horizon ${level.price}`);
  }
  if(r.date==="oct16"&&r.frame==="1D"){
    assert.ok(globalRemoteLevels(report).some(l=>l.price===126200));
    assert.equal(globalEligibility(report),"no_trade");assert.ok(report.tradePlan!.grossRewardRisk!<.2);
    const assessment=assessGlobalReport(report,input,market(r,true));assert.equal(assessment.state,"no_trade");assert.ok(assessment.lines.some(l=>l.includes("confirmation alone cannot fix")));
  }
  if(r.date==="oct16"&&r.frame==="4H")assert.ok(globalRemoteLevels(report).some(l=>l.price===62268.5));
  const svg=globalReportChartSvg(report)!;assert.ok(svg.includes("Reference risk per unit"));
  globalSetupMap(report);assessGlobalReport(report,input,market(r,true));assert.equal(JSON.stringify(report),before);
});

test("a fresh completed retest advances to technical qualification without a model or guessed fees",()=>{
  const {report,market}=qualifiedGlobalFixture();
  const before=JSON.stringify(report),a=assessGlobalReport(report,market);
  assert.equal(a.state,"technical_valid");assert.ok(a.permittedEntry&&a.observedStop);assert.ok(a.observedStop<98);
  assert.equal(a.expiresAt,candleCloseTime(candleCloseTime(candleCloseTime(a.retestTs!,market.bar)!,market.bar)!,market.bar));
  assert.equal(JSON.stringify(report),before);
  const pending=structuredClone(market);pending.candles=pending.candles.slice(0,-2);pending.fetchedAt=new Date(candleCloseTime(pending.candles.at(-1)!.ts,market.bar)!).toISOString();
  const earlier=structuredClone(report);earlier.candles=pending.candles.map(c=>({...c,confirmed:true}));earlier.snapshot.observedAt=pending.fetchedAt;earlier.snapshot.lastCandleTs=earlier.candles.at(-1)!.ts;
  assert.equal(assessGlobalReport(earlier,pending).state,"waiting_retest");
  assert.equal(assessGlobalReport(earlier,market).state,"technical_valid");
  const expired={...market,fetchedAt:new Date(a.expiresAt!+1).toISOString()};assert.equal(assessGlobalReport(report,expired).state,"expired");
});

test("completed-bar deadlines work for 15m, 1H, 4H, 1D and 1W and failed bars cannot rearm themselves",()=>{
  for(const frame of ["15m","1H","4H","1D","1W"]){
    const {report,market}=qualifiedGlobalFixture(frame),p=report.tradePlan!;
    const e=globalConfirmationEvidence(report,{...p,side:"long",triggerLevelId:p.triggerLevelId!,invalidationLevelId:p.invalidationLevelId!});
    assert.ok(e.retest&&e.confirmation);assert.ok(e.expiresAt!>candleCloseTime(e.retest!.ts,frame)!);
    report.candles.at(-1)!.low=97.9;
    assert.equal(assessGlobalReport(report,{...market,candles:report.candles.map(c=>({...c,volumeCcy:0}))}).state,"invalidated");
  }
});

test("quoted order review succeeds and rejects missing costs, stale data, poor reward and short execution",()=>{
  const {report,market}=qualifiedGlobalFixture(),a=assessGlobalReport(report,market),now=Date.parse(a.assessedAt);
  const quote={observedAt:now,expiresAt:now+30_000,entry:100.3,quantity:1,roundTripLoss:.05,networkFees:.01,slippageBps:10,inputBalanceSufficient:true,representationVerified:true,currencyVerified:true};
  const ready=reviewGlobalOrder(a,quote,now);assert.equal(ready.state,"ready_for_order_review");assert.ok(ready.netRewardRisk!>=1.5);assert.ok(ready.cashRisk!>100.3-a.observedStop!);
  for(const invalid of [{networkFees:null},{inputBalanceSufficient:false},{representationVerified:false},{currencyVerified:false},{entry:120},{roundTripLoss:8},{observedAt:now-31_000}])assert.equal(reviewGlobalOrder(a,{...quote,...invalid},now).state,"blocked");
  for(const invalid of [{side:"short" as const},{observedStop:null},{state:"expired" as const},{assessedAt:new Date(now-61_000).toISOString()}])assert.equal(reviewGlobalOrder({...a,...invalid},quote,now).state,"blocked");
});

test("completed objectives, revised source bars and stale independent context cannot authorize a fresh entry",()=>{
  const {report,market}=qualifiedGlobalFixture();
  const reached=structuredClone(report);reached.candles.at(-1)!.high=110.1;
  const afterTarget=assessGlobalReport(reached,{...market,candles:reached.candles.map(c=>({...c,volumeCcy:0}))});assert.equal(afterTarget.state,"expired");assert.ok(afterTarget.blockers.includes("target_reached"));assert.equal(afterTarget.observedStop,null);
  const revised=structuredClone(market);revised.candles[10].high+=.1;
  assert.ok(assessGlobalReport(report,revised).blockers.includes("source_revised"));
  const pro=structuredClone(report);pro.tier="pro";
  const context=qualifiedGlobalFixture("4H",Date.parse(market.fetchedAt)-86_400_000).market;
  assert.equal(assessGlobalReport(pro,market,context).context,"unknown");assert.ok(assessGlobalReport(pro,market,context).blockers.includes("context"));
  const fresh=qualifiedGlobalFixture("4H",Date.parse(market.fetchedAt)).market;
  assert.equal(assessGlobalReport(pro,market,fresh).state,"technical_valid");
});
