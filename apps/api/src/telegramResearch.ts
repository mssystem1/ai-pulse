import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import { presentResearch, researchText, researchChartSvg, researchDate, researchStatus, type ResearchContext, type ResearchIdentity } from "@pulse/domain";

export { type ResearchContext } from "@pulse/domain";
export const escapeTelegramHtml = (text: string) => text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const clip = (value: string, max: number) => { if(value.length<=max)return value;let result="";for(const char of value){if(result.length+char.length>max-1)break;result+=char;}return result+"…"; };
const boundedHtml = (value: string, max: number) => { let result="";for(const char of value){const safe=escapeTelegramHtml(char);if(result.length+safe.length>max-1)return result+"…";result+=safe;}return result; };
export function formatTelegramResearch(report: unknown, context: ResearchContext = {}) {
  return researchText(presentResearch(report,context));
}
/** One bounded overview; the document retains every curated research section. */
export function telegramResearchMessage(report: unknown, context: ResearchContext = {}) {
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
export function telegramHistoryLabel(order: ResearchIdentity & {status:string;createdAt:number}) {
  const date=researchDate(order.createdAt).slice(5,16);
  return `${clip(order.subject,36)}${order.timeframe?` · ${order.timeframe}`:""} · ${order.serviceTitle} · ${researchStatus(order.status)}${date?` · ${date} UTC`:""}`;
}
export function telegramResearchFilename(report: unknown, context: ResearchContext = {}) {
  const p=presentResearch(report,context);
  return `PULSE-${[p.serviceTitle,p.subject,p.timeframe].filter(Boolean).join("-").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,120)}.txt`;
}
export function renderTelegramResearchChart(report: unknown, context: ResearchContext = {}): Uint8Array | null {
  const svg=researchChartSvg(report,context);if(!svg)return null;
  const renderer=new Resvg(svg,{font:{fontFiles:[fileURLToPath(new URL("../../../assets/fonts/Inter.ttf",import.meta.url))],loadSystemFonts:false,defaultFontFamily:"Inter"}});
  return renderer.render().asPng();
}
