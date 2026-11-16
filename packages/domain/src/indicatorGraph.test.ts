import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphIndicatorPackage, evaluateIndicator, exportIndicatorPackage, indicatorGraphTemplates, parseIndicatorGraph, parseIndicatorPackage, parseIndicatorScript, serializeIndicatorScript, type IndicatorInput, type IndicatorGraphDefinition } from "./indicatorMarket.js";

const start = 1000000, width = 60000;
function input(closes: number[], changes: Partial<IndicatorInput> = {}): IndicatorInput {
  const end = start + closes.length * width;
  return { instId: "BTC-USDT", timeframe: "1H", source: "real-executions", status: "unavailable", knownAt: end, windowStart: start, windowEnd: end, units: "base", points: [], now: end,
    price: { source: "real-completed-OHLCV", status: "available", knownAt: end, windowStart: start, windowEnd: end, intervalMs: width, candles: closes.map((close, i) => ({ ts: start + i * width, end: start + (i + 1) * width, open: close, high: close + 1, low: close - 1, close, volume: 100 + i })) }, ...changes };
}
function packageFor(script: string) { return createGraphIndicatorPackage({ id: "trader.professional", title: "Professional study", description: "Actual completed source data and a bounded causal financial calculation.", author: "Test publisher", graph: parseIndicatorScript(script) }); }
function values(script: string, closes: number[]) { return evaluateIndicator(packageFor(script), input(closes)).outputs![0].points.map(point => point.value); }
const plot = '\nplot(value,"Result","indicator","line","scalar","#22d3ee")';

test("all six graph templates compile, export and parse without changing bytes or publisher", () => {
  assert.equal(indicatorGraphTemplates().length, 6);
  for (const template of indicatorGraphTemplates()) {
    const manifest = createGraphIndicatorPackage({ ...template, id: `trader.${template.id}`, author: "Alice Quant" });
    assert.equal(manifest.author, "Alice Quant");
    assert.deepEqual(parseIndicatorPackage(exportIndicatorPackage(manifest)), manifest);
    const reparsed = parseIndicatorScript(serializeIndicatorScript(template.graph));
    const actual = createGraphIndicatorPackage({ ...template, id: `trader.${template.id}`, author: "Alice Quant", graph: reparsed });
    if (template.id !== "tap-flow") {
      const data = input(Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 4) * 7 + i / 10));
      assert.deepEqual(evaluateIndicator(actual, data).outputs!.map(output => output.points), evaluateIndicator(manifest, data).outputs!.map(output => output.points));
    }
  }
});

test("EMA and SMA have full-window seeds and causal calculations", () => {
  assert.deepEqual(values('value = sma(close,3)' + plot, [10, 20, 30, 40, 50]), [undefined, undefined, 20, 30, 40]);
  assert.deepEqual(values('value = ema(close,3)' + plot, [10, 20, 30, 50, 70]), [undefined, undefined, 20, 35, 52.5]);
  assert.deepEqual(values('value = sum(close,3)' + plot, [10, 20, 30, 40]), [undefined, undefined, 60, 90]);
  assert.deepEqual(values('value = lag(close,2)' + plot, [10, 20, 30, 40]), [undefined, undefined, 10, 20]);
});

test("Bollinger bands use population deviation and retain three price overlays", () => {
  const manifest = packageFor('middle = sma(close,3)\ndeviation = stddev(close,3)\nwidth = mul(deviation,2)\nupper = add(middle,width)\nlower = sub(middle,width)\nplot(middle,"Middle","price","line","price","#fbbf24")\nplot(upper,"Upper","price","line","price","#22d3ee")\nplot(lower,"Lower","price","line","price","#a78bfa")');
  const result = evaluateIndicator(manifest, input([10, 20, 30]));
  assert.equal(result.outputs!.length, 3);
  assert.equal(result.outputs![0].points[2].value, 20);
  assert.ok(Math.abs(result.outputs![1].points[2].value! - (20 + 2 * Math.sqrt(200 / 3))) < 1e-10);
  assert.ok(Math.abs(result.outputs![2].points[2].value! - (20 - 2 * Math.sqrt(200 / 3))) < 1e-10);
  assert.equal(result.provenance.execution, "local-causal-graph");
  assert.equal(result.provenance.graph!.kernel, "not-used");
  assert.equal(result.provenance.gateCount, 0);
});

