import test from "node:test";
import assert from "node:assert/strict";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalSetupAdmission} from "./globalSetupAdmission.js";
import {globalDiscretionaryCard} from "./globalDiscretionaryPlan.js";

function fixture(side:"long"|"short"="long"){
 const report=globalDesignFixture("pro"),at=Date.UTC(2026,10,5,12);report.snapshot.observedAt=new Date(at).toISOString();report.snapshot.timeframe="1Dutc";
 const entry=side==="long"?101:100,stop=side==="long"?90:111,target=side==="long"?125:76;
 report.discretionaryPlan={version:"discretionary-plan-v7",side,family:"level_retest",objectiveTimeframe:"1Dutc",entry,stop,entryBasis:{kind:"structure_zone",timeframe:"1Dutc",price:entry,knownAt:at-86400000},reference:{timeframe:"4H",candleTs:at-14400000,completedAt:at,price:entry},stopBasis:{timeframe:"1Dutc",price:side==="long"?91:110,anchorTs:at-172800000,knownAt:at-86400000},targets:[{price:target,timeframe:"1Dutc",anchorTs:at-172800000,knownAt:at-86400000,basis:"confirmed_swing"}],barriers:[],priceZones:{version:"price-zones-v1",entry:{lower:100,upper:101,sourceLower:100,sourceUpper:101,sourcePrice:entry},stop:{lower:Math.min(stop,side==="long"?91:110),upper:Math.max(stop,side==="long"?91:110)},targets:[{lower:target,upper:target}],payoffFloor:1,payoffLimited:false}};
 report.horizonContext={version:"horizon-context-v1",timeframe:"1Dutc",knownAt:at-86400000,reading:"position",ranges:[],zones:[]};
 report.currentMarket={source:report.snapshot.source,quote:{price:entry,ts:at},frames:[]};delete report.scenario;
 return report;
}
test("the declared one-R floor allows monitoring without asserting confirmation or an order",()=>{
 const report=fixture(),p=report.discretionaryPlan!;p.barriers=[{price:112,timeframe:"4H",anchorTs:p.reference.candleTs,knownAt:p.reference.completedAt}];
 const admission=globalSetupAdmission(report);assert.equal(admission.minimumRewardRisk,1);assert.equal(admission.minimumPolicy,"saved-price-zones");assert.equal(admission.firstObstacleRewardRisk,1);assert.equal(admission.allowed,true);assert.equal(admission.state,"waiting");
});
test("a remote target cannot hide nearer active primary opposition, symmetrically",()=>{
 for(const side of ["long","short"]as const){const report=fixture(side),p=report.discretionaryPlan!,before=structuredClone(p),near=side==="long"?103:98;
  report.horizonContext!.zones=[{id:"actual-near-zone",role:side==="long"?"resistance":"support",lower:near,upper:near+1,anchorIds:["public-source"],basis:"confirmed_pivot_wicks",startTs:p.stopBasis.anchorTs,knownAt:p.stopBasis.knownAt}];
  const admission=globalSetupAdmission(report);assert.equal(admission.geometryEligible,false);assert.equal(admission.state,"blocked");assert.ok(admission.targetRewardRisk!>2);assert.ok(admission.firstObstacleRewardRisk!<1);assert.ok(admission.blockers.includes("reward"));assert.deepEqual(p,before);
  const card=globalDiscretionaryCard(report)!;assert.equal(card.plan.state,"avoid");assert.ok(card.plan.blockers.includes("reward"));assert.equal(card.plan.firstObstacleRewardRisk,admission.firstObstacleRewardRisk);
 }
});
test("a first target crossed by current quote cannot be replaced by its far wick or TP2",()=>{
 const report=fixture(),p=report.discretionaryPlan!;p.priceZones!.targets[0]={lower:120,upper:125};report.currentMarket!.quote!.price=121;
 const admission=globalSetupAdmission(report);assert.equal(admission.targetRewardRisk,19/11);assert.equal(admission.allowed,false);assert.ok(admission.blockers.includes("objective_already_reached"));assert.equal(p.targets[0].price,125);
});
test("overlapping opposition gives zero clearance and an ended record cannot be followed again",()=>{
 const report=fixture(),p=report.discretionaryPlan!;report.horizonContext!.zones=[{id:"overlap",role:"resistance",lower:100,upper:102,anchorIds:["source"],basis:"confirmed_pivot_wicks",startTs:p.stopBasis.anchorTs,knownAt:p.stopBasis.knownAt}];
 assert.equal(globalSetupAdmission(report).firstObstacleRewardRisk,0);assert.ok(globalSetupAdmission(report).blockers.includes("opposing_zone_overlap"));
 report.horizonContext!.zones=[];report.scenario={state:"entry_observed"}as NonNullable<typeof report.scenario>;
 assert.equal(globalSetupAdmission(report).allowed,false);assert.ok(globalSetupAdmission(report).blockers.includes("opportunity_ended"));
});
test("daily short and weekly long remain distinct hypotheses; both must clear their own actual first obstacle",()=>{
 const daily=fixture("short"),d=daily.discretionaryPlan!;d.entry=80396;d.stop=83941;d.priceZones!.entry={lower:80396,upper:80636,sourceLower:80396,sourceUpper:80636,sourcePrice:80396};d.targets[0].price=66885;d.priceZones!.targets=[{lower:66000,upper:66885}];d.barriers=[{price:77306,timeframe:"1Dutc",anchorTs:d.stopBasis.anchorTs,knownAt:d.stopBasis.knownAt}];daily.currentMarket!.quote!.price=76084;
 const weekly=fixture("long"),w=weekly.discretionaryPlan!;weekly.snapshot.timeframe="1Wutc";weekly.horizonContext!.timeframe="1Wutc";w.objectiveTimeframe="1Wutc";w.entry=78675;w.stop=73739;w.priceZones!.entry={lower:76577,upper:78675,sourceLower:76577,sourceUpper:78675,sourcePrice:78675};w.targets[0].price=87399;w.priceZones!.targets=[{lower:80636,upper:87399}];weekly.currentMarket!.quote!.price=76084;
 assert.equal(globalSetupAdmission(daily).state,"blocked");assert.equal(globalSetupAdmission(weekly).state,"blocked");assert.equal(d.side,"short");assert.equal(w.side,"long");assert.equal(globalSetupAdmission(weekly).targetRewardRisk,(80636-78675)/(78675-73739));
});
