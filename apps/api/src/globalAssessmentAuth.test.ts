import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "@pulse/config";
import { qualifiedGlobalFixture } from "../../../packages/analysis/dist/globalAssessment.fixtures.js";
import { createApp } from "./app.js";
import { MemoryJobStore, MemoryReportStore } from "./jobs.js";

test("rechecks require a saved-report capability, respect share revocation and never mutate purchased evidence",async()=>{
  const keys=["QUEUE_PROVIDER","STORAGE_PROVIDER","KV_REST_API_URL","KV_REST_API_TOKEN"] as const,previous=new Map(keys.map(k=>[k,process.env[k]]));
  process.env.QUEUE_PROVIDER="memory";process.env.STORAGE_PROVIDER="memory";process.env.KV_REST_API_URL="";process.env.KV_REST_API_TOKEN="";
  const {report,market}=qualifiedGlobalFixture(),jobs=new MemoryJobStore(),reports=new MemoryReportStore(),payer="0x1111111111111111111111111111111111111111";
  const acquired=await jobs.acquire({idempotencyKey:"assessment-auth",requestHash:"synthetic",resourceUrl:"/v1/analysis/spot/standard",network:"eip155:8453",networkKey:"base",mode:"spot",tier:"standard",payer,input:{instId:"BTC-USDT",timeframe:"1H"},requesterIp:"127.0.0.1",maxRegenerationAttempts:0});
  const record=await reports.save(payer,{global:report});await jobs.attachReport(acquired.job.id,record.id);
  const before=JSON.stringify(await reports.read(record)),jobBefore=JSON.stringify(await jobs.get(acquired.job.id));let marketReads=0;
  const cfg={...loadConfig(),NODE_ENV:"test" as const,X402_MOCK:true,paymentMode:"mock" as const,QUEUE_PROVIDER:"memory" as const,STORAGE_PROVIDER:"memory" as const,REPORT_SHARE_LINK_ENABLED:true};
  const app=createApp(cfg,{persistence:{jobs,reports},startDurableWorker:false,spotContext:async()=>{marketReads++;return market;}}),server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));const port=(server.address() as {port:number}).port;
  const post=async(body:unknown)=>fetch(`http://127.0.0.1:${port}/v1/global/setup-assessment`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  try{
    assert.equal((await post({access:{kind:"job",id:acquired.job.id,token:"invalid-capability-00000"}})).status,404);assert.equal(marketReads,0);
    assert.equal((await post({access:{kind:"history",id:acquired.job.id,token:"invalid-history-session"}})).status,404);assert.equal(marketReads,0);
    const capability={kind:"job",id:acquired.job.id,token:acquired.recoveryToken};
    const valid=await post({access:capability});assert.equal(valid.status,200);assert.match(valid.headers.get("Cache-Control")??"",/no-store/);
    const body=await valid.text();assert.ok(body.includes("technical_valid"));assert.ok(!body.includes(acquired.recoveryToken!));assert.ok(!body.includes(payer));
    const share=await reports.createShare(record.id);assert.equal((await post({access:{kind:"share",token:share.token}})).status,200);
    await reports.revokeShare(share.token);const reads=marketReads;assert.equal((await post({access:{kind:"share",token:share.token}})).status,404);assert.equal(marketReads,reads);
    assert.equal((await post({access:capability,executionCostsBps:0,report:{global:report}})).status,400);assert.equal(marketReads,reads,"Client report/fee injection must be rejected before a provider call");
    assert.equal(JSON.stringify(await reports.read(record)),before);assert.equal(JSON.stringify(await jobs.get(acquired.job.id)),jobBefore);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
