/** Portable financial calculations using TAP-02's combinational NAND format.
 * No scripts, remote dependencies, wallet calls or mutable circuit state occur.
 * These packages are locally evaluated, not registered X Layer deployments.
 */
export type IndicatorKernel = "executed-cvd-v1" | "buy-participation-v1";
export type IndicatorManifest = {
  format: "pulse-indicator-v1";
  id: string;
  version: string;
  title: string;
  description: string;
  author: string;
  license: "MIT";
  kernel: IndicatorKernel;
  prerequisites: { source: "executed-aggressor-volume"; units: readonly ["base", "contracts"]; missing: "show-partial" };
  runtime: { format: "tap-02-nand"; bitOrder: "least-significant-first"; inputBits: number; outputBits: number; maxPoints: 1024; netlist: string };
  publication: { chainId: 196; registered: false };
};
export type IndicatorInput = {
  instId: string; timeframe: string; source: string;
  status: "available" | "partial" | "stale" | "unavailable";
  knownAt: number; windowStart: number; windowEnd: number; units: "base" | "contracts";
  points: readonly { ts: number; end?: number; buy: number; sell: number }[];
  now?: number; maxAgeMs?: number;
};
export type IndicatorPoint = { ts: number; delta?: number; cvd?: number; participationBps?: number; netParticipationBps?: number };
export type IndicatorResult = {
  id: string; status: IndicatorInput["status"]; reason?: string;
  points: IndicatorPoint[];
  summary: { delta?: number; cvd?: number; participationBps?: number; netParticipationBps?: number; label: string };
  precision: { quantityQuantum: number; maxCvdError: number; note: string };
  provenance: { execution: "local-tap02"; chainId: 196; registered: false; source: string; knownAt: number; windowStart: number; windowEnd: number; gateCount: number; units: "base" | "contracts" };
};
const MAX_POINTS = 1024, MAX_GATES = 40_000, MAX_PACKAGE_BYTES = 600_000;
const fail = (message: string): never => { throw Error(`Indicator package: ${message}`); };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail("object required");
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail("unknown or missing fields");
}

