import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema} from "@pulse/schemas";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";
import {deriveGlobalEntryPlan,globalArtifactReference,globalPlanCandidates,globalTradeCards,globalTradeCandidateCards,globalTradeCardLines,globalReportChartSvg,globalEntryStudySvg,globalHistoricalLevelLines,globalDecision,globalDefaultChartLayers} from "@pulse/domain";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";
import {assessGlobalEntryReport} from "./globalEntryAssessment.js";
import {tradePlanFixture} from "./globalTrade.fixtures.js";

const base=JSON.parse(readFileSync(new URL("./globalReport.oct17-fixtures.json",import.meta.url),"utf8")) as {byFrame:Record<string,number[][]>};
const delta=JSON.parse(readFileSync(new URL("./globalReport.oct17-2116-fixtures.json",import.meta.url),"utf8")) as {additions:Record<string,number[][]>;requests:string[][]};
function replay(frame:string,at:string,version:"decision-v4"|"decision-v5"="decision-v5"){
  const markets=Object.entries(base.byFrame).map(([bar,rows]):SpotMarketContext=>{
    const candles=[...rows,...(delta.additions[bar]??[])].sort((a,b)=>a[0]-b[0]).map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true})).filter(c=>candleCloseTime(c.ts,bar)!<=Date.parse(at)).slice(-520);
    return {source:"okx-public-spot",instId:"BTC-USDT",bar,fetchedAt:at,candles,summary:summarizeCandles(candles),ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:candles.at(-1)!.close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:"0"}};
  });
  return prepareGlobalReport({market:markets.find(m=>m.bar===frame)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:"premium",decisionVersion:version,targetPolicy:"legacy-pivots-v1"});
}
const reports=delta.requests.map(([frame,at])=>replay(frame,at));
test("current reports reject mixed strategy versions and invented historical context references",()=>{
  const r=structuredClone(reports[0]);r.strategy!.version="horizon-v1";assert.equal(GlobalReportSchema.safeParse(r).success,false);
  r.strategy!.version="horizon-v2";r.strategy!.contextLevelIds=["unknown-price-source"];assert.equal(GlobalReportSchema.safeParse(r).success,false);
});
for(const [frame,at,ref] of delta.requests)test(`${frame}: uploaded v4 numeric identity survives the revised method`,()=>{
  const original=replay(frame,at,"decision-v4");assert.equal(globalArtifactReference(original),ref);
});
for(const r of reports)test(`${r.snapshot.timeframe}: a saved watch map keeps ordered references without claiming observed entry prices`,()=>{
  const cards=globalTradeCards(r),txt=globalTradeCardLines(r).join("\n"),svg=globalReportChartSvg(r)!;
  assert.equal(cards.length,1);assert.equal(cards[0].side,r.tradePlan!.side);
  for(const c of cards){assert.equal(c.plan.watchOnly,true);assert.equal(c.plan.referenceEntry,null);assert.equal(c.plan.referenceStop,null);assert.ok(txt.includes(c.entry));assert.ok(txt.includes(c.stop));assert.ok(c.targets.length<=3&&c.targets.length>0);assert.ok(c.targets.every((t,i)=>i===0||(c.side==="long"?1:-1)*(t.price-c.targets[i-1].price)>0));}
  assert.ok(!/CHECKPOINT|OBJECTIVE|WATCH AREA|VIEW CHANGE|NO TRADE|WAIT|EXPIRED|INVALIDATED/.test(svg));
  assert.ok(svg.includes('data-setup-status="unavailable"'));assert.equal((svg.match(/data-scenario-projection=/g)??[]).length,0);
  for(const role of ["Entry","SL"])assert.ok(!globalEntryStudySvg(r)!.includes(`data-entry-price-role="${role}"`));
  assert.ok(globalDefaultChartLayers(r).fibonacci);assert.ok(globalDefaultChartLayers(r).allSmas);assert.ok(globalDefaultChartLayers(r).regression);
  assert.equal(GlobalReportSchema.safeParse(r).success,true);
});
test("weekly reference sequence precedes archive resistance without inventing daily protection before a reaction",()=>{
  const r=reports.find(r=>r.snapshot.timeframe==="1Wutc")!,long=globalTradeCandidateCards(r).find(c=>c.side==="long")!,short=globalTradeCandidateCards(r).find(c=>c.side==="short")!;
  assert.deepEqual(long.targets.map(t=>t.price),[89111,98188.4,108365]);assert.ok(long.targets.every(t=>t.price!==124500));
  assert.ok(long.targets.every(t=>t.source.includes("confirmed swing")&&t.source.includes("1W (UTC)")));assert.equal(long.targets[0].movePercent,null);
  assert.equal(long.plan.referenceStop,null);assert.equal(short.plan.referenceStop,null);
  assert.match(globalHistoricalLevelLines(r).join("\n"),/Historical resistance 124,500.*not a TP/);
  assert.equal(short.riskPercent,null,"No numerical risk without observed protection");
});
test("an unobserved daily reaction cannot claim a numerical entry, stop or reward",()=>{
  const r=reports.find(r=>r.snapshot.timeframe==="1Dutc")!,card=globalTradeCards(r).find(c=>c.side==="long")!;
  assert.equal(card.rr,null);assert.equal(card.confirmed,false);assert.match(card.state,/not established/);assert.equal(card.plan.referenceEntry,null);
  assert.ok(globalTradeCardLines(r).join("\n").includes(card.stop));assert.equal(globalDecision(r).qualified,false);
});
for(const frame of ["15m","1H","4H","1Dutc","1Wutc"])for(const side of ["long","short"] as const)for(const family of ["breakout_retest","reaction"] as const)test(`${frame} ${side} ${family}: real chronological entry evidence can qualify v5`,()=>{
  const {report:r}=tradePlanFixture(frame,side,family),p=deriveGlobalEntryPlan(r);assert.equal(p.state,"confirmed",JSON.stringify(p));assert.equal(p.method,"structure-v5");
  assert.ok(candleCloseTime(p.structureConfirmationTs!,frame)!<=p.confirmationTs!);assert.ok(p.retestTs!>p.confirmationTs!);assert.ok(p.referenceStop);
  assert.equal(GlobalReportSchema.safeParse(r).success,true);assert.ok(globalTradeCards(r)[0].confirmed);
});
test("a fresh lower-frame cross and held retest may rearm after failure while the completed primary gate holds",()=>{
  const {report:r}=tradePlanFixture(),bars=r.entryStudy!.candles;
  for(const [offset,open,high,low,close] of [[4,99,100.8,98.9,100.5],[3,100.5,100.7,98.4,99],[2,99,100.6,98.9,100.4],[1,100.4,100.7,99.98,100.3]])Object.assign(bars[bars.length-offset],{open,high,low,close});
  const p=deriveGlobalEntryPlan(r);assert.equal(p.state,"confirmed",JSON.stringify(p));assert.equal(p.confirmationTs,bars.at(-2)!.ts);assert.equal(p.retestTs,bars.at(-1)!.ts);
});
test("failed primary context still blocks lower-frame entry",()=>{
  const {report:r}=tradePlanFixture();for(const c of r.candles.slice(-2))Object.assign(c,{open:99,high:99.5,low:98.5,close:99});
  assert.notEqual(deriveGlobalEntryPlan(r).state,"confirmed");
});
test("recheck and saved plan retain the same observed prices and trading timeframe",()=>{
  const {report,market,entry,context}=tradePlanFixture(),p=report.tradePlan!,a=assessGlobalEntryReport(report,market,context,entry);
  assert.equal(a.state,"technical_valid",JSON.stringify(a));assert.deepEqual(a.permittedEntry,p.referenceEntry);assert.equal(a.observedStop,p.referenceStop);assert.deepEqual(a.targets,[110]);
});
test("range plans never include entry prices inside the SL allowance",()=>{
  const {report:r}=tradePlanFixture();
  for(const c of globalTradeCards(r)){const p=c.plan;assert.ok(p.referenceEntry&&p.referenceStop);assert.ok(c.side==="long"?p.referenceStop<p.referenceEntry[0]:p.referenceStop>p.referenceEntry[1],"The entire observed band stays on the protected side of SL");}
});

