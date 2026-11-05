import test from "node:test";
import assert from "node:assert/strict";
import type {GlobalReport,GlobalScenarioDefinition} from "@pulse/schemas";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalDecision} from "./globalDecision.js";
import {globalEligibility} from "./globalPolicy.js";
import {terminalFrameProfile} from "./terminal.js";

const born=Date.UTC(2026,10,4,5,23),hour=3600000;
function fixture(frame:string,mode:"passive_limit"|"confirmed_retest",state:NonNullable<GlobalReport["scenario"]>["state"]="awaiting_location"){
  const report=globalDesignFixture("pro"),profile=terminalFrameProfile(frame),expiry=born+48*hour;
  report.decisionVersion="decision-v5";report.snapshot.timeframe=profile.timeframe;report.snapshot.observedAt=new Date(born).toISOString();report.context.agreement="neutral";
  const policy={version:"execution-policy-v1" as const,id:mode==="passive_limit"?"ema-ribbon-passive-v1" as const:"observed-reclaim-retest-v1" as const,configurationKey:`BTC:${frame}:test`,mode,family:"ema_pullback" as const,sourceBoundary:100,eventTimeframe:profile.execution,eventKnownAt:born-hour,eventAfter:born-hour,expiresAt:expiry,confirmationBars:1 as const,fillWindowBars:2,stopManagement:"structural_fixed" as const,targetAllocations:[1],entryRegion:mode==="passive_limit"?"source_zone" as const:"defended_retest" as const};
  report.discretionaryPlan={version:"discretionary-plan-v8",executionPolicy:policy,side:"long",family:"ema_pullback",objectiveTimeframe:profile.timeframe,entry:101,stop:90,entryBasis:{kind:"ema_ribbon",timeframe:profile.timeframe,knownAt:born-hour,price:101},reference:{timeframe:profile.execution,candleTs:born-2*hour,completedAt:born-hour,price:103},stopBasis:{timeframe:profile.timeframe,anchorTs:born-3*hour,knownAt:born-hour,price:91},targets:[{price:120,timeframe:profile.timeframe,anchorTs:born-3*hour,knownAt:born-hour,basis:"confirmed_swing"}],barriers:[],priceZones:{version:"price-zones-v1",entry:{lower:100,upper:101,sourceLower:100,sourceUpper:101,sourcePrice:101},stop:{lower:90,upper:91},targets:[{lower:120,upper:122}],payoffFloor:1,payoffLimited:false}};
  const definition:GlobalScenarioDefinition={version:"scenario-definition-v1",scenarioId:"scenario-1",revisionId:"revision-1",market:"okx-public-spot:BTC-USDT",timeframe:profile.timeframe,family:"ema_pullback",side:"long",policyId:policy.id,configurationKey:policy.configurationKey,sourceKey:"source-1",sourceKnownAt:born-hour,sourceTimeframe:profile.timeframe,sourceLower:100,sourceUpper:101,sourcePrice:101,createdAt:born,stopBasis:report.discretionaryPlan.stopBasis,mode,entryZone:[100,101],hardStop:90,targets:[{id:"tp1",lower:120,upper:122,allocation:1}],sourceBoundary:100,eventTimeframe:profile.execution,eventAfter:born-hour,eventKnownAt:born-hour,expiresAt:expiry,confirmationMaxAgeMs:hour,fillWindowMs:2*hour,confirmationBars:1};
  report.scenario={version:"scenario-lifecycle-v1",scenarioId:definition.scenarioId,revisionId:definition.revisionId,state,startedAt:born,updatedAt:born,expiresAt:expiry,observationOnly:true,definition,events:[],exits:[],remainingFraction:1,...(state==="confirmed_awaiting_fill"?{confirmationAt:born-hour}:{})};
  report.tradePlan={side:"long",pathId:"legacy",state:"conditional",condition:"close_retest",triggerLevelId:"reclaim",invalidationLevelId:"floor",targetIds:["target1"],referenceEntry:[100,101],referenceStop:90,grossRewardRisk:2,stopBufferAtr:.2,confirmationTs:null,retestTs:null,blockers:["confirmation"],method:"structure-v5",signalExpiresAt:born+60000};
  return report;
}

for(const frame of ["15m","1H","4H","1Dutc","1Wutc"])test(`${frame}: canonical passive deadline never borrows a legacy clock or adds candle confirmation`,()=>{
  const report=fixture(frame,"passive_limit"),before=structuredClone(report),decision=globalDecision(report);
  assert.equal(decision.expiresAt,report.scenario!.expiresAt);assert.equal(decision.entryDeadline,report.scenario!.expiresAt);assert.equal(decision.retestDeadline,null);assert.equal(decision.entryPolicyStatus,"awaiting_location");
  assert.equal(globalEligibility(report),"waiting_retest");assert.equal(decision.currentAction,"WAIT");assert.equal(decision.qualified,false);assert.match(decision.relationship,/passive-limit policy/);assert.deepEqual(report,before);
});
test("confirmed retest has a distinct fill deadline and cannot outlive it or revive an ended opportunity",()=>{
  const report=fixture("1Dutc","confirmed_retest","confirmed_awaiting_fill"),decision=globalDecision(report),entryDeadline=born+hour;
  assert.equal(decision.entryDeadline,entryDeadline);assert.equal(decision.retestDeadline,entryDeadline);assert.equal(decision.expiresAt,born+48*hour);assert.equal(globalEligibility(report),"waiting_retest");assert.equal(decision.qualified,false);
  report.snapshot.observedAt=new Date(entryDeadline+1).toISOString();assert.equal(globalEligibility(report),"expired");
  report.scenario!.state="entry_observed";assert.equal(globalEligibility(report),"no_trade");report.scenario!.state="completed";assert.equal(globalDecision(report).currentAction,"WAIT");report.scenario!.state="invalidated";assert.equal(globalEligibility(report),"invalidated");
});
test("legacy report without canonical scenario/policy retains original eligibility and clock projection",()=>{
  const report=fixture("1H","passive_limit");delete report.scenario;delete report.discretionaryPlan;assert.equal(globalEligibility(report),"waiting_confirmation");assert.equal(globalDecision(report).expiresAt,born+60000);assert.equal(globalDecision(report).entryDeadline,null);
});
