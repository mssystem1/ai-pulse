/** Four bounded BTC Pro purchases against the updated local API.
 * Defaults to quotes only. --network base|xlayer; --execute is bounded to four
 * 0.30 payments in that network's settlement asset (1.20 total).
 * Accepted jobs and authorizations remain in gitignored .tmp; reruns recover
 * accepted jobs without paying again. --render-only audits saved deliveries.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createPublicClient, http, erc20Abi, decodeEventLog, formatUnits} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {loadConfig, getNetwork} from '../packages/config/dist/index.js';
import {GlobalReportSchema, candleCloseTime} from '../packages/schemas/dist/index.js';
import {globalArtifactTag, globalArtifactReference, globalTradeCards, globalDecision,
  globalReportChartSvg, presentResearch, researchText} from '../packages/domain/dist/index.js';
import {formatTelegramResearch, telegramResearchMessage, telegramResearchCaption,
  renderTelegramResearchChart} from '../apps/api/dist/telegramResearch.js';
import {fullReportDelivery} from '../apps/api/dist/reportDelivery.js';
import {reviewGlobalTargetReport,globalCompatibility} from '../packages/analysis/dist/index.js';

const cfg=loadConfig(), frames=['1H','4H','1D','1W'];
const networkArg=process.argv.indexOf('--network'),network=networkArg<0?'base':process.argv[networkArg+1];
assert.ok(['base','xlayer'].includes(network),'Only the authorized Base/X Layer test matrices are supported');
const root=`.tmp/global-${network}-audit-2026-10-18`, origin=cfg.BASE_URL.replace(/\/$/,'');
const recover=process.argv.includes('--recover');
const technicalReview=process.argv.includes('--technical-review');
const execute=process.argv.includes('--execute')||recover, renderOnly=process.argv.includes('--render-only')||technicalReview;
assert.ok(!(technicalReview&&execute),'Technical reviews are offline; do not combine them with payment flags');
const artifactRoot=`${root}/${technicalReview?'reviewed-deliverables':'deliverables'}`;
const wallet=process.env.TEST_WALLET_ADDRESS, key=process.env.TEST_WALLET_PRIVATE_KEY;
const net=getNetwork(network), price=300000n, results=[];
const cli=process.env.ONCHAINOS_EXECUTABLE || `${process.env.USERPROFILE}/.local/bin/onchainos.exe`;
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
assert.equal(cfg.X402_MOCK,false);
assert.match(wallet||'',/^0x[\da-f]{40}$/i);
assert.equal(privateKeyToAccount(key).address.toLowerCase(),wallet.toLowerCase());
fs.mkdirSync(`${root}/private`,{recursive:true}); fs.mkdirSync(artifactRoot,{recursive:true});
const client=createPublicClient({transport:http((network==='base'?process.env.BASE_RPC_URL:process.env.XLAYER_RPC_URL)||net.rpcUrls[0],{timeout:20000,retryCount:0})});
const persist=()=>fs.writeFileSync(`${root}/${technicalReview?'reviewed-results':'results'}.json`,JSON.stringify({checkedAt:new Date().toISOString(),origin,technicalReview,networkCalls:renderOnly?0:undefined,modelCalls:0,newPayments:renderOnly?0:undefined,
  wallet,network:net.label,chainId:net.chainId,asset:net.paymentAsset.symbol,maximumSettlementAmount:1.2,results},null,2));
const states=new Map();
const fileFor=frame=>`${root}/private/${frame}.json`;
// Windows scanners/readers can briefly lock a file. Publish a complete journal
// atomically, and tolerate a short sharing violation without losing a paid job.
const save=(frame,state)=>{
  const target=fileFor(frame),temp=target+`.${process.pid}.tmp`;
  for(let attempt=0;;attempt++)try{
    fs.writeFileSync(temp,JSON.stringify(state,null,2));fs.renameSync(temp,target);return;
  }catch(error){if(attempt===5)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}
};
const get=async(url,headers={})=>{
  for(let attempt=0;;attempt++)try{return await fetch(url,{headers,signal:AbortSignal.timeout(30000)});}
  catch(error){if(attempt===1)throw error;}
};

if(!renderOnly){
  assert.equal(await client.getChainId(),net.chainId);
  const health=await(await get(origin+'/healthz')).json(); assert.equal(health.mockPayments,false);
  const meta=await(await get(origin+'/v1/meta')).json();
  assert.equal(meta.routes.find(r=>r.route==='POST /v1/analysis/spot/premium').priceUsd,.3);
  const balance=await client.readContract({address:net.paymentAsset.address,abi:erc20Abi,functionName:'balanceOf',args:[wallet]});
  const remaining=frames.filter(frame=>!fs.existsSync(fileFor(frame))||!JSON.parse(fs.readFileSync(fileFor(frame),'utf8')).accepted).length;
  if(recover)assert.equal(remaining,0,'--recover requires four accepted jobs and never makes new purchases');
  assert.ok(balance>=BigInt(remaining)*price,'Insufficient balance for remaining reports');
  console.log(JSON.stringify({network:net.label,wallet,balance:formatUnits(balance,6),asset:net.paymentAsset.symbol,reports:frames,maximumSettlementAmount:1.2,execute}));

  for(const frame of frames){
    const url=origin+`/${network}/v1/analysis/spot/premium`, business={instId:'BTC-USDT',timeframe:frame,lang:'en'};
    const state=fs.existsSync(fileFor(frame))?JSON.parse(fs.readFileSync(fileFor(frame),'utf8')):{frame,url,business};
    states.set(frame,state); assert.equal(state.url,url); assert.deepEqual(state.business,business);
    if(state.accepted){console.log(JSON.stringify({frame,resuming:state.accepted.job.id}));continue;}
    assert.ok(!state.signature,'An unresolved signed request exists; reconcile it before any new payment');
    // The user selected the local test key, rather than an OKX wallet account.
    // Quote via the CLI, then use its documented local-key signing fallback.
    if(!state.quote){
      const quoted=JSON.parse(execFileSync(cli,['payment','quote',url,'--method','POST',
        '--param','instId=BTC-USDT','--param',`timeframe=${frame}`,'--param','lang=en'],
        {encoding:'utf8',timeout:60000,windowsHide:true,stdio:['ignore','pipe','pipe']}));
      assert.equal(quoted.ok,true);state.quote=quoted.data;save(frame,state);
    }
    const challengeResponse=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(business),signal:AbortSignal.timeout(45000)});
    assert.equal(challengeResponse.status,402);
    const raw=challengeResponse.headers.get('payment-required');assert.ok(raw);
    const challenge=JSON.parse(Buffer.from(raw,'base64').toString('utf8')), a=challenge.accepts[0];
    assert.equal(challenge.x402Version,2);assert.equal(challenge.accepts.length,1);assert.equal(challenge.resource.url,url);
    assert.equal(a.scheme,'exact');assert.equal(a.network,net.caip2);assert.equal(a.amount,String(price));
    assert.equal(a.asset.toLowerCase(),net.paymentAsset.address.toLowerCase());
    assert.equal(a.payTo.toLowerCase(),cfg.PAY_TO_ADDRESS.toLowerCase());
    state.challenge=challenge;save(frame,state);
    console.log(JSON.stringify({frame,quote:.3,asset:net.paymentAsset.symbol,network:net.chainId,payee:a.payTo}));
    if(!execute)continue;
    const signed=JSON.parse(execFileSync(cli,['payment','pay-local','--payload',raw],
      {env:{...process.env,EVM_PRIVATE_KEY:key},encoding:'utf8',timeout:45000,windowsHide:true,stdio:['ignore','pipe','pipe']}));
    assert.equal(signed.ok,true);const proof=signed.data;
    assert.ok(proof.authorization_header);assert.ok(proof.header_name);
    const decoded=JSON.parse(Buffer.from(proof.authorization_header,'base64').toString('utf8'));
    const authorization=decoded.payload.authorization;
    assert.equal(authorization.from.toLowerCase(),wallet.toLowerCase());assert.equal(authorization.to.toLowerCase(),cfg.PAY_TO_ADDRESS.toLowerCase());
    assert.equal(authorization.value,String(price));assert.equal(decoded.accepted.network,net.caip2);
    state.signature=proof.authorization_header;state.submittedAt=new Date().toISOString();save(frame,state);
    // Never automatically repeat a signed HTTP request after ambiguous failure.
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',[proof.header_name]:proof.authorization_header},
      body:JSON.stringify(business),signal:AbortSignal.timeout(120000)});
    state.httpStatus=response.status;state.response=await response.json().catch(()=>null);
    state.receiptHeader=response.headers.get('payment-response');
    if(response.status===202)state.accepted=state.response;save(frame,state);
    assert.equal(response.status,202,`Report purchase rejected: ${state.response?.error||response.status}`);
    assert.ok(state.accepted.job?.id&&state.accepted.recoveryToken&&state.receiptHeader);
    console.log(JSON.stringify({frame,stage:'paid_job_accepted',jobId:state.accepted.job.id}));
  }
  if(!execute)process.exit(0);
}

async function deliver(frame){
  const state=states.get(frame)||JSON.parse(fs.readFileSync(fileFor(frame),'utf8'));
  const deliveredFile=`${root}/private/${frame}-delivery.json`;
  if(!renderOnly){
    assert.ok(state.accepted?.job?.id,'Recovery requires an accepted job');
    const receipt=JSON.parse(Buffer.from(state.receiptHeader,'base64').toString('utf8'));
    assert.equal(receipt.success,true);assert.equal(receipt.network,net.caip2);
    const headers={'PULSE-RECOVERY-TOKEN':state.accepted.recoveryToken};let previous;
    for(let attempt=0;attempt<360;attempt++){
      const response=await get(new URL(state.accepted.pollUrl,origin),headers);assert.equal(response.status,200);
      state.job=(await response.json()).job;save(frame,state);
      if(state.job.stage!==previous){console.log(JSON.stringify({frame,stage:state.job.stage}));previous=state.job.stage;}
      if(['completed','completed_partial'].includes(state.job.stage))break;
      assert.ok(!['failed_retriable','failed_terminal','manual_reconciliation'].includes(state.job.stage),`Paid job needs free recovery: ${state.job.stage}`);
      await new Promise(resolve=>setTimeout(resolve,2500));
    }
    assert.ok(['completed','completed_partial'].includes(state.job.stage),'Recover this job without another payment');
    const reportUrl=new URL(state.accepted.reportUrl,origin),response=await get(reportUrl,headers);assert.equal(response.status,200);
    assert.equal(response.headers.get('payment-required'),null);
    const delivery=await response.json();fs.writeFileSync(deliveredFile,JSON.stringify(delivery,null,2));
    const reopened=await get(reportUrl,headers);assert.equal(reopened.status,200);
    assert.deepEqual((await reopened.json()).report.global,delivery.report.global);
    assert.equal((await get(reportUrl)).status,403);
    const mined=await client.waitForTransactionReceipt({hash:receipt.transaction,timeout:60000});assert.equal(mined.status,'success');
    const exactTransfer=mined.logs.some(log=>{
      if(log.address.toLowerCase()!==net.paymentAsset.address.toLowerCase())return false;
      try{const d=decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics});return d.eventName==='Transfer'&&
        d.args.from.toLowerCase()===wallet.toLowerCase()&&d.args.to.toLowerCase()===cfg.PAY_TO_ADDRESS.toLowerCase()&&d.args.value===price;}catch{return false;}
    });assert.ok(exactTransfer,'Missing exact .30 settlement-asset transfer');
    state.transferVerified=true;state.transaction=receipt.transaction;save(frame,state);
  }
  const delivery=JSON.parse(fs.readFileSync(deliveredFile,'utf8')),original=delivery.report,g=technicalReview?reviewGlobalTargetReport(GlobalReportSchema.parse(original.global)):GlobalReportSchema.parse(original.global);
  const report=technicalReview?{...original,global:g,...globalCompatibility(g)}:original;
  if(technicalReview)fs.writeFileSync(`${root}/private/${frame}-reviewed-delivery.json`,JSON.stringify({report,reportMarkdown:fullReportDelivery(report).reportMarkdown},null,2));
  const text=researchText(presentResearch(report)),telegramText=formatTelegramResearch(report),message=telegramResearchMessage(report),caption=telegramResearchCaption(report);
  const svg=globalReportChartSvg(g),png=renderTelegramResearchChart(report),cards=globalTradeCards(g),name=`BTC-${frame}-${globalArtifactTag(g)}`;
  const markdown=fullReportDelivery(report).reportMarkdown;
  for(const [ext,value]of [['json',JSON.stringify(g,null,2)],['txt',text],['telegram.txt',telegramText],['telegram-message.txt',message],
    ['telegram-caption.txt',caption],['md',markdown],['original.md',delivery.reportMarkdown],['svg',svg],['png',png]]){
    if(value)fs.writeFileSync(`${artifactRoot}/${name}.${ext}`,value);
  }
  const findings=[],warnings=[],check=(condition,issue)=>{if(!condition)findings.push(issue);};
  check(g.decisionVersion==='decision-v5','Unexpected decision version');check(g.tradePlan?.method==='structure-v5','Unexpected entry method');
  check(g.tier==='pro'&&g.snapshot.instId==='BTC-USDT','Incorrect instrument/tier');
  check(g.snapshot.timeframe===({'1D':'1Dutc','1W':'1Wutc'}[frame]||frame),'Incorrect main timeframe');
  check(g.strategy?.entryTimeframe===({'1H':'15m','4H':'1H','1D':'4H','1W':'1Dutc'}[frame]),'Incorrect entry timeframe');
  check(g.candles.length>=233&&g.candles.every(c=>c.confirmed),'Primary history cannot support all default SMAs');
  if(g.candles.length<520)warnings.push(`Provider returned ${g.candles.length}/520 requested completed candles; delivery stage ${state.job?.stage}`);
  check(g.candles.every(c=>candleCloseTime(c.ts,g.snapshot.timeframe)<=Date.parse(g.snapshot.observedAt)),'Future primary candle');
  check(g.entryStudy?.status==='available'&&g.context.status==='available','Entry or higher context unavailable');
  check(report.analysisProfile?.reasoningEffort==='medium'&&report.model==='grok-4.5','Unexpected live model/reasoning');
  check(text===telegramText,'TXT and Telegram file mismatch');check(caption.length<=1024&&message.length<=3900,'Telegram limits exceeded');
  check(svg&&!svg.includes('NaN')&&png?.length>10000,'Chart rendering failed');
  check(!/CHECKPOINT|OBJECTIVE|WATCH AREA|anchor, not TP|>124,500</i.test(svg||''),'Confusing chart wording or rejected archive level');
  check(g.setupSelection?.version==='single-setup-v2','Single-setup selector missing');
  check(['LONG','SHORT','SIDEWAYS'].includes(globalDecision(g).direction),'Invalid market assessment');
  check(cards.length===1&&g.paths.length===1&&g.strategy.routes.length===1,'Expected one supported setup, path and route');
  check((svg?.match(/data-scenario-projection=/g)||[]).length===1,'Missing single conditional projected move');
  for(const section of presentResearch(report).sections)check((technicalReview?markdown:delivery.reportMarkdown).includes('## '+section.title),`Missing Markdown section: ${section.title}`);
  for(const card of cards){
    const p=card.plan,sign=card.side==='long'?1:-1,entry=p.referenceEntry?.[card.side==='long'?1:0];
    check(entry>0&&p.referenceStop>0,`${card.key}: missing Entry/SL`);
    check(sign*(entry-p.referenceStop)>0,`${card.key}: SL on wrong side`);
    if(g.range&&!p.retestTs)check(card.side==='long'?p.referenceStop<g.range.lower[0]:p.referenceStop>g.range.upper[1],`${card.key}: provisional range stop is inside the full boundary`);
    check(card.targets.length>0&&card.targets.every((t,i)=>sign*(t.price-(i?card.targets[i-1].price:entry))>0),`${card.key}: TP ordering`);
    const calculated=sign*(card.targets[0]?.price-entry)/Math.abs(entry-p.referenceStop);
    check(Math.abs(calculated-card.rr)<1e-7,`${card.key}: R:R calculation`);
    if(card.confirmed)check(card.rr>=1.5&&p.confirmationTs&&p.retestTs,`${card.key}: unqualified confirmed entry`);
    const selectedSvg=globalReportChartSvg(g,{selectedPathId:card.key});
    fs.writeFileSync(`${artifactRoot}/${name}-${card.side}.svg`,selectedSvg);
    for(const output of [text,message,caption]){
      check(output.includes(card.entry)&&output.includes(card.stop),`${card.key}: Entry/SL mismatch`);
      check(output.includes(card.condition),`${card.key}: missing full trigger`);
    }
    check(selectedSvg.includes(`data-trade-price-ledger="${card.key}"`),`${card.key}: chart selection mismatch`);
    for(const [role,value]of [['SL',p.referenceStop],...card.targets.map((t,i)=>[`TP${i+1}`,t.price])]){
      check(selectedSvg.includes(`data-trade-role="${role}" data-price="${value}"`),`${card.key}: ${role} outside chart scale`);
    }
  }
  const decision=globalDecision(g);
  const event=stage=>state.job?.events?.find(e=>e.stage===stage)?.at;
  const durationMs=state.job?.createdAt&&event('completed')?Date.parse(event('completed'))-Date.parse(state.job.createdAt):state.job?.createdAt?Date.parse(state.job.updatedAt)-Date.parse(state.job.createdAt):null;
  const result={frame,ok:findings.length===0,findings,warnings,jobId:state.accepted.job.id,transaction:state.transaction,paidAmount:.3,asset:net.paymentAsset.symbol,durationMs,selection:g.setupSelection,originalReference:globalArtifactReference(GlobalReportSchema.parse(original.global)),technicalReview,
    transferVerified:state.transferVerified,model:report.model,reasoning:report.analysisProfile?.reasoningEffort,
    generatedAt:report.generatedAt,observedAt:g.snapshot.observedAt,reference:globalArtifactReference(g),
    primaryCandles:g.candles.length,entryFrame:g.entryStudy?.timeframe,entryCandles:g.entryStudy?.candles.length,
    context:g.context.status,action:decision.currentAction,captionCharacters:caption.length,messageCharacters:message.length,name,
    plans:cards.map(c=>({side:c.side,state:c.state,confirmed:c.confirmed,entry:c.entry,sl:c.stop,rr:c.rr,
      targets:c.targets,condition:c.condition,blockers:c.plan.blockers}))};
  results.push(result);persist();console.log(JSON.stringify({frame,ok:result.ok,findings,warnings,artifacts:name}));
}
await Promise.all(frames.map(async frame=>{
  try{await deliver(frame);}catch(error){results.push({frame,ok:false,error:error.message});persist();console.log(JSON.stringify({frame,error:error.message}));}
}));
if(!renderOnly){
  const balance=await client.readContract({address:net.paymentAsset.address,abi:erc20Abi,functionName:'balanceOf',args:[wallet]});
  console.log(JSON.stringify({remainingBalance:formatUnits(balance,6),asset:net.paymentAsset.symbol}));
}
console.log(JSON.stringify({reports:results.length,passed:results.filter(r=>r.ok).length,output:root}));
process.exitCode=results.some(r=>!r.ok)?1:0;
