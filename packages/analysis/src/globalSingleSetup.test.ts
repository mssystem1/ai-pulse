import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema,type GlobalReport} from "@pulse/schemas";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";
import {globalTradeCards,globalDecision,globalWavePhase,globalWaveExplanationLines,globalReportChartSvg,globalEntryStudySvg,globalTradeCardLines,selectSingleGlobalSetup} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {assessGlobalEntryReport} from "./globalEntryAssessment.js";
import {reviewGlobalTargetReport} from "./globalTradeMap.js";

const publicData=JSON.parse(readFileSync(new URL("./globalTargets.oct18-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const historic=JSON.parse(readFileSync(new URL("./globalReport.oct17-fixtures.json",import.meta.url),"utf8")) as {byFrame:Record<string,number[][]>};
function markets(rows:Record<string,number[][]>,at:string):SpotMarketContext[]{return Object.entries(rows).map(([bar,data])=>{
  const candles=data.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)!<=Date.parse(at));
  return {source:"okx-public-spot",instId:"BTC-USDT",bar,fetchedAt:at,candles,summary:summarizeCandles(candles),ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:candles.at(-1)!.close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:"0"}};
});}
const current=markets(publicData.frames,publicData.observedAt),old=markets(historic.byFrame,"2026-10-17T21:16:00Z");
function make(frame:string,tier:"base"|"premium"="premium",lang:"en"|"zh"="en",legacy=false){const data=["1Dutc","1Wutc"].includes(frame)?current:old;return prepareGlobalReport({market:data.find(m=>m.bar===frame)!,contextMarket:data.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:data,tier,lang,...(legacy?{targetPolicy:"legacy-pivots-v1" as const}:{})});}

for(const frame of ["15m","1H","4H","1Dutc","1Wutc"])test(`${frame}: Quick, Pro and both languages publish the same single strategy`,()=>{
  const reports=(["base","premium"] as const).flatMap(tier=>(["en","zh"] as const).map(lang=>make(frame,tier,lang)));
  const expected=reports[0].setupSelection!;
  for(const r of reports){
    const selection=r.setupSelection!,cards=globalTradeCards(r),d=globalDecision(r),svg=globalReportChartSvg(r)!;
    assert.deepEqual([selection.assessment,selection.rule,selection.pathId,selection.side],[expected.assessment,expected.rule,expected.pathId,expected.side]);
    assert.ok(["LONG","SHORT","SIDEWAYS"].includes(d.direction));assert.equal(r.paths.length,cards.length);assert.equal(r.strategy!.routes.length,cards.length);assert.ok(cards.length<=1);assert.equal(GlobalReportSchema.safeParse(r).success,true);
    const drawable=cards.filter(c=>c.plan.referenceEntry&&c.plan.referenceStop);
    assert.equal((svg.match(/data-trade-price-ledger=/g)??[]).length,drawable.length);
    assert.equal((svg.match(/data-scenario-projection=/g)??[]).length,drawable.length);
    for(const card of cards){
      assert.ok(r.tradePlan!.side==="none"||card.side===r.tradePlan!.side);assert.equal(card.pathId,selection.pathId);assert.ok(globalTradeCardLines(r).includes(card.lines[0]));
      if(!card.plan.referenceEntry||!card.plan.referenceStop)continue;
      const inset=globalEntryStudySvg(r)!;assert.ok(inset.includes(`data-entry-price-role="SL" data-price="${card.plan.referenceStop}"`));
      for(const [i,target] of card.targets.entries())assert.ok(svg.includes(`data-trade-role="TP${i+1}" data-price="${target.price}"`));
    }
  }
});

