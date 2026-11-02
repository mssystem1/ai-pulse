import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {GlobalMarketEvidenceSchema,GlobalStrategyMixSchema,type GlobalCandle,type GlobalMarketEvidence,type GlobalReport} from "@pulse/schemas";
import {applyGlobalStrategyMix,evaluateGlobalStrategyMix,globalNativeMarketEvidence,globalStrategyMixObjectives,normalizeGlobalFunding} from "./globalStrategyMix.js";
import {buildGlobalOrderFlow} from "./globalOrderFlow.js";
import {prepareGlobalReport,globalContextTimeframe} from "./globalReport.js";

const minute=60000,hour=60*minute,anchor=Date.UTC(2026,9,30,12),cutoff=anchor+hour;
const candle=(i:number,close:number,low:number,high:number):GlobalCandle=>({ts:anchor+i*15*minute,open:close,close,low,high,volume:10,confirmed:true});
function report():GlobalReport{
  return {snapshot:{instId:"BTC-USDT",timeframe:"1H",source:"okx-public-spot",venue:"OKX Spot",priceCurrency:"USDT",observedAt:new Date(cutoff).toISOString(),lastCandleTs:anchor-hour,price:103.1,pricePrecision:2,completedOnly:true},candles:[],entryStudy:{status:"available",timeframe:"15m",source:"okx-public-spot",observedAt:new Date(cutoff).toISOString(),candles:[candle(0,100.5,100.2,101),candle(1,101,99,102),candle(2,103,100,103.2),candle(3,103.1,102.8,103.5)],pivots:[],atr:[]},indicators:{pivots:[],vwap:{anchorId:"old-known-anchor",anchorTs:anchor-2*hour,knownAt:anchor-hour,basis:"primary_hlc3_volume",points:[{ts:anchor-2*hour,value:102}]}},horizonContext:{version:"horizon-context-v1",timeframe:"1H",reading:"intraday",knownAt:anchor-hour,zones:[{id:"support",role:"support",lower:100,upper:100,startTs:anchor-3*hour,knownAt:anchor-hour,anchorIds:["s"],basis:"confirmed_pivot_wicks"}],ranges:[]},setupSelection:{side:"short",regime:"range"}} as unknown as GlobalReport;
}
function evidence(kind:"profile"|"spot"|"perpetual",delta=10):GlobalMarketEvidence{
  const isProfile=kind==="profile",market={venue:"OKX Spot",instrument:kind==="perpetual"?"BTC-USDT-SWAP":"BTC-USDT",baseAsset:"BTC",quoteCurrency:"USDT",marketType:kind==="perpetual"?"perpetual" as const:"spot" as const},start=isProfile?anchor-hour:anchor+15*minute,end=isProfile?anchor:anchor+45*minute;
  return GlobalMarketEvidenceSchema.parse({version:"market-evidence-v1",id:kind,provider:"fixture-exchange",market,aggregation:"single_venue",members:[market],provenance:"executed_trades",coverage:{start,end,knownAt:end,capturedAt:cutoff,complete:true,gaps:[]},data:isProfile?{kind:"executed_profile",rowSize:1,valueFraction:.7,val:100,poc:104,vah:108,quantityUnit:"base",session:{timezone:"UTC",anchor:"completed-prior-hour",completed:true}}:{kind:"traded_flow",quantityUnit:"base",buy:100+delta,sell:100,delta,resetAt:start}});
}
const candidate=(r:GlobalReport,id:string,e:GlobalMarketEvidence[]=[])=>evaluateGlobalStrategyMix(r,{evidence:e}).candidates.find(c=>c.id===id)!;

test("new complementary variants retain all core methods and never fabricate missing feeds",()=>{
  const r=report();r.entryStudy!.candles=[];
  const mix=evaluateGlobalStrategyMix(r);
  assert.equal(mix.primary.side,"short");assert.equal(mix.selectedVariant,undefined);
  assert.equal(mix.exposurePolicy,"one_primary_exposure");
  assert.deepEqual(mix.candidates.map(c=>c.id).sort(),["accepted_breakout_retest","sweep_reclaim","value_area_rotation"]);
  assert.ok(mix.candidates.every(c=>c.status==="unavailable"));
  assert.ok(candidate(r,"value_area_rotation").missingInputs.includes("fresh_completed_executed_profile"));
});

