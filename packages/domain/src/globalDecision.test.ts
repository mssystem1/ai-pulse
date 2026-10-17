import test from "node:test";
import assert from "node:assert/strict";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {deriveGlobalTradePlan} from "./globalTradePlan.js";
import {globalDecision,globalDecisionTitle} from "./globalDecision.js";
import {globalContextRelation,globalSession} from "./globalContext.js";
import {globalReportChartSvg} from "./globalChart.js";
import {presentResearch,researchText} from "./researchPresentation.js";

function qualified(side:"long"|"short") {
  const r=globalDesignFixture();r.evaluationVersion="completed-v2";
  r.paths.forEach(p=>p.role=p.id===(side==="long"?"recovery":"correction")?"main":"alternative");
  r.levels.find(l=>l.id==="floor")!.price=116;
  const pivot={id:"entry-test",ts:r.candles.at(-12)!.ts,confirmedAt:r.candles.at(-11)!.ts,price:117.3,kind:"high" as const};
  r.indicators.pivots.push(pivot);r.levels.find(l=>l.id==="reclaim")!.anchorIds=[pivot.id];
  const tail=r.candles.slice(-8).map(c=>({...c,open:side==="long"?117.2:117.4,high:side==="long"?117.25:117.45,low:side==="long"?117.1:117.35,close:side==="long"?117.2:117.4}));
  for(let i=5;i<8;i++)tail[i]={...tail[i],open:117.3,high:117.31,low:117.29,close:side==="long"?117.31:117.29};
  r.candles=[...r.candles.slice(0,-8),...tail];r.snapshot.price=tail[7].close;r.snapshot.observedAt=new Date(tail[7].ts+3600000).toISOString();r.tradePlan=deriveGlobalTradePlan(r);return r;
}
for(const side of ["long","short"] as const)test(`${side}: confirmed evidence has one action and chart protection, without rewriting the report`,()=>{
  const r=qualified(side),before=structuredClone(r),d=globalDecision(r);
  assert.equal(r.tradePlan!.state,"confirmed");assert.equal(d.currentAction,side==="long"?"BUY":"SELL");assert.equal(d.qualified,true);
  const svg=globalReportChartSvg(r)!;assert.match(svg,/data-stage="ENTRY"/);assert.match(svg,/data-risk-band="planned"/);assert.deepEqual(r,before);
});
test("a rejected buy stays a scenario with its reward reason and no entry risk box",()=>{
  const r=qualified("long");r.levels.find(l=>l.id==="target1")!.price=117.32;r.tradePlan=deriveGlobalTradePlan(r);const before=structuredClone(r);
  assert.ok(r.tradePlan.grossRewardRisk!<1.5);assert.equal(globalDecision(r).currentAction,"WAIT");assert.match(globalDecisionTitle(r),/LONG SCENARIO.*Entry needs better reward/);
  const svg=globalReportChartSvg(r)!;assert.ok(!/data-stage=|data-risk-band=|data-planned-entry-route=/.test(svg));assert.ok(/SUPPORT \/ RESISTANCE/.test(svg));
  const txt=researchText(presentResearch(r));assert.match(txt,/LONG SCENARIO/);assert.doesNotMatch(txt,/WAIT|Conditional long \/ Spot buy|NO TRADE ·|INVALIDATED ·|EXPIRED ·/);assert.deepEqual(r,before);
});
test("ending an old entry attempt preserves its market route and puts the event in history",()=>{
  const r=qualified("short");r.candles.at(-1)!.high=117.6;r.candles.at(-1)!.close=117.5;r.snapshot.price=117.5;delete r.tradePlan;
  const d=globalDecision(r);assert.equal(d.currentAction,"WAIT");assert.match(d.reason,/Sell after a 1H rejection/);assert.ok(d.previousAttempts.some(s=>s.includes("Earlier sell test")));
  assert.match(d.route,/downside references/);assert.doesNotMatch(globalDecisionTitle(r),/INVALIDATED|EXPIRED/);
});
test("higher context is relative to the side, and unavailable or opposing context cannot produce BUY",()=>{
  const r=qualified("long");r.tier="pro";r.context={...r.context,status:"available",agreement:"conflicts"};
  assert.equal(globalContextRelation(r,"short"),"aligned");assert.equal(globalContextRelation(r,"long"),"opposing");assert.equal(globalDecision(r).currentAction,"WAIT");
  r.context.status="unavailable";assert.equal(globalDecision(r).qualified,false);assert.match(globalDecision(r).checklist.join(" "),/context unavailable/);
  assert.equal(globalSession("1D"),"UTC+8");assert.equal(globalSession("1Dutc"),"UTC");
});
