import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";
import {globalArtifactReference,globalTradePlan,globalPlanCandidates,globalDecision,globalReportChartSvg,globalPathLines,globalStructuralWindow,globalStructuralScaleValues,globalDefaultChartLayers,globalFibonacciDescription,globalWaveExplanationLines,globalNextSetupLines,globalTradePlanLines,deriveGlobalTradePlan} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {entryPlanFixture} from "./globalEntryPlan.fixtures.js";
import {assessGlobalReport} from "./globalAssessment.js";

const data=JSON.parse(readFileSync(new URL("./globalReport.oct17-fixtures.json",import.meta.url),"utf8")) as {byFrame:Record<string,number[][]>;requests:string[][]};
function replay(frame:string,cutoff:string,version:"decision-v2"|"decision-v3"="decision-v3"){
  const markets=Object.entries(data.byFrame).map(([bar,rows]):SpotMarketContext=>{
    const candles=rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)!<=Date.parse(cutoff));
    return {source:"okx-public-spot",instId:"BTC-USDT",bar,fetchedAt:cutoff,candles,summary:summarizeCandles(candles),ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:candles.at(-1)!.close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:"0"}};
  });
  return prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium",decisionVersion:version});
}
const reports=data.requests.map(([frame,at])=>replay(frame,at));
for(const [frame,at,ref] of data.requests)test(`${frame}: legacy numeric identity is retained; new method is explicitly versioned`,()=>{
  const old=replay(frame,at,"decision-v2"),saved=structuredClone(old.tradePlan);
  assert.equal(globalArtifactReference(old),ref);
  assert.deepEqual(globalTradePlan(old),saved);
  const current=reports.find(r=>r.snapshot.timeframe===frame)!;
  assert.equal(current.tradePlan!.method,"structure-v3");assert.equal(GlobalReportSchema.safeParse(current).success,true);
});
for(const frame of ["1H","1Dutc"])test(`${frame}: rejected BUY and SELL remain symmetric mixed scenarios regardless of array order`,()=>{
  const r=reports.find(r=>r.snapshot.timeframe===frame)!,d=globalDecision(r);
  assert.equal(d.direction,"BUY / SELL");assert.equal(d.qualified,false);assert.match(d.marketView,/Mixed/);
  assert.ok(d.scenarios.some(s=>s.plan.side==="long"&&s.plan.blockers.includes("reward")));
  assert.ok(d.scenarios.some(s=>s.plan.side==="short"&&s.plan.blockers.includes("reward")));
  const reordered=structuredClone(r);reordered.paths.reverse();reordered.paths.forEach(p=>p.role=p.direction==="up"?"main":"alternative");
  assert.equal(globalDecision(reordered).heading,d.heading);
  assert.ok(!globalNextSetupLines(r).some(line=>/SL|entry zone/i.test(line)),"Rejected example geometry is not promoted to a setup");
});
test("4H: both unconfirmed range-edge families remain visible and TP1 cannot skip a mapped swing",()=>{
  const r=reports.find(r=>r.snapshot.timeframe==="4H")!,candidates=globalPlanCandidates(r).filter(p=>p.family?.startsWith("range_"));
  assert.equal(candidates.length,2);assert.ok(r.tradePlan!.family?.startsWith("range_"));
  for(const p of candidates){
    assert.equal(p.confirmationTs,null);assert.equal(p.retestTs,null);assert.notEqual(p.state,"confirmed");
    const trigger=r.levels.find(l=>l.id===p.triggerLevelId)!.price,first=r.levels.find(l=>l.id===p.targetIds[0])!.price,sign=p.side==="long"?1:-1;
    assert.equal(r.levels.filter(l=>l.basis==="swing"&&sign*(l.price-trigger)>0&&sign*(first-l.price)>0).length,0);
    assert.ok(p.grossRewardRisk!<12,"Far-edge 44R is not the first-obstacle reward");
  }
  assert.equal(r.levels.find(l=>l.id===r.tradePlan!.targetIds[0])!.price,82800);
  const svg=globalReportChartSvg(r)!;assert.ok(svg.includes('data-range-bounds="observed"'));assert.ok(!svg.includes('L 876.4'),"No fixed future range zigzag");
  for(const id of r.tradePlan!.targetIds)assert.ok(svg.includes(`<g data-level-id="${id}">`),"The price axis labels every selected first-obstacle target");
});
for(const r of reports)test(`${r.snapshot.timeframe}: enabled channel pairs fit the exported and native shared viewport`,()=>{
  const window=globalStructuralWindow(r),bars=r.candles.slice(-window),values=globalStructuralScaleValues(r,bars[0].ts,globalDefaultChartLayers(r)),svg=globalReportChartSvg(r)!;
  const defaults=globalDefaultChartLayers(r);assert.equal(defaults.fibonacci,true);assert.equal(defaults.allSmas,true);assert.equal(defaults.regression,true);
  assert.ok(svg.includes('data-fibonacci="confirmed-swing"'));assert.ok(svg.includes("SMA233"));assert.ok(svg.includes('stroke="#31b8da"'));
  const reduced=globalReportChartSvg(r,{layers:{fibonacci:false,allSmas:false,regression:false}})!;
  assert.ok(!reduced.includes('data-fibonacci="confirmed-swing"'));assert.ok(!reduced.includes("SMA233"));
  assert.ok(values.length||!r.indicators.channels?.length);
  for(const c of r.indicators.channels??[]){
    assert.ok(c.startTs>=bars[0].ts,"Construction anchors remain visible");
    for(const edge of ["lower","upper"])assert.ok(svg.includes(`data-channel="${c.scope}" data-edge="${edge}"`),`Visible ${c.scope} ${edge}`);
  }
  assert.ok(!/NaN|Infinity|WAIT|EXPIRED|INVALIDATED|NO TRADE/.test(svg));
});
test("weekly: daily entry rules, newer entry close, post-C recovery and macro Fib dates are explicit",()=>{
  const r=reports.find(r=>r.snapshot.timeframe==="1Wutc")!,d=globalDecision(r),buy=d.scenarios.find(s=>s.plan.side==="long")!;
  assert.equal(d.structureTimeframe,"1Wutc");assert.equal(d.entryTimeframe,"1Dutc");assert.match(buy.condition,/1D \(UTC\) close above 82,842/);
  assert.ok(globalPathLines(r,r.paths.find(p=>p.id===buy.plan.pathId)!).some(s=>s.includes(buy.condition)));
  assert.match(globalNextSetupLines(r).join("\n"),/81,617.50/);
  assert.match(globalWaveExplanationLines(r).join("\n"),/current hypothesis is post-C recovery/);
  assert.match(globalFibonacciDescription(r).join("\n"),/2023-08-14.*2025-08-11/);
  assert.ok(!/\b\d+[DWM]utc\b/.test(globalTradePlanLines(r).join("\n")));
  for(const p of globalPlanCandidates(r).filter(p=>p.family==="breakout_retest"&&p.side!=="none")){
    const trigger=r.levels.find(l=>l.id===p.triggerLevelId)!.price;
    if(!p.retestTs)assert.ok(p.side==="long"?p.referenceEntry![0]>=trigger:p.referenceEntry![1]<=trigger,"Prospective entry stays on its directional side");
  }
});
for(const side of ["long","short"] as const)for(const family of ["breakout_retest","reaction"] as const)test(`v3 ${side} ${family}: positive observed signal and authenticated recheck agree`,()=>{
  const {report,market,entry,context}=entryPlanFixture(side,family);report.decisionVersion="decision-v3";report.tradePlan=deriveGlobalTradePlan(report);
  assert.equal(report.tradePlan.method,"structure-v3");assert.equal(report.tradePlan.state,"confirmed");assert.equal(globalDecision(report).qualified,true);
  const assessment=assessGlobalReport(report,market,context,entry);
  assert.equal(assessment.state,"technical_valid");assert.deepEqual(assessment.permittedEntry,report.tradePlan.referenceEntry);assert.equal(assessment.observedStop,report.tradePlan.referenceStop);
});