class NandBuilder {
  readonly gates: [number, number][] = [];
  constructor(readonly inputs: number) {}
  nand(a: number, b: number) { const id = this.inputs + 2 + this.gates.length; this.gates.push([a, b]); return id; }
  not(a: number) { return this.nand(a, a); }
  and(a: number, b: number) { return this.not(this.nand(a, b)); }
  or(a: number, b: number) { return this.nand(this.not(a), this.not(b)); }
  xor(a: number, b: number) { const n = this.nand(a, b); return this.nand(this.nand(a, n), this.nand(b, n)); }
  select(condition: number, yes: number, no: number) { return this.nand(this.nand(condition, yes), this.nand(this.not(condition), no)); }
  add(a: number[], b: number[], carry = 0) {
    const bits: number[] = [];
    for (let i = 0; i < a.length; i++) {
      const x = this.xor(a[i], b[i]); bits.push(this.xor(x, carry));
      carry = this.or(this.and(a[i], b[i]), this.and(x, carry));
    }
    return { bits, carry };
  }
  subtract(a: number[], b: number[]) { return this.add(a, b.map(n => this.not(n)), 1); }
  constant(n: number, width: number) { return Array.from({ length: width }, (_, i) => Math.floor(n / 2 ** i) % 2); }
  /** Copies outputs to the final consecutive signal slots, as required by TAP-02. */
  finish(outputs: number[]) {
    const inverted = outputs.map(bit => this.not(bit));
    for (const bit of inverted) this.not(bit);
    return `0x${this.gates.map(([a, b]) => `00${a.toString(16).padStart(6, "0")}${b.toString(16).padStart(6, "0")}`).join("")}`;
  }
}
const pad = (bits: number[], size: number) => [...bits, ...Array(Math.max(0, size - bits.length)).fill(0)].slice(0, size);
const CACHE = new Map<IndicatorKernel, Readonly<IndicatorManifest>>();
function canonical(kernel: IndicatorKernel): Readonly<IndicatorManifest> {
  const cached = CACHE.get(kernel); if (cached) return cached;
  const cvd = kernel === "executed-cvd-v1", b = new NandBuilder(cvd ? 64 : 32);
  const buy = Array.from({ length: 16 }, (_, i) => i + 2), sell = Array.from({ length: 16 }, (_, i) => i + 18);
  let outputs: number[];
  if (cvd) {
    const delta = b.subtract(pad(buy, 32), pad(sell, 32)).bits;
    const previous = Array.from({ length: 32 }, (_, i) => i + 34);
    outputs = [...delta, ...b.add(delta, previous).bits];
  } else {
    // Unsigned long division computes floor(buy * 10000 / (buy + sell)).
    // Both the multiplication and division consist entirely of NAND gates.
    const width = 30, denominator = pad(b.add(pad(buy, 17), pad(sell, 17)).bits, 18);
    let numerator = Array(width).fill(0) as number[];
    for (let shift = 0; shift < 14; shift++) if ((10000 >>> shift) & 1) numerator = b.add(numerator, pad([...Array(shift).fill(0), ...buy], width)).bits;
    let remainder = Array(18).fill(0) as number[];
    const quotient = Array(width).fill(0) as number[];
    for (let bit = width - 1; bit >= 0; bit--) {
      remainder = [numerator[bit], ...remainder.slice(0, 17)];
      const difference = b.subtract(remainder, denominator);
      quotient[bit] = difference.carry;
      remainder = remainder.map((old, i) => b.select(difference.carry, difference.bits[i], old));
    }
    outputs = quotient.slice(0, 14);
  }
  const result: IndicatorManifest = {
    format: "pulse-indicator-v1", id: cvd ? "pulse.executed-cvd" : "pulse.buy-participation", version: "1.0.0",
    title: cvd ? "Cumulative executed delta" : "Buyer participation",
    description: cvd ? "Executed buy volume minus sell volume, accumulated from the selected source-window start. A gap is not reconstructed." : "Buyer share of executed volume for each source bar, from 0 to 100%. It measures aggressor flow, not future direction.",
    author: "PULSE", license: "MIT", kernel,
    prerequisites: { source: "executed-aggressor-volume", units: ["base", "contracts"], missing: "show-partial" },
    runtime: { format: "tap-02-nand", bitOrder: "least-significant-first", inputBits: cvd ? 64 : 32, outputBits: cvd ? 64 : 14, maxPoints: 1024, netlist: b.finish(outputs) },
    publication: { chainId: 196, registered: false },
  };
  Object.freeze(result.prerequisites.units); Object.freeze(result.prerequisites); Object.freeze(result.runtime); Object.freeze(result.publication); Object.freeze(result);
  CACHE.set(kernel, result); return result;
}
export function indicatorMarketCatalog(): IndicatorManifest[] {
  return [canonical("executed-cvd-v1"), canonical("buy-participation-v1")].map(manifest => JSON.parse(JSON.stringify(manifest)) as IndicatorManifest);
}

export function createIndicatorPackage(input: { id: string; title: string; description: string; author: string; kernel: IndicatorKernel; version?: string }): IndicatorManifest {
  if (input.kernel !== "executed-cvd-v1" && input.kernel !== "buy-participation-v1") fail("unsupported kernel version");
  const base = JSON.parse(JSON.stringify(canonical(input.kernel))) as IndicatorManifest;
  return parseIndicatorPackage({ ...base, id: input.id, title: input.title, description: input.description, author: input.author, version: input.version ?? "1.0.0" });
}

/** Strict import: this release supports reviewed numeric kernels, not arbitrary
 * creator scripts. Changing a formula requires a new reviewed kernel version.
 * Exact comparison establishes formula identity; it does not authenticate feed data.
 */
