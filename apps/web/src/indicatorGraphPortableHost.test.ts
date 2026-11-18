import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphIndicatorPackage, evaluateIndicator, indicatorGraphTemplates, type IndicatorInput } from "@pulse/domain";
const hostUrl = new URL("../public/indicator-market/tap02-host.js", import.meta.url);

function source(): IndicatorInput {
  const width = 60000, end = 101 * width;
  return { instId: "BTC-USDT", timeframe: "1H", source: "actual-source-binding", status: "available", knownAt: end, windowStart: width, windowEnd: end, units: "base", intervalMs: width, now: end,
    points: Array.from({ length: 100 }, (_, i) => ({ ts: (i + 1) * width, end: (i + 2) * width, buy: 3 + Math.sin(i / 5), sell: 2 + Math.cos(i / 5) })),
    price: { source: "completed-price-candles", status: "available", knownAt: end, windowStart: width, windowEnd: end, intervalMs: width, candles: Array.from({ length: 100 }, (_, i) => { const close = 100 + Math.sin(i / 5) * 3 + i / 10; return { ts: (i + 1) * width, end: (i + 2) * width, open: close, high: close + 2, low: close - 2, close, volume: 100 + i }; }) } };
}
test("portable graph host carries OHLCV, overlays, oscillators, stateflow and real NAND flow into a second host", async () => {
  const { evaluatePortableGraph } = await import(hostUrl.href);
  const data = source();
  for (const template of indicatorGraphTemplates()) {
    const manifest = createGraphIndicatorPackage({ ...template, id: `portable.${template.id}`, author: "Professional publisher" });
    const portable = evaluatePortableGraph(JSON.parse(JSON.stringify(manifest)), { price: data.price, executions: data, now: data.now });
    const application = evaluateIndicator(manifest, data);
    assert.deepEqual(portable.outputs, application.outputs, template.id);
    assert.equal(portable.sourceKind, application.provenance.graph!.sourceKind);
  }
});
test("all nine Studio templates preview without publisher identity and match the authored calculation", () => {
  const data = source(), templates = indicatorGraphTemplates();
  assert.equal(templates.length, 9);
  for (const template of templates) {
    const preview = createGraphIndicatorPackage({ ...template, id: `preview.${template.id}`, author: "Preview author" });
    const authored = createGraphIndicatorPackage({ ...template, id: `preview.${template.id}`, author: "Actual publisher" });
    assert.deepEqual(evaluateIndicator(preview, data).outputs, evaluateIndicator(authored, data).outputs, template.id);
  }
});
test("portable graph host leaves gaps unknown and preserves source timestamps with complete-window warm-up", async () => {
  const { evaluatePortableGraph } = await import(hostUrl.href);
  const data = source(); data.price!.candles = data.price!.candles.filter((_, i) => i !== 60);
  const template = indicatorGraphTemplates().find(item => item.id === "ema-trend")!;
  const manifest = createGraphIndicatorPackage({ ...template, id: "portable.gaps", author: "Professional publisher" });
  const portable = evaluatePortableGraph(manifest, { price: data.price, executions: data, now: data.now });
  assert.deepEqual(portable.outputs, evaluateIndicator(manifest, data).outputs);
  assert.equal(portable.status, "partial");
  assert.equal(portable.outputs[0].points.length, 99);
  assert.equal(portable.outputs[0].points[60].reset, true);
  assert.equal(portable.outputs[0].points[60].value, undefined);
});
test("portable graph admission rejects mutated circuit claims and unbounded graph extensions", async () => {
  const { evaluatePortableGraph } = await import(hostUrl.href);
  const data = source(), template = indicatorGraphTemplates()[0];
  const manifest = createGraphIndicatorPackage({ ...template, id: "portable.admission", author: "Professional publisher" });
  assert.throws(() => evaluatePortableGraph({ ...manifest, graph: { ...manifest.graph, script: "fetch('https://example.com')" } }, { price: data.price, now: data.now }), /unknown or missing/i);
  assert.throws(() => evaluatePortableGraph({ ...manifest, publication: { chainId: 196, registered: true } }, { price: data.price, now: data.now }), /publication/);
  assert.throws(() => evaluatePortableGraph({ ...manifest, runtime: { ...manifest.runtime, netlist: "0x" } }, { price: data.price, now: data.now }), /circuit/);
});
