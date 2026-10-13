/** Authorized Quick/Pro report validation. Read-only unless --execute is passed.
 * Uses only TEST_WALLET_ADDRESS on Base; caps spend at 0.50 USDC in total.
 * Only report payments are submitted; no swaps, approvals or automation. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { config as dotenv } from "dotenv";
import { createPublicClient, http, fallback, parseAbi, decodeEventLog } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
dotenv({path:".env",quiet:true});
const execute=process.argv.includes("--execute"), privateKey=process.env.TEST_WALLET_PRIVATE_KEY;
const wallet=process.env.TEST_WALLET_ADDRESS;
assert.match(wallet||"",/^0x[\da-f]{40}$/i,"TEST_WALLET_ADDRESS missing or invalid");
if(execute){
  assert.match(privateKey||"",/^0x[\da-f]{64}$/i,"Test signer missing or invalid");
  assert.equal(privateKeyToAccount(privateKey).address.toLowerCase(),wallet.toLowerCase(),"Test signer must match TEST_WALLET_ADDRESS");
}
const account={address:wallet};
const rpcUrls=[process.env.BASE_RPC_URL,process.env.BASE_RPC_FALLBACK_URL,"https://mainnet.base.org"].filter(Boolean);
const client=createPublicClient({chain:base,transport:fallback(rpcUrls.map(url=>http(url,{timeout:15000,retryCount:1})))});
assert.equal(await client.getChainId(),8453,"RPC must be Base mainnet");
const usdc="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",abi=parseAbi(["function balanceOf(address) view returns (uint256)","event Transfer(address indexed from,address indexed to,uint256 value)"]);
const startingBalance=await client.readContract({address:usdc,abi,functionName:"balanceOf",args:[account.address]});
if(execute)assert.ok(startingBalance>=500000n,"At least 0.50 USDC is required for both report tests");
console.log(JSON.stringify({check:"Base wallet preflight",chainId:8453,wallet:account.address,balanceUSDC:Number(startingBalance)/1e6,execute}));
if(!execute)process.exit(0);

// Isolate these jobs from production queues, public activity and Telegram.
Object.assign(process.env,{NODE_ENV:"test",PULSE_SKIP_DOTENV:"1",QUEUE_PROVIDER:"memory",STORAGE_PROVIDER:"memory",PERSISTENCE_NAMESPACE:`global-validation-${Date.now()}`,FEATURE_TELEGRAM:"0",REDIS_URL:"",KV_REST_API_URL:"",KV_REST_API_TOKEN:"",X402_MOCK:"0"});
const [{loadConfig},{createApp},{createPaidFetch},{GlobalReportSchema},domain,telegram,{createPersistence},{buildMarketContext}]=await Promise.all([import("../packages/config/dist/index.js"),import("../apps/api/dist/app.js"),import("../packages/buyer/dist/index.js"),import("../packages/schemas/dist/index.js"),import("../packages/domain/dist/index.js"),import("../apps/api/dist/telegramResearch.js"),import("../apps/api/dist/jobs.js"),import("../packages/market/dist/index.js")]);
const cfg=loadConfig();assert.equal(cfg.paymentMode,"okx","Real payments are required");assert.equal(cfg.FEATURE_BASE_PAYMENTS,true);assert.equal(cfg.GROK_REASONING_STANDARD,"low");assert.equal(cfg.GROK_REASONING_PREMIUM,"medium");assert.ok(cfg.hasXaiKey,"Live Grok credentials are required");assert.ok(cfg.PRICE_ANALYSIS_BASE<=.20&&cfg.PRICE_ANALYSIS_PREMIUM<=.30,"Report charges exceed the authorized 0.50 USDC bound");
const [primary,context]=await Promise.all([buildMarketContext({instId:"SOL-USDT",timeframe:"1H",candleLimit:520,completedOnly:true}),buildMarketContext({instId:"SOL-USDT",timeframe:"4H",candleLimit:300,completedOnly:true})]);
assert.ok(primary.candles.length>=520&&context.candles.length>=233,"Live market history must be available before checkout");
console.log(JSON.stringify({check:"Live market preflight",primaryCandles:primary.candles.length,contextCandles:context.candles.length,source:primary.source}));
// Preserve local test receipts/jobs/reports even if a later visual assertion
// fails. These private archives stay outside the public preview directory.
mkdirSync(".tmp/global-base-private",{recursive:true});
const persistence={...createPersistence(cfg)},jobMethods=new Set(["acquire","transition","bindReceipt","bindReceiptAndEnqueue","attachReport","grantRegeneration"]);
const originalJobs=persistence.jobs;
persistence.jobs=new Proxy(originalJobs,{get(target,name){const fn=target[name];if(typeof fn!=="function")return fn;return async(...args)=>{const result=await fn.apply(target,args);if(jobMethods.has(name)){const job=name==="acquire"?result.job:result;writeFileSync(`.tmp/global-base-private/job-${job.id}.json`,JSON.stringify(job,null,2));}return result;};}});
const originalSave=persistence.reports.save.bind(persistence.reports);
persistence.reports.save=async(owner,report)=>{const record=await originalSave(owner,report);writeFileSync(`.tmp/global-base-private/report-${record.id}.json`,JSON.stringify({record,report},null,2));return record;};
const server=createServer();await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
server.on("request",createApp({...cfg,BASE_URL:origin,FEATURE_TELEGRAM:false,QUEUE_PROVIDER:"memory",STORAGE_PROVIDER:"memory"},{persistence}));
const results=[],state={origin,wallet:account.address,jobs:[]};mkdirSync(".tmp",{recursive:true});mkdirSync("docs/previews",{recursive:true});
try{
  for(const tier of ["standard","premium"]){
    const price=tier==="standard"?cfg.PRICE_ANALYSIS_BASE:cfg.PRICE_ANALYSIS_PREMIUM,route=`${origin}/base/v1/analysis/spot/${tier}`,body={instId:"SOL-USDT",timeframe:"1H",lang:"en"};
    const paid=createPaidFetch({privateKey,rpcUrl:rpcUrls[0],network:"eip155:8453",expectedPayTo:cfg.PAY_TO_ADDRESS,maxPaymentUsd:price});
    const response=await paid(route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const accepted=await response.json();assert.equal(response.status,202,`Report checkout failed: ${accepted.error||response.status}`);assert.ok(accepted.recoveryToken&&accepted.job?.id,"Recoverable job was not returned");
    const receiptHeader=response.headers.get("payment-response");assert.ok(receiptHeader,"Settled payment receipt missing");const receipt=JSON.parse(Buffer.from(receiptHeader,"base64").toString("utf8"));assert.equal(receipt.success,true);assert.equal(receipt.network,"eip155:8453");
    state.jobs.push({tier,jobId:accepted.job.id,recoveryToken:accepted.recoveryToken,transaction:receipt.transaction});writeFileSync(".tmp/global-base-validation-private.json",JSON.stringify(state,null,2));
    const headers={"PULSE-RECOVERY-TOKEN":accepted.recoveryToken},statusUrl=`${origin}/v1/jobs/${accepted.job.id}`;
    let job;
    for(let attempt=0;attempt<200;attempt++){const status=await fetch(statusUrl,{headers});assert.equal(status.status,200);job=(await status.json()).job;if(["completed","completed_partial"].includes(job.stage))break;if(["failed_terminal","manual_reconciliation"].includes(job.stage))throw new Error(`Settled report needs recovery: ${job.stage}`);await new Promise(resolve=>setTimeout(resolve,2000));}
    assert.ok(["completed","completed_partial"].includes(job?.stage),"Report did not complete within the validation deadline");
    const url=`${statusUrl}/report`,saved=await fetch(url,{headers});assert.equal(saved.status,200);const delivered=await saved.json(),report=delivered.report,global=GlobalReportSchema.parse(report.global),label=tier==="standard"?"quick":"pro";
    assert.equal(global.tier,label);assert.equal(global.snapshot.instId,"SOL-USDT");assert.equal(global.snapshot.priceCurrency,"USDT");assert.equal(global.candles.length,520,"Insufficient history for the agreed chart");assert.ok(global.candles.every(c=>c.confirmed));assert.ok(global.view.pathIds.length<=(label==="quick"?2:3));
    if(label==="pro"){assert.equal(global.context.status,"available","Pro requires independently observed context");assert.equal(global.context.timeframe,"4H");assert.ok(global.indicators.regression);assert.ok(global.indicators.rsi.points.length>0);}
    const txt=telegram.formatTelegramResearch(report),message=telegram.telegramResearchMessage(report),caption=telegram.telegramResearchCaption(report),svg=domain.researchChartSvg(report),png=telegram.renderTelegramResearchChart(report);assert.ok(svg&&png);assert.ok(message.length<=3900&&caption.length<=1024);
    for(const id of [global.setup.triggerLevelId,...global.setup.targetIds,global.setup.invalidationLevelId].filter(Boolean)){const price=domain.globalLevelPrice(global,id);assert.ok(txt.includes(price)&&message.includes(price)&&svg.includes(price),`Setup/chart/export mismatch at ${id}`);}
    if(global.setup.retestTs===null){assert.equal(global.setup.entryZone,null);assert.equal(global.setup.protectiveStop,null);assert.equal(global.setup.netRewardRisk,null);}
    const reopened=await fetch(url,{headers});assert.equal(reopened.status,200);assert.equal(reopened.headers.get("payment-required"),null);assert.deepEqual((await reopened.json()).report.global,report.global);
    assert.equal((await fetch(url)).status,403,"Private report must require its recovery token");
    const onchain=await client.waitForTransactionReceipt({hash:receipt.transaction,timeout:60000});assert.equal(onchain.status,"success");assert.ok(onchain.logs.some(log=>{if(log.address.toLowerCase()!==usdc.toLowerCase())return false;try{const decoded=decodeEventLog({abi,data:log.data,topics:log.topics});return decoded.eventName==="Transfer"&&decoded.args.from.toLowerCase()===account.address.toLowerCase()&&decoded.args.to.toLowerCase()===cfg.PAY_TO_ADDRESS.toLowerCase()&&decoded.args.value===BigInt(Math.round(price*1e6));}catch{return false;}}),"Exact USDC transfer not found on Base");
    writeFileSync(`docs/previews/live-global-${label}.json`,JSON.stringify(global,null,2));writeFileSync(`docs/previews/live-global-${label}.svg`,svg);writeFileSync(`docs/previews/live-global-${label}.png`,png);writeFileSync(`docs/previews/live-global-${label}.txt`,txt);writeFileSync(`docs/previews/live-global-${label}-telegram.txt`,message);
    const result={tier:label,jobId:accepted.job.id,stage:job.stage,transaction:receipt.transaction,paidUSDC:price,model:report.model,reasoning:report.analysisProfile.reasoningEffort,completedCandles:global.candles.length,waveCount:global.waveCount.status,setupState:global.setup.state,context:global.context.status,chartBytes:png.length,reopenedFree:true};results.push(result);console.log(JSON.stringify(result));
  }
  const endingBalance=await client.readContract({address:usdc,abi,functionName:"balanceOf",args:[account.address]}),spent=startingBalance-endingBalance;assert.equal(spent,BigInt(Math.round((cfg.PRICE_ANALYSIS_BASE+cfg.PRICE_ANALYSIS_PREMIUM)*1e6)),"Unexpected test-wallet USDC spend");
  writeFileSync("docs/previews/global-base-validation.json",JSON.stringify({validatedAt:new Date().toISOString(),chainId:8453,wallet:account.address,totalSpentUSDC:Number(spent)/1e6,results},null,2));console.log(JSON.stringify({result:"Validated both paid reports on Base",totalSpentUSDC:Number(spent)/1e6}));
}finally{await new Promise(resolve=>server.close(resolve));}
