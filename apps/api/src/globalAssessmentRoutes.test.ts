import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { getNetwork, loadConfig } from "@pulse/config";
import { qualifiedGlobalFixture } from "../../../packages/analysis/dist/globalAssessment.fixtures.js";
import {entryPlanFixture} from "../../../packages/analysis/dist/globalEntryPlan.fixtures.js";
import {strategyFixture} from "../../../packages/analysis/dist/globalStrategy.fixtures.js";
import {tradePlanFixture} from "../../../packages/analysis/dist/globalTrade.fixtures.js";
import { createGlobalAssessmentRouter } from "./globalAssessmentRoutes.js";
import type { getOkxTradeTokens } from "./okxDex.js";
import {deriveGlobalTradePlan} from "@pulse/domain";

for(const version of ["decision-v2","decision-v3","decision-v4","decision-v5"] as const)test(`${version} recheck loads the named entry frame and retains the shared geometry`,async()=>{
  const {report,market,entry,context}=version==="decision-v5"?tradePlanFixture():version==="decision-v4"?strategyFixture():entryPlanFixture(),calls:string[]=[];
  report.decisionVersion=version;report.tradePlan=deriveGlobalTradePlan(report);const before=JSON.stringify(report);
  const app=express();app.use(express.json());app.use(createGlobalAssessmentRouter({...loadConfig(),NODE_ENV:"test",X402_MOCK:true},{resolveReport:async access=>access.token==="saved-report-capability-0000"?report:null,market:async input=>{calls.push(input.timeframe);const result=[market,entry,context].find(m=>m.bar===input.timeframe);assert.ok(result);return result;}}));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  try{
    const r=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/v1/global/setup-assessment`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access:{kind:"job",id:"saved-report",token:"saved-report-capability-0000"}})});
    assert.equal(r.status,200);const {assessment}=await r.json();assert.equal(assessment.state,"technical_valid");assert.deepEqual(assessment.permittedEntry,report.tradePlan!.referenceEntry);assert.equal(assessment.observedStop,report.tradePlan!.referenceStop);assert.equal(assessment.entryTimeframe,"1H");assert.deepEqual(calls.sort(),["1Dutc","1H","4H"]);assert.equal(JSON.stringify(report),before);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("production-shaped saved-report recheck and quoted review reach readiness without a payment, model or broadcast",async()=>{
  const {report,market}=qualifiedGlobalFixture(),before=JSON.stringify(report),settlement="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",base="0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",wallet="0x2222222222222222222222222222222222222222";
  let quotes=0,balances=0,authorized=0,missingFees=false,fxRate=1;
  const app=express();app.use(express.json());
  const cfg={...loadConfig(),NODE_ENV:"test" as const,X402_MOCK:true};
  app.use(createGlobalAssessmentRouter(cfg,{resolveReport:async access=>{if(access.token!=="saved-report-capability-0000")return null;authorized++;return {global:report};},market:async input=>{assert.equal(input.instId,"BTC-USDT");return market;},tokens:(async()=>[{address:base,symbol:"cbBTC",name:"Coinbase Wrapped Bitcoin",decimals:8,logoUrl:null,provider:"Synthetic OKX catalog"}]) as typeof getOkxTradeTokens,balance:async()=>{balances++;return 1_000_000_000n;},settlementRate:async()=>({last:fxRate,ts:String(Date.now())}),quote:async input=>{
    quotes++;const buy=input.fromTokenAddress.toLowerCase()===settlement.toLowerCase();
    return {chainId:"8453",fromTokenAmount:input.amount,toTokenAmount:buy?"300000000":"300250000",fromToken:{address:input.fromTokenAddress,symbol:buy?"USDC":"BTC",decimals:buy?6:8,priceUsd:buy?"1":"100.1"},toToken:{address:input.toTokenAddress,symbol:buy?"BTC":"USDC",decimals:buy?8:6,priceUsd:buy?"100.1":"1"},priceImpactPercent:"0.01",estimateGasFee:"135000",tradeFee:"0.001",networkFeeUsd:missingFees?null:"0.001",route:["Synthetic router"],quoteId:"synthetic"};
  }}));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address() as {port:number},url=`http://127.0.0.1:${address.port}/v1/global/setup-assessment`;
  const post=async(body:unknown)=>{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  try{
    const access={kind:"job",id:"saved-report",token:"saved-report-capability-0000"};
    assert.equal((await post({access:{...access,token:"unrecognized-capability-0000"}})).status,404);assert.equal(quotes,0);
    const first=await post({access});assert.equal(first.status,200);assert.equal(first.body.assessment.state,"technical_valid");assert.equal(quotes,0);
    const trade={network:"base",fromTokenAddress:settlement,toTokenAddress:base,userWalletAddress:wallet,amount:"300300000",slippagePercent:.05,maxAutoSlippagePercent:.1,slippageMode:"manual",takeProfit:110,stopLoss:first.body.assessment.observedStop,orderType:"market"};
    const reviewed=await post({access,trade});assert.equal(reviewed.status,200);assert.equal(reviewed.body.review.state,"ready_for_order_review");assert.ok(reviewed.body.review.netRewardRisk>=1.5);assert.equal(quotes,2);assert.equal(balances,1);
    const limit=await post({access,trade:{...trade,orderType:"limit",limitPrice:100.1,minimumOutputAmount:"300000000"}});assert.equal(limit.body.review.state,"ready_for_order_review");
    const weakLimit=await post({access,trade:{...trade,orderType:"limit",limitPrice:100.1,minimumOutputAmount:"100000000"}});assert.equal(weakLimit.body.review.state,"blocked");
    fxRate=.9992;const fx=await post({access,trade});assert.equal(fx.body.review.state,"blocked");assert.ok(fx.body.review.blockers.includes("ticket_protection"));
    assert.equal(fx.body.executionLevels.currency,"USDC");assert.equal(fx.body.executionLevels.researchCurrency,"USDT");
    const converted=await post({access,trade:{...trade,stopLoss:fx.body.executionLevels.stopLoss,takeProfit:fx.body.executionLevels.takeProfit}});assert.equal(converted.body.review.state,"ready_for_order_review");fxRate=1;
    const edited=await post({access,trade:{...trade,stopLoss:99}});assert.equal(edited.body.review.state,"blocked");assert.ok(edited.body.review.blockers.includes("ticket_protection"));
    missingFees=true;const unknown=await post({access,trade});assert.equal(unknown.body.review.state,"blocked");assert.ok(unknown.body.review.blockers.includes("costs"));
    const foreign=await post({access,trade:{...trade,toTokenAddress:wallet}});assert.equal(foreign.body.review.state,"blocked");
    assert.equal(JSON.stringify(report),before);assert.ok(authorized>=5);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

for(const version of ["decision-v2","decision-v3","decision-v4","decision-v5"] as const)test(`${version} X Layer USD₮0 Market/Limit quote review preserves observed xBTC protection without a USDC conversion`,async()=>{
  const {report,market,entry,context}=version==="decision-v5"?tradePlanFixture("4H","long","breakout_retest",Date.now()):version==="decision-v4"?strategyFixture("4H","long","breakout_retest",Date.now()):entryPlanFixture("long","breakout_retest",Date.now()),network=getNetwork("xlayer"),settlement=network.paymentAsset.address!,btc="0xb7C00000bcDEeF966b20B3D884B98E64d2b06b4f";
  report.decisionVersion=version;report.tradePlan=deriveGlobalTradePlan(report);
  let wrongChain=false;
  const app=express();app.use(express.json());
  app.use(createGlobalAssessmentRouter({...loadConfig(),NODE_ENV:"test",X402_MOCK:true},{
    resolveReport:async()=>report,market:async input=>[market,entry,context].find(m=>m.bar===input.timeframe)!,
    tokens:(async()=>[{address:btc,symbol:"xBTC",name:"OKX Wrapped BTC",decimals:8,logoUrl:null,provider:"Synthetic OKX catalog"}]) as typeof getOkxTradeTokens,
    balance:async()=>1_000_000_000n,
    settlementRate:async()=>{throw Error("USDC conversion must not run for USD₮0");},
    quote:async input=>{const buy=input.fromTokenAddress.toLowerCase()===settlement.toLowerCase();return {
      chainId:wrongChain?"8453":"196",fromTokenAmount:input.amount,toTokenAmount:buy?"300000000":"300250000",
      fromToken:{address:input.fromTokenAddress,symbol:buy?"USD₮0":"xBTC",decimals:buy?6:8,priceUsd:"1"},
      toToken:{address:input.toTokenAddress,symbol:buy?"xBTC":"USD₮0",decimals:buy?8:6,priceUsd:"1"},
      priceImpactPercent:"0.01",estimateGasFee:"0",tradeFee:"0",networkFeeUsd:"0",route:["Synthetic route"],quoteId:"synthetic-xlayer",
    };},
  }));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/v1/global/setup-assessment`,access={kind:"job",id:"saved-report",token:"saved-report-capability-0000"};
  const post=async(trade?:unknown)=>{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access,trade})});assert.equal(r.status,200);return r.json();};
  try{
    const first=await post(),trade={network:"xlayer",fromTokenAddress:settlement,toTokenAddress:btc,userWalletAddress:"0x2222222222222222222222222222222222222222",amount:"300300000",slippagePercent:.05,maxAutoSlippagePercent:.1,slippageMode:"manual",takeProfit:110,stopLoss:first.assessment.observedStop,orderType:"market"};
    const reviewed=await post(trade);assert.equal(reviewed.review.state,"ready_for_order_review");assert.equal(reviewed.executionLevels.currency,"USD₮0");assert.equal(reviewed.executionLevels.settlementToResearch,1);
    const limit=await post({...trade,orderType:"limit",limitPrice:100.1,minimumOutputAmount:"300000000"});assert.equal(limit.review.state,"ready_for_order_review");
    wrongChain=true;const foreign=await post(trade);assert.equal(foreign.review.state,"blocked");assert.match(foreign.review.lines.join(" "),/quote.*match/i);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
