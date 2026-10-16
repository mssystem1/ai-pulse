/** Offline replay: public OHLCV only. No model, wallet, Telegram send or payment. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { prepareGlobalReport, assessGlobalReport } from "../packages/analysis/dist/index.js";
import { globalReportChartSvg, globalSetupWindow, globalEligibility, globalRemoteLevelLines } from "../packages/domain/dist/index.js";
import { summarizeCandles } from "../packages/market/dist/index.js";
import { telegramResearchCaption,telegramResearchMessage,formatTelegramResearch } from "../apps/api/dist/telegramResearch.js";

const source="packages/analysis/src/globalReport.oct16-fixtures.json",bytes=fs.readFileSync(source),rows=JSON.parse(bytes),out=".tmp/global-setup-validation";
fs.mkdirSync(out,{recursive:true});
const fonts={fontFiles:["assets/fonts/Inter.ttf","assets/fonts/NotoSansSC-Regular.otf"],loadSystemFonts:false,defaultFontFamily:"Inter"};
const render=svg=>new Resvg(svg,{font:fonts,fitTo:{mode:"zoom",value:2}}).render().asPng();
function market(row,context=false){const candles=(context?row.contextCandles:row.candles).map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));return {source:"okx-public-spot",instId:"BTC-USDT",bar:context?row.contextFrame:row.frame,candles,summary:summarizeCandles(candles),fetchedAt:row.observedAt,ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:candles.at(-1).close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:String(Date.parse(row.observedAt))}};}
const results=[];
for(const row of rows)for(const tier of ["base","premium"])for(const lang of ["en","zh"]){
  const report=prepareGlobalReport({market:market(row),contextMarket:market(row,true),tier,lang});
  report.narrative={headline:lang==="en"?"Public candle replay · inspect the setup conditions":"公开 K 线回放 · 检查计划条件",summary:lang==="en"?"This is a numeric replay for chart and workflow validation. No new model opinion or execution recommendation was requested.":"这是用于验证图表与流程的数值回放，没有请求新的模型观点或执行建议。",reasons:[],riskNotes:[],limitations:[],disclaimer:"Offline numeric replay · research only."};
  const caption=telegramResearchCaption(report),message=telegramResearchMessage(report),txt=formatTelegramResearch(report),svg=globalReportChartSvg(report),name=`${row.date}-${report.tier}-${row.frame}-${lang}`;
  assert.ok(caption.length<=1024,`${name} caption: ${caption.length}`);assert.ok(message.length<=3900,`${name} overview: ${message.length}`);
  assert.ok(!svg.includes("NaN")&&!svg.includes("Infinity"));assert.ok(txt.includes(row.frame));assert.ok(globalSetupWindow(report)<=64);
  fs.writeFileSync(`${out}/${name}.json`,JSON.stringify({global:report}));fs.writeFileSync(`${out}/${name}.txt`,txt);
  if(row.date==="oct16"&&lang==="en"){
    fs.writeFileSync(`${out}/${name}.png`,render(svg));
    if(report.tier==="pro"){
      fs.writeFileSync(`${out}/${name}-structure.png`,render(globalReportChartSvg(report,{structure:true})));
      fs.writeFileSync(`${out}/${name}-all-studies.png`,render(globalReportChartSvg(report,{layers:{allSmas:true,regression:true,fibonacci:true,vwap:true,pivots:true,atr:true,channel:true}})));
      if(row.frame==="1D")assert.ok(!svg.includes("126,200"),"Distant archive high must not stretch daily setup");
      if(row.frame==="4H")assert.ok(!svg.includes("62,268.50"),"Distant archive low must not stretch 4H setup");
      if(process.argv.includes("--write-docs")&&["1D","4H"].includes(row.frame))fs.writeFileSync(`apps/web/public/docs/global-chart/${row.frame==="1D"?"risk-no-trade":"risk-setup"}.png`,render(svg));
    }
  }
  results.push({date:row.date,frame:row.frame,tier:report.tier,lang,state:globalEligibility(report),assessment:assessGlobalReport(report,market(row),market(row,true)).state,shown:globalSetupWindow(report),caption:caption.length,message:message.length,remoteContext:globalRemoteLevelLines(report).length});
}
const diagram=`<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="740" viewBox="0 0 1300 740"><rect width="1300" height="740" rx="20" fill="#0f1826"/><g font-family="Inter,Arial" fill="#dce7f2"><text x="38" y="52" font-size="28" fill="#55dfb5">PULSE · From WAIT to order review</text><text x="38" y="90" font-size="18">The purchased report stays unchanged. Recheck produces separate, fresh evidence.</text>${[
  ["1 · Structure + reward","Nearest obstacle must offer enough reward. Poor geometry = NO TRADE.","#f6c368"],
  ["2 · Completed confirmation → later retest","Same named timeframe. Retest deadline: confirmation close + 3 full bars.","#9dabcf"],
  ["3 · Technical setup valid","Observed structural SL. Entry window: retest close + 2 full bars.","#55dfb5"],
  ["4 · Fresh size-specific quote → order review","Verified token + balance + costs + net R:R ≥ 1.50. Quote: 30 seconds max.","#55dfb5"],
].map(([title,detail,color],i)=>`<rect x="38" y="${123+i*128}" width="1224" height="105" rx="12" fill="#172638" stroke="${color}"/><text x="63" y="${159+i*128}" font-size="24" fill="${color}">${title}</text><text x="63" y="${194+i*128}" font-size="18">${detail.replaceAll("&","&amp;")}</text>`).join("")}<text x="38" y="678" font-size="20" fill="#f6c368">Market / Limit with observed TP/SL → review gas and protection → wallet approval</text><text x="38" y="715" font-size="16">Expired or failed attempts require new tests. Modeled costs and stop triggers do not guarantee future fills.</text></g></svg>`;
fs.writeFileSync(`${out}/setup-review-flow.png`,render(diagram));
if(process.argv.includes("--write-docs"))fs.writeFileSync("apps/web/public/docs/global-chart/setup-review-flow.png",render(diagram));
const validation={source,sha256:createHash("sha256").update(bytes).digest("hex"),cases:results.length,results,liveProviderCalls:0,modelCalls:0,payments:0,telegramSends:0};
fs.writeFileSync(`${out}/validation.json`,JSON.stringify(validation,null,2));
console.log(JSON.stringify({cases:results.length,output:out,maxCaption:Math.max(...results.map(r=>r.caption)),maxMessage:Math.max(...results.map(r=>r.message))}));
