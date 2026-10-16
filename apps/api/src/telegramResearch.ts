import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import { presentResearch, researchText, researchChartSvg, researchDate, researchStatus, type ResearchContext, type ResearchIdentity } from "@pulse/domain";
import { readGlobalReport, globalLabel, globalSetupLines, globalMissingLabel, globalPathTitle, globalPathLines, globalLevelPrice, globalEvidenceLines, globalTimeframeLabel, globalHumanText, globalTradePlanLines, globalTradePlanTitle, globalTradePlan, globalPrice, globalConfirmationCorrection, globalCompletedPriceLine, globalRiskLines, globalSetupMap, globalArtifactTag, globalArtifactReference } from "@pulse/domain";

export { type ResearchContext } from "@pulse/domain";
export const escapeTelegramHtml = (text: string) => text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const clip = (value: string, max: number) => { if(value.length<=max)return value;let result="";for(const char of value){if(result.length+char.length>max-1)break;result+=char;}return result+"…"; };
const boundedHtml = (value: string, max: number) => { let result="";for(const char of value){const safe=escapeTelegramHtml(char);if(result.length+safe.length>max-1)return result+"…";result+=safe;}return result; };
export function formatTelegramResearch(report: unknown, context: ResearchContext = {}) {
  return researchText(presentResearch(report,context));
}
/** One bounded overview; the document retains every curated research section. */
export function telegramResearchMessage(report: unknown, context: ResearchContext = {}) {
  const global=readGlobalReport(report);
  if(global){
    const html=escapeTelegramHtml, zh=global.lang==="zh", s=global.snapshot;
    const setup=globalSetupLines(global);
    const header = [
      `<b>PULSE · GLOBAL ${global.tier.toUpperCase()}</b>`,
      `<b>${html(s.instId)} · ${html(globalTimeframeLabel(s.timeframe, global.lang))}</b>`,
      html(`${s.venue} · ${s.priceCurrency} · ${s.observedAt}`),html(globalCompletedPriceLine(global)),
    ].join("\n");
    const conditions = [
      ...(globalConfirmationCorrection(global)?[html(globalConfirmationCorrection(global)!),""]:[]),
      `<b>${html(globalTradePlanTitle(global))}</b>`,
      ...globalTradePlanLines(global).slice(1,7).map(html),
      html([...globalRiskLines(global).slice(0,1),...globalTradePlanLines(global).slice(7,-1).filter(line=>!globalRiskLines(global).includes(line))].join(" · ")),"",
      `<b>${html(global.setup.pathId ? setup[0] : `${globalLabel("setup",global.lang)} · ${setup[0]}`)}</b>`,
      ...setup.slice(1).filter(line=>!line.startsWith("Net R:R")&&!line.startsWith("费用后")&&!global.setup.missing.some(key=>line===globalMissingLabel(global,key))).map(html), "", `<b>${globalLabel("moves",global.lang)}</b>`,
      ...globalSetupMap(global).paths.filter(p=>global.view.pathIds.includes(p.id)).flatMap(p=>[
        html(globalPathTitle(global,p)), ...globalPathLines(global,p).slice(0,2).map(html),
      ]), "",
      html(`${globalLabel("wave",global.lang)}: ${global.waveCount.status==="unclear"?globalLabel("unclear",global.lang):`${zh?"候选":"Candidate"} ${global.waveCount.activeWave}`}`),
      ...(global.tier==="pro" ? ["", `<b>${globalLabel("evidence",global.lang)}</b>`,
        html(`${globalLabel("context",global.lang)}: ${globalTimeframeLabel(global.context.timeframe ?? "—", global.lang)}`),
        ...globalEvidenceLines(global).slice(0,3).map(html),
      ] : []), "",
      html(zh ? "原始购买快照。执行前需重新确认行情。完整证据与限制见 TXT；从‘我的报告’免费重开。" : "Original purchased snapshot. Recheck conditions before execution. Full evidence and limitations are in the TXT; reopen free from My reports."),
    ].join("\n");
    const mandatory = `${header}\n\n${conditions}`;
    if(mandatory.length>3900)throw new Error("Global report conditions exceed Telegram's overview budget");
    const remaining = 3900 - mandatory.length;
    const headline = remaining > 80 ? `\n\n<b>${boundedHtml(globalHumanText(global,global.narrative.headline),Math.min(200,remaining-15))}</b>` : "";
    const summaryBudget = remaining - headline.length - 2;
    const summary = summaryBudget > 120 ? `\n${boundedHtml(globalHumanText(global,global.narrative.summary),Math.min(420,summaryBudget))}` : "";
    return `${header}${headline}${summary}\n\n${conditions}`;
  }
  const p=presentResearch(report,context),html=escapeTelegramHtml;
  const head=`<b>PULSE · ${html(p.serviceTitle)}</b>\n<b>${boundedHtml([p.subject,p.timeframe].filter(Boolean).join(" · "),220)}</b>\n${p.generatedAt?`${html(p.generatedAt)}\n`:""}\n<b>${boundedHtml(p.headline,300)}</b>\n${boundedHtml(p.summary,700)}`;
  const footer=`\n\n${boundedHtml(p.disclaimer,250)}\n\nComplete research sections are in the attached TXT. Reopen anytime from My reports.`;
  const featured=p.sections.filter(s=>s.featured);
  const critical=(title:string)=>/risk|limit|invalid|unknown|no-trade/i.test(title);
  const chosen=new Map<string,string>();let size=head.length+footer.length;
  for(const section of [...featured.filter(s=>critical(s.title)),...featured.filter(s=>!critical(s.title))]) {
    // Reserve space for risk conditions before optional targets; retain normal reading order.
    const block=`\n\n<b>${html(section.title)}</b>\n${boundedHtml(section.lines.join("\n"),critical(section.title)?350:300)}`;
    if(size+block.length<=3900){chosen.set(section.title,block);size+=block.length;}
  }
  return head+featured.map(s=>chosen.get(s.title)||"").join("")+footer;
}
export function telegramResearchOrder(report: unknown): Array<"chart"|"overview"|"document"> { return readGlobalReport(report) ? ["chart","overview","document"] : ["document","overview","chart"]; }
export function telegramResearchCaption(report: unknown, context: ResearchContext = {}) {
  const global=readGlobalReport(report);
  if(!global)return `${presentResearch(report,context).label.slice(0,400)}\nOriginal report snapshot · conditional paths, not guaranteed forecasts.`;
  const s=global.setup, zh=global.lang==="zh",plan=globalTradePlan(global);
  return [
    `PULSE · GLOBAL ${global.tier.toUpperCase()} · ${global.snapshot.instId} · ${globalTimeframeLabel(global.snapshot.timeframe,global.lang)}`,
    `${global.snapshot.venue} · ${global.snapshot.priceCurrency} · ${global.snapshot.observedAt} · #${globalArtifactReference(global)}`,
    globalCompletedPriceLine(global),
    globalTradePlanTitle(global),
    ...(plan.referenceEntry&&plan.referenceStop?[`${zh?"计划价格（非已观察保护）":"Planned references (not observed protection)"}: ${plan.referenceEntry.map(n=>globalPrice(global,n)).join("–")} · SL ${globalPrice(global,plan.referenceStop)} · ${plan.targetIds.map((id,i)=>`TP${i+1} ${globalLevelPrice(global,id)}`).join(" → ")}`]:[]),
    ...(["cancelled","expired"].includes(s.state)?[]:[`${globalLabel("setup",global.lang)}: ${globalLabel(s.state,global.lang)}`]),
    ...(plan.side!=="none" ? [
      globalTradePlanLines(global)[1],
      zh ? `取消：完整收盘${plan.side==="long"?"低于":"高于"} ${globalLevelPrice(global,plan.invalidationLevelId)}；确认后结构底线失守或收盘失守触发位须重新确认。` : `Cancel: completed close ${plan.side==="long"?"below":"above"} ${globalLevelPrice(global,plan.invalidationLevelId)}; a failed structural test or trigger close resets confirmation.`,
      ...(plan.blockers.includes("cancelled")?[zh?"先前确认已失效；等待新的确认及后续测试。":"Prior confirmation failed; wait for a fresh confirmation and subsequent test."]:[]),
      ...(plan.blockers.includes("reward")?[zh?"最近目标的毛收益风险比低于 1.50；放弃新入场。":"Gross R:R to the nearest target is below 1.50; avoid new entry."]:[]),
      ...(plan.blockers.includes("entry_price")?[zh?"最后完整收盘不在计划区间；核查新报价，勿追价。":"Last completed close is outside the planned zone; recheck a fresh quote; do not chase."]:[]),
    ] : []),
    ...(["cancelled","expired"].includes(s.state)?[globalSetupLines(global)[0]]:s.pathId?[globalSetupLines(global)[1]]:[]),
    ...(s.expiresAt === null || ["cancelled","expired"].includes(s.state) ? [] : [`${zh ? "有效期至" : "Expires"} ${new Date(s.expiresAt).toISOString()}`]),
    ...(global.tier === "pro" ? [`${globalLabel("context",global.lang)}: ${globalTimeframeLabel(global.context.timeframe ?? "—",global.lang)}`] : []),
    zh ? "时间仅为示意；非保证预测。" : "Timing is schematic; conditional moves, not guaranteed forecasts.",
  ].join("\n");
}
export function telegramHistoryLabel(order: ResearchIdentity & {status:string;createdAt:number}) {
  const date=researchDate(order.createdAt).slice(5,16);
  return `${clip(order.subject,36)}${order.timeframe?` · ${order.timeframe}`:""} · ${order.serviceTitle} · ${researchStatus(order.status)}${date?` · ${date} UTC`:""}`;
}
export function telegramResearchFilename(report: unknown, context: ResearchContext = {}) {
  const p=presentResearch(report,context);
  const global=readGlobalReport(report);
  return `PULSE-${[p.serviceTitle,p.subject,p.timeframe,...(global?[globalArtifactTag(global)]:[])].filter(Boolean).join("-").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,120)}.txt`;
}
export function renderTelegramResearchChart(report: unknown, context: ResearchContext = {}): Uint8Array | null {
  const svg=researchChartSvg(report,context);if(!svg)return null;
  const renderer=new Resvg(svg,{font:{fontFiles:[fileURLToPath(new URL("../../../assets/fonts/Inter.ttf",import.meta.url)),fileURLToPath(new URL("../../../assets/fonts/NotoSansSC-Regular.otf",import.meta.url))],loadSystemFonts:false,defaultFontFamily:"Inter"}});
  return renderer.render().asPng();
}
