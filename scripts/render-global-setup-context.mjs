/** Public historical chart example; no strategy recipe or private account data. */
import fs from 'node:fs';
import {Resvg} from '@resvg/resvg-js';
import {prepareGlobalReport,globalContextTimeframe} from '../packages/analysis/dist/index.js';
import {globalReportChartSvg} from '../packages/domain/dist/index.js';

const fixture=JSON.parse(fs.readFileSync('packages/analysis/src/globalReport.oct20-fixture.json','utf8'));
const markets=Object.entries(fixture.frames).map(([bar,rows])=>({bar,instId:'BTC-USDT',source:'okx-public-spot',fetchedAt:fixture.observedAt,ticker:{priceCurrency:'USDT'},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
const out='.tmp/global-setup-context';fs.mkdirSync(out,{recursive:true});
for(const frame of ['15m','1H','4H','1Dutc','1Wutc']){
  const r=prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier:'premium'});
  const svg=globalReportChartSvg(r);if(!svg||/NaN|Infinity/.test(svg))throw Error(`Invalid saved chart: ${frame}`);
  const png=new Resvg(svg,{font:{fontFiles:['assets/fonts/Inter.ttf','assets/fonts/NotoSansSC-Regular.otf'],loadSystemFonts:false,defaultFontFamily:'Inter'},fitTo:{mode:'width',value:1600}}).render().asPng();
  fs.writeFileSync(`${out}/${frame}.svg`,svg);fs.writeFileSync(`${out}/${frame}.png`,png);
  if(frame==='1Dutc')fs.writeFileSync('apps/web/public/docs/global-chart/setup-context.png',png);
}
console.log(JSON.stringify({charts:5,publicGuide:'apps/web/public/docs/global-chart/setup-context.png',privateReview:out,networkCalls:0}));