test("reported weekly bars select a recovery LONG; historical C is not an opposing current forecast",()=>{
  const r=make("1Wutc");assert.equal(r.snapshot.price,83760.4);assert.equal(r.setupSelection!.side,"long");assert.equal(r.setupSelection!.rule,"structural_reversal");assert.equal(globalWavePhase(r).recovered,true);
  assert.ok(r.setupSelection!.evidence.some(l=>l.includes("82,842")));assert.ok(r.setupSelection!.limitations.some(l=>l.includes("SMA55 has not turned")));
  assert.match(globalWaveExplanationLines(r).join("\n"),/current hypothesis is post-C recovery/);assert.ok(!globalWaveExplanationLines(r).some(l=>l.includes("current candidate C? leg: down")));
  assert.equal(globalTradeCards(r).length,1);assert.equal(globalTradeCards(r)[0].side,"long");assert.equal(globalTradeCards(r)[0].confirmed,false);
});
test("reported daily bars select a downward reversal before comparing any candidate reward",()=>{
  const r=make("1Dutc");assert.equal(r.snapshot.price,81489.4);assert.equal(r.setupSelection!.side,"short");assert.equal(r.setupSelection!.rule,"structural_reversal");
  assert.equal(globalTradeCards(r).length,1);assert.equal(globalTradeCards(r)[0].side,"short");assert.ok(!globalTradeCards(r)[0].targets.some(t=>t.price===82473.6));
});
test("trend direction cannot switch merely because the opposite candidate offers better reward",()=>{
  const r=make("1H","premium","en",true);delete r.range;
  const primary=r.hierarchy!.find(row=>row.timeframe===r.snapshot.timeframe)!;primary.structure="up";
  const fast=r.indicators.sma.find(s=>s.period===55)!;fast.points=Array.from({length:12},(_,i)=>({ts:i,value:r.snapshot.price!-200+i}));
  const selected=selectSingleGlobalSetup(r);assert.equal(selected.selection.assessment,"long");assert.equal(selected.selection.rule,"trend_continuation");assert.equal(selected.selection.side,"long");
  primary.structure="down";fast.points=fast.points.map((p,i)=>({...p,value:r.snapshot.price!+200-i}));
  assert.equal(selectSingleGlobalSetup(r).selection.assessment,"short");
});
test("sideways watches one floor or ceiling reaction; the centre retains a watch plan without forcing a trade",()=>{
  const r=make("4H","premium","en",true),range=r.range!,last=r.candles.at(-1)!;
  r.indicators.rsi.points=r.indicators.rsi.points.map(p=>({...p,value:50}));
  const put=(close:number)=>{Object.assign(last,{open:close,high:close+1,low:close-1,close});r.entryStudy!.candles.at(-1)!.close=close;};
  put(range.lower[1]+(range.upper[0]-range.lower[1])*.2);let s=selectSingleGlobalSetup(r);assert.equal(s.selection.assessment,"sideways");assert.equal(s.selection.side,"long");assert.equal(s.selection.rule,"range_reaction");assert.notEqual(s.plan.state,"confirmed");
  put(range.lower[1]+(range.upper[0]-range.lower[1])*.8);s=selectSingleGlobalSetup(r);assert.equal(s.selection.assessment,"sideways");assert.equal(s.selection.side,"short");
  put((range.lower[1]+range.upper[0])/2);s=selectSingleGlobalSetup(r);assert.equal(s.selection.assessment,"sideways");assert.notEqual(s.selection.side,"none");assert.notEqual(s.plan.state,"confirmed");assert.ok(s.selection.limitations.some(l=>l.includes("Watch only")));
  put(range.upper[1]+1000);r.hierarchy!.find(row=>row.timeframe===r.snapshot.timeframe)!.structure="mixed";r.indicators.sma.forEach(ma=>ma.points.forEach(p=>p.value=last.close));
  s=selectSingleGlobalSetup(r);assert.notEqual(s.selection.regime,"range");assert.equal(s.selection.side,"none");
});
test("the schema rejects publishing a second setup or a side inconsistent with the selection",()=>{
  const r=make("1Wutc");r.paths.push({...r.paths[0],id:"second"});assert.equal(GlobalReportSchema.safeParse(r).success,false);
  const opposite=make("1Wutc");opposite.setupSelection!.side="short";assert.equal(GlobalReportSchema.safeParse(opposite).success,false);
});
test("a fresh recheck blocks a changed strategy without replacing the saved direction",()=>{
  const r=make("1Wutc"),before=JSON.stringify(r),market=structuredClone(current.find(m=>m.bar==="1Wutc")!),last=market.candles.at(-1)!;
  market.candles.push({...last,ts:last.ts+604800000,open:60000,high:61000,low:49000,close:50000});market.fetchedAt=new Date(Date.parse(market.fetchedAt)+604800000).toISOString();
  const result=assessGlobalEntryReport(r,market,current.find(m=>m.bar==="1Mutc"),current.find(m=>m.bar==="1Dutc"));
  assert.equal(result.state,"no_trade");assert.ok(result.blockers.includes("strategy_changed"));assert.notEqual(result.side,"short");assert.equal(r.setupSelection!.side,"long");assert.equal(JSON.stringify(r),before);
});

