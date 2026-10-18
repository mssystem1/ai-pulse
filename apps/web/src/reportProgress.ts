export type ReportJobSnapshot = { stage?: string; createdAt?: string; updatedAt?: string; events?: {stage: string; at: string; detail?: string}[] };
export type ReportProgressState = ReportJobSnapshot & {id: string; stage: string; startedAt: number; lastCheckedAt?: number};
export const reportSteps = [
  {stages:["payment_authorized","payment_verified","payment_settled"],en:"Payment confirmed",zh:"付款已确认"},
  {stages:["fetching_context"],en:"Loading market data",zh:"加载市场数据"},
  {stages:["calculating_features"],en:"Calculating market structure",zh:"计算市场结构"},
  {stages:["generating_analysis"],en:"Writing AI analysis",zh:"生成 AI 分析"},
  {stages:["enriching_report"],en:"Checking asset context",zh:"核查资产信息"},
  {stages:["validating_report","saving_report"],en:"Verifying and saving report",zh:"验证并保存报告"},
  {stages:["completed","completed_partial","opening_report"],en:"Opening your report",zh:"打开报告"},
];
export function reportProgressModel(job: ReportProgressState, now: number) {
  const active=reportSteps.findIndex(step=>step.stages.includes(job.stage));
  const latest=job.events?.at(-1);
  const elapsed=Math.max(0,Math.floor((now-(Date.parse(job.createdAt||"")||job.startedAt))/1000));
  const inStage=Math.max(0,Math.floor((now-(Date.parse(latest?.at||job.updatedAt||"")||job.startedAt))/1000));
  return {active,elapsed,inStage,slow:inStage>=60,resuming:(job.events?.filter(e=>e.stage==="fetching_context"&&e.detail==="claimed by durable worker").length||0)>1};
}
export function reportStageLabel(stage: string, lang: "en"|"zh"="en") {
  return reportSteps.find(step=>step.stages.includes(stage))?.[lang] || (lang==="zh"?"报告需要恢复":"Report needs recovery");
}
