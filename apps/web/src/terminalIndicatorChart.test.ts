import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudyIndicatorPackage, createGraphIndicatorPackage, parseIndicatorScript, evaluateIndicator, indicatorMarketCatalog, indicatorStudyTemplates, type IndicatorInput } from "@pulse/domain";
import { terminalExecutionViewportKey, terminalChartIndicator, terminalChartIndicators, terminalIndicatorPrimaryClock, terminalIndicatorEvents, terminalIndicatorSpotPriceContext, terminalIndicatorPlotInfo, terminalIndicatorPriceFormat, terminalIndicatorSeries, type TerminalChartIndicator } from "./terminalIndicatorChart";

const input = (units: "base" | "contracts" = "base"): IndicatorInput => ({
  instId: "BTC-USDT", timeframe: "1Dutc", source: "retained-executions", status: "available",
  knownAt: 4_000, now: 4_000, windowStart: 1_000, windowEnd: 4_000, intervalMs: 1_000, units,
  points: [{ ts: 1_000, end: 2_000, buy: 3, sell: 1 }, { ts: 2_000, end: 3_000, buy: 1, sell: 3 }],
});
const study = (id: string, plot?: "line" | "histogram") => {
  const template = indicatorStudyTemplates().find(item => item.id === id)!;
  return createStudyIndicatorPackage({ ...template, id: `chart.${id}`, author: "Chart test", ...(plot ? { study: { ...template.study, plot } } : {}) });
};
test("chart indicators retain execution timestamps and break gaps on their own scalar series", () => {
  const series = terminalIndicatorSeries({id:"test",title:"Flow",units:"BTC",status:"partial",source:"captured",windowStart:1000,windowEnd:10000,bucketMs:1000,points:[{ts:1000,value:2},{ts:2000,value:3},{ts:6000,value:7},{ts:7000}]});
  assert.deepEqual(series,[{time:1,value:2},{time:2,value:3},{time:3},{time:6,value:7},{time:7}]);
});

test("loading retained history resets a capture viewport, while polling the same source preserves zoom", () => {
  const captured:TerminalChartIndicator={id:"rolling20",title:"Rolling delta",units:"BTC",status:"partial",source:"captured-trades",windowStart:1000,windowEnd:61000,bucketMs:1000,points:[{ts:21000,value:2}]};
  const captureKey=terminalExecutionViewportKey("BTC-USDT","1Dutc",[captured]);
  const retained={...captured,source:"retained-trades",bucketMs:3_600_000,windowStart:0,windowEnd:31*86_400_000};
  assert.notEqual(terminalExecutionViewportKey("BTC-USDT","1Dutc",[retained]),captureKey);
  assert.equal(terminalExecutionViewportKey("BTC-USDT","1Dutc",[{...retained,windowEnd:retained.windowEnd+60_000}]),terminalExecutionViewportKey("BTC-USDT","1Dutc",[retained]));
  assert.notEqual(terminalExecutionViewportKey("BTC-USDT","1Wutc",[retained]),terminalExecutionViewportKey("BTC-USDT","1Dutc",[retained]));
});

test("v3 participation converts exact basis-point output into a percent pane without changing its calculation", () => {
  const manifest = study("participation"), result = evaluateIndicator(manifest, input());
  const raw = result.points.map(point => point.value);
  const plotted = terminalChartIndicator(manifest, result, "BTC-USDT", "spot", 1_000);
  assert.equal(plotted.units, "%");
  assert.equal(plotted.plot, "line");
  assert.equal(plotted.condition?.threshold,50);
  assert.equal(plotted.condition?.label,"Above 50 %");
  assert.equal(plotted.points[0].signal,true);
  assert.equal(plotted.points[1].signal,false);
  assert.deepEqual(plotted.points.map(point => point.ts), [1_000, 2_000]);
  assert(Math.abs(plotted.points[0].value! - 75) <= .01);
  assert(Math.abs(plotted.points[1].value! - 25) <= .01);
  assert.deepEqual(result.points.map(point => point.value), raw, "display conversion must not mutate the portable result");
  assert.match(terminalIndicatorPriceFormat(plotted.units).formatter(75), /^75 %$/);
});

