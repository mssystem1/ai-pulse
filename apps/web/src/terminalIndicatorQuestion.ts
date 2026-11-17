import type { IndicatorManifest, IndicatorResult } from "@pulse/domain";

export const TERMINAL_INDICATOR_QUESTION_LIMIT = 1500;

function latestOutputs(manifest: IndicatorManifest, result: IndicatorResult) {
  if (result.outputs?.length) return result.outputs.map(output => ({ label: output.plot.label, unit: output.plot.unit, pane: output.plot.pane, last: output.points.filter(point => point.value !== undefined).at(-1) ?? null }));
  const unit = manifest.format === "pulse-indicator-v2" || manifest.format === "pulse-indicator-v3" ? manifest.formula.output.unit : undefined;
  return [{ label: result.summary.label, ...(unit ? { unit } : {}), last: result.points.filter(point => point.value !== undefined || point.delta !== undefined || point.cvd !== undefined || point.participationBps !== undefined).at(-1) ?? null }];
}

function exactCalculation(manifest: IndicatorManifest): Record<string, unknown> | undefined {
  if (manifest.format === "pulse-indicator-v4") return { graph: manifest.graph };
  if (manifest.format === "pulse-indicator-v3") return { formula: manifest.formula, study: manifest.study };
  if (manifest.format === "pulse-indicator-v2") return { formula: manifest.formula };
  return { kernel: manifest.kernel };
}

/** Build a section-bound Ask PULSE question without cutting serialized graph
 * or result JSON. Exact calculations are included only when the full request
 * fits; otherwise the omission is explicit so the model cannot infer them. */
export function terminalIndicatorQuestion(manifest: IndicatorManifest, result: IndicatorResult, marketInstId: string, timeframe: string, stream: "spot" | "perpetual"): string {
  const base: Record<string, unknown> = {
    indicator: { title: manifest.title, version: manifest.version, kind: manifest.format },
    market: marketInstId, timeframe, stream, coverage: result.status,
    source: result.provenance.source,
    sourceWindow: { start: result.provenance.windowStart, end: result.provenance.windowEnd, knownAt: result.provenance.knownAt },
    outputs: latestOutputs(manifest, result),
  };
  const calculation = exactCalculation(manifest);
  const instruction = "Explain only the supplied indicator facts and latest readings. Do not infer a direction or any omitted calculation.";
  const format = (context: Record<string, unknown>) => `Explain this indicator from the supplied data: ${JSON.stringify(context)}. ${instruction}`;
  if (calculation) {
    const complete = format({ ...base, ...calculation });
    if (complete.length <= TERMINAL_INDICATOR_QUESTION_LIMIT) return complete;
  }
  const omittedCalculation = format({ ...base, omittedCalculation: true, limitation: "The exact graph/formula is omitted because it exceeded the question limit; do not infer its logic from its title, plot labels or readings." });
  if (omittedCalculation.length <= TERMINAL_INDICATOR_QUESTION_LIMIT) return omittedCalculation;

  // Result records are bounded by the indicator runtime (at most eight graph
  // plots), but keep an explicit count if unusually long metadata crowds them.
  const outputs = base.outputs as Array<Record<string, unknown>>;
  for (let count = outputs.length - 1; count >= 0; count--) {
    const shortened = format({ ...base, outputs: outputs.slice(0, count), omittedOutputCount: outputs.length - count, omittedCalculation: Boolean(calculation), limitation: "Some output summaries or the exact graph/formula are omitted to stay within the question limit. Do not infer omitted logic or readings." });
    if (shortened.length <= TERMINAL_INDICATOR_QUESTION_LIMIT) return shortened;
  }
  // Pathological source labels can themselves exceed the API limit. State the
  // omission explicitly and retain the exact source clock without cutting JSON.
  const emergency = `Indicator context exceeded ${TERMINAL_INDICATOR_QUESTION_LIMIT} characters. Market ${marketInstId}; timeframe ${timeframe}; ${stream}; coverage ${result.status}. Source identity and output values were explicitly omitted because the metadata would not fit. Exact source window: ${result.provenance.windowStart} to ${result.provenance.windowEnd}; known at ${result.provenance.knownAt}. Do not infer the calculation or unprovided readings.`;
  return emergency.length <= TERMINAL_INDICATOR_QUESTION_LIMIT ? emergency : `Indicator context exceeded ${TERMINAL_INDICATOR_QUESTION_LIMIT} characters; market and source labels were explicitly omitted. Exact source window: ${result.provenance.windowStart} to ${result.provenance.windowEnd}; known at ${result.provenance.knownAt}. Calculation and outputs omitted. Do not infer missing logic or readings.`;
}
