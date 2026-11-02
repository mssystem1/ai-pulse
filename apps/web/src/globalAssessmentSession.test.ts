import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {globalDesignFixture} from "../../../packages/domain/dist/globalReport.fixtures.js";
import type {GlobalAssessment} from "@pulse/domain";
import {GlobalSetupAssessment} from "./GlobalSetupAssessment";
import {scopedGlobalAssessmentAccess,type GlobalReportAccess} from "./globalSetupClient";
import {createGlobalAssessmentRequestGuard,globalAssessmentSessionKey} from "./globalAssessmentSession";

const access:GlobalReportAccess={kind:"history",id:"saved-report",token:"private-history-session"};
const resolver=async()=>({assessment:{} as GlobalAssessment});

test("clock-driven reparsing retains the assessment session for an equivalent report and capability",()=>{
  const report=globalDesignFixture(),expected=globalAssessmentSessionKey(report,access);
  for(let clockTick=0;clockTick<5;clockTick++){
    assert.equal(globalAssessmentSessionKey(JSON.parse(JSON.stringify(report)),{...access}),expected);
  }
});

test("another report and a strategy review of the same historical source get independent assessments",()=>{
  const report=globalDesignFixture(),original=globalAssessmentSessionKey(report,access);
  const another=structuredClone(report);another.snapshot.observedAt="2026-11-02T03:00:00.000Z";
  assert.notEqual(globalAssessmentSessionKey(another,access),original);
  const review=structuredClone(report);review.setup.protectiveStop=report.setup.protectiveStop===null?99:report.setup.protectiveStop-1;
  assert.equal(review.snapshot.observedAt,report.snapshot.observedAt);
  assert.notEqual(globalAssessmentSessionKey(review,access),original,"changing saved protection cannot reuse a check of the original plan");
  assert.equal(globalAssessmentSessionKey(structuredClone(review),{...access}),globalAssessmentSessionKey(review,access));
});

test("changing or removing a capability clears the assessment even when the report is identical",()=>{
  const report=globalDesignFixture(),original=globalAssessmentSessionKey(report,access);
  for(const next of [{...access,token:"another-owner-session"},{...access,id:"another-report"},{kind:"job",id:access.id,token:access.token},{kind:"share",token:access.token},undefined] as const){
    assert.notEqual(globalAssessmentSessionKey(report,next),original);
  }
});

test("Telegram callbacks may be recreated while their explicit order/session identity stays the same",()=>{
  const report=globalDesignFixture(),first=scopedGlobalAssessmentAccess(["telegram","order-a","private-init-session"],resolver);
  const rerender=scopedGlobalAssessmentAccess(["telegram","order-a","private-init-session"],async()=>resolver());
  assert.notEqual(first,rerender);
  assert.equal(globalAssessmentSessionKey(report,first),globalAssessmentSessionKey(structuredClone(report),rerender));
  for(const scope of [["telegram","order-b","private-init-session"],["telegram","order-a","another-user-session"]]){
    assert.notEqual(globalAssessmentSessionKey(report,first),globalAssessmentSessionKey(report,scopedGlobalAssessmentAccess(scope,resolver)));
  }
});

test("unscoped resolvers are conservative rather than silently sharing another session's result",()=>{
  const report=globalDesignFixture(),one=async()=>resolver(),two=async()=>resolver();
  assert.equal(globalAssessmentSessionKey(report,one),globalAssessmentSessionKey(structuredClone(report),one));
  assert.notEqual(globalAssessmentSessionKey(report,one),globalAssessmentSessionKey(report,two));
});

test("private capability and resolver scopes never appear in the rendered assessment panel",()=>{
  const report=globalDesignFixture();
  for(const capability of [access,scopedGlobalAssessmentAccess(["telegram","private-order","private-init-session"],resolver)]){
    const html=renderToStaticMarkup(createElement(GlobalSetupAssessment,{report,access:capability}));
    assert.match(html,/Recheck setup/);
    for(const secret of ["private-history-session","private-order","private-init-session","assessmentScope"])assert.ok(!html.includes(secret));
  }
});

test("two clicks before the disabled button commits start only one recheck",()=>{
  const guard=createGlobalAssessmentRequestGuard(),request=guard.begin();
  assert.notEqual(request,null);assert.equal(guard.begin(),null);
  assert.equal(guard.finish(request!),true);
  const next=guard.begin();assert.notEqual(next,null);assert.notEqual(next,request);
});

test("a result arriving after report/access unmount cannot publish or finish a new session's request",async()=>{
  const guard=createGlobalAssessmentRequestGuard(),request=guard.begin()!;
  let deliver!:(value:string)=>void;const pending=new Promise<string>(resolve=>{deliver=resolve;});
  const shown:string[]=[];
  const completion=pending.then(value=>{if(guard.current(request))shown.push(value);return guard.finish(request);});
  guard.dispose();guard.mount();const current=guard.begin()!;
  deliver("old owner's assessment");
  assert.equal(await completion,false);assert.deepEqual(shown,[]);
  assert.equal(guard.current(current),true,"old finally must not unlock the new request");
  assert.equal(guard.begin(),null);assert.equal(guard.finish(current),true);
});

test("late failures and capability resolutions are ineligible after unmount",async()=>{
  const guard=createGlobalAssessmentRequestGuard(),request=guard.begin()!;
  let reject!:(error:Error)=>void;const pending=new Promise<void>((_,fail)=>{reject=fail;});
  const errors:string[]=[];const completion=pending.catch(error=>{if(guard.current(request))errors.push(error.message);});
  guard.dispose();reject(new Error("private previous-session error"));await completion;
  assert.deepEqual(errors,[]);assert.equal(guard.current(request),false);assert.equal(guard.begin(),null);
});
