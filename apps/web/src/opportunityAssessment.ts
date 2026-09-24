export type OpportunityAssessment = { pair: string; timeframe: string; bias: string; confidence: number; recommended: boolean; generatedAt: string };
export const ASSESSMENT_EVENT = "pulse:opportunity-assessment";
const storageKey = (network: string) => `pulse:opportunity-assessments:${network}`;
export function readOpportunityAssessments(storage: Pick<Storage, "getItem">, network: string): OpportunityAssessment[] {
  try {
    const data = JSON.parse(storage.getItem(storageKey(network)) || "[]");
    return Array.isArray(data) ? data.filter(item => typeof item?.pair === "string" && typeof item?.timeframe === "string" && typeof item?.confidence === "number" && Number.isFinite(Date.parse(item.generatedAt))).slice(0, 50) : [];
  } catch { return []; }
}
export function rememberOpportunityAssessment(storage: Pick<Storage, "getItem" | "setItem">, network: string, report: Record<string, unknown>) {
  const analysis = report.analysis as Record<string, unknown> | undefined;
  const plan = report.executionPlan as { recommendation?: { action?: string } } | undefined;
  if (!analysis || typeof report.instId !== "string" || typeof report.timeframe !== "string" || typeof analysis.confidence !== "number" || typeof report.generatedAt !== "string") return;
  const assessment: OpportunityAssessment = { pair: report.instId, timeframe: report.timeframe, bias: String(analysis.bias), confidence: analysis.confidence, recommended: plan?.recommendation?.action === "buy", generatedAt: report.generatedAt };
  const others = readOpportunityAssessments(storage, network).filter(item => item.pair !== assessment.pair || item.timeframe !== assessment.timeframe);
  storage.setItem(storageKey(network), JSON.stringify([assessment, ...others].slice(0, 50)));
}
export function currentOpportunityAssessment(items: OpportunityAssessment[], pair: string, timeframe: string, now = Date.now()) {
  return items.find(item => item.pair === pair && item.timeframe === timeframe && now >= Date.parse(item.generatedAt) && now - Date.parse(item.generatedAt) <= 15 * 60_000);
}
export function isConfirmedSpotSetup(item: OpportunityAssessment | undefined) {
  return Boolean(item && item.bias === "bullish" && item.confidence > 60 && item.recommended);
}
