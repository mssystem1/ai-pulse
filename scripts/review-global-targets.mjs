/** Offline technical correction of a previously delivered report. No payment,
 * model, wallet or market calls. Private delivery files stay outside git. */
import fs from 'node:fs';
import path from 'node:path';
import {Resvg} from '@resvg/resvg-js';
import {readGlobalReport,globalArtifactReference,globalTradeCards,globalReportChartSvg,presentResearch,researchText} from '../packages/domain/dist/index.js';
import {reviewGlobalTargetReport} from '../packages/analysis/dist/index.js';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/review-global-targets.mjs <saved-delivery.json> <output-directory>');
const delivery=JSON.parse(fs.readFileSync(input,'utf8')),original=readGlobalReport(delivery.report??delivery);
if(!original)throw Error('A valid saved Global report is required');
const report=reviewGlobalTargetReport(original),ref=globalArtifactReference(report),stem=`BTC-${report.snapshot.timeframe}-target-review-${ref}`;
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,`${stem}.txt`),researchText(presentResearch(report)));
fs.writeFileSync(path.join(output,`${stem}.json`),JSON.stringify({originalRef:globalArtifactReference(original),reviewRef:ref,report},null,2));
for(const card of globalTradeCards(report).length?globalTradeCards(report):[{key:undefined,side:'overview'}]){
  const svg=globalReportChartSvg(report,{selectedPathId:card.key});if(!svg||/NaN|Infinity/.test(svg))throw Error('Invalid review chart');
  fs.writeFileSync(path.join(output,`${stem}-${card.side}.svg`),svg);
  const png=new Resvg(svg,{font:{fontFiles:['assets/fonts/Inter.ttf','assets/fonts/NotoSansSC-Regular.otf'],loadSystemFonts:false,defaultFontFamily:'Inter'}}).render().asPng();
  fs.writeFileSync(path.join(output,`${stem}-${card.side}.png`),png);
}
const summary={originalRef:globalArtifactReference(original),reviewRef:ref,timeframe:report.snapshot.timeframe,policy:report.strategy?.targetPolicy,cards:globalTradeCards(report).map(c=>({side:c.side,entry:c.plan.referenceEntry,stop:c.plan.referenceStop,targets:c.targets.map(t=>t.price),rewardRisk:c.rr,confirmed:c.confirmed})),networkCalls:0,modelCalls:0,payments:0,stem};
fs.writeFileSync(path.join(output,`${stem}-summary.json`),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
