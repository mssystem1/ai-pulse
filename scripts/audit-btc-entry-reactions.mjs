/** Offline incident regression, not a performance qualification or fill model. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {GlobalReportSchema,candleCloseTime} from '../packages/schemas/src/index.ts';
import {globalSetupAdmission} from '../packages/domain/src/globalSetupAdmission.ts';
import {applyGlobalDiscretionaryPlan} from '../packages/analysis/src/globalDiscretionaryPlan.ts';
import {globalScenarioDefinitionForReport,newGlobalScenario,advanceGlobalScenario} from '../packages/analysis/src/globalScenarioLifecycle.ts';
import {terminalPricePathEvents} from '../apps/api/src/terminalPricePath.ts';

globalThis.fetch=async()=>{throw new Error('Replay forbids network access');};
const option=(name,fallback)=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1)??fallback;
const hash=b=>createHash('sha256').update(b).digest('hex');
const parseArtifact=bytes=>JSON.parse(bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes);
const fixtureFile='packages/analysis/src/globalEntryReaction.fixture.json.gz';
const pathFile=option('--path','.tmp/btc-setup-path-audit-20261118/deployed-15m-through-now.json');
const minuteFile=option('--minutes','.tmp/btc-issue1-20261118/reaction-minutes.json');
const output=option('--out','.tmp/btc-issue1-20261118/reaction-replay.json');
const fixtureBytes=fs.readFileSync(fixtureFile),cases=parseArtifact(fixtureBytes);
const pathBytes=fs.readFileSync(pathFile),history=parseArtifact(pathBytes);
assert(['btc-saved-candle-path-v1','btc-nov6-frozen-contract-history-v1'].includes(history.schema));assert.equal(history.source,'okx-public-spot');assert.equal(history.instId,'BTC-USDT');assert.equal(history.timeframe,'15m');
assert(history.capturedAt<=Date.now()&&history.window.through<=history.capturedAt);
const normalize=r=>({ts:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],confirmed:r[8]==='1'});
function rawCandles(request,frame){
 const u=new URL(request.url);assert.equal(u.origin,'https://www.okx.com');assert.equal(u.pathname,'/api/v5/market/history-candles');
 assert.equal(u.searchParams.get('instId'),'BTC-USDT');assert.equal(u.searchParams.get('bar'),frame);assert.equal(request.status,200);assert.equal(request.responseCode,'0');
 assert.equal(hash(request.rawResponse),request.responseSha256);const body=JSON.parse(request.rawResponse);assert.equal(body.code,'0');return body.data.filter(r=>r[8]==='1').map(normalize);
}
const raw=new Map();
for(const request of history.requests)for(const c of rawCandles(request,'15m')){if(raw.has(c.ts))assert.deepEqual(raw.get(c.ts),c);raw.set(c.ts,c);}
assert.equal(history.candles[0].ts,history.window.start);assert.equal(history.candles.at(-1).ts+900000,history.window.through);
for(const [i,c] of history.candles.entries()){assert.deepEqual(c,raw.get(c.ts));assert.equal(c.ts,history.window.start+i*900000);assert(c.confirmed&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));}
const minuteBytes=fs.readFileSync(minuteFile),minuteData=parseArtifact(minuteBytes),refinements=new Map();
// The older November 6 refinement retained a parent hash, rather than its
// own capture clock. Keep that distinction explicit in this audit artifact.
const minuteCapturedAt=minuteData.capturedAt??history.capturedAt;
assert(Number.isFinite(minuteCapturedAt)&&minuteCapturedAt<=Date.now());
for(const sample of minuteData.results??[minuteData]){
 assert.equal(sample.source,history.source);assert.equal(sample.instId,history.instId);assert.equal(sample.timeframe,'1m');
 const original=new Map(rawCandles(sample.request,'1m').map(c=>[c.ts,c]));
 assert.equal(sample.candles.length,15);assert.equal(sample.window.end,sample.window.start+900000);
 for(const [i,c] of sample.candles.entries()){assert.deepEqual(c,original.get(c.ts));assert.equal(c.ts,sample.window.start+i*60000);assert(c.confirmed&&c.ts+60000<=minuteCapturedAt);}
 const parent=history.candles.find(c=>c.ts===sample.window.start);
 if(!parent){assert(sample.window.start<history.window.start||sample.window.start>=history.window.through,'Minute refinement inside the replay path lacks its parent');continue;}
 assert.deepEqual({open:sample.candles[0].open,high:Math.max(...sample.candles.map(c=>c.high)),low:Math.min(...sample.candles.map(c=>c.low)),close:sample.candles.at(-1).close},{open:parent.open,high:parent.high,low:parent.low,close:parent.close});
 refinements.set(parent.ts,sample.candles);
}
const results=[];
for(const input of cases.filter(c=>Date.parse(c.report.snapshot.observedAt)>=history.window.start&&Date.parse(c.report.snapshot.observedAt)<history.window.through))for(const revision of ['published','reaction-v1']){
 const r=structuredClone(input.report),before=JSON.stringify(input.report);
 assert.equal(r.snapshot.source,history.source);assert.equal(r.snapshot.instId,history.instId);assert.equal(r.snapshot.priceCurrency,history.priceCurrency);
 if(revision==='reaction-v1')applyGlobalDiscretionaryPlan(r);
 GlobalReportSchema.parse(r);
 for(const selection of ['selected','alternate']){
  if(selection==='alternate'&&!r.alternatePlan)continue;
  const report=structuredClone(r);
  if(selection==='alternate'){report.discretionaryPlan=report.alternatePlan;delete report.alternatePlan;delete report.scenario;}
  const p=report.discretionaryPlan,definition=report.scenario?.definition??globalScenarioDefinitionForReport(report);assert(p&&definition);
  const cutoff=Math.max(Date.parse(report.snapshot.observedAt),definition.createdAt,report.scenario?.updatedAt??0);
  const admission=globalSetupAdmission(report),events=[];
  const straddling=history.candles.filter(c=>c.ts<cutoff&&c.ts+900000>cutoff);
  const publicationWindows=straddling.map(parent=>{
   const minutes=refinements.get(parent.ts);
   const minuteStraddles=(minutes??[]).filter(c=>c.ts<cutoff&&c.ts+60000>cutoff);
   return {parentTs:parent.ts,refined:Boolean(minutes),parentIntersectsEntry:parent.low<=definition.entryZone[1]&&parent.high>=definition.entryZone[0],minuteStraddles:minuteStraddles.map(c=>({ts:c.ts,intersectsEntry:c.low<=definition.entryZone[1]&&c.high>=definition.entryZone[0]}))};
  });
  const unresolvedEntryInterval=publicationWindows.some(w=>!w.refined&&w.parentIntersectsEntry)||publicationWindows.some(w=>w.minuteStraddles.some(m=>m.intersectsEntry));
  const unrefinedCouldContainEntry=publicationWindows.some(w=>!w.refined&&w.parentIntersectsEntry);
  for(const frame of ['15m','1m']){
   const bars=history.candles.flatMap(c=>refinements.has(c.ts)?frame==='1m'?refinements.get(c.ts):[]:frame==='15m'?[c]:[]).filter(c=>c.ts>=cutoff);
   if(bars.length)events.push(...terminalPricePathEvents({...report,currentMarket:{source:history.source,frames:[{timeframe:frame,candles:bars}]}},definition,history.window.through,'USDT'));
  }
  assert(events.every(e=>e.candleTs>=cutoff&&e.at<=history.window.through));
  const state=advanceGlobalScenario(definition,report.scenario??newGlobalScenario(definition),events,history.window.through);
  assert.deepEqual(state.definition,definition);if(!state.entryObservedAt)assert.equal(state.exits.length,0);
  const sign=p.side==='long'?1:-1,risk=Math.abs(p.entry-p.stop);
  results.push({snapshot:input.name,frame:input.frame,revision,selection,interpretation:revision==='reaction-v1'?'Retrospective fixed-rule candidate, never published or traded':'Frozen published report',sourceObservedAt:report.snapshot.observedAt,
   policy:definition.policyId,side:p.side,entry:definition.entryZone,stop:p.stop,stopTimeframe:p.stopBasis.timeframe,stopDistancePercent:risk/p.entry*100,
   entryDistancePercent:report.currentMarket?.quote?Math.abs(p.entry/report.currentMarket.quote.price-1)*100:null,targets:definition.targets,admission:{eligible:admission.allowed,blockers:admission.blockers,nearestR:admission.firstObstacleRewardRisk},
   plannedWeightedR:definition.targets.reduce((sum,t)=>sum+t.allocation*sign*((p.side==='long'?t.lower:t.upper)-p.entry)/risk,0),
   through:new Date(history.window.through).toISOString(),publicationWindows,coverage:publicationWindows.some(w=>w.minuteStraddles.some(m=>m.intersectsEntry))?'A publication-straddling 1m interval intersects the entry and remains unresolved':unrefinedCouldContainEntry?'An unrefined publication-straddling 15m interval could contain entry':publicationWindows.some(w=>!w.refined)?'The unrefined publication-straddling 15m range excludes entry; later path uses reconciled 15m and 1m windows':publicationWindows.length?'The publication-straddling interval is refined to 1m and excludes entry; later path uses reconciled 15m and 1m windows':'No publication-straddling candle; later path uses reconciled 15m and 1m windows',
   firstEntryTouch:state.entryObservedAt?new Date(state.entryObservedAt).toISOString():null,state:state.state,outcome:state.outcome??null,exits:state.exits,remainingFraction:state.remainingFraction,events:state.events});
 }
 assert.equal(JSON.stringify(input.report),before);
}
const proof={version:1,scope:'Causal source/price-path regression; no optimization, order-fill, profitability or prospective validation claim',inputs:{fixture:{file:fixtureFile,sha256:hash(fixtureBytes)},path:{file:pathFile,sha256:hash(pathBytes)},minutes:{file:minuteFile,sha256:hash(minuteBytes),captureClock:minuteData.capturedAt?'own':'legacy parent path bound'}},networkCalls:0,orders:0,payments:0,results};
assert(results.length>0,'No frozen publication falls within this price path');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(proof,null,2));
console.log(JSON.stringify({output,results:results.map(({events,targets,...r})=>r)}));
