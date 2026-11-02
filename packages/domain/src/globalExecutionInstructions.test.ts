import test from "node:test";
import assert from "node:assert/strict";
import type {GlobalReport} from "@pulse/schemas";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalScenarioEntryDeadline,globalExecutionInstructions,globalScenarioLines} from "./globalExecutionInstructions.js";
import {globalDiscretionaryCard} from "./globalDiscretionaryPlan.js";
import {globalReportChartSvg} from "./globalChart.js";
import {globalSections} from "./globalPresentation.js";
import {globalStrategyMixLines} from "./globalStrategyMixLines.js";
import {globalChartRasterSize} from "./globalChartAppearance.js";

function savedExample(lang:"en"|"zh"="en"){
  const report=globalDesignFixture("pro",lang),at=Date.parse("2026-11-02T02:09:31Z"),confirmationAt=Date.parse("2026-11-02T01:55:00Z"),expiresAt=at+3600000;
  report.snapshot.observedAt=new Date(at).toISOString();report.decisionVersion="decision-v5";
  const reference={price:115.75,timeframe:"5m",candleTs:at-300000,completedAt:at};
  report.discretionaryPlan={version:"discretionary-plan-v8",family:"breakout_retest",side:"long",entry:117.3,stop:113.12,reference,barriers:[],objectiveTimeframe:"1H",
    entryBasis:{kind:"reclaimed_level",price:117.3,timeframe:"1H",knownAt:confirmationAt-3600000,anchorTs:confirmationAt-7200000},stopBasis:{price:114,timeframe:"1H",anchorTs:confirmationAt-7200000,knownAt:confirmationAt-3600000},
    targets:[{price:120.56,timeframe:"1H",anchorTs:confirmationAt-7200000,knownAt:confirmationAt-3600000,basis:"confirmed_swing"}],
    priceZones:{version:"price-zones-v1",entry:{lower:117,upper:117.3,sourceLower:117,sourceUpper:117.3,sourcePrice:117.3},stop:{lower:113.12,upper:114},targets:[{lower:120.56,upper:121}],payoffFloor:1,payoffLimited:false},
    executionPolicy:{version:"execution-policy-v1",id:"test-retest",configurationKey:"private-test-setting",family:"breakout_retest",mode:"confirmed_retest",sourceBoundary:117.3,eventTimeframe:"5m",eventKnownAt:confirmationAt,eventAfter:confirmationAt-600000,expiresAt,confirmationBars:1,fillWindowBars:3,stopManagement:"structural_fixed",targetAllocations:[1],entryRegion:"defended_retest"},
  } as unknown as NonNullable<GlobalReport["discretionaryPlan"]>;
  report.scenario={version:"scenario-lifecycle-v1",state:"confirmed_awaiting_fill",startedAt:at,updatedAt:at,expiresAt,confirmationAt,definition:{mode:"confirmed_retest",fillWindowMs:900000,expiresAt},events:[],exits:[],remainingFraction:1,observationOnly:true} as unknown as NonNullable<GlobalReport["scenario"]>;
  report.strategyMix={version:"global-strategy-mix-v1",primary:{family:"ema_pullback",side:"long",variant:"core",reason:"core"},selectedVariant:"sweep_reclaim",evidenceGroups:["price_structure"],exposurePolicy:"one_primary_exposure",candidates:[{id:"sweep_reclaim",family:"level_retest",side:"long",status:"eligible",reason:"event",missingInputs:[],conflicts:[],evidenceIds:[],source:{kind:"swept_level",price:117.3,lower:117.3,upper:117.3,timeframe:"1H",knownAt:confirmationAt-3600000},event:{kind:"sweep_reclaim",timeframe:"5m",testTs:confirmationAt-600000,completedAt:confirmationAt,extreme:116.9}}]};
  return report;
}

test("confirmed entry prints its short return deadline separately from overall expiry",()=>{
  const report=savedExample(),before=JSON.stringify(report),deadline=Date.parse("2026-11-02T02:10:00Z");
  assert.equal(globalScenarioEntryDeadline(report),deadline);
  const instruction=globalExecutionInstructions(report)!;
  assert.match(instruction,/Entry deadline 2026-11-02 02:10:00 UTC/);
  assert.match(instruction,/Overall setup expiry 2026-11-02 03:09:31 UTC does not extend/);
  assert.match(instruction,/saved snapshot conditions; recheck current entry eligibility/);
  const state=globalScenarioLines(report).join("\n");assert.match(state,/Recorded snapshot state/);assert.match(state,/Entry deadline 2026-11-02 02:10:00 UTC/);assert.doesNotMatch(state,/Entry deadline 2026-11-02 03:09/);
  assert.equal(JSON.stringify(report),before,"reading the effective deadline must not renew a saved scenario");
});

test("earlier setup expiry, passive policies and unconfirmed events preserve their own clocks",()=>{
  const report=savedExample();report.scenario!.expiresAt=Date.parse("2026-11-02T02:05:00Z");
  assert.equal(globalScenarioEntryDeadline(report),report.scenario!.expiresAt);
  report.scenario!.expiresAt=Date.parse("2026-11-02T03:09:31Z");report.scenario!.definition.mode="passive_limit";
  assert.equal(globalScenarioEntryDeadline(report),report.scenario!.expiresAt,"passive limits cannot borrow a confirmation window");
  report.discretionaryPlan!.executionPolicy!.mode="passive_limit";
  assert.match(globalExecutionInstructions(report)!,/Passive limit plan/);assert.doesNotMatch(globalExecutionInstructions(report)!,/confirmation fails|confirmed entry window/);
  report.scenario!.definition.mode="confirmed_retest";delete report.scenario!.confirmationAt;
  assert.equal(globalScenarioEntryDeadline(report),report.scenario!.expiresAt);
  delete report.scenario;assert.equal(globalScenarioEntryDeadline(report),report.discretionaryPlan!.executionPolicy!.expiresAt);
});

test("card, text sections and PNG retain the same effective deadline and selected method evidence",()=>{
  for(const lang of ["en","zh"] as const){
    const report=savedExample(lang),card=globalDiscretionaryCard(report)!,sections=globalSections(report).flatMap(s=>s.lines).join("\n"),svg=globalReportChartSvg(report)!;
    for(const output of [card.condition,sections,svg])assert.ok(output.includes("2026-11-02 02:10:00 UTC"));
    for(const line of globalStrategyMixLines(report).slice(0,4))assert.ok(svg.includes(line),"the image must retain its selected method, source, price event and participation limitation");
    assert.doesNotMatch(svg,/private-test-setting|fillWindowBars|targetAllocations/);
    const dimensions=svg.match(/width="(\d+)" height="(\d+)"/)!;
    const size=globalChartRasterSize(Number(dimensions[1]),Number(dimensions[2]));assert.ok(size.width*size.height<=16_000_000);assert.ok(size.width>2600);
  }
});