test("a causal sweep, reclaim and later hold can select a new reaction without a fabricated fill",()=>{
  const r=report(),result=applyGlobalStrategyMix(r),before=structuredClone(r);
  assert.equal(result.mix.selectedVariant,"sweep_reclaim");assert.equal(result.choice!.side,"long");
  assert.equal(result.choice!.entryBasis.price,100);assert.equal(result.choice!.evidence.completedAt,anchor+45*minute);
  assert.equal(result.candidate!.source!.knownAt,anchor-hour);
  assert.deepEqual(r,before);assert.equal((result.choice as Record<string,unknown>).fill,undefined);
});

test("value rotation requires real completed profiles and a held edge while value remains ahead",()=>{
  const r=report();assert.equal(candidate(r,"value_area_rotation").status,"unavailable");
  const c=candidate(r,"value_area_rotation",[evidence("profile")]);
  assert.equal(c.status,"eligible");assert.equal(c.side,"long");assert.equal(c.source!.price,100);assert.deepEqual(c.evidenceIds,["profile"]);
  r.entryStudy!.candles[3].close=105;r.entryStudy!.candles[3].high=106;
  // A POC already crossed after the reaction cannot support a fresh rotation.
  assert.notEqual(candidate(r,"value_area_rotation",[evidence("profile")]).status,"eligible");
});

test("acceptance and defended retest need separately supportive spot and perpetual flow",()=>{
  const r=report(),spot=evidence("spot"),perp=evidence("perpetual");
  r.entryStudy!.candles[0]=candle(0,99.5,99,100);
  assert.ok(candidate(r,"accepted_breakout_retest",[spot]).missingInputs.includes("fresh_perpetual_executed_flow"));
  const result=evaluateGlobalStrategyMix(r,{evidence:[spot,perp]}),accepted=result.candidates.find(c=>c.id==="accepted_breakout_retest")!;
  assert.equal(accepted.status,"eligible");assert.equal(result.selectedVariant,"accepted_breakout_retest");
  assert.deepEqual(result.evidenceGroups,["price_structure","executed_flow"]);
  assert.equal(candidate(r,"accepted_breakout_retest",[spot,evidence("perpetual",-20)]).status,"conflicted");
  assert.ok(candidate(r,"accepted_breakout_retest",[spot,evidence("perpetual",-20)]).conflicts[0].includes("perpetual"));
});

test("value-area objectives retain the exact observed POC and opposite value edge",()=>{
  const r=report(),p=evidence("profile"),c=candidate(r,"value_area_rotation",[p]);
  const objectives=globalStrategyMixObjectives(r,c,[p]);
  assert.deepEqual(objectives.map(t=>t.price),[104,108]);assert.ok(objectives.every(t=>t.basis==="executed_profile"&&t.knownAt===anchor&&t.timeframe==="1H"));
  r.currentMarket={source:r.snapshot.source,quote:{price:104,ts:cutoff},frames:[]};
  assert.deepEqual(globalStrategyMixObjectives(r,c,[p]),[]);
});

test("later failure, unconfirmed candles and future-known levels cannot admit a historical event",()=>{
  const broken=report();broken.entryStudy!.candles[3].close=99;broken.entryStudy!.candles[3].low=98;
  assert.notEqual(candidate(broken,"sweep_reclaim").status,"eligible");
  const future=report();future.horizonContext!.zones[0].knownAt=cutoff;
  assert.notEqual(candidate(future,"sweep_reclaim").status,"eligible");
  const unfinished=report();unfinished.entryStudy!.candles[2].confirmed=false;unfinished.entryStudy!.candles[3].confirmed=false;
  assert.notEqual(candidate(unfinished,"sweep_reclaim").status,"eligible");
  const weak=report();weak.entryStudy!.candles[2]=candle(2,100.8,100,102);weak.entryStudy!.candles[3]=candle(3,101,100.3,102);
  assert.notEqual(candidate(weak,"sweep_reclaim").status,"eligible");
  const trending=report();trending.setupSelection!.regime="trend";
  assert.ok(candidate(trending,"value_area_rotation",[evidence("profile")]).missingInputs.includes("balanced_primary_regime"));
  const lost=report();lost.currentMarket={source:lost.snapshot.source,frames:[{timeframe:"5m",candles:[{ts:cutoff-5*minute,open:100,high:101,low:98,close:99,volume:1,confirmed:true}]}]};
  assert.notEqual(candidate(lost,"sweep_reclaim").status,"eligible","A newer completed loss of the level invalidates the earlier held reclaim.");
});

