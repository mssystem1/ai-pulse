/** Offline screenshot regression and export review. Build schemas/domain/analysis/API first. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {candleCloseTime} from '../packages/schemas/dist/index.js';
import {prepareGlobalReport,globalContextTimeframe} from '../packages/analysis/dist/globalReport.js';
import {globalDecision,globalTradeCards,globalReportChartSvg} from '../packages/domain/dist/index.js';
import {renderTelegramResearchChart,telegramResearchCaption,telegramResearchMessage,formatTelegramResearch} from '../apps/api/dist/telegramResearch.js';

const source=JSON.parse(fs.readFileSync(new URL('../packages/analysis/src/globalReport.oct20-fixture.json',import.meta.url),'utf8'));
const cutoffs={'1H':'2026-10-20T17:42:42.267Z','4H':'2026-10-20T17:40:51.719Z','1Dutc':'2026-10-20T17:38:13.365Z','1Wutc':'2026-10-20T17:44:09.991Z'};
const out=path.resolve('docs/previews/global-oct20-audit');fs.mkdirSync(out,{recursive:true});const cases=[];
for(const [frame,observedAt] of Object.entries(cutoffs))for(const tier of ['base','premium'])for(const lang of ['en','zh']){
  const markets=Object.entries(source.frames).map(([bar,rows])=>({bar,instId:'BTC-USDT',source:'okx-public-spot',fetchedAt:observedAt,ticker:{priceCurrency:'USDT'},candles:rows.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,confirmed:true}))}));
  const report=prepareGlobalReport({market:markets.find(m=>m.bar===frame),contextMarket:markets.find(m=>m.bar===globalContextTimeframe(frame)),hierarchyMarkets:markets,tier,lang});
  const cards=globalTradeCards(report),d=globalDecision(report),svg=globalReportChartSvg(report),caption=telegramResearchCaption(report),message=telegramResearchMessage(report),txt=formatTelegramResearch(report);
  assert.equal(cards.length,['4H','1Dutc'].includes(frame)?0:1);assert.equal(d.currentAction,'WAIT');assert.ok(caption.length<=1024&&message.length<=3900);
  for(const content of [svg,caption,message,txt])assert.doesNotMatch(content,/#[0-9a-f]{8}\b/);
  assert.doesNotMatch(svg,/data-scenario-projection=/);
  if(cards[0])assert.ok(txt.includes(cards[0].location));else assert.ok(txt.includes(report.setupSelection.limitations[0]));
  if(!report.tradePlan.retestTs){assert.equal(report.tradePlan.referenceEntry,null);assert.equal(report.tradePlan.referenceStop,null);assert.equal(report.tradePlan.grossRewardRisk,null);}
  const slug=`${frame.replace('utc','').toLowerCase()}-${report.tier}-${lang}`;
  if(tier==='premium'&&lang==='en'){
    fs.writeFileSync(path.join(out,slug+'.svg'),svg);fs.writeFileSync(path.join(out,slug+'.png'),renderTelegramResearchChart(report));
    fs.writeFileSync(path.join(out,slug+'.txt'),txt);fs.writeFileSync(path.join(out,slug+'-telegram.txt'),caption);
    const study=report.entryStudy;
    fs.writeFileSync(path.join(out,slug+'-evidence.json'),JSON.stringify({frame,observedAt,snapshot:report.snapshot,selection:report.setupSelection,plan:report.tradePlan,range:report.range,rangeAnchors:report.indicators.pivots.filter(a=>report.range?.anchorIds.includes(a.id)).map(a=>({...a,knownAt:candleCloseTime(a.confirmedAt,frame)})),entryStudy:{timeframe:study.timeframe,lastBars:study.candles.slice(-8),recentConfirmedPivots:study.pivots.filter(a=>a.confirmedAt!==null).slice(-8).map(a=>({...a,knownAt:candleCloseTime(a.confirmedAt,study.timeframe)}))}},null,2));
  }
  cases.push({frame,tier:report.tier,lang,observedAt,primaryClose:report.snapshot.price,entryStudyClose:report.entryStudy.candles.at(-1).close,bias:d.direction,action:d.currentAction,state:cards[0]?.state??'No validated entry',entry:report.tradePlan.referenceEntry,stop:report.tradePlan.referenceStop,targets:cards[0]?.targets.map(t=>t.price)??[],grossRewardRisk:report.tradePlan.grossRewardRisk,location:cards[0]?.location??null,captionCharacters:caption.length,messageCharacters:message.length});
}
fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({source:'Public OKX candle replay at screenshot cutoffs; original purchased report payloads unavailable',cases,modelCalls:0,walletPayments:0,telegramSends:0},null,2));
console.log(JSON.stringify({cases:cases.length,out}));
