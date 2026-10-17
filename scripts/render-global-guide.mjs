/** Educational PNGs from public candle fixtures and the app's real renderer. */
import fs from "node:fs";
import {Resvg} from "@resvg/resvg-js";
import {prepareGlobalReport} from "../packages/analysis/dist/index.js";
import {globalReportChartSvg,globalSetupWindow} from "../packages/domain/dist/index.js";
import {summarizeCandles} from "../packages/market/dist/index.js";
import {globalReplayMarkets} from "./global-replay-data.mjs";

const source="packages/analysis/src/globalReport.oct16-fixtures.json",rows=JSON.parse(fs.readFileSync(source,"utf8"));
const row=rows.find(r=>r.date==="oct16"&&r.frame==="1D");
function market(context=false){const candles=(context?row.contextCandles:row.candles).map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));return {source:"okx-public-spot",instId:"BTC-USDT",bar:context?row.contextFrame:row.frame,candles,summary:summarizeCandles(candles),fetchedAt:row.observedAt,ticker:{instId:"BTC-USDT",priceCurrency:"USDT",last:candles.at(-1).close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:String(Date.parse(row.observedAt))}};}
const report=prepareGlobalReport({market:market(),contextMarket:market(true),hierarchyMarkets:globalReplayMarkets(row),tier:"premium"});
const root="apps/web/public/docs/global-chart";fs.mkdirSync(root,{recursive:true});
const examples=[
  {name:"setup",layers:{channel:true},box:[0,0,1300,774]},
  {name:"directional-plan",layers:{channel:true}},
  {name:"trend",layers:{channel:false,allSmas:true,regression:true},box:[0,0,1300,595]},
  {name:"fibonacci",layers:{channel:false,fibonacci:true},box:[0,0,1300,595]},
  {name:"vwap-atr-pivots",layers:{channel:false,vwap:true,atr:true,pivots:true},box:[0,0,1300,595]},
  {name:"rsi-context",layers:{channel:false},box:[40,594,1240,169]},
];
for(const example of examples){let svg=globalReportChartSvg(report,{layers:example.layers,structure:["fibonacci","trend"].includes(example.name)});if(example.box){const [x,y,width,height]=example.box;svg=svg.replace(/width="1300" height="\d+" viewBox="0 0 1300 \d+"/,`width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}"`);}const png=new Resvg(svg,{font:{fontFiles:["assets/fonts/Inter.ttf","assets/fonts/NotoSansSC-Regular.otf"],loadSystemFonts:false,defaultFontFamily:"Inter"},fitTo:{mode:"zoom",value:2}}).render().asPng();fs.writeFileSync(`${root}/${example.name}.png`,png);}
fs.writeFileSync(`${root}/provenance.json`,JSON.stringify({purpose:"Historical educational chart images; not current trading signals",source,renderer:"PULSE canonical saved-report renderer",snapshot:report.snapshot,contextTimeframe:report.context.timeframe,savedCandles:report.candles.length,shownCandles:globalSetupWindow(report),examples,additionalImages:{"risk-no-trade":"oct16 Pro 1D public replay","risk-setup":"oct16 Pro 4H public replay","setup-review-flow":"Authored workflow diagram"},regenerate:"node scripts/validate-global-setup.mjs --write-docs && node scripts/render-global-guide.mjs",modelCalls:0,walletData:false},null,2));
console.log(JSON.stringify({images:examples.length,source}));
