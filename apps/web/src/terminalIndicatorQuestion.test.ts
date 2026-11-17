import assert from "node:assert/strict";
import { test } from "node:test";
import { createGraphIndicatorPackage, createStudyIndicatorPackage, indicatorStudyTemplates, type IndicatorGraphDefinition, type IndicatorResult } from "@pulse/domain";
import { terminalIndicatorQuestion, TERMINAL_INDICATOR_QUESTION_LIMIT } from "./terminalIndicatorQuestion";

function graphDefinition(nodeCount: number, plotCount: number): IndicatorGraphDefinition {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ id: `n${index}`, kind: "source" as const, field: "close" as const }));
  const plots = Array.from({ length: plotCount }, (_, index) => ({ id: `plot${index}`, node: `n${index}`, label: `Output ${index}`, pane: "price" as const, style: "line" as const, unit: "price" as const, color: "#22d3ee" }));
  return { nodes, plots, gapPolicy: "reset", warmup: "full-window" };
}

function resultFor(manifest: ReturnType<typeof createGraphIndicatorPackage>): IndicatorResult {
  const knownAt = 1_800_000_000_000, windowStart = knownAt - 3_600_000, windowEnd = knownAt - 60_000;
  return {
    id: manifest.id, status: "partial", points: [],
    outputs: manifest.graph.plots.map((plot, index) => ({ plot, points: [{ ts: windowEnd, value: 100 + index, signal: index % 2 === 0 }] })),
    summary: { label: manifest.title }, precision: { quantityQuantum: 0, maxCvdError: 0, note: "synthetic fixture" },
    provenance: { execution: "local-causal-graph", chainId: 196, registered: false, source: "synthetic-completed-bars", knownAt, windowStart, windowEnd, gateCount: 0, units: "base", graph: { execution: "causal-host-graph-v1", kernel: "not-used", sourceKind: "completed-ohlcv", nodeCount: manifest.graph.nodes.length, plotCount: manifest.graph.plots.length, resetCount: 0, resolvedPoints: manifest.graph.plots.length, gapPolicy: "reset", warmup: "full-window" } },
  };
}

test("indicator Ask PULSE question fits 1500 characters and keeps exact graph when it fits", () => {
  const manifest = createGraphIndicatorPackage({ id: "trader.ema", title: "Close overlay", description: "Exact graph fixture", author: "Test", graph: graphDefinition(2, 1) });
  const result = resultFor(manifest), question = terminalIndicatorQuestion(manifest, result, "BTC-USDT", "1H", "spot");
  assert.ok(question.length <= TERMINAL_INDICATOR_QUESTION_LIMIT);
  assert.ok(question.includes(JSON.stringify(manifest.graph)));
  assert.ok(question.includes("synthetic-completed-bars"));
  assert.ok(question.includes(`\"knownAt\":${result.provenance.knownAt}`));
  assert.ok(question.includes(`\"ts\":${result.provenance.windowEnd}`));
});

test("maximal graph and eight outputs become an explicit bounded summary, never truncated JSON", () => {
  const manifest = createGraphIndicatorPackage({ id: "trader.maximal", title: "Maximal graph", description: "Large graph fixture", author: "Test", graph: graphDefinition(64, 8) });
  const result = resultFor(manifest), question = terminalIndicatorQuestion(manifest, result, "BTC-USDT", "1H", "perpetual");
  assert.ok(question.length <= TERMINAL_INDICATOR_QUESTION_LIMIT);
  assert.ok(question.includes('"omittedCalculation":true'));
  assert.ok(question.includes("exact graph/formula is omitted"));
  assert.ok(question.includes('"label":"Output 7"'));
  assert.ok(question.includes('"value":107'));
  assert.ok(question.includes(`\"knownAt\":${result.provenance.knownAt}`));
  assert.ok(question.endsWith("Do not infer a direction or any omitted calculation."));
  assert.ok(!question.includes('"id":"n63"'), "large serialized graph is omitted as a whole, not partly truncated");
});

test("flow study explanation preserves the per-bar formula as well as its rolling transform", () => {
  const template=indicatorStudyTemplates().find(item=>item.id==="delta-ema")!;
  const manifest=createStudyIndicatorPackage({...template,id:"trader.delta-ema",author:"Test"});
  const graph=createGraphIndicatorPackage({id:"trader.fixture",title:"Fixture",description:"Source result fixture",author:"Test",graph:graphDefinition(1,1)});
  const result=resultFor(graph);result.outputs=undefined;
  const question=terminalIndicatorQuestion(manifest,result,"BTC-USDT","1H","spot");
  assert.ok(question.includes(JSON.stringify(manifest.formula)));
  assert.ok(question.includes(JSON.stringify(manifest.study)));
  assert.ok(question.length<=TERMINAL_INDICATOR_QUESTION_LIMIT);
});

test("oversized source metadata is explicitly omitted while exact source times remain", () => {
  const manifest = createGraphIndicatorPackage({ id: "trader.long-source", title: "Long source", description: "Long source metadata fixture", author: "Test", graph: graphDefinition(2, 1) });
  const result = resultFor(manifest); result.provenance.source = "source".repeat(1000);
  const question = terminalIndicatorQuestion(manifest, result, "BTC-USDT", "1H", "spot");
  assert.ok(question.length <= TERMINAL_INDICATOR_QUESTION_LIMIT);
  assert.ok(question.includes("Source identity and output values were explicitly omitted"));
  assert.ok(question.includes(`Exact source window: ${result.provenance.windowStart} to ${result.provenance.windowEnd}; known at ${result.provenance.knownAt}`));
  assert.ok(question.endsWith("Do not infer the calculation or unprovided readings."));
});
