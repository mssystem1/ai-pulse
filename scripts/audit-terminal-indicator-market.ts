import { fileURLToPath } from "node:url";
import {config} from "dotenv";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createCipheriv,createHash,randomBytes,randomUUID} from "node:crypto";
import {privateKeyToAccount} from "viem/accounts";
import {createPublicClient,http,parseAbi,decodeEventLog} from "viem";
assert(process.argv.includes("--live"), "Live E2E requires --live; --spend additionally permits one exact 1.50 USDC Base pass purchase if access is absent");
config({quiet:true});process.env.AUTOMATION_WORKER_ENABLED="0";process.env.REDIS_URL=process.env.REDIS_PUBLIC_URL||process.env.REDIS_URL;
const {loadConfig,getNetwork}=await import("../packages/config/src/index.js");
const {createApp}=await import("../apps/api/src/app.js");
const {createPaidFetch}=await import("../packages/buyer/src/index.js");
const {createIndicatorPackage,evaluateIndicator}=await import("../packages/domain/src/index.js");
const {indicatorInputFromMarket}=await import("../apps/web/src/terminalIndicatorClient.ts");
const {createTerminalStore}=await import("../apps/api/src/terminalStore.js");
const folder=new URL("../.tmp/indicator-market-e2e/",import.meta.url),origin="http://127.0.0.1:8996";
const cfg={...loadConfig(),BASE_URL:origin,FEATURE_TRADING_TERMINAL:true,FEATURE_TELEGRAM:false,X402_MOCK:false,TERMINAL_MONITOR_INTERVAL_MS:15_000};
assert.equal(cfg.PRICE_TERMINAL_PASS_24H,1.5);assert.equal(cfg.GROK_COPILOT_MODEL,"grok-4.7");
const account=privateKeyToAccount(cfg.TEST_WALLET_PRIVATE_KEY as `0x${string}`);assert.equal(account.address.toLowerCase(),cfg.TEST_WALLET_ADDRESS.toLowerCase());
const terminalStore=createTerminalStore(cfg);
const network=getNetwork("base"),rpc=createPublicClient({transport:http(cfg.BASE_RPC_URL)}),checks:unknown[]=[];
const record=(check:string,detail:Record<string,unknown>={})=>{checks.push({check,ok:true,...detail});console.log(JSON.stringify({check,ok:true,...detail}));};
await mkdir(folder,{recursive:true});
let token="",stage="startup",server:any,paidThisRun=false;
const request=async(path:string,body?:unknown,method?:string)=>{const response=await fetch(origin+path,{method:method??(body===undefined?"GET":"POST"),headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(150000)});const value=await response.json();if(!response.ok)throw Error(`${path}: HTTP ${response.status} ${value.error??""}`);return value;};
let purchase:any;try{purchase=JSON.parse(await readFile(new URL("purchase.json",folder),"utf8"));}catch(error:any){if(error.code!=="ENOENT")throw error;purchase={requestId:randomUUID(),owner:account.address,attempted:false};await writeFile(new URL("purchase.json",folder),JSON.stringify(purchase,null,2));}
try{
 server=createApp(cfg,{startDurableWorker:false,terminal:{store:terminalStore}}).listen(8996,"127.0.0.1");await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
 stage="authenticate";const challenge=await request("/v1/terminal/auth/challenge",{wallet:account.address});assert(challenge.message.includes(`Origin: ${origin}`));assert(challenge.message.includes(account.address.toLowerCase()));
 const auth=await request("/v1/terminal/auth/verify",{challengeId:challenge.challengeId,signature:await account.signMessage({message:challenge.message})});token=auth.token;
 let workspace=await request("/v1/terminal/workspace");const catalog=await request("/v1/terminal/catalog");assert.equal(catalog.aiModel,"grok-4.7");record("real_test_wallet_authenticated_model_4_7");
 if(!workspace.access.active){
  if(purchase.attempted){await request("/v1/terminal/pass/recover",{requestId:purchase.requestId,...(purchase.transaction?{transactionHash:purchase.transaction}:{})});}
  else{
   assert(process.argv.includes("--spend"),"Pass expired; explicit funded-test switch required");stage="quote";
   const balance=await rpc.readContract({address:network.paymentAsset.address as `0x${string}`,abi:parseAbi(["function balanceOf(address) view returns (uint256)"]),functionName:"balanceOf",args:[account.address]});assert(balance>=1500000n);
   const body={requestId:purchase.requestId},headers={"content-type":"application/json",authorization:`Bearer ${token}`};
   const quote=await fetch(origin+"/base/v1/terminal/pass/24h",{method:"POST",headers,body:JSON.stringify(body)});assert.equal(quote.status,402);
   const required=JSON.parse(Buffer.from(quote.headers.get("PAYMENT-REQUIRED")!,"base64").toString());assert.equal(required.accepts.length,1);const option=required.accepts[0];
   assert.equal(option.network,"eip155:8453");assert.equal(option.amount,"1500000");assert.equal(option.asset.toLowerCase(),network.paymentAsset.address!.toLowerCase());assert.equal(option.payTo.toLowerCase(),cfg.PAY_TO_ADDRESS.toLowerCase());record("base_quote_matches_approved_1_50_usdc");
   paidThisRun=true;purchase.attempted=true;await writeFile(new URL("purchase.json",folder),JSON.stringify(purchase,null,2));stage="settlement";
   const fetchImpl:typeof fetch=async(input,init)=>{const req=new Request(input,init),proof=req.headers.get("PAYMENT-SIGNATURE");if(proof){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",createHash("sha256").update(cfg.TEST_WALLET_PRIVATE_KEY+":indicator-qa").digest(),iv),bytes=Buffer.concat([cipher.update(JSON.stringify({proof,url:req.url,body:await req.clone().text()})),cipher.final()]);await writeFile(new URL("payment-proof.enc.json",folder),JSON.stringify({iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:bytes.toString("base64")}));}return fetch(req);};
   const paid=createPaidFetch({privateKey:cfg.TEST_WALLET_PRIVATE_KEY,network:"eip155:8453",rpcUrl:cfg.BASE_RPC_URL,maxPaymentUsd:1.5,expectedPayTo:cfg.PAY_TO_ADDRESS,fetchImpl});
   const response=await paid(origin+"/base/v1/terminal/pass/24h",{method:"POST",headers,body:JSON.stringify(body)});const value=await response.json();if(value.transactionHash)purchase.transaction=value.transactionHash;await writeFile(new URL("purchase.json",folder),JSON.stringify(purchase,null,2));assert(response.ok,"Payment uncertain; preserve original request, never automatically pay twice");
  }
 }
 workspace=await request("/v1/terminal/workspace");assert(workspace.access.active);record("paid_terminal_access_active",{newPurchase:paidThisRun,expiresAt:workspace.access.expiresAt});
 if(purchase.attempted){const pending=workspace.pendingPurchases?.find((p:any)=>p.requestId===purchase.requestId);purchase.transaction??=pending?.settlementTx;assert.match(purchase.transaction??"",/^0x[\da-f]{64}$/i);await writeFile(new URL("purchase.json",folder),JSON.stringify(purchase,null,2));
 const receipt=await rpc.waitForTransactionReceipt({hash:purchase.transaction,timeout:90000});assert.equal(receipt.status,"success");let matched=false;
 for(const log of receipt.logs.filter(log=>log.address.toLowerCase()===network.paymentAsset.address!.toLowerCase()))try{const event=decodeEventLog({abi:parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]),data:log.data,topics:log.topics});if(event.args.from.toLowerCase()===account.address.toLowerCase()&&event.args.to.toLowerCase()===cfg.PAY_TO_ADDRESS.toLowerCase()&&event.args.value===1500000n)matched=true;}catch{}
 assert(matched);record("base_exact_transfer_verified",{transaction:purchase.transaction,block:receipt.blockNumber.toString()});}
 stage="indicator-workflow";const list=await request("/v1/terminal/indicators");assert(list.items.length>=2);for(const item of list.items.filter((i:any)=>i.publisher===account.address.toLowerCase()&&i.manifestId.startsWith("qa.")&&i.title==="QA portable flow"&&i.description==="Temporary end-to-end QA publication; removed after this test."))await request("/v1/terminal/indicators/"+item.id,undefined,"DELETE");const manifest=createIndicatorPackage({id:"qa."+randomUUID().replaceAll("-",""),title:"QA portable flow",description:"Temporary end-to-end QA publication; removed after this test.",author:"PULSE QA",kernel:"executed-cvd-v1"});
 const published=await request("/v1/terminal/indicators",{manifest});assert.equal(published.item.publisher,account.address.toLowerCase());const fetched=await request("/v1/terminal/indicators/"+published.item.id);assert.deepEqual(fetched.manifest,manifest);await request("/v1/terminal/indicators/"+published.item.id,undefined,"DELETE");record("real_wallet_publish_load_unpublish");
 if(!process.argv.includes("--only-commerce")){stage="fresh-market-and-ai";const market=await request("/v1/terminal/market?instId=BTC-USDT&timeframe=1H");assert.equal(market.instId,"BTC-USDT");await writeFile(new URL("BTC-1H.json",folder),JSON.stringify(market));
 const f=market.tools.flow,points=f.displayPoints??f.points;if(points.length){const result=evaluateIndicator(manifest,indicatorInputFromMarket(market,"spot",Date.now()));assert(result.points.length>0);record("indicator_evaluates_fresh_btc_executions",{status:result.status,points:result.points.length,source:f.source});}
 for(const [timeframe,preset] of [["15m","day"],["1H","week"],["1Dutc","month"]]){const snap=timeframe==="1H"?market:await request("/v1/terminal/market?instId=BTC-USDT&timeframe="+timeframe);const retained=await request("/v1/terminal/history/session?instId=BTC-USDT&timeframe="+timeframe+"&session="+preset+"&evidenceSnapshotId="+snap.evidenceSnapshotId);assert.equal(retained.session.instId,"BTC-USDT");assert.equal(retained.session.requestedStart,retained.perpetualSession.requestedStart);assert(retained.session.requestedEnd>retained.session.requestedStart);await writeFile(new URL("session-"+preset+".json",folder),JSON.stringify(retained));record("live_session_"+preset,{timeframe,start:retained.session.requestedStart,end:retained.session.requestedEnd,trades:retained.session.totals?.trades??0,complete:retained.session.complete});}
 const answer=await request("/v1/terminal/ask",{instId:market.instId,timeframe:market.timeframe,question:"Briefly explain this captured execution flow: buyer/seller participation, its data window and missing evidence. Do not infer a trade entry.",setupVersionId:market.setupVersionId,evidenceSnapshotId:market.evidenceSnapshotId,inspection:{tool:"flow",stream:"spot"}});assert.match(answer.model,/grok-4\.7/);assert(answer.answer.length>20);await writeFile(new URL("live-ai-answer.json",folder),JSON.stringify(answer,null,2));record("live_ask_pulse_grok_4_7_with_exact_source",{model:answer.model,sources:answer.sources.length});
 } if(process.argv.includes("--commerce")){stage="funded-creator-commerce";const {auditIndicatorCommerce}=await import("./audit-indicator-commerce.js");await auditIndicatorCommerce({origin,cfg,store:terminalStore,buyerToken:token,folder,record});}
 if(process.argv.includes("--browser")){const {runTerminalBrowser}=await import("./audit-terminal-indicator-browser.mjs");await runTerminalBrowser({apiOrigin:origin,owner:account.address,payee:cfg.PAY_TO_ADDRESS,folder:fileURLToPath(folder),expectedExpiry:workspace.access.expiresAt,layoutOnly:true,sign:async(message:string)=>{assert(message.startsWith("PULSE Trading Terminal access\n"));assert(message.includes(`Origin: ${origin}`));assert(message.includes(account.address.toLowerCase()));return account.signMessage({message});},record});}
 await writeFile(new URL("funded-validation.json",folder),JSON.stringify({at:new Date().toISOString(),checks,scope:"Actual local API, durable wallet access, Base USDC settlement if needed, public BTC feed and xAI; no orders or Telegram sends"},null,2));
}catch(error:any){await writeFile(new URL("funded-failure.json",folder),JSON.stringify({at:new Date().toISOString(),stage,message:String(error.message).slice(0,350),checks},null,2));console.error(JSON.stringify({failed:true,stage,errorName:error.name}));process.exitCode=1;}
finally{server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));setTimeout(()=>process.exit(process.exitCode??0),300).unref();}
