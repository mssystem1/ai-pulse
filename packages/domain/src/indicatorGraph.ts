/** Portable, bounded financial dataflow. The graph and series state run in the
 * host; the embedded TAP-02 flow kernel is a separate numerical primitive.
 * Completed price candles and actual executions retain separate source clocks. */
import { createFormulaIndicatorPackage, parseFormulaIndicatorPackage, type IndicatorFormulaManifest } from "./indicatorFormula.js";

export type IndicatorGraphSource = "open" | "high" | "low" | "close" | "volume" | "buy" | "sell";
export type IndicatorGraphNode =
  | { id: string; kind: "source"; field: IndicatorGraphSource }
  | { id: string; kind: "constant"; value: number }
  | { id: string; kind: "kernel"; buy: string; sell: string }
  | { id: string; kind: "sample"; input: string; when: string }
  | { id: string; kind: "add" | "subtract" | "multiply" | "divide" | "min" | "max" | "above" | "below" | "cross-above" | "cross-below"; left: string; right: string }
  | { id: string; kind: "sma" | "ema" | "sum" | "stddev" | "highest" | "lowest" | "rsi" | "lag"; input: string; period: number }
  | { id: string; kind: "abs" | "cumulative"; input: string }
  | { id: string; kind: "atr"; high: string; low: string; close: string; period: number }
  | { id: string; kind: "sequence"; steps: string[]; within: number };