test("RSI uses Wilder smoothing, requires changes, resolves flat/rising/falling correctly", () => {
  assert.deepEqual(values('value = rsi(close,3)' + plot, [10, 10, 10, 10, 10]), [undefined, undefined, undefined, 50, 50]);
  assert.deepEqual(values('value = rsi(close,3)' + plot, [10, 11, 12, 13, 14]), [undefined, undefined, undefined, 100, 100]);
  assert.deepEqual(values('value = rsi(close,3)' + plot, [14, 13, 12, 11, 10]), [undefined, undefined, undefined, 0, 0]);
  const mixed = values('value = rsi(close,3)' + plot, [10, 12, 11, 14, 13]);
  assert.ok(Math.abs(mixed[3]! - 100 * 5 / 6) < 1e-10);
  assert.ok(Math.abs(mixed[4]! - 100 * (10 / 9) / (10 / 9 + 5 / 9)) < 1e-10);
});

test("ATR uses gaps relative to prior close and Wilder smoothing", () => {
  const result = values('value = atr(3)' + plot, [10, 20, 15, 16]);
  assert.deepEqual(result.slice(0, 2), [undefined, undefined]);
  assert.ok(Math.abs(result[2]! - 19 / 3) < 1e-10); // TR2,11,6
  assert.ok(Math.abs(result[3]! - (19 / 3 * 2 + 2) / 3) < 1e-10);
});

test("future candles cannot alter earlier graph readings or trigger a crossover retrospectively", () => {
  const manifest = packageFor('fast = ema(close,2)\nslow = sma(close,3)\nvalue = crossover(fast,slow)' + plot);
  const prefix = [10, 11, 12, 10, 9, 11], first = evaluateIndicator(manifest, input(prefix));
  const extended = evaluateIndicator(manifest, input([...prefix, 10000000, 3]));
  assert.deepEqual(extended.points.slice(0, prefix.length), first.points);
  assert.equal(first.points[0].signal, undefined);
  assert.ok(first.points.some(point => point.signal === true));
});

test("missing price intervals reset smoothing and cross memory without invented observations", () => {
  const data = input([10, 20, 30, 40, 50, 60, 70]);
  data.price!.candles = data.price!.candles.filter((_, i) => i !== 3);
  const result = evaluateIndicator(packageFor('value = sma(close,3)' + plot), data);
  assert.equal(result.status, "partial");
  assert.equal(result.points.length, 6);
  assert.deepEqual(result.points.map(point => point.value), [undefined, undefined, 20, undefined, undefined, 60]);
  assert.equal(result.points[3].reset, true);
  assert.equal(result.provenance.graph!.resetCount, 1);
});

test("verified internal missing intervals are unknown and require fresh warm-up", () => {
  const data = input([10, 20, 30, 40, 50, 60]);
  data.price!.missingIntervals = [{ start: start + 2 * width, end: start + 3 * width }];
  const result = evaluateIndicator(packageFor('value = sma(close,2)' + plot), data);
  assert.deepEqual(result.points.map(point => point.value), [undefined, 15, undefined, undefined, 45, 55]);
  assert.equal(result.status, "partial");
});

test("partial captured bars do not count toward warm-up", () => {
  const data = input([10, 20, 30, 40]);
  data.price!.candles = data.price!.candles.map((bar, i) => i === 1 ? { ...bar, end: bar.end - 1000 } : bar);
  const result = evaluateIndicator(packageFor('value = sma(close,2)' + plot), data);
  assert.deepEqual(result.points.map(point => point.value), [undefined, undefined, undefined, 35]);
  assert.equal(result.status, "partial");
});

test("incomplete future candles and malformed OHLC never become completed indicator readings", () => {
  const manifest = packageFor('value = ema(close,2)' + plot);
  const data = input([10, 20, 30]); data.price!.knownAt--;
  assert.throws(() => evaluateIndicator(manifest, data), /incomplete/);
  const invalid = input([10, 20]); invalid.price!.candles = invalid.price!.candles.map((bar, i) => i ? { ...bar, low: 30 } : bar);
  assert.throws(() => evaluateIndicator(manifest, invalid), /OHLCV/);
});

