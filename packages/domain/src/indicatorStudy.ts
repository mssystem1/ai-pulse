/** A portable causal study composes a TAP-02 per-bar calculation with an
 * explicit, bounded host-side series pipeline. The circuit proves the numeric
 * kernel only; source coverage, rolling state and plotting remain host duties. */
import { createFormulaIndicatorPackage, parseFormulaIndicatorPackage, type IndicatorFormulaManifest, type IndicatorFormulaOutput } from "./indicatorFormula.js";

export type IndicatorStudyTransform = { kind: "ema" | "sma" | "sum"; period: number } | { kind: "cumulative" };
export type IndicatorStudySignal = { kind: "above" | "below" | "cross-above" | "cross-below"; threshold: number; label: string };
export type IndicatorStudyDefinition = {
  transforms: IndicatorStudyTransform[];
  plot: "line" | "histogram";
  signal?: IndicatorStudySignal;
  gapPolicy: "reset";
  warmup: "full-window";
};
export type IndicatorStudyManifest = Omit<IndicatorFormulaManifest, "format"> & { format: "pulse-indicator-v3"; study: IndicatorStudyDefinition };
export type IndicatorStudySample = { ts: number; value?: number; rawValue?: number; signal?: boolean; reset?: boolean; partial?: boolean };

const fail = (reason: string): never => { throw Error(`Indicator study: ${reason}`); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object required");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) fail("unknown or missing fields");
}
export function parseIndicatorStudyDefinition(input: unknown): IndicatorStudyDefinition {
  const value = object(input);
  exact(value, ["transforms", "plot", "gapPolicy", "warmup"], ["signal"]);
  if (value.plot !== "line" && value.plot !== "histogram" || value.gapPolicy !== "reset" || value.warmup !== "full-window") fail("unsupported plotting, gap or warm-up policy");
  if (!Array.isArray(value.transforms) || value.transforms.length > 4) fail("at most four series transforms are supported");
  const transforms = (value.transforms as unknown[]).map(raw => {
    const transform = object(raw);
    if (transform.kind === "cumulative") { exact(transform, ["kind"]); return { kind: "cumulative" } as const; }
    exact(transform, ["kind", "period"]);
    if (!["ema", "sma", "sum"].includes(String(transform.kind)) || !Number.isSafeInteger(transform.period) || Number(transform.period) < 2 || Number(transform.period) > 200) fail("EMA, SMA and rolling-sum periods must be integers from 2 to 200 source bars");
    return { kind: transform.kind as "ema" | "sma" | "sum", period: Number(transform.period) };
  });
  let signal: IndicatorStudySignal | undefined;
  if (value.signal !== undefined) {
    const raw = object(value.signal); exact(raw, ["kind", "threshold", "label"]);
    if (!["above", "below", "cross-above", "cross-below"].includes(String(raw.kind)) || typeof raw.threshold !== "number" || !Number.isFinite(raw.threshold) || Math.abs(raw.threshold) > 1e12 || typeof raw.label !== "string" || raw.label.length < 2 || raw.label.length > 80 || /[\x00-\x1f\x7f]/.test(raw.label)) fail("invalid threshold condition");
    signal = { kind: raw.kind as IndicatorStudySignal["kind"], threshold: raw.threshold as number, label: raw.label as string };
  }
  return { transforms, plot: value.plot as "line" | "histogram", ...(signal ? { signal } : {}), gapPolicy: "reset", warmup: "full-window" };
}

export function createStudyIndicatorPackage(input: {
  id: string; title: string; description: string; author: string; version?: string;
  expression: string; output: IndicatorFormulaOutput; study: IndicatorStudyDefinition;
}): IndicatorStudyManifest {
  if (input.output.accumulation !== "bar") fail("use a cumulative series transform instead of kernel accumulation");
  const base = createFormulaIndicatorPackage(input);
  return parseStudyIndicatorPackage({ ...base, format: "pulse-indicator-v3", study: input.study });
}

export function parseStudyIndicatorPackage(input: unknown): IndicatorStudyManifest {
  const value = object(input);
  exact(value, ["format", "id", "version", "title", "description", "author", "license", "kernel", "formula", "prerequisites", "runtime", "publication", "study"]);
  if (value.format !== "pulse-indicator-v3") fail("unsupported study version");
  const { study, ...base } = value;
  const formula = parseFormulaIndicatorPackage({ ...base, format: "pulse-indicator-v2" });
  if (formula.formula.output.accumulation !== "bar") fail("use a cumulative series transform instead of kernel accumulation");
  return { ...formula, format: "pulse-indicator-v3", study: parseIndicatorStudyDefinition(study) };
}

/** Each stage consumes only the current and earlier contiguous values. EMA is
 * seeded by a full-period SMA; missing values reset every stage and crossover
 * memory. No backfilling, interpolation, lookahead or partial-window averages. */
