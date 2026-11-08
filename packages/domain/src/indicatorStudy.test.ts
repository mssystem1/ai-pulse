import test from "node:test";
import assert from "node:assert/strict";
import { createStudyIndicatorPackage, evaluateIndicator, evaluateIndicatorCircuit, evaluateIndicatorStudySeries, exportIndicatorPackage, indicatorMarketCatalog, indicatorStudyTemplates, parseIndicatorPackage, parseIndicatorStudyDefinition, type IndicatorInput, type IndicatorStudyDefinition, type IndicatorStudyTransform } from "./indicatorMarket.js";

const study = (transforms: IndicatorStudyTransform[] = []): IndicatorStudyDefinition => ({ transforms, plot: "histogram", gapPolicy: "reset", warmup: "full-window" });
const samples = (values: (number | undefined)[]) => values.map((value, ts) => ({ ts, ...(value === undefined ? {} : { value }) }));
const template = (id: string) => {
  const chosen = indicatorStudyTemplates().find(item => item.id === id)!;
  return createStudyIndicatorPackage({ ...chosen, id: `test.${id}`, author: "Test creator" });
};
const source = (volumes: [number, number][], overrides: Partial<IndicatorInput> = {}): IndicatorInput => ({
  instId: "BTC-USDT", timeframe: "1D", source: "retained-spot-executions", status: "available", knownAt: (volumes.length + 1) * 1000,
  windowStart: 1000, windowEnd: (volumes.length + 1) * 1000, now: (volumes.length + 1) * 1000, units: "base", intervalMs: 1000,
  points: volumes.map(([buy, sell], index) => ({ ts: (index + 1) * 1000, end: (index + 2) * 1000, buy, sell })), ...overrides,
});

test("professional study templates compile real per-bar NAND kernels and preserve all declared series settings", () => {
  const catalogBefore = indicatorMarketCatalog();
  const templates = indicatorStudyTemplates();
  assert.equal(templates.length, 6);
  assert.deepEqual(templates.map(item => item.id), ["volume-delta", "cvd", "participation", "delta-ema", "rolling-delta", "weighted-flow"]);
  for (const item of templates) {
    const manifest = template(item.id);
    assert.equal(manifest.format, "pulse-indicator-v3");
    assert.equal(manifest.kernel, "formula-v1");
    assert.deepEqual(parseIndicatorPackage(exportIndicatorPackage(manifest)), manifest);
    assert.ok((manifest.runtime.netlist.length - 2) / 14 < 40000);
  }
  assert.deepEqual(indicatorMarketCatalog(), catalogBefore, "existing registered builtins keep their exact package and netlist");
  assert.equal(evaluateIndicatorCircuit(template("weighted-flow"), { buy: 120, sell: 80 }).valueQ, 160);
  assert.equal(evaluateIndicatorCircuit(template("participation"), { buy: 120, sell: 80 }).valueQ, 6000);
});

test("SMA and rolling sum wait for a complete contiguous source window", () => {
  const raw = samples([1, 3, 5, 7]);
  assert.deepEqual(evaluateIndicatorStudySeries(raw, study([{ kind: "sma", period: 3 }])).map(p => p.value), [undefined, undefined, 3, 5]);
  assert.deepEqual(evaluateIndicatorStudySeries(raw, study([{ kind: "sum", period: 3 }])).map(p => p.value), [undefined, undefined, 9, 15]);
});

test("EMA uses a full-window SMA seed and causal standard smoothing", () => {
  const result = evaluateIndicatorStudySeries(samples([1, 3, 5, 7, 9]), study([{ kind: "ema", period: 3 }]));
  assert.deepEqual(result.map(point => point.value), [undefined, undefined, 3, 5, 7]);
  assert.deepEqual(result.map(point => point.rawValue), [1, 3, 5, 7, 9]);
});

test("a composed pipeline warms each downstream stage using only resolved upstream values", () => {
  const result = evaluateIndicatorStudySeries(samples([1, 3, 5, 7, 9]), study([{ kind: "sma", period: 2 }, { kind: "sum", period: 3 }]));
  assert.deepEqual(result.map(point => point.value), [undefined, undefined, undefined, 12, 18]);
});

test("unknown observations and verified gaps restart cumulative and smoothing state", () => {
  assert.deepEqual(evaluateIndicatorStudySeries(samples([2, 3, undefined, 4, 5]), study([{ kind: "cumulative" }])).map(point => point.value), [2, 5, undefined, 4, 9]);
  const raw = samples([1, 3, 5, 7, 9]); raw[3] = { ...raw[3], reset: true } as typeof raw[number];
  assert.deepEqual(evaluateIndicatorStudySeries(raw, study([{ kind: "sma", period: 2 }])).map(point => point.value), [undefined, 2, 4, undefined, 8]);
});

