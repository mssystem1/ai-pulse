/** Five current BTC Pro reports, paid with TEST_WALLET_ADDRESS on Arbitrum.
 * No flags: describe the bounded matrix, without loading a wallet or networking.
 * --execute: buy missing reports, at most 5 x 0.30 native USDC.
 * --recover: retrieve accepted jobs only; never create a new authorization.
 * --audit-only: inspect saved deliveries, without networking or wallet access.
 * The journal is private. An ambiguous signed request must be reconciled before
 * another checkout; rerunning never silently replaces it with a fresh payment.
 */
import assert from 'node:assert/strict';
import {reviewPrimaryObstacleCoverage} from './audit-current-btc-obstacles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {config} from 'dotenv';
import {createPublicClient, http, erc20Abi, decodeEventLog} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {createPaidFetch} from '../packages/buyer/dist/index.js';
import {getNetwork} from '../packages/config/dist/index.js';
import {GlobalReportSchema, candleCloseTime} from '../packages/schemas/dist/index.js';
import {globalTradeCards, globalDecision, globalReportChartSvg, presentResearch, researchText} from '../packages/domain/dist/index.js';
import {renderTelegramResearchChart, formatTelegramResearch, telegramResearchCaption, telegramResearchMessage} from '../apps/api/dist/telegramResearch.js';