test("v3 histogram renders signed source values and leaves unknown intervals as whitespace", () => {
  const manifest = study("volume-delta", "histogram"), result = evaluateIndicator(manifest, input());
  const plotted = terminalChartIndicator(manifest, result, "BTC-USDT", "spot", 1_000);
  assert.equal(plotted.plot, "histogram");
  const values = terminalIndicatorSeries({ ...plotted, points: [...plotted.points, { ts: 5_000 }] });
  assert.equal(values[0].color, "#00b99c");
  assert.equal(values[1].color, "#ed6384");
  assert(Math.abs(values[0].value! - 2) < .001);
  assert(Math.abs(values[1].value! + 2) < .001);
  assert.deepEqual(values.slice(2), [{ time: 3 }, { time: 5 }]);
});

test("spot assets and futures retain their own raw quantity units across the same installed study", () => {
  for (const manifest of [indicatorMarketCatalog()[0], study("cvd"), study("weighted-flow")]) {
    const spotResult = evaluateIndicator(manifest, input("base"));
    const futuresResult = evaluateIndicator(manifest, input("contracts"));
    const btc = terminalChartIndicator(manifest, spotResult, "BTC-USDT", "spot");
    const eth = terminalChartIndicator(manifest, spotResult, "ETH-USDT", "spot");
    const futures = terminalChartIndicator(manifest, futuresResult, "BTC-USDT-SWAP", "perpetual");
    assert.equal(btc.id, futures.id, "the installed identity stays the same across stream switches");
    assert.equal(btc.units, "BTC");
    assert.equal(eth.units, "ETH");
    assert.equal(futures.units, "contracts");
    assert.deepEqual(btc.points, futures.points, "unit labels must not silently convert contract counts to BTC");
    assert.match(terminalIndicatorPriceFormat(btc.units).formatter(2), / BTC$/);
    assert.match(terminalIndicatorPriceFormat(futures.units).formatter(2), / contracts$/);
  }
});

test("chart legend counts only actual finite plotted readings and reports their real source times", () => {
  const data = [{ time: 1, value: 2 }, { time: 2 }, { time: 3, value: NaN }, { time: 4, value: -1 }, { time: "2026-11-02", value: 5 }];
  assert.deepEqual(terminalIndicatorPlotInfo("BTC", data), { units: "BTC", points: 2, firstTs: 1_000, lastTs: 4_000 });
  assert.deepEqual(terminalIndicatorPlotInfo("contracts", [{ time: 1 }, { time: 2, value: Infinity }]), { units: "contracts", points: 0 });
});

test("micro inspection plots captured Spot prices, with no invented price through source gaps",()=>{
  const row=(ts:number,priceClose:number)=>({ts,end:ts+1000,buy:1,sell:0,delta:1,cvd:1,priceOpen:priceClose,priceHigh:priceClose,priceLow:priceClose,priceClose,tradeCount:1});
  const flow={source:"captured-spot",status:"partial" as const,knownAt:5000,windowStart:1000,windowEnd:5000,displayBucketMs:1000,points:[],missingIntervals:[{start:2000,end:3000}],displayPoints:[row(4000,75200),row(0,99999),row(1000,75000),row(2000,99999),row(3000,75100),row(5000,99999)]};
  const context=terminalIndicatorSpotPriceContext(flow)!;
  assert.deepEqual(context.points,[{ts:1000,value:75000},{ts:3000,value:75100},{ts:4000,value:75200}]);
  assert.equal(context.source,"captured-spot");assert.equal(context.bucketMs,1000);
  assert.equal(terminalIndicatorSpotPriceContext({...flow,displayPoints:[]}),undefined);
});

