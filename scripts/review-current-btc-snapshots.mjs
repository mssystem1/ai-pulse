/** Offline correction of five saved BTC deliveries. Build the reviewed revision
 * first. No wallet, market request, model call, payment or trade simulation.
 * Corrected artifacts keep the original UTC clocks; they are not fresh reports. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {reviewGlobalTargetReport,globalCompatibility} from '../packages/analysis/dist/index.js';
import {GlobalReportSchema,candleCloseTime} from '../packages/schemas/dist/index.js';
import {globalArtifactReference,globalTradeCards,globalDecision,globalReportChartSvg,themeGlobalChartSvg,globalChartRasterSize,presentResearch,researchText} from '../packages/domain/dist/index.js';
import {fullReportDelivery} from '../apps/api/dist/reportDelivery.js';
import {renderResearchPng} from '../apps/api/dist/researchPng.js';
import {formatTelegramResearch,telegramResearchMessage,telegramResearchCaption} from '../apps/api/dist/telegramResearch.js';
import {reviewPrimaryObstacleCoverage} from './audit-current-btc-obstacles.mjs';

const argument=(name,fallback)=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1)??fallback;
const root=path.resolve(argument('--root','.tmp/btc-arbitrum-current-2026-10-28'));
const out=path.resolve(argument('--out',path.join(root,'corrected-local-review')));
const expectedVersion=argument('--expected-plan-version','discretionary-plan-v7');
assert.ok(root.startsWith(path.resolve('.tmp')+path.sep),'Read saved .tmp reports only');
assert.ok(out.startsWith(root+path.sep)&&out!==path.join(root,'private'),'Keep corrections separate from original deliveries');
const frames=['15m','1H','4H','1Dutc','1Wutc'],createdAt=new Date().toISOString();
const digest=value=>createHash('sha256').update(value).digest('hex');
const originals=new Map(frames.map(frame=>{const file=path.join(root,'private',frame+'-delivery.json'),bytes=fs.readFileSync(file);return[frame,{file,bytes,sha256:digest(bytes)}];}));
const captured=g=>({snapshot:g.snapshot,candles:g.candles,entry:g.entryStudy&&{timeframe:g.entryStudy.timeframe,source:g.entryStudy.source,status:g.entryStudy.status,observedAt:g.entryStudy.observedAt,candles:g.entryStudy.candles},context:{timeframe:g.context.timeframe,source:g.context.source,status:g.context.status,candles:g.context.candles},currentMarket:g.currentMarket});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const codeFiles=['packages/analysis/dist/globalTradeMap.js','packages/analysis/dist/globalDiscretionaryPlan.js','packages/analysis/dist/globalPriceZones.js','packages/analysis/dist/globalSetupContext.js','packages/domain/dist/globalDiscretionaryPlan.js','packages/domain/dist/globalScenarioEvidence.js','packages/domain/dist/globalChart.js','packages/domain/dist/globalChartAppearance.js','packages/domain/dist/globalPresentation.js','apps/api/dist/reportDelivery.js','apps/api/dist/researchPng.js'];
const codeHashes=Object.fromEntries(codeFiles.filter(file=>fs.existsSync(file)).map(file=>[file,digest(fs.readFileSync(file))]));
let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw Error('Offline review prohibits network requests');};
let sharp;try{sharp=(await import('sharp')).default;}catch{sharp=null;}
for(const dir of ['reports','deliveries','artifacts'])fs.mkdirSync(path.join(out,dir),{recursive:true});
const results=[];
for(const frame of frames){
  const originalFile=originals.get(frame),delivery=JSON.parse(originalFile.bytes),original=delivery.report,source=original.global,before=JSON.stringify(source);
  const originalReference=globalArtifactReference(source),reviewed=reviewGlobalTargetReport(source);
  assert.equal(JSON.stringify(source),before,'Review mutated the original object');
  assert.equal(reviewed.discretionaryPlan?.version,expectedVersion,'Build the expected reviewed plan revision before running this script');
  assert.deepEqual(captured(reviewed),captured(source),'Captured clocks, quotes or OHLCV changed');
  const findings=[],warnings=[],check=(condition,message)=>{if(!condition)findings.push(message);};
  const parsed=GlobalReportSchema.safeParse(reviewed);if(!parsed.success)findings.push(...parsed.error.issues.map(i=>'Schema '+i.path.join('.')+': '+i.message));
  const p=reviewed.discretionaryPlan,z=p.priceZones;assert.ok(z,'Corrected Entry/SL/TP ranges missing');
  const entrySourceMatches=p.entryBasis.price===z.entry.sourcePrice;
  check(entrySourceMatches,'entryBasis.price differs from price-zone sourcePrice');
  // The source point may remain beyond the clipped permitted Entry range.
  check(z.entry.lower>=z.entry.sourceLower&&z.entry.upper<=z.entry.sourceUpper,'Permitted Entry leaves its retained source range');
  const cutoff=Date.parse(reviewed.snapshot.observedAt);
  check(p.requiresNewTestAfter===cutoff,'Fresh reaction cutoff changed from the captured snapshot');
  check(p.entryBasis.knownAt<=cutoff&&p.stopBasis.knownAt<=cutoff&&p.targets.every(t=>t.knownAt<=cutoff),'Correction uses future evidence');
  if(!reviewed.orderFlow)warnings.push('Saved source has no executed-order-flow payload; no new footprint or liquidation confirmation is inferred');
  if(reviewed.candles.length<520)warnings.push('Saved primary history retains '+reviewed.candles.length+'/520 completed candles');
  const obstacleReview=reviewPrimaryObstacleCoverage(reviewed);findings.push(...obstacleReview.findings);warnings.push(...obstacleReview.warnings);
  const report={...original,global:reviewed,...globalCompatibility(reviewed)};
  assert.equal(report.generatedAt,original.generatedAt,'Correction must not claim a new market generation time');
  const canonical=fullReportDelivery(report),txt=researchText(presentResearch(report)),cards=globalTradeCards(reviewed);
  check(txt===formatTelegramResearch(report),'TXT and Telegram presentation disagree');
  check(telegramResearchMessage(report).length<=3900&&telegramResearchCaption(report).length<=1024,'Telegram limits exceeded');
  check(cards.length===1,'Exactly one concrete setup is required');
  check(cards.every(c=>!c.confirmed),'Saved evidence cannot create a new post-snapshot confirmed entry');
  for(const card of cards)for(const[name,text]of[['Markdown',canonical.reportMarkdown],['TXT',txt]]){
    check(text.includes(card.entry)&&text.includes(card.stop),name+' omits canonical Entry/SL');check(text.includes(card.condition),name+' omits the canonical trigger');
  }
  const metadata={kind:'offline-saved-source-technical-review',createdAt,sourceSnapshotObservedAt:source.snapshot.observedAt,originalGeneratedAt:original.generatedAt,originalReference,reviewReference:globalArtifactReference(reviewed),originalDeliverySha256:originalFile.sha256,planVersion:p.version,note:'No new market data, model response, payment or order. Captured UTC clocks remain unchanged.'};
  fs.writeFileSync(path.join(out,'reports',frame+'.json'),JSON.stringify(reviewed,null,2));
  fs.writeFileSync(path.join(out,'deliveries',frame+'.json'),JSON.stringify({report,...canonical,technicalReview:metadata},null,2));
  fs.writeFileSync(path.join(out,'artifacts',frame+'.txt'),txt);fs.writeFileSync(path.join(out,'artifacts',frame+'.md'),canonical.reportMarkdown);
  const baseSvg=globalReportChartSvg(reviewed);check(Boolean(baseSvg)&&!/NaN|Infinity/.test(baseSvg),'Chart SVG is invalid');const images=[];
  for(const appearance of ['dark','light']){
    const svg=themeGlobalChartSvg(baseSvg,appearance),png=Buffer.from(renderResearchPng(svg));
    fs.writeFileSync(path.join(out,'artifacts',frame+'.'+appearance+'.svg'),svg);fs.writeFileSync(path.join(out,'artifacts',frame+'.'+appearance+'.png'),png);
    check(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid PNG signature');
    const width=png.readUInt32BE(16),height=png.readUInt32BE(20),tag=svg.match(/<svg\b[^>]*>/)?.[0]??'',sourceWidth=Number(tag.match(/\bwidth="([\d.]+)"/)?.[1]),sourceHeight=Number(tag.match(/\bheight="([\d.]+)"/)?.[1]),expected=globalChartRasterSize(sourceWidth,sourceHeight);
    check(width===expected.width&&Math.abs(height-expected.height)<=1,'PNG differs from production high-resolution dimensions');
    check(width>=2400&&height>=1200&&width*height<=16010000&&Math.max(width,height)<=8192&&width+height<=10001,'PNG resolution or export bounds failed');
    let pixelCheck=null;
    if(sharp){const image=sharp(png),meta=await image.metadata(),stats=await image.stats();check(meta.format==='png'&&meta.width===width&&meta.height===height,'Sharp PNG decoding failed');check(stats.channels.slice(0,3).some(c=>c.stdev>3),'PNG appears blank');pixelCheck={decoded:true,isOpaque:stats.isOpaque,channelStdev:stats.channels.slice(0,3).map(c=>c.stdev)};}
    images.push({appearance,width,height,bytes:png.length,sha256:digest(png),pixelCheck});
  }
  if(!sharp)warnings.push('Sharp unavailable; PNG signature and dimensions checked without independent pixel decoding');
  const sources=[{timeframe:frame,candles:reviewed.candles},reviewed.entryStudy,{timeframe:reviewed.context.timeframe,candles:reviewed.context.candles}].filter(Boolean).map(s=>({timeframe:s.timeframe,candles:s.candles.length,lastCompletedAt:new Date(candleCloseTime(s.candles.at(-1).ts,s.timeframe)).toISOString()}));
  const sign=p.side==='long'?1:-1,entry=sign===1?z.entry.upper:z.entry.lower,target=sign===1?z.targets[0].lower:z.targets[0].upper,risk=Math.abs(entry-p.stop),barrier=p.barriers.filter(b=>sign*(b.price-entry)>0).sort((a,b)=>sign*(a.price-b.price))[0];
  const result={frame,ok:findings.length===0,findings,warnings,...metadata,sourceSnapshotAgeAtReviewMs:Date.now()-cutoff,sourceQuote:reviewed.currentMarket?.quote,sources,sourceEvidenceUnchanged:true,entrySourceMatches,primaryAssessment:reviewed.setupSelection?.assessment,scenarioSide:p.side,family:p.family,entryRange:[z.entry.lower,z.entry.upper],entryBasis:p.entryBasis,sourceRange:[z.entry.sourceLower,z.entry.sourceUpper],stopRange:[z.stop.lower,z.stop.upper],hardStop:p.stop,targetRanges:z.targets,barriers:p.barriers,firstTargetRewardRisk:sign*(target-entry)/risk,nearestBarrierRewardRisk:barrier?sign*(barrier.price-entry)/risk:null,confirmed:cards.some(c=>c.confirmed),action:globalDecision(reviewed).currentAction,conditions:cards.map(c=>c.condition),obstacleReview,images};
  results.push(result);fs.writeFileSync(path.join(out,frame+'-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({frame,ok:result.ok,findings,warnings,planVersion:p.version,pngs:images.map(i=>({appearance:i.appearance,width:i.width,height:i.height}))}));
}
for(const[,{file,sha256}]of originals)assert.equal(digest(fs.readFileSync(file)),sha256,'Original production delivery changed during review');
assert.equal(networkAttempts,0);
const proof={createdAt,kind:'offline-saved-source-technical-review',sourceRoot:root,output:out,localHead:head,codeHashes,expectedPlanVersion:expectedVersion,originalSourcesUnchanged:true,originalDeliveryHashes:Object.fromEntries([...originals].map(([frame,o])=>[frame,o.sha256])),sharpAvailable:Boolean(sharp),networkCalls:0,modelCalls:0,newPayments:0,liveOrders:0,backtests:0,note:'Captured UTC clocks and OHLCV are preserved. These corrections are not fresh market reports, live fills or performance evidence.',results};
fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({reports:results.length,passed:results.filter(r=>r.ok).length,originalSourcesUnchanged:true,networkCalls:0,modelCalls:0,newPayments:0,output:out}));process.exitCode=results.some(r=>!r.ok)?1:0;
