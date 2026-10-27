import {globalDecision,globalDecisionTitle,globalDecisionLines,globalNextSetupLines,globalConfirmationEvidence} from "@pulse/domain";
import {globalCoverageLine,globalFrameReference} from "@pulse/domain";
import {globalTradeCards,type GlobalReport} from "@pulse/domain";
import {renderResearchPng} from "./researchPng.js";
import { presentResearch, researchText, researchChartSvg, researchDate, researchStatus, type ResearchContext, type ResearchIdentity } from "@pulse/domain";
import { readGlobalReport, globalLabel, globalSetupLines, globalMissingLabel, globalPathTitle, globalPathLines, globalLevelPrice, globalEvidenceLines, globalTimeframeLabel, globalHumanText, globalTradePlanLines, globalTradePlanTitle, globalTradePlan, globalPrice, globalConfirmationCorrection, globalCompletedPriceLine, globalRiskLines, globalSetupMap, globalArtifactTag } from "@pulse/domain";

export { type ResearchContext } from "@pulse/domain";
export const escapeTelegramHtml = (text: string) => text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const clip = (value: string, max: number) => { if(value.length<=max)return value;let result="";for(const char of value){if(result.length+char.length>max-1)break;result+=char;}return result+"…"; };
const boundedHtml = (value: string, max: number) => { let result="";for(const char of value){const safe=escapeTelegramHtml(char);if(result.length+safe.length>max-1)return result+"…";result+=safe;}return result; };
function tradeCaption(report:GlobalReport){
  const cards=globalTradeCards(report),zh=report.lang==="zh";
  const lines=[`PULSE · ${report.snapshot.instId} · ${globalFrameReference(report.snapshot.timeframe)} · ${report.strategy?.name??""}`,report.snapshot.observedAt,globalCompletedPriceLine(report),globalDecisionTitle(report),
    ...cards.flatMap(c=>[`${c.direction} · ${c.confirmed?zh?"已确认":"confirmed":zh?"计划":"planned"}`,`Entry ${c.entry} · SL ${c.stop}`,c.targets.map((t,i)=>`TP${i+1} ${globalPrice(report,t.price)}`).join(" → "),`${zh?"触发":"Trigger"}: ${c.condition}.`]),
    ...(!cards.length?[globalDecision(report).entryInstruction]:[]),
    zh?"价格为保存的计划；确认后复核新报价。完整条件见 TXT。":"Saved planned prices; confirm the signal and recheck a fresh quote. Full evidence in TXT."];
  const caption=lines.filter(Boolean).join("\n");if(caption.length>1024)throw Error("Global trade plans exceed Telegram caption budget");return caption;
}
export function formatTelegramResearch(report: unknown, context: ResearchContext = {}) {
  return researchText(presentResearch(report,context));
}
/** One bounded overview; the document retains every curated research section. */
export function telegramResearchMessage(report: unknown, context: ResearchContext = {}) {
  const global=readGlobalReport(report);
  if(global){
    if(global.decisionVersion==="decision-v5"){
      const d=globalDecision(global),html=escapeTelegramHtml;
      const lines=[`<b>PULSE · GLOBAL ${global.tier.toUpperCase()} · ${html(global.snapshot.instId)} · ${html(globalFrameReference(global.snapshot.timeframe))}</b>`,html(globalCompletedPriceLine(global)),`<b>${html(d.heading)}</b>`,html(d.entryInstruction),
        ...globalTradeCards(global).flatMap(c=>["",...c.lines.map(html)]),"",html(d.changeView),"",...d.hierarchy.map(html),"",global.lang==="zh"?"现货 SELL 仅减持已有资产。信号不代表成交；完整证据见 TXT。":"Spot SELL reduces owned inventory. A signal is not a fill. Full evidence is in the TXT."];
      const message=lines.join("\n");if(message.length>3900)throw Error("Global trade plans exceed Telegram message budget");return message;
    }
    const d=globalDecision(global),html=escapeTelegramHtml,zh=global.lang==="zh";
    const header=[`<b>PULSE · GLOBAL ${global.tier.toUpperCase()} · ${html(global.snapshot.instId)}</b>`,html(globalTimeframeLabel(global.snapshot.timeframe,global.lang)),html(globalCompletedPriceLine(global))];
    const blocks=[...header,"",`<b>${html(d.marketView)}</b>`,...globalDecisionLines(global).filter((_,i)=>i!==1).map(html),"",`<b>${zh?"下一步条件":"Next condition"}</b>`,...d.checklist.map(html),"",`<b>${zh?"计划参考":"Setup references"}</b>`,...globalNextSetupLines(global).slice(1).map(html)];
    let message=blocks.join("\n");
    const optional=[`<b>${zh?"买卖入场证据":"BUY / SELL entry evidence"}</b>\n${d.scenarios.map(s=>html(s.line)).join("\n")}`,...(global.tier==="pro"&&d.hierarchy.length?[`<b>${zh?"周期关系":"Timeframe map"}</b>\n${d.hierarchy.map(html).join("\n")}`]:[]),
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
  if(global.decisionVersion==="decision-v5")return tradeCaption(global);
  const d=globalDecision(global),p=globalTradePlan(global),zh=global.lang==="zh";
  const lines=[`PULSE · GLOBAL ${global.tier.toUpperCase()} · ${global.snapshot.instId} · ${globalFrameReference(global.snapshot.timeframe)}`,
    global.snapshot.observedAt,globalCompletedPriceLine(global),globalDecisionTitle(global),...(d.direction==="BUY / SELL"?d.scenarios.map(s=>`${s.side}: ${s.condition}; ${s.reason}.`):[d.nextCondition]),
    ...(d.planningValid&&d.direction!=="BUY / SELL"?[`${d.signalObserved?zh?"已观察入场":"Observed entry":zh?"观察区域":"Watch area"} (${globalFrameReference(d.entryTimeframe)}): ${p.referenceEntry?.map(n=>globalPrice(global,n)).join("–")} · ${d.signalObserved?"SL":"Provisional SL"} ${globalPrice(global,p.referenceStop)} · ${p.targetIds.map((id,i)=>`TP${i+1} ${globalLevelPrice(global,id)}`).join(" → ")}`]:[]),...(d.direction!=="BUY / SELL"?[d.rewardLine]:[]),d.contextLine,
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
  return renderResearchPng(svg,Boolean(readGlobalReport(report)));
}
