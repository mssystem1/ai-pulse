import {globalTradeCardLines,globalHistoricalLevelLines} from "./globalTradeDisplay.js";
import {globalStrategyLines} from "./globalStrategy.js";
import {globalHorizonContextLines} from "./globalHorizonContext.js";
import {globalOrderFlowLines} from "./globalOrderFlow.js";
import {globalCurrentMarketLines} from "./globalMarketNow.js";
import { GlobalReportSchema, parseCandleTimeframe, candleCloseTime, type GlobalReport, type GlobalPath } from "@pulse/schemas";
import { globalTradePlan } from "./globalTradePlan.js";
import { globalConfirmationEvidence } from "./globalConfirmation.js";
import { globalEligibility, globalRiskMeasurement, globalRemoteLevels, globalSetupMap } from "./globalPolicy.js";
import {globalDecision,globalDecisionTitle,globalDecisionLines} from "./globalDecision.js";
import {globalFrameReference} from "./globalContext.js";
import {globalCoverageLine} from "./globalCoverage.js";
import {globalRangeSummary} from "./globalRange.js";
import {globalContextLine,globalSession,globalFrameName} from "./globalContext.js";
import {globalScenarioEvidence} from "./globalScenarioEvidence.js";
import {globalFibonacciDescription} from "./globalViewport.js";

export type { GlobalReport, GlobalPath } from "@pulse/schemas";
export const GLOBAL_PATH_COLORS = { correction: "#f0738c", recovery: "#f6c368", continuation: "#53dabb", recount: "#53dabb", range: "#9dabcf", pullback: "#f6c368" };
const copy = {
  pullback: ["Support pullback", "支撑回调"],
  main: ["Main", "主要路径"], alternative: ["Alternative", "备选路径"], correction: ["Correction", "调整"], recovery: ["Recovery", "恢复"], continuation: ["Continuation", "延续"], recount: ["Recount after recovery", "恢复后重数"], range: ["Range", "区间"],
  watching: ["Watching", "观察中"], ready: ["Ready · fresh quote required", "已确认 · 需新报价"], cancelled: ["Cancelled", "已取消"], expired: ["Expired", "已过期"], none: ["No confirmed Spot buy", "暂无已确认的现货买入"],
  wait: ["Wait", "等待"], review: ["Review setup", "复核计划"], pending: ["Pending the observed retest", "等待实际回测"], unavailable: ["Unavailable", "不可用"],
  cancelledValue: ["Plan cancelled", "计划已取消"], expiredValue: ["Plan expired", "计划已过期"], inactiveHint: ["Reassess with fresh completed candles", "需根据新的完整 K 线重新评估"],
  setup: ["Spot plan", "现货计划"], moves: ["Possible moves", "可能的走势"], wave: ["Elliott hypothesis", "艾略特波浪假设"], unclear: ["Count unclear", "波浪结构不明确"],
  entry: ["Observed entry zone", "已观察入场区间"], stop: ["Protective stop", "保护止损"], targets: ["Targets", "目标"], invalidation: ["Thesis invalidation", "结构失效"],
  context: ["Context", "高周期背景"], evidence: ["Pro evidence", "Pro 证据"], reasons: ["Why this view", "判断依据"], risks: ["Risks", "风险"], limitations: ["Limitations", "限制"], disclaimer: ["Disclaimer", "免责声明"],
  history: ["Saved market snapshot · recheck current conditions", "保存的行情快照 · 请核查当前条件"],
  chartUnavailable: ["Saved completed candles are insufficient for a chart.", "已保存的完整 K 线不足以绘图。"],
  costs: ["Fresh execution costs unavailable", "缺少新执行费用"], reward: ["Insufficient reward to the nearest target", "至最近目标的收益不足"], protection: ["Observed protection unavailable", "缺少有依据的保护止损"],
  trigger: ["Completed close above S1 required", "需完整收盘突破 S1"], retest: ["A subsequent held retest is required", "需后续回测并守住"], completed_history: ["Completed history unavailable", "缺少完整历史数据"],
  entry_price: ["Price is outside the observed entry zone; do not chase", "价格已离开实际入场区间，请勿追价"],
  contextMissing: ["Context conflicts with recovery", "高周期背景与恢复冲突"], targetMissing: ["Mapped target unavailable", "缺少已标注目标"],
  quickDepth: ["Candles · Elliott · SMA55 · volume · main + alternative", "K 线 · 波浪 · SMA55 · 成交量 · 主要及备选路径"],
  proDepth: ["SMA family · regression · RSI14 · ATR14 · observed context", "SMA 组合 · 回归通道 · RSI14 · ATR14 · 已观察背景"],
} as const;
export function globalLabel(key: keyof typeof copy, lang: "en" | "zh"): string { return copy[key][lang === "zh" ? 1 : 0]; }
export function globalSetupPendingLabel(report: GlobalReport): string {
  return globalLabel(report.setup.state === "cancelled" ? "cancelledValue" : report.setup.state === "expired" ? "expiredValue" : report.setup.state === "none" ? "unavailable" : "pending", report.lang);
}
export function readGlobalReport(value: unknown): GlobalReport | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>, candidate = data.version === "pulse-global-v3" ? data : data.global;
  if (!candidate || typeof candidate !== "object" || (candidate as Record<string, unknown>).version !== "pulse-global-v3") return null;
  const parsed = GlobalReportSchema.safeParse(candidate); return parsed.success ? parsed.data : null;
}
export function globalPrice(report: GlobalReport, value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(report.lang === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: Math.min(2,report.snapshot.pricePrecision), maximumFractionDigits: report.snapshot.pricePrecision });
}
export function globalLevelPrice(report: GlobalReport, id: string | null | undefined): string { return globalPrice(report, report.levels.find(l => l.id === id)?.price); }
export function globalCompletedPriceLine(report: GlobalReport): string {
  const ts=report.candles.at(-1)?.ts,closed=ts===undefined?null:candleCloseTime(ts,report.snapshot.timeframe);
  const when=closed===null?"":new Date(closed).toISOString().slice(0,16).replace("T"," ")+" UTC";
  return report.lang==="zh"?`价格参考：最后完整 ${globalFrameReference(report.snapshot.timeframe)} K 线收盘 ${globalPrice(report,report.snapshot.price)} ${report.snapshot.priceCurrency}${when?` · 收盘时间 ${when}`:""}；非实时报价。`:`Reference: last completed ${globalFrameReference(report.snapshot.timeframe)} close ${globalPrice(report,report.snapshot.price)} ${report.snapshot.priceCurrency}${when?` · bar closed ${when}`:""}; not a live quote.`;
}
export function globalTimeframeLabel(timeframe: string, lang: "en" | "zh"): string {
  const frame = parseCandleTimeframe(timeframe);
  if (!frame) return timeframe;
  const names = { minute: ["minute", "分钟"], hour: ["hour", "小时"], day: ["day", "天"], week: ["week", "周"], month: ["month", "个月"] } as const;
  const name = names[frame.unit];
  const session=["day","week","month"].includes(frame.unit)?` (${globalSession(timeframe)})`:"";
  return lang === "zh" ? `${globalFrameName(timeframe)}${session} · 每根 K 线 ${frame.count} ${name[1]}` : `${globalFrameName(timeframe)}${session} · ${frame.count}-${name[0]} candles`;
}
/** Resolve known internal references in provider prose through the saved map.
 * Older saved narratives remain immutable; presentation never prints ID codes. */
