import { GlobalReportSchema, parseCandleTimeframe, type GlobalReport, type GlobalPath } from "@pulse/schemas";
import { globalTradePlan } from "./globalTradePlan.js";

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
export function globalTimeframeLabel(timeframe: string, lang: "en" | "zh"): string {
  const frame = parseCandleTimeframe(timeframe);
  if (!frame) return timeframe;
  const names = { minute: ["minute", "分钟"], hour: ["hour", "小时"], day: ["day", "天"], week: ["week", "周"], month: ["month", "个月"] } as const;
  const name = names[frame.unit];
  return lang === "zh" ? `${timeframe} · 每根 K 线 ${frame.count} ${name[1]}` : `${timeframe} · ${frame.count}-${name[0]} candles`;
}
/** Resolve known internal references in provider prose through the saved map.
 * Older saved narratives remain immutable; presentation never prints ID codes. */
export function globalHumanText(report:GlobalReport,value:string):string {
  return report.levels.filter(level=>level.id.startsWith("level-")).sort((a,b)=>b.id.length-a.id.length).reduce((text,level)=>text.split(level.id).join(`${globalPrice(report,level.price)} ${report.snapshot.priceCurrency}`),value);
}
export function globalPathTitle(report: GlobalReport, path: GlobalPath): string {
  const index = report.view.pathIds.indexOf(path.id) + 1;
  return `${["①", "②", "③"][Math.max(0, index - 1)]} ${globalLabel(path.role, report.lang)} · ${globalLabel(path.kind, report.lang)}`;
}
export function globalPathLines(report: GlobalReport, original: GlobalPath): string[] {
  const path={...original,thesis:globalHumanText(report,original.thesis)};
  const trigger = globalLevelPrice(report, path.triggerLevelId), invalid = globalLevelPrice(report, path.invalidationLevelId), targets = path.targetIds.map(id => globalLevelPrice(report, id)).join(" → "), tf = report.snapshot.timeframe, zh = report.lang === "zh";
  if (path.direction === "range") return [zh ? `${trigger} 至 ${targets} 区间内观察；完整收盘突破任一边界后重新评估。` : `Watch the range ${trigger}–${targets}; a completed close outside either boundary requires reassessment.`, path.thesis].filter(Boolean);
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
  return [
    `${globalLabel("setup", lang)} · ${globalLabel(s.state, lang)} · ${globalPathTitle(report, report.paths.find(p => p.id === s.pathId)!)}`,
    report.paths.find(p=>p.id===s.pathId)?.confirmation==="support_hold" ? zh?`S1：回调至 ${price(s.triggerLevelId)}，${tf} 完整收盘守住，再次回测；${price(s.invalidationLevelId)} 底线须保持。`:`S1: pull back to ${price(s.triggerLevelId)}, hold on a completed ${tf} close, then a subsequent held test. Keep the ${price(s.invalidationLevelId)} floor intact.` : zh ? `S1：${tf} 完整收盘高于 ${price(s.triggerLevelId)}，随后回测并收盘守住。${price(s.invalidationLevelId)} 底线须保持。` : `S1: completed ${tf} close above ${price(s.triggerLevelId)}, then a retest that closes at or above it. Keep the ${price(s.invalidationLevelId)} floor intact.`,
    ...s.targetIds.map((id, i) => `S${i + 2} / ${zh ? "目标" : "target"} ${i + 1}: ${price(id)}`),
    `${globalLabel("entry", lang)}: ${s.entryZone ? s.entryZone.map(n => globalPrice(report, n)).join("–") : globalSetupPendingLabel(report)}`,
    `${globalLabel("stop", lang)}: ${s.protectiveStop === null ? globalSetupPendingLabel(report) : globalPrice(report, s.protectiveStop)}`,
    `${zh ? "费用后收益风险比" : "Net R:R"}: ${s.netRewardRisk === null ? "—" : s.netRewardRisk.toFixed(2)}`,
    zh ? `取消：${tf} 完整收盘低于 ${price(s.invalidationLevelId)}；或突破后回到 ${price(s.triggerLevelId)} 下方。结构失效不是保护止损。` : `Cancel: completed ${tf} close below ${price(s.invalidationLevelId)}; or back below ${price(s.triggerLevelId)} after reclaim. Thesis invalidation is not the protective stop.`,
    ...(s.expiresAt ? [zh ? `有效期至 ${new Date(s.expiresAt).toISOString()}；执行前需核查新行情。` : `Expires ${new Date(s.expiresAt).toISOString()}; fresh execution evidence is required.`] : []),
    ...s.missing.map(key => globalMissingLabel(report, key)),
  ];
}
export function globalTradePlanTitle(report: GlobalReport): string {
  const p=globalTradePlan(report),zh=report.lang==="zh";
  return p.side==="long"?zh?"条件做多 / 现货买入":"Conditional long / Spot buy":p.side==="short"?zh?"条件做空 / 卖出持有的现货":"Conditional short / sell owned Spot":zh?"等待有效价格结构":"Wait for a usable price structure";
}
export function globalTradePlanLines(report: GlobalReport): string[] {
  const p=globalTradePlan(report),zh=report.lang==="zh",tf=report.snapshot.timeframe;
  if(p.side==="none")return [globalTradePlanTitle(report),zh?"已保存的数据不足以确定有依据的入场、风险参考和目标。":"The saved map lacks sufficient levels or completed history to define entry, risk reference and targets."];
  const trigger=globalLevelPrice(report,p.triggerLevelId),invalid=globalLevelPrice(report,p.invalidationLevelId);
  const condition=p.condition==="support_hold"?zh?`回调至 ${trigger}，${tf} 完整收盘守住，随后再次回测守住。`:`Pull back to ${trigger}; hold on a completed ${tf} close, then a subsequent held test.`:p.condition==="rejection"?zh?`反弹测试 ${trigger} 并被拒绝；${tf} 完整收盘低于该位，再次测试守住。`:`A rally tests ${trigger} and is rejected; a completed ${tf} close below it, then a subsequent failed test.`:zh?`${tf} 完整收盘${p.side==="long"?"高于":"低于"} ${trigger}，随后回测守住。`:`Completed ${tf} close ${p.side==="long"?"above":"below"} ${trigger}, then a held retest.`;
  const blockers:Record<typeof p.blockers[number],string>={history:zh?"完整历史不足":"Insufficient completed history",levels:zh?"缺少已映射价格":"Mapped levels unavailable",confirmation:zh?"等待完整收盘确认":"Wait for completed-close confirmation",retest:zh?"等待后续回测":"Wait for a subsequent retest",reward:zh?"最近目标的毛收益风险比低于 1.50；不入场":"Gross R:R to the nearest target is below 1.50; avoid entry",entry_price:zh?"当前价格不在计划区间；不追价":"Current price is outside the planned zone; do not chase",cancelled:zh?"之前确认已失效；需新的有效测试":"Prior confirmation failed; a new valid test is required",expired:zh?"之前确认已过期；需新的有效测试":"Prior confirmation expired; a new valid test is required"};
  return [globalTradePlanTitle(report),condition,
    `${zh?"计划入场参考（尚非已观察入场）":"Planned entry reference (not an observed fill)"}: ${p.referenceEntry!.map(n=>globalPrice(report,n)).join("–")}`,
    `${zh?"计划止损参考（非已观察止损）":"Planned SL reference (not observed protection)"}: ${globalPrice(report,p.referenceStop)} · ${zh?"结构失效位之外":"outside structural invalidation"} + ${p.stopBufferAtr} × ATR14`,
    `${zh?"目标":"Targets"}: ${p.targetIds.map((id,i)=>`TP${i+1} ${globalLevelPrice(report,id)}`).join(" → ")}`,
    `${zh?"最近目标的毛收益风险比":"Gross R:R to nearest target"}: ${p.grossRewardRisk?.toFixed(2) ?? "—"}; ${zh?"费用后的收益风险比需实际报价":"net R:R requires an execution quote"}`,
    zh?`取消：${tf} 完整收盘${p.side==="long"?"低于":"高于"} ${invalid}；确认后失守触发位也需重评。`:`Cancel: completed ${tf} close ${p.side==="long"?"below":"above"} ${invalid}; reassess if the trigger fails after confirmation.`,
    ...p.blockers.map(key=>blockers[key]),
    p.side==="short"?zh?"现货操作：仅卖出或减持已持有资产；做空研究不创建杠杆空仓。":"Spot action: sell/reduce owned inventory on confirmation. Short research does not open a leveraged short.":zh?"现货操作：确认后复核买入；实际止损依据已观察回测，批准前复核实时费用。":"Spot action: review a buy after confirmation; executable SL comes from the observed retest and costs require a fresh quote."];
}
export function globalMissingLabel(report: GlobalReport, key: GlobalReport["setup"]["missing"][number]): string {
  if(key === "context" && (report.context.status !== "available" || report.context.agreement === "unknown")) return report.lang === "zh" ? "独立高周期背景不可用，继续观察" : "Independent context unavailable; keep watching";
  return globalLabel(key === "execution_costs" ? "costs" : key === "targets" ? "targetMissing" : key === "context" ? "contextMissing" : key, report.lang);
}
export function globalEvidenceLines(report: GlobalReport): string[] {
  if (report.tier !== "pro") return [];
  const { indicators: i, context: c, lang } = report, zh = lang === "zh";
  const smas = i.sma.filter(s => report.view.smaPeriods.includes(s.period)).map(s => `SMA${s.period} ${globalPrice(report, s.points.at(-1)?.value)}`).join(" · ");
  const rsi = i.rsi.points.at(-1)?.value, atr = i.atr.points.at(-1)?.value;
  const agreement = c.agreement === "conflicts" ? zh ? "与恢复冲突" : "conflicts with recovery" : c.agreement === "supports" ? zh ? "支持恢复" : "supports recovery" : c.agreement==="neutral"?zh?"中性":"neutral":globalLabel("unavailable", lang);
  return [smas,
    `RSI14 ${rsi === undefined ? "—" : rsi.toFixed(2)} · ATR14 ${globalPrice(report, atr)} · ${zh ? "成交量/前20根均值" : "volume / prior 20 bars"} ${i.volumeRatio === null ? "—" : `${i.volumeRatio.toFixed(2)}×`}`,
    c.status === "available" ? `${c.timeframe} ${globalLabel("context", lang)}: ${agreement} · SMA55 ${globalPrice(report, c.sma55.at(-1)?.value)}` : `${c.timeframe ?? "—"} ${globalLabel("context", lang)}: ${globalLabel("unavailable", lang)}`,
    zh ? "RSI 超卖本身不确认入场。SMA、波浪与斐波那契共享价格证据；不应当作独立投票。" : "Oversold RSI alone does not confirm entry. SMAs, waves and Fibonacci share price evidence; they are not independent votes.",
  ];
}
export function globalWaveEvidenceLines(report:GlobalReport):string[]{const zh=report.lang==="zh",copy:Record<string,string>={wave_2_holds_origin:zh?"浪 2 未突破起点":"Wave 2 holds the origin",wave_3_not_shortest:zh?"浪 3 不是最短推动浪":"Wave 3 is not the shortest impulse leg",wave_4_no_overlap:zh?"浪 4 未重叠浪 1":"Wave 4 does not overlap Wave 1",alternating_confirmed_pivots:zh?"转折点经右侧三根完整 K 线确认":"Alternating pivots confirmed by three subsequent completed bars",partial_count_4_5_unobserved:zh?"浪 4、5 尚未形成":"Waves 4 and 5 have not been observed",candidate_abc_after_impulse:zh?"推动浪后为候选 A–B–C 调整":"Candidate A–B–C correction follows the impulse"};return report.waveCount.validation.flatMap(key=>copy[key]?[copy[key]]:[]);}
export function globalSections(report: GlobalReport): Array<{title: string; lines: string[]; featured?: boolean}> {
  const { lang } = report;
  return [
    { title: lang === "zh" ? "图表周期" : "Chart timeframes", lines: [
      `${lang === "zh" ? "主图" : "Primary chart"}: ${globalTimeframeLabel(report.snapshot.timeframe, lang)}`,
      ...(report.tier === "pro" ? [`${globalLabel("context", lang)}: ${globalTimeframeLabel(report.context.timeframe ?? "—", lang)}${report.context.status === "available" ? "" : ` · ${globalLabel("unavailable", lang)}`}`] : []),
    ] },
    { title: globalLabel("wave", lang), lines: [report.waveCount.status === "unclear" ? globalLabel("unclear", lang) : `${lang === "zh" ? "候选" : "Candidate"} · ${report.waveCount.structure.replaceAll("_", " ")} · ${report.waveCount.activeWave} · ${report.waveCount.direction} · ${report.waveCount.degree}`, ...globalWaveExplanationLines(report)], featured: true },
    { title: globalLabel("moves", lang), lines: report.paths.filter(p => report.view.pathIds.includes(p.id)).flatMap(p => [globalPathTitle(report, p), ...globalPathLines(report, p)]), featured: true },
    { title: lang==="zh"?"方向性交易计划":"Directional trade plan", lines: globalTradePlanLines(report), featured: true },
    { title: globalLabel("setup", lang), lines: globalSetupLines(report), featured: true },
    { title: globalLabel("evidence", lang), lines: globalEvidenceLines(report), featured: true },
    { title: globalLabel("reasons", lang), lines: report.narrative.reasons.map(s=>globalHumanText(report,s)) },
    { title: globalLabel("risks", lang), lines: report.narrative.riskNotes.map(s=>globalHumanText(report,s)), featured: true },
    { title: globalLabel("limitations", lang), lines: report.narrative.limitations.map(s=>globalHumanText(report,s)), featured: true },
  ].filter(s => s.lines.length > 0);
}
export function globalWaveExplanationLines(report: GlobalReport): string[] {
  const zh=report.lang==="zh",w=report.waveCount;
  const reason = w.validation.includes("model_did_not_accept_candidate") ? zh?"分析模型未接受该候选结构。":"The analyst did not accept the supplied candidate." : w.validation.includes("origin_invalidated_by_completed_close") ? zh?"此前候选结构的起点已失效。":"The prior candidate origin was invalidated." : zh?"近期确认的摆动未匹配已实现的推动浪规则。":"Recent confirmed swings do not match the implemented impulse rules.";
  return [...globalWaveEvidenceLines(report),...(w.validation.includes("partial_count_3_4_5_unobserved")?[zh?"仅有浪 1–2 假设；浪 3、4、5 尚未观察到。":"Only a 1–2 hypothesis; waves 3, 4 and 5 have not been observed."]:[]),...(w.status==="unclear"?[reason,zh?"仍可依据支撑和阻力制定条件交易计划。":"Support and resistance still support conditional trade planning."]:[]),...(w.swingScaleAtr!==undefined?[zh?`本周期局部摆动，过滤阈值 ${w.swingScaleAtr} × 确认时的 ATR；不是已认定的理论浪级。`:`Local ${report.snapshot.timeframe} swings; ${w.swingScaleAtr} × ATR deviation measured at confirmation, not an assigned theoretical Elliott degree.`]:[]),...(w.validation.includes("swing_pattern_only_subdivisions_unverified")?[zh?"仅为摆动形态假设；内部子浪未验证，不代表完整艾略特确认。":"Swing-pattern hypothesis only; internal subwaves are unverified, so this is not a fully confirmed Elliott count."]:[])];
}
