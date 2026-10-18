import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {candleCloseTime,GlobalReportSchema,type GlobalReport,type GlobalAnchor} from "@pulse/schemas";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";
import {globalTradeCards,globalTradeCandidateCards,globalReportChartSvg,globalTradeCardLines} from "@pulse/domain";
import {prepareGlobalReport} from "./globalReport.js";
import {activeGlobalTargetZones} from "./globalTargetZones.js";
import {reviewGlobalTargetReport,applyGlobalTradeMap} from "./globalTradeMap.js";
import {assessGlobalEntryReport} from "./globalEntryAssessment.js";

// The reported snapshot's public OHLCV only; no wallet, payment or AI output.
const source=JSON.parse(readFileSync(new URL("./globalTargets.oct18-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
const markets=Object.entries(source.frames).map(([bar,rows]):SpotMarketContext=>{
  const candles=rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));
  return {instId:"BTC-USDT",bar,source:"okx-public-spot",fetchedAt:source.observedAt,candles,summary:summarizeCandles(candles),ticker:{instId:"BTC-USDT",last:candles.at(-1)!.close,priceCurrency:"USDT",open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:"0"}};
});
const make=(legacy=false)=>prepareGlobalReport({market:markets.find(m=>m.bar==="1Dutc")!,contextMarket:markets.find(m=>m.bar==="1Wutc"),hierarchyMarkets:markets,tier:"premium",...(legacy?{targetPolicy:"legacy-pivots-v1" as const}:{})});

// Inspect target geometry independently of the strategy's directional choice.
// Internal candidates are never published as simultaneous setups.
function targetMap(){const r=make(true);applyGlobalTradeMap(r,"active-zones-v1");delete r.tradePlan;r.view.levelIds=[...new Set([...r.view.levelIds,...r.strategy!.routes.flatMap(route=>route.objectiveIds)])];return r;}
test("reported daily BTC: consumed May swing is excluded; October resistance becomes TP1",()=>{
  const current=targetMap(),old=make(true),card=globalTradeCandidateCards(current).find(c=>c.side==="long")!,before=globalTradeCandidateCards(old).find(c=>c.side==="long")!;
  current.tradePlan=card.plan;
  assert.equal(before.targets[0].price,82473.6);
  assert.deepEqual(card.targets.map(t=>t.price),[84361.6,87238.3]);
  assert.equal(current.strategy?.targetPolicy,"active-zones-v1");
  assert.deepEqual(card.plan.referenceEntry,before.plan.referenceEntry);
  assert.equal(card.plan.referenceStop,before.plan.referenceStop);
  assert.ok(card.targets[0].movePercent!>2.4);
  assert.ok(card.rr!>1.23&&card.rr!<1.24);
  assert.equal(card.confirmed,false);assert.ok(card.plan.blockers.includes("reward"));
  assert.equal(GlobalReportSchema.safeParse(current).success,true);
  const svg=globalReportChartSvg(current,{selectedPathId:card.key})!;
  assert.ok(svg.includes('data-trade-role="TP1" data-price="84361.6"'));
  assert.ok(!svg.includes('data-trade-role="TP3"'));
  assert.ok(globalTradeCardLines(current).some(line=>line.includes("84,361.60")));
});
test("a free technical review preserves its original and is stable on repeat review",()=>{
  const original=make(true),before=JSON.stringify(original),review=reviewGlobalTargetReport(original);
  assert.equal(JSON.stringify(original),before);assert.equal(reviewGlobalTargetReport(review),review);
  assert.equal(globalTradeCards(review).length,1);assert.equal(review.setupSelection?.side,"short");assert.equal(review.paths.length,1);assert.equal(review.strategy?.routes.length,1);
  assert.match(review.narrative.limitations[0],/same saved candles and no new AI analysis/);
});
test("the schema rejects inserting a consumed pivot back into a current target map",()=>{
  const r=targetMap(),route=r.strategy!.routes.find(r=>r.side==="long")!,level=r.levels.find(l=>l.id===route.objectiveIds[0])!,may=r.indicators.pivots.find(a=>a.price===82473.6)!;
  level.anchorIds=[may.id];level.price=may.price;
  const result=GlobalReportSchema.safeParse(r);assert.equal(result.success,false);
  if(!result.success)assert.ok(result.error.issues.some(i=>i.message.includes("unconsumed")));
});
test("a fresh recheck cannot reuse a target crossed after the saved snapshot",()=>{
  const saved=reviewGlobalTargetReport(make(true)),primary=structuredClone(markets.find(m=>m.bar==="1Dutc")!);
  const selected=saved.tradePlan!,target=saved.levels.find(l=>l.id===selected.targetIds[0])!.price,sign=selected.side==="long"?1:-1,last=primary.candles.at(-1)!;
  primary.candles.push({...last,ts:last.ts+86400000,open:target,high:target+100,low:target-100,close:target+sign*50});
  primary.fetchedAt=new Date(Date.parse(primary.fetchedAt)+86400000).toISOString();
  const result=assessGlobalEntryReport(saved,primary,markets.find(m=>m.bar==="1Wutc"),markets.find(m=>m.bar==="4H"));
  assert.equal(result.state,"no_trade");assert.ok(result.blockers.includes("target_reached"));
  assert.ok(result.lines.some(l=>l.includes("cannot be reused as fresh reward")));
});
test("a genuine active swing cannot be skipped merely because it is also a Fibonacci endpoint",()=>{
  const {r}=synthetic("short"),a=r.indicators.pivots[1];r.indicators.fibonacci=[{ratio:0,price:a.price,anchorIds:[r.indicators.pivots[0].id,a.id]}];
  assert.deepEqual(activeGlobalTargetZones(r,"short",100,0).map(z=>z.price),[a.price]);
});
function synthetic(side:"long"|"short") {
  const r=structuredClone(make()),day=86400000,base=Date.UTC(2026,0,1),sign=side==="long"?1:-1;
  const pivot=(id:string,index:number,price:number):GlobalAnchor=>({id,ts:base+index*day,price:100+sign*price,kind:side==="long"?"high":"low",confirmedAt:base+(index+3)*day,label:""});
  r.indicators.pivots=[pivot("old",0,10),pivot("new",10,12)];r.indicators.fibonacci=[];r.snapshot.timeframe="1Dutc";r.snapshot.pricePrecision=2;
  r.indicators.atr.points=[{ts:base,value:20}];
  r.candles=Array.from({length:20},(_,i)=>({ts:base+i*day,open:100,high:120,low:80,close:i===8?100+sign*11:100,volume:1,volumeCcy:0,confirmed:true}));
  return {r,base,day};
}
for(const side of ["long","short"] as const){
  test(`${side}: a close through a known pivot consumes it, even inside a later zone`,()=>{
    const {r}=synthetic(side);assert.deepEqual(activeGlobalTargetZones(r,side,100,0).map(z=>z.anchors.map(a=>a.id)),[["new"]]);
  });
  test(`${side}: confirmation time prevents hindsight consumption; wick alone does not consume resistance/support`,()=>{
    const {r,base,day}=synthetic(side);r.indicators.pivots=[r.indicators.pivots[0]];
    r.candles[8].close=100;r.candles[1].close=side==="long"?115:85;
    assert.ok(base+day<candleCloseTime(r.indicators.pivots[0].confirmedAt!,"1Dutc")!);
    assert.equal(activeGlobalTargetZones(r,side,100,0).length,1);
  });
  test(`${side}: price crossing back does not revive a consumed pivot`,()=>{
    const {r}=synthetic(side);r.indicators.pivots=[r.indicators.pivots[0]];assert.equal(activeGlobalTargetZones(r,side,100,0).length,0);
  });
}