export type IndicatorGraphPlot = { id: string; node: string; label: string; pane: "price" | "indicator"; style: "line" | "histogram"; unit: "price" | "volume" | "percent" | "scalar"; color: string };
export type IndicatorGraphDefinition = { nodes: IndicatorGraphNode[]; plots: IndicatorGraphPlot[]; gapPolicy: "reset"; warmup: "full-window" };
export type IndicatorGraphManifest = Omit<IndicatorFormulaManifest, "format" | "prerequisites"> & { format: "pulse-indicator-v4"; graph: IndicatorGraphDefinition; prerequisites: { source: "graph-declared-sources"; units: readonly ["base", "contracts"]; missing: "show-partial" } };
export type IndicatorPriceInput = {
  source: string; knownAt: number; status: "available" | "partial" | "stale" | "unavailable";
  windowStart: number; windowEnd: number; intervalMs: number;
  units?: "base" | "contracts";
  candles: readonly { ts: number; end: number; open: number; high: number; low: number; close: number; volume: number }[];
  missingIntervals?: readonly { start: number; end: number }[];
};
export type IndicatorGraphExecutionInput = {
  source: string; knownAt: number; status: "available" | "partial" | "stale" | "unavailable";
  windowStart: number; windowEnd: number; intervalMs?: number;
  units?: "base" | "contracts";
  points: readonly { ts: number; end?: number; buy: number; sell: number }[];
  missingIntervals?: readonly { start: number; end: number }[];
};
export type IndicatorGraphPoint = { ts: number; value?: number; signal?: boolean; reset?: boolean };
export type IndicatorGraphResult = {
  status: IndicatorPriceInput["status"]; reason?: string;
  source: string; knownAt: number; windowStart: number; windowEnd: number; intervalMs?: number;
  outputs: { plot: IndicatorGraphPlot; points: IndicatorGraphPoint[]; quantitySource?: "price" | "executions" | "mixed"; quantityUnits?: "base" | "contracts" }[];
  priceUnits?: "base" | "contracts"; executionUnits?: "base" | "contracts";
  resetCount: number; resolvedPoints: number; sourceKind: "completed-ohlcv" | "executed-flow" | "aligned-ohlcv-and-executions";
};
const fail = (reason: string): never => { throw Error(`Indicator graph: ${reason}`); };
const ID = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;
const SOURCES = ["open", "high", "low", "close", "volume", "buy", "sell"] as const;
const BINARY = ["add", "subtract", "multiply", "divide", "min", "max", "above", "below", "cross-above", "cross-below"];
const ROLLING = ["sma", "ema", "sum", "stddev", "highest", "lowest", "rsi", "lag"];
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("object required"); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail("unknown or missing fields"); }
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e100;
function period(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 200) fail("period must be an integer from 1 to 200"); return Number(value); }
export function parseIndicatorGraph(input: unknown): IndicatorGraphDefinition {
  const graph = object(input); exact(graph, ["nodes", "plots", "gapPolicy", "warmup"]);
  if (graph.gapPolicy !== "reset" || graph.warmup !== "full-window" || !Array.isArray(graph.nodes) || graph.nodes.length < 1 || graph.nodes.length > 64 || !Array.isArray(graph.plots) || graph.plots.length < 1 || graph.plots.length > 8) fail("require 1-64 ordered nodes and 1-8 plots with reset/full-window policies");
  const seen = new Set<string>();
  const ref = (value: unknown) => { if (typeof value !== "string" || !seen.has(value)) fail("reference must name an earlier node; cycles and lookahead are unsupported"); return value as string; };
  const conditionIds = new Set<string>();
  const units = new Map<string, string>();
  const earlierNodes = new Map<string, IndicatorGraphNode>();
  const nodes = (graph.nodes as unknown[]).map(raw => {
    const node = object(raw);
    if (typeof node.id !== "string" || !ID.test(node.id) || seen.has(node.id)) fail("invalid or duplicate node name");
    const id = node.id as string; let result!: IndicatorGraphNode;
    if (node.kind === "source") { exact(node, ["id", "kind", "field"]); if (!SOURCES.includes(node.field as IndicatorGraphSource)) fail("unknown source"); result = { id, kind: "source", field: node.field as IndicatorGraphSource }; }
    else if (node.kind === "constant") { exact(node, ["id", "kind", "value"]); if (!finite(node.value)) fail("invalid constant"); result = { id, kind: "constant", value: node.value as number }; }
    else if (node.kind === "kernel") { exact(node, ["id", "kind", "buy", "sell"]); result = { id, kind: "kernel", buy: ref(node.buy), sell: ref(node.sell) }; const buy = earlierNodes.get(result.buy), sell = earlierNodes.get(result.sell); if (buy?.kind !== "source" || buy.field !== "buy" || sell?.kind !== "source" || sell.field !== "sell") fail("tap_delta requires actual unmodified executed buy and sell sources"); }
    else if (node.kind === "sample") { exact(node, ["id", "kind", "input", "when"]); const when = ref(node.when); if (!conditionIds.has(when)) fail("sample capture requires an earlier comparison condition"); result = { id, kind: "sample", input: ref(node.input), when }; }
    else if (BINARY.includes(String(node.kind))) { exact(node, ["id", "kind", "left", "right"]); result = { id, kind: node.kind as "add", left: ref(node.left), right: ref(node.right) }; }
    else if (ROLLING.includes(String(node.kind))) { exact(node, ["id", "kind", "input", "period"]); result = { id, kind: node.kind as "sma", input: ref(node.input), period: period(node.period) }; }
    else if (node.kind === "abs" || node.kind === "cumulative") { exact(node, ["id", "kind", "input"]); result = { id, kind: node.kind, input: ref(node.input) }; }
    else if (node.kind === "atr") { exact(node, ["id", "kind", "high", "low", "close", "period"]); result = { id, kind: "atr", high: ref(node.high), low: ref(node.low), close: ref(node.close), period: period(node.period) }; for (const field of ["high", "low", "close"] as const) { const source = earlierNodes.get(result[field]); if (source?.kind !== "source" || source.field !== field) fail("ATR requires actual completed high, low and close sources"); } }
    else if (node.kind === "sequence") { exact(node, ["id", "kind", "steps", "within"]); if (!Array.isArray(node.steps) || node.steps.length < 2 || node.steps.length > 6) fail("stateflow requires 2-6 condition stages"); const steps = (node.steps as unknown[]).map(ref); if (steps.some(id => !conditionIds.has(id))) fail("stateflow stages must reference earlier comparison or crossover conditions"); result = { id, kind: "sequence", steps, within: period(node.within) }; }
    else fail("unknown calculation node");
    seen.add(id); if (["above", "below", "cross-above", "cross-below", "sequence"].includes(result.kind)) conditionIds.add(id);
    const unit = result.kind === "source" ? ["open", "high", "low", "close"].includes(result.field) ? "price" : "volume" : result.kind === "rsi" ? "percent" : result.kind === "atr" ? "price" : result.kind === "kernel" ? "volume" : "input" in result ? units.get(result.input) ?? "scalar" : "left" in result ? ["add", "subtract", "min", "max"].includes(result.kind) && units.get(result.left) === units.get(result.right) ? units.get(result.left)! : result.kind === "multiply" ? units.get(result.left) === "scalar" ? units.get(result.right)! : units.get(result.right) === "scalar" ? units.get(result.left)! : "scalar" : "scalar" : "scalar";
    units.set(id, unit); earlierNodes.set(id, result); return result;
  });
  const plotNames = new Set<string>();
  const plots = (graph.plots as unknown[]).map(raw => {
    const plot = object(raw); exact(plot, ["id", "node", "label", "pane", "style", "unit", "color"]);
    if (typeof plot.id !== "string" || !ID.test(plot.id) || plotNames.has(plot.id) || typeof plot.label !== "string" || plot.label.length < 1 || plot.label.length > 80 || /[\x00-\x1f\x7f]/.test(plot.label) || !["price", "indicator"].includes(String(plot.pane)) || !["line", "histogram"].includes(String(plot.style)) || !["price", "volume", "percent", "scalar"].includes(String(plot.unit)) || typeof plot.color !== "string" || !/^#[0-9a-f]{6}$/i.test(plot.color)) fail("invalid plot");
    if (plot.pane === "price" && plot.unit !== "price") fail("price overlays require price units; oscillators belong in an indicator pane");
    if (plot.pane === "price" && units.get(String(plot.node)) !== "price") fail("only a price-valued calculation can use the asset-price scale; oscillators and executed quantities require an indicator pane");
    if ((plot.unit === "price" || plot.unit === "volume") && units.get(String(plot.node)) !== plot.unit) fail("plot units must match the financial calculation; price and quantity units cannot be relabeled");
    if (plot.unit === "percent" && !["percent", "scalar"].includes(units.get(String(plot.node)) ?? "")) fail("percentage plots require a percentage or dimensionless calculation");
    plotNames.add(plot.id as string); return { ...plot, node: ref(plot.node) } as IndicatorGraphPlot;
  });
  return { nodes, plots, gapPolicy: "reset", warmup: "full-window" };
}
export function createGraphIndicatorPackage(input: { id: string; title: string; description: string; author: string; version?: string; graph: IndicatorGraphDefinition }): IndicatorGraphManifest {
  const base = createFormulaIndicatorPackage({ ...input, expression: "buy-sell", output: { label: "Executed delta kernel", unit: "volume", accumulation: "bar" } });
  return parseGraphIndicatorPackage({ ...base, format: "pulse-indicator-v4", prerequisites: { ...base.prerequisites, source: "graph-declared-sources" }, graph: input.graph });
}
export function parseGraphIndicatorPackage(input: unknown): IndicatorGraphManifest {
  const value = object(input); exact(value, ["format", "id", "version", "title", "description", "author", "license", "kernel", "formula", "prerequisites", "runtime", "publication", "graph"]);
  if (value.format !== "pulse-indicator-v4") fail("unsupported graph format");
  const prerequisite = object(value.prerequisites); exact(prerequisite, ["source", "units", "missing"]);
  if (prerequisite.source !== "graph-declared-sources") fail("graph source requirements must be declared by the actual nodes");
  const { graph, ...rest } = value, base = parseFormulaIndicatorPackage({ ...rest, format: "pulse-indicator-v2", prerequisites: { ...prerequisite, source: "executed-aggressor-volume" } });
  if (base.formula.expression !== "(buy-sell)" || base.formula.output.unit !== "volume" || base.formula.output.accumulation !== "bar") fail("graph numerical primitive must be the canonical per-bar delta kernel");
  return { ...base, format: "pulse-indicator-v4", prerequisites: { ...base.prerequisites, source: "graph-declared-sources" }, graph: parseIndicatorGraph(graph) };
}

/** A deliberately small assignment language, not JavaScript or Pine. Calls
 * reference earlier identifiers; no loops, imports, object access or execution. */
export function parseIndicatorScript(script: string): IndicatorGraphDefinition {
  if (typeof script !== "string" || script.length > 20000) fail("script exceeds 20KB");
  const nodes: IndicatorGraphNode[] = [], plots: IndicatorGraphPlot[] = [], seen = new Set<string>();
  let constantId = 0;
  const source = (name: string): string => {
    if (seen.has(name)) return name;
    if (SOURCES.includes(name as IndicatorGraphSource)) { nodes.push({ id: name, kind: "source", field: name as IndicatorGraphSource }); seen.add(name); return name; }
    if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(name)) { const id = `_constant${constantId++}`; nodes.push({ id, kind: "constant", value: Number(name) }); seen.add(id); return id; }
    return fail(`unknown earlier input ${name}`);
  };
  const args = (text: string) => { const result: string[] = []; let quoted = false, escaped = false, start = 0; for (let i = 0; i < text.length; i++) { if (escaped) { escaped = false; continue; } if (quoted && text[i] === "\\") { escaped = true; continue; } if (text[i] === '"') quoted = !quoted; else if (text[i] === "," && !quoted) { result.push(text.slice(start, i).trim()); start = i + 1; } } if (quoted) fail("unclosed string"); result.push(text.slice(start).trim()); return result; };
  const literal = (text: string): string => { let parsed: unknown; try { parsed = JSON.parse(text); } catch { fail("quoted JSON string required"); } if (typeof parsed !== "string" || parsed.length < 1 || parsed.length > 80 || /[\x00-\x1f\x7f]/.test(parsed)) fail("plain quoted label required"); return parsed as string; };
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    let match = /^plot\((.*)\);?$/.exec(line);
    if (match) { const a = args(match[1]); if (a.length < 2 || a.length > 6) fail("plot(input, label, pane?, style?, units?, color?)"); plots.push({ id: `plot${plots.length + 1}`, node: source(a[0]), label: literal(a[1]), pane: a[2] ? literal(a[2]) as "price" : "indicator", style: a[3] ? literal(a[3]) as "line" : "line", unit: a[4] ? literal(a[4]) as "price" : "scalar", color: a[5] ? literal(a[5]) : "#22d3ee" }); continue; }
    match = /^([A-Za-z_][A-Za-z0-9_]{0,47})\s*=\s*([A-Za-z][A-Za-z0-9_]*)\((.*)\);?$/.exec(line);
    if (!match || seen.has(match[1]) || SOURCES.includes(match[1] as IndicatorGraphSource)) fail("use one unique name = function(earlier inputs) assignment per line");
    const [, id, fn, rawArgs] = match!, a = args(rawArgs); let node!: IndicatorGraphNode;
    const binary: Record<string, string> = { add: "add", sub: "subtract", mul: "multiply", div: "divide", min: "min", max: "max", above: "above", below: "below", crossover: "cross-above", crossunder: "cross-below" };
    if (binary[fn]) { if (a.length !== 2) fail(`${fn} requires two inputs`); node = { id, kind: binary[fn] as "add", left: source(a[0]), right: source(a[1]) }; }
    else if (ROLLING.includes(fn)) { if (a.length !== 2) fail(`${fn} requires input and period`); node = { id, kind: fn as "sma", input: source(a[0]), period: period(Number(a[1])) }; }
    else if (fn === "abs" || fn === "cumulative") { if (a.length !== 1) fail(`${fn} requires one input`); node = { id, kind: fn, input: source(a[0]) }; }
    else if (fn === "atr") { if (a.length !== 1) fail("atr(period) uses the actual high, low and close sources"); node = { id, kind: "atr", high: source("high"), low: source("low"), close: source("close"), period: period(Number(a[0])) }; }
    else if (fn === "sequence") { if (a.length < 3 || a.length > 7) fail("sequence(stage1, stage2, ..., maximum bars)"); node = { id, kind: "sequence", steps: a.slice(0, -1).map(source), within: period(Number(a.at(-1))) }; }
    else if (fn === "tap_delta") { if (a.length !== 2) fail("tap_delta requires actual buy and sell quantity inputs"); node = { id, kind: "kernel", buy: source(a[0]), sell: source(a[1]) }; }
    else if (fn === "sample") { if (a.length !== 2) fail("sample(input, capture condition) requires two inputs"); node = { id, kind: "sample", input: source(a[0]), when: source(a[1]) }; }
    else if (fn === "constant") { if (a.length !== 1 || !finite(Number(a[0]))) fail("constant requires a finite number"); node = { id, kind: "constant", value: Number(a[0]) }; }
    else if (fn === "source") { if (a.length !== 1 || !SOURCES.includes(a[0] as IndicatorGraphSource)) fail("invalid source"); node = { id, kind: "source", field: a[0] as IndicatorGraphSource }; }
    else fail(`unsupported function ${fn}`);
    nodes.push(node); seen.add(id);
  }
  return parseIndicatorGraph({ nodes, plots, gapPolicy: "reset", warmup: "full-window" });
}