test("threshold conditions are observations and crossover has no remembered value across a gap", () => {
  const definition = { ...study(), signal: { kind: "cross-above" as const, threshold: 0, label: "Delta crossed above zero" } };
  const output = evaluateIndicatorStudySeries(samples([-1, 0, 1, 2, undefined, 3, -1, 1]), definition);
  assert.deepEqual(output.map(point => point.signal), [undefined, false, true, false, undefined, undefined, false, true]);
  assert.deepEqual(evaluateIndicatorStudySeries(samples([-1, 0, 1]), { ...study(), signal: { kind: "below", threshold: 0, label: "Delta below zero" } }).map(point => point.signal), [true, false, false]);
  assert.deepEqual(evaluateIndicatorStudySeries(samples([1, 0, -1]), { ...study(), signal: { kind: "cross-below", threshold: 0, label: "Delta crossed below zero" } }).map(point => point.signal), [undefined, false, true]);
});

test("real source-volume studies preserve quantity units and expose honest kernel/series provenance", () => {
  const manifest = template("cvd"), result = evaluateIndicator(manifest, source([[3, 1], [2, 5], [4, 2]]));
  assert.ok(Math.abs(result.summary.value! - 1) < 0.001);
  assert.equal(result.points.length, 3);
  assert.equal(result.provenance.execution, "local-tap02");
  assert.equal(result.provenance.series?.execution, "causal-host-series-v1");
  assert.equal(result.provenance.series?.kernel, "tap-02-per-bar");
  assert.equal(result.provenance.series?.sourceIntervalMs, 1000, "source bars do not inherit the primary 1D price timeframe");
  assert.equal(result.provenance.series?.resolvedPoints, 3);
  assert.equal(result.provenance.registered, false);
});

test("basis-point templates remain in exact basis-point ABI units for chart percentage conversion", () => {
  const result = evaluateIndicator(template("participation"), source([[3, 1], [1, 3]]));
  assert.ok(Math.abs(result.points[0].value! - 7500) <= 1);
  assert.equal(result.points[0].signal, true);
  assert.equal(result.points[1].signal, false);
  assert.ok(Math.abs(result.points[1].value! / 100 - 25) <= 0.01);
  assert.match(result.precision.note, /100 bps = 1%/);
});

test("eight-bar delta EMA and twenty-bar rolling delta produce useful source-driven values after warm-up", () => {
  const ema = evaluateIndicator(template("delta-ema"), source(Array.from({ length: 9 }, () => [3, 1])));
  assert.equal(ema.points[6].value, undefined);
  assert.ok(Math.abs(ema.points[7].value! - 5000) <= 1);
  const sum = evaluateIndicator(template("rolling-delta"), source(Array.from({ length: 21 }, () => [3, 1])));
  assert.equal(sum.points[18].value, undefined);
  assert.ok(Math.abs(sum.points[19].value! - 40) < 0.01);
  assert.equal(sum.provenance.series?.resolvedPoints, 2);
});

test("future volume cannot rescale historical study values or inject lookahead into rolling stages", () => {
  const manifest = template("cvd"), prefix = [[3, 1], [2, 5], [4, 2]] as [number, number][];
  const earlier = evaluateIndicator(manifest, source(prefix));
  const extended = evaluateIndicator(manifest, source([...prefix, [100000000, 1]]));
  assert.deepEqual(extended.points.slice(0, prefix.length), earlier.points);
  const rolling = { ...template("volume-delta"), study: study([{ kind: "ema", period: 2 }]) };
  assert.deepEqual(evaluateIndicator(rolling, source([...prefix, [100000000, 1]])).points.slice(0, prefix.length), evaluateIndicator(rolling, source(prefix)).points);
});

test("omitted source intervals reset state while missing covered bars remain unknown", () => {
  const input = source([[3, 1], [2, 1], [4, 1], [5, 1]]);
  const omitted = { ...input, points: [input.points[0], input.points[2], input.points[3]] };
  const result = evaluateIndicator(template("cvd"), omitted);
  assert.equal(result.status, "partial");
  assert.equal(result.points[1].reset, true);
  assert.ok(Math.abs(result.points[1].value! - 3) < 0.001, "cumulative segment does not bridge unknown intervals");
  const missing = evaluateIndicator(template("cvd"), { ...input, missingIntervals: [{ start: 2000, end: 3000 }] });
  assert.equal(missing.points[1].value, undefined);
  assert.ok(Math.abs(missing.points[2].value! - 3) < 0.001);
  assert.equal(missing.provenance.series?.resetCount, 1);
});

test("source-bar ends are used for gaps without guessing the primary timeframe", () => {
  const input = source([[2, 1], [2, 1], [2, 1]]);
  const withoutInterval = { ...input, intervalMs: undefined };
  assert.ok(Math.abs(evaluateIndicator(template("cvd"), withoutInterval).summary.value! - 3) < 0.001);
  const timestampsOnly = { ...withoutInterval, points: input.points.map(({ end: _end, ...point }) => point) };
  assert.ok(Math.abs(evaluateIndicator(template("cvd"), timestampsOnly).summary.value! - 3) < 0.001, "unknown cadence must not manufacture gaps");
});

