import test from "node:test";
import assert from "node:assert/strict";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalDiscretionaryCard} from "./globalDiscretionaryPlan.js";
import {globalOpposingEntryZones,globalPriceZonePayoff} from "./globalPriceZones.js";
import {globalSetupRationale} from "./globalSetupRationale.js";

function reclaimedFixture(lang:"en"|"zh"="en"){
  const report=globalDesignFixture("pro",lang),testTs=Date.UTC(2026,9,27,21,30),completedAt=Date.UTC(2026,9,27,21,45);
  report.snapshot={...report.snapshot,instId:"BTC-USDT",timeframe:"15m",price:80959.3,lastCandleTs:testTs,observedAt:new Date(completedAt+49_956).toISOString()};
  report.candles.at(-1)!.ts=testTs;report.candles.at(-1)!.close=80959.3;
  report.currentMarket={source:report.snapshot.source,quote:{price:80959.3,ts:completedAt+48_970},frames:[]};
  report.discretionaryPlan={
    version:"discretionary-plan-v6",side:"long",family:"breakout_retest",objectiveTimeframe:"15m",
    entry:80956.7,stop:80615.0128432,requiresNewTestAfter:completedAt+49_956,
    entryBasis:{kind:"reclaimed_level",price:80826.1,timeframe:"5m",knownAt:testTs},
    reference:{timeframe:"5m",candleTs:completedAt-300_000,completedAt,price:80959.3},
    stopBasis:{timeframe:"15m",anchorTs:testTs-900_000,knownAt:testTs,price:80649.5},
    targets:[{price:81298.4,timeframe:"15m",anchorTs:testTs,knownAt:completedAt,basis:"observed_extreme"}],barriers:[],
    evidence:{kind:"local_reclaim",level:80826.1,timeframe:"5m",testTs,completedAt:testTs+300_000,extreme:80742.3},
    priceZones:{version:"price-zones-v1",entry:{lower:80826.1,upper:80956.7,sourceLower:80826.1,sourceUpper:81210.2,sourcePrice:80826.1},stop:{lower:80615.0128432,upper:80649.5},targets:[{lower:81298.4,upper:81298.4}],payoffFloor:1,payoffLimited:false},
  };
  return report;
}

test("a local reclaim confirms its actual level while fills stay inside the clipped entry band",()=>{
  const report=reclaimedFixture(),before=JSON.stringify(report),card=globalDiscretionaryCard(report)!;
  assert.equal(card.entry,"80,826.10–80,956.70");
  assert.match(card.condition,/new test candle must close above the reclaimed level at 80,826\.10/);
  assert.doesNotMatch(card.condition,/81,210\.20|must first reclaim/);
  assert.match(card.condition,/a later completed 5m candle must close above its high/);
  assert.match(card.condition,/new test formed after this snapshot/);
  assert.match(card.condition,/entry remains limited to the displayed Entry range/);
  assert.match(card.condition,/confirmation close is not an assumed fill/);
  assert.equal(card.confirmed,false);assert.equal(card.plan.state,"conditional");assert.equal(card.plan.confirmationTs,null);
  assert.deepEqual(card.plan.referenceEntry,[80826.1,80956.7]);assert.equal(card.plan.referenceStop,80615.0128432);
  assert.equal(card.targets[0].price,81298.4);assert.equal(JSON.stringify(report),before);
});

test("a price below the reclaim level requires that level and the bounded retest in both languages",()=>{
  for(const lang of ["en","zh"] as const){
    const report=reclaimedFixture(lang);report.currentMarket!.quote!.price=80800;
    const card=globalDiscretionaryCard(report)!;
    assert.ok(card.condition.includes("80,826.10–80,956.70"));assert.ok(!card.condition.includes("81,210.20"));
    if(lang==="en")assert.match(card.condition,/must first reclaim 80,826\.10, then buy a held retest in 80,826\.10–80,956\.70/);
    else assert.ok(card.condition.includes("先收复 80,826.10")&&card.condition.includes("收复价位 80,826.10"));
  }
});

test("a reclaim without price zones falls back to the preserved source entry basis",()=>{
  const report=reclaimedFixture();delete report.discretionaryPlan!.priceZones;
  const card=globalDiscretionaryCard(report)!;
  assert.match(card.condition,/reclaimed level at 80,826\.10/);assert.doesNotMatch(card.condition,/must first reclaim/);
});

test("range-edge plans retain the original zone-boundary confirmation",()=>{
  const report=reclaimedFixture();report.discretionaryPlan!.entryBasis.kind="range_edge";
  const card=globalDiscretionaryCard(report)!;
  assert.match(card.condition,/must first reclaim 81,210\.20/);
  assert.match(card.condition,/new test candle must close above the source zone at 81,210\.20/);
  assert.equal(card.entry,"80,826.10–80,956.70");
});

