import test from "node:test";
import assert from "node:assert/strict";
import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {deriveGlobalExecutionPolicy} from "./globalExecutionPolicy.js";
import {applyGlobalPriceZones} from "./globalPriceZones.js";

type Plan=NonNullable<GlobalReport["discretionaryPlan"]>;
const observedAt="2026-10-30T17:35:00.000Z",cutoff=Date.parse(observedAt);
const candle=(ts:number,close:number)=>({ts,open:close,high:close+100,low:close-100,close,volume:1,confirmed:true});
function example(input:{tf:string;side:Plan["side"];family:Plan["family"];source:[number,number];stop:number;stopBasis:number;target:number;current:number;kind?:Plan["entryBasis"]["kind"]}){
  const primaryTs=Date.UTC(2026,9,19),last=candle(primaryTs,input.current),knownAt=candleCloseTime(primaryTs,input.tf)!;
  const referenceTs=Date.UTC(2026,9,29),referenceFrame=input.tf==="1Wutc"?"1Dutc":"4H",referenceCandle=candle(referenceTs,input.current);
  const price=input.side==="long"?input.source[1]:input.source[0],role=input.side==="long"?"support":"resistance";
  const report={snapshot:{observedAt,instId:"BTC-USDT",timeframe:input.tf,pricePrecision:2,source:"synthetic"},candles:[last],
    indicators:{pivots:[],ema:[{period:12,points:[{ts:primaryTs,value:input.source[0]}]},{period:25,points:[{ts:primaryTs,value:input.source[1]}]}],atr:{points:[{ts:primaryTs,value:100}]}},
    entryStudy:{status:"available",timeframe:referenceFrame,candles:[referenceCandle],pivots:[]},
    currentMarket:{source:"synthetic",quote:{price:input.current,ts:cutoff},frames:[]},
    horizonContext:{timeframe:input.tf,zones:[{id:"source",role,lower:input.source[0],upper:input.source[1],startTs:primaryTs,knownAt,anchorIds:["synthetic-source"],basis:"confirmed_pivot_wicks"}],ranges:[]},
    discretionaryPlan:{version:"discretionary-plan-v5",side:input.side,family:input.family,objectiveTimeframe:input.tf,requiresNewTestAfter:cutoff,
      entry:price,stop:input.stop,entryBasis:{kind:input.kind??"structure_zone",price,timeframe:input.tf,knownAt},
      reference:{timeframe:referenceFrame,candleTs:referenceTs,completedAt:candleCloseTime(referenceTs,referenceFrame)!,price:input.current},
      stopBasis:{price:input.stopBasis,timeframe:input.tf,anchorTs:primaryTs,knownAt},
      targets:[{price:input.target,timeframe:input.tf,anchorTs:primaryTs,knownAt,basis:"measured_projection"}],barriers:[]},
  } as unknown as GlobalReport;
  return report;
}

for(const [name,input] of [
  ["27 October daily long",{tf:"1Dutc",side:"long",family:"level_retest",source:[78649.3,80018.2],stop:78243.7472469,stopBasis:78649.3,target:83763.7,current:80675.2}],
  ["28 October weekly long",{tf:"1Wutc",side:"long",family:"ema_pullback",source:[76430.1744788,78735.79038],stop:73733.5761366,stopBasis:74955.5,target:84479,current:80483,kind:"ema_ribbon"}],
  ["30 October daily short",{tf:"1Dutc",side:"short",family:"level_retest",source:[78649.3,81682.6],stop:82105.94,stopBasis:81682.6,target:76011.8,current:77153.7}],
  ["30 October weekly long",{tf:"1Wutc",side:"long",family:"level_retest",source:[74501.6,78427.1],stop:73279.68,stopBasis:74501.6,target:84479,current:77194}],
] as const)test(`${name}: source entry cannot borrow later confirmation or move to satisfy R`,()=>{
  const report=example({...input,source:[...input.source]}),original=structuredClone(report.discretionaryPlan!);
  applyGlobalPriceZones(report);const plan=report.discretionaryPlan!,zones=plan.priceZones!,policy=plan.executionPolicy!;
  assert.equal(plan.version,"discretionary-plan-v8");assert.deepEqual([zones.entry.lower,zones.entry.upper],input.source);
  assert.equal(plan.stop,original.stop);assert.deepEqual(plan.stopBasis,original.stopBasis);assert.deepEqual(plan.targets,original.targets);
  assert.equal(policy.mode,"passive_limit");assert.equal(policy.entryRegion,"source_zone");assert.equal(plan.requiresNewTestAfter,undefined);
  assert.equal(policy.sourceBoundary,original.entryBasis.price);assert.ok(policy.eventAfter<cutoff);assert.ok(policy.expiresAt>cutoff);
});

test("a poor payoff is disclosed without rewriting source, family, stop or route",()=>{
  const report=example({tf:"1Dutc",side:"long",family:"level_retest",source:[98,100],stop:90,stopBasis:98,target:104,current:101});
  const source=report.horizonContext!.zones[0];report.horizonContext!.zones.push({...source,id:"distant",lower:91,upper:92});
  report.horizonContext!.zones.push({...source,id:"nearer-opposition",role:"resistance",lower:102,upper:103});
  const original=structuredClone(report.discretionaryPlan!);applyGlobalPriceZones(report);const plan=report.discretionaryPlan!;
  assert.deepEqual([plan.priceZones!.entry.lower,plan.priceZones!.entry.upper],[98,100]);assert.equal(plan.family,original.family);
  assert.equal(plan.stop,90);assert.deepEqual(plan.stopBasis,original.stopBasis);assert.equal(plan.priceZones!.payoffLimited,true);
  assert.deepEqual(plan.barriers.map(b=>b.price),[102,103]);assert.equal(plan.targets[0].price,104);
});

