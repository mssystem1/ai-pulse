import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {GlobalReportSchema,candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalRiskMeasurement,globalSetupAdmission,globalTradeCards,globalEntryStudySvg,globalReportChartSvg} from "@pulse/domain";
import {applyGlobalDiscretionaryPlan} from "./globalDiscretionaryPlan.js";
import {globalEntryReactions} from "./globalEntryReaction.js";
import {selectGlobalSetupContext} from "./globalSetupContext.js";
import {globalScenarioDefinitionForReport} from "./globalScenarioLifecycle.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";

// Exact public-market reports captured before this strategy revision. Source
// filenames and full-file SHA256 values travel with each compressed fixture.
const fixtures=JSON.parse(gunzipSync(readFileSync(new URL("./globalEntryReaction.fixture.json.gz",import.meta.url))).toString()) as Array<{name:string;frame:string;sha256:string;report:GlobalReport}>;
function revised(name:string,frame:string){const r=structuredClone(fixtures.find(c=>c.name===name&&c.frame===frame)!.report);applyGlobalDiscretionaryPlan(r);return r;}

test("disputed daily and weekly snapshots use their own completed execution source before payoff is measured",()=>{
  for(const frame of ["1Dutc","1Wutc"]){
    const original=fixtures.find(c=>c.name==="nov17"&&c.frame===frame)!.report,before=structuredClone(original),r=revised("nov17",frame),p=r.discretionaryPlan!,a=r.alternatePlan!;
    assert.equal(r.setupPolicyVersion,"source-limits-v5");assert.equal(p.side,"short");
    assert.equal(p.entry,frame==="1Dutc"?65057.4:65000);
    assert.equal(p.entry,globalEntryReactions(r).find(c=>c.side===p.side)!.entry,"No older, farther source may replace the latest one to clear a reward floor");
    assert.equal(p.stopBasis.timeframe,frame==="1Dutc"?"4H":"1Dutc");
    assert.equal(globalRiskMeasurement(r)!.timeframe,p.stopBasis.timeframe);
    assert.equal(p.objectiveTimeframe,frame);assert.ok(p.targets.every((t,i)=>t.timeframe===frame||i===0&&t.timeframe===p.stopBasis.timeframe));
    assert.equal(p.targets.length,3);assert.notEqual(a.side,p.side);
    const main=globalReportChartSvg(r)!,detail=globalEntryStudySvg(r)!;
    for(const [i,target] of globalTradeCards(r)[0].targets.entries()){
      const role=`TP${i+1}`;assert.ok(main.includes(`data-trade-role="${role}" data-price="${target.price}"`));
      const outside=detail.match(/data-entry-offscale-levels="([^"]*)"/)?.[1].split(",")??[];
      assert.ok(detail.includes(`data-entry-price-role="${role}" data-price="${target.price}"`)||outside.includes(role),`${role} is drawn at its source price or explicitly retained off-scale`);
    }
    assert.equal(a.executionPolicy!.mode,"passive_limit");assert.equal(p.executionPolicy!.mode,"passive_limit");
    assert.equal(p.executionPolicy!.eventKnownAt,p.entryReaction!.knownAt);assert.equal(p.executionPolicy!.eventAfter,p.entryReaction!.knownAt);
    assert.equal(p.requiresNewTestAfter,undefined);assert.equal(globalTradeCards(r).length,2);
    const admission=globalSetupAdmission(r);
    assert.equal(p.priceZones!.payoffPolicy,"staged-weighted-v1");assert.equal(p.priceZones!.payoffLimited,true,"The nearby sub-1R obstacle stays visible");
    assert.ok(admission.firstObstacleRewardRisk!<1);assert.ok(admission.plannedWeightedRewardRisk!>=1);
    assert.equal(admission.geometryEligible,true,"The approved staged policy uses declared partial exits and at least 1R planned allocated payoff");
    assert.equal(GlobalReportSchema.safeParse(r).success,true);
    assert.deepEqual(original,before);assert.deepEqual(r.candles,original.candles);assert.deepEqual(r.entryStudy,original.entryStudy);
  }
});

