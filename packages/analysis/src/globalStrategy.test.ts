import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";
import {deriveGlobalEntryPlan,globalStrategyProfile,globalTradePlan,globalPlanCandidates,globalDecision,globalReportChartSvg,globalDefaultChartLayers,globalStructuralWindow,globalStrategyLines,reviewGlobalOrder} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe,globalWilderIndicators} from "./globalReport.js";
import {assessGlobalEntryReport} from "./globalEntryAssessment.js";
import {strategyFixture} from "./globalStrategy.fixtures.js";

const data=JSON.parse(readFileSync(new URL("./globalReport.oct17-fixtures.json",import.meta.url),"utf8")) as {byFrame:Record<string,number[][]>;requests:string[][]};
function replay(frame:string,cutoff=(data.requests.find(r=>r[0]===frame)??data.requests[0])[1]){
  const markets=Object.entries(data.byFrame).map(([bar,rows]):SpotMarketContext=>{
    const candles=rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)!<=Date.parse(cutoff));
    return {source:"okx-public-spot",instId:"BTC-USDT",bar,fetchedAt:cutoff,candles,summary:summarizeCandles(candles),ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:candles.at(-1)!.close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:"0"}};
  });
  return prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium"});
}
const profiles=[["15m","fast","5m",96],["1H","intraday","15m",120],["4H","swing","1H",180],["1Dutc","position","4H",260],["1Wutc","macro","1Dutc",520]] as const;
for(const [frame,id,entry,lookback] of profiles){
  test(`${frame}: strategy, timing and structural scope match the requested product profile`,()=>{
    const p=globalStrategyProfile(frame)!;assert.equal(p.id,id);assert.equal(p.entryTimeframe,entry);assert.equal(p.lookbackBars,lookback);
  });
  for(const side of ["long","short"] as const)for(const family of ["breakout_retest","reaction"] as const)test(`${frame} ${side} ${family}: primary confirmation then entry evidence can qualify`,()=>{
    const {report:r}=strategyFixture(frame,side,family),p=deriveGlobalEntryPlan(r);
    assert.equal(p.state,"confirmed",JSON.stringify(p));assert.equal(p.strategyId,id);assert.equal(p.entryTimeframe,entry);assert.ok(p.structureConfirmationTs);
    assert.ok(candleCloseTime(p.structureConfirmationTs!,frame)!<=p.confirmationTs!);assert.ok(p.retestTs!>p.confirmationTs!);
    assert.ok(side==="long"?p.referenceStop!<98:p.referenceStop!>102,"Protection clears primary structure, not just the entry reaction");
    r.tradePlan=p;assert.equal(GlobalReportSchema.safeParse(r).success,true,JSON.stringify(GlobalReportSchema.safeParse(r)));
    assert.deepEqual(globalTradePlan(r),p);
  });
}
test("lower-frame breakout and retest alone cannot qualify a daily position setup",()=>{
  const {report:r}=strategyFixture("1Dutc");
  for(const c of r.candles.slice(-2))Object.assign(c,{open:99,high:99.5,low:98.5,close:99});
  const p=deriveGlobalEntryPlan(r);assert.notEqual(p.state,"confirmed");assert.equal(p.structureConfirmationTs,null);assert.ok(p.blockers.includes("confirmation"));
});
test("an unfinished primary breakout cannot qualify entry before its close",()=>{
  const {report:r}=strategyFixture("1Dutc");
  Object.assign(r.candles.at(-2)!,{open:99,high:99.5,low:98.5,close:99});
  const p=deriveGlobalEntryPlan(r);assert.equal(p.structureConfirmationTs,null);assert.notEqual(p.state,"confirmed");
});
test("a failed attempt cannot reuse its old primary confirmation",()=>{
  const {report:r}=strategyFixture();
  const bars=r.entryStudy!.candles;
  Object.assign(bars.at(-2)!,{open:100.5,high:100.7,low:98.4,close:99});
  Object.assign(bars.at(-1)!,{open:99,high:100.6,low:99,close:100.4});
  const p=deriveGlobalEntryPlan(r);assert.equal(p.structureConfirmationTs,null);assert.equal(p.confirmationTs,null);assert.notEqual(p.state,"confirmed");assert.ok(p.blockers.includes("cancelled"));
});
test("daily position objectives and checkpoints retain different roles without manufacturing reward",()=>{
  const r=replay("1Dutc"),route=r.strategy!.routes.find(r=>r.side==="long")!,price=(id:string)=>r.levels.find(l=>l.id===id)!.price;
  assert.deepEqual(route.objectiveIds.map(price),[87399]);
  assert.ok(route.checkpointIds.map(price).includes(82556.6));assert.ok(route.checkpointIds.map(price).includes(84361.6));
  const buy=globalPlanCandidates(r).find(p=>p.side==="long")!;
  assert.ok(buy.grossRewardRisk!>1.5);assert.ok(buy.firstObstacleRewardRisk!<1.5);assert.ok(buy.blockers.includes("reward"));assert.equal(globalDecision(r).qualified,false);
  assert.ok(!route.objectiveIds.map(price).some(p=>p>=120000));assert.ok(globalStructuralWindow(r)>=260);
  const svg=globalReportChartSvg(r)!;assert.ok(svg.includes("CHECKPOINT"));assert.ok(svg.includes("POSITION OBJ"));
  for(const id of route.checkpointIds)assert.ok(svg.includes(`data-level-id="${id}"`),"Both visible directions retain checkpoints");
  assert.ok(globalStrategyLines(r).join("\n").includes("weeks to months"));
});
test("macro objectives may use a confirmed major weekly swing beyond the old local four-ATR cap",()=>{
  const r=replay("1Wutc"),buy=r.strategy!.routes.find(r=>r.side==="long")!;
  assert.ok(buy.objectiveIds.length);assert.ok(buy.objectiveIds.some(id=>r.levels.find(l=>l.id===id)!.price===124500));
  const svg=globalReportChartSvg(r)!;assert.ok(svg.includes("124,500.00"));assert.ok(svg.includes("MACRO"));
  const protection=r.levels.find(l=>l.id===buy.protectionLevelId)!;assert.equal(protection.price,57809.4);
  const p=globalPlanCandidates(r).find(p=>p.side==="long")!;assert.ok(p.referenceStop!<57809.4);assert.ok(p.blockers.includes("reward"),"A tight minor stop cannot manufacture macro entry reward");
});
for(const [frame] of profiles)test(`${frame}: defaults and price ordering remain coherent`,()=>{
  const r=replay(frame);assert.equal(r.decisionVersion,"decision-v4");assert.equal(GlobalReportSchema.safeParse(r).success,true);
  const defaults=globalDefaultChartLayers(r);assert.equal(defaults.allSmas,true);assert.equal(defaults.regression,true);assert.equal(defaults.fibonacci,true);
  for(const route of r.strategy!.routes){const sign=route.side==="long"?1:-1,prices=route.objectiveIds.map(id=>r.levels.find(l=>l.id===id)!.price);assert.ok(prices.every((p,i)=>i===0||sign*(p-prices[i-1])>0));assert.ok(route.checkpointIds.every(id=>!route.objectiveIds.includes(id)));}
  assert.ok(!/NaN|Infinity|WAIT|EXPIRED|INVALIDATED|NO TRADE/.test(globalReportChartSvg(r)!));
});
test("recheck preserves the saved route, primary-scale protection and signal geometry",()=>{
  const {report,market,entry,context}=strategyFixture();
  const a=assessGlobalEntryReport(report,market,context,entry),p=report.tradePlan!;
  assert.equal(a.state,"technical_valid",JSON.stringify(a));assert.deepEqual(a.permittedEntry,p.referenceEntry);assert.equal(a.observedStop,p.referenceStop);assert.equal(a.structureConfirmationTs,p.structureConfirmationTs);assert.equal(a.strategyId,"swing");
});
test("fresh primary evidence can supply confirmation missing in the purchased report",()=>{
  const {report,market,entry,context}=strategyFixture(),saved=structuredClone(report);
  saved.candles=saved.candles.slice(0,-2);saved.indicators.atr.points=globalWilderIndicators(saved.candles).atr;saved.tradePlan=deriveGlobalEntryPlan(saved);
  assert.notEqual(saved.tradePlan.state,"confirmed");
  const a=assessGlobalEntryReport(saved,market,context,entry);assert.equal(a.state,"technical_valid",JSON.stringify(a));assert.equal(a.structureConfirmationTs,report.tradePlan!.structureConfirmationTs);
});
test("a distant strategy objective cannot bypass the quote's nearest-checkpoint net reward gate",()=>{
  const {report,market,entry,context}=strategyFixture(),a=assessGlobalEntryReport(report,market,context,entry),now=Date.parse(a.assessedAt);
  a.checkpointTargets=[100.8];
  const q={observedAt:now,expiresAt:now+20000,entry:100.35,quantity:1,roundTripLoss:0,networkFees:0,slippageBps:0,inputBalanceSufficient:true,representationVerified:true,currencyVerified:true};
  const review=reviewGlobalOrder(a,q,now);assert.equal(review.takeProfit,110);assert.ok(review.blockers.includes("net_reward"));assert.equal(review.state,"blocked");
});
test("schema rejects primary confirmation dated after its entry confirmation",()=>{
  const {report:r}=strategyFixture();r.tradePlan!.structureConfirmationTs=r.candles.at(-1)!.ts;
  assert.equal(GlobalReportSchema.safeParse(r).success,false);
});

test("future primary ATR cannot revise an already observed protective stop",()=>{
  const {report:r}=strategyFixture(),before=deriveGlobalEntryPlan(r);
  r.indicators.atr.points.at(-1)!.value=1000;
  const after=deriveGlobalEntryPlan(r);assert.equal(after.referenceStop,before.referenceStop);assert.equal(after.retestTs,before.retestTs);
});
test("a major protection swing confirmed after the entry cannot be used retrospectively",()=>{
  const {report:r}=strategyFixture();r.indicators.pivots.find(a=>a.id==="floor-anchor")!.confirmedAt=r.candles.at(-1)!.ts;
  const p=deriveGlobalEntryPlan(r);assert.notEqual(p.state,"confirmed");assert.equal(p.structureConfirmationTs,null);
});
test("schema rejects an intraday label on a position chart and TP/checkpoint overlap",()=>{
  const r=replay("1Dutc"),wrong=structuredClone(r);wrong.strategy!.id="intraday";
  assert.equal(GlobalReportSchema.safeParse(wrong).success,false);
  r.strategy!.routes[0].checkpointIds.push(r.strategy!.routes[0].objectiveIds[0]);assert.equal(GlobalReportSchema.safeParse(r).success,false);
});
