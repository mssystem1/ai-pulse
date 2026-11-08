import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudyIndicatorPackage, evaluateIndicator, indicatorMarketCatalog, indicatorStudyTemplates, type IndicatorInput } from "@pulse/domain";
import { terminalChartIndicator, terminalIndicatorSpotPriceContext, terminalIndicatorPlotInfo, terminalIndicatorPriceFormat, terminalIndicatorSeries } from "./terminalIndicatorChart";

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