test("the later capture uses fresh 4H evidence while repeated weekly evidence keeps the exact stop and deadline",()=>{
  const old=revised("nov17","1Wutc"),next=revised("nov18","1Wutc"),daily=revised("nov18","1Dutc");
  assert.equal(daily.discretionaryPlan!.entry,64883.3);assert.equal(daily.discretionaryPlan!.stopBasis.timeframe,"4H");
  assert.deepEqual(next.discretionaryPlan!.entryReaction,old.discretionaryPlan!.entryReaction);
  assert.equal(next.discretionaryPlan!.stop,old.discretionaryPlan!.stop);
  assert.equal(next.discretionaryPlan!.executionPolicy!.expiresAt,old.discretionaryPlan!.executionPolicy!.expiresAt);
  for(const r of [old,next,daily]){
    const p=r.discretionaryPlan!,source=r.entryStudy!.candles.find(c=>c.ts===p.entryReaction!.anchorTs)!;
    const atr=r.entryStudy!.atr.find(a=>a.ts===source.ts)!;
    assert.equal(p.entryReaction!.atrValue,atr.value);assert.equal(p.entryReaction!.atrKnownAt,candleCloseTime(source.ts,r.entryStudy!.timeframe));
    assert.equal(GlobalReportSchema.safeParse(r).success,true);
  }
});

test("the earlier weekly recovery cannot force a long after the completed daily support break",()=>{
  const r=revised("nov6","1Wutc"),p=r.discretionaryPlan!;
  assert.equal(r.setupSelection!.assessment,"long","Keep the slower weekly assessment as explicit context");
  assert.equal(p.side,"short");assert.equal(p.entryReaction!.kind,"completed_break");assert.equal(p.entry,76265.2);
  assert.equal(p.stopBasis.timeframe,"1Dutc");assert.equal(p.stop,77493.730186);
  assert.equal(p.targets[0].timeframe,"1Dutc");assert.ok(p.targets.slice(1).every(t=>t.timeframe==="1Wutc"));
  assert.equal(r.alternatePlan!.side,"long");assert.equal(GlobalReportSchema.safeParse(r).success,true);
  assert.equal(globalSetupAdmission(r).allowed,false,"A poor weighted payoff or overlapping primary support remains an explicit risk failure; no guaranteed trade is invented");
});

test("a newer hourly bounce cannot override the declared daily plan's 4H source",()=>{
  const archived=fixtures.find(c=>c.name==="nov19")!.report,before=structuredClone(archived);
  assert.equal(archived.discretionaryPlan!.side,"long");assert.equal(archived.discretionaryPlan!.evidence!.timeframe,"1H");
  assert.equal(archived.entryStudy!.timeframe,"4H");assert.equal(GlobalReportSchema.safeParse(archived).success,true,"The earlier deployed artifact remains readable");
  const current=revised("nov19","1Dutc"),p=current.discretionaryPlan!;
  assert.equal(current.setupPolicyVersion,"source-limits-v5");assert.equal(p.side,"short");assert.equal(p.entry,63123.6);
  assert.equal(p.entryReaction!.timeframe,"4H");assert.equal(p.executionPolicy!.eventTimeframe,"4H");assert.equal(p.stopBasis.timeframe,"4H");
  assert.equal(globalSetupAdmission(current).allowed,true);assert.equal(GlobalReportSchema.safeParse(current).success,true);
  const reviewed=reviewGlobalTargetReport(archived);assert.notEqual(reviewed,archived);assert.equal(reviewed.discretionaryPlan!.side,"short");
  assert.deepEqual(archived,before);assert.deepEqual(reviewed.snapshot,archived.snapshot);
  const forged=structuredClone(archived);forged.setupPolicyVersion="source-limits-v5";
  assert.equal(GlobalReportSchema.safeParse(forged).success,false,"A new policy cannot label hourly evidence as a 4H execution event");
});

