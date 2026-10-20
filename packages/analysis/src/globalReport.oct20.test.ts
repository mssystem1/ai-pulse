import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GlobalReportSchema} from "@pulse/schemas";
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

test("Oct 20 4H: SIDEWAYS retains one conditional boundary setup in the middle of the range",()=>{
  const r=make("4H"),cards=globalTradeCards(r),d=globalDecision(r);
  assert.equal(r.snapshot.price,82610.4);assert.equal(d.direction,"SIDEWAYS");assert.equal(cards.length,1);
  assert.ok(cards[0].plan.referenceEntry);assert.ok(cards[0].plan.referenceStop);assert.ok(cards[0].targets.length);
  assert.equal(cards[0].confirmed,false);assert.equal(d.currentAction,"WAIT");assert.match(cards[0].state,/Watch only/);
});

test("Oct 20 daily: the remote 80400 support entry is conditional on a 2.57% revisit, never a drop-and-rally forecast",()=>{
  const r=make("1Dutc"),card=globalTradeCards(r)[0],svg=globalReportChartSvg(r)!;
  assert.equal(r.snapshot.price,81943.8);assert.equal(r.entryStudy!.candles.at(-1)!.close,82610.4);
  assert.equal(card.plan.referenceEntry![0],80400);assert.match(card.location,/2\.57% below/);
  assert.match(card.location,/same SL\/TP1 gives 0\.60R before costs/);
  assert.match(card.location,/may never return/);assert.match(card.state,/Watch only/);
  assert.equal(globalDecision(r).currentAction,"WAIT");assert.equal(card.confirmed,false);
  assert.match(svg,/data-projection-origin="entry"/);assert.match(svg,/ONLY AFTER ENTRY/);
  assert.doesNotMatch(svg,/PULSE · GLOBAL[^<]*#[0-9a-f]{8}/);
});

test("Oct 20 weekly: improved presentation cannot qualify the existing 1.25R plan",()=>{
  const r=make("1Wutc"),card=globalTradeCards(r)[0];
  assert.equal(r.snapshot.price,82109.3);assert.ok(card.plan.grossRewardRisk!<1.5);
  assert.ok(card.plan.blockers.includes("reward"));assert.equal(card.confirmed,false);
  assert.equal(globalDecision(r).currentAction,"WAIT");
});

for(const frame of ["1H","4H","1Dutc","1Wutc"])test(`Oct 20 ${frame}: Quick/Pro and EN/ZH retain one consistent plan in chart, entry study and text`,()=>{
  const baseline=make(frame);
  for(const tier of ["base","premium"] as const)for(const lang of ["en","zh"] as const){
    const r=make(frame,tier,lang),cards=globalTradeCards(r),svg=globalReportChartSvg(r)!,study=globalEntryStudySvg(r)!;
    assert.equal(GlobalReportSchema.safeParse(r).success,true);assert.equal(cards.length,1);
    assert.deepEqual(r.tradePlan,baseline.tradePlan);assert.equal(r.setupSelection!.version,"single-setup-v3");
    assert.match(svg,/data-projection-origin="entry"/);assert.doesNotMatch(svg,/NaN|undefined/);
    assert.ok(study.includes(`data-entry-price-role="SL" data-price="${r.tradePlan!.referenceStop}"`));
    const text=globalSections(r).flatMap(s=>s.lines).join("\n");assert.doesNotMatch(text,/#[0-9a-f]{8}/);
    assert.ok(text.includes(cards[0].location));
  }
});

test("a v2 saved report gets a free v3 technical review from the same candles, without changing its source",()=>{
  const original=make("1H");original.setupSelection!.version="single-setup-v2";
  const before=JSON.stringify(original),review=reviewGlobalTargetReport(original);
  assert.equal(JSON.stringify(original),before);assert.deepEqual(review.candles,original.candles);
  assert.deepEqual(review.snapshot,original.snapshot);assert.equal(review.setupSelection!.version,"single-setup-v3");
  assert.equal(reviewGlobalTargetReport(review),review);assert.equal(globalTradeCards(review).length,1);
});