export function globalHumanText(report:GlobalReport,value:string):string {
  const zh=report.lang==="zh";
  const human=value.replace(/\bsetupSelection\b/g,zh?"主周期观点":"primary view").replace(/\brequiresNewTestAfter\b/g,zh?"本次快照":"this snapshot").replace(/\bwaveCandidate\b/g,zh?"艾略特候选结构":"Elliott candidate").replace(/\b(\d+[DWM])utc\b/gi,frame=>globalFrameReference(frame));
  return report.levels.filter(level=>level.id.startsWith("level-")).sort((a,b)=>b.id.length-a.id.length).reduce((text,level)=>text.split(level.id).join(`${globalPrice(report,level.price)} ${report.snapshot.priceCurrency}`),human);
}
export function globalPathTitle(report: GlobalReport, path: GlobalPath): string {
  const index = report.view.pathIds.indexOf(path.id) + 1;
  if(report.decisionVersion&&report.hierarchy?.find(r=>r.timeframe===report.snapshot.timeframe)?.bias==="mixed"&&!report.range)return `${["①","②","③"][Math.max(0,index-1)]} ${path.direction==="up"?"BUY":path.direction==="down"?"SELL":"BUY / SELL"} · ${globalLabel(path.kind,report.lang)}`;
  return `${["①", "②", "③"][Math.max(0, index - 1)]} ${globalLabel(path.role, report.lang)} · ${globalLabel(path.kind, report.lang)}`;
}
export function globalPathLines(report: GlobalReport, original: GlobalPath): string[] {
  const path={...original,thesis:globalHumanText(report,original.thesis)};
  if(report.decisionVersion){
    const zh=report.lang==="zh",tf=globalFrameReference(report.snapshot.timeframe),targets=path.targetIds.map(id=>globalLevelPrice(report,id)).join(" → ");
    const structure=path.direction==="range"?globalRangeSummary(report):zh?`${tf} 结构路径：${globalLevelPrice(report,path.triggerLevelId)} ${path.direction==="up"?"上方":"下方"}的参考目标 ${targets}。`:`${tf} structure route: ${path.direction==="up"?"above":"below"} ${globalLevelPrice(report,path.triggerLevelId)}, references ${targets}.`;
    return [structure??"",...globalScenarioEvidence(report).filter(s=>s.plan.pathId===path.id).map(s=>`${zh?"入场":"Entry"}: ${s.condition}. ${s.reason}.`),path.thesis].filter(Boolean);
  }
  const trigger = globalLevelPrice(report, path.triggerLevelId), invalid = globalLevelPrice(report, path.invalidationLevelId), targets = path.targetIds.map(id => globalLevelPrice(report, id)).join(" → "), tf = report.snapshot.timeframe, zh = report.lang === "zh";
  if (path.direction === "range") return [globalRangeSummary(report)??(zh ? `${trigger} 至 ${targets} 区间内观察；完整收盘突破任一边界后重新评估。` : `Watch the range ${trigger}–${targets}; a completed close outside either boundary requires reassessment.`), path.thesis].filter(Boolean);
  if (path.confirmation === "support_hold") return [zh ? `等待回调至 ${trigger}，${tf} 完整收盘守住支撑，然后再次回测守住：${targets}。` : `Wait for a pullback to ${trigger}, a completed ${tf} close holding support, then a subsequent held test: ${targets}.`,zh ? `完整收盘跌破 ${invalid} 时取消；不追涨。` : `Cancel on a completed close below ${invalid}; do not chase above the planned zone.`,path.thesis].filter(Boolean);
  const first=globalLevelPrice(report,path.targetIds[0]),next=path.targetIds.slice(1).map(id=>globalLevelPrice(report,id)).join(" → ");
  const stress=path.stress&&report.tier==="pro"?(zh?`压力分支：仅在 ${tf} 完整收盘跌破 ${globalLevelPrice(report,path.stress.triggerLevelId)} 后，才观察 ${path.stress.targetIds.map(id=>globalLevelPrice(report,id)).join(" → ")}。这不是现货目标。`:`Stress: only after a completed ${tf} close below ${globalLevelPrice(report,path.stress.triggerLevelId)}, watch ${path.stress.targetIds.map(id=>globalLevelPrice(report,id)).join(" → ")}. This is not a Spot target.`):"";
  if (path.confirmation === "hold") return [zh ? `保持在 ${trigger} 下方时，观察 ${first}。${next?`${tf} 完整收盘跌破 ${first} 后才观察 ${next}。`:""}` : `While below ${trigger}, watch ${first}.${next?` A completed ${tf} close below ${first} opens ${next}.`:""}`, zh ? `${tf} 完整收盘突破 ${invalid} 并回测守住后，该局部延续路径失效。` : `Cancel the local continuation on a completed ${tf} reclaim and held retest of ${invalid}.`, stress,path.thesis].filter(Boolean);
  const relation = path.direction === "up" ? zh ? "上方" : "above" : zh ? "下方" : "below";
  return [zh ? `${tf} 完整收盘位于 ${trigger} ${relation}，随后回测守住：${targets}。` : `Completed ${tf} close ${relation} ${trigger}, then a held retest: ${targets}.`,
    zh ? `确认后跌回触发位或 ${invalid} 失守则取消；重新评估结构。` : `Cancel if price closes back through the trigger after confirmation, or the ${invalid} invalidation breaks; reassess.`, stress,path.thesis].filter(Boolean);
}
export function globalSetupLines(report: GlobalReport): string[] {
  const { setup: s, lang } = report, zh = lang === "zh", price = (id: string | null) => globalLevelPrice(report, id), tf = report.snapshot.timeframe;
  if (!s.pathId) return [globalLabel("none", lang), ...s.missing.map(key => globalMissingLabel(report, key)),zh?"方向性研究计划见交易计划；尚无可复制的已观察入场和止损。":"Use the directional research plan; observed entry and protective SL are not yet available to copy."];
  if (s.state === "cancelled" || s.state === "expired") return [
    `${zh?"先前现货尝试":"Previous Spot attempt"} · ${globalLabel(s.state,lang)} · ${globalPathTitle(report,report.paths.find(p=>p.id===s.pathId)!)}`,
    ...globalSetupFailureLines(report),
    `${globalLabel("entry",lang)}: ${globalSetupPendingLabel(report)}`,
    `${globalLabel("stop",lang)}: ${globalSetupPendingLabel(report)}`,
    zh?"先前确认不再支持入场。主计划须重新确认和后续测试；旧尝试不提供可复制的保护。":"The previous confirmation no longer supports entry. The primary plan needs a fresh confirmation and subsequent test; this attempt supplies no protection to copy.",
  ];
  return [
    `${globalLabel("setup", lang)} · ${globalLabel(s.state, lang)} · ${globalPathTitle(report, report.paths.find(p => p.id === s.pathId)!)}`,
    report.paths.find(p=>p.id===s.pathId)?.confirmation==="support_hold" ? zh?`S1：回调至 ${price(s.triggerLevelId)}，${tf} 完整收盘守住，再次回测；${price(s.invalidationLevelId)} 底线须保持。`:`S1: pull back to ${price(s.triggerLevelId)}, hold on a completed ${tf} close, then a subsequent held test. Keep the ${price(s.invalidationLevelId)} floor intact.` : zh ? `S1：${tf} 完整收盘高于 ${price(s.triggerLevelId)}，随后回测并收盘守住。${price(s.invalidationLevelId)} 底线须保持。` : `S1: completed ${tf} close above ${price(s.triggerLevelId)}, then a retest that closes at or above it. Keep the ${price(s.invalidationLevelId)} floor intact.`,
    ...s.targetIds.map((id, i) => `S${i + 2} / ${zh ? "目标" : "target"} ${i + 1}: ${price(id)}`),
    `${globalLabel("entry", lang)}: ${s.entryZone ? s.entryZone.map(n => globalPrice(report, n)).join("–") : globalSetupPendingLabel(report)}`,
    `${globalLabel("stop", lang)}: ${s.protectiveStop === null ? globalSetupPendingLabel(report) : globalPrice(report, s.protectiveStop)}`,
    ...(s.grossRewardRisk===null?[]:[`${zh?"已观察计划的毛收益风险比":"Observed setup gross R:R"}: ${s.grossRewardRisk.toFixed(2)}${s.grossRewardRisk<1.5?zh?" · 低于 1.50，不支持入场":" · below 1.50; entry is not supported":""}`]),
    `${zh ? "费用后收益风险比" : "Net R:R"}: ${s.netRewardRisk === null ? "—" : s.netRewardRisk.toFixed(2)}`,
    zh ? `取消：${tf} 完整收盘低于 ${price(s.invalidationLevelId)}；或突破后回到 ${price(s.triggerLevelId)} 下方。结构失效不是保护止损。` : `Cancel: completed ${tf} close below ${price(s.invalidationLevelId)}; or back below ${price(s.triggerLevelId)} after reclaim. Thesis invalidation is not the protective stop.`,
    ...(s.expiresAt ? [zh ? `有效期至 ${new Date(s.expiresAt).toISOString()}；执行前需核查新行情。` : `Expires ${new Date(s.expiresAt).toISOString()}; fresh execution evidence is required.`] : []),
    ...s.missing.map(key => globalMissingLabel(report, key)),
  ];
}
export function globalSetupFailureLines(report: GlobalReport): string[] {
  const s=report.setup,path=report.paths.find(p=>p.id===s.pathId),zh=report.lang==="zh";
  if (!path || !s.triggerLevelId || !s.invalidationLevelId) return [];
  const e=globalConfirmationEvidence(report,{side:"long",condition:path.confirmation==="support_hold"?"support_hold":"close_retest",triggerLevelId:s.triggerLevelId,invalidationLevelId:s.invalidationLevelId});
  const invalid=report.levels.find(l=>l.id===s.invalidationLevelId)?.price,trigger=report.levels.find(l=>l.id===s.triggerLevelId)?.price;
  const savedFailure=s.confirmationTs?report.candles.find(c=>c.ts>s.confirmationTs!&&((invalid!==undefined&&c.low<=invalid)||(trigger!==undefined&&c.close<trigger))):undefined;
  const failure=e.failure??savedFailure,floorFailed=failure&&invalid!==undefined&&failure.low<=invalid;
  if (failure) return [zh?`先前尝试失效：K 线收盘 ${new Date(candleCloseTime(failure.ts,report.snapshot.timeframe)!).toISOString()}；${floorFailed?`低点 ${globalPrice(report,failure.low)} 触及或跌破 ${globalLevelPrice(report,s.invalidationLevelId)} 底线`:`收盘失守 ${globalLevelPrice(report,s.triggerLevelId)} 触发位`}。`:`Previous attempt failed: bar closed ${new Date(candleCloseTime(failure.ts,report.snapshot.timeframe)!).toISOString()}; ${floorFailed?`low ${globalPrice(report,failure.low)} touched/broke the ${globalLevelPrice(report,s.invalidationLevelId)} floor`:`close failed the ${globalLevelPrice(report,s.triggerLevelId)} trigger`}.`,
    ...(e.failedRetest?[zh?`先前回测已于 K 线收盘 ${new Date(candleCloseTime(e.failedRetest.ts,report.snapshot.timeframe)!).toISOString()} 确认；后续失效使其取消，不能作为当前入场或保护。`:`A held retest was observed when the bar closed ${new Date(candleCloseTime(e.failedRetest.ts,report.snapshot.timeframe)!).toISOString()}; the later failure cancels it, so it supplies no current entry or protection.`]:[])];
  if (s.state==="expired" && s.expiresAt) return [zh?`先前确认窗口已于 ${new Date(s.expiresAt).toISOString()} 结束。`:`The previous confirmation window ended at ${new Date(s.expiresAt).toISOString()}.`];
  return [zh?"保存的先前尝试已失效；不支持当前入场。":"The saved previous attempt is inactive; it does not support entry."];
}
export function globalTradePlanTitle(report: GlobalReport): string {
  return globalDecisionTitle(report);
}
export function globalConfirmationCorrection(report:GlobalReport):string|null {
  const saved=report.tradePlan,shown=globalTradePlan(report);
  const sameBlockers=saved&&new Set(saved.blockers).size===new Set(shown.blockers).size&&saved.blockers.every(b=>shown.blockers.includes(b));
  if(!saved||saved.state===shown.state&&saved.confirmationTs===shown.confirmationTs&&saved.retestTs===shown.retestTs&&sameBlockers)return null;
  return report.lang==="zh"?"确认复核：保存的 K 线不支持先前确认。价位保持不变；须新的有效确认与后续测试。原始分析文字生成于此复核之前。":"Confirmation review: the saved candles do not support the previous confirmation. Prices are preserved; a fresh valid confirmation and subsequent test are required. The original narrative predates this correction.";
}
export function globalTradePlanLines(report: GlobalReport): string[] {
  if(report.tradePlan?.method?.startsWith("structure-"))return [globalTradePlanTitle(report),...globalNextSetupLines(report),...globalRiskLines(report)];
  const p=globalTradePlan(report),zh=report.lang==="zh",tf=report.snapshot.timeframe;
  if(p.side==="none")return [globalTradePlanTitle(report),zh?"已保存的数据不足以确定有依据的入场、风险参考和目标。":"The saved map lacks sufficient levels or completed history to define entry, risk reference and targets."];
  const trigger=globalLevelPrice(report,p.triggerLevelId),invalid=globalLevelPrice(report,p.invalidationLevelId);
  const distinctBoundary=p.triggerLevelId!==p.invalidationLevelId;
  const condition=p.condition==="support_hold"?zh?`回调至 ${trigger}，${tf} 完整收盘守住，随后再次回测守住。`:`Pull back to ${trigger}; hold on a completed ${tf} close, then a subsequent held test.`:p.condition==="rejection"?zh?`反弹测试 ${trigger} 并被拒绝；${tf} 完整收盘低于该位，再次测试守住。`:`A rally tests ${trigger} and is rejected; a completed ${tf} close below it, then a subsequent failed test.`:zh?`${tf} 完整收盘${p.side==="long"?"高于":"低于"} ${trigger}，随后回测守住。`:`Completed ${tf} close ${p.side==="long"?"above":"below"} ${trigger}, then a held retest.`;
  const blockers:Record<typeof p.blockers[number],string>={history:zh?"完整历史不足":"Insufficient completed history",levels:zh?"缺少已映射价格":"Mapped levels unavailable",confirmation:zh?"等待完整收盘确认":"Wait for completed-close confirmation",retest:zh?"等待后续回测":"Wait for a subsequent retest",reward:zh?"最近目标的毛收益风险比低于 1.50；不入场":"Gross R:R to the nearest target is below 1.50; avoid entry",entry_price:zh?"最后完整收盘价不在计划区间；执行前核查新报价，不追价":"Last completed close is outside the planned zone; recheck a fresh quote before execution; do not chase",cancelled:zh?"之前确认已失效；需新的有效测试":"Prior confirmation failed; a new valid test is required",expired:zh?"之前确认已过期；需新的有效测试":"Prior confirmation expired; a new valid test is required"};
  return [globalTradePlanTitle(report),condition,
    `${zh?"计划入场参考（尚非已观察入场）":"Planned entry reference (not an observed fill)"}: ${p.referenceEntry!.map(n=>globalPrice(report,n)).join("–")}`,
    `${zh?"计划止损参考（非已观察止损）":"Planned SL reference (not observed protection)"}: ${globalPrice(report,p.referenceStop)} · ${zh?"结构失效位之外":"outside structural invalidation"} + ${p.stopBufferAtr} × ATR14`,
    `${zh?"目标":"Targets"}: ${p.targetIds.map((id,i)=>`TP${i+1} ${globalLevelPrice(report,id)}`).join(" → ")}`,
    `${zh?"最近目标的毛收益风险比":"Gross R:R to nearest target"}: ${p.grossRewardRisk?.toFixed(2) ?? "—"}; ${zh?"费用后的收益风险比需实际报价":"net R:R requires an execution quote"}`,
    zh?`取消：${tf} 完整收盘${p.side==="long"?"低于":"高于"} ${invalid}。确认后${distinctBoundary?"触及该结构底线或":""}收盘失守触发位时，旧确认失效，须重新确认。`:`Cancel: completed ${tf} close ${p.side==="long"?"below":"above"} ${invalid}. After confirmation, a completed candle ${distinctBoundary?"touching that structural boundary or ":""}closing back through the trigger resets the attempt.`,
    ...globalRiskLines(report),
    ...p.blockers.map(key=>blockers[key]),
    p.blockers.includes("reward")?zh?"新入场因收益不足而放弃；仅有确认无法弥补收益不足。减持已持有现货须单独决定并核查新报价。":"New entry is avoided for insufficient reward; confirmation alone does not repair it. Review any owned Spot reduction separately with a fresh quote.":p.side==="short"?zh?"现货操作：仅卖出或减持已持有资产；做空研究不创建杠杆空仓。":"Spot action: sell/reduce owned inventory on confirmation. Short research does not open a leveraged short.":zh?"现货操作：确认后复核买入；实际止损依据已观察回测，批准前复核实时费用。":"Spot action: review a buy after confirmation; executable SL comes from the observed retest and costs require a fresh quote."];
}
/** Explain newer local structure without turning an old range edge into entry. */
function localEntryReferences(report:GlobalReport):string[]{
  const study=report.entryStudy,last=study?.candles.at(-1);if(!study||study.status!=="available"||!last)return [];
  const zh=report.lang==="zh",tf=globalFrameReference(study.timeframe),cutoff=Date.parse(report.snapshot.observedAt),price=(p:number)=>globalPrice(report,p),known=study.pivots.filter(a=>a.confirmedAt!==null&&(candleCloseTime(a.confirmedAt,study.timeframe)??Infinity)<=cutoff);
  const active=(kind:"low"|"high")=>known.filter(a=>a.kind===kind&&(kind==="low"?a.price<last.close:a.price>last.close)&&!study.candles.some(c=>c.ts>=(candleCloseTime(a.confirmedAt!,study.timeframe)??Infinity)&&(kind==="low"?c.close<a.price:c.close>a.price))).sort((a,b)=>kind==="low"?b.price-a.price:a.price-b.price)[0];
  const support=active("low"),resistance=active("high"),lines=[zh?`${tf} 最近完整收盘 ${price(last.close)}；${support?`局部支撑参考 ${price(support.price)}；`:""}${resistance?`最近确认阻力 ${price(resistance.price)}。`:""}`:`${tf} last completed close ${price(last.close)}; ${support?`local support reference ${price(support.price)}; `:""}${resistance?`nearest confirmed resistance ${price(resistance.price)}.`:""}`];
  const crosses=known.filter(a=>a.kind==="high"&&a.price<last.close).flatMap(a=>study.candles.flatMap((c,i)=>i>0&&c.ts>=(candleCloseTime(a.confirmedAt!,study.timeframe)??Infinity)&&study.candles[i-1].close<=a.price&&c.close>a.price?[{anchor:a,bar:c}]:[])).sort((a,b)=>b.bar.ts-a.bar.ts||b.anchor.ts-a.anchor.ts);
  const reclaim=crosses[0];
  if(reclaim){const closed=candleCloseTime(reclaim.bar.ts,study.timeframe)!,when=new Date(closed).toISOString().slice(0,16).replace('T',' ')+' UTC',later=study.candles.some(c=>c.ts>reclaim.bar.ts);
    lines.push(zh?`${tf} 于 ${when} 收盘收复 ${price(reclaim.anchor.price)}。${later?"后续 K 线须按独立的回测、保护及收益条件评估。":"之后尚无另一根完整 K 线，后续回测尚未观察到。"}`:`${tf} reclaimed ${price(reclaim.anchor.price)} at the ${when} close. ${later?"Later candles must be assessed against the separate retest, protection and reward requirements.":"No later completed candle exists; a subsequent held retest is unobserved."}`);
  }
  return lines;
}

