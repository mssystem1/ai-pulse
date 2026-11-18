import test from "node:test";
import assert from "node:assert/strict";
import type {GlobalReport} from "@pulse/schemas";
import {terminalSetupEntryNotice} from "./terminalSetupEntry.js";

const now=Date.UTC(2026,10,17,12);
function report(input:{entry:[number,number];stop:number;target:[number,number];quote:number;mode:"passive_limit"|"confirmed_retest";expiresAt?:number;barriers?:number[];lang?:"en"|"zh"}){
  const [lower,upper]=input.entry,[targetLower,targetUpper]=input.target;
  return {
    lang:input.lang??"en",
    snapshot:{observedAt:new Date(now).toISOString(),pricePrecision:2,timeframe:"1Wutc"},
    currentMarket:{quote:{price:input.quote,ts:now}},
    discretionaryPlan:{side:"short",entry:upper,stop:input.stop,reference:{timeframe:"1D",price:input.quote},objectiveTimeframe:"1Wutc",targets:[{price:targetUpper,timeframe:"1Wutc"}],barriers:(input.barriers??[]).map(price=>({price,timeframe:"1Dutc",anchorTs:now-1,knownAt:now})),
      priceZones:{entry:{lower,upper},stop:{lower:input.stop-1,upper:input.stop},targets:[{lower:targetLower,upper:targetUpper}],payoffFloor:1},
      executionPolicy:{mode:input.mode,eventTimeframe:"1D",expiresAt:input.expiresAt??now+60_000}},
  } as unknown as GlobalReport;
}

test("unqualified remote short setup shows conservative reward, quote gap and conditional limit semantics",()=>{
  const view=terminalSetupEntryNotice(report({entry:[65407,66955],stop:68769,target:[56555,63127],quote:64580,mode:"passive_limit"}),{now})!;
  assert.equal(view.state,"unqualified");assert.equal(view.admission.targetRewardRisk,2280/3362);assert.equal(view.direction,"below");
  assert.ok(view.title.toLowerCase().includes("unqualified"));
  assert.ok(Math.abs(view.distancePercent!-827/64580*100)<1e-9);assert.equal(view.executionMode,"passive_limit");
  assert.ok(view.lines.some(line=>line.includes("1.28% above")));
  assert.ok(view.lines.some(line=>line.includes("passive limit")));assert.ok(view.lines.at(-1)!.includes("no fill is implied"));
  assert.ok(view.lines.some(line=>line.includes("not a prediction that price will return")));
});

test("daily example reports the actual nearer obstacle as the qualification limit",()=>{
  const view=terminalSetupEntryNotice(report({entry:[70613.8133569,74225.6154207],stop:81732.8789541,target:[61830,63042.8],quote:64404.3,mode:"passive_limit",barriers:[64706.3,64049]}),{now})!;
  assert.equal(view.state,"unqualified");assert.equal(view.admission.nearestObstacle?.price,64706.3);
  assert.ok(Math.abs(view.admission.targetRewardRisk!-.6809037405810914)<1e-10);
  assert.ok(Math.abs(view.admission.firstObstacleRewardRisk!-.5312958454339575)<1e-10);
  assert.ok(view.lines.some(line=>line.includes("nearest opposing level offers 0.53R")));
  assert.ok(view.lines.some(line=>line.includes("9.64% above")));
});

test("qualified passive entry remains conditional and discloses its distinct timeframes",()=>{
  const view=terminalSetupEntryNotice(report({entry:[100,101],stop:110,target:[80,90],quote:99,mode:"passive_limit"}),{now})!;
  assert.equal(view.state,"qualified");assert.equal(view.executionMode,"passive_limit");assert.equal(view.objectiveTimeframe,"1Wutc");
  assert.ok(view.lines.some(line=>line.includes("1Wutc objectives")));assert.ok(view.lines.some(line=>line.includes("passive limit")));
  assert.equal(view.title,"Passive limit ready for preparation");
  assert.ok(view.lines.some(line=>line.includes("No extra candle confirmation is required")));
  assert.ok(view.lines.at(-1)!.includes("not an immediate order instruction"));
});

test("expired confirmation policy is labeled expired even when geometry passes",()=>{
  const view=terminalSetupEntryNotice(report({entry:[100,101],stop:110,target:[80,90],quote:99,mode:"confirmed_retest",expiresAt:now-1}),{now})!;
  assert.equal(view.state,"expired");assert.equal(view.executionMode,"confirmed_retest");
  assert.ok(view.lines.some(line=>line.includes("wait for the stated 1D retest confirmation")));
  assert.equal(view.state,"expired");
});

test("no discretionary plan produces no notice",()=>{
  assert.equal(terminalSetupEntryNotice({} as GlobalReport,{now}),null);
});

test("whole-price markets render safely and the entry deadline is inclusive",()=>{
  const saved=report({entry:[100,101],stop:110,target:[80,90],quote:99,mode:"passive_limit",expiresAt:now});
  saved.snapshot.pricePrecision=0;
  const view=terminalSetupEntryNotice(saved,{now})!;
  assert.equal(view.state,"expired");
  assert.ok(view.lines.some(line=>line.includes("Entry zone 100–101")));
});