const breakSource=JSON.parse(readFileSync(new URL("./globalSingleSetup.break-fixture.json",import.meta.url),"utf8")) as typeof publicData;
function breakReport(mirror=false){
  const rows=structuredClone(breakSource.frames);
  if(mirror)for(const frame of Object.values(rows))for(const row of frame){const [o,h,l,c]=row.slice(1,5);row.splice(1,4,160000-o,160000-l,160000-h,160000-c);}
  const frames=markets(rows,breakSource.observedAt);
  return prepareGlobalReport({market:frames.find(m=>m.bar==="1H")!,contextMarket:frames.find(m=>m.bar==="4H"),hierarchyMarkets:frames,tier:"premium"});
}
for(const mirror of [false,true])test(`${mirror?"bullish":"bearish"} break: confirmed close overrides the stale opposite pivot sequence, with MA55 and RSI evidence`,()=>{
  const r=breakReport(mirror);assert.equal(r.setupSelection!.rule,"structure_break");assert.equal(r.setupSelection!.side,mirror?"long":"short");assert.equal(globalTradeCards(r).length,1);
  assert.equal(globalTradeCards(r)[0].targets[0].price,mirror?160000-80809.5:80809.5,"The nearby genuine swing remains TP1 even when used by Fibonacci");
  assert.ok(r.setupSelection!.limitations.some(l=>l.includes("SMA21 has not turned")));assert.equal(GlobalReportSchema.safeParse(r).success,true);
  const neutral=structuredClone(r);neutral.indicators.rsi.points.at(-1)!.value=50;assert.notEqual(selectSingleGlobalSetup(neutral).selection.rule,"structure_break","A price break without the momentum condition is insufficient");
});
test("a v1 report with discarded paths can be reviewed from saved bars, without mutation or another market/model call",()=>{
  const original=breakReport();original.paths=[];original.view.pathIds=[];original.strategy!.routes=[];
  original.setupSelection={version:"single-setup-v1",assessment:"sideways",regime:"transition",rule:"none",pathId:null,side:"none",evidence:[],limitations:[]};
  original.tradePlan={side:"none",pathId:null,state:"none",condition:"close_retest",triggerLevelId:null,invalidationLevelId:null,targetIds:[],referenceEntry:null,referenceStop:null,grossRewardRisk:null,stopBufferAtr:.1,confirmationTs:null,retestTs:null,blockers:["levels"],method:"structure-v5",entryTimeframe:"15m"};
  assert.equal(GlobalReportSchema.safeParse(original).success,true);const before=JSON.stringify(original),review=reviewGlobalTargetReport(original);
  assert.equal(JSON.stringify(original),before);assert.equal(review.setupSelection!.version,"single-setup-v3");assert.equal(review.setupSelection!.side,"short");assert.equal(review.paths.length,1);assert.deepEqual(review.candles,original.candles);assert.equal(reviewGlobalTargetReport(review),review);
});
test("a planned range stop protects the full known boundary rather than a minor pivot inside its zone",()=>{
  const frames=markets(breakSource.frames,breakSource.observedAt),market=frames.find(m=>m.bar==="4H")!;
  const r=prepareGlobalReport({market,hierarchyMarkets:frames,tier:"premium"}),p=r.tradePlan!;
  assert.equal(r.setupSelection!.assessment,"sideways");assert.equal(p.side,"long");assert.equal(p.retestTs,null);assert.ok(p.referenceStop!<r.range!.lower[0]);assert.ok(p.grossRewardRisk!<15);
});
