// Shared delivery contract for every asynchronous research service. Recovery is
// free; a successful payment is the start of delivery, not the completed task.
export function reportDelivery(jobId: string) {
  return {
    pollUrl: `/v1/jobs/${jobId}`,
    reportUrl: `/v1/jobs/${jobId}/report`,
    delivery: {
      status: "processing", method: "GET", authHeader: "PULSE-RECOVERY-TOKEN",
      pollIntervalSeconds: 3, paymentRequired: false,
      completionStages: ["completed", "completed_partial"],
      failureStages: ["failed_retriable", "failed_terminal", "manual_reconciliation"],
      retryUrl: `/v1/jobs/${jobId}/retry`, retryMethod: "POST",
      instructions: "Keep the recoveryToken private. Poll pollUrl every 3 seconds until a completion or failure stage, then fetch reportUrl. Deliver the full reportMarkdown, including limitations and conditional trade levels, in the requested language. A headline or summary alone is not full delivery. If interrupted, resume this job without another payment; report any failure explicitly.",
    },
  };
}

const SECTIONS = ["analysis", "market", "technical", "executionPlan", "defi", "predictionContext", "underlyingSpot", "fusion", "divergence", "eventRisk", "summary", "intelligence", "checklist", "recommendations", "sourceCoverage", "limitations", "disclaimer"];
const OMIT = new Set(["candles", "raw", "recoveryToken", "_telegramDelivery", "aiUsage"]);
const METADATA = new Set(["service", "serviceName", "instId", "timeframe", "tier", "lang", "generatedAt", "model", "methodology_version", "analysisProfile", "aiCost", "shareId", "chart", "history"]);
const ZH_LABELS: Record<string,string> = { analysis:"市场分析", market:"市场数据", technical:"技术结构", executionPlan:"交易计划", defi:"DeFi 背景", predictionContext:"预测市场证据", underlyingSpot:"标的现货市场", fusion:"综合分析", divergence:"市场背离", eventRisk:"事件风险", summary:"摘要", intelligence:"风险分析", checklist:"检查清单", recommendations:"建议", sourceCoverage:"来源覆盖", limitations:"限制与未知项", disclaimer:"免责声明", headline:"结论", bias:"方向", confidence:"置信度", keyLevels:"关键价位", support:"支撑", resistance:"阻力", targets:"目标", invalidation:"失效条件", scenarios:"情景", riskScore:"已观察风险评分", overallScore:"综合评分", unknowns:"未知项", criticalRisks:"已观察风险", positiveSignals:"积极信号", components:"评分明细", token:"代币证据", evidence:"事实证据", recommendation:"建议", action:"行动", reason:"理由", trigger:"触发价", stopLoss:"止损", takeProfit:"止盈", riskReward:"风险回报比", observedPrice:"观察价格", entryZone:"入场区间", mostLikelyLossScenario:"可能的损失情景" };
function label(key: string, lang: string) { return lang === "zh" && ZH_LABELS[key] ? ZH_LABELS[key] : key.replace(/([a-z])([A-Z])/g, "$1 $2"); }
function readable(value: unknown, depth = 0, lang = "en"): string {
  if (value == null) return "—";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(item => `${"  ".repeat(depth)}- ${readable(item, depth + 1, lang)}`).join("\n");
  return Object.entries(value).filter(([key]) => !OMIT.has(key)).map(([key, item]) =>
    `${"  ".repeat(depth)}- **${label(key, lang)}**: ${item && typeof item === "object" ? "\n" : ""}${readable(item, depth + 1, lang)}`).join("\n");
}
export function fullReportDelivery(report: unknown) {
  const data = report && typeof report === "object" ? report as Record<string, unknown> : {};
  const lang = data.lang === "zh" ? "zh" : "en";
  const sections = [...new Set([...SECTIONS, ...Object.keys(data)])].filter(key => data[key] != null && !OMIT.has(key) && !METADATA.has(key));
  return {
    reportMarkdown: [
      `# PULSE · ${String(data.instId || data.service || "Report")} · ${String(data.timeframe || "")}`,
      `${lang === "zh" ? "生成时间" : "Generated"}: ${String(data.generatedAt || "—")} · ${String(data.tier || "")} · ${lang}`,
      ...sections.map(key => `## ${label(key, lang)}\n\n${readable(data[key], 0, lang)}`),
    ].join("\n\n"),
    delivery: { status: "complete", format: "markdown", sections, instruction: "Present the full reportMarkdown to the user. Preserve conditional scenarios, recommendation, evidence gaps and all report sections; do not replace this paid deliverable with a short summary. Raw candle arrays and private transport metadata are omitted." },
  };
}
