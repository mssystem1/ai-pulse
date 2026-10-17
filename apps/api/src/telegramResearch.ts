import {globalDecision,globalDecisionTitle,globalDecisionLines,globalNextSetupLines,globalConfirmationEvidence} from "@pulse/domain";
import {globalCoverageLine,globalFrameReference} from "@pulse/domain";
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
    const d=globalDecision(global),html=escapeTelegramHtml,zh=global.lang==="zh";
    const header=[`<b>PULSE · GLOBAL ${global.tier.toUpperCase()} · ${html(global.snapshot.instId)}</b>`,html(globalTimeframeLabel(global.snapshot.timeframe,global.lang)),html(globalCompletedPriceLine(global))];
    const blocks=[...header,"",`<b>${html(d.marketView)}</b>`,...globalDecisionLines(global).filter((_,i)=>i!==1).map(html),"",`<b>${zh?"下一步条件":"Next condition"}</b>`,...d.checklist.map(html),"",`<b>${zh?"计划参考":"Setup references"}</b>`,...globalNextSetupLines(global).slice(1).map(html)];
    let message=blocks.join("\n");
    const optional=[...(global.tier==="pro"&&d.hierarchy.length?[`<b>${zh?"周期关系":"Timeframe map"}</b>\n${d.hierarchy.map(html).join("\n")}`]:[]),
      ...globalSetupMap(global).paths.filter(p=>global.view.pathIds.includes(p.id)).slice(0,2).map(p=>html(globalPathTitle(global,p))+"\n"+globalPathLines(global,p).slice(0,2).map(html).join("\n")),
      ...(d.previousAttempts.length?[`<b>${zh?"先前尝试":"Previous attempts"}</b>\n${d.previousAttempts.map(html).join("\n")}`]:[])];
    const footer=zh?"已保存快照。重新检查条件无需新报告付款；完整证据见 TXT。":"Saved snapshot. Recheck requires no new report payment. Full evidence is in the TXT.";
    for(const block of optional)if(message.length+block.length+footer.length+4<=3900)message+="\n\n"+block;
    message+="\n\n"+footer;if(message.length>3900)throw Error("Global decision exceeds Telegram message budget");return message;
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
  const d=globalDecision(global),p=globalTradePlan(global),zh=global.lang==="zh";
  const lines=[`PULSE · GLOBAL ${global.tier.toUpperCase()} · ${global.snapshot.instId} · ${globalFrameReference(global.snapshot.timeframe)}`,
    `#${globalArtifactReference(global)} · ${global.snapshot.observedAt}`,globalCompletedPriceLine(global),globalDecisionTitle(global),d.nextCondition,
    ...(d.planningValid?[`${zh?"计划":"Plan"} (${globalFrameReference(d.entryTimeframe)}): ${p.referenceEntry?.map(n=>globalPrice(global,n)).join("–")} · SL ${globalPrice(global,p.referenceStop)} · ${p.targetIds.map((id,i)=>`TP${i+1} ${globalLevelPrice(global,id)}`).join(" → ")}`]:[]),d.rewardLine,d.contextLine,
    ...(globalCoverageLine(global)?[globalCoverageLine(global)!]:[]),zh?"保存的行情快照；执行前复核新报价。":"Saved snapshot; recheck a fresh quote before execution."];
  const caption=lines.filter(Boolean).join("\n");if(caption.length>1024)throw Error("Global decision exceeds Telegram caption budget");return caption;
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
