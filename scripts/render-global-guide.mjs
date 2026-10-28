/** Rebuild public chart illustrations from saved public candles and current code.
 * No model, wallet, market request, backtest or private trading recipe. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Resvg} from '@resvg/resvg-js';
import {prepareGlobalReport,globalContextTimeframe} from '../packages/analysis/dist/index.js';
import {globalReportChartSvg,globalSetupWindow,themeGlobalChartSvg} from '../packages/domain/dist/index.js';

const version='20261028',root='apps/web/public/docs/global-chart',out='.tmp/global-chart-guide-refresh',source='packages/analysis/src/globalReport.oct20-fixture.json';
const fixture=JSON.parse(fs.readFileSync(source,'utf8'));
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:'BTC-USDT',source:'okx-public-spot',fetchedAt:fixture.observedAt,ticker:{priceCurrency:'USDT'},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(out+'/reports',{recursive:true});
const render=svg=>new Resvg(svg,{font:{fontFiles:['assets/fonts/Inter.ttf','assets/fonts/NotoSansSC-Regular.otf'],loadSystemFonts:false,defaultFontFamily:'Inter'},fitTo:{mode:'width',value:1800}}).render().asPng();
const excerpt=svg=>{const bottom=Number(svg.match(/<rect x="25" y="([\d.]+)" width="1250"[^>]*fill="#181c24"/)?.[1]??1014);return svg.replace(/width="1300" height="[\d.]+" viewBox="0 0 1300 [\d.]+"/,`width="1300" height="${bottom}" viewBox="0 0 1300 ${bottom}"`);};
const reports={},files=[];
for(const frame of ['15m','1H','4H','1Dutc','1Wutc']){
 const report=prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:'premium',lang:'en'});reports[frame]=report;
 fs.writeFileSync(out+'/reports/'+frame+'.json',JSON.stringify(report));
 for(const lang of ['en','zh'])for(const appearance of ['light','dark']){
  const svg=globalReportChartSvg({...report,lang});if(!svg||/NaN|Infinity/.test(svg))throw Error('Invalid chart '+frame);
  const png=Buffer.from(render(themeGlobalChartSvg(excerpt(svg),appearance))),name=`chart-guide-${version}-${frame}-${appearance}-${lang}.png`;
  fs.writeFileSync(root+'/'+name,png);files.push({name,frame,lang,appearance,width:png.readUInt32BE(16),height:png.readUInt32BE(20),sha256:createHash('sha256').update(png).digest('hex')});
 }
}
// Retain existing public image URLs with current illustrations, not old rules.
const legacy=[['setup-context','1Dutc'],['directional-plan','4H'],['risk-no-trade','1Dutc'],['risk-setup','1Wutc'],['setup','4H'],['trend','1H'],['fibonacci','1H',{structure:true,layers:{fibonacci:true}}],['vwap-atr-pivots','4H',{layers:{vwap:true,atr:true,pivots:true}}],['rsi-context','4H']];
for(const [name,frame,options] of legacy){const svg=globalReportChartSvg(reports[frame],options);fs.writeFileSync(root+'/'+name+'.png',render(themeGlobalChartSvg(excerpt(svg),'light')));}
const stages=[['1 · Read the saved market and timeframe','Check the primary chart, entry study, context and source timestamps.'],['2 · Read Entry, Hard SL and supported targets','Read the exact entry condition and nearest obstacle before deciding.'],['3 · Inspect the studies and candles','Setup / Structure preserve your inspection. Full history explicitly fits saved candles.'],['4 · Keep view and study resets separate','Reset view restores the window and scale. Reset studies restores indicator switches.'],['5 · Prepare, then save or share','Download chart PNG / report TXT → Preview → Save file or Share / Save to Files.']];
const flow=`<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="800" viewBox="0 0 1300 800"><rect width="1300" height="800" rx="18" fill="#0f1826"/><g font-family="Inter, Noto Sans SC, Arial, sans-serif"><text x="34" y="48" fill="#55dfb5" font-size="27">PULSE · Inspect the Global chart and save your report</text>${stages.map(([title,detail],i)=>`<rect x="34" y="${82+i*136}" width="1232" height="112" rx="10" fill="#152033" stroke="#637791"/><text x="58" y="${118+i*136}" fill="#f6c368" font-size="23">${title.replaceAll('&','&amp;')}</text><text x="58" y="${153+i*136}" fill="#dce7f2" font-size="17">${detail.replaceAll('&','&amp;')}</text>`).join('')}<text x="34" y="783" fill="#b9c6d8" font-size="15">Historical illustration · current controls · no new analysis or order is created by exporting</text></g></svg>`;
fs.writeFileSync(root+'/setup-review-flow.png',render(themeGlobalChartSvg(flow,'light')));
fs.writeFileSync(root+'/provenance.json',JSON.stringify({purpose:'Public historical chart and control illustrations',layoutVersion:version,source:{path:source,sha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex'),observedAt:fixture.observedAt},reports:Object.fromEntries(Object.entries(reports).map(([frame,r])=>[frame,{observedAt:r.snapshot.observedAt,savedCandles:r.candles.length,shownCandles:globalSetupWindow(r)}])),files,legacyUrls:legacy.map(([name])=>name+'.png').concat('setup-review-flow.png'),regenerate:'npm run build -w @pulse/analysis && node scripts/render-global-guide.mjs',networkCalls:0,modelCalls:0,walletData:false},null,2));
console.log(JSON.stringify({galleryImages:files.length,legacyImages:legacy.length+1,root,fixtureReports:out+'/reports',networkCalls:0,modelCalls:0,walletData:false}));
