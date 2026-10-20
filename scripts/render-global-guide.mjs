/** Regenerate every app guide image from current, public historical replay. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Resvg} from '@resvg/resvg-js';
import {globalReportChartSvg,globalSetupWindow,globalArtifactReference} from '../packages/domain/dist/index.js';
import {reviewedTradeReports,tradeReplaySources} from './global-trade-replay-data.mjs';

const reports=reviewedTradeReports('en','active-zones-v1'),root='apps/web/public/docs/global-chart';
fs.mkdirSync(root,{recursive:true});
const render=svg=>new Resvg(svg,{font:{fontFiles:['assets/fonts/Inter.ttf','assets/fonts/NotoSansSC-Regular.otf'],loadSystemFonts:false,defaultFontFamily:'Inter'},fitTo:{mode:'zoom',value:2}}).render().asPng();
const examples=[
  {name:'directional-plan',frame:'4H'},
  {name:'risk-no-trade',frame:'1Dutc'},
  {name:'risk-setup',frame:'1Wutc'},
  {name:'setup',frame:'4H',box:[0,0,1300,774]},
  {name:'trend',frame:'1H',box:[0,0,1300,595],options:{structure:true}},
  {name:'fibonacci',frame:'1H',box:[0,0,1300,595],options:{structure:true}},
  {name:'vwap-atr-pivots',frame:'4H',box:[0,0,1300,595],options:{layers:{vwap:true,atr:true,pivots:true}}},
  {name:'rsi-context',frame:'4H'},
];
for(const e of examples){
  let svg=globalReportChartSvg(reports[e.frame],e.options);
  console.log(`Rendering ${e.name}`);
  if(!svg||/NaN|Infinity/.test(svg))throw Error(`Invalid chart SVG: ${e.name}`);
  if(e.box){const [x,y,w,h]=e.box;svg=svg.replace(/width="1300" height="\d+" viewBox="0 0 1300 \d+"/,`width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"`);}
  fs.writeFileSync(`${root}/${e.name}.png`,render(svg));
}
const stages=[
  ['1 · Choose the market and horizon','Fast 15m / Intraday 1H / Swing 4H / Position 1D / Macro 1W'],
  ['2 · Separate the direction from entry readiness','A watch level alone establishes neither Entry nor SL. Wait for observed reaction evidence.'],
  ['3 · Confirm the main condition and entry reaction','Completed main bar first; later entry-frame reaction and follow-through / held retest.'],
  ['4 · Check protection, nearest barrier and size','Use actual reaction protection. Require at least 1.50R to the nearest barrier before costs.'],
  ['5 · Review a fresh quote and the order','Verify asset, balance and costs; net R:R to the nearest barrier must also reach 1.50.'],
];
const flow=`<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="820" viewBox="0 0 1300 820"><rect width="1300" height="820" rx="20" fill="#0f1826"/><g font-family="Inter,Arial" fill="#dce7f2"><text x="38" y="52" font-size="28" fill="#55dfb5">PULSE · Entry / SL / TP → Order review</text><text x="38" y="90" font-size="18">Historical examples explain the method. They are not current signals or filled orders.</text>${stages.map(([title,detail],i)=>`<rect x="38" y="${116+i*126}" width="1224" height="108" rx="10" fill="#172638" stroke="#3c6372"/><text x="63" y="${151+i*126}" font-size="24" fill="#f6c368">${title}</text><text x="63" y="${186+i*126}" font-size="18">${detail}</text>`).join('')}<text x="38" y="784" font-size="17">Signal confirmation ≠ a fill. Current Spot SELL reduces owned inventory; it does not open a leveraged short.</text></g></svg>`;
fs.writeFileSync(`${root}/setup-review-flow.png`,render(flow));
fs.writeFileSync(`${root}/provenance.json`,JSON.stringify({purpose:'Historical educational examples, not current trade signals',method:'decision-v5 / structure-v5 / horizon-v2 / active-zones-v1 / single-setup-v4',sources:tradeReplaySources.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),reports:Object.fromEntries(Object.entries(reports).map(([frame,r])=>[frame,{reference:globalArtifactReference(r),observedAt:r.snapshot.observedAt,savedCandles:r.candles.length,shownCandles:globalSetupWindow(r)}])),examples,additionalImages:{'setup-review-flow':'Authored workflow; no forecast'},regenerate:'npm run build -w @pulse/analysis && node scripts/render-global-guide.mjs',networkCalls:0,modelCalls:0,walletData:false},null,2));
console.log(JSON.stringify({images:9,method:'structure-v5',root,networkCalls:0}));
