import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {loadConfig} from "@pulse/config";
import {globalDesignFixture} from "../../../packages/domain/dist/globalReport.fixtures.js";
import {researchText,presentResearch} from "@pulse/domain";
import {createGlobalExportRouter} from "./globalExportRoutes.js";
import {TelegramCommerce} from "./telegramCommerce.js";
import {MemoryJobStore,MemoryReportStore} from "./jobs.js";
import {createHmac} from "node:crypto";

test("private mobile exports preserve PNG/TXT, resist tampering and expire without repaying or mutating reports",async()=>{
  const report=globalDesignFixture(),before=JSON.stringify(report),token="private-recovery-token-never-in-url",access={kind:"job",id:"saved",token};let allowed=true,clock=Date.now();
  const app=express();app.use(express.json());const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const origin=`http://127.0.0.1:${(server.address()as {port:number}).port}`,cfg={...loadConfig(),BASE_URL:origin,REPORT_ENCRYPTION_KEY:"export-test-key",NODE_ENV:"test" as const};
  const deps={now:()=>clock,resolveReport:async(a:{token:string})=>allowed&&a.token===token?{global:report}:null};
  app.use(createGlobalExportRouter(cfg,deps));app.use(createGlobalExportRouter(cfg,{...deps,path:"/other/export"}));
  const issue=async(body:unknown)=>fetch(origin+"/v1/global/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  try{
    assert.equal((await issue({format:"txt",lang:"en"})).status,400);
    assert.equal((await issue({access:{...access,token:"incorrect-private-token"},format:"txt",lang:"en"})).status,404);
    assert.equal((await issue({access,format:"png",lang:"en",svg:"<svg/>"})).status,400);
    const response=await issue({access,format:"txt",lang:"en"});assert.equal(response.status,200);const ticket=await response.json();assert.equal(ticket.paymentRequired,false);assert.equal(ticket.modelCalls,0);assert.ok(!ticket.url.includes(token));assert.equal(ticket.path,new URL(ticket.url).pathname);
    const raw=await fetch(ticket.url,{headers:{Origin:"https://web.telegram.org"}});assert.equal(raw.status,200);assert.match(raw.headers.get("content-disposition")!,/attachment; filename="PULSE-Global/);assert.equal(raw.headers.get("access-control-allow-origin"),"https://web.telegram.org");assert.match(raw.headers.get("cache-control")!,/no-store/);assert.equal(await raw.text(),researchText(presentResearch({global:report})));
    const encrypted=ticket.url.split("/").at(-1),changed=encrypted.slice(0,40)+(encrypted[40]==="A"?"B":"A")+encrypted.slice(41);assert.equal((await fetch(origin+"/v1/global/export/file/"+changed)).status,404);assert.equal((await fetch(origin+"/other/export/file/"+encrypted)).status,404);
    for(const appearance of ["light","dark"]){const r=await issue({access,format:"png",lang:"en",appearance,options:{layers:{waves:false}}});assert.equal(r.status,200);const data=await r.json(),image=await fetch(data.url);assert.equal(image.status,200);assert.equal(image.headers.get("content-type"),"image/png");const png=Buffer.from(await image.arrayBuffer());assert.equal(png.subarray(1,4).toString(),"PNG");const width=png.readUInt32BE(16),height=png.readUInt32BE(20);assert.ok(width>2600);assert.ok(width*height<=16_000_000);}
    allowed=false;assert.equal((await fetch(ticket.url)).status,404);allowed=true;clock+=300001;assert.equal((await fetch(ticket.url)).status,410);assert.equal(JSON.stringify(report),before);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("TON native exports verify the signed Telegram account, order ownership, surface and revocation without new work",async()=>{
  const sign=(user:number,date=Math.floor(Date.now()/1000))=>{const p=new URLSearchParams({auth_date:String(date),user:JSON.stringify({id:user,first_name:"Export fixture"})});const data=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");p.set("hash",createHmac("sha256",createHmac("sha256","WebAppData").update("fixture-token").digest()).update(data).digest("hex"));return p.toString();};
  const app=express();app.use(express.json());const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const origin=`http://127.0.0.1:${(server.address()as {port:number}).port}`;
  const cfg={...loadConfig(),BASE_URL:origin,REPORT_ENCRYPTION_KEY:"export-telegram-fixture-key",FEATURE_TELEGRAM:true};
  const jobs=new MemoryJobStore(),reports=new MemoryReportStore();let work=0;
  const acquired=await jobs.acquire({idempotencyKey:"export-fixture",requestHash:"export-fixture",resourceUrl:"/fixture",network:"telegram:stars",networkKey:"base",mode:"spot",tier:"premium",payer:"telegram:123",input:{instId:"TON-USDT",timeframe:"1H"},requesterIp:"fixture",maxRegenerationAttempts:2});
  const record=await reports.save("telegram:123",{global:globalDesignFixture()});await jobs.attachReport(acquired.job.id,record.id);
  const commerce=new TelegramCommerce(cfg,{jobs,reports,wakeWorker:()=>{work++;},validateGlobal:input=>input},"fixture-token",async()=>{work++;throw Error("No Telegram messages or purchases in an export");},()=>"fixture",{allowEvm:false,apiPrefix:"/v1/telegram/ton"});
  const memory=(commerce as unknown as {memory:Map<string,Record<string,unknown>>}).memory;
  const orderId="12345678-1234-4123-8123-123456789abc";
  memory.set(orderId,{id:orderId,userId:123,serviceId:"global-pro",stars:15,input:{instId:"TON-USDT",timeframe:"1H"},networkKey:"base",surface:"ton",createdAt:Date.now(),chargeId:"existing-fixture-payment",jobId:acquired.job.id});
  app.use(commerce.router());
  const issue=async(token:string,surface="ton")=>fetch(origin+"/v1/telegram/ton/global-export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access:{kind:"telegram",id:orderId,token,surface},format:"txt",lang:"en"})});
  try{
    const ok=await issue(sign(123));assert.equal(ok.status,200);const data=await ok.json();assert.equal((await fetch(data.url)).status,200);
    assert.equal((await issue(sign(456))).status,404);assert.equal((await issue(sign(123)+"&tampered=1")).status,404);assert.equal((await issue(sign(123),"pulse")).status,404);assert.equal((await issue(sign(123,Math.floor(Date.now()/1000)-3601))).status,404);
    memory.get(orderId)!.refunded=true;assert.equal((await fetch(data.url)).status,404);assert.equal(work,0);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
