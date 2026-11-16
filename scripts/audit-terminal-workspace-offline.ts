import assert from "node:assert/strict";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {config} from "dotenv";
import {privateKeyToAccount} from "viem/accounts";
import {loadConfig} from "../packages/config/src/index.js";
import {createApp} from "../apps/api/src/app.js";
import {MemoryTerminalStorage,TerminalStore,grantTerminalPass} from "../apps/api/src/terminalStore.js";
import {runTerminalStudioBrowser} from "./audit-terminal-studio-browser.mjs";
config({quiet:true});process.env.AUTOMATION_WORKER_ENABLED="0";
const base=loadConfig(),owner=privateKeyToAccount(base.TEST_WALLET_PRIVATE_KEY as `0x${string}`);assert.equal(owner.address.toLowerCase(),base.TEST_WALLET_ADDRESS.toLowerCase());
const publicInput=JSON.parse(await readFile(new URL("./fixtures/terminal-btc-public-inputs.json",import.meta.url),"utf8"));
const {prepareGlobalReport}=await import("../packages/analysis/src/globalReport.js");
const observedAt=new Date(publicInput.observedAt).toISOString();
const source=(bar:string,candles:any[])=>({bar,instId:publicInput.instId,source:publicInput.source,fetchedAt:observedAt,ticker:{priceCurrency:"USDT"},candles});
const primary=source(publicInput.timeframe,publicInput.candles),context=source(publicInput.context.timeframe,publicInput.context.candles),entry=source(publicInput.entryStudy.timeframe,publicInput.entryStudy.candles);
const report=prepareGlobalReport({market:primary,contextMarket:context,hierarchyMarkets:[primary,context,entry],tier:"premium"});report.currentMarket=publicInput.currentMarket;
const fixture={version:"terminal-market-v1",instId:publicInput.instId,timeframe:publicInput.timeframe,observedAt:publicInput.observedAt,report,tools:publicInput.tools,sources:publicInput.sources,observations:[]},clock=fixture.observedAt,folder=new URL("../.tmp/terminal-offline-audit/",import.meta.url);await mkdir(folder,{recursive:true});
const cfg={...base,NODE_ENV:"test" as const,BASE_URL:"http://127.0.0.1:8997",QUEUE_PROVIDER:"memory" as const,STORAGE_PROVIDER:"memory" as const,PERSISTENCE_NAMESPACE:"terminal-offline-audit-"+Date.now(),FEATURE_TRADING_TERMINAL:true,FEATURE_TELEGRAM:false,TERMINAL_BACKGROUND_PAUSED:true,TERMINAL_HISTORY_ENABLED:false,X402_MOCK:true,enabledNetworks:["base"] as any,REDIS_URL:"",KV_REST_API_URL:"",KV_REST_API_TOKEN:""};
const store=new TerminalStore(new MemoryTerminalStorage(),cfg.PERSISTENCE_NAMESPACE,180);
await store.mutate(owner.address,value=>{grantTerminalPass(value,{requestId:"offline-fixture-pass",duration:"24h",priceUsd:"1.5",amountAtomic:"1500000",network:"base",asset:"USDC",paymentId:"offline-fixture-only",purchasedAt:new Date(clock).toISOString(),simulated:true});});
const app=createApp(cfg,{startDurableWorker:false,terminal:{store,now:()=>clock,snapshot:async()=>structuredClone(fixture),quote:async()=>({instId:"BTC-USDT",last:fixture.report.currentMarket?.quote?.price??fixture.report.snapshot.price,ts:clock}) as any,candles:async()=>[]}});
const server=app.listen(8997,"127.0.0.1");await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
// Local catalog fixture for the purchase-review UI. No settlement is made.
const qaCreator=privateKeyToAccount(`0x${"22".repeat(32)}`);
await store.mutate(qaCreator.address,value=>{grantTerminalPass(value,{requestId:"fixture-creator-pass",duration:"24h",priceUsd:"1.5",amountAtomic:"1500000",network:"base",asset:"USDC",paymentId:"fixture-creator-pass",purchasedAt:new Date(clock).toISOString(),simulated:true});});
const localPost=async(path:string,body:unknown,token?:string)=>{const response=await fetch(cfg.BASE_URL+"/v1/terminal/"+path,{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},body:JSON.stringify(body)});const result=await response.json();assert(response.ok,JSON.stringify(result));return result;};
const challenge=await localPost("auth/challenge",{wallet:qaCreator.address}),session=await localPost("auth/verify",{challengeId:challenge.challengeId,signature:await qaCreator.signMessage({message:challenge.message})});
const {createGraphIndicatorPackage,indicatorGraphTemplates}=await import("../packages/domain/src/index.js");
const paidManifest=createGraphIndicatorPackage({...indicatorGraphTemplates()[0],id:"qa.offline-paid-studio",title:"QA paid EMA study",author:"PULSE Fixture Publisher"});
await localPost("indicators",{manifest:paidManifest,offer:{priceUsdc:"0.001",description:"Offline fixture version for purchase review without payment."}},session.token);
const checks:any[]=[];
try{await runTerminalStudioBrowser({apiOrigin:cfg.BASE_URL,owner:owner.address,payee:cfg.PAY_TO_ADDRESS,folder:decodeURIComponent(folder.pathname).replace(/^\/(\w:)/,"$1"),sign:async(message:string)=>{assert(message.startsWith("PULSE Trading Terminal access\n"));assert(message.includes("Origin: "+cfg.BASE_URL));return owner.signMessage({message});},record:(check:string,details:any)=>{checks.push({check,...details});console.log(check);}});await writeFile(new URL("validation.json",folder),JSON.stringify({at:new Date().toISOString(),checks,scope:"Offline real-app workflow with TEST_WALLET_ADDRESS identity; simulated Base 1.50 USDC pass; captured BTC input; no payment, Railway or Redis"},null,2));}
finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
