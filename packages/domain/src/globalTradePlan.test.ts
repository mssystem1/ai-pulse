import test from "node:test";
import assert from "node:assert/strict";
import {GlobalReportSchema,candleCloseTime} from "@pulse/schemas";
import {globalDesignFixture} from "./globalReport.fixtures.js";
import {globalTradePlan,deriveGlobalTradePlan} from "./globalTradePlan.js";
import {globalConfirmationEvidence} from "./globalConfirmation.js";
import {globalTradePlanLines,globalConfirmationCorrection,globalSetupFailureLines,globalCompletedPriceLine} from "./globalPresentation.js";
import {globalSetupAttemptEvidence} from "./globalConfirmation.js";
import {globalReportChartSvg} from "./globalChart.js";

test("a bearish saved map supplies short references without changing its historical buy setup",()=>{
  const report=globalDesignFixture(),before=structuredClone(report),plan=globalTradePlan(report);
  assert.equal(plan.side,"short");assert.equal(plan.pathId,"correction");
  assert.ok(plan.referenceStop!>plan.referenceEntry![1]);
  assert.ok(report.levels.find(l=>l.id===plan.targetIds[0])!.price<plan.referenceEntry![0]);
  assert.match(globalTradePlanLines(report).join("\n"),/sell\/reduce owned inventory/);
  assert.deepEqual(report,before,"Rendering must not rewrite an old purchased report");
});
test("insufficient reward remains visible with a concrete no-entry explanation",()=>{
  const report=globalDesignFixture(),atr=report.indicators.atr.points.at(-1)!.value,trigger=report.levels.find(l=>l.id==="reclaim")!.price;
  report.levels.find(l=>l.id==="floor")!.price=trigger-.06*atr;
  const plan=globalTradePlan(report);assert.equal(plan.state,"avoid");assert.ok(plan.grossRewardRisk!<1.5);assert.ok(plan.referenceEntry&&plan.referenceStop);
  assert.match(globalTradePlanLines(report).join("\n"),/below 1.50; avoid entry/);
  assert.match(globalTradePlanLines(report).at(-1)!,/confirmation alone does not repair/);
});
test("canonical plan validation rejects reversed prices and mismatched chart targets",()=>{
  const report=globalDesignFixture();report.tradePlan=globalTradePlan(report);assert.equal(GlobalReportSchema.safeParse(report).success,true);
  const inverted=structuredClone(report);inverted.tradePlan!.referenceStop=1;assert.equal(GlobalReportSchema.safeParse(inverted).success,false);
  const drift=structuredClone(report);drift.tradePlan!.targetIds=["target1"];assert.equal(GlobalReportSchema.safeParse(drift).success,false);
});
test("exports focus recent candles while retaining an explicitly requested full history",()=>{
  const report=globalDesignFixture();assert.ok(/(?:2\d|3[0-9]|[4-8]\d|9[0-6]) \/ 520 COMPLETED CANDLES/.test(globalReportChartSvg(report)!));assert.match(globalReportChartSvg(report,{fullHistory:true})!,/520 \/ 520 COMPLETED CANDLES/);
  assert.equal(report.candles.length,520);assert.match(globalReportChartSvg(report)!,/Planned SL reference \(not observed protection\)/);
});
test("a failed support close requires a new confirmation and subsequent test",()=>{
  const report=globalDesignFixture();report.paths[0].role="alternative";report.paths[1].role="main";report.paths[1].confirmation="support_hold";
  report.levels.find(l=>l.id==="floor")!.price=116;
  const tail=report.candles.slice(-6).map(c=>({...c,open:117.35,high:117.6,low:117.31,close:117.35}));
  tail[0].low=117.2;tail[1]={...tail[1],open:117,high:117.1,low:116.7,close:116.8};tail[5].low=117.25;
  report.candles=[...report.candles.slice(0,-6),...tail];report.snapshot.price=117.35;
  report.indicators.pivots.push({id:"support-test",ts:report.candles.at(-10)!.ts,confirmedAt:report.candles.at(-7)!.ts,price:117.3,kind:"low"});report.levels.find(l=>l.id==="reclaim")!.anchorIds=["support-test"];
  const plan=globalTradePlan(report);assert.equal(plan.confirmationTs,tail[5].ts);assert.equal(plan.retestTs,null);assert.ok(plan.blockers.includes("retest"));assert.notEqual(plan.state,"confirmed");
});
test("a very close first obstacle is retained instead of pricing reward to a farther target",()=>{
  const report=globalDesignFixture(),trigger=report.levels.find(l=>l.id==="reclaim")!.price,atr=report.indicators.atr.points.at(-1)!.value;
  report.levels.find(l=>l.id==="floor")!.price=trigger-.01*atr;
  report.tradePlan=globalTradePlan(report);assert.equal(report.tradePlan.targetIds[0],"floor");assert.ok(report.tradePlan.grossRewardRisk!<1.5);assert.ok(report.tradePlan.blockers.includes("reward"));assert.equal(GlobalReportSchema.safeParse(report).success,true);
});

