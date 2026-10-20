import test from "node:test";
import assert from "node:assert/strict";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {deriveGlobalEntryPlan,globalEntryGeometry,selectSingleGlobalSetup,globalEligibility} from "@pulse/domain";
import {tradePlanFixture} from "./globalTrade.fixtures.js";
import {globalConfirmedPivots,globalWilderIndicators} from "./globalReport.js";
import {assessGlobalEntryReport} from "./globalEntryAssessment.js";

test("the current profile measures an observed entry band without clipping its worst price to the R threshold",()=>{
  const g=globalEntryGeometry("long",[100,102],98,105,.01,false);
  assert.deepEqual(g.entry,[100,102]);assert.equal(g.rr,.75);
  const mirror=globalEntryGeometry("short",[98,100],102,95,.01,false);
  assert.deepEqual(mirror.entry,[98,100]);assert.equal(mirror.rr,.75);
});

for(const side of ["long","short"] as const)test(`${side}: a nearer confirmed entry-frame obstacle blocks distant-target reward and retains its real timeframe`,()=>{
  const {report:r}=tradePlanFixture("4H",side),study=r.entryStudy!,bar=study.candles.at(-20)!;
  // This pivot is known before the observed retest; no later close consumes it.
  if(side==="long")bar.high=100.5;else bar.low=99.5;
  study.pivots=globalConfirmedPivots(study.candles);study.atr=globalWilderIndicators(study.candles).atr;
  const p=deriveGlobalEntryPlan(r);r.tradePlan=p;
  assert.ok(p.retestTs);assert.ok(p.entryObstacle);assert.equal(p.entryObstacle.timeframe,study.timeframe);
  assert.equal(p.entryObstacle.price,side==="long"?100.5:99.5);
  assert.ok(p.entryObstacle.knownAt<=candleCloseTime(p.retestTs!,study.timeframe)!);
  assert.ok(p.grossRewardRisk!>1.5);assert.ok(p.firstObstacleRewardRisk!<1.5);
  assert.ok(p.blockers.includes("reward"));assert.notEqual(globalEligibility(r),"technical_valid");
  const fabricated=structuredClone(r);fabricated.tradePlan!.entryObstacle!.timeframe="1Dutc";
  assert.equal(GlobalReportSchema.safeParse(fabricated).success,false);
});

test("a bounded primary range cannot veto an already observed directional retest",()=>{
  const {report:r}=tradePlanFixture(),p=r.tradePlan!;
  assert.ok(p.retestTs);assert.equal(p.side,"long");
  const anchors=r.indicators.pivots.filter(a=>a.confirmedAt!==null).slice(0,4);
  r.range={lower:[90,91],upper:[110,111],anchorIds:anchors.map(a=>a.id),startTs:anchors[0].ts,touches:4};
  const s=selectSingleGlobalSetup(r);
  assert.equal(s.selection.side,"long");assert.equal(s.plan.retestTs,p.retestTs);
  assert.equal(s.selection.regime,"transition");assert.equal(s.selection.assessment,"sideways");
});

test("fresh assessment forwards the actual entry-frame barrier to the quote cost gate",()=>{
  const {report:r,market,entry,context}=tradePlanFixture();
  r.entryStudy!.candles.at(-20)!.high=100.5;entry.candles.at(-20)!.high=100.5;
  r.entryStudy!.pivots=globalConfirmedPivots(r.entryStudy!.candles);r.entryStudy!.atr=globalWilderIndicators(r.entryStudy!.candles).atr;
  r.tradePlan=deriveGlobalEntryPlan(r);
  const a=assessGlobalEntryReport(r,market,context,entry);
  assert.equal(a.state,"no_trade");assert.ok(a.blockers.includes("reward"));assert.ok(a.checkpointTargets!.includes(100.5));
  assert.ok(a.firstObstacleRewardRisk!<1.5);
});