/** Canonical editable source for a graph. The parser produces the same
 * calculation and plotting semantics; generated plot IDs are host identifiers. */
export function serializeIndicatorScript(input: IndicatorGraphDefinition): string {
  const graph = parseIndicatorGraph(input), aliases = new Map<string, string>();
  const ref = (id: string) => aliases.get(id) ?? id;
  const lines: string[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "source") { aliases.set(node.id, node.field); continue; }
    const functionNames: Record<string, string> = { subtract: "sub", multiply: "mul", divide: "div", "cross-above": "crossover", "cross-below": "crossunder" };
    let expression: string;
    if (node.kind === "constant") expression = `constant(${node.value})`;
    else if (node.kind === "kernel") expression = `tap_delta(${ref(node.buy)},${ref(node.sell)})`;
    else if (node.kind === "sample") expression = `sample(${ref(node.input)},${ref(node.when)})`;
    else if ("left" in node) expression = `${functionNames[node.kind] ?? node.kind}(${ref(node.left)},${ref(node.right)})`;
    else if (node.kind === "atr") {
      const high = graph.nodes.find(value => value.id === node.high), low = graph.nodes.find(value => value.id === node.low), close = graph.nodes.find(value => value.id === node.close);
      if (high?.kind !== "source" || high.field !== "high" || low?.kind !== "source" || low.field !== "low" || close?.kind !== "source" || close.field !== "close") fail("script ATR uses actual high/low/close sources; retain this custom graph in visual mode");
      expression = `atr(${node.period})`;
    } else if (node.kind === "sequence") expression = `sequence(${node.steps.map(ref).join(",")},${node.within})`;
    else if ("period" in node) expression = `${node.kind}(${ref(node.input)},${node.period})`;
    else expression = `${node.kind}(${ref(node.input)})`;
    lines.push(`${node.id} = ${expression}`);
  }
  for (const plot of graph.plots) lines.push(`plot(${ref(plot.node)},${JSON.stringify(plot.label)},${JSON.stringify(plot.pane)},${JSON.stringify(plot.style)},${JSON.stringify(plot.unit)},${JSON.stringify(plot.color)})`);
  return lines.join("\n");
}