export function parseIndicatorPackage(input: string | unknown): IndicatorManifest {
  if (typeof input === "string") {
    if (input.length > MAX_PACKAGE_BYTES) fail("size limit exceeded");
    try { input = JSON.parse(input); } catch { fail("invalid JSON"); }
  }
  const m = object(input);
  exactKeys(m, ["format", "id", "version", "title", "description", "author", "license", "kernel", "prerequisites", "runtime", "publication"]);
  if (m.kernel !== "executed-cvd-v1" && m.kernel !== "buy-participation-v1") fail("unsupported kernel version");
  const expected = canonical(m.kernel as IndicatorKernel);
  for (const key of ["format", "license", "kernel"] as const) if (m[key] !== expected[key]) fail(`unreviewed ${key}`);
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,95}$/.test(m.id) || typeof m.version !== "string" || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(m.version)) fail("invalid package identity or version");
  for (const [key, min, max] of [["title", 3, 80], ["description", 10, 600], ["author", 2, 80]] as const) if (typeof m[key] !== "string" || m[key].length < min || m[key].length > max || /[\x00-\x1f\x7f]/.test(m[key] as string)) fail(`invalid ${key}`);
  const p = object(m.prerequisites); exactKeys(p, ["source", "units", "missing"]);
  if (p.source !== expected.prerequisites.source || p.missing !== "show-partial" || !Array.isArray(p.units) || p.units.length !== 2 || p.units[0] !== "base" || p.units[1] !== "contracts") fail("source prerequisites changed");
  const r = object(m.runtime); exactKeys(r, ["format", "bitOrder", "inputBits", "outputBits", "maxPoints", "netlist"]);
  for (const key of ["format", "bitOrder", "inputBits", "outputBits", "maxPoints", "netlist"] as const) if (r[key] !== expected.runtime[key]) fail(`unreviewed circuit ${key}`);
  const publication = object(m.publication); exactKeys(publication, ["chainId", "registered"]);
  if (publication.chainId !== 196 || publication.registered !== false) fail("unsupported publication claim");
  return { ...JSON.parse(JSON.stringify(expected)), id: m.id, title: m.title, description: m.description, author: m.author, version: m.version } as IndicatorManifest;
}
export function exportIndicatorPackage(manifest: IndicatorManifest): string { return JSON.stringify(parseIndicatorPackage(manifest), null, 2); }

type Compiled = { inputBits: number; outputBits: number; gates: Uint32Array };
const COMPILED = new Map<IndicatorKernel, Compiled>();
function compile(manifest: IndicatorManifest): Compiled {
  const existing = COMPILED.get(manifest.kernel); if (existing) return existing;
  const raw = manifest.runtime.netlist;
  if (!/^0x(?:[a-f0-9]{14})+$/.test(raw)) fail("invalid TAP-02 NAND bytes");
  const count = (raw.length - 2) / 14;
  if (count > MAX_GATES || count < manifest.runtime.outputBits) fail("gate bound exceeded");
  const gates = new Uint32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 14;
    if (raw.slice(at, at + 2) !== "00") fail("only bounded NAND opcodes supported");
    const a = Number.parseInt(raw.slice(at + 2, at + 8), 16), b = Number.parseInt(raw.slice(at + 8, at + 14), 16);
    if (a >= manifest.runtime.inputBits + 2 + i || b >= manifest.runtime.inputBits + 2 + i) fail("noncausal signal reference");
    gates[i * 2] = a; gates[i * 2 + 1] = b;
  }
  const result = { inputBits: manifest.runtime.inputBits, outputBits: manifest.runtime.outputBits, gates };
  COMPILED.set(manifest.kernel, result); return result;
}
function run(circuit: Compiled, buy: number, sell: number, previousCvd: number) {
  const signal = new Uint8Array(circuit.inputBits + 2 + circuit.gates.length / 2); signal[1] = 1;
  for (let i = 0; i < 16; i++) { signal[2 + i] = (buy >>> i) & 1; signal[18 + i] = (sell >>> i) & 1; }
  if (circuit.inputBits === 64) for (let i = 0; i < 32; i++) signal[34 + i] = (previousCvd >>> i) & 1;
  for (let i = 0; i < circuit.gates.length / 2; i++) signal[circuit.inputBits + 2 + i] = 1 - (signal[circuit.gates[i * 2]] & signal[circuit.gates[i * 2 + 1]]);
  const begin = signal.length - circuit.outputBits;
  function word(offset: number, width: number, signed = false) {
    let n = 0; for (let i = 0; i < width; i++) n += signal[begin + offset + i] * 2 ** i;
    return signed && signal[begin + offset + width - 1] ? n - 2 ** width : n;
  }
  return circuit.outputBits === 64 ? { deltaQ: word(0, 32, true), cvdQ: word(32, 32, true) } : { participationBps: word(0, 14) };
}
/** Useful independently of PULSE UI: integer ABI is exactly buy uint16, sell
 * uint16, and (for CVD) prior signed int32; outputs are final TAP-02 signals. */
export function evaluateIndicatorCircuit(manifest: IndicatorManifest, input: { buy: number; sell: number; previousCvd?: number }) {
  const m = parseIndicatorPackage(manifest), prior = input.previousCvd ?? 0;
  if (![input.buy, input.sell].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 65535) || !Number.isSafeInteger(prior) || prior < -2147483648 || prior > 2147483647) fail("integer input outside circuit ABI");
  if (m.kernel === "buy-participation-v1" && input.buy + input.sell === 0) fail("participation requires nonzero executed volume");
  if (m.kernel === "executed-cvd-v1" && (prior + input.buy - input.sell < -2147483648 || prior + input.buy - input.sell > 2147483647)) fail("cumulative delta would overflow");
  return run(compile(m), input.buy, input.sell, prior);
}

