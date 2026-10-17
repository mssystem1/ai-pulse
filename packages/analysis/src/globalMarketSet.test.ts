import test from "node:test";
import assert from "node:assert/strict";
import {loadGlobalMarketSet,globalCanonicalTimeframe} from "./globalMarketSet.js";
import {prepareGlobalReport,finishGlobalReport,globalCompatibility} from "./globalReport.js";
import {globalDecision} from "@pulse/domain";
import {summarizeCandles,type SpotMarketContext} from "@pulse/market";

const cutoff="2026-10-17T07:30:00.000Z";
function market(frame:string):SpotMarketContext {
  const candles=Array.from({length:80},(_,i)=>({ts:Date.parse(cutoff)-(80-i)*3600000,open:100+i,high:102+i,low:99+i,close:101+i,volume:500,volumeCcy:0,confirmed:true}));
  return {source:"okx-public-spot",instId:"BTC-USDT",bar:frame,candles,summary:summarizeCandles(candles),fetchedAt:cutoff,ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:180,open24h:100,high24h:182,low24h:99,vol24h:0,volCcy24h:0,change24hPct:0,ts:String(Date.parse(cutoff))}};
}
test("all new reports request the same UTC hierarchy, history depth and observation cutoff",async()=>{
  const calls:Array<{timeframe:string;candleLimit:number}>=[];
  const set=await loadGlobalMarketSet({instId:"BTC-USDT",timeframe:"1D"},async input=>{calls.push(input);return market(input.timeframe);},cutoff);
  assert.equal(set.market.bar,"1Dutc");assert.equal(set.contextMarket!.bar,"1Wutc");assert.equal(calls.length,4);assert.ok(calls.every(c=>c.candleLimit===520));assert.ok(set.hierarchyMarkets.every(m=>m.fetchedAt===cutoff));
  assert.equal(globalCanonicalTimeframe("1W"),"1Wutc");assert.equal(globalCanonicalTimeframe("15m"),"15m");
});
test("a missing context is retained as missing rather than replaced with another timeframe",async()=>{
  const set=await loadGlobalMarketSet({instId:"BTC-USDT",timeframe:"1H"},async input=>{if(input.timeframe==="4H")throw Error("provider unavailable");return market(input.timeframe);},cutoff);
  assert.equal(set.contextMarket,null);assert.ok(!set.hierarchyMarkets.some(m=>m.bar==="4H"));
});
test("provider timeframe and source mismatches cannot masquerade as hierarchy evidence",async()=>{
  await assert.rejects(()=>loadGlobalMarketSet({instId:"BTC-USDT",timeframe:"1D"},async()=>market("1D"),cutoff),/mismatch/);
  const set=await loadGlobalMarketSet({instId:"BTC-USDT",timeframe:"1H"},async input=>market(input.timeframe==="4H"?"1H":input.timeframe),cutoff);
  assert.equal(set.contextMarket,null);
});
test("changing the requested report frame cannot change the shared hierarchy at the same cutoff",async()=>{
  let expected:unknown;
  for(const frame of ["1H","4H","1D","1W"]){
    const set=await loadGlobalMarketSet({instId:"BTC-USDT",timeframe:frame},async input=>market(input.timeframe),cutoff);
    const report=prepareGlobalReport({...set,tier:"premium"});
    const common=report.hierarchy!.filter(r=>["1Wutc","1Dutc","4H","1H"].includes(r.timeframe));
    if(expected)assert.deepEqual(common,expected);else expected=common;
  }
});
test("model scenario selection and buy-now prose cannot change a prepared trade or current heading",()=>{
  const r=prepareGlobalReport({market:market("1H"),tier:"base"}),before=structuredClone(r),alternative=r.paths.find(p=>p.role!=="main");
  const f=finishGlobalReport(r,{headline:"Buy immediately",summary:"Go long",regime:"trend_up",bias:"bullish",confidence:99,waveCandidateId:null,mainPathId:alternative?.id??null,setupPathId:null,reasons:["Buy now","tradePlan.state is confirmed"],pathNotes:[],riskNotes:[],limitations:[],disclaimer:"Research"});
  assert.deepEqual(f.tradePlan,r.tradePlan);assert.deepEqual(f.paths.map(p=>[p.id,p.role]),r.paths.map(p=>[p.id,p.role]));assert.doesNotMatch(f.narrative.headline,/Buy immediately|Go long/);assert.equal(f.narrative.reasons.length,0);assert.deepEqual(r,before);
  const projected=globalCompatibility(f);assert.equal(projected.executionPlan.recommendation.action,globalDecision(f).currentAction.toLowerCase());assert.equal(projected.executionPlan.buy.valid,false);assert.equal(projected.executionPlan.buy.stopLoss,null);
});