test("pending accepted breakout entry is the boundary actually defended, for both directions",()=>{
  for(const side of ["long","short"] as const){
    const report=example({tf:"1H",side,family:"breakout_retest",source:[98,100],stop:side==="long"?90:110,stopBasis:side==="long"?98:100,target:side==="long"?120:80,current:side==="long"?103:97});
    const plan=report.discretionaryPlan!,result=deriveGlobalExecutionPolicy(report,plan,{lower:98,upper:100});
    assert.equal(result.policy.id,"accepted-breakout-retest-v1");assert.equal(result.policy.mode,"confirmed_retest");
    assert.equal(result.policy.confirmationBars,2);assert.deepEqual(result.entry,{lower:plan.entryBasis.price,upper:plan.entryBasis.price});
  }
});

test("observed reclaim retains its causal event and the actual defended entry region",()=>{
  const report=example({tf:"1H",side:"long",family:"breakout_retest",source:[98,100],stop:90,stopBasis:98,target:120,current:103});
  const plan=report.discretionaryPlan!,testTs=Date.UTC(2026,9,30,16);plan.entryBasis.kind="reclaimed_level";plan.entryBasis.price=100;
  plan.reference.timeframe="15m";plan.reference.completedAt=candleCloseTime(plan.reference.candleTs,"15m")!;
  plan.evidence={kind:"local_reclaim",timeframe:"15m",level:100,testTs,completedAt:testTs+900_000,extreme:99};
  const {policy,entry}=deriveGlobalExecutionPolicy(report,plan,{lower:100,upper:102});
  assert.equal(policy.id,"observed-reclaim-retest-v1");assert.equal(policy.mode,"confirmed_retest");assert.equal(policy.sourceBoundary,100);
  assert.equal(policy.eventKnownAt,plan.evidence.completedAt);assert.equal(policy.eventTimeframe,"15m");assert.deepEqual(entry,{lower:100,upper:102});
  assert.notEqual(policy.eventAfter,cutoff,"Rendering does not create the price-event clock");
});

test("lower-frame context cannot replace the declared execution timeframe",()=>{
  const report=example({tf:"1Dutc",side:"long",family:"breakout_retest",source:[98,100],stop:90,stopBasis:98,target:120,current:103}),plan=report.discretionaryPlan!;
  const testTs=Date.UTC(2026,9,30,15);plan.evidence={kind:"primary_reclaim",timeframe:"1H",level:100,testTs,completedAt:testTs+3_600_000,extreme:99};
  assert.equal(deriveGlobalExecutionPolicy(report,plan,{lower:98,upper:100}).policy.eventTimeframe,"4H");
});

test("a source interval crossing protection uses a distinct boundary retest, without altering risk",()=>{
  const report=example({tf:"15m",side:"long",family:"ema_pullback",source:[89,100],stop:90,stopBasis:94,target:120,current:103}),original=structuredClone(report.discretionaryPlan!);
  applyGlobalPriceZones(report);const plan=report.discretionaryPlan!,z=plan.priceZones!;
  assert.equal(plan.version,"discretionary-plan-v8");assert.deepEqual([z.entry.sourceLower,z.entry.sourceUpper],[89,100]);
  assert.deepEqual([z.entry.lower,z.entry.upper],[100,100]);assert.equal(plan.executionPolicy!.mode,"confirmed_retest");
  assert.equal(plan.executionPolicy!.id,"ema_pullback-boundary-retest-v1");assert.equal(plan.stop,original.stop);assert.deepEqual(plan.targets,original.targets);
});

test("a target wick crossing future entry keeps its exact swing objective and nearer opposition",()=>{
  const report=example({tf:"1H",side:"long",family:"level_retest",source:[97,100],stop:90,stopBasis:97,target:110,current:95}),plan=report.discretionaryPlan!;
  Object.assign(report.candles[0],{open:98,close:99,high:110,low:94});plan.targets[0].basis="observed_extreme";
  report.horizonContext!.zones.push({...report.horizonContext!.zones[0],id:"near-opposition",role:"resistance",lower:102,upper:103});
  applyGlobalPriceZones(report);const priced=report.discretionaryPlan!;
  assert.equal(priced.version,"discretionary-plan-v8");assert.deepEqual(priced.priceZones!.targets,[{lower:110,upper:110}]);
  assert.equal(priced.targets[0].price,110);assert.deepEqual(priced.barriers.map(b=>b.price),[102,103]);assert.equal(priced.entry,100);
});

test("family settings and asset/timeframe configuration remain explicit and tunable",()=>{
  const report=example({tf:"1Wutc",side:"long",family:"level_retest",source:[98,100],stop:90,stopBasis:98,target:120,current:103});
  const plan=report.discretionaryPlan!,{policy}=deriveGlobalExecutionPolicy(report,plan,{lower:98,upper:100},{timeToLiveBars:3,fillWindowBars:2,confirmationBars:2});
  assert.equal(policy.configurationKey,"BTC-USDT:1Wutc:level_retest:v1");assert.equal(policy.fillWindowBars,2);
  assert.equal(policy.expiresAt,cutoff+3*86_400_000);assert.equal(policy.stopManagement,"structural_fixed");assert.deepEqual(policy.targetAllocations,[1]);
  assert.throws(()=>deriveGlobalExecutionPolicy(report,plan,{lower:98,upper:100},{timeToLiveBars:0}),RangeError);
});
