/** Bounded saved-report correctness replay. It selects no new strategy,
 * changes no prices, and estimates no exchange fills or performance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {candleCloseTime,GlobalReportSchema} from '../packages/schemas/src/index.ts';
import {globalSetupAdmission} from '../packages/domain/src/globalSetupAdmission.ts';
import {advanceGlobalScenario,globalScenarioDefinitionForReport,newGlobalScenario} from '../packages/analysis/src/globalScenarioLifecycle.ts';
import {reviewGlobalTargetReport} from '../packages/analysis/src/globalTradeMap.ts';
import {terminalPricePathEvents} from '../apps/api/src/terminalPricePath.ts';

const option=(name,fallback)=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1)??fallback;
let networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw new Error('Saved-report replay prohibits network requests');};
const files={original:option('--original','.tmp/terminal-nine-qa/markets.json'),later:option('--later','.tmp/deployed-terminal-retest-20261118/deployed-markets.json')};
const out=path.resolve(option('--out','.tmp/btc-setup-path-audit-20261118'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const inputs=Object.fromEntries(Object.entries(files).map(([name,file])=>{const bytes=fs.readFileSync(file);return[name,{file,sha256:hash(bytes),data:JSON.parse(bytes)}]}));
const get=(input,frame)=>input.data[frame]?.report??input.data[frame];
const reviews=Object.fromEntries(['1H','1Dutc','1Wutc'].map(frame=>{
 const original=get(inputs.original,frame),review=reviewGlobalTargetReport(original);
 assert.deepEqual(review.snapshot,original.snapshot);assert.deepEqual(review.candles,original.candles);assert.deepEqual(review.entryStudy,original.entryStudy);
 return [frame,{report:review}];
}));
inputs.review={file:null,sha256:hash(JSON.stringify(reviews)),data:reviews};
const after=get(inputs.later,'1H');
assert.equal(after.snapshot.instId,'BTC-USDT');
assert.equal(after.entryStudy.timeframe,'15m');
const observationBars=after.entryStudy.candles;
assert(observationBars.every(bar=>bar.confirmed));
const through=candleCloseTime(observationBars.at(-1).ts,'15m');
assert(through<=Date.parse(after.snapshot.observedAt));
const observation={source:after.snapshot.source,instId:after.snapshot.instId,currency:after.snapshot.priceCurrency,timeframe:'15m',first:observationBars[0].ts,through,candles:observationBars.length};
const fineFile=option('--fine',null);
let fineInput=null;
if(fineFile){
 const bytes=fs.readFileSync(fineFile),fine=JSON.parse(bytes);
 assert(fine.valid&&fine.source===observation.source&&fine.instId===observation.instId&&fine.priceCurrency===observation.currency&&fine.timeframe==='1m','Finer source identity is invalid');
 assert.equal(fine.window.end-fine.window.start,15*60_000);
 assert.equal(fine.candles.length,15);
 assert(fine.candles.every((bar,index)=>bar.confirmed&&bar.ts===fine.window.start+index*60_000&&[bar.open,bar.high,bar.low,bar.close].every(n=>Number.isFinite(n)&&n>0)&&bar.high>=Math.max(bar.open,bar.close)&&bar.low<=Math.min(bar.open,bar.close)),'Finer candle coverage is incomplete');
 const parent=observationBars.find(bar=>bar.ts===fine.window.start);
 assert(parent,'Finer window must replace an existing observed candle');
 assert.deepEqual({open:fine.candles[0].open,high:Math.max(...fine.candles.map(bar=>bar.high)),low:Math.min(...fine.candles.map(bar=>bar.low)),close:fine.candles.at(-1).close},{open:parent.open,high:parent.high,low:parent.low,close:parent.close},'Finer candles do not reproduce the retained parent OHLC');
 fineInput={file:fineFile,sha256:hash(bytes),data:fine};
}
const results=[];
for(const name of ['original','review','later'])for(const frame of ['1H','1Dutc','1Wutc'])for(const selection of ['selected','alternate']){
 const archived=get(inputs[name],frame);
 if(selection==='alternate'&&!archived.alternatePlan)continue;
 const report=structuredClone(archived);
 if(selection==='alternate'){report.discretionaryPlan=report.alternatePlan;delete report.alternatePlan;delete report.scenario;}
 const before=JSON.stringify(report),plan=report.discretionaryPlan;
 assert(plan,`${name}:${frame}: missing priced plan`);
 const parsed=GlobalReportSchema.safeParse(archived);
 assert(parsed.success,`${name}:${frame}: invalid saved report: ${JSON.stringify(parsed.error?.issues?.slice(0,2))}`);
 assert.equal(report.snapshot.source,observation.source);assert.equal(report.snapshot.instId,observation.instId);assert.equal(report.snapshot.priceCurrency,observation.currency);
 const definition=report.scenario?.definition??globalScenarioDefinitionForReport(report);
 assert(definition,`${name}:${frame}: no saved execution policy`);
 const admission=globalSetupAdmission(report),sign=plan.side==='long'?1:-1;
 const capturedQuote=report.currentMarket?.quote?.price;
 const result={input:name,frame,selection,interpretation:name==='review'?'retrospective code review of the original snapshot; not a prospectively published trade':name==='later'?'deployed later capture; no post-publication path available in these inputs':'retained original source',observedAt:report.snapshot.observedAt,primaryFrame:plan.objectiveTimeframe,entryFrame:definition.eventTimeframe,side:plan.side,policy:definition.policyId,mode:definition.mode,entry:[...definition.entryZone],stop:definition.hardStop,stopBasis:plan.stopBasis,targets:structuredClone(definition.targets),admission:{geometryEligible:admission.geometryEligible,blockers:admission.blockers,firstObstacleRewardRisk:admission.firstObstacleRewardRisk},quoteAtCapture:capturedQuote,entryDistancePercent:capturedQuote?100*Math.abs(plan.entry-capturedQuote)/capturedQuote:null,stopDistancePercent:100*Math.abs(plan.entry-plan.stop)/plan.entry};
 if(through<=Math.max(definition.createdAt,report.scenario?.updatedAt??0)){result.replay={status:'no_later_completed_candles',through:new Date(through).toISOString()};results.push(result);continue}
 const relevant=observationBars.filter(bar=>candleCloseTime(bar.ts,'15m')>definition.createdAt);
 const gaps=relevant.flatMap((bar,index)=>index&&candleCloseTime(relevant[index-1].ts,'15m')!==bar.ts?[{before:relevant[index-1].ts,after:bar.ts}]:[]);
 const straddling=relevant.filter(bar=>bar.ts<definition.createdAt);
 const straddleCouldTouchEntry=straddling.some(bar=>bar.low<=definition.entryZone[1]&&bar.high>=definition.entryZone[0]);
 const missingStart=!relevant.length||relevant[0].ts>definition.createdAt;
 const integrity={gaps,missingStart,straddlingBars:straddling.map(bar=>({ts:bar.ts,closed:candleCloseTime(bar.ts,'15m'),couldTouchEntry:bar.low<=definition.entryZone[1]&&bar.high>=definition.entryZone[0]})),straddleCouldTouchEntry};
 const observationSource={...report,currentMarket:{source:observation.source,frames:[{timeframe:'15m',candles:observationBars}]}};
 let events=terminalPricePathEvents(observationSource,definition,through,observation.currency);
 if(fineInput){
  const fine=fineInput.data;
  events=events.filter(event=>event.candleTs<fine.window.start||event.candleTs>=fine.window.end);
  events.push(...terminalPricePathEvents({...observationSource,currentMarket:{source:observation.source,frames:[{timeframe:'1m',candles:fine.candles}]}},definition,through,observation.currency));
 }
 events.sort((a,b)=>a.at-b.at);
 // A broad publication-straddling candle never supplies an entry event.
 assert(events.every(event=>event.candleTs>=definition.createdAt&&event.at<=through));
 const initial=report.scenario??newGlobalScenario(definition);
 const scenario=advanceGlobalScenario(definition,initial,events,through);
 assert.deepEqual(scenario.definition,definition,'Replay rewrote the saved priced contract');
 if(scenario.entryObservedAt===undefined)assert.equal(scenario.exits.length,0,'A target was counted without an observed entry');
 const firstEntry=events.find(event=>event.kind==='entry_touch');
 const touchesBeforeDeadline=events.filter(event=>event.kind==='entry_touch'&&event.at<definition.expiresAt);
 const targetTouchesBeforeEntry=events.filter(event=>event.kind==='target_touch'&&(!firstEntry||event.at<firstEntry.at)).length;
 result.replay={status:gaps.length||missingStart||straddleCouldTouchEntry?'coverage_limited':'completed_candle_path',through:new Date(through).toISOString(),observationTimeframe:fineInput?'15m with one fully reconciled 1m window':'15m',integrity,entryTouchesBeforeExpiry:touchesBeforeDeadline.length,firstEntryTouch:firstEntry?new Date(firstEntry.at).toISOString():null,preEntryTargetTouches:targetTouchesBeforeEntry,state:scenario.state,reason:scenario.reason??null,entryObservedAt:scenario.entryObservedAt?new Date(scenario.entryObservedAt).toISOString():null,outcome:scenario.outcome??null,exits:scenario.exits,remainingFraction:scenario.remainingFraction,events:scenario.events};
 assert.equal(JSON.stringify(report),before,'Replay changed the input report');
 if(name==='review')assert.equal(plan.objectiveTimeframe,frame);
 assert(sign*(plan.entry-plan.stop)>0);
 results.push(result);
}
for(const input of Object.values(inputs))assert.equal(hash(input.file?fs.readFileSync(input.file):JSON.stringify(input.data)),input.sha256,'Saved input bytes changed');
if(fineInput)assert.equal(hash(fs.readFileSync(fineInput.file)),fineInput.sha256);
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'retrospective-reviews.json'),JSON.stringify(reviews));
assert.equal(networkCalls,0);
const proof={version:1,at:new Date().toISOString(),scope:'Bounded causal saved-report replay; no parameter search or performance qualification',inputs:Object.fromEntries(Object.entries(inputs).map(([name,input])=>[name,{file:input.file,sha256:input.sha256}])),observation,finerObservation:fineInput?{file:fineInput.file,sha256:fineInput.sha256,window:fineInput.data.window,parentOhlcReconciled:true}:null,networkCalls,modelCalls:0,payments:0,orders:0,sourceFilesUnchanged:true,results};
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(proof,null,2));
console.log(JSON.stringify({output:out,observation,results:results.map(result=>({input:result.input,frame:result.frame,selection:result.selection,side:result.side,entry:result.entry,stop:result.stop,geometryEligible:result.admission.geometryEligible,replay:result.replay.status,state:result.replay.state,firstEntryTouch:result.replay.firstEntryTouch,entryObservedAt:result.replay.entryObservedAt,outcome:result.replay.outcome}))}));