test("execution timing overrides retain strict daily source selection unless legacy research is explicit",()=>{
  const archived=fixtures.find(c=>c.name==="nov19"&&c.frame==="1Dutc")!.report,before=structuredClone(archived);
  const strict=structuredClone(archived);applyGlobalDiscretionaryPlan(strict,{fillWindowBars:4});
  assert.equal(strict.setupPolicyVersion,"source-limits-v5");
  assert.equal(strict.discretionaryPlan!.side,"short");assert.equal(strict.discretionaryPlan!.entry,63123.6);
  for(const p of [strict.discretionaryPlan,strict.alternatePlan])if(p){
    assert.equal(p.reference.timeframe,"4H");assert.equal(p.executionPolicy!.eventTimeframe,"4H");
    if(p.evidence)assert.equal(p.evidence.timeframe,"4H");
  }
  assert.equal(GlobalReportSchema.safeParse(strict).success,true);
  const legacy=structuredClone(archived);applyGlobalDiscretionaryPlan(legacy,{fillWindowBars:4,sourceSelection:"legacy-v4"});
  assert.equal(legacy.setupPolicyVersion,"source-limits-v4");assert.equal(legacy.discretionaryPlan!.side,"long");
  assert.equal(legacy.discretionaryPlan!.evidence!.timeframe,"1H");
  assert.equal(GlobalReportSchema.safeParse(legacy).success,true);
  assert.deepEqual(archived,before);
});

test("strict setup context ignores newer hourly closes outside its declared 4H source",()=>{
  const archived=fixtures.find(c=>c.name==="nov19"&&c.frame==="1Dutc")!.report,before=structuredClone(archived);
  const study=archived.entryStudy!,last=study.candles.at(-1)!;
  const input={bars:study.candles,timeframe:study.timeframe,completedAt:candleCloseTime(last.ts,study.timeframe)!,primaryClosed:candleCloseTime(archived.candles.at(-1)!.ts,archived.snapshot.timeframe)!,primaryAtr:archived.indicators.atr.points.at(-1)!.value,cutoff:Date.parse(archived.snapshot.observedAt),strictExecutionFrame:true};
  const baseline=structuredClone(archived);baseline.currentMarket!.frames=[];
  const expected=selectGlobalSetupContext(baseline,input);
  for(const close of [1,1_000_000_000]){
    const changed=structuredClone(archived),hourly=changed.currentMarket!.frames.find(f=>f.timeframe==="1H")!,bar=hourly.candles.at(-1)!;
    assert.ok(candleCloseTime(bar.ts,"1H")!>input.completedAt,"The hourly observation is newer than the declared source");
    assert.ok(candleCloseTime(bar.ts,"1H")!<=input.cutoff,"The competing hourly close was available at publication");
    bar.close=close;bar.low=Math.min(bar.low,close);bar.high=Math.max(bar.high,close);
    changed.currentMarket!.frames=[hourly];
    assert.deepEqual(selectGlobalSetupContext(changed,input),expected,"An unrelated hourly close cannot change strict source context");
  }
  assert.deepEqual(archived,before);
});

test("a free review upgrades original reports once without rewriting their source or snapshot",()=>{
  for(const {report:original} of fixtures){
    const before=structuredClone(original),r=reviewGlobalTargetReport(original);
    assert.notEqual(r,original);assert.equal(r.setupPolicyVersion,"source-limits-v5");assert.ok(r.targetReviewOf);
    assert.deepEqual(original,before);assert.deepEqual(r.snapshot,original.snapshot);assert.deepEqual(r.candles,original.candles);
    assert.equal(reviewGlobalTargetReport(r),r);assert.equal(GlobalReportSchema.safeParse(r).success,true);
  }
});