test("a structural wick breach invalidates a prior confirmation even without reaching the wider planned SL",()=>{
  const report=globalDesignFixture();report.paths[0].role="alternative";report.paths[1].role="main";report.paths[1].confirmation="support_hold";
  const floor=report.levels.find(l=>l.id==="floor")!.price,trigger=report.levels.find(l=>l.id==="reclaim")!.price;
  report.indicators.pivots.push({id:"fresh-support",ts:report.candles.at(-10)!.ts,confirmedAt:report.candles.at(-9)!.ts,price:trigger,kind:"low"});report.levels.find(l=>l.id==="reclaim")!.anchorIds=["fresh-support"];
  const tail=report.candles.slice(-8).map(c=>({...c,open:trigger+.01,high:trigger+.3,low:trigger+.005,close:trigger+.01}));
  tail[5].low=trigger-.01;tail[6].low=trigger-.02;tail[7].low=floor-.001;
  report.candles=[...report.candles.slice(0,-8),...tail];report.snapshot.price=tail[7].close;report.snapshot.observedAt=new Date(tail[7].ts+3600000).toISOString();
  const plan=deriveGlobalTradePlan(report);assert.equal(plan.state,"avoid");assert.equal(plan.confirmationTs,null);assert.equal(plan.retestTs,null);assert.ok(plan.blockers.includes("cancelled"));assert.ok(plan.referenceStop!<tail[7].low);
  report.tradePlan=plan;
  assert.equal(globalConfirmationCorrection(report),null,"A fresh correctly avoided report is not a legacy correction");
  report.tradePlan={...plan,blockers:[...plan.blockers].reverse()};
  assert.equal(globalConfirmationCorrection(report),null,"Blocker order has no effect on report facts");
  report.setup={...report.setup,state:"cancelled",confirmationTs:tail[5].ts,retestTs:null};
  const event=globalSetupAttemptEvidence(report)!;assert.equal(event.retestObservedBeforeFailure,true);assert.equal(event.retestTs,tail[6].ts);assert.equal(event.failure?.reason,"floor");assert.equal(event.activeObservedProtection,false);
  assert.match(globalSetupFailureLines(report).join("\n"),/A held retest was observed/);
  for(const timeframe of ["1H","4H","1D","1W","1Mutc"])for(const lang of ["en","zh"] as const){
    const copy=structuredClone(report);copy.snapshot.timeframe=timeframe;copy.lang=lang;copy.evaluationVersion="completed-v2";
    const lines=globalSetupFailureLines(copy),failureClosed=new Date(candleCloseTime(event.failure!.candleTs,timeframe)!).toISOString(),retestClosed=new Date(candleCloseTime(event.retestTs!,timeframe)!).toISOString();
    assert.ok(lines[0].includes(failureClosed),`${timeframe}/${lang} failure must identify its closing time`);
    assert.ok(!lines[0].includes(new Date(event.failure!.candleTs).toISOString()),"Opening time must not be labelled as the failure's closing time");
    assert.ok(lines[1].includes(retestClosed),`${timeframe}/${lang} held-retest evidence must identify its closing time`);
    assert.ok(lines.every(line=>line.includes(lang==="zh"?"收盘":"bar closed")));
  }
  report.tradePlan={...plan,state:"conditional",confirmationTs:tail[5].ts,retestTs:tail[6].ts,blockers:["entry_price"]};const before=structuredClone(report);
  assert.equal(globalTradePlan(report).state,"avoid");assert.ok(globalTradePlan(report).blockers.includes("confirmation"));assert.deepEqual(report,before,"Stored purchases must stay immutable");
  assert.match(globalConfirmationCorrection(report)!,/Confirmation review/,"A genuine historical downgrade still needs its notice");
  tail.push({...tail[7],ts:tail[7].ts+3600000,low:trigger-.01});report.candles.push(tail.at(-1)!);report.snapshot.observedAt=new Date(tail.at(-1)!.ts+3600000).toISOString();
  const rearmed=deriveGlobalTradePlan(report);assert.equal(rearmed.confirmationTs,tail.at(-1)!.ts);assert.equal(rearmed.retestTs,null);assert.ok(rearmed.blockers.includes("retest"));assert.ok(!rearmed.blockers.includes("cancelled"));
});