const graphManifest=(script:string)=>createGraphIndicatorPackage({id:"chart.professional",title:"Professional chart tool",description:"Actual source-bound calculations with explicit chart placement and units.",author:"Alice Quant",graph:parseIndicatorScript(script)});
function priceAndFuturesInput():IndicatorInput {
  return {...input("contracts"),knownAt:4000,windowStart:1000,windowEnd:4000,intervalMs:1000,points:[{ts:1000,end:2000,buy:300,sell:100},{ts:2000,end:3000,buy:100,sell:300},{ts:3000,end:4000,buy:200,sell:100}],price:{source:"completed-spot-OHLCV",knownAt:4000,status:"available",units:"base",windowStart:1000,windowEnd:4000,intervalMs:1000,candles:[{ts:1000,end:2000,open:100,high:102,low:99,close:101,volume:10},{ts:2000,end:3000,open:101,high:103,low:100,close:102,volume:11},{ts:3000,end:4000,open:102,high:104,low:101,close:103,volume:12}]}};
}

test("v4 multi-plot studies retain publisher, exact source interval, colors and price versus oscillator panes",()=>{
  const manifest=graphManifest('average = ema(close,2)\ncondition = above(close,average)\nplot(average,"EMA 2","price","line","price","#22d3ee")\nplot(condition,"Close above EMA","indicator","histogram","scalar","#34d399")'),result=evaluateIndicator(manifest,priceAndFuturesInput()),before=structuredClone(result);
  const plotted=terminalChartIndicators(manifest,result,"BTC-USDT","perpetual",60000);
  assert.equal(plotted.length,2);assert.equal(plotted[0].publisher,"Alice Quant");assert.equal(plotted[1].publisher,"Alice Quant");
  assert.equal(plotted[0].parentId,`${manifest.id}@${manifest.version}`);assert.notEqual(plotted[0].id,plotted[1].id);assert.equal(plotted[0].pane,"price");assert.equal(plotted[0].units,"USDT");assert.equal(plotted[0].color,"#22d3ee");
  assert.equal(plotted[1].pane,"indicator");assert.equal(plotted[1].units,"scalar");assert.equal(plotted[1].plot,"histogram");assert.notEqual(plotted[0].group,plotted[1].group);
  assert(plotted.every(p=>p.bucketMs===1000));assert.deepEqual(plotted[0].points.map(p=>p.ts),[1000,2000,3000]);assert.equal(plotted[0].points[0].value,undefined);assert.equal(plotted[0].points[1].value,101.5);
  plotted[0].points[1].value=999;assert.deepEqual(result,before,"Chart adapters must not mutate immutable source results");
});

test("Spot candle volume stays in BTC while a separately selected Futures execution study stays in contracts",()=>{
  const data=priceAndFuturesInput();
  const spotVolume=graphManifest('plot(volume,"Spot candle volume","indicator","histogram","volume","#22d3ee")'),flow=graphManifest('delta = tap_delta(buy,sell)\nplot(delta,"Futures executed delta","indicator","histogram","volume","#fbbf24")');
  const candleResult=evaluateIndicator(spotVolume,data),flowResult=evaluateIndicator(flow,data);
  assert.equal(candleResult.outputs![0].quantitySource,"price");assert.equal(candleResult.outputs![0].quantityUnits,"base");assert.equal(flowResult.outputs![0].quantitySource,"executions");assert.equal(flowResult.outputs![0].quantityUnits,"contracts");
  const candle=terminalChartIndicators(spotVolume,candleResult,"BTC-USDT","perpetual")[0],executed=terminalChartIndicators(flow,flowResult,"BTC-USDT","perpetual")[0];
  assert.equal(candle.units,"BTC");assert.deepEqual(candle.points.map(p=>p.value),[10,11,12]);assert.equal(executed.units,"contracts");assert.notEqual(candle.group,executed.group);assert.equal(candle.source,"completed-spot-OHLCV");assert.equal(executed.source,"retained-executions");
  assert(Math.abs(executed.points[0].value!-200)<.01);assert(Math.abs(executed.points[1].value!+200)<.01);
});