test("a reaction cannot borrow arbitrary tight protection, a later ATR, a new expiry or forged alternate sources",()=>{
  const original=revised("nov17","1Wutc");
  const mutations:Array<(r:GlobalReport)=>void>=[
    r=>{r.discretionaryPlan!.stop+=1;},
    r=>{r.discretionaryPlan!.entryReaction!.atrValue+=1;},
    r=>{r.discretionaryPlan!.entryReaction!.atrTs+=86400000;},
    r=>{r.discretionaryPlan!.executionPolicy!.expiresAt+=86400000;},
    r=>{r.discretionaryPlan!.entryReaction!.expiresAt+=86400000;r.discretionaryPlan!.executionPolicy!.expiresAt+=86400000;},
    r=>{r.discretionaryPlan!.entryBasis.kind="completed_close";},
    r=>{r.discretionaryPlan!.entryReaction!.kind="completed_sweep";},
    r=>{r.discretionaryPlan!.stopBasis.timeframe="1Wutc";},
    r=>{r.alternatePlan!.side=r.discretionaryPlan!.side;},
    r=>{r.alternatePlan!.entryReaction!.previousTs-=86400000;},
    r=>{r.alternatePlan!.targets.splice(1,1);r.alternatePlan!.priceZones!.targets.splice(1,1);r.alternatePlan!.executionPolicy!.targetAllocations=[.5,.5];},
  ];
  for(const mutate of mutations){const r=structuredClone(original);mutate(r);assert.equal(GlobalReportSchema.safeParse(r).success,false);}
});

test("staged admission does not waive a poor allocated payoff, an unmodelled first obstacle or a breached stop",()=>{
  const r=revised("nov17","1Dutc"),p=r.discretionaryPlan!;
  assert.equal(globalSetupAdmission(r).allowed,true);
  const lowPayoff=structuredClone(r);lowPayoff.discretionaryPlan!.executionPolicy!.targetAllocations=[.98,.01,.01];
  assert.equal(GlobalReportSchema.safeParse(lowPayoff).success,false,"The registered staged policy cannot rewrite its exit weights");
  assert.ok(globalSetupAdmission(lowPayoff).blockers.includes("reward"));
  const inflated=structuredClone(r);inflated.discretionaryPlan!.executionPolicy!.targetAllocations=[.1,.1,.8];
  assert.equal(GlobalReportSchema.safeParse(inflated).success,false);assert.ok(globalSetupAdmission(inflated).blockers.includes("reward"),"Moving weight to a distant target cannot bypass the registered allocation policy");
  const hidden=structuredClone(r);hidden.discretionaryPlan!.barriers.unshift({price:(p.entry+p.targets[0].price)/2,timeframe:p.stopBasis.timeframe,anchorTs:p.stopBasis.anchorTs,knownAt:p.stopBasis.knownAt});
  assert.equal(globalSetupAdmission(hidden).firstObstacleHasExit,false);assert.ok(globalSetupAdmission(hidden).blockers.includes("reward"));
  const stopped=structuredClone(r);stopped.currentMarket!.quote={price:p.stop+1,ts:Date.parse(r.snapshot.observedAt)};
  assert.ok(globalSetupAdmission(stopped).blockers.includes("stop_already_breached"));
  stopped.currentMarket!.quote!.ts+=1;
  assert.ok(!globalSetupAdmission(stopped).blockers.includes("stop_already_breached"),"A quote after publication cannot invalidate the causal snapshot");
  const forged=structuredClone(fixtures[0].report);forged.discretionaryPlan!.priceZones!.payoffPolicy="staged-weighted-v1";
  assert.equal(GlobalReportSchema.safeParse(forged).success,false,"Earlier unrelated plans cannot silently acquire a relaxed risk policy");
});

test("new reaction definitions bind fixed entry, SL, three distinct targets and the original event lifetime",()=>{
  for(const {name,frame} of fixtures){
    const r=revised(name,frame),p=r.discretionaryPlan!,def=globalScenarioDefinitionForReport(r)!;
    assert.equal(def.policyId,"entry-reaction-passive-v1");assert.equal(def.eventTimeframe,p.stopBasis.timeframe);
    assert.equal(def.hardStop,p.stop);assert.deepEqual(def.entryZone,[p.entry,p.entry]);
    assert.equal(def.expiresAt,p.entryReaction!.expiresAt);assert.ok(def.createdAt>=p.entryReaction!.knownAt);
    assert.equal(def.targets.length,p.targets.length);assert.equal(def.targets.reduce((sum,t)=>sum+t.allocation,0),1);
    assert.ok(def.targets.every((t,i)=>!i||t.upper<def.targets[i-1].lower));
  }
});