test("the displayed price reference names the completed candle close, not the fetched time or live quote",()=>{
  const report=globalDesignFixture();report.snapshot.timeframe="1D";report.candles.at(-1)!.ts=Date.parse("2026-10-12T16:00:00Z");report.snapshot.lastCandleTs=report.candles.at(-1)!.ts;report.snapshot.observedAt="2026-10-14T13:05:18.369Z";
  assert.match(globalCompletedPriceLine(report),/last completed 1D close 115.75/);assert.match(globalCompletedPriceLine(report),/bar closed 2026-10-13 16:00 UTC/);assert.doesNotMatch(globalCompletedPriceLine(report),/13:05/);
  report.lang="zh";assert.match(globalCompletedPriceLine(report),/最后完整.*非实时报价/);
});

test("a rejection can touch a coincident trigger/invalidation without fabricating a failed test",()=>{
  const report=globalDesignFixture(),trigger=117.3;
  report.indicators.pivots.push({id:"rejection",ts:report.candles.at(-10)!.ts,confirmedAt:report.candles.at(-9)!.ts,price:trigger,kind:"high"});report.levels.find(l=>l.id==="reclaim")!.anchorIds=["rejection"];
  const tail=report.candles.slice(-8).map(c=>({...c,open:117.2,high:117.25,low:117.1,close:117.2}));tail[6].high=117.31;tail[7].high=117.32;report.candles=[...report.candles.slice(0,-8),...tail];
  const e=globalConfirmationEvidence(report,{side:"short",condition:"rejection",triggerLevelId:"reclaim",invalidationLevelId:"reclaim",referenceStop:117.5});
  assert.equal(e.confirmation?.ts,tail[6].ts);assert.equal(e.retest?.ts,tail[7].ts);assert.equal(e.failure,undefined);
});

test("an initial support test below its floor never qualifies and a later test can rearm an expired attempt",()=>{
  const report=globalDesignFixture();report.paths[0].role="alternative";report.paths[1].role="main";report.paths[1].confirmation="support_hold";
  report.levels.find(l=>l.id==="floor")!.price=116;
  report.indicators.pivots.push({id:"new-support",ts:report.candles.at(-10)!.ts,confirmedAt:report.candles.at(-9)!.ts,price:117.3,kind:"low"});report.levels.find(l=>l.id==="reclaim")!.anchorIds=["new-support"];
  const tail=report.candles.slice(-8).map(c=>({...c,open:117.32,high:117.4,low:117.31,close:117.32}));tail[0].low=115.99;tail[1].low=115.995;report.candles=[...report.candles.slice(0,-8),...tail];report.snapshot.observedAt=new Date(tail[7].ts+3600000).toISOString();
  const fresh=deriveGlobalTradePlan(report);assert.equal(fresh.confirmationTs,null);assert.equal(fresh.retestTs,null);assert.ok(fresh.blockers.includes("confirmation"));
  report.tradePlan={...fresh,state:"avoid",confirmationTs:tail[0].ts,retestTs:tail[1].ts,blockers:["expired","entry_price"]};
  const guarded=globalTradePlan(report);assert.equal(guarded.confirmationTs,null);assert.equal(guarded.retestTs,null);assert.ok(guarded.blockers.includes("cancelled"));assert.ok(!guarded.blockers.includes("expired"));
  tail[0].low=117.2;tail[1].low=117.25;tail[6].low=117.2;
  const rearmed=deriveGlobalTradePlan(report);assert.equal(rearmed.confirmationTs,tail[6].ts);assert.equal(rearmed.retestTs,null);assert.ok(!rearmed.blockers.includes("expired"));assert.ok(rearmed.blockers.includes("retest"));
});

test("a valid old resistance-rejection test outside the lookback remains expired rather than cancelled",()=>{
  const report=globalDesignFixture(),old=report.candles.at(-12)!;
  old.open=117.29;old.close=117.29;old.high=117.31;old.low=117.1;
  report.indicators.pivots.push({id:"old-rejection",ts:report.candles.at(-18)!.ts,confirmedAt:report.candles.at(-15)!.ts,price:117.3,kind:"high"});report.levels.find(l=>l.id==="reclaim")!.anchorIds=["old-rejection"];
  report.candles.slice(-8).forEach(c=>Object.assign(c,{open:117.2,high:117.25,low:117.1,close:117.2}));
  report.tradePlan={...deriveGlobalTradePlan(report),state:"avoid",confirmationTs:old.ts,retestTs:report.candles.at(-11)!.ts,blockers:["expired"]};
  const guarded=globalTradePlan(report);assert.ok(guarded.blockers.includes("expired"));assert.ok(!guarded.blockers.includes("cancelled"));
});
