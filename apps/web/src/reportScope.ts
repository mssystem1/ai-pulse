export type ReportSlots = { global: Record<string, unknown> | null; risk: Record<string, unknown> | null };
export function reportScope(report: Record<string, unknown>): keyof ReportSlots {
  return ["analysis_base", "analysis_premium", "spot_analysis_standard", "spot_analysis_premium"].includes(String(report.service)) ? "global" : "risk";
}
export function storeScopedReport(slots: ReportSlots, report: Record<string, unknown> | null, clearedScope: keyof ReportSlots): ReportSlots {
  return { ...slots, [report ? reportScope(report) : clearedScope]: report };
}