/** Evaluate actual executed volumes from one explicitly bounded source window.
 * Volumes are quantized to a shared 16-bit scale. This is reported rather than
 * pretending a fixed-width Boolean circuit preserves arbitrary float precision.
 */
export function evaluateIndicator(manifest: IndicatorManifest, input: IndicatorInput): IndicatorResult {
  const m = parseIndicatorPackage(manifest), circuit = compile(m), now = input.now ?? Date.now();
  if (!input.instId || !input.timeframe || !input.source || !["base", "contracts"].includes(input.units) || !["available", "partial", "stale", "unavailable"].includes(input.status)) fail("source identity or units missing");
  if (![input.knownAt, input.windowStart, input.windowEnd, now].every(Number.isSafeInteger) || input.knownAt < 0 || input.windowStart < 0 || input.windowEnd <= input.windowStart || input.knownAt > now + 30000) fail("invalid source clock");
  if (!Array.isArray(input.points) || input.points.length > MAX_POINTS) fail("source point limit exceeded");
  for (const [i, point] of input.points.entries()) if (!Number.isSafeInteger(point.ts) || point.ts < input.windowStart || point.ts >= input.windowEnd || point.ts > input.knownAt || point.end !== undefined && (!Number.isSafeInteger(point.end) || point.end <= point.ts || point.end > input.windowEnd || point.end > input.knownAt) || ![point.buy, point.sell].every(n => Number.isFinite(n) && n >= 0 && n <= 1e100) || i > 0 && point.ts <= input.points[i - 1].ts) fail("invalid, unordered or out-of-window execution point");
  const maxAge = input.maxAgeMs ?? 300000;
  if (!Number.isSafeInteger(maxAge) || maxAge < 1000 || maxAge > 31 * 86400000) fail("invalid freshness limit");
  let status = input.status;
  let reason = status === "partial" ? "Incomplete execution coverage: values describe collected intervals only. Cumulative delta excludes missing executions." : status === "unavailable" ? "Executed buy/sell volume is unavailable." : undefined;
  if (!input.points.length || status === "unavailable") { status = "unavailable"; reason = "No eligible executed buy/sell volume in this source window."; }
  else if (status === "stale" || now - input.knownAt > maxAge) { status = "stale"; reason = "Source is stale; these are historical measurements, not a current trading signal."; }
  const max = input.points.reduce((n, point) => Math.max(n, point.buy, point.sell), 0), quantum = max > 0 ? max / 65535 : 1;
  if (!Number.isFinite(quantum) || quantum <= 0) fail("quantity scale outside supported precision");
  let previous = 0;
  const points: IndicatorPoint[] = status === "unavailable" ? [] : input.points.map(point => {
    const buy = Math.min(65535, Math.round(point.buy / quantum)), sell = Math.min(65535, Math.round(point.sell / quantum));
    if (m.kernel === "buy-participation-v1" && buy + sell === 0) return { ts: point.ts };
    const output = run(circuit, buy, sell, previous);
    if (output.cvdQ !== undefined && output.deltaQ !== undefined) { previous = output.cvdQ; return { ts: point.ts, delta: output.deltaQ * quantum, cvd: output.cvdQ * quantum }; }
    return { ts: point.ts, participationBps: output.participationBps, netParticipationBps: 2 * output.participationBps! - 10000 };
  });
  const last = points.at(-1), summary = { ...last, label: m.kernel === "executed-cvd-v1" ? "Cumulative executed buy minus sell volume" : "Buyer share of the last source bar's executed volume" };
  return { id: m.id, status, reason, points, summary,
    precision: { quantityQuantum: quantum, maxCvdError: input.points.length * quantum, note: "Shared 16-bit volume quantization; CVD absolute error is bounded by point count × quantity quantum. Buyer share is integer basis points after quantization; very small bars may be unresolved." },
    provenance: { execution: "local-tap02", chainId: 196, registered: false, source: input.source, knownAt: input.knownAt, windowStart: input.windowStart, windowEnd: input.windowEnd, gateCount: circuit.gates.length / 2, units: input.units },
  };
}
