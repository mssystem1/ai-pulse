/** Bounded, deterministic financial expressions compiled to TAP-02 NAND.
 * This is an expression language, never JavaScript. Input words are buy/sell
 * uint16 quantities sharing the scale declared by the host. Every intermediate
 * must fit signed int32; division truncates toward zero and zero is unknown.
 */
export type IndicatorFormulaOutput = { label: string; unit: "volume" | "ratio" | "bps" | "scalar"; accumulation: "bar" | "cumulative" };
export type IndicatorFormulaManifest = {
  format: "pulse-indicator-v2"; id: string; version: string; title: string; description: string; author: string; license: "MIT"; kernel: "formula-v1";
  formula: { language: "pulse-flow-expr-v1"; expression: string; output: IndicatorFormulaOutput };
  prerequisites: { source: "executed-aggressor-volume"; units: readonly ["base", "contracts"]; missing: "show-partial" };
  runtime: { format: "tap-02-nand"; bitOrder: "least-significant-first"; inputBits: 64; outputBits: 32; maxPoints: 1024; netlist: string };
  publication: { chainId: 196; registered: false };
};
type Node = { op: "number"; value: number } | { op: "buy" } | { op: "sell" } | { op: "neg"; a: Node } | { op: "abs"; a: Node } | { [K in "+" | "-" | "*" | "/" | "min" | "max"]: { op: K; a: Node; b: Node } }["+" | "-" | "*" | "/" | "min" | "max"];
type Range = readonly [number, number];
/** Quantity scaling must not change the meaning of a formula's constants.
 * A zero literal is compatible with either dimension; all other literals are
 * dimensionless. Volume output must scale linearly; ratios must be invariant. */