const sensitiveValues=new Set();
function safeError(error){let text=String(error?.shortMessage||error?.message||error);for(const [name,value]of Object.entries(process.env))if(value&&/KEY|TOKEN|PASSWORD|SECRET|_RPC_URL|PAY_TO_ADDRESS|TEST_WALLET_ADDRESS/.test(name))text=text.replaceAll(value,'[redacted]');for(const value of sensitiveValues)if(value)text=text.replaceAll(value,'[redacted]');return text.replace(/https?:\/\/[^\s]+/g,'[URL]').replace(/0x[0-9a-f]{128,}/gi,'[redacted]').replace(/[A-Za-z0-9+_\/=-]{80,}/g,'[redacted]');}
const fatal=error=>{console.error(JSON.stringify({stage:'stopped',error:safeError(error),instruction:'Inspect the private journal and recover accepted jobs; do not replace an ambiguous signed request with a new payment.'}));process.exit(1);};process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
const frames=['15m','1H','4H','1Dutc','1Wutc'];
const hierarchy={'15m':['5m','1H'],'1H':['15m','4H'],'4H':['1H','1Dutc'],'1Dutc':['4H','1Wutc'],'1Wutc':['1Dutc','1Mutc']};
const valueOf=(name,fallback)=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1)??fallback;
const trustedOrigins=['https://pulse-api-production-7aae.up.railway.app','https://www.ai-pulse.tech','https://app.ai-pulse.tech'];
const origin=new URL(valueOf('--origin',trustedOrigins[0])).origin;
assert.ok(trustedOrigins.includes(origin),'Origin must be an existing PULSE deployment');
const root=path.resolve(valueOf('--root','.tmp/btc-arbitrum-current-2026-10-28'));
assert.ok(root.startsWith(path.resolve('.tmp')+path.sep),'Audit output must stay inside .tmp');
const execute=process.argv.includes('--execute'),recover=process.argv.includes('--recover'),offline=process.argv.includes('--audit-only');
assert.ok(Number(execute)+Number(recover)+Number(offline)<=1,'Choose exactly one execution mode');
const price=300000n, total=price*BigInt(frames.length), network=getNetwork('arbitrum');
assert.equal(network.chainId,42161);assert.equal(network.paymentAsset.address.toLowerCase(),'0xaf88d065e77c8cc2239327c5edb3a432268e5831');
if(!execute&&!recover&&!offline){console.log(JSON.stringify({mode:'dry-run',origin,network:'Arbitrum One',chainId:42161,asset:'native USDC',frames,maximumReports:5,maximumPaymentPerReport:0.30,maximumTotalPayment:1.50,output:root,networkCalls:0,walletAccess:false}));process.exit(0);}
fs.mkdirSync(path.join(root,'private'),{recursive:true});fs.mkdirSync(path.join(root,'deliverables'),{recursive:true});
const journalFile=f=>path.join(root,'private',f+'.json'),deliveryFile=f=>path.join(root,'private',f+'-delivery.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const save=(file,value)=>{const temp=file+'.'+process.pid+'.tmp';for(let i=0;;i++)try{fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);return;}catch(e){if(i===5)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}};
const states=new Map(frames.map(f=>[f,fs.existsSync(journalFile(f))?read(journalFile(f)):{frame:f,origin,business:{instId:'BTC-USDT',timeframe:f,lang:'en'}}]));
for(const [frame,state]of states){sensitiveValues.add(state.signature);sensitiveValues.add(state.accepted?.recoveryToken);assert.equal(state.origin,origin);assert.deepEqual(state.business,{instId:'BTC-USDT',timeframe:frame,lang:'en'});}
const localRendererHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const results=[];
const persist=()=>save(path.join(root,'audit.json'),{checkedAt:new Date().toISOString(),origin,network:'Arbitrum One',chainId:42161,asset:'native USDC',maximumTotalPayment:1.50,localRendererHead,originalDelivery:'private/{frame}-delivery.json is unchanged server output; deliverables/*.local-render.* use the current local renderer, without strategy recalculation.',mode:offline?'offline':recover?'recover':'execute',results,scope:'Software, source chronology and setup-evidence audit; no strategy backtest or independently verified win-rate claim.'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(url,headers={}){const canonical=new URL(url,origin);assert.ok(trustedOrigins.includes(canonical.origin),'Recovery URL must name a trusted PULSE deployment');const target=new URL(canonical.pathname+canonical.search,origin);for(let i=0;;i++)try{return await fetch(target,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});}catch(e){if(i===1)throw e;}}
let wallet,key,merchant,client;
if(!offline){
  config({path:'.env',quiet:true});wallet=process.env.TEST_WALLET_ADDRESS;key=process.env.TEST_WALLET_PRIVATE_KEY;merchant=process.env.PAY_TO_ADDRESS;
  assert.match(wallet||'',/^0x[\da-f]{40}$/i,'Test wallet missing');assert.ok(/^0x[\da-f]{64}$/i.test(key||''),'Test signer missing');assert.match(merchant||'',/^0x(?!0{40}$)[\da-f]{40}$/i,'Configured merchant missing');
  assert.equal(privateKeyToAccount(key).address.toLowerCase(),wallet.toLowerCase(),'Signer must match the authorized test wallet');
  client=createPublicClient({transport:http(process.env.ARBITRUM_RPC_URL||network.rpcUrls[0],{timeout:20000,retryCount:0})});assert.equal(await client.getChainId(),42161);
  const metaResponse=await get('/v1/metadata');assert.equal(metaResponse.status,200,'Published metadata unavailable');const metadata=await metaResponse.json();assert.equal(metadata.asp?.payTo?.toLowerCase(),merchant.toLowerCase(),'Published recipient must match the configured merchant');
  const health=await get('/healthz');assert.equal(health.status,200);assert.equal((await health.json()).mockPayments,false,'Mock payment mode cannot certify paid delivery');
  const exchangeResponse=await fetch('https://www.okx.com/api/v5/public/time',{signal:AbortSignal.timeout(20000)});assert.equal(exchangeResponse.status,200,'Independent venue clock unavailable');const exchangeClock=await exchangeResponse.json(),exchangeTs=Number(exchangeClock.data?.[0]?.ts);assert.equal(exchangeClock.code,'0');assert.ok(Number.isFinite(exchangeTs)&&Math.abs(exchangeTs-Date.now())<=120000,'Local and venue clocks differ materially; reconcile before signing');save(path.join(root,'private','exchange-clock.json'),{receivedAt:new Date().toISOString(),source:'https://www.okx.com/api/v5/public/time',response:exchangeClock});
  const missing=frames.filter(f=>!states.get(f).accepted);
  // Recover accepted jobs even if another frame never reached acceptance.
  const balance=await client.readContract({address:network.paymentAsset.address,abi:erc20Abi,functionName:'balanceOf',args:[wallet]});assert.ok(balance>=(execute?price*BigInt(missing.length):0n),'Insufficient native-USDC balance for the bounded remaining matrix');
  assert.ok(total===1500000n);
  for(const frame of frames){
    const state=states.get(frame);if(state.accepted||recover)continue;assert.ok(execute,'New purchase requires execute mode');assert.ok(!state.signature,'Unresolved signed request: reconcile the existing authorization and payment before retrying');
    const url=origin+'/arbitrum/v1/analysis/spot/premium',body=JSON.stringify(state.business);let signed=0;
    const guardedFetch=async(input,init)=>{
      const request=new Request(input,init);assert.equal(request.url,url);assert.equal(request.method,'POST');assert.deepEqual(await request.clone().json(),state.business);
      const signature=request.headers.get('payment-signature')||request.headers.get('x-payment');
      if(signature){assert.equal(++signed,1,'Only one signed send is allowed per frame');state.signature=signature;sensitiveValues.add(signature);state.submittedAt=new Date().toISOString();save(journalFile(frame),state);}
      const response=await fetch(request,{redirect:'error',signal:AbortSignal.timeout(signature?120000:45000)});
      if(signature){state.httpStatus=response.status;state.response=await response.clone().json().catch(()=>null);sensitiveValues.add(state.response?.recoveryToken);state.receiptHeader=response.headers.get('payment-response');if(response.status===202&&state.response?.job?.id&&state.response.recoveryToken)state.accepted=state.response;save(journalFile(frame),state);}
      if(response.status===402&&!signature){const encoded=response.headers.get('payment-required');assert.ok(encoded,'Payment terms missing');const challenge=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),a=challenge.accepts?.[0];assert.equal(challenge.x402Version,2);assert.equal(challenge.accepts.length,1);assert.equal(challenge.resource.url,url);assert.equal(a.scheme,'exact');assert.equal(a.network,'eip155:42161');assert.equal(a.asset.toLowerCase(),network.paymentAsset.address.toLowerCase());assert.equal(a.payTo.toLowerCase(),merchant.toLowerCase());assert.equal(a.amount,String(price));state.challenge=challenge;save(journalFile(frame),state);}
      return response;
    };
    const paid=createPaidFetch({privateKey:key,rpcUrl:process.env.ARBITRUM_RPC_URL||network.rpcUrls[0],network:network.caip2,expectedPayTo:merchant,maxPaymentUsd:.30,fetchImpl:guardedFetch});
    await paid(url,{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(state.httpStatus,202,'Checkout did not accept a recoverable report job');assert.ok(state.accepted?.job?.id&&state.accepted.recoveryToken&&state.receiptHeader,'Accepted job or receipt missing');
    console.log(JSON.stringify({frame,stage:'paid_job_accepted',paidUSDC:.30}));
  }
}

async function retrieve(frame,state){
  assert.ok(state.accepted?.job?.id&&state.accepted.recoveryToken,'Saved job recovery authority missing');
  const receipt=JSON.parse(Buffer.from(state.receiptHeader,'base64').toString('utf8'));assert.equal(receipt.success,true);assert.equal(receipt.network,'eip155:42161');assert.match(receipt.transaction||'',/^0x[\da-f]{64}$/i);
  if(!fs.existsSync(deliveryFile(frame))){
    const headers={'PULSE-RECOVERY-TOKEN':state.accepted.recoveryToken};let stage;
    for(let i=0;i<240;i++){
      const response=await get(state.accepted.pollUrl,headers);if(response.status===503){await pause(2500);continue;}assert.equal(response.status,200,'Recoverable job cannot be read');state.job=(await response.json()).job;save(journalFile(frame),state);
      if(state.job.stage!==stage){stage=state.job.stage;console.log(JSON.stringify({frame,stage}));}
      if(['completed','completed_partial'].includes(stage))break;
      assert.ok(!['failed_retriable','failed_terminal','manual_reconciliation'].includes(stage),'Existing paid job needs free recovery; do not pay again');await pause(2500);
    }
    assert.ok(['completed','completed_partial'].includes(state.job?.stage),'Deadline exceeded: recover the same paid job without another payment');
    const response=await get(state.accepted.reportUrl,headers);assert.equal(response.status,200,'Paid delivery cannot be read');assert.equal(response.headers.get('payment-required'),null,'Report recovery unexpectedly requests payment');const delivery=await response.json();save(deliveryFile(frame),delivery);state.retrievedAt=new Date().toISOString();save(journalFile(frame),state);
    const reopened=await get(state.accepted.reportUrl,headers);assert.equal(reopened.status,200);assert.deepEqual((await reopened.json()).report.global,delivery.report.global,'Reopening mutated the paid snapshot');assert.equal((await get(state.accepted.reportUrl)).status,403,'Unauthorized report access must be rejected');state.reopenedFree=true;save(journalFile(frame),state);
  }
  if(!state.transferVerified){const mined=await client.waitForTransactionReceipt({hash:receipt.transaction,timeout:60000});assert.equal(mined.status,'success');assert.ok(mined.logs.some(log=>{if(log.address.toLowerCase()!==network.paymentAsset.address.toLowerCase())return false;try{const d=decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics});return d.eventName==='Transfer'&&d.args.from.toLowerCase()===wallet.toLowerCase()&&d.args.to.toLowerCase()===merchant.toLowerCase()&&d.args.value===price;}catch{return false;}}),'Exact 0.30 native-USDC transfer missing');state.transferVerified=true;save(journalFile(frame),state);}
}

function audit(frame,delivery,state){
  const report=delivery.report,raw=report?.global,findings=[],warnings=[];
  const check=(ok,message)=>{if(!ok)findings.push(message);};const parsed=GlobalReportSchema.safeParse(raw);
  if(!parsed.success)return{frame,ok:false,findings:parsed.error.issues.map(i=>i.path.join('.')+': '+i.message),warnings};
  const g=parsed.data,cutoff=Date.parse(g.snapshot.observedAt),[entryFrame,contextFrame]=hierarchy[frame],p=g.discretionaryPlan;
  check(g.snapshot.instId==='BTC-USDT'&&g.tier==='pro'&&g.snapshot.timeframe===frame,'Wrong instrument, report tier or analysis timeframe');
  check(g.strategy?.entryTimeframe===entryFrame&&g.entryStudy?.timeframe===entryFrame,'Entry timeframe does not match the documented horizon');check(g.entryStudy?.status==='available'&&g.entryStudy.candles.length>=55,'Current report lacks available lower-frame entry evidence');check(g.context.timeframe===contextFrame&&g.context.status==='available','Required higher-frame context missing');
  check(g.snapshot.source==='okx-public-spot','Unexpected source; audit source identity before certifying');
  check(Number.isFinite(cutoff)&&g.candles.length>=55,'Primary history or snapshot time missing');
  for(const source of [{timeframe:frame,candles:g.candles},g.entryStudy,{timeframe:g.context.timeframe,candles:g.context.candles},...(g.currentMarket?.frames??[])].filter(Boolean)){
    check(source.candles.every((c,i)=>c.confirmed&&(candleCloseTime(c.ts,source.timeframe)??Infinity)<=cutoff&&(i===0||c.ts>source.candles[i-1].ts)),'Uncompleted, future or unordered candles on '+source.timeframe);
    const last=source.candles.at(-1);if(last){const end=candleCloseTime(last.ts,source.timeframe),next=end&&candleCloseTime(end,source.timeframe);check(next!==null&&cutoff<=next+60000,'Stale last completed candle on '+source.timeframe);}
  }
  if(g.candles.length<520)warnings.push('Provider retained '+g.candles.length+'/520 primary candles; distinguish listing-history limits from staleness');
  if(state.submittedAt)check(cutoff>=Date.parse(state.submittedAt)-120000,'Paid request returned a source snapshot older than the current checkout');if(state.retrievedAt)check(cutoff<=Date.parse(state.retrievedAt)+5000,'Source snapshot occurs after delivery');
  const quote=g.currentMarket?.quote;check(Boolean(quote),'A timestamped current quote is required for the current-market audit');if(quote)check(cutoff-quote.ts<=120000&&quote.ts<=cutoff+5000,'Current quote is stale or future-dated');
  if(report.generatedAt)check(Math.abs(Date.parse(report.generatedAt)-cutoff)<15*60000,'Generation and source snapshot are separated by more than 15 minutes');
  if(!g.orderFlow)warnings.push('No executed-order-flow payload retained; footprint, order-book and liquidation confirmation cannot be claimed');else if(cutoff-g.orderFlow.coverage.end>86400000)warnings.push('Executed-order-flow coverage ends more than one day before this snapshot; it is historical context, not current entry confirmation');
  check(Boolean(g.horizonContext&&g.indicators.vwap?.bands?.length),'Frame-specific ranges/zones or anchored VWAP bands missing');check(Boolean(p),'Concrete conditional Entry/SL/TP scenario missing');
  if(p){
    const sign=p.side==='long'?1:-1,z=p.priceZones,entry=z?(sign===1?z.entry.upper:z.entry.lower):p.entry,stop=p.stop,first=z?(sign===1?z.targets[0].lower:z.targets[0].upper):p.targets[0]?.price;
    check(p.objectiveTimeframe===frame&&[frame,entryFrame].includes(p.entryBasis.timeframe)&&p.targets.every(t=>t.timeframe===frame),'Entry/target horizon borrowed from another report');
    check(p.reference.timeframe===entryFrame,'Execution reference uses the wrong lower timeframe');check(p.stopBasis.knownAt<=cutoff&&p.entryBasis.knownAt<=cutoff&&p.targets.every(t=>t.knownAt<=cutoff),'Entry, invalidation or objectives contain future evidence');
    check(sign*(entry-stop)>0&&sign*(first-entry)>0,'Stop or first target lies on the wrong side of the least favorable entry');check(p.targets.every((t,i)=>i===0||sign*(t.price-p.targets[i-1].price)>0),'Targets are not ordered');
    check(Boolean(z),'Price ranges are missing for Entry, SL or targets');if(z){check(z.entry.lower<=z.entry.upper&&z.stop.lower<=z.stop.upper&&z.targets.every(t=>t.lower<=t.upper),'Price range is inverted');check(sign===1?stop===z.stop.lower:stop===z.stop.upper,'Hard SL differs from the outer protective boundary');}
    check((p.requiresNewTestAfter??0)>=cutoff,'Scenario does not explicitly require a fresh reaction after the snapshot');
    const rr=sign*(first-entry)/Math.abs(entry-stop);if(rr<1)warnings.push('First target offers '+rr.toFixed(2)+'R at the least favorable entry; does not establish a favorable payoff');
    const nearest=p.barriers.filter(b=>sign*(b.price-entry)>0).sort((a,b)=>sign*(a.price-b.price))[0];if(nearest){const barrierRR=sign*(nearest.price-entry)/Math.abs(entry-stop);if(barrierRR<1)warnings.push('Nearest retained obstacle offers '+barrierRR.toFixed(2)+'R; do not conceal it behind a distant target');}
    if(p.stopBasis.knownAt<cutoff-90*86400000)warnings.push('Protection anchor is more than 90 days old; review whether the chosen horizon still justifies it');
  }
  const primaryObstacleReview=reviewPrimaryObstacleCoverage(g);findings.push(...primaryObstacleReview.findings);warnings.push(...primaryObstacleReview.warnings);
  const cards=globalTradeCards(g),decision=globalDecision(g),txt=researchText(presentResearch(report)),telegram=formatTelegramResearch(report),message=telegramResearchMessage(report),caption=telegramResearchCaption(report),svg=globalReportChartSvg(g),png=renderTelegramResearchChart(report);
  check(txt===telegram,'Text download and Telegram report differ');check(caption.length<=1024&&message.length<=3900,'Telegram text limit exceeded');check(svg&&!/NaN|Infinity/.test(svg)&&png?.length>10000,'Chart does not render correctly');check(cards.length>0,'Concrete setup card missing');
  check(!/#[0-9a-f]{8}\b/i.test(svg),'Internal report code leaked onto the chart');check(!/No validated entry/i.test(svg),'Obsolete no-entry wording remains on chart');
  for(const card of cards){check(txt.includes(card.entry)&&txt.includes(card.stop),'Local TXT Entry/SL differs from displayed setup');check(txt.includes(card.condition),'Local TXT omits the displayed entry condition');}
  const originalMarkdown=typeof delivery.reportMarkdown==='string'?delivery.reportMarkdown.replace(/\*\*|__/g,''):'';
  if(originalMarkdown.trim())for(const card of cards){check(originalMarkdown.includes(card.entry)&&originalMarkdown.includes(card.stop),'Original server Markdown Entry/SL differs from its saved canonical setup');check(originalMarkdown.includes(card.condition),'Original server Markdown omits or contradicts the canonical entry condition');check(card.side==='long'?/\bLONG\b|\bBUY\b|做多|买入/.test(originalMarkdown):/\bSHORT\b|\bSELL\b|做空|卖出/.test(originalMarkdown),'Original server Markdown omits the canonical setup direction');}else warnings.push('Original server Markdown is absent; original text equivalence cannot be certified');
  const dir=path.join(root,'deliverables');for(const [ext,value]of[['original-report.json',JSON.stringify(report,null,2)],['local-render.txt',txt],['original-report.md',delivery.reportMarkdown||''],['local-render.svg',svg],['local-render.png',png]])if(value)fs.writeFileSync(path.join(dir,frame+'.'+ext),value);
  const originalArtifacts={png:false,svg:false};
  const suppliedPng=delivery.chartImageBase64??report.chartImageBase64;
  if(typeof suppliedPng==='string'){const bytes=Buffer.from(suppliedPng.replace(/^data:image\/png;base64,/,''),'base64');if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){fs.writeFileSync(path.join(dir,frame+'.original-server.png'),bytes);originalArtifacts.png=true;}}
  const suppliedSvg=delivery.chartSvg??report.chartSvg??report.chart?.svg;
  if(typeof suppliedSvg==='string'&&/<svg[ >]/.test(suppliedSvg)){fs.writeFileSync(path.join(dir,frame+'.original-server.svg'),suppliedSvg);originalArtifacts.svg=true;}
  return{frame,ok:findings.length===0,findings,warnings,primaryObstacleReview,originalArtifacts,versions:{report:g.version,decision:g.decisionVersion,selector:g.setupSelection?.version,strategy:g.strategy?.version,tradePlan:g.tradePlan?.method,discretionaryPlan:p?.version},localRendererHead,retrievedAt:state.retrievedAt,observedAt:g.snapshot.observedAt,snapshotAgeAtAuditMs:Date.now()-cutoff,generatedAt:report.generatedAt,quote,primaryCandles:g.candles.length,primaryCompletedAt:g.snapshot.lastCandleTs===null?null:candleCloseTime(g.snapshot.lastCandleTs,frame),entryFrame,contextFrame,bias:decision.direction,primaryAssessment:g.setupSelection?.assessment,scenarioSide:p?.side,action:decision.currentAction,regime:g.setupSelection?.regime,entryConditions:cards.map(c=>c.condition),directionEvidence:g.setupSelection?.evidence,limitations:g.setupSelection?.limitations,scenario:p,transferVerified:state.transferVerified===true,reopenedFree:state.reopenedFree===true};
}
for(const frame of frames){
  const state=states.get(frame);
  try{if(!offline)await retrieve(frame,state);assert.ok(fs.existsSync(deliveryFile(frame)),'Saved delivery missing');const result=audit(frame,read(deliveryFile(frame)),state);results.push(result);console.log(JSON.stringify({frame,stage:'audited',ok:result.ok,findings:result.findings,warnings:result.warnings}));}
  catch(error){const text=safeError(error);results.push({frame,ok:false,findings:[text],warnings:[],acceptedJob:Boolean(state.accepted),signedRequestPending:Boolean(state.signature&&!state.accepted)});console.log(JSON.stringify({frame,stage:'requires_review',error:text}));}
  persist();
}
console.log(JSON.stringify({reports:results.length,passed:results.filter(r=>r.ok).length,output:root,maximumUSDC:1.50,backtests:0,liveOrders:0}));process.exitCode=results.some(r=>!r.ok)?1:0;