test("zero-volume ratios are unknown, cannot fabricate participation or smoothing continuity", () => {
  const output = evaluateIndicator(template("participation"), source([[3, 1], [0, 0], [3, 1]]));
  assert.equal(output.points[1].value, undefined);
  assert.equal(output.points[1].signal, undefined);
  assert.throws(() => evaluateIndicatorCircuit(template("participation"), { buy: 0, sell: 0 }), /division by zero/);
});

test("clipped source edges cannot satisfy a rolling window or preserve cumulative state", () => {
  const base = source(Array.from({ length: 22 }, () => [3, 1]));
  const points = base.points.map((point, index) => index === 0 ? { ...point, ts: 1500 } : index === 21 ? { ...point, end: 22500 } : point);
  const input = { ...base, points, windowStart: 1500, windowEnd: 22500, knownAt: 22500, now: 22500 };
  const rolling = evaluateIndicator(template("rolling-delta"), input);
  assert.equal(rolling.status, "partial");
  assert.equal(rolling.points[0].partial, true);
  assert.equal(rolling.points[0].value, undefined);
  assert.equal(rolling.points[19].value, undefined, "nineteen complete bars plus one partial bar are not a twenty-bar window");
  assert.ok(Math.abs(rolling.points[20].value! - 40) < 0.01);
  assert.equal(rolling.points[21].value, undefined);
  assert.equal(rolling.points[21].partial, true);
  assert.equal(rolling.provenance.series?.partialBucketCount, 2);
  assert.match(rolling.reason!, /do not count toward rolling or cumulative warm-up/);
  const cumulative = evaluateIndicator(template("cvd"), input);
  assert.equal(cumulative.points[0].value, undefined);
  assert.ok(Math.abs(cumulative.points[1].value! - 2) < 0.001);
  assert.equal(cumulative.points[21].value, undefined);
});

test("per-bar captured readings remain useful and explicitly partial, while crossovers await complete bars", () => {
  const input = source([[3, 1]], { windowEnd: 1500, knownAt: 1500, now: 1500, points: [{ ts: 1000, end: 1500, buy: 3, sell: 1 }] });
  const reading = evaluateIndicator(template("participation"), input);
  assert.equal(reading.status, "partial");
  assert.equal(reading.points[0].partial, true);
  assert.ok(Math.abs(reading.summary.value! - 7500) <= 1);
  assert.equal(reading.points[0].signal, true, "above/below describes the explicitly partial current reading");
  const definition = { ...study(), signal: { kind: "cross-above" as const, threshold: 0, label: "Executed delta crossed above zero" } };
  const result = evaluateIndicatorStudySeries([{ ts: 1, value: -1 }, { ts: 2, value: 1, partial: true }, { ts: 3, value: 1 }, { ts: 4, value: -1 }, { ts: 5, value: 1 }], definition);
  assert.deepEqual(result.map(point => point.signal), [undefined, undefined, undefined, false, true]);
});

test("malformed study definitions, code execution, oversized state and mixed dimensions are rejected", () => {
  assert.throws(() => parseIndicatorStudyDefinition({ ...study(), transforms: [{ kind: "ema", period: 201 }] }), /2 to 200/);
  assert.throws(() => parseIndicatorStudyDefinition({ ...study(), transforms: Array.from({ length: 5 }, () => ({ kind: "cumulative" })) }), /at most four/);
  assert.throws(() => parseIndicatorStudyDefinition({ ...study(), gapPolicy: "interpolate" }), /gap or warm-up/);
  assert.throws(() => parseIndicatorStudyDefinition({ ...study(), warmup: "partial-window" }), /gap or warm-up/);
  assert.throws(() => parseIndicatorStudyDefinition({ ...study(), signal: { kind: "above", threshold: Number.NaN, label: "Invalid threshold" } }), /condition/);
  assert.throws(() => parseIndicatorPackage({ ...template("cvd"), study: { ...study(), script: "fetch('https://example.com')" } }), /unknown or missing/);
  assert.throws(() => createStudyIndicatorPackage({ ...template("cvd"), expression: "buy+1", output: { label: "Invalid formula", unit: "volume", accumulation: "bar" } }), /mix native quantities/);
  assert.throws(() => createStudyIndicatorPackage({ ...template("cvd"), expression: "buy-sell", output: { label: "Double accumulation", unit: "volume", accumulation: "cumulative" } }), /cumulative series transform/);
  assert.throws(() => evaluateIndicator(template("cvd"), source([[1, 1]], { intervalMs: 0 })), /source-bar interval/);
  assert.throws(() => evaluateIndicator(template("cvd"), source([[1, 1]], { missingIntervals: [{ start: 3000, end: 2000 }] })), /source gaps/);
  assert.throws(() => evaluateIndicatorStudySeries([{ ts: 1, value: 1 }, { ts: 0, value: 2 }], study()), /ordered finite/);
  assert.throws(() => evaluateIndicatorStudySeries([{ ts: 1, value: Number.NaN }], study()), /ordered finite/);
});