/** Serializable node graph can be edited visually or generated by the bounded
 * script compiler. Undefined operands remain unknown; they never become zero. */
export function evaluateIndicatorGraph(manifest: IndicatorGraphManifest, input: { price?: IndicatorPriceInput; executions?: IndicatorGraphExecutionInput; now?: number; maxAgeMs?: number; evaluateDeltaKernel?: (buy: number, sell: number) => number }): IndicatorGraphResult {
  const graph = parseIndicatorGraph(manifest.graph), sources = graph.nodes.filter((node): node is Extract<IndicatorGraphNode, { kind: "source" }> => node.kind === "source");
  const usesPrice = sources.some(node => node.field !== "buy" && node.field !== "sell"), usesFlow = sources.some(node => node.field === "buy" || node.field === "sell");
  if (!sources.length) fail("at least one genuine market source is required");
  if (graph.nodes.some(node => node.kind === "kernel") && !input.evaluateDeltaKernel) fail("a TAP-02 kernel evaluator is required for tap_delta; host subtraction cannot substitute for circuit execution");
  const price = input.price, flow = input.executions, bound = usesPrice ? price : flow;
  const now = input.now ?? Date.now(), maxAge = input.maxAgeMs ?? 300000;
  const sourceKind = usesPrice ? usesFlow ? "aligned-ohlcv-and-executions" : "completed-ohlcv" : "executed-flow";
  const quantityLineage = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const references = "input" in node ? [node.input] : "left" in node ? [node.left, node.right] : node.kind === "kernel" ? [node.buy, node.sell] : [];
    quantityLineage.set(node.id, node.kind === "source" ? new Set(node.field === "volume" ? ["price"] : node.field === "buy" || node.field === "sell" ? ["executions"] : []) : new Set(references.flatMap(id => [...(quantityLineage.get(id) ?? [])])));
  }
  const priceUnits = price?.units ?? "base", executionUnits = flow?.units ?? "base";
  if (priceUnits !== executionUnits && [...quantityLineage.values()].some(lineage => lineage.size > 1)) fail("cannot combine base-asset candle volume with Futures contract quantities; an explicit verified contract conversion is required");
  const emptyOutputs = () => graph.plots.map(plot => { const lineage = quantityLineage.get(plot.node)!; return { plot, points: [] as IndicatorGraphPoint[], ...(plot.unit === "volume" && lineage.size ? { quantitySource: lineage.size > 1 ? "mixed" as const : lineage.has("price") ? "price" as const : "executions" as const, quantityUnits: lineage.has("price") ? priceUnits : executionUnits } : {}) }; });
  const unitMetadata = { ...(usesPrice ? { priceUnits } : {}), ...(usesFlow ? { executionUnits } : {}) };
  const blank = (reason: string): IndicatorGraphResult => ({ status: "unavailable", reason, source: bound?.source ?? "unavailable", knownAt: bound?.knownAt ?? now, windowStart: bound?.windowStart ?? now - 1, windowEnd: bound?.windowEnd ?? now, outputs: emptyOutputs(), resetCount: 0, resolvedPoints: 0, sourceKind, ...unitMetadata });
  if (!bound || bound.status === "unavailable" || usesFlow && (!flow || flow.status === "unavailable")) return blank("Required real completed source bars are unavailable. Price candles cannot substitute for executed buy/sell data.");
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(maxAge) || maxAge < 1000 || maxAge > 31 * 86400000) fail("invalid freshness clock");
  for (const binding of [usesPrice ? price : undefined, usesFlow ? flow : undefined].filter(Boolean) as (IndicatorPriceInput | IndicatorGraphExecutionInput)[]) {
    if (!binding.source || binding.units !== undefined && !["base", "contracts"].includes(binding.units) || !["available", "partial", "stale", "unavailable"].includes(binding.status) || ![binding.knownAt, binding.windowStart, binding.windowEnd].every(Number.isSafeInteger) || binding.windowStart < 0 || binding.windowEnd <= binding.windowStart || binding.knownAt > now + 30000 || binding.intervalMs !== undefined && (!Number.isSafeInteger(binding.intervalMs) || binding.intervalMs < 1 || binding.intervalMs > 31 * 86400000)) fail("invalid source identity or completed-bar clock");
    if (binding.missingIntervals && (binding.missingIntervals.length > 1024 || binding.missingIntervals.some(gap => !Number.isSafeInteger(gap.start) || !Number.isSafeInteger(gap.end) || gap.start < 0 || gap.end <= gap.start))) fail("invalid source gap");
  }
  const priceBars = price?.candles ?? [], flowBars = flow?.points ?? [];
  if (priceBars.length > 1024 || flowBars.length > 1024) fail("source exceeds 1024 observations");
  if (usesPrice) for (const [index, bar] of priceBars.entries()) if (![bar.ts, bar.end].every(Number.isSafeInteger) || bar.ts < price!.windowStart || bar.end <= bar.ts || bar.end > price!.windowEnd || bar.end > price!.knownAt || bar.ts > now || index > 0 && bar.ts <= priceBars[index - 1].ts || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(finite) || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close) || bar.volume < 0) fail("invalid, incomplete, unordered or out-of-window OHLCV candle");
  if (usesFlow) for (const [index, bar] of flowBars.entries()) if (!Number.isSafeInteger(bar.ts) || bar.ts < flow!.windowStart || bar.ts >= flow!.windowEnd || bar.ts > flow!.knownAt || index > 0 && bar.ts <= flowBars[index - 1].ts || ![bar.buy, bar.sell].every(finite) || bar.buy < 0 || bar.sell < 0 || bar.end !== undefined && (!Number.isSafeInteger(bar.end) || bar.end <= bar.ts || bar.end > flow!.windowEnd || bar.end > flow!.knownAt)) fail("invalid, incomplete, unordered or out-of-window executions");
  const rows = usesPrice ? priceBars : flowBars;
  if (!rows.length) return blank("No completed source observations are available.");
  const flowMap = new Map(flowBars.map(bar => [bar.ts, bar]));
  const states = new Map<string, { values: number[]; previous?: number; average?: number; gain?: number; loss?: number; total: number; left?: number; right?: number; stage: number; age: number }>();
  const state = (id: string) => { let value = states.get(id); if (!value) { value = { values: [], total: 0, stage: 0, age: 0 }; states.set(id, value); } return value; };
  const outputs = emptyOutputs();
  let previousEnd: number | undefined, resetCount = 0, unknownCount = 0;
  for (const row of rows) {
    const end = row.end ?? (bound.intervalMs ? row.ts + bound.intervalMs : undefined), matchedFlow = usesFlow ? flowMap.get(row.ts) : undefined;
    const gap = previousEnd !== undefined && row.ts !== previousEnd;
    const incomplete = end === undefined || end > bound.knownAt || end > bound.windowEnd || bound.intervalMs !== undefined && end - row.ts !== bound.intervalMs;
    const missing = bound.missingIntervals?.some(interval => interval.start < (end ?? row.ts + 1) && interval.end > row.ts) || usesFlow && usesPrice && (!matchedFlow || matchedFlow.end !== end || flow!.missingIntervals?.some(interval => interval.start < (end ?? row.ts + 1) && interval.end > row.ts));
    const reset = gap || incomplete || Boolean(missing);
    if (reset) { states.clear(); resetCount++; }
    previousEnd = end;
    const values = new Map<string, number | undefined>();
    for (const node of graph.nodes) {
      let value: number | undefined; const memory = state(node.id);
      const get = (id: string) => values.get(id);
      if (incomplete || missing) value = undefined;
      else if (node.kind === "source") value = node.field === "buy" || node.field === "sell" ? matchedFlow?.[node.field] : (row as IndicatorPriceInput["candles"][number])[node.field];
      else if (node.kind === "constant") value = node.value;
      else if (node.kind === "kernel") { const buy = get(node.buy), sell = get(node.sell); if (buy !== undefined && sell !== undefined && buy >= 0 && sell >= 0) value = input.evaluateDeltaKernel!(buy, sell); }
      else if (node.kind === "sample") { const current = get(node.input), capture = get(node.when); if (current === undefined || capture === undefined) states.delete(node.id); else { if (capture > 0) memory.previous = current; value = memory.previous; } }
      else if ("left" in node) {
        const left = get(node.left), right = get(node.right);
        if (left !== undefined && right !== undefined) {
          if (node.kind === "add") value = left + right; else if (node.kind === "subtract") value = left - right; else if (node.kind === "multiply") value = left * right; else if (node.kind === "divide") value = right === 0 ? undefined : left / right;
          else if (node.kind === "min") value = Math.min(left, right); else if (node.kind === "max") value = Math.max(left, right);
          else if (node.kind === "above") value = Number(left > right); else if (node.kind === "below") value = Number(left < right);
          else if (memory.left !== undefined && memory.right !== undefined) value = Number(node.kind === "cross-above" ? memory.left <= memory.right && left > right : memory.left >= memory.right && left < right);
          memory.left = left; memory.right = right;
        } else { memory.left = undefined; memory.right = undefined; }
      } else if (node.kind === "sequence") {
        const conditions = node.steps.map(get);
        if (conditions.some(v => v === undefined)) { memory.stage = 0; memory.age = 0; }
        else {
          value = 0; if (memory.stage) memory.age++;
          if (memory.age > node.within) { memory.stage = 0; memory.age = 0; }
          if(memory.stage&&conditions[0]!>0){memory.stage=1;memory.age=0;}
          else if (conditions[memory.stage]! > 0) { memory.stage++; if (memory.stage === 1) memory.age = 0; if (memory.stage === conditions.length) { value = 1; memory.stage = 0; memory.age = 0; } }
        }
      } else if (node.kind === "atr") {
        const high = get(node.high), low = get(node.low), close = get(node.close);
        if (high !== undefined && low !== undefined && close !== undefined) {
          const tr = memory.previous === undefined ? high - low : Math.max(high - low, Math.abs(high - memory.previous), Math.abs(low - memory.previous)); memory.previous = close;
          memory.values.push(tr); if (memory.values.length > node.period) memory.values.shift();
          if (memory.values.length === node.period) { memory.average = memory.average === undefined ? memory.values.reduce((a, b) => a + b, 0) / node.period : (memory.average * (node.period - 1) + tr) / node.period; value = memory.average; }
        } else states.delete(node.id);
      } else if ("input" in node) {
        const current = get(node.input);
        if (current === undefined) states.delete(node.id);
        else if (node.kind === "abs") value = Math.abs(current);
        else if (node.kind === "cumulative") { memory.total += current; value = memory.total; }
        else if (node.kind === "rsi") {
          if (memory.previous !== undefined) {
            const change = current - memory.previous; memory.values.push(change); if (memory.values.length > node.period) memory.values.shift();
            if (memory.values.length === node.period) {
              memory.gain = memory.gain === undefined ? memory.values.reduce((sum, n) => sum + Math.max(0, n), 0) / node.period : (memory.gain * (node.period - 1) + Math.max(0, change)) / node.period;
              memory.loss = memory.loss === undefined ? memory.values.reduce((sum, n) => sum + Math.max(0, -n), 0) / node.period : (memory.loss * (node.period - 1) + Math.max(0, -change)) / node.period;
              value = memory.loss === 0 ? memory.gain === 0 ? 50 : 100 : 100 - 100 / (1 + memory.gain / memory.loss);
            }
          } memory.previous = current;
        } else {
          const n = node as Extract<IndicatorGraphNode, { period: number; input: string }>;
          memory.values.push(current); const size = n.kind === "lag" ? n.period + 1 : n.period; if (memory.values.length > size) memory.values.shift();
          if (memory.values.length === size) {
            const mean = memory.values.reduce((sum, number) => sum + number, 0) / size;
            if (n.kind === "lag") value = memory.values[0]; else if (n.kind === "ema") { memory.average = memory.average === undefined ? mean : current * 2 / (n.period + 1) + memory.average * (1 - 2 / (n.period + 1)); value = memory.average; }
            else if (n.kind === "sma") value = mean; else if (n.kind === "sum") value = mean * size; else if (n.kind === "stddev") value = Math.sqrt(memory.values.reduce((sum, number) => sum + (number - mean) ** 2, 0) / size); else if (n.kind === "highest") value = Math.max(...memory.values); else if (n.kind === "lowest") value = Math.min(...memory.values);
          }
        }
      }
      if (value !== undefined && !finite(value)) { states.delete(node.id); value = undefined; }
      values.set(node.id, value);
    }
    for (const output of outputs) { const value = values.get(output.plot.node), kind = graph.nodes.find(node => node.id === output.plot.node)?.kind; const condition = kind === "sequence" || kind === "above" || kind === "below" || kind === "cross-above" || kind === "cross-below"; output.points.push({ ts: row.ts, ...(value !== undefined ? { value, ...(condition ? { signal: value > 0 } : {}) } : {}), ...(reset ? { reset: true } : {}) }); }
    if (incomplete || missing) unknownCount++;
  }
  const resolvedPoints = outputs.reduce((sum, output) => sum + output.points.filter(point => point.value !== undefined).length, 0);
  const stale = [usesPrice ? price : undefined, usesFlow ? flow : undefined].some(binding => binding && (binding.status === "stale" || now - binding.knownAt > maxAge));
  const partial = unknownCount > 0 || resetCount > 0 || bound.status === "partial" || usesFlow && flow?.status === "partial";
  return { status: stale ? "stale" : partial ? "partial" : "available", ...(stale ? { reason: "Source is stale. These are historical indicator readings, not a current trigger." } : partial ? { reason: "Incomplete or mismatched source bars remain unknown; calculation and stateflow warm-up restart after source gaps." } : !resolvedPoints ? { reason: "Waiting for enough complete, contiguous source bars to finish warm-up." } : {}), source: usesPrice && usesFlow ? `${price!.source} + ${flow!.source}` : bound.source, knownAt: usesPrice && usesFlow ? Math.min(price!.knownAt, flow!.knownAt) : bound.knownAt, windowStart: bound.windowStart, windowEnd: bound.windowEnd, intervalMs: bound.intervalMs, outputs, resetCount, resolvedPoints, sourceKind, ...unitMetadata };
}

