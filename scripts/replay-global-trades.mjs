/** Audit current text, PNG and Telegram serialization without a remote call. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {globalTradeCards,globalReportChartSvg,globalArtifactReference,presentResearch,researchText} from '../packages/domain/dist/index.js';
import {telegramResearchCaption,telegramResearchMessage,formatTelegramResearch,renderTelegramResearchChart} from '../apps/api/dist/telegramResearch.js';
import {reviewedTradeReports} from './global-trade-replay-data.mjs';

const root='.tmp/global-trade-review';fs.mkdirSync(root,{recursive:true});const cases=[];
for(const lang of ['en','zh'])for(const [frame,r] of Object.entries(reviewedTradeReports(lang))){
  const caption=telegramResearchCaption(r),message=telegramResearchMessage(r),txt=researchText(presentResearch(r)),cards=globalTradeCards(r);
  assert.equal(txt,formatTelegramResearch(r));assert.ok(caption.length<=1024&&message.length<=3900);
  for(const card of cards)for(const output of [caption,message,txt]){
    for(const value of [card.entry,card.stop,'TP1'])assert.ok(output.includes(value),`${frame} ${lang}: ${value}`);
    assert.ok(output.includes(card.condition),`${frame}: full entry trigger`);
  }
  assert.ok(!/\b\d+[DWM]utc\b/.test(txt));
  assert.ok(!/CHECKPOINT|OBJECTIVE|WATCH AREA/.test(globalReportChartSvg(r)));
  fs.writeFileSync(`${root}/${frame}-${lang}.json`,JSON.stringify(r));
  fs.writeFileSync(`${root}/${frame}-${lang}.txt`,txt);
  fs.writeFileSync(`${root}/${frame}-${lang}-caption.txt`,caption);
  fs.writeFileSync(`${root}/${frame}-${lang}-message.txt`,message);
  fs.writeFileSync(`${root}/${frame}-${lang}.png`,renderTelegramResearchChart(r));
  cases.push({frame,lang,reference:globalArtifactReference(r),captionCharacters:caption.length,messageCharacters:message.length,plans:cards.map(c=>({side:c.side,confirmed:c.confirmed,entry:c.entry,sl:c.stop,tps:c.targets.map(t=>t.price),rr:c.rr})),sharedText:true});
}
fs.writeFileSync(`${root}/validation.json`,JSON.stringify({networkCalls:0,modelCalls:0,payments:0,telegramSends:0,cases},null,2));
console.log(JSON.stringify({output:root,cases:cases.length,maxCaption:Math.max(...cases.map(c=>c.captionCharacters)),maxMessage:Math.max(...cases.map(c=>c.messageCharacters))}));