test("compatible graph outputs share a pane group and percentage readings do not acquire volume units",()=>{
  const manifest=graphManifest('average = sma(close,2)\nupper = ema(high,2)\nstrength = rsi(close,1)\nplot(average,"Average","price","line","price","#22d3ee")\nplot(upper,"Upper","price","line","price","#fbbf24")\nplot(strength,"RSI","indicator","line","percent","#a78bfa")');
  const result=evaluateIndicator(manifest,priceAndFuturesInput()),plotted=terminalChartIndicators(manifest,result,"ETH-USDC","perpetual");
  assert.equal(plotted[0].group,plotted[1].group);assert.equal(plotted[0].units,"USDC");assert.equal(plotted[2].units,"%");assert.notEqual(plotted[2].group,plotted[0].group);assert.equal(plotted[2].points.at(-1)!.value,100);
});

test("condition markers represent new episodes and skip unknown or partial observations",()=>{
  const points=[{ts:1000,value:2,signal:true},{ts:2000,value:3,signal:true},{ts:3000,value:-1,signal:false},{ts:4000,value:2,signal:true},{ts:5000,value:3,signal:true,partial:true},{ts:6000,value:4,signal:true},{ts:7000,signal:true},{ts:8000,value:2,signal:true},{ts:9000,value:2,signal:false,reset:true},{ts:10000,value:3,signal:true}];
  const chart:TerminalChartIndicator={id:"event-test",title:"Episode condition",units:"BTC",status:"partial",source:"executed",windowStart:1000,windowEnd:11000,points};
  assert.deepEqual(terminalIndicatorEvents(chart).map(p=>p.ts),[1000,4000,6000,8000,10000]);assert.deepEqual(chart.points,points);
});

test("a reset graph crossover does not draw a new signal before later complete candles establish a crossing",()=>{
  const data=priceAndFuturesInput(),manifest=graphManifest('boundary = constant(101.5)\ncondition = crossover(close,boundary)\nplot(condition,"Cross","indicator","histogram","scalar","#34d399")');
  data.price!.missingIntervals=[{start:2000,end:3000}];
  const result=evaluateIndicator(manifest,data),plotted=terminalChartIndicators(manifest,result,"BTC-USDT","spot")[0];
  assert.equal(result.status,"partial");assert.deepEqual(terminalIndicatorEvents(plotted),[]);assert.equal(plotted.points[1].value,undefined);assert.equal(plotted.points[2].signal,undefined);
});


test("daily overview does not inject minute timestamps between genuine primary candles",()=>{
  const day=86400000,start=Date.UTC(2026,10,7),primary=[{ts:start},{ts:start+day}];
  const study:TerminalChartIndicator={id:"micro",title:"Flow",units:"BTC",status:"partial",source:"executions",windowStart:start,windowEnd:start+3*day,points:[{ts:start+1000,value:1},{ts:start+2000,value:2},{ts:start+day+60000,value:3},{ts:start+2*day+1000,value:4}]};
  const before=structuredClone(study),sampled=terminalIndicatorPrimaryClock(study,primary,"1Dutc");assert.deepEqual(sampled.points.map(p=>[p.ts,p.value]),[[start,2],[start+day,3],[start+2*day,4]]);assert.deepEqual(study,before);assert.equal(sampled.bucketMs,undefined);
});

test("genuine missing candle intervals remain unknown rather than receiving fabricated readings",()=>{
 const day=86400000,start=Date.UTC(2026,10,7);const study:TerminalChartIndicator={id:"missing",title:"Flow",units:"BTC",status:"partial",source:"executions",windowStart:start,windowEnd:start+4*day,points:[{ts:start+day+1000,value:1},{ts:start+2*day+1000,value:2}]};assert.deepEqual(terminalIndicatorPrimaryClock(study,[{ts:start},{ts:start+2*day}],"1Dutc").points,[{ts:start+2*day,value:2}]);
});
