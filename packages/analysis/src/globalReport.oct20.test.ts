import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GlobalReportSchema,candleCloseTime} from "@pulse/schemas";
import {globalDecision,globalTradeCards,globalReportChartSvg,globalEntryStudySvg,globalSections} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";

const fixture=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:"BTC-USDT",source:"okx-public-spot",fetchedAt:fixture.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
function make(frame:string,tier:"base"|"premium"="premium",lang:"en"|"zh"="en"){
  const cutoffs:Record<string,string>={"1H":"2026-10-20T17:42:42.267Z","4H":"2026-10-20T17:40:51.719Z","1Dutc":"2026-10-20T17:38:13.365Z","1Wutc":"2026-10-20T17:44:09.991Z"};
  const frames=markets.map(m=>({...m,fetchedAt:cutoffs[frame]}));
  return prepareGlobalReport({market:frames.find(m=>m.bar===frame)!,contextMarket:frames.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:frames,tier,lang});
}

test("Oct 20 1H: the lookback cannot erase older unconsumed resistance and leave a LONG without a plan",()=>{
  const r=make("1H"),card=globalTradeCards(r)[0];
  assert.equal(r.snapshot.price,82770.1);assert.equal(r.setupSelection!.assessment,"long");
  assert.equal(card.side,"long");assert.equal(card.targets[0].price,83858.2);
  assert.ok(card.plan.referenceEntry);assert.ok(card.plan.referenceStop);
  assert.equal(card.confirmed,false);assert.equal(globalDecision(r).currentAction,"WAIT");
  const oldest=r.candles.at(-r.strategy!.lookbackBars)!.ts;
  assert.ok(r.indicators.pivots.some(p=>p.ts<oldest&&r.levels.find(l=>l.id===card.targets[0].id)!.anchorIds.includes(p.id)));
});

test("Oct 20 4H: a middle-of-range price cannot manufacture a short entry with a 24R claim",()=>{
  const r=make("4H"),cards=globalTradeCards(r),d=globalDecision(r);
  assert.equal(r.snapshot.price,82610.4);assert.equal(d.direction,"SIDEWAYS");assert.equal(cards.length,0);
  assert.equal(r.tradePlan!.referenceEntry,null);assert.equal(r.tradePlan!.referenceStop,null);assert.equal(r.tradePlan!.grossRewardRisk,null);
  assert.equal(d.currentAction,"WAIT");assert.match(d.route,/80,680.50–81,200.00/);assert.match(d.route,/84,147.10–84,166.30/);
  assert.match(globalReportChartSvg(r)!,/data-setup-status="unavailable"/);
});

test("Oct 20 daily: old support is not a justified entry; newer 4H structure has no later completed retest",()=>{
  const r=make("1Dutc"),svg=globalReportChartSvg(r)!;
  assert.equal(r.snapshot.price,81943.8);assert.equal(r.entryStudy!.candles.at(-1)!.close,82610.4);
  assert.equal(r.range!.lower[1],80400);assert.equal(r.tradePlan!.referenceEntry,null);assert.equal(r.tradePlan!.referenceStop,null);
  const support=r.indicators.pivots.find(a=>a.kind==="low"&&a.price===80400)!;
  assert.equal(new Date(support.ts).toISOString(),"2026-10-08T00:00:00.000Z");
  const low=r.entryStudy!.pivots.find(a=>a.kind==="low"&&a.price===81200)!;
  assert.equal(candleCloseTime(low.confirmedAt!,"4H"),Date.parse("2026-10-20T16:00:00Z"));
  const high=r.entryStudy!.pivots.find(a=>a.kind==="high"&&a.price===82291.1)!;
  const reclaimed=r.entryStudy!.candles.filter(c=>c.ts>high.ts&&c.close>high.price).at(-1)!;
  assert.equal(reclaimed.ts,r.entryStudy!.candles.at(-1)!.ts,"No later completed retest exists after this local reclaim");
  assert.ok(r.entryStudy!.pivots.some(a=>a.kind==="high"&&a.price===83168.2&&a.confirmedAt!==null));
  assert.equal(globalDecision(r).currentAction,"WAIT");assert.equal(globalTradeCards(r).length,0);
  assert.doesNotMatch(svg,/data-scenario-projection=/);assert.match(svg,/NO VALIDATED ENTRY/);
  assert.match(r.setupSelection!.evidence.join(' '),/81,200 \(higher low\).*83,168.2/);
  assert.match(globalSections(r).flatMap(s=>s.lines).join(' '),/reclaimed 82,291.10.*No later completed candle exists/);
  assert.doesNotMatch(svg,/PULSE · GLOBAL[^<]*#[0-9a-f]{8}/);
});

test("Oct 20 weekly: a recovery bias without confirmation cannot claim an entry, stop or measured reward",()=>{
  const r=make("1Wutc"),card=globalTradeCards(r)[0];
  assert.equal(r.snapshot.price,82109.3);assert.equal(card.plan.watchOnly,true);
  assert.equal(card.plan.referenceEntry,null);assert.equal(card.plan.referenceStop,null);assert.equal(card.plan.grossRewardRisk,null);assert.equal(card.confirmed,false);
  assert.doesNotMatch(globalReportChartSvg(r)!,/data-scenario-projection=/);
  assert.equal(globalDecision(r).currentAction,"WAIT");
  const invented=structuredClone(r);invented.tradePlan!.referenceEntry=[82842,83049.14];
  assert.equal(GlobalReportSchema.safeParse(invented).success,false,"A watch label cannot legalize invented numerical entry evidence");
});

for(const frame of ["1H","4H","1Dutc","1Wutc"])test(`Oct 20 ${frame}: all tiers/languages distinguish a map from an observed setup`,()=>{
  const baseline=make(frame);
  for(const tier of ["base","premium"] as const)for(const lang of ["en","zh"] as const){
    const r=make(frame,tier,lang),cards=globalTradeCards(r),svg=globalReportChartSvg(r)!,study=globalEntryStudySvg(r)!;
    assert.equal(GlobalReportSchema.safeParse(r).success,true);assert.equal(cards.length,globalTradeCards(baseline).length);
    assert.deepEqual(r.tradePlan,baseline.tradePlan);assert.equal(r.setupSelection!.version,"single-setup-v4");
    assert.doesNotMatch(svg,/data-scenario-projection=/);assert.doesNotMatch(svg,/NaN|undefined/);
    if(r.tradePlan!.referenceStop!==null)assert.ok(study.includes(`data-entry-price-role="SL" data-price="${r.tradePlan!.referenceStop}"`));
    else assert.doesNotMatch(study,/data-entry-price-role="SL"/);
    const text=globalSections(r).flatMap(s=>s.lines).join("\n");assert.doesNotMatch(text,/#[0-9a-f]{8}/);
    if(cards[0])assert.ok(text.includes(cards[0].location));else assert.ok(text.includes(r.setupSelection!.limitations[0]));
  }
});

test("a v3 saved report gets a free v4 technical review from the same candles, without changing its source",()=>{
  const original=make("1H");original.setupSelection!.version="single-setup-v3";
  const before=JSON.stringify(original),review=reviewGlobalTargetReport(original);
  assert.equal(JSON.stringify(original),before);assert.deepEqual(review.candles,original.candles);
  assert.deepEqual(review.snapshot,original.snapshot);assert.equal(review.setupSelection!.version,"single-setup-v4");
  assert.equal(reviewGlobalTargetReport(review),review);assert.equal(globalTradeCards(review).length,1);
});
