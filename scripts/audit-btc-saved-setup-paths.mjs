/** Bounded saved-report correctness replay. It selects no new strategy,
 * changes no prices, and estimates no exchange fills or performance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {candleCloseTime,candleTimeframeMs,GlobalReportSchema} from '../packages/schemas/src/index.ts';
import {globalSetupAdmission} from '../packages/domain/src/globalSetupAdmission.ts';
import {advanceGlobalScenario,globalScenarioDefinitionForReport,newGlobalScenario} from '../packages/analysis/src/globalScenarioLifecycle.ts';
import {reviewGlobalTargetReport} from '../packages/analysis/src/globalTradeMap.ts';
import {terminalPricePathEvents} from '../apps/api/src/terminalPricePath.ts';

const option=(name,fallback)=>process.argv.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1)??fallback;
let networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw new Error('Saved-report replay prohibits network requests');};
const files={original:option('--original','.tmp/terminal-nine-qa/markets.json'),later:option('--later','.tmp/deployed-terminal-retest-20261118/deployed-markets.json')};
const out=path.resolve(option('--out','.tmp/btc-setup-path-audit-20261118'));
const pathFile=option('--path',null),pathFrame=option('--path-frame',null);
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
let pathInput=null;
if(pathFile){
 assert(pathFrame,'--path-frame is required with --path');
 const bytes=fs.readFileSync(pathFile),data=JSON.parse(bytes),duration=candleTimeframeMs(pathFrame);
 assert.equal(data.schema,'btc-saved-candle-path-v1','Saved candle path schema is invalid');
 assert.equal(data.source,observation.source);assert.equal(data.instId,observation.instId);assert.equal(data.priceCurrency,observation.currency);
 assert.equal(data.timeframe,pathFrame);assert(duration>0,'Selected replay frame is invalid');
 assert(Number.isFinite(data.capturedAt)&&data.capturedAt<=Date.now(),'Candle path capture time is invalid or in the future');
 assert(Array.isArray(data.requests)&&data.requests.length>=1&&data.requests.length<=8,'Candle path must retain one to eight public requests');
 const exchangeCandles=new Map();
 assert(data.requests.every(request=>{
  const url=new URL(request.url),valid=url.origin==='https://www.okx.com'&&url.pathname==='/api/v5/market/history-candles'&&url.searchParams.get('instId')==='BTC-USDT'&&url.searchParams.get('bar')===pathFrame&&request.status===200&&request.responseCode==='0'&&request.responseSha256===hash(request.rawResponse??'');
  if(!valid)return false;
  let body;try{body=JSON.parse(request.rawResponse)}catch{return false}
  if(body.code!=='0'||!Array.isArray(body.data))return false;
  for(const row of body.data){
   if(!Array.isArray(row)||row.length<9||row[8]!=='1')continue;
   const candle={ts:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5]),confirmed:true};
   if(![candle.ts,candle.open,candle.high,candle.low,candle.close,candle.volume].every(Number.isFinite))return false;
   const prior=exchangeCandles.get(candle.ts);if(prior)assert.deepEqual(candle,prior,'Overlapping exchange request copies disagree');else exchangeCandles.set(candle.ts,candle);
  }
  return true;
 }),'Candle request provenance or raw exchange response is invalid');
 assert.deepEqual({original:{sha256:data.sourceFiles?.original?.sha256},later:{sha256:data.sourceFiles?.later?.sha256}},{original:{sha256:inputs.original.sha256},later:{sha256:inputs.later.sha256}},'Candle path is bound to different frozen report files');
 assert(Array.isArray(data.candles)&&data.candles.length>0,'Candle path is empty');
 assert(data.window?.start===data.candles[0].ts&&data.window?.through===candleCloseTime(data.candles.at(-1).ts,pathFrame),'Candle path window does not match its bars');
 assert(data.window.through<=data.capturedAt,'Candle path contains a future or incomplete bar');
 assert(data.candles.every((bar,index)=>bar.confirmed&&bar.ts===data.window.start+index*duration&&candleCloseTime(bar.ts,pathFrame)<=data.capturedAt&&[bar.open,bar.high,bar.low,bar.close,bar.volume].every(n=>Number.isFinite(n))&&[bar.open,bar.high,bar.low,bar.close].every(n=>n>0)&&bar.high>=Math.max(bar.open,bar.close)&&bar.low<=Math.min(bar.open,bar.close)&&bar.high>=bar.low&&exchangeCandles.has(bar.ts)&&JSON.stringify(bar)===JSON.stringify(exchangeCandles.get(bar.ts))),'Candle path is unconfirmed, malformed, gapped, unproven or extends past capture time');
 const frozenContracts=['original','later'].flatMap(inputName=>['1Dutc','1Wutc'].map(frame=>{const report=get(inputs[inputName],frame),definition=report.scenario?.definition;assert(definition,`Frozen ${inputName}:${frame} scenario is missing`);assert.equal(definition.mode,'passive_limit');assert(candleTimeframeMs(definition.eventTimeframe)>duration,`${pathFrame} must be finer than the ${frame} event frame`);return{input:inputName,frame,scenarioId:definition.scenarioId,revisionId:definition.revisionId,createdAt:definition.createdAt,publishedAt:Date.parse(report.snapshot.observedAt),expiresAt:definition.expiresAt};}));
 assert.deepEqual(data.contracts,frozenContracts,'Candle path is not bound to the saved daily and weekly contracts');
 const firstPublicationBucket=Math.floor(Math.min(...frozenContracts.map(contract=>contract.publishedAt))/duration)*duration;
 assert(data.candles[0].ts<=firstPublicationBucket,'Candle path starts after the earliest frozen contract publication bucket');
 assert(frozenContracts.every(contract=>data.window.through>contract.publishedAt),'Candle path does not extend past every selected frozen contract publication');
 pathInput={file:pathFile,sha256:hash(bytes),data};
}
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
 const useSavedPath=Boolean(pathInput&&selection==='selected'&&['original','later'].includes(name)&&['1Dutc','1Wutc'].includes(frame));
 const result={input:name,frame,selection,interpretation:name==='review'?'retrospective code review of the original snapshot; not a prospectively published trade':useSavedPath?name==='later'?'frozen November 18 deployed contract with later public path':'frozen November 17 published contract with later public path':name==='later'?'deployed later capture; no post-publication path available in these inputs':'retained original source',observedAt:report.snapshot.observedAt,primaryFrame:plan.objectiveTimeframe,entryFrame:definition.eventTimeframe,side:plan.side,policy:definition.policyId,mode:definition.mode,entry:[...definition.entryZone],stop:definition.hardStop,stopBasis:plan.stopBasis,targets:structuredClone(definition.targets),admission:{geometryEligible:admission.geometryEligible,blockers:admission.blockers,firstObstacleRewardRisk:admission.firstObstacleRewardRisk},quoteAtCapture:capturedQuote,entryDistancePercent:capturedQuote?100*Math.abs(plan.entry-capturedQuote)/capturedQuote:null,stopDistancePercent:100*Math.abs(plan.entry-plan.stop)/plan.entry};
 const activeFrame=useSavedPath?pathFrame:'15m';
 const activeBars=useSavedPath?pathInput.data.candles:observationBars;
 const activeThrough=useSavedPath?pathInput.data.window.through:through;
 if(activeThrough<=Math.max(definition.createdAt,report.scenario?.updatedAt??0)){result.replay={status:'no_later_completed_candles',through:new Date(activeThrough).toISOString()};results.push(result);continue}
 const publicationCutoff=Math.max(definition.createdAt,report.scenario?.updatedAt??Date.parse(report.snapshot.observedAt));
 const activeDuration=candleTimeframeMs(activeFrame),expectedStart=Math.ceil(publicationCutoff/activeDuration)*activeDuration;
 const relevant=activeBars.filter(bar=>candleCloseTime(bar.ts,activeFrame)>publicationCutoff),eligibleBars=relevant.filter(bar=>bar.ts>=publicationCutoff);
 const gaps=eligibleBars.flatMap((bar,index)=>index&&candleCloseTime(eligibleBars[index-1].ts,activeFrame)!==bar.ts?[{before:eligibleBars[index-1].ts,after:bar.ts}]:[]);
 const straddling=relevant.filter(bar=>bar.ts<publicationCutoff);
 const straddleCouldTouchEntry=straddling.some(bar=>bar.low<=definition.entryZone[1]&&bar.high>=definition.entryZone[0]);
 const missingStart=!eligibleBars.length||eligibleBars[0].ts>expectedStart;
 const integrity={gaps,missingStart,straddlingBars:straddling.map(bar=>({ts:bar.ts,closed:candleCloseTime(bar.ts,activeFrame),couldTouchEntry:bar.low<=definition.entryZone[1]&&bar.high>=definition.entryZone[0]})),straddleCouldTouchEntry};
 const observationSource={...report,currentMarket:{source:observation.source,frames:[{timeframe:activeFrame,candles:eligibleBars}]}};
 let events=terminalPricePathEvents(observationSource,definition,activeThrough,observation.currency);
 if(fineInput&&!useSavedPath){
  const fine=fineInput.data;
  events=events.filter(event=>event.candleTs<fine.window.start||event.candleTs>=fine.window.end);
  events.push(...terminalPricePathEvents({...observationSource,currentMarket:{source:observation.source,frames:[{timeframe:'1m',candles:fine.candles}]}},definition,through,observation.currency));
 }
 events.sort((a,b)=>a.at-b.at);
 // A broad publication-straddling candle never supplies an entry event.
 assert(events.every(event=>event.candleTs>=publicationCutoff&&event.at<=activeThrough));
 const initial=report.scenario??newGlobalScenario(definition);
 const scenario=advanceGlobalScenario(definition,initial,events,activeThrough);
 assert.deepEqual(scenario.definition,definition,'Replay rewrote the saved priced contract');
 if(scenario.entryObservedAt===undefined)assert.equal(scenario.exits.length,0,'A target was counted without an observed entry');
 const firstEntry=events.find(event=>event.kind==='entry_touch'),entryObservedAt=report.scenario?.entryObservedAt??firstEntry?.at;
 const touchesBeforeDeadline=events.filter(event=>event.kind==='entry_touch'&&event.at<definition.expiresAt);
 const preEntryTargetEvents=events.filter(event=>event.kind==='target_touch'&&(entryObservedAt===undefined||event.at<entryObservedAt));
 result.replay={status:gaps.length||missingStart||straddleCouldTouchEntry?'coverage_limited':'completed_candle_path',through:new Date(activeThrough).toISOString(),observationTimeframe:useSavedPath?activeFrame:fineInput?'15m with one fully reconciled 1m window':'15m',integrity,entryTouchesBeforeExpiry:touchesBeforeDeadline.length,firstEntryTouch:entryObservedAt?new Date(entryObservedAt).toISOString():null,preEntryTargetTouches:preEntryTargetEvents.length,preEntryTargetIds:[...new Set(preEntryTargetEvents.map(event=>event.targetId))],state:scenario.state,reason:scenario.reason??null,entryObservedAt:scenario.entryObservedAt?new Date(scenario.entryObservedAt).toISOString():null,outcome:scenario.outcome??null,exits:scenario.exits,remainingFraction:scenario.remainingFraction,censoredAtCutoff:!['invalidated','expired','completed'].includes(scenario.state),events:scenario.events};
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
if(pathInput)assert.equal(hash(fs.readFileSync(pathInput.file)),pathInput.sha256);
const proof={version:1,at:new Date().toISOString(),scope:'Bounded causal saved-report replay; no parameter search or performance qualification',inputs:Object.fromEntries(Object.entries(inputs).map(([name,input])=>[name,{file:input.file,sha256:input.sha256}])),observation,finerObservation:fineInput?{file:fineInput.file,sha256:fineInput.data?hash(fs.readFileSync(fineInput.file)):null,window:fineInput.data.window,parentOhlcReconciled:true}:null,savedPath:pathInput?{file:pathInput.file,sha256:pathInput.sha256,capturedAt:pathInput.data.capturedAt,window:pathInput.data.window,timeframe:pathInput.data.timeframe,requests:pathInput.data.requests.length,contracts:pathInput.data.contracts}:null,networkCalls,modelCalls:0,payments:0,orders:0,sourceFilesUnchanged:true,results};
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(proof,null,2));
console.log(JSON.stringify({output:out,observation,results:results.map(result=>({input:result.input,frame:result.frame,selection:result.selection,side:result.side,entry:result.entry,stop:result.stop,geometryEligible:result.admission.geometryEligible,replay:result.replay.status,state:result.replay.state,firstEntryTouch:result.replay.firstEntryTouch,entryObservedAt:result.replay.entryObservedAt,outcome:result.replay.outcome}))}));
