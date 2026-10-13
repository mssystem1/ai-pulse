import test from "node:test";
import assert from "node:assert/strict";
import {GlobalReportSchema} from "@pulse/schemas";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalTradePlan} from "./globalTradePlan.js";
import {globalTradePlanLines} from "./globalPresentation.js";
import {globalReportChartSvg} from "./globalChart.js";

test("a bearish saved map supplies short references without changing its historical buy setup",()=>{
  const report=globalDesignFixture(),before=structuredClone(report),plan=globalTradePlan(report);
  assert.equal(plan.side,"short");assert.equal(plan.pathId,"correction");
  assert.ok(plan.referenceStop!>plan.referenceEntry![1]);
  assert.ok(report.levels.find(l=>l.id===plan.targetIds[0])!.price<plan.referenceEntry![0]);
  assert.match(globalTradePlanLines(report).join("\n"),/sell\/reduce owned inventory/);
  assert.deepEqual(report,before,"Rendering must not rewrite an old purchased report");
});
test("insufficient reward remains visible with a concrete no-entry explanation",()=>{
  const report=globalDesignFixture(),atr=report.indicators.atr.points.at(-1)!.value,trigger=report.levels.find(l=>l.id==="reclaim")!.price;
  report.levels.find(l=>l.id==="floor")!.price=trigger-.06*atr;
  const plan=globalTradePlan(report);assert.equal(plan.state,"avoid");assert.ok(plan.grossRewardRisk!<1.5);assert.ok(plan.referenceEntry&&plan.referenceStop);
  assert.match(globalTradePlanLines(report).join("\n"),/below 1.50; avoid entry/);
});
test("canonical plan validation rejects reversed prices and mismatched chart targets",()=>{
  const report=globalDesignFixture();report.tradePlan=globalTradePlan(report);assert.equal(GlobalReportSchema.safeParse(report).success,true);
  const inverted=structuredClone(report);inverted.tradePlan!.referenceStop=1;assert.equal(GlobalReportSchema.safeParse(inverted).success,false);
  const drift=structuredClone(report);drift.tradePlan!.targetIds=["target1"];assert.equal(GlobalReportSchema.safeParse(drift).success,false);
});
test("exports focus recent candles while retaining an explicitly requested full history",()=>{
  const report=globalDesignFixture();assert.match(globalReportChartSvg(report)!,/180 \/ 520 COMPLETED CANDLES/);assert.match(globalReportChartSvg(report,{fullHistory:true})!,/520 \/ 520 COMPLETED CANDLES/);
  assert.equal(report.candles.length,520);assert.match(globalReportChartSvg(report)!,/Planned SL reference \(not observed protection\)/);
});
test("a failed support close requires a new confirmation and subsequent test",()=>{
  const report=globalDesignFixture();report.paths[0].role="alternative";report.paths[1].role="main";report.paths[1].confirmation="support_hold";
  report.levels.find(l=>l.id==="floor")!.price=116;
  const tail=report.candles.slice(-6).map(c=>({...c,open:117.35,high:117.6,low:117.31,close:117.35}));
  tail[0].low=117.2;tail[1]={...tail[1],open:117,high:117.1,low:116.7,close:116.8};tail[5].low=117.25;
  report.candles=[...report.candles.slice(0,-6),...tail];report.snapshot.price=117.35;
  report.indicators.pivots.push({id:"support-test",ts:report.candles.at(-10)!.ts,confirmedAt:report.candles.at(-7)!.ts,price:117.3,kind:"low"});report.levels.find(l=>l.id==="reclaim")!.anchorIds=["support-test"];
  const plan=globalTradePlan(report);assert.equal(plan.confirmationTs,tail[5].ts);assert.equal(plan.retestTs,null);assert.ok(plan.blockers.includes("retest"));assert.notEqual(plan.state,"confirmed");
});
test("a very close first obstacle is retained instead of pricing reward to a farther target",()=>{
  const report=globalDesignFixture(),trigger=report.levels.find(l=>l.id==="reclaim")!.price,atr=report.indicators.atr.points.at(-1)!.value;
  report.levels.find(l=>l.id==="floor")!.price=trigger-.01*atr;
  report.tradePlan=globalTradePlan(report);assert.equal(report.tradePlan.targetIds[0],"floor");assert.ok(report.tradePlan.grossRewardRisk!<1.5);assert.ok(report.tradePlan.blockers.includes("reward"));assert.equal(GlobalReportSchema.safeParse(report).success,true);
});
