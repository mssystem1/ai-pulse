import test from "node:test";
import assert from "node:assert/strict";
import { indicatorMarketCatalog, evaluateIndicator,createStudyIndicatorPackage,createGraphIndicatorPackage,parseIndicatorScript } from "@pulse/domain";
import { indicatorInputFromMarket, installIndicator, loadInstalledIndicators } from "./terminalIndicatorClient";
import type { TerminalMarket } from "./terminalClient";

test("Portable indicators stay bound to the selected stream and exact source window", () => {
  const now = Date.now(), start = now - 120000, end = now - 60000;
  const flow = { source: "real-spot", status: "partial", knownAt: now, windowStart: start, windowEnd: end, marketType: "spot", points: [{ ts: start, buy: 4, sell: 2, delta: 2, cvd: 2 }] };
  const market = { instId: "ETH-USDT", timeframe: "1H", tools: { flow } } as unknown as TerminalMarket;
  const input = indicatorInputFromMarket(market, "spot", now), result = evaluateIndicator(indicatorMarketCatalog()[0], input);
  assert.equal(result.status, "partial"); assert.equal(result.provenance.windowStart, start); assert.equal(result.provenance.units, "base"); assert(Math.abs(result.summary.cvd! - 2) < .001);
  const missing = indicatorInputFromMarket(market, "perpetual", now); assert.equal(missing.status, "unavailable"); assert.equal(missing.units, "contracts"); assert.equal(missing.points.length, 0);
});
test("Live assessment display buckets clip to actual sample edges without losing executed quantities", () => {
  const now = Date.now(), start = now - 120000, end = now - 60000;
  const market = { instId:"BTC-USDT",timeframe:"1H",tools:{flow:{source:"captured-trades",status:"partial",knownAt:now,windowStart:start,windowEnd:end,marketType:"spot",points:[],displayPoints:[{ts:start-17000,end:end+20000,buy:12,sell:8}]}} } as unknown as TerminalMarket;
  const input=indicatorInputFromMarket(market,"spot",now);
  assert.deepEqual(input.points,[{ts:start,end,buy:12,sell:8}]);
  const result=evaluateIndicator(indicatorMarketCatalog()[0],input);
  assert.equal(result.status,"partial");assert(Math.abs(result.summary.cvd!-4)<.001);
});
test("Installed library validates imported packages, preserves explicit empty state and detects version conflicts", () => {
  const seeds = indicatorMarketCatalog();
  assert.equal(loadInstalledIndicators({ getItem: () => null }, seeds).length, 1);
  assert.equal(loadInstalledIndicators({ getItem: () => "[]" }, seeds).length, 0);
  assert.equal(installIndicator(seeds, seeds[0]), seeds);
  assert.throws(() => installIndicator(seeds, { ...seeds[0], title: "Changed content" }), /different content/);
  assert.throws(() => loadInstalledIndicators({ getItem: () => JSON.stringify([{ ...seeds[0], runtime: { ...seeds[0].runtime, netlist: "0x00" } }]) }, seeds), /unreviewed/);
});

test("retained display rows outside the exclusive source window do not become executions or crash indicators",()=>{
  const start=1700000000000,end=start+120000,knownAt=end+30000;
  const market={instId:"BTC-USDT",timeframe:"1Dutc",tools:{flow:{source:"retained",status:"available",knownAt,windowStart:start,windowEnd:end,displayBucketMs:60000,displayPoints:[{ts:end,end:end+60000,buy:999,sell:0},{ts:start+60000,end,buy:3,sell:1},{ts:start-60000,end:start,buy:999,sell:0},{ts:start-1000,end:start+60000,buy:4,sell:2}]}}} as unknown as TerminalMarket;
  const input=indicatorInputFromMarket(market,"spot",knownAt);
  assert.deepEqual(input.points,[{ts:start,end:start+60000,buy:4,sell:2},{ts:start+60000,end,buy:3,sell:1}]);
  assert.equal(input.status,"partial");
  for(const manifest of indicatorMarketCatalog())assert.doesNotThrow(()=>evaluateIndicator(manifest,input));
  assert(Math.abs(evaluateIndicator(indicatorMarketCatalog()[0],input).summary.cvd!-4)<.001);
});

test("authoritative source gaps inside full-width display bars reset study warm-up and remain stream-specific",()=>{
  const start=1700000000000,end=start+240000,knownAt=end+1000;
  const points=Array.from({length:4},(_,index)=>({ts:start+index*60000,end:start+(index+1)*60000,buy:3,sell:1}));
  const missingIntervals=[{start:start+75000,end:start+90000}];
  const market={instId:"BTC-USDT",timeframe:"1H",tools:{flow:{source:"retained-spot",status:"available",knownAt,windowStart:start,windowEnd:end,displayBucketMs:60000,displayPoints:points,points:[],missingIntervals},perpetualFlow:{source:"retained-futures",status:"available",knownAt,windowStart:start,windowEnd:end,displayBucketMs:60000,displayPoints:points,points:[],missingIntervals:[]}}} as unknown as TerminalMarket;
  const input=indicatorInputFromMarket(market,"spot",knownAt);
  assert.deepEqual(input.missingIntervals,missingIntervals);
  assert.notEqual(input.missingIntervals,missingIntervals,"adapter does not expose the source array for mutation");
  assert.equal(input.status,"partial");
  const manifest=createStudyIndicatorPackage({id:"test.adapter-coverage",title:"Execution SMA 2",description:"A source-coverage-aware execution-volume moving average.",author:"Test",expression:"buy-sell",output:{label:"Execution SMA",unit:"volume",accumulation:"bar"},study:{transforms:[{kind:"sma",period:2}],plot:"line",gapPolicy:"reset",warmup:"full-window"}});
  const result=evaluateIndicator(manifest,input);
  assert.equal(result.points[0].value,undefined);
  assert.equal(result.points[1].value,undefined,"a fully timestamped aggregate is unknown when its source has an internal gap");
  assert.equal(result.points[2].value,undefined,"SMA warm-up restarts after the gap");
  assert.ok(Math.abs(result.points[3].value!-2)<0.001);
  const isolated=indicatorInputFromMarket(market,"perpetual",knownAt);
  assert.deepEqual(isolated.missingIntervals,[]);
  assert.equal(isolated.status,"available");
  assert.notEqual(evaluateIndicator(manifest,isolated).points[1].value,undefined);
});