test("feed continuity, known-at time, contracts and quotes are checked before strategy admission",()=>{
  const r=report(),profile=evidence("profile");
  const incomplete=structuredClone(profile);incomplete.coverage.complete=false;
  assert.equal(candidate(r,"value_area_rotation",[incomplete]).status,"unavailable");
  const late=structuredClone(profile);late.coverage.knownAt=cutoff+1;late.coverage.capturedAt=cutoff+1;
  assert.equal(candidate(r,"value_area_rotation",[late]).status,"unavailable");
  const otherQuote=structuredClone(profile);otherQuote.market.quoteCurrency="USD";otherQuote.members[0].quoteCurrency="USD";
  assert.equal(candidate(r,"value_area_rotation",[otherQuote]).status,"unavailable");
  const otherAsset=structuredClone(profile);otherAsset.market.baseAsset="ETH";otherAsset.members[0].baseAsset="ETH";
  assert.equal(candidate(r,"value_area_rotation",[otherAsset]).status,"unavailable");
  const gap=structuredClone(profile);gap.coverage.gaps=[{start:anchor-10*minute,end:anchor-9*minute}];
  assert.equal(GlobalMarketEvidenceSchema.safeParse(gap).success,false);
  const mixed=structuredClone(profile);mixed.aggregation="multi_venue";mixed.members.push({...mixed.market,venue:"coinbase",quoteCurrency:"USD"});
  assert.equal(GlobalMarketEvidenceSchema.safeParse(mixed).success,false);
});

test("historical executed profiles cannot masquerade as fresh hourly admission flow",()=>{
  const r=report(),start=anchor-4*86400000,end=start+86400000;
  r.orderFlow=buildGlobalOrderFlow({source:r.snapshot.source,instId:r.snapshot.instId,priceCurrency:"USDT",marketType:"spot",quantityUnit:"base",capturedAt:new Date(cutoff).toISOString(),coverage:{start,end,knownAt:end,complete:true,sha256:["a".repeat(64)]},trades:[{id:"1",ts:start+minute,price:100.5,size:2,side:"buy"},{id:"2",ts:start+2*minute,price:101.5,size:1,side:"sell"}]},{timeframe:"1H",start,end,asOf:cutoff,rowSize:1})!;
  const native=globalNativeMarketEvidence(r);assert.equal(native.length,2);
  const mix=evaluateGlobalStrategyMix(r);
  assert.equal(mix.candidates.find(c=>c.id==="value_area_rotation")!.status,"unavailable");
  assert.deepEqual(mix.evidenceGroups,["price_structure"]);
});

test("MMT aggregate zero sentinels stay unavailable; OI cannot become directional proof",()=>{
  assert.deepEqual(normalizeGlobalFunding({provider:"mmt",aggregated:true,rate:0,markPrice:0}),{rate:null,markPrice:null});
  const e=evidence("perpetual");e.provider="mmt";e.aggregation="multi_venue";e.provenance="exchange_statistics";e.data={kind:"funding",rate:null,markPrice:null,intervalMs:8*hour};
  assert.equal(GlobalMarketEvidenceSchema.safeParse(e).success,true);
  e.data.rate=0;assert.equal(GlobalMarketEvidenceSchema.safeParse(e).success,false);
  e.data={kind:"open_interest",quantityUnit:"base",startValue:10,endValue:50};
  const mix=evaluateGlobalStrategyMix(report(),{evidence:[e]});
  assert.equal(mix.candidates.find(c=>c.id==="accepted_breakout_retest")!.status,"unavailable");
  assert.ok(mix.evidenceGroups.includes("derivatives_positioning"));
});

test("expired price events and contradicted duplicate feed identities are not silently reused",()=>{
  const r=report();r.snapshot.observedAt=new Date(cutoff+4*hour).toISOString();
  assert.notEqual(candidate(r,"sweep_reclaim").status,"eligible");
  const p=evidence("profile"),conflict=structuredClone(p);if(conflict.data.kind==="executed_profile")conflict.data.val=99;
  assert.equal(candidate(report(),"value_area_rotation",[p,conflict]).status,"unavailable");
});

test("selection schema rejects an unavailable chosen method and duplicate method claims",()=>{
  const mix=evaluateGlobalStrategyMix(report());mix.selectedVariant="value_area_rotation";
  assert.equal(GlobalStrategyMixSchema.safeParse(mix).success,false);
  mix.selectedVariant=undefined;mix.candidates.push(mix.candidates[0]);
  assert.equal(GlobalStrategyMixSchema.safeParse(mix).success,false);
});

