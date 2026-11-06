import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {privateKeyToAccount} from "viem/accounts";
import {loadConfig} from "@pulse/config";
import type {TerminalSessionHistory,TerminalLiquidityHistory} from "@pulse/domain";
import {createTerminalRoutes} from "./terminalRoutes.js";
import {TerminalStore,MemoryTerminalStorage,grantTerminalPass} from "./terminalStore.js";
import type {TerminalMarketHistory} from "./terminalMarketHistory.js";
import type {TerminalInspectionEvidence} from "./terminalAiContext.js";

test("retained history requires owner authentication and an active pass, pins evidence and rejects malformed windows",async()=>{
 const now=Date.UTC(2026,10,5,12),account=privateKeyToAccount(`0x${"11".repeat(32)}`),other=privateKeyToAccount(`0x${"22".repeat(32)}`),owner=account.address.toLowerCase();
 const storage=new MemoryTerminalStorage(),store=new TerminalStore(storage,"history-route-test",180);let reads=0,ensures=0,collections=0;
 const history={ensure:async()=>{ensures++;},readSession:async(input:any):Promise<TerminalSessionHistory>=>{reads++;return{version:"terminal-session-history-v1",instId:input.instId,marketType:input.marketType,quantityUnit:input.marketType==="spot"?"base":"contracts",source:"okx-retained-executions",requestedStart:input.start,requestedEnd:input.end,knownAt:now,status:"collecting",priceStep:1,complete:false,intervals:[],gaps:[{start:input.start,end:input.end,reason:"Fixture not yet captured"}],totals:null,rows:[],bars:[],barMs:input.barMs,backfill:{state:"queued",pages:0}};},readLiquidity:async(input:any):Promise<TerminalLiquidityHistory>=>({version:"terminal-liquidity-history-v1",source:"fixture-retained-book",instrumentId:input.instId,marketType:"spot",quantityUnit:"base",requestedStart:input.start,requestedEnd:input.end,observedAt:now,status:"collecting",sampleIntervalMs:60000,priceStep:1,depthLevels:50,frames:[],gaps:[{start:input.start,end:input.end,reason:"No retained observations"}],backfill:{state:"queued",pages:0}}),collect:async()=>{collections++;return{books:0,trades:0};}} as unknown as TerminalMarketHistory;
 const cfg={...loadConfig(),NODE_ENV:"test" as const,FEATURE_TRADING_TERMINAL:true,TERMINAL_HISTORY_ENABLED:true,QUEUE_PROVIDER:"memory" as const,STORAGE_PROVIDER:"memory" as const,X402_MOCK:true,PERSISTENCE_NAMESPACE:"history-route-test"};
 const routes=createTerminalRoutes(cfg,{store,now:()=>now,history:()=>history,telegramRecipient:async()=>null});
 const app=express();app.use(express.json());app.use(routes.publicRouter);app.use(routes.beforePayment);app.use((e:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/v1/terminal`;
 const get=(path:string,token?:string)=>fetch(base+"/"+path,{headers:token?{authorization:`Bearer ${token}`}:{}});
 const login=async(signer:typeof account)=>{const challenge=await routes.runtime!.auth.challenge(signer.address,now);return(await routes.runtime!.auth.verify(challenge.challengeId,await signer.signMessage({message:challenge.message}),now)).token;};
 try{
  assert.equal((await get("history/session?instId=BTC-USDT&timeframe=1H")).status,401);
  const token=await login(account),otherToken=await login(other);
  assert.equal((await get("history/session?instId=BTC-USDT&timeframe=1H",token)).status,403);assert.equal(ensures,0);
  for(const who of [owner,other.address.toLowerCase()])await store.mutate(who,w=>grantTerminalPass(w,{requestId:"history_fixture_pass",duration:"24h",priceUsd:"1.5",amountAtomic:"1500000",network:"base",asset:`0x${"33".repeat(20)}`,paymentId:"history-fixture",purchasedAt:new Date(now).toISOString(),simulated:true}));
  const capture=`tes_${"a".repeat(32)}`,setupVersionId=`gsr_${"b".repeat(32)}`,key=store.key("evidence",`${owner}:${capture}`);
  const unavailable=(id:string)=>({id,label:id,source:"fixture",status:"unavailable" as const,knownAt:now});
  const evidence:TerminalInspectionEvidence={instId:"BTC-USDT",timeframe:"1H",setupVersionId,observedAt:now-1000,tools:{value:unavailable("value"),flow:{...unavailable("flow"),marketType:"spot",points:[]},derivatives:unavailable("derivatives"),liquidity:unavailable("liquidity")}};
  await storage.write(key,evidence,3600);const before=structuredClone(await store.get(owner));
  const response=await get(`history/session?instId=BTC-USDT&timeframe=1H&session=day&evidenceSnapshotId=${capture}`,token);assert.equal(response.status,200);const body=await response.json() as any;
  assert.equal(body.session.quantityUnit,"base");assert.equal(body.perpetualSession.quantityUnit,"contracts");assert.equal(body.session.complete,false);assert.equal(body.setupVersionId,setupVersionId);assert.match(body.evidenceSnapshotId,/^tes_[a-f0-9]{32}$/);assert.equal(reads,2);
  const retained=await storage.read<TerminalInspectionEvidence>(store.key("evidence",`${owner}:${body.evidenceSnapshotId}`));assert.equal(retained?.setupVersionId,setupVersionId);assert.equal(retained?.tools.value.source,"okx-retained-executions");assert.deepEqual(await storage.read(key),evidence);assert.deepEqual(await store.get(owner),before,"Tool history must not modify setups, journal or entitlement");
  assert.equal((await get(`history/session?instId=BTC-USDT&timeframe=1H&evidenceSnapshotId=${capture}`,otherToken)).status,409);
  assert.equal(await storage.read(store.key("evidence",`${other.address.toLowerCase()}:${body.evidenceSnapshotId}`)),null);
  for(const query of ["instId=ETH-USD-SWAP&timeframe=1H","instId=BTC-USDT&timeframe=5m","instId=BTC-USDT&timeframe=1H&session=custom&start=1&end=2","instId=BTC-USDT&timeframe=1H&session=day&unknown=1"]){assert.equal((await get("history/session?"+query,token)).status,400);}
  for(const query of [`instId=BTC-USDT&start=${now}&end=${now-60000}`,`instId=BTC-USDT&start=${now-1}&end=${now}`,`instId=BTC-USDT&hours=2`])assert.equal((await get("history/liquidity?"+query,token)).status,400);
  const book=await get("history/liquidity?instId=BTC-USDT&hours=1",token);assert.equal(book.status,200);assert.equal((await book.json() as any).frames.length,0);
  assert.equal((await fetch(base+"/history/collect",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({instId:"BTC-USDT"})})).status,200);assert.equal(collections,1);
  cfg.TERMINAL_HISTORY_ENABLED=false;assert.equal((await get("history/session?instId=BTC-USDT&timeframe=1H",token)).status,503);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