/** Compact next-setup detail; old prices remain identifiable as references. */
export function globalNextSetupLines(report:GlobalReport):string[] {
  if(report.decisionVersion==="decision-v5"){
    const lines=globalTradeCardLines(report);
    return lines.length?lines:[...(report.setupSelection?.limitations.slice(0,1)??[]),...(globalRangeSummary(report)?[globalRangeSummary(report)!]:report.setupSelection?.evidence??[]),...localEntryReferences(report)];
  }
  const d=globalDecision(report),p=globalTradePlan(report),zh=report.lang==="zh";
  const target=p.targetIds.map((id,i)=>`${p.strategyId?`${report.strategy?.name} objective ${i+1}`:d.planningValid?`TP${i+1}`:zh?`目标 ${i+1}`:`Objective ${i+1}`} ${globalLevelPrice(report,id)}`).join(" → ");
  const observed=d.signalObserved,valid=d.planningValid;
  const latest=report.entryStudy?.candles.at(-1),closed=latest?candleCloseTime(latest.ts,d.entryTimeframe):null;
  return [d.nextCondition,`${zh?"结构":"Structure"}: ${globalFrameReference(report.snapshot.timeframe)} · ${zh?"入场":"Entry"}: ${globalFrameReference(d.entryTimeframe)}`,
    ...(latest?[`${globalFrameReference(d.entryTimeframe)} ${zh?"最后完整收盘":"last completed close"}: ${globalPrice(report,latest.close)}${closed?` · ${new Date(closed).toISOString()}`:""}`]:[]),
    ...(valid&&p.referenceEntry?[`${observed?zh?"已观察入场区间":"Observed entry zone":zh?"观察区域（尚非入场）":"Watch area (entry unobserved)"}: ${p.referenceEntry.map(n=>globalPrice(report,n)).join("–")}`]:[]),
    ...(valid&&p.referenceStop?[`${observed?zh?"已观察止损参考":"Observed SL reference":zh?"暂定止损示例":"Provisional SL example"}: ${globalPrice(report,p.referenceStop)}${p.stopBasis?` · ${globalHumanText(report,p.stopBasis)}`:""}`]:[]),
    ...(!observed&&valid?[zh?"须实际测试确定保护和最终收益风险比；观察区域不是订单入场区间。":"The actual reaction must establish protection and final R:R; the watch area is not an order-entry band."]:[]),...((p.checkpointIds??[]).length?[`${zh?"沿途关口（非策略止盈）":"Checkpoints (not strategy take-profits)"}: ${p.checkpointIds!.map(id=>globalLevelPrice(report,id)).join(" → ")}`]:[]),...(target?[target]:[]),d.rewardLine,d.changeView].filter(Boolean);
}
export function globalMissingLabel(report: GlobalReport, key: GlobalReport["setup"]["missing"][number]): string {
  if(key === "context" && (report.context.status !== "available" || report.context.agreement === "unknown")) return report.lang === "zh" ? "独立高周期背景不可用，继续观察" : "Independent context unavailable; keep watching";
  return globalLabel(key === "execution_costs" ? "costs" : key === "targets" ? "targetMissing" : key === "context" ? "contextMissing" : key, report.lang);
}
export function globalRiskLines(report:GlobalReport):string[] {
  const risk=globalRiskMeasurement(report),zh=report.lang==="zh";
  if(!risk)return [];
  if(report.tradePlan?.method?.startsWith("structure-"))return [zh?`计划风险：每单位 ${globalPrice(report,risk.distance)} · ${risk.percent.toFixed(2)}% · ${risk.atr?.toFixed(2)??"—"} × ${globalFrameReference(risk.timeframe)} ATR14。`:`Planned risk per unit: ${globalPrice(report,risk.distance)} · ${risk.percent.toFixed(2)}% · ${risk.atr?.toFixed(2)??"—"} × ${globalFrameReference(risk.timeframe)} ATR14.`,zh?`主图结构 ${report.snapshot.timeframe}；入场与保护依据 ${risk.timeframe} 结构及反应极值，非主图固定 ATR 止损。`:`Analysis structure: ${globalFrameReference(report.snapshot.timeframe)}; entry and protection use ${globalFrameReference(risk.timeframe)} structure and reaction extremes.`,...(risk.atr!==null&&risk.atr<1?[zh?"止损小于一根入场周期平均波幅；普通波动可能触发。实际仓位须根据可承受亏损和费用决定。":"The stop is inside one average entry-timeframe range; ordinary volatility can trigger it. Size the position from acceptable loss and costs."]:[]),zh?"信号确认不代表成交。重新检查证据和金额对应报价后复核订单。":"A confirmed signal is not a fill. Recheck evidence and an amount-specific quote before reviewing an order."];
  const p=globalTradePlan(report),e=p.side!=="none"&&p.triggerLevelId&&p.invalidationLevelId?globalConfirmationEvidence(report,{...p,side:p.side,triggerLevelId:p.triggerLevelId,invalidationLevelId:p.invalidationLevelId}):null;
  const failure=e?.failure;
  const cause=failure?(e.failureReason==="floor"?(zh?`${p.side==="long"?"最低":"最高"}价 ${globalPrice(report,p.side==="long"?failure.low:failure.high)} 触及或突破结构失效位 ${globalLevelPrice(report,p.invalidationLevelId)}`:`${p.side==="long"?"low":"high"} ${globalPrice(report,p.side==="long"?failure.low:failure.high)} touched/broke the structural boundary ${globalLevelPrice(report,p.invalidationLevelId)}`):e.failureReason==="trigger"?(zh?`收盘 ${globalPrice(report,failure.close)} 未守住触发位 ${globalLevelPrice(report,p.triggerLevelId)}`:`close ${globalPrice(report,failure.close)} failed the trigger ${globalLevelPrice(report,p.triggerLevelId)}`):(zh?"触及计划止损参考位":"planned reference stop was touched")):null;
  const completed=report.snapshot.lastCandleTs===null?null:candleCloseTime(report.snapshot.lastCandleTs,report.snapshot.timeframe),next=completed===null?null:candleCloseTime(completed,report.snapshot.timeframe);
  return [zh?`参考风险：每单位 ${globalPrice(report,risk.distance)} · ${risk.percent.toFixed(2)}% · ${risk.atr?.toFixed(2)??"—"} × ${globalFrameReference(risk.timeframe)} ATR14。`:`Reference risk per unit: ${globalPrice(report,risk.distance)} · ${risk.percent.toFixed(2)}% · ${risk.atr?.toFixed(2)??"—"} × ${globalFrameReference(risk.timeframe)} ATR14.`,
    ...(risk.atr!==null&&risk.atr<1?[zh?"参考止损距离小于一根平均波幅；可能被正常波动触发。该缓冲未经过策略回测验证。":"Reference stop is inside one average bar range; ordinary volatility may trigger it. This buffer is not a backtested strategy calibration."]:[]),
    zh?`分析、确认和止损周期均为 ${risk.timeframe}；没有自动改用更小周期。`:`Analysis, confirmation and stop horizon: ${risk.timeframe}. A lower-timeframe entry is a separate assessment.`,
    ...(next!==null&&next>Date.parse(report.snapshot.observedAt)?[zh?`下一根 K 线收盘：${new Date(next).toISOString()}；未完成 K 线不能确认。`:`Next candle closes ${new Date(next).toISOString()}; an unfinished candle cannot confirm.`]:[]),
    ...(e?.retestDeadline?[zh?`回测截止：${new Date(e.retestDeadline).toISOString()}。`:`Retest deadline: ${new Date(e.retestDeadline).toISOString()}.`]:[]),
    ...(e?.retest&&e.expiresAt?[zh?`已完成回测后的入场有效期至 ${new Date(e.expiresAt).toISOString()}；执行前仍需新报价。`:`Entry window after completed retest ends ${new Date(e.expiresAt).toISOString()}; a fresh quote is still required.`]:[]),
    ...(failure?[zh?`主计划先前尝试失效：K 线收盘 ${new Date(candleCloseTime(failure.ts,report.snapshot.timeframe)!).toISOString()}；${cause}。`:`Previous primary attempt invalidated: bar closed ${new Date(candleCloseTime(failure.ts,report.snapshot.timeframe)!).toISOString()}; ${cause}.`]:[]),
    ...(e?.disqualified&&!e.confirmation&&(!failure||e.disqualified.ts>failure.ts)?[zh?`最近被排除的测试：K 线收盘 ${new Date(candleCloseTime(e.disqualified.ts,report.snapshot.timeframe)!).toISOString()}，触及结构边界或参考止损。`:`Latest disqualified test: bar closed ${new Date(candleCloseTime(e.disqualified.ts,report.snapshot.timeframe)!).toISOString()}; it touched the structural boundary or reference stop.`]:[]),
    zh?"已购报告为不可变快照。重新检查会生成独立技术评估；不会下单。":"Purchased report is an immutable snapshot. Recheck creates a separate technical assessment; it does not place an order."];
}
export function globalRemoteLevelLines(report:GlobalReport):string[] {
  const atr=report.indicators.atr.points.at(-1)?.value,close=report.snapshot.price;
  return globalRemoteLevels(report).map(l=>{
    const anchor=l.anchorIds.map(id=>report.indicators.pivots.find(p=>p.id===id)?.ts??Number(/^range-(\d+)-/.exec(id)?.[1])).find(Number.isFinite);
    const derived=l.basis!=="swing",kind=report.lang==="zh"?(derived?l.basis==="extension"?(l.anchorIds.length===3?"三点斐波那契扩展":"两点摆动投射"):"计算的斐波那契回撤":"历史价格"):(derived?l.basis==="extension"?(l.anchorIds.length===3?"three-anchor Fibonacci extension":"two-anchor swing projection"):"derived Fibonacci retracement":"historical price");
    return `${globalPrice(report,l.price)} · ${kind} · ${close?((l.price/close-1)*100).toFixed(2):"—"}% · ${atr&&close?(Math.abs(l.price-close)/atr).toFixed(2):"—"} ATR${anchor?` · ${derived?(report.lang==="zh"?"锚点日期 ":"anchor date "):""}${new Date(anchor).toISOString().slice(0,10)}`:""} · ${report.lang==="zh"?"远期背景参考，不是本周期交易目标":"distant context reference, not a setup target"}`;
  });
}
export function globalEvidenceLines(report: GlobalReport): string[] {
  if (report.tier !== "pro") return [];
  const { indicators: i, context: c, lang } = report, zh = lang === "zh";
  const smas = i.sma.map(s => `SMA${s.period} ${globalPrice(report, s.points.at(-1)?.value)}`).join(" · ");
  const rsi = i.rsi.points.at(-1)?.value, atr = i.atr.points.at(-1)?.value;
  return [smas,
    `RSI14 ${rsi === undefined ? "—" : rsi.toFixed(2)} · ATR14 ${globalPrice(report, atr)} · ${zh ? "成交量/前20根均值" : "volume / prior 20 bars"} ${i.volumeRatio === null ? "—" : `${i.volumeRatio.toFixed(2)}×`}`,
    `${globalContextLine(report,globalTradePlan(report).side)} · SMA55 ${globalPrice(report,c.sma55.at(-1)?.value)}`,
    zh ? "RSI 超卖本身不确认入场。SMA、波浪与斐波那契共享价格证据；不应当作独立投票。" : "Oversold RSI alone does not confirm entry. SMAs, waves and Fibonacci share price evidence; they are not independent votes.",
  ];
}
export function globalWaveEvidenceLines(report:GlobalReport):string[]{const zh=report.lang==="zh",copy:Record<string,string>={wave_2_holds_origin:zh?"浪 2 未突破起点":"Wave 2 holds the origin",wave_3_not_shortest:zh?"浪 3 不是最短推动浪":"Wave 3 is not the shortest impulse leg",wave_4_no_overlap:zh?"浪 4 未重叠浪 1":"Wave 4 does not overlap Wave 1",alternating_confirmed_pivots:zh?"转折点经右侧三根完整 K 线确认":"Alternating pivots confirmed by three subsequent completed bars",partial_count_4_5_unobserved:zh?"浪 4、5 尚未形成":"Waves 4 and 5 have not been observed",candidate_abc_after_impulse:zh?"推动浪后为候选 A–B–C 调整":"Candidate A–B–C correction follows the impulse"};return report.waveCount.validation.flatMap(key=>copy[key]?[copy[key]]:[]);}
export function globalSections(report: GlobalReport): Array<{title: string; lines: string[]; featured?: boolean}> {
  const { lang } = report,d=globalDecision(report),zh=lang==="zh";
  return [
    {title:zh?"当前决策":"Current decision",lines:globalDecisionLines(report),featured:true},
    {title:zh?"快照时市场":"Market at snapshot",lines:globalCurrentMarketLines(report),featured:true},
    ...(report.strategy?[{title:zh?"交易策略与持有周期":"Strategy and holding horizon",lines:globalStrategyLines(report),featured:true}]:[]),
    ...(report.horizonContext?[{title:zh?"本周期结构与价值":"Timeframe structure and value",lines:globalHorizonContextLines(report),featured:true}]:[]),
    ...(report.orderFlow?[{title:zh?"实际成交量与价值区间":"Executed volume and value area",lines:globalOrderFlowLines(report),featured:true}]:[]),
    {title:zh?"下一步条件":"Next condition",lines:d.checklist,featured:true},
    {title:report.decisionVersion==="decision-v5"?(zh?"所选入场证据":"Selected entry evidence"):(zh?"买卖入场证据":"BUY / SELL entry evidence"),lines:d.scenarios.map(s=>s.line)},
    {title:report.decisionVersion==="decision-v5"?(zh?"所选计划 · 入场 / 止损 / 止盈":"Selected setup · Entry / SL / TP"):(zh?"交易计划 · 入场 / 止损 / 止盈":"Trade plans · Entry / SL / TP"),lines:globalNextSetupLines(report),featured:true},
    ...(report.tier==="pro"?[{title:zh?"周期关系":"Timeframe map",lines:d.hierarchy.length?d.hierarchy:[d.contextLine,d.relationship]}]:[]),
    { title: lang === "zh" ? "图表周期" : "Chart timeframes", lines: [
      `${lang==="zh"?"快照时间":"Snapshot captured"}: ${report.snapshot.observedAt}`,
      `${lang === "zh" ? "主图" : "Primary chart"}: ${globalTimeframeLabel(report.snapshot.timeframe, lang)}`,
      ...(globalCoverageLine(report)?[globalCoverageLine(report)!]:[]),
      ...(report.tier === "pro" ? [`${globalLabel("context", lang)}: ${globalTimeframeLabel(report.context.timeframe ?? "—", lang)}${report.context.status === "available" ? "" : ` · ${globalLabel("unavailable", lang)}`}`] : []),
    ] },
    { title: report.discretionaryPlan?(zh?"计划路径":"Setup route"):globalLabel("moves", lang), lines: report.discretionaryPlan?[d.route,d.entryInstruction,d.changeView]:globalSetupMap(report).paths.filter(p => report.view.pathIds.includes(p.id)).flatMap(p => [globalPathTitle(report, p), ...globalPathLines(report, p).filter(line=>line!==globalHumanText(report,p.thesis)).slice(0,2)]), featured: true },
    { title: globalLabel("wave", lang), lines: [report.waveCount.status === "unclear" ? globalLabel("unclear", lang) : `${lang === "zh" ? "候选" : "Candidate"} · ${report.waveCount.structure.replaceAll("_", " ")} · ${globalWavePhase(report).recovered?(lang==="zh"?"C 后恢复假设":"post-C recovery hypothesis"):report.waveCount.activeWave}`, ...globalWaveExplanationLines(report)] },
    ...(report.tier==="pro"?[{title:zh?"斐波那契锚点":"Fibonacci anchors",lines:globalFibonacciDescription(report)}]:[]),
    { title: globalLabel("evidence", lang), lines: globalEvidenceLines(report), featured: true },
    {title:zh?"风险参考":"Risk reference",lines:d.risk?[`${d.risk.percent.toFixed(2)}% · ${d.risk.atr?.toFixed(2)??"—"} × ${globalFrameReference(d.risk.timeframe)} ATR14`,...(d.risk.atr!==null&&d.risk.atr<1?[zh?"参考止损小于一根平均 K 线波幅；实际止损需依据回测和结构确定。":"The reference stop is inside one average bar range; actual protection must follow the observed test and structure."]:[])]:[]},
    ...(report.decisionVersion==="decision-v5"?[{title:zh?"历史支撑与阻力":"Historical support / resistance",lines:globalHistoricalLevelLines(report)}]:[]),
    {title:zh?"先前尝试":"Previous attempts",lines:d.previousAttempts},
    ...(report.decisionVersion?[{title:globalLabel("reasons",lang),lines:report.narrative.reasons.map(s=>globalHumanText(report,s))}]:[]),
  ].filter(s => s.lines.length > 0).map(section=>({...section,lines:section.lines.map(line=>globalHumanText(report,line))}));
}
export function globalWaveExplanationLines(report: GlobalReport): string[] {
  const zh=report.lang==="zh",w=report.waveCount;
  const reason = w.validation.includes("model_did_not_accept_candidate") ? zh?"分析模型未接受该候选结构。":"The analyst did not accept the supplied candidate." : w.validation.includes("origin_invalidated_by_completed_close") ? zh?"此前候选结构的起点已失效。":"The prior candidate origin was invalidated." : zh?"近期确认的摆动未匹配已实现的推动浪规则。":"Recent confirmed swings do not match the implemented impulse rules.";
  const phase=globalWavePhase(report);
  return [...(phase.recovered?[zh?`\u5019\u9009 C \u4e4b\u540e\u5b8c\u6574\u6536\u76d8\u5df2\u6536\u590d B \u4f4d ${globalPrice(report,phase.b!.price)}\uff1b\u5f53\u524d\u4e3a C \u540e\u6062\u590d\u5047\u8bbe\uff0c\u5386\u53f2 C \u6807\u7b7e\u4e0d\u662f\u5f53\u524d\u53cd\u5411\u9884\u6d4b\u3002`:`A completed close reclaimed B ${globalPrice(report,phase.b!.price)} after candidate C. The current hypothesis is post-C recovery; the historical C label is not a current opposite-side forecast.`]:w.structure==="abc_correction"?[zh?"\u5386\u53f2 ABC \u4e3a\u5019\u9009\u5f62\u6001\uff0c\u4e0d\u72ec\u7acb\u786e\u8ba4\u5f53\u524d\u5165\u573a\u65b9\u5411\u3002":"The historical ABC remains a candidate pattern and does not independently confirm the current entry direction."]:[]),...globalWaveEvidenceLines(report),...(w.status==="candidate"&&w.activeWave==="2?"?[zh?(w.direction==="up"?"向上推动浪假设：浪 1 上涨，浪 2 向下回调；之后的反弹尚不能确认浪 3。":"向下推动浪假设：浪 1 下跌，浪 2 向上回调；之后的下跌尚不能确认浪 3。"):(w.direction==="up"?"Up impulse hypothesis: wave 1 rises and wave 2 retraces down; a later rebound does not yet confirm wave 3.":"Down impulse hypothesis: wave 1 falls and wave 2 retraces up; a later decline does not yet confirm wave 3.")]:[]),...(w.validation.includes("partial_count_3_4_5_unobserved")?[zh?"仅有浪 1–2 假设；浪 3、4、5 尚未观察到。":"Only a 1–2 hypothesis; waves 3, 4 and 5 have not been observed."]:[]),...(w.status==="unclear"?[reason,zh?"仍可依据支撑和阻力制定条件交易计划。":"Support and resistance still support conditional trade planning."]:[]),...(w.swingScaleAtr!==undefined?[zh?`本周期局部摆动，过滤阈值 ${w.swingScaleAtr} × 确认时的 ATR；不是已认定的理论浪级。`:`Local ${globalFrameReference(report.snapshot.timeframe)} swings; ${w.swingScaleAtr} × ATR deviation measured at confirmation, not an assigned theoretical Elliott degree.`]:[]),...(w.validation.includes("swing_pattern_only_subdivisions_unverified")?[zh?"仅为摆动形态假设；内部子浪未验证，不代表完整艾略特确认。":"Swing-pattern hypothesis only; internal subwaves are unverified, so this is not a fully confirmed Elliott count."]:[])];
}
import {globalWavePhase} from "./globalSetupSelection.js";
