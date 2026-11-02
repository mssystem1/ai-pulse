import test from "node:test";
import assert from "node:assert/strict";
import type {GlobalReport} from "@pulse/schemas";
import {globalStrategyMixLines} from "./globalStrategyMixLines.js";

function report(){
  return {lang:"en",snapshot:{timeframe:"1Wutc",pricePrecision:2,venue:"OKX"},setupSelection:{assessment:"long"},
    discretionaryPlan:{family:"level_retest",side:"short"},strategyMix:{version:"global-strategy-mix-v1",primary:{family:"ema_pullback",side:"long",variant:"core",reason:"core"},
      selectedVariant:"sweep_reclaim",evidenceGroups:["price_structure"],exposurePolicy:"one_primary_exposure",candidates:[
        {id:"sweep_reclaim",family:"level_retest",side:"short",status:"eligible",reason:"observed",missingInputs:[],conflicts:[],evidenceIds:[],source:{kind:"swept_level",price:100,lower:100,upper:100,timeframe:"1Wutc",knownAt:Date.UTC(2026,9,19)},event:{kind:"sweep_reclaim",timeframe:"1Dutc",testTs:Date.UTC(2026,9,21),completedAt:Date.UTC(2026,9,23),extreme:102}},
        {id:"accepted_breakout_retest",family:"breakout_retest",side:"long",status:"unavailable",reason:"missing",missingInputs:["fresh_spot_executed_flow","fresh_perpetual_executed_flow"],conflicts:[],evidenceIds:[]},
      ]},
  } as unknown as GlobalReport;
}

test("primary assessment, core method and selected opportunity retain separate directions",()=>{
  const lines=globalStrategyMixLines(report()),text=lines.join("\n");
  assert.match(lines[0],/Primary assessment: LONG/);assert.match(lines[0],/Core method: LONG/);assert.match(lines[0],/Selected setup: SHORT · Sweep and reclaim/);
  assert.match(text,/known at 2026-10-19/);assert.match(text,/test 2026-10-21/);assert.match(text,/price event completed 2026-10-23/);assert.doesNotMatch(text,/admission completed/);
  assert.match(text,/does not claim joint current spot\/perpetual/);assert.match(text,/One primary exposure/);
});

test("missing inputs and conflicts use readable public terms instead of internal source IDs",()=>{
  const r=report(),candidate=r.strategyMix!.candidates[0];candidate.status="conflicted";candidate.conflicts=["Completed weekly assessment remains long; an opposing daily reaction needs a primary structural turn before it can replace the macro setup."];
  delete r.strategyMix!.selectedVariant;
  const text=globalStrategyMixLines(r).join("\n");
  assert.match(text,/intact weekly structure/);assert.match(text,/current spot executions covering the event/);assert.match(text,/current perpetual executions covering the event/);
  assert.doesNotMatch(text,/fresh_spot_executed_flow|fresh_perpetual_executed_flow|sweep_reclaim|accepted_breakout_retest/);
});

test("Chinese mix explanations keep missing-data semantics and observations distinct",()=>{
  const r=report();r.lang="zh";const text=globalStrategyMixLines(r).join("\n");
  assert.match(text,/主周期判断/);assert.match(text,/扫价收复/);assert.match(text,/当前现货成交/);assert.match(text,/价格事件完成于/);assert.doesNotMatch(text,/fresh_|\?{3}/);
});

test("legacy reports without a recorded mix do not acquire fabricated evidence",()=>{
  const r=report();delete r.strategyMix;assert.deepEqual(globalStrategyMixLines(r),[]);
});

test("only the selected variant's retained observations supply participation evidence",()=>{
  const r=report(),start=Date.UTC(2026,9,22),end=start+3600000;
  r.marketEvidence=[
    {id:"spot-flow",market:{venue:"OKX",instrument:"BTC-USDT",marketType:"spot"},coverage:{start,end},data:{kind:"traded_flow"}},
    {id:"perp-flow",market:{venue:"OKX",instrument:"BTC-USDT-SWAP",marketType:"perpetual"},coverage:{start,end},data:{kind:"traded_flow"}},
  ] as unknown as NonNullable<GlobalReport["marketEvidence"]>;
  r.strategyMix!.candidates[0].evidenceIds=["spot-flow"];
  let text=globalStrategyMixLines(r).join("\n");
  assert.match(text,/retained spot executions/);assert.doesNotMatch(text,/retained spot and perpetual|Source coverage: OKX BTC-USDT-SWAP/);
  r.strategyMix!.candidates[0].evidenceIds.push("perp-flow");
  text=globalStrategyMixLines(r).join("\n");assert.match(text,/retained spot and perpetual executions/);
  assert.match(text,/Source coverage: OKX BTC-USDT · spot/);assert.match(text,/Source coverage: OKX BTC-USDT-SWAP · perpetual/);
});

test("a native profile is location evidence without inventing current executed aggression",()=>{
  const r=report(),start=Date.UTC(2026,9,22),end=start+3600000;
  r.orderFlow={source:"okx-trades",instId:"BTC-USDT",marketType:"spot",profile:{start,end}} as unknown as NonNullable<GlobalReport["orderFlow"]>;
  r.strategyMix!.candidates[0].evidenceIds=[`okx-trades:BTC-USDT:profile:${start}:${end}`];
  let text=globalStrategyMixLines(r).join("\n");assert.match(text,/does not claim joint current spot\/perpetual/);assert.match(text,/Source coverage: OKX BTC-USDT · spot/);assert.doesNotMatch(text,/retained spot executions/);
  r.strategyMix!.candidates[0].evidenceIds=["okx-trades:BTC-USDT:unretained"];
  text=globalStrategyMixLines(r).join("\n");assert.doesNotMatch(text,/Source coverage:/);
});