test("an opposite-side drawing option cannot publish a second setup",()=>{
  const {report:r}=tradePlanFixture(),card=globalTradeCards(r)[0],other="unpublished-opposite-plan";
  const svg=globalReportChartSvg(r,{selectedPathId:other})!,inset=globalEntryStudySvg(r,660,other)!;
  assert.ok(svg.includes(`data-trade-plan="${card.key}"`));
  assert.ok(inset.includes(`data-entry-price-role="SL" data-price="${card.plan.referenceStop}"`),"Entry inset follows the selected trade");
  assert.ok(svg.includes(`data-trade-role="SL" data-price="${card.plan.referenceStop}"`));
});

test("the saved selected plan controls the single headline, chart and conditional projection",()=>{
  const r=structuredClone(reports.find(r=>r.snapshot.timeframe==="1H")!);
  const main=r.paths.find(p=>p.role==="main")!;
  r.hierarchy!.find(row=>row.timeframe===r.snapshot.timeframe)!.bias=main.direction==="up"?"up":"down";
  const alternative=globalTradeCandidateCards(r).find(c=>c.side===(main.direction==="up"?"short":"long"))!;
  r.tradePlan=alternative.plan;
  for(const lang of ["en","zh"] as const){
    r.lang=lang;const d=globalDecision(r),svg=globalReportChartSvg(r)!;
    assert.equal(d.qualified,false);assert.equal(d.direction,alternative.side==="long"?"LONG":"SHORT");
    assert.ok(svg.includes('data-setup-status="unavailable"'));
    assert.ok(svg.includes(d.heading));assert.ok(!svg.includes('data-scenario-projection="conditional"'));assert.equal(globalTradeCards(r).length,1);
  }
});

test("124,500 is an input Fibonacci anchor and past Elliott label, not a calculated future TP",()=>{
  const r=reports.find(r=>r.snapshot.timeframe==="1Wutc")!,zero=r.indicators.fibonacci.find(f=>f.ratio===0)!;
  const high=r.indicators.pivots.find(a=>a.price===124500)!;
  assert.equal(zero.price,high.price);assert.ok(zero.anchorIds.includes(high.id));
  assert.ok(r.waveCount.anchors.some(a=>a.id===high.id&&a.label==="5"&&a.ts<Date.parse(r.snapshot.observedAt)));
  assert.ok(!r.levels.some(l=>l.basis==="extension"&&l.price===high.price));
  assert.ok(globalTradeCards(r).every(c=>c.targets.every(t=>t.price!==high.price)));
  const svg=globalReportChartSvg(r)!;assert.ok(!svg.includes("124,500"));assert.ok(!svg.includes('data-fib-ratio="0"'));assert.ok(!svg.includes('data-fib-ratio="1"'));assert.ok(svg.includes('data-fib-ratio="0.382"'));
});