function quantityDegree(node: Node): number | null {
  if (node.op === "number") return node.value === 0 ? null : 0;
  if (node.op === "buy" || node.op === "sell") return 1;
  const left = quantityDegree(node.a);
  if (node.op === "neg" || node.op === "abs") return left;
  const right = quantityDegree(node.b);
  if (node.op === "*") return left === null || right === null ? null : left + right;
  if (node.op === "/") return left === null ? null : left - (right ?? 0);
  if (left !== null && right !== null && left !== right) throw Error("Indicator formula: cannot mix native quantities with dimensionless constants; use quantities on both sides of min/max/clamp");
  return left ?? right;
}
const MIN = -2147483648, MAX = 2147483647, MAX_GATES = 40_000;
const fail = (reason: string): never => { throw Error(`Indicator formula: ${reason}`); };
const bounded = (min: number, max: number): Range => {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < MIN || max > MAX) fail("an intermediate can overflow int32; reduce the expression or explicitly clamp its inputs");
  return [min, max];
};
export function parseIndicatorFormula(expression: string): { expression: string; ast: Node; range: Range } {
  if (typeof expression !== "string" || expression.length < 1 || expression.length > 512 || /[^a-z0-9_+*/(),\s-]/.test(expression)) fail("use buy, sell, integer constants, + - * /, abs, min, max and clamp (512 characters maximum)");
  const tokens = expression.match(/[a-z_]+|[0-9]+|[+*/(),-]/g) ?? [];
  if (tokens.length > 128) fail("expression token limit exceeded");
  let at = 0, nodes = 0;
  const take = () => tokens[at++], peek = () => tokens[at];
  const need = (token: string) => { if (take() !== token) fail(`expected ${token}`); };
  const node = <T extends Node>(value: T, depth: number): T => { if (++nodes > 64 || depth > 16) fail("expression complexity limit exceeded"); return value; };
  function primary(depth: number): Node {
    const t = take();
    if (t === "-") return node({ op: "neg", a: primary(depth + 1) }, depth);
    if (t === "+") return primary(depth + 1);
    if (t === "(") { const v = sum(depth + 1); need(")"); return v; }
    if (t === "buy" || t === "sell") return node({ op: t }, depth);
    if (t && /^\d+$/.test(t)) { const value = Number(t); if (!Number.isSafeInteger(value) || value > MAX) fail("integer constant outside int32"); return node({ op: "number", value }, depth); }
    if (["abs", "min", "max", "clamp"].includes(t)) {
      need("("); const a = sum(depth + 1);
      if (t === "abs") { need(")"); return node({ op: "abs", a }, depth); }
      need(","); const b = sum(depth + 1);
      if (t === "clamp") { need(","); const c = sum(depth + 1); need(")"); return node({ op: "min", a: node({ op: "max", a, b }, depth + 1), b: c }, depth); }
      need(")"); return node({ op: t as "min" | "max", a, b }, depth);
    }
    return fail("expected a quantity, integer or supported function");
  }
  function product(depth: number): Node { let a = primary(depth); while (peek() === "*" || peek() === "/") { const op = take() as "*" | "/"; a = node({ op, a, b: primary(depth + 1) }, depth); } return a; }
  function sum(depth: number): Node { let a = product(depth); while (peek() === "+" || peek() === "-") { const op = take() as "+" | "-"; a = node({ op, a, b: product(depth + 1) }, depth); } return a; }
  const ast = sum(0); if (at !== tokens.length) fail("unexpected token");
  return { expression: print(ast), ast, range: range(ast) };
}
function print(n: Node): string {
  if (n.op === "number") return String(n.value);
  if (n.op === "buy" || n.op === "sell") return n.op;
  if (n.op === "neg") return `(-${print(n.a)})`;
  if (n.op === "abs") return `abs(${print(n.a)})`;
  if (n.op === "min" || n.op === "max") return `${n.op}(${print(n.a)},${print(n.b)})`;
  return `(${print(n.a)}${n.op}${print(n.b)})`;
}
function range(n: Node): Range {
  if (n.op === "number") return [n.value, n.value];
  if (n.op === "buy" || n.op === "sell") return [0, 65535];
  const a = range(n.a);
  if (n.op === "neg") return bounded(-a[1], -a[0]);
  if (n.op === "abs") return bounded(a[0] >= 0 ? a[0] : a[1] <= 0 ? -a[1] : 0, Math.max(Math.abs(a[0]), Math.abs(a[1])));
  const b = range(n.b);
  if (n.op === "+") return bounded(a[0] + b[0], a[1] + b[1]);
  if (n.op === "-") return bounded(a[0] - b[1], a[1] - b[0]);
  if (n.op === "min") return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
  if (n.op === "max") return [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  if (n.op === "*") { const v = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return bounded(Math.min(...v), Math.max(...v)); }
  if (b[0] === 0 && b[1] === 0) fail("division by a constant zero");
  const denominators = [b[0], b[1], ...(b[0] <= -1 && b[1] >= -1 ? [-1] : []), ...(b[0] <= 1 && b[1] >= 1 ? [1] : [])].filter(v => v !== 0);
  const v = denominators.flatMap(d => [Math.trunc(a[0] / d), Math.trunc(a[1] / d)]);
  return bounded(Math.min(...v), Math.max(...v));
}
/** Independent arithmetic interpretation is an admission/unknown guard and an
 * equivalence oracle. The returned chart value comes from the circuit itself. */
export function interpretIndicatorFormula(expression: string, buy: number, sell: number): number | undefined {
  const { ast } = parseIndicatorFormula(expression);
  function walk(n: Node): number | undefined {
    if (n.op === "number") return n.value;
    if (n.op === "buy") return buy;
    if (n.op === "sell") return sell;
    const a = walk(n.a); if (a === undefined) return;
    if (n.op === "neg") return -a || 0;
    if (n.op === "abs") return Math.abs(a);
    const b = walk(n.b); if (b === undefined || n.op === "/" && b === 0) return;
    const value = n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? Math.trunc(a / b) : n.op === "min" ? Math.min(a, b) : Math.max(a, b);
    if (!Number.isSafeInteger(value) || value < MIN || value > MAX) fail("runtime intermediate outside int32");
    return value || 0;
  }
  return walk(ast);
}

class Gates {
  readonly gates: [number, number][] = [];
  private common = new Map<string, number>();
  nand(a: number, b: number) {
    if (a === 0 || b === 0) return 1;
    if (a === 1 && b === 1) return 0;
    const key = a < b ? `${a},${b}` : `${b},${a}`, old = this.common.get(key); if (old !== undefined) return old;
    if (this.gates.length >= MAX_GATES - 64) fail("circuit exceeds the 40,000 NAND gate limit; simplify the expression");
    const id = 66 + this.gates.length; this.gates.push([a, b]); this.common.set(key, id); return id;
  }
  not(a: number) { if (a < 2) return 1 - a; return this.nand(a, a); }
  and(a: number, b: number) { return this.not(this.nand(a, b)); }
  or(a: number, b: number) { return this.nand(this.not(a), this.not(b)); }
  xor(a: number, b: number) { if (a === b) return 0; const n = this.nand(a, b); return this.nand(this.nand(a, n), this.nand(b, n)); }
  choose(c: number, y: number, n: number) { if (y === n) return y; return this.nand(this.nand(c, y), this.nand(this.not(c), n)); }
  constant(n: number, width = 32) { return Array.from({ length: width }, (_, i) => (n >>> i) & 1); }
  extend(a: number[], width = 32, signed = true) { return [...a, ...Array(Math.max(0, width - a.length)).fill(signed ? a.at(-1) ?? 0 : 0)].slice(0, width); }
  add(a: number[], b: number[], carry = 0) {
    const bits: number[] = [];
    for (let i = 0; i < a.length; i++) { const x = this.xor(a[i], b[i]); bits.push(this.xor(x, carry)); carry = this.or(this.and(a[i], b[i]), this.and(x, carry)); }
    return { bits, carry };
  }
  sub(a: number[], b: number[]) { return this.add(a, b.map(bit => this.not(bit)), 1); }
  neg(a: number[]) { return this.add(a.map(bit => this.not(bit)), Array(a.length).fill(0), 1).bits; }
  abs(a: number[]) { const neg = this.neg(a), sign = a.at(-1)!; return a.map((bit, i) => this.choose(sign, neg[i], bit)); }
  less(a: number[], b: number[]) { const d = this.sub(a, b); return this.choose(this.xor(a[31], b[31]), a[31], this.not(d.carry)); }
  multiply(a: number[], b: number[], bounds: Range) {
    // Truncated product is exact because interval admission proved no overflow.
    const width = bounds[0] >= 0 ? Math.max(1, Math.ceil(Math.log2(bounds[1] + 1))) : 32;
    let value = Array(width).fill(0) as number[];
    for (let i = 0; i < Math.min(width, b.length); i++) {
      if (b[i] === 0) continue;
      const partial = [...Array(i).fill(0), ...a.slice(0, width - i).map(bit => this.and(bit, b[i]))];
      value = this.add(value, partial).bits;
    }
    return this.extend(value, 32, false);
  }
  divide(a: number[], b: number[], ar: Range, br: Range) {
    const signedA = ar[0] < 0, signedB = br[0] < 0, aa = signedA ? this.abs(a) : a, bb = signedB ? this.abs(b) : b;
    const numeratorWidth = Math.max(1, Math.ceil(Math.log2(Math.max(Math.abs(ar[0]), Math.abs(ar[1])) + 1)));
    const denominatorWidth = Math.min(33, Math.max(2, Math.ceil(Math.log2(Math.max(Math.abs(br[0]), Math.abs(br[1])) + 1)) + 1));
    const denominator = this.extend(bb, denominatorWidth, false);
    let remainder = Array(denominatorWidth).fill(0) as number[];
    const quotient = Array(32).fill(0) as number[];
    for (let bit = numeratorWidth - 1; bit >= 0; bit--) {
      remainder = [aa[bit], ...remainder.slice(0, denominatorWidth - 1)];
      const d = this.sub(remainder, denominator); quotient[bit] = d.carry;
      remainder = remainder.map((old, i) => this.choose(d.carry, d.bits[i], old));
    }
    if (!signedA && !signedB) return quotient;
    const negative = this.xor(signedA ? a[31] : 0, signedB ? b[31] : 0), negate = this.neg(quotient);
    return quotient.map((bit, i) => this.choose(negative, negate[i], bit));
  }
  finish(outputs: number[]) {
    // Do not CSE the suffix: TAP-02 outputs must be final consecutive signals.
    const inverted = outputs.map(bit => { const id = 66 + this.gates.length; this.gates.push([bit, bit]); return id; });
    for (const bit of inverted) this.gates.push([bit, bit]);
    if (this.gates.length > MAX_GATES) fail("circuit gate bound exceeded");
    return `0x${this.gates.map(([a, b]) => `00${a.toString(16).padStart(6, "0")}${b.toString(16).padStart(6, "0")}`).join("")}`;
  }
}
const FORMULAS = new Map<string, { expression: string; netlist: string; range: Range }>();
export function compileIndicatorFormula(expression: string, accumulation: "bar" | "cumulative" = "bar") {
  const parsed = parseIndicatorFormula(expression), key = `${accumulation}:${parsed.expression}`;
  const existing = FORMULAS.get(key); if (existing) return existing;
  const g = new Gates(), words = { buy: g.extend(Array.from({ length: 16 }, (_, i) => i + 2), 32, false), sell: g.extend(Array.from({ length: 16 }, (_, i) => i + 18), 32, false) };
  function walk(n: Node): number[] {
    if (n.op === "number") return g.constant(n.value);
    if (n.op === "buy" || n.op === "sell") return words[n.op];
    const a = walk(n.a);
    if (n.op === "neg") return g.neg(a);
    if (n.op === "abs") return g.abs(a);
    const b = walk(n.b);
    if (n.op === "+") return g.add(a, b).bits;
    if (n.op === "-") return g.sub(a, b).bits;
    if (n.op === "*") return g.multiply(a, b, range(n));
    if (n.op === "/") return g.divide(a, b, range(n.a), range(n.b));
    const less = g.less(a, b); return a.map((bit, i) => n.op === "min" ? g.choose(less, bit, b[i]) : g.choose(less, b[i], bit));
  }
  let output = walk(parsed.ast);
  if (accumulation === "cumulative") output = g.add(output, Array.from({ length: 32 }, (_, i) => i + 34)).bits;
  const result = Object.freeze({ expression: parsed.expression, netlist: g.finish(output), range: Object.freeze(parsed.range) });
  // Bounded compiler cache prevents imports from consuming unbounded memory.
  if (FORMULAS.size >= 32) FORMULAS.delete(FORMULAS.keys().next().value!);
  FORMULAS.set(key, result); return result;
}

export function createFormulaIndicatorPackage(input: { id: string; title: string; description: string; author: string; version?: string; expression: string; output: IndicatorFormulaOutput }): IndicatorFormulaManifest {
  const { expression, netlist } = compileIndicatorFormula(input.expression, input.output.accumulation);
  return parseFormulaIndicatorPackage({ format: "pulse-indicator-v2", id: input.id, version: input.version ?? "1.0.0", title: input.title, description: input.description, author: input.author, license: "MIT", kernel: "formula-v1",
    formula: { language: "pulse-flow-expr-v1", expression, output: input.output },
    prerequisites: { source: "executed-aggressor-volume", units: ["base", "contracts"], missing: "show-partial" },
    runtime: { format: "tap-02-nand", bitOrder: "least-significant-first", inputBits: 64, outputBits: 32, maxPoints: 1024, netlist }, publication: { chainId: 196, registered: false } });
}
function obj(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) fail("object required"); return v as Record<string, unknown>; }
function exact(v: Record<string, unknown>, keys: string[]) { if (Object.keys(v).sort().join("|") !== keys.sort().join("|")) fail("unknown or missing fields"); }
export function parseFormulaIndicatorPackage(input: unknown): IndicatorFormulaManifest {
  const m = obj(input); exact(m, ["format", "id", "version", "title", "description", "author", "license", "kernel", "formula", "prerequisites", "runtime", "publication"]);
  if (m.format !== "pulse-indicator-v2" || m.kernel !== "formula-v1" || m.license !== "MIT") fail("unsupported package or formula version");
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,95}$/.test(m.id) || typeof m.version !== "string" || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(m.version)) fail("invalid identity or version");
  for (const [key, min, max] of [["title", 3, 80], ["description", 10, 600], ["author", 2, 80]] as const) if (typeof m[key] !== "string" || m[key].length < min || m[key].length > max || /[\x00-\x1f\x7f]/.test(m[key] as string)) fail(`invalid ${key}`);
  const f = obj(m.formula); exact(f, ["language", "expression", "output"]); const o = obj(f.output); exact(o, ["label", "unit", "accumulation"]);
  if (f.language !== "pulse-flow-expr-v1" || typeof f.expression !== "string" || typeof o.label !== "string" || o.label.length < 2 || o.label.length > 80 || /[\x00-\x1f\x7f]/.test(o.label) || !["volume", "ratio", "bps", "scalar"].includes(String(o.unit)) || !["bar", "cumulative"].includes(String(o.accumulation))) fail("invalid output definition");
  const degree = quantityDegree(parseIndicatorFormula(f.expression as string).ast);
  if (degree !== null && degree !== (o.unit === "volume" ? 1 : 0)) fail("output units do not match the formula dimension: volume must be linear in quantity; ratio/bps/scalar must be independent of quantity scale");
  const p = obj(m.prerequisites); exact(p, ["source", "units", "missing"]);
  if (p.source !== "executed-aggressor-volume" || p.missing !== "show-partial" || JSON.stringify(p.units) !== '["base","contracts"]') fail("source prerequisites changed");
  const r = obj(m.runtime); exact(r, ["format", "bitOrder", "inputBits", "outputBits", "maxPoints", "netlist"]);
  if (r.format !== "tap-02-nand" || r.bitOrder !== "least-significant-first" || r.inputBits !== 64 || r.outputBits !== 32 || r.maxPoints !== 1024 || typeof r.netlist !== "string" || r.netlist.length > 560002) fail("unsupported circuit ABI or size");
  const canonical = compileIndicatorFormula(f.expression as string, o.accumulation as "bar" | "cumulative");
  if (r.netlist !== canonical.netlist || f.expression !== canonical.expression) fail("formula does not match its compiled circuit");
  const pub = obj(m.publication); exact(pub, ["chainId", "registered"]); if (pub.chainId !== 196 || pub.registered !== false) fail("unsupported publication claim; registration is independently verified");
  return JSON.parse(JSON.stringify(m)) as IndicatorFormulaManifest;
}