function overlapFixture(side:"long"|"short",lower:number,upper:number,lang:"en"|"zh"="en"){
  const report=reclaimedFixture(lang),d=report.discretionaryPlan!;
  d.side=side;d.family="level_retest";d.entry=side==="long"?110:100;d.stop=side==="long"?90:120;
  d.entryBasis={kind:"structure_zone",timeframe:"15m",price:d.entry,knownAt:d.reference.completedAt};
  d.stopBasis.price=side==="long"?95:115;delete d.evidence;
  d.targets[0].price=side==="long"?140:70;
  d.barriers=[{price:side==="long"?130:80,timeframe:"15m",anchorTs:d.reference.candleTs,knownAt:d.reference.completedAt}];
  d.priceZones!.entry={lower:100,upper:110,sourceLower:100,sourceUpper:110,sourcePrice:d.entry};
  d.priceZones!.stop={lower:Math.min(d.stop,d.stopBasis.price),upper:Math.max(d.stop,d.stopBasis.price)};
  d.priceZones!.targets=[{lower:d.targets[0].price,upper:d.targets[0].price}];
  report.snapshot.price=d.entry;report.currentMarket!.quote!.price=d.entry;
  report.horizonContext={version:"horizon-context-v1",timeframe:"15m",reading:"session",knownAt:d.reference.completedAt,ranges:[],zones:[{
    id:"opposing-primary-zone",role:side==="long"?"resistance":"support",lower,upper,basis:"confirmed_pivot_wicks",anchorIds:["fixture-source"],startTs:d.reference.candleTs,knownAt:d.reference.completedAt,
  }]};
  return report;
}

test("opposing entry-zone overlap is symmetric and uses the true facing edge for best-fill reward",()=>{
  for(const [side,lower,upper] of [["long",108,115],["short",95,102]] as const){
    const report=overlapFixture(side,lower,upper),before=JSON.stringify(report),payoff=globalPriceZonePayoff(report)!;
    assert.equal(globalOpposingEntryZones(report).length,1);assert.equal(payoff.worstToObstacle,0);
    assert.equal(payoff.bestToObstacle,.8);assert.equal(payoff.worstToTP1,1.5);assert.equal(payoff.bestToTP1,4);
    assert.equal(JSON.stringify(report),before);assert.equal(report.discretionaryPlan!.barriers[0].price,side==="long"?130:80);
    assert.equal(globalDiscretionaryCard(report)!.plan.firstObstacleRewardRisk,0);
  }
});

test("best fill touching an opposing zone has zero obstacle reward, including boundary-only entry overlap",()=>{
  for(const [side,lower,upper,expectedBest] of [["long",100,105,0],["short",105,110,0],["long",110,115,1],["short",95,100,1]] as const){
    const payoff=globalPriceZonePayoff(overlapFixture(side,lower,upper))!;
    assert.equal(payoff.worstToObstacle,0);assert.equal(payoff.bestToObstacle,expectedBest);
  }
});

test("non-overlapping, same-side and future zones do not replace the saved obstacle",()=>{
  for(const report of [overlapFixture("long",111,115),overlapFixture("short",95,99)]){
    assert.equal(globalOpposingEntryZones(report).length,0);assert.equal(globalPriceZonePayoff(report)!.worstToObstacle,1);
  }
  const report=overlapFixture("long",108,115),zone=report.horizonContext!.zones[0];
  zone.role="support";assert.equal(globalOpposingEntryZones(report).length,0);
  zone.role="resistance";zone.knownAt=Date.parse(report.snapshot.observedAt)+1;assert.equal(globalOpposingEntryZones(report).length,0);
});

test("overlap rationale names the real zone and required reaction in both languages",()=>{
  for(const lang of ["en","zh"] as const)for(const side of ["long","short"] as const){
    const report=overlapFixture(side,side==="long"?108:95,side==="long"?115:102,lang),text=globalSetupRationale(report,report.discretionaryPlan!.entry).join("\n");
    assert.ok(text.includes(side==="long"?"108.00–115.00":"95.00–102.00"));assert.ok(text.includes("0.00R"));
    if(lang==="en"){
      assert.match(text,/Entry overlaps the primary 15m (resistance|support) zone/);
      assert.ok(text.includes(side==="long"?"reclaim and held retest":"break and rejected retest"));
      assert.match(text,/Further plotted obstacle/);assert.doesNotMatch(text,/Nearest obstacle: .*offers 1\.00R/);
    }else assert.ok(text.includes(side==="long"?"完整收复该阻力区并回测守住":"完整跌破该支撑区并回测受阻"));
  }
});
