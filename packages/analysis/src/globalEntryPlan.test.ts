import test from "node:test";
import assert from "node:assert/strict";
import {GlobalReportSchema,candleCloseTime} from "@pulse/schemas";
import {deriveGlobalTradePlan,globalEntryGeometry,globalDecision,globalTradePlanTitle,globalReportChartSvg,reviewGlobalOrder} from "@pulse/domain";
import {entryPlanFixture} from "./globalEntryPlan.fixtures.js";
import {assessGlobalReport} from "./globalAssessment.js";

for(const side of ["long","short"] as const)for(const family of ["breakout_retest","reaction"] as const)test(`${side} ${family}: report and recheck share the same measured entry, stop and reward`,()=>{
  const {report,market,entry,context}=entryPlanFixture(side,family),before=structuredClone(report),p=report.tradePlan!;
  assert.equal(GlobalReportSchema.safeParse(report).success,true);
  assert.equal(p.side,side);assert.equal(p.state,"confirmed");assert.equal(p.entryTimeframe,"1H");assert.equal(p.evidenceKind,family==="reaction"?"follow_through":"held_retest");
  assert.equal(globalDecision(report).qualified,true);
  const assessment=assessGlobalReport(report,market,context,entry);
  assert.equal(assessment.state,"technical_valid");assert.equal(assessment.entryTimeframe,"1H");assert.equal(assessment.timeframe,"4H");
  assert.deepEqual(assessment.permittedEntry,p.referenceEntry);assert.equal(assessment.observedStop,p.referenceStop);assert.equal(assessment.grossRewardRisk,p.grossRewardRisk);
  const now=Date.parse(assessment.assessedAt),quote={observedAt:now,expiresAt:now+30000,entry:entry.candles.at(-1)!.close,quantity:1,roundTripLoss:.01,networkFees:.01,slippageBps:0,inputBalanceSufficient:true,representationVerified:true,currencyVerified:true};
  assert.equal(reviewGlobalOrder(assessment,quote,now).state,side==="long"?"ready_for_order_review":"blocked");
  assert.deepEqual(report,before);
});
test("reward limits intersect a structural band and never expand it to a remote R-only price",()=>{
  const x=globalEntryGeometry("long",[100,101],98,105);assert.ok(x.entry);assert.ok(x.entry[1]<=101);assert.ok(x.rr!>=1.5);
  assert.equal(globalEntryGeometry("long",[104,105],98,106).entry,null);
  assert.deepEqual(globalEntryGeometry("short",[99,100],102,95).entry,[99.2,100]);
});
test("missing lower-frame evidence, revised candles and opposing context cannot authorize an entry",()=>{
  const {report,market,entry,context}=entryPlanFixture();
  assert.equal(assessGlobalReport(report,market,context).state,"no_trade");
  const revised=structuredClone(entry);revised.candles[10].high+=.1;
  assert.ok(assessGlobalReport(report,market,context,revised).blockers.includes("source_revised"));
  const r=structuredClone(report);r.context.status="unavailable";assert.equal(globalDecision(r).qualified,false);
  delete r.entryStudy;r.tradePlan=deriveGlobalTradePlan(r);assert.equal(r.tradePlan.side,"none");assert.ok(r.tradePlan.blockers.includes("history"));
  const noAnchor=structuredClone(report);noAnchor.indicators.pivots=[];assert.ok(deriveGlobalTradePlan(noAnchor).blockers.includes("levels"));
});
test("a failed bar cannot rearm itself, history is separate from the next directional condition",()=>{
  const {report}=entryPlanFixture();Object.assign(report.entryStudy!.candles.at(-1)!,{open:100.35,close:99.7,low:99.6});report.tradePlan=deriveGlobalTradePlan(report);
  assert.equal(report.tradePlan.confirmationTs,null);assert.equal(report.tradePlan.retestTs,null);assert.ok(report.tradePlan.failure);
  assert.ok(!/WAIT|EXPIRED|INVALIDATED|NO TRADE/.test(globalTradePlanTitle(report)));
  assert.ok(globalDecision(report).previousAttempts.length>0);
  const svg=globalReportChartSvg(report)!;assert.ok(svg.includes('data-plan-stage="ENTRY"'));assert.ok(!svg.includes('data-stage="ENTRY"'));
});
test("signal freshness ends at the next entry close, without a universal two-bar setup lifetime",()=>{
  const {report}=entryPlanFixture(),last=report.entryStudy!.candles.at(-1)!;
  assert.equal(report.tradePlan!.signalExpiresAt,candleCloseTime(candleCloseTime(last.ts,"1H")!,"1H"));
});

test("saved entry evidence rejects developing, future and mismatched signal candles",()=>{
  const {report}=entryPlanFixture();
  for(const alter of [
    (r:typeof report)=>{r.entryStudy!.candles.at(-1)!.confirmed=false;},
    (r:typeof report)=>{r.entryStudy!.candles.at(-1)!.ts=Date.parse(r.snapshot.observedAt);},
    (r:typeof report)=>{r.tradePlan!.retestTs=r.entryStudy!.candles.at(-1)!.ts+1;},
    (r:typeof report)=>{r.entryStudy!.source="different-venue";},
  ]){const changed=structuredClone(report);alter(changed);assert.equal(GlobalReportSchema.safeParse(changed).success,false);}
});