const HOUR=3_600_000,DAY=24*HOUR,PRICE_START=Date.UTC(2026,10,8);
function completedPriceMarket():TerminalMarket {
  const observedAt=PRICE_START+3*HOUR+2000;
  const candles=Array.from({length:4},(_,index)=>({ts:PRICE_START+index*HOUR,open:100+index,high:102+index,low:99+index,close:101+index,volume:10+index,confirmed:index!==3}));
  const flow={source:"real-spot-executions",status:"available",knownAt:observedAt,windowStart:PRICE_START+2*HOUR,windowEnd:PRICE_START+3*HOUR,displayBucketMs:HOUR,displayPoints:[{ts:PRICE_START+2*HOUR,end:PRICE_START+3*HOUR,buy:30,sell:20}],points:[]};
  return {instId:"BTC-USDT",timeframe:"1H",observedAt,report:{snapshot:{source:"okx-public-spot",timeframe:"1H"},candles,currentMarket:{quote:{price:999,ts:observedAt}},entryStudy:{candles:[{...candles[0],close:888}]}},tools:{flow,perpetualFlow:{...flow,source:"real-perpetual-executions",displayPoints:[{ts:PRICE_START+2*HOUR,end:PRICE_START+3*HOUR,buy:300,sell:200}]}}} as unknown as TerminalMarket;
}

test("professional price studies use completed primary OHLCV, never the live quote, forming candle or entry study",()=>{
  const market=completedPriceMarket(),before=structuredClone(market),input=indicatorInputFromMarket(market,"perpetual",market.observedAt+10*60000);
  assert.equal(input.units,"contracts");assert.equal(input.source,"real-perpetual-executions");assert.equal(input.points[0].buy,300);
  assert(input.price);assert.equal(input.price.source,"okx-public-spot");assert.equal(input.price.knownAt,market.observedAt);assert.equal(input.price.units,"base");
  assert.equal(input.price.intervalMs,HOUR);assert.equal(input.price.status,"available");assert.equal(input.price.windowStart,PRICE_START);assert.equal(input.price.windowEnd,PRICE_START+3*HOUR);
  assert.deepEqual(input.price.candles.map(c=>c.close),[101,102,103]);assert.deepEqual(input.price.candles.map(c=>c.volume),[10,11,12]);
  assert(input.price.candles.every(c=>c.end<=market.observedAt));assert.notEqual(input.price.candles,market.report.candles);assert.deepEqual(market,before);
});

test("completed price gaps and stale source clocks stay separate from fresh execution coverage",()=>{
  const market=completedPriceMarket();market.report.candles.splice(1,1);
  const input=indicatorInputFromMarket(market,"spot",market.observedAt);
  assert.equal(input.status,"available");assert.equal(input.price!.status,"partial");assert.deepEqual(input.price!.missingIntervals,[{start:PRICE_START+HOUR,end:PRICE_START+2*HOUR}]);
  market.observedAt=PRICE_START+4*HOUR+6000;
  const stale=indicatorInputFromMarket(market,"spot",market.observedAt);
  assert.equal(stale.price!.status,"stale");assert.deepEqual(stale.price!.missingIntervals,input.price!.missingIntervals);assert.equal(stale.price!.windowEnd,PRICE_START+3*HOUR);
});

test("weekly primary prices retain UTC weekly candle ends instead of appending today's quote as a completed bar",()=>{
  const market=completedPriceMarket(),weekStart=Date.UTC(2026,9,19);
  market.timeframe="1Wutc";market.observedAt=Date.UTC(2026,10,8,10);
  market.report.candles=Array.from({length:3},(_,index)=>({ts:weekStart+index*7*DAY,open:100+index,high:102+index,low:99+index,close:101+index,volume:1000+index,confirmed:index!==2}));
  const price=indicatorInputFromMarket(market,"spot",market.observedAt).price!;
  assert.equal(price.intervalMs,7*DAY);assert.equal(price.candles.length,2);assert.equal(price.windowEnd,Date.UTC(2026,10,2));assert.deepEqual(price.candles.map(c=>c.end),[Date.UTC(2026,9,26),Date.UTC(2026,10,2)]);
  assert.equal(price.candles.at(-1)!.close,102);assert.equal(price.status,"available");
});

test("a v4 multi-plot creation installs and restores as one immutable library item",()=>{
  const manifest=createGraphIndicatorPackage({id:"trader.ema-two-plots",title:"EMA and crossover",description:"A complete portable price study with two chart outputs.",author:"Alice Quant",graph:parseIndicatorScript('average = ema(close,2)\ncondition = above(close,average)\nplot(average,"EMA 2","price","line","price","#22d3ee")\nplot(condition,"Close above EMA","indicator","histogram","scalar","#34d399")')});
  const installed=installIndicator([],manifest),restored=loadInstalledIndicators({getItem:()=>JSON.stringify(installed)},[]);
  assert.equal(installed.length,1);assert.equal(restored.length,1);assert.deepEqual(restored[0],manifest);assert.equal(installIndicator(restored,manifest),restored);
  assert.throws(()=>installIndicator(restored,{...manifest,author:"Someone else"}),/different content/);
});