test("OHLC studies remain usable when aggressor flow is absent; no manufactured buy/sell values", () => {
  const data = input([10, 20, 30]);
  assert.equal(evaluateIndicator(packageFor('value = sma(close,2)' + plot), data).status, "available");
  const flow = evaluateIndicator(packageFor('value = tap_delta(buy,sell)' + plot), data);
  assert.equal(flow.status, "unavailable"); assert.equal(flow.points.length, 0);
});

test("mixed OHLC and executions require exact genuine completed source alignment", () => {
  const data = input([10, 20, 30], { status: "available", intervalMs: width, points: [0, 1, 2].map(i => ({ ts: start + i * width, end: start + (i + 1) * width, buy: 8 + i, sell: 2 })) });
  const manifest = packageFor('delta = tap_delta(buy,sell)\nvalue = mul(close,delta)' + plot);
  const result = evaluateIndicator(manifest, data);
  assert.equal(result.status, "available");
  assert.ok(Math.abs(result.points[0].value! - 60) < .001);
  const mismatch = { ...data, points: data.points.map(bar => ({ ...bar, end: bar.end! - 1 })) };
  assert.equal(evaluateIndicator(manifest, mismatch).points.every(point => point.value === undefined), true);
  assert.equal(evaluateIndicator(manifest, mismatch).status, "partial");
});

test("Tapeout kernel graphs run actual NAND and report host versus kernel responsibilities", () => {
  const data = input([10, 20, 30], { status: "available", intervalMs: width, points: [0, 1, 2].map(i => ({ ts: start + i * width, end: start + (i + 1) * width, buy: 12 + i, sell: 8 })) });
  const result = evaluateIndicator(packageFor('delta = tap_delta(buy,sell)\nvalue = cumulative(delta)' + plot), data);
  assert.equal(result.provenance.graph!.kernel, "tap-02-delta");
  assert.ok(result.provenance.gateCount > 100);
  assert.ok(Math.abs(result.points[0].value! - 4) < .001);
  assert.ok(Math.abs(result.points[2].value! - 15) < .001);
  assert.equal(result.provenance.graph!.sourceKind, "executed-flow");
  assert.throws(() => packageFor('value = tap_delta(close,volume)' + plot), /actual unmodified executed/);
});

test("sequential stages require separate later candles and expire within the chosen budget", () => {
  const script = 'sweep = below(close,10)\nreclaim = above(close,10)\nhold = above(low,10)\nvalue = sequence(sweep,reclaim,hold,3)' + plot;
  assert.deepEqual(values(script, [9, 12, 12, 12]), [0, 0, 1, 0]);
  assert.deepEqual(values(script, [9, 10, 10, 10, 12, 12]), [0, 0, 0, 0, 0, 0]);
  assert.throws(() => packageFor('smooth = ema(close,2)\nvalue = sequence(smooth,smooth,3)' + plot), /comparison/);
});

test("sample holds the swept level until a new capture and resets across real source gaps", () => {
  const script = 'boundary = lag(low,1)\nsweep = below(low,boundary)\nvalue = sample(boundary,sweep)' + plot;
  assert.deepEqual(values(script, [10, 9, 12, 14]), [undefined, 9, 9, 9]);
  const data = input([10, 9, 12, 14]); data.price!.candles = data.price!.candles.filter((_, index) => index !== 2);
  const result = evaluateIndicator(packageFor(script), data);
  assert.deepEqual(result.points.map(point => point.value), [undefined, 9, undefined]);
});

test("division by zero remains unknown and resets dependent cumulative state", () => {
  const script = 'denom = sub(close,10)\nratio = div(close,denom)\nvalue = cumulative(ratio)' + plot;
  assert.deepEqual(values(script, [20, 10, 20]), [2, undefined, 2]);
});