export type IndicatorGraphTemplate = { id: string; title: string; description: string; script: string; graph: IndicatorGraphDefinition };
export function indicatorGraphTemplates(): IndicatorGraphTemplate[] {
  const templates = [
    { id: "ema-trend", title: "EMA trend 20 / 50", description: "Two price overlays and a completed-candle crossover condition. Full warm-up and no lookahead.", script: 'fast = ema(close,20)\nslow = ema(close,50)\ncross = crossover(fast,slow)\nplot(fast,"EMA 20","price","line","price","#22d3ee")\nplot(slow,"EMA 50","price","line","price","#fbbf24")\nplot(cross,"Bullish EMA crossover","indicator","histogram","scalar","#34d399")' },
    { id: "bollinger", title: "Bollinger-style bands 20 / 2", description: "Completed close SMA20 with population standard-deviation bands, 2 deviations each side. Volatility is not a trading instruction.", script: 'middle = sma(close,20)\ndeviation = stddev(close,20)\nwidth = mul(deviation,2)\nupper = add(middle,width)\nlower = sub(middle,width)\nplot(middle,"SMA 20","price","line","price","#fbbf24")\nplot(upper,"Upper 2 sigma","price","line","price","#22d3ee")\nplot(lower,"Lower 2 sigma","price","line","price","#a78bfa")' },
    { id: "rsi", title: "RSI 14", description: "Wilder-smoothed RSI from completed closes; first reading needs fourteen close changes. Flat markets resolve to 50.", script: 'strength = rsi(close,14)\nplot(strength,"RSI 14","indicator","line","percent","#a78bfa")' },
    { id: "atr", title: "ATR 14 & volatility bands", description: "Wilder true-range average with close plus/minus two ATR overlays. Displays observed volatility without setting an order or changing a report stop.", script: 'volatility = atr(14)\nwidth = mul(volatility,2)\nupper = add(close,width)\nlower = sub(close,width)\nplot(volatility,"ATR 14","indicator","line","price","#fbbf24")\nplot(upper,"Close plus 2 ATR","price","line","price","#22d3ee")\nplot(lower,"Close minus 2 ATR","price","line","price","#fb7185")' },
    { id: "sweep-reclaim", title: "Sweep → reclaim → hold stateflow", description: "Capture the prior twenty-bar low when a sweep occurs, then require a later reclaim and later hold of that captured level within five completed bars. Stages cannot all fire on the same candle.", script: 'rollingLow = lowest(low,20)\nboundary = lag(rollingLow,1)\nsweep = below(low,boundary)\ncaptured = sample(boundary,sweep)\nreclaim = above(close,captured)\nhold = above(low,captured)\nevent = sequence(sweep,reclaim,hold,5)\nplot(captured,"Captured swept boundary","price","line","price","#fbbf24")\nplot(event,"Sweep reclaim hold completed","indicator","histogram","scalar","#34d399")' },
    { id: "tap-flow", title: "Tapeout executed delta & EMA 8", description: "Actual executed buy/sell quantities run through the portable NAND delta kernel, then a causal eight-source-bar EMA. No OHLC-derived flow or reconstructed missing trades.", script: 'delta = tap_delta(buy,sell)\nsmoothed = ema(delta,8)\nplot(delta,"Executed delta · Tapeout kernel","indicator","histogram","volume","#34d399")\nplot(smoothed,"Delta EMA 8","indicator","line","volume","#fbbf24")' },
  ];
  return templates.map(template => ({ ...template, graph: parseIndicatorScript(template.script) }));
}
