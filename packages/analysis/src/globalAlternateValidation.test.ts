import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GlobalReportSchema} from "@pulse/schemas";
import {globalDecision,globalSetupAdmission} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {applyGlobalDiscretionaryPlan} from "./globalDiscretionaryPlan.js";

const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
// Explicit settings retain the registered structural-edge policy so these
// archive-compatibility regressions do not silently change strategy versions.
const make=(frame="1Wutc")=>prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium",executionSettings:{fillWindowBars:4}});

test("alternate source-edge plans retain the first primary obstacle and distinct later targets",()=>{
  const report=make(),alternate=report.alternatePlan!;
  assert.ok(alternate);assert.equal(alternate.targets.length,3,"the fixture has three separated, source-backed primary obstacles");
  assert.equal(alternate.executionPolicy?.id,"structural-edge-passive-v3");
  assert.ok(alternate.targets.every((t,i)=>i===0||(alternate.side==="long"?1:-1)*(t.price-alternate.targets[i-1].price)>0));
  assert.equal(GlobalReportSchema.safeParse(report).success,true);
  const forged=structuredClone(report),plan=forged.alternatePlan!;
  plan.targets[0].price+=100;plan.priceZones!.targets[0]={lower:plan.targets[0].price,upper:plan.targets[0].price};
  assert.equal(GlobalReportSchema.safeParse(forged).success,false,"an alternate cannot skip its first canonical primary obstacle");
});

function structuralFixtureWithTargets(count:1|2|3){
  const report=make(),plan=report.discretionaryPlan!,targets=plan.targets.slice(0,count),source=report.horizonContext!.zones.find(z=>z.role===(plan.side==="long"?"support":"resistance")&&(plan.side==="long"?z.upper:z.lower)===plan.entryBasis.price)!;
  const targetZones=targets.filter(t=>t.basis==="structure_zone").flatMap(t=>report.horizonContext!.zones.filter(z=>z.role===(plan.side==="long"?"resistance":"support")&&z.startTs===t.anchorTs&&z.knownAt===t.knownAt&&(plan.side==="long"?z.lower:z.upper)===t.price));
  const pivotIds=new Set([...(source.anchorIds),...targetZones.flatMap(z=>z.anchorIds),...targets.filter(t=>t.basis==="confirmed_swing").map(t=>report.indicators.pivots.find(a=>a.ts===t.anchorTs&&a.price===t.price)?.id).filter((id):id is string=>Boolean(id))]);
  report.horizonContext!.zones=[source,...targetZones];report.horizonContext!.ranges=[];report.indicators.pivots=report.indicators.pivots.filter(a=>pivotIds.has(a.id));
  applyGlobalDiscretionaryPlan(report,{},true,{side:plan.side,family:"level_retest",entryBasis:plan.entryBasis});
  return report;
}

test("structural TP selection returns one, two or three nearest distinct obstacles and deduplicates zone edges",()=>{
  for(const count of [1,2,3] as const){
    const report=structuralFixtureWithTargets(count),plan=report.discretionaryPlan!;
    assert.equal(plan.targets.length,count,`${count} separated sources should yield ${count} targets`);
    assert.equal(plan.targets[0].price,make().discretionaryPlan!.targets[0].price,"TP1 remains the canonical nearest obstacle");
    assert.ok(plan.targets.every((t,i)=>i===0||(plan.side==="long"?1:-1)*(t.price-plan.targets[i-1].price)>0));
    assert.equal(plan.priceZones!.targets.length,count);
  }
  const one=structuralFixtureWithTargets(1),target=one.discretionaryPlan!.targets[0],zone=one.horizonContext!.zones.find(z=>z.startTs===target.anchorTs&&z.knownAt===target.knownAt&&z.role===(one.discretionaryPlan!.side==="long"?"resistance":"support"))!;
  assert.ok(zone.lower!==zone.upper,"the single target's source zone has two edges");assert.equal(one.discretionaryPlan!.targets.length,1,"both edges of one source zone count as one objective");
});

test("alternate structural TP2 and TP3 cannot be skipped, moved or detached from their sources",()=>{
  const original=make();assert.equal(original.alternatePlan!.targets.length,3);
  const mutations=[
    (r:ReturnType<typeof make>)=>{const p=r.alternatePlan!;p.targets.splice(1,1);p.priceZones!.targets.splice(1,1);p.executionPolicy!.targetAllocations=[.5,.5];},
    (r:ReturnType<typeof make>)=>{const p=r.alternatePlan!;p.targets[1]={...p.targets[2]};p.priceZones!.targets[1]={...p.priceZones!.targets[2]};},
    (r:ReturnType<typeof make>)=>{const p=r.alternatePlan!;p.targets[1].price+=100;p.priceZones!.targets[1]={lower:p.targets[1].price,upper:p.targets[1].price};},
    (r:ReturnType<typeof make>)=>{const p=r.alternatePlan!;p.targets[2].knownAt=Date.parse(r.snapshot.observedAt)+1;},
  ];
  for(const mutate of mutations){const forged=structuredClone(original);mutate(forged);assert.equal(GlobalReportSchema.safeParse(forged).success,false);}
});

test("structural-edge passive-v3 admission ignores a crossed objective but still blocks a breached hard stop",()=>{
  const report=make(),plan=report.discretionaryPlan!;
  assert.equal(plan.executionPolicy?.id,"structural-edge-passive-v3");
  const cutoff=Date.parse(report.snapshot.observedAt),sign=plan.side==="long"?1:-1;
  report.currentMarket={...(report.currentMarket??{source:report.snapshot.source,frames:[]}),quote:{price:plan.targets[0].price+sign,ts:cutoff}};
  assert.equal(globalSetupAdmission(report).allowed,true,JSON.stringify(globalSetupAdmission(report)));
  assert.equal(globalDecision(report).limitPlanReady,true);
  report.currentMarket.quote={price:plan.stop-sign,ts:cutoff};
  assert.equal(globalSetupAdmission(report).allowed,false);
  assert.equal(globalDecision(report).limitPlanReady,false);
});
