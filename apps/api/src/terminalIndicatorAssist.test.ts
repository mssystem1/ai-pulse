import test from "node:test";
import assert from "node:assert/strict";
import { parseIndicatorGraph, type IndicatorGraphDefinition } from "@pulse/domain";
import { indicatorAssistSystemPrompt, indicatorAssistUserPrompt, parseIndicatorAssistResponse } from "./terminalIndicatorAssist.js";

const graph: IndicatorGraphDefinition = { nodes: [{ id: "close", kind: "source", field: "close" }, { id: "ema20", kind: "ema", input: "close", period: 20 }], plots: [{ id: "ema_plot", node: "ema20", label: "EMA 20", pane: "price", style: "line", unit: "price", color: "#22d3ee" }], gapPolicy: "reset", warmup: "full-window" };

test("indicator assistant accepts only the bounded indicator graph shape", () => {
  const result = parseIndicatorAssistResponse(JSON.stringify({ title: "Trend", description: "EMA trend", explanation: "Causal average of completed closes", graph }));
  assert.deepEqual(result.graph, parseIndicatorGraph(graph));
  assert.equal(result.previewRequired, true);
});

test("indicator assistant rejects code, invalid references, extra fields and oversized output", () => {
  for (const value of ["window.alert(1)", JSON.stringify({ title: "x", description: "y", explanation: "z", graph, execute: "code" }), JSON.stringify({ title: "x", description: "y", explanation: "z", graph: { ...graph, nodes: [{ id: "x", kind: "sample", input: "x", when: "x" }] } })]) assert.throws(() => parseIndicatorAssistResponse(value));
  assert.throws(() => parseIndicatorAssistResponse("x".repeat(12_001)));
});

test("assistant prompt communicates draft-only graph contract and user graph is parsed", () => {
  const prompt = indicatorAssistSystemPrompt();
  assert.match(prompt, /previewed locally/);
  assert.match(prompt, /never imply publication, payment or trading authorization/);
  assert.doesNotMatch(prompt, /binary\(|rolling\(/);
  const example = prompt.match(/Valid complete example: (\{[^\n]+\})\.\nNever/);
  assert.ok(example, "prompt includes one complete JSON example");
  const decoded = JSON.parse(example[1]) as { graph: unknown };
  assert.doesNotThrow(() => parseIndicatorGraph(decoded.graph));
  assert.match(prompt, /1-64 nodes and 1-8 plots/);
  assert.doesNotThrow(() => JSON.parse(indicatorAssistUserPrompt({ mode: "edit", prompt: "Add an RSI", currentGraph: graph })));
  assert.throws(() => indicatorAssistUserPrompt({ mode: "edit", prompt: "Modify", currentGraph: { nodes: [], plots: [] } as never }));
});