test("bounded language rejects executable code, future refs, cycles, duplicate nodes and bad periods", () => {
  for (const script of ['value = eval(close)' + plot, 'value = ema(later,20)' + plot, 'value = ema(close,-1)' + plot, 'value = ema(close,201)' + plot, 'value = sma(close,2)\nvalue = sma(close,3)' + plot, 'value = require("fs")' + plot, 'value = window.location(close)' + plot, 'while (true) {}']) assert.throws(() => packageFor(script), /Indicator graph/);
  const graph = parseIndicatorScript('value = ema(close,2)' + plot);
  const cyclic = structuredClone(graph); (cyclic.nodes[0] as unknown as { kind: string; left: string; right: string }).kind = "add";
  assert.throws(() => parseIndicatorGraph(cyclic), /Indicator graph/);
  const tooMany = { ...graph, plots: Array.from({ length: 9 }, (_, i) => ({ ...graph.plots[0], id: `plot${i}` })) };
  assert.throws(() => parseIndicatorGraph(tooMany), /1-8/);
});

test("price overlays reject RSI, flow, constants and smoothed percentage units", () => {
  for (const script of ['value = rsi(close,2)', 'value = ema(buy,2)', 'value = constant(100)', 'r = rsi(close,2)\nvalue = ema(r,2)']) assert.throws(() => packageFor(script + '\nplot(value,"Bad overlay","price","line","price","#22d3ee")'), /asset-price scale/);
});

test("plot labels round-trip quoted commas and escaped text without executing it", () => {
  const graph = parseIndicatorScript('value = ema(close,2)\nplot(value,"EMA, \\"quoted\\"","price","line","price","#22d3ee")');
  assert.equal(graph.plots[0].label, 'EMA, "quoted"');
  assert.deepEqual(parseIndicatorScript(serializeIndicatorScript(graph)).plots[0].label, graph.plots[0].label);
});

test("stale source status stays visible and illegal package claims are rejected", () => {
  const manifest = packageFor('value = ema(close,2)' + plot), data = input([10, 20, 30]); data.now = data.knownAt + 600000;
  assert.equal(evaluateIndicator(manifest, data).status, "stale");
  assert.throws(() => parseIndicatorPackage({ ...manifest, publication: { chainId: 196, registered: true } }), /publication/);
  const future = input([10, 20]); future.price!.knownAt = future.now! + 40000;
  assert.throws(() => evaluateIndicator(manifest, future), /clock/);
});

test("per-plot quantity lineage keeps Spot candle volume distinct from Futures contracts", () => {
  const data = input([10, 20, 30], { units: "contracts", status: "available", intervalMs: width, points: [0, 1, 2].map(i => ({ ts: start + i * width, end: start + (i + 1) * width, buy: 8 + i, sell: 2 })) });
  const manifest = packageFor('delta = tap_delta(buy,sell)\nplot(volume,"Spot candle volume","indicator","histogram","volume","#22d3ee")\nplot(delta,"Futures delta","indicator","histogram","volume","#fbbf24")');
  const result = evaluateIndicator(manifest, data);
  assert.equal(result.outputs![0].quantitySource, "price");
  assert.equal(result.outputs![0].quantityUnits, "base");
  assert.equal(result.outputs![1].quantitySource, "executions");
  assert.equal(result.outputs![1].quantityUnits, "contracts");
  assert.equal(result.provenance.graph!.priceUnits, "base");
  assert.equal(result.provenance.graph!.executionUnits, "contracts");
  const incompatible = packageFor('value = add(volume,buy)\nplot(value,"Invalid mixed quantities","indicator","histogram","volume","#22d3ee")');
  assert.throws(() => evaluateIndicator(incompatible, data), /contract conversion/);
  assert.throws(() => packageFor('value = ema(close,2)\nplot(value,"False volume label","indicator","line","volume","#22d3ee")'), /units/);
});


test("a new sweep restarts a pending stateflow instead of completing an older captured boundary",()=>{
 const script='sweep = below(close,10)\nreclaim = above(close,10)\nhold = above(low,10)\nvalue = sequence(sweep,reclaim,hold,5)'+plot;
 assert.deepEqual(values(script,[9,12,9,12,12]),[0,0,0,0,1]);
});
