/** Bounded production checkout. --execute buys only the explicit matrix below.
 * Resumes accepted jobs without repaying; private authorizations stay in .tmp.
 * No swaps, approvals, deposits, automation or Telegram sends. */
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPaidFetch } from '../packages/buyer/dist/index.js';
import { getNetwork } from '../packages/config/dist/index.js';
import { GlobalReportSchema } from '../packages/schemas/dist/index.js';
import { presentResearch, researchChartSvg, globalLevelPrice } from '../packages/domain/dist/index.js';
import { renderTelegramResearchChart, formatTelegramResearch, telegramResearchMessage, telegramResearchCaption } from '../apps/api/dist/telegramResearch.js';
config({ path: '.env', quiet: true });
const origin = 'https://pulse-api-production-7aae.up.railway.app', root = '.tmp/asp-audit', execute = process.argv.includes('--execute');
let matrix = [['xlayer','standard','REST'],['xlayer','premium','MCP'],['base','standard','MCP'],['base','premium','REST'],['arbitrum','premium','MCP']];
if(process.argv.includes('--arc')) matrix.push(['arc','standard','REST'],['arc','premium','MCP']);
if(process.argv.includes('--arbitrum-quick')) matrix.push(['arbitrum','standard','REST']);
const selectedNetwork=process.argv.find(arg=>arg.startsWith('--only-network='))?.slice(15);
if(selectedNetwork)assert.ok(['xlayer','base','arbitrum','arc'].includes(selectedNetwork),'Unknown selected network');
if(selectedNetwork)matrix=matrix.filter(([network])=>network===selectedNetwork);
if(process.argv.includes('--xlayer-pro-rest'))matrix=[['xlayer','premium','REST']];
assert.ok(matrix.length,'Selected network has no cases; enable its matrix option');
const key = process.env.TEST_WALLET_PRIVATE_KEY, wallet = process.env.TEST_WALLET_ADDRESS;
assert.match(wallet || '', /^0x[a-fA-F0-9]{40}$/);
assert.equal(privateKeyToAccount(key).address.toLowerCase(), wallet.toLowerCase(), 'Signer must match TEST_WALLET_ADDRESS');
const budget = matrix.reduce((sum, [,tier]) => sum + (tier === 'standard' ? .20 : .30), 0);
assert.ok(budget <= 2.000001);
console.log(JSON.stringify({check:'Authorized report matrix',wallet,matrix,totalMaximum:budget,execute}));
if(!execute)process.exit(0);
mkdirSync(root + '/private', { recursive: true }); mkdirSync(root + '/deliverables', { recursive: true });
async function readGet(url,init={}) {
  try { return await fetch(url,{...init,signal:AbortSignal.timeout(30000)}); }
  catch { return fetch(url,{...init,signal:AbortSignal.timeout(30000)}); }
}
const metadata = await (await readGet(origin + '/v1/metadata')).json(), merchant = process.env.PAY_TO_ADDRESS;
assert.ok(merchant && metadata.asp.payTo.toLowerCase() === merchant.toLowerCase(), 'Published recipient must match configured merchant');
const results = [], summaryFile=root+'/paid-results.json';
const previousResults=existsSync(summaryFile)?JSON.parse(readFileSync(summaryFile,'utf8')).results:[];
const saveResults = () => writeFileSync(summaryFile, JSON.stringify({ checkedAt:new Date().toISOString(),wallet,budget,results:[...previousResults.filter(previous=>!results.some(current=>current.label===previous.label)),...results] },null,2));
const abi = parseAbi(['function balanceOf(address) view returns (uint256)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const rpcCall = (name,args) => ({jsonrpc:'2.0',id:8355,method:'tools/call',params:{name,arguments:args}});
const unwrap = json => json?.result?.structuredContent || json;
for(const [network,tier,transport] of matrix){
  const label = network + '-' + (tier === 'standard' ? 'quick' : 'pro') + (process.argv.includes('--xlayer-pro-rest')?'-rest':''), net = getNetwork(network), price = tier === 'standard' ? .20 : .30;
  const file = root + '/private/' + label + '.json', path = `/v1/analysis/spot/${tier}`, canonical = origin + '/' + network + path, url = transport === 'MCP' ? origin + '/' + network + '/mcp' : canonical;
  const business = { instId:'BTC-USDT', timeframe:'1H', lang:'en' }, body = JSON.stringify(transport === 'MCP' ? rpcCall('spot_analysis_' + tier,business) : business);
  const rpcUrl = process.env[network.toUpperCase() + '_RPC_URL'] || net.rpcUrls[0], client = createPublicClient({transport:http(rpcUrl,{timeout:20000,retryCount:0})});
  let state = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : {network,tier,transport,url,body};
  assert.equal(state.url,url);assert.equal(state.body,body);
  const save = () => writeFileSync(file,JSON.stringify(state,null,2));
  try{
    assert.equal(await client.getChainId(),net.chainId);
    if(process.argv.includes('--xlayer-pro-rest')&&!state.accepted){
      const failed=JSON.parse(readFileSync(root+'/private/xlayer-pro.json','utf8')),payload=JSON.parse(Buffer.from(failed.signature,'base64').toString('utf8')),authorization=payload.payload.authorization;
      assert.equal(failed.httpStatus,402);assert.equal(failed.response.error,'No paid route configuration');assert.ok(!failed.receiptHeader);
      assert.ok(Number(authorization.validBefore)<Date.now()/1000,'Earlier authorization must expire before a fresh checkout');
      assert.equal(await client.readContract({address:net.paymentAsset.address,abi:parseAbi(['function authorizationState(address,bytes32) view returns(bool)']),functionName:'authorizationState',args:[wallet,authorization.nonce]}),false,'Earlier authorization must be unused');
    }
    if(!state.accepted){
      assert.ok(!state.signature,'An earlier signed request has no accepted job; reconcile it before attempting another payment');
      state.startingBalance = String(await client.readContract({address:net.paymentAsset.address,abi,functionName:'balanceOf',args:[wallet]}));
      assert.ok(BigInt(state.startingBalance) >= BigInt(Math.round(price*1e6)), 'Insufficient settlement-token balance');
      if(network === 'arc'){
        const response=await fetch('https://gateway-api.circle.com/v1/balances',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'USDC',sources:[{domain:26,depositor:wallet}]}),signal:AbortSignal.timeout(20000)}),data=await response.json();
        assert.ok(response.ok && Number(data.balances?.find(x=>x.domain===26)?.balance)>=price,'Arc Gateway balance insufficient; no authorization signed');
      }
      let signedRequests = 0;
      const guardedFetch = async (input, init) => {
        const request = new Request(input,init), signature = request.headers.get('payment-signature') || request.headers.get('x-payment');
        assert.equal(request.url,url);assert.equal(request.method,'POST');assert.deepEqual(await request.clone().json(),JSON.parse(body));
        if(signature){assert.equal(++signedRequests,1,'One signed checkout per test');state.signature=signature;state.submittedAt=new Date().toISOString();save();}
        let response;
        if(signature)response=await fetch(request);
        else {const retry=request.clone();try{response=await fetch(request);}catch{response=await fetch(retry);}}
        if(signature){state.httpStatus=response.status;state.response=await response.clone().json().catch(()=>null);state.receiptHeader=response.headers.get('payment-response');state.accepted=unwrap(state.response);save();}
        if(response.status===402){
          const required=response.headers.get('payment-required');
          if(!required)return response;
          const challenge=JSON.parse(Buffer.from(required,'base64').toString('utf8')), accepted=challenge.accepts?.[0];
          assert.equal(challenge.x402Version,2);assert.equal(challenge.accepts.length,1);assert.equal(challenge.resource.url,canonical);
          assert.equal(accepted.network,net.caip2);assert.equal(accepted.asset.toLowerCase(),net.paymentAsset.address.toLowerCase());
          assert.equal(accepted.payTo.toLowerCase(),merchant.toLowerCase());assert.equal(accepted.amount,String(Math.round(price*1e6)));
          state.challenge=challenge;save();
        }
        return response;
      };
      const paid=createPaidFetch({privateKey:key,rpcUrl,network:net.caip2,expectedPayTo:merchant,maxPaymentUsd:price,fetchImpl:guardedFetch});
      await paid(url,{method:'POST',headers:{'Content-Type':'application/json'},body});
    }
    assert.equal(state.httpStatus,202, 'Checkout did not accept a report job');
    const accepted=state.accepted;assert.ok(accepted.job?.id && accepted.recoveryToken, 'Recoverable job missing');
    assert.ok(state.receiptHeader,'Receipt missing');const receipt=JSON.parse(Buffer.from(state.receiptHeader,'base64').toString('utf8'));
    assert.equal(receipt.success,true);assert.equal(receipt.network,net.caip2);
    console.log(JSON.stringify({check:'Paid job accepted',label,jobId:accepted.job.id,price,transport,transaction:receipt.transaction}));
    const headers={'PULSE-RECOVERY-TOKEN':accepted.recoveryToken},statusUrl=origin+accepted.pollUrl;
    let job;
    for(let attempt=0;attempt<150;attempt++){
      const response=await fetch(statusUrl,{headers,signal:AbortSignal.timeout(25000)});
      if(response.status===503){await new Promise(resolve=>setTimeout(resolve,3000));continue;}
      assert.equal(response.status,200);job=(await response.json()).job;state.job=job;save();
      if(['completed','completed_partial'].includes(job.stage))break;
      if(['failed_retriable','failed_terminal','manual_reconciliation'].includes(job.stage))throw new Error('Paid job requires recovery: '+job.stage);
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
    assert.ok(['completed','completed_partial'].includes(job?.stage),'Report deadline exceeded; resume polling without repaying');
    const reportUrl=origin+accepted.reportUrl, response=await fetch(reportUrl,{headers,signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);assert.equal(response.headers.get('payment-required'),null);
    const delivered=await response.json();writeFileSync(root+'/private/'+label+'-delivery.json',JSON.stringify(delivered,null,2));
    const report=delivered.report, global=GlobalReportSchema.parse(report.global), p=presentResearch(report);
    assert.equal(global.tier,tier==='standard'?'quick':'pro');assert.equal(global.snapshot.instId,business.instId);assert.equal(global.snapshot.timeframe,business.timeframe);
    assert.equal(global.candles.length,520);assert.ok(global.candles.every(c=>c.confirmed));assert.ok(global.candles.some(c=>c.open!==c.close));
    assert.ok(global.view.pathIds.length<=(tier==='standard'?2:3));assert.ok(delivered.reportMarkdown?.includes(business.instId));
    // Older purchased snapshots predate tradePlan. Their frozen Markdown is
    // checked against the sections they were sold with; the local renderer can
    // derive an additional planning view without rewriting that old document.
    const promisedSections=p.sections.filter(section=>global.tradePlan!==undefined||!['Directional trade plan','方向性交易计划'].includes(section.title));
    for(const section of promisedSections)assert.ok(delivered.reportMarkdown.includes('## '+section.title),'Full section missing: '+section.title);
    if(tier==='premium'){assert.equal(global.context.status,'available');assert.equal(global.context.timeframe,'4H');assert.ok(global.indicators.regression);assert.ok(global.indicators.rsi.points.length);}
    const txt=formatTelegramResearch(report),message=telegramResearchMessage(report),caption=telegramResearchCaption(report),svg=researchChartSvg(report),png=renderTelegramResearchChart(report);
    assert.ok(svg && png);assert.ok(message.length<=3900 && caption.length<=1024);
    for(const id of [global.setup.triggerLevelId,...global.setup.targetIds,global.setup.invalidationLevelId].filter(Boolean)){
      const priceText=globalLevelPrice(global,id);assert.ok(txt.includes(priceText)&&message.includes(priceText)&&svg.includes(priceText),'Setup/chart/export price mismatch');
    }
    if(!global.setup.retestTs){assert.equal(global.setup.entryZone,null);assert.equal(global.setup.protectiveStop,null);assert.equal(global.setup.netRewardRisk,null);}
    const reopened=await fetch(reportUrl,{headers});assert.equal(reopened.status,200);assert.deepEqual((await reopened.json()).report.global,report.global);
    assert.equal((await fetch(reportUrl)).status,403);
    const mcpReport=await fetch(origin+'/'+network+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rpcCall('job_report',{jobId:job.id,recoveryToken:accepted.recoveryToken}))});
    assert.equal(mcpReport.status,200);assert.equal(mcpReport.headers.get('payment-required'),null);assert.deepEqual(unwrap(await mcpReport.json()).report.global,report.global);
    let transferVerified=false;
    if(network!=='arc'){
      assert.match(receipt.transaction||'',/^0x[a-f0-9]{64}$/i);
      const mined=await client.waitForTransactionReceipt({hash:receipt.transaction,timeout:60000});assert.equal(mined.status,'success');
      transferVerified=mined.logs.some(log=>{if(log.address.toLowerCase()!==net.paymentAsset.address.toLowerCase())return false;try{const decoded=decodeEventLog({abi,data:log.data,topics:log.topics});return decoded.eventName==='Transfer' && decoded.args.from.toLowerCase()===wallet.toLowerCase() && decoded.args.to.toLowerCase()===merchant.toLowerCase() && decoded.args.value===BigInt(Math.round(price*1e6));}catch{return false;}});
      assert.ok(transferVerified,'Exact on-chain settlement-token transfer missing');
    }
    for(const [ext,value] of [['json',JSON.stringify(global,null,2)],['md',delivered.reportMarkdown],['svg',svg],['png',png],['txt',txt],['telegram.txt',message]])writeFileSync(root+'/deliverables/'+label+'.'+ext,value);
    results.push({label,ok:true,jobId:job.id,stage:job.stage,transaction:receipt.transaction,price,transport,model:report.model,reasoning:report.analysisProfile?.reasoningEffort,candles:global.candles.length,context:global.context.status,setup:global.setup.state,waveCount:global.waveCount.status,completeMarkdown:true,reopenedFree:true,mcpRecovery:true,transferVerified});saveResults();console.log(JSON.stringify(results.at(-1)));
  }catch(error){results.push({label,ok:false,error:error instanceof assert.AssertionError?error.message:(error.shortMessage||error.message),httpStatus:state.httpStatus,jobId:state.accepted?.job?.id,stage:state.job?.stage});saveResults();console.log(JSON.stringify(results.at(-1)));}
}
process.exitCode=results.some(r=>!r.ok)?1:0;
