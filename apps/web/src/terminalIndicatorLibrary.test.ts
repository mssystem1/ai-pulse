import assert from "node:assert/strict";
import { test } from "node:test";
import { createGraphIndicatorPackage, createStudyIndicatorPackage, indicatorGraphTemplates, indicatorMarketCatalog, indicatorStudyTemplates } from "@pulse/domain";
import { compatibleIndicatorCircuit, readCreatedIndicators, recommendedIndicatorCircuits } from "./terminalIndicatorLibraryState";

test("creation recommends only the exact registered numerical core and ports", () => {
  const seeds = indicatorMarketCatalog(), base = seeds[0], other = seeds[1];
  const reference = { processor: "0x" + "1".repeat(40), circuitId: "1" };
  assert.equal(compatibleIndicatorCircuit(base, other), false);
  assert.equal(compatibleIndicatorCircuit(base, { ...base, runtime: { ...base.runtime, inputBits: base.runtime.inputBits + 1 } }), false);
  const renamed = { ...base, title: "Another display name", author: "Alice" };
  assert.equal(compatibleIndicatorCircuit(base, renamed), true);
  assert.deepEqual(recommendedIndicatorCircuits(base, [{ title: other.title, publisherName: other.author, manifest: other, reference }, { title: base.title, publisherName: base.author, manifest: base, reference }]).map(item => item.title), [base.title]);
  assert.deepEqual(recommendedIndicatorCircuits(null, [{ title: base.title, publisherName: base.author, manifest: base, reference }]), []);
  assert.equal(recommendedIndicatorCircuits(base, [{ title: base.title, publisherName: base.author, manifest: base, reference }, { title: renamed.title, publisherName: renamed.author, manifest: renamed, reference: { ...reference, processor: reference.processor.toUpperCase() } }]).length, 1);
});

test("a pure OHLCV graph cannot claim its unused bundled flow-kernel registration", () => {
  const template = indicatorGraphTemplates().find(item => !item.graph.nodes.some(node => node.kind === "kernel"))!;
  const graph = createGraphIndicatorPackage({ ...template, id: "alice.price", author: "Alice" });
  assert.equal(compatibleIndicatorCircuit(graph, graph), false);
});

test("the weighted-flow creation template recommends its real built-in numerical core", () => {
  const seed = indicatorMarketCatalog().find(item => item.id === "pulse.weighted-flow")!;
  const template = indicatorStudyTemplates().find(item => item.id === "weighted-flow")!;
  const created = createStudyIndicatorPackage({ ...template, id: "alice.weighted", author: "Alice" });
  assert.equal(compatibleIndicatorCircuit(created, seed), true);
});

test("My indicators reads wallet-scoped latest saved creations and legacy draft without executing invalid entries", () => {
  const template = indicatorStudyTemplates()[0], manifest = createStudyIndicatorPackage({ ...template, id: "alice.flow", author: "Alice" });
  const next = { ...manifest, version: "1.0.1", title: "Alice latest flow" };
  const values = new Map<string, string>([["pulse-indicator-created:0xabc", JSON.stringify([manifest, { invalid: true }])], ["pulse-indicator-draft:0xabc", JSON.stringify({ manifest: next })]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.deepEqual(readCreatedIndicators(storage, "0xAbC").map(item => [item.id, item.version, item.author]), [["alice.flow", "1.0.1", "Alice"]]);
  assert.deepEqual(readCreatedIndicators(storage, "0xOther"), []);
  values.set("pulse-indicator-draft:0xabc", "broken JSON");
  assert.deepEqual(readCreatedIndicators(storage, "0xabc").map(item => item.version), ["1.0.0"]);
});