test("short variants use the same causal requirements and their own opposite value targets",()=>{
  const r=report();r.entryStudy!.candles=r.entryStudy!.candles.map(c=>({...c,open:200-c.open,high:200-c.low,low:200-c.high,close:200-c.close}));
  r.indicators.vwap!.points[0].value=98;
  const p=evidence("profile");if(p.data.kind==="executed_profile"){p.data.val=92;p.data.poc=96;p.data.vah=100;}
  const sweep=candidate(r,"sweep_reclaim"),value=candidate(r,"value_area_rotation",[p]);
  assert.equal(sweep.status,"eligible");assert.equal(sweep.side,"short");assert.equal(value.status,"eligible");assert.equal(value.side,"short");
  assert.deepEqual(globalStrategyMixObjectives(r,value,[p]).map(t=>t.price),[96,92]);
  r.entryStudy!.candles[0]=candle(0,100.5,100,101);
  const accepted=candidate(r,"accepted_breakout_retest",[evidence("spot",-10),evidence("perpetual",-10)]);
  assert.equal(accepted.status,"eligible");assert.equal(accepted.side,"short");
});

test("contract counts and modeled liquidation levels cannot masquerade as normalized executions",()=>{
  const contracts=evidence("perpetual");contracts.aggregation="multi_venue";contracts.members.push({...contracts.market,venue:"other-exchange"});
  if(contracts.data.kind==="traded_flow")contracts.data.quantityUnit="contracts";
  assert.equal(GlobalMarketEvidenceSchema.safeParse(contracts).success,false);
  const model=evidence("perpetual");model.provenance="modelled";model.data={kind:"liquidations",quantityUnit:"base",longLiquidated:10,shortLiquidated:5};
  assert.equal(GlobalMarketEvidenceSchema.safeParse(model).success,false);
});

test("a daily timing reaction cannot independently replace an intact opposing weekly assessment",()=>{
  const r=report(),day=24*hour;r.snapshot.timeframe="1Wutc";r.entryStudy!.timeframe="1Dutc";r.snapshot.observedAt=new Date(anchor+4*day).toISOString();
  r.entryStudy!.candles=r.entryStudy!.candles.map((c,i)=>({...c,ts:anchor+i*day}));r.setupSelection!.assessment="short";r.horizonContext!.timeframe="1Wutc";r.horizonContext!.zones[0].knownAt=anchor-7*day;
  const c=candidate(r,"sweep_reclaim");assert.equal(c.side,"long");assert.equal(c.status,"conflicted");assert.ok(c.conflicts.some(c=>/weekly assessment remains short/.test(c)));assert.equal(evaluateGlobalStrategyMix(r).selectedVariant,undefined);
});

test("all five timeframe preparation paths preserve strategy mix and native asset scales",()=>{
  const history=JSON.parse(readFileSync(new URL("./globalReport.oct20-fixture.json",import.meta.url),"utf8")) as {observedAt:string;frames:Record<string,number[][]>};
  // Synthetic instrument/scaling compatibility only, not ETH/HYPE performance.
  for(const [asset,scale] of [["BTC",1],["ETH",.04],["HYPE",.0005]] as const){
    const markets=Object.entries(history.frames).map(([bar,rows])=>({bar,instId:`${asset}-USDT`,source:"okx-public-spot",fetchedAt:history.observedAt,ticker:{priceCurrency:"USDT"},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open:open*scale,high:high*scale,low:low*scale,close:close*scale,volume,confirmed:true}))}));
    for(const timeframe of ["15m","1H","4H","1Dutc","1Wutc"]){
      const prepared=prepareGlobalReport({market:markets.find(m=>m.bar===timeframe)!,contextMarket:markets.find(m=>m.bar===globalContextTimeframe(timeframe)),hierarchyMarkets:markets,tier:"premium"});
      assert.ok(prepared.discretionaryPlan,`${asset} ${timeframe}`);assert.equal(prepared.discretionaryPlan.version,"discretionary-plan-v8");
      assert.equal(prepared.discretionaryPlan.objectiveTimeframe,timeframe);assert.equal(prepared.discretionaryPlan.stopBasis.timeframe,timeframe);
      assert.equal(prepared.discretionaryPlan.executionPolicy!.configurationKey.startsWith(`${asset}-USDT:${timeframe}:`),true);
      assert.equal(prepared.strategyMix!.candidates.length,3);assert.equal(prepared.strategyMix!.exposurePolicy,"one_primary_exposure");
      const value=prepared.strategyMix!.candidates.find(c=>c.id==="value_area_rotation")!;
      assert.equal(value.status,"unavailable");assert.ok(value.missingInputs.includes("fresh_completed_executed_profile"));
    }
  }
});