export function evaluateIndicatorStudySeries(input: readonly IndicatorStudySample[], definition: IndicatorStudyDefinition): IndicatorStudySample[] {
  const study = parseIndicatorStudyDefinition(definition);
  if (!Array.isArray(input) || input.length > 1024 || input.some((point, index) => !Number.isSafeInteger(point.ts) || point.ts < 0 || index > 0 && point.ts <= input[index - 1].ts || point.value !== undefined && !Number.isFinite(point.value))) fail("series requires at most 1024 ordered finite source observations");
  const states = study.transforms.map(() => ({ values: [] as number[], ema: undefined as number | undefined, total: 0 }));
  let prior: number | undefined;
  const reset = () => { for (const state of states) { state.values = []; state.ema = undefined; state.total = 0; } prior = undefined; };
  return input.map(point => {
    if (point.reset) reset();
    if (point.value === undefined || point.partial && study.transforms.length > 0) { reset(); return { ts: point.ts, ...(point.reset || point.partial && study.transforms.length > 0 ? { reset: true } : {}), ...(point.partial ? { partial: true } : {}) }; }
    const rawValue = point.value;
    let current: number | undefined = rawValue;
    for (let i = 0; i < study.transforms.length; i++) {
      const transform = study.transforms[i], state = states[i];
      if (current === undefined) break;
      if (transform.kind === "cumulative") { state.total += current; current = state.total; }
      else {
        state.values.push(current);
        if (state.values.length > transform.period) state.values.shift();
        if (state.values.length < transform.period) { current = undefined; continue; }
        if (transform.kind === "ema") {
          state.ema = state.ema === undefined ? state.values.reduce((sum, value) => sum + value, 0) / transform.period : current * (2 / (transform.period + 1)) + state.ema * (1 - 2 / (transform.period + 1));
          current = state.ema;
        } else { current = state.values.reduce((sum, value) => sum + value, 0); if (transform.kind === "sma") current /= transform.period; }
      }
      if (!Number.isFinite(current)) fail("series output exceeds finite numeric range");
    }
    if (current === undefined) return { ts: point.ts, rawValue, ...(point.reset ? { reset: true } : {}), ...(point.partial ? { partial: true } : {}) };
    const condition = study.signal;
    const signal = !condition ? undefined : condition.kind === "above" ? current > condition.threshold : condition.kind === "below" ? current < condition.threshold : point.partial || prior === undefined ? undefined : condition.kind === "cross-above" ? prior <= condition.threshold && current > condition.threshold : prior >= condition.threshold && current < condition.threshold;
    prior = point.partial ? undefined : current;
    return { ts: point.ts, rawValue, value: current, ...(signal === undefined ? {} : { signal }), ...(point.reset ? { reset: true } : {}), ...(point.partial ? { partial: true } : {}) };
  });
}

export type IndicatorStudyTemplate = { id: string; title: string; description: string; expression: string; output: IndicatorFormulaOutput; study: IndicatorStudyDefinition };
export function indicatorStudyTemplates(): IndicatorStudyTemplate[] {
  const study = (transforms: IndicatorStudyTransform[], plot: "line" | "histogram", signal?: IndicatorStudySignal): IndicatorStudyDefinition => ({ transforms, plot, ...(signal ? { signal } : {}), gapPolicy: "reset", warmup: "full-window" });
  return [
    { id: "volume-delta", title: "Executed volume delta", description: "Executed buy quantity minus sell quantity for each complete source bar. Positive values show more aggressive buying in that bar, not a trade recommendation.", expression: "buy-sell", output: { label: "Executed volume delta", unit: "volume", accumulation: "bar" }, study: study([], "histogram", { kind: "above", threshold: 0, label: "Aggressor buying exceeds selling" }) },
    { id: "cvd", title: "Cumulative executed delta", description: "Accumulate executed buy minus sell quantity. A verified source gap starts a new segment.", expression: "buy-sell", output: { label: "Executed delta", unit: "volume", accumulation: "bar" }, study: study([{ kind: "cumulative" }], "line") },
    { id: "participation", title: "Buyer participation", description: "Buyer share of actual aggressor executions, displayed as a percentage for each source bar.", expression: "10000*buy/(buy+sell)", output: { label: "Buyer participation", unit: "bps", accumulation: "bar" }, study: study([], "line", { kind: "above", threshold: 5000, label: "Buyers exceed 50% of executions" }) },
    { id: "delta-ema", title: "Delta % with EMA 8", description: "Smooth normalized executed delta over eight source bars. Above zero means recent aggressor buy volume dominates, not a buy instruction.", expression: "10000*(buy-sell)/(buy+sell)", output: { label: "Delta % EMA 8", unit: "bps", accumulation: "bar" }, study: study([{ kind: "ema", period: 8 }], "line", { kind: "cross-above", threshold: 0, label: "Smoothed executed delta crossed above zero" }) },
    { id: "rolling-delta", title: "Rolling executed delta 20", description: "Sum executed buy minus sell quantity over twenty complete, contiguous source bars.", expression: "buy-sell", output: { label: "Rolling delta 20", unit: "volume", accumulation: "bar" }, study: study([{ kind: "sum", period: 20 }], "histogram", { kind: "above", threshold: 0, label: "Net buying across twenty source bars" }) },
    { id: "weighted-flow", title: "Weighted executed flow", description: "A configurable creator example: twice executed buy quantity minus sell quantity. This deliberately asymmetric weighting is not net volume.", expression: "buy*2-sell", output: { label: "Weighted flow", unit: "volume", accumulation: "bar" }, study: study([], "histogram") },
  ];
}
