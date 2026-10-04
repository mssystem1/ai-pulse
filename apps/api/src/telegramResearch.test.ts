import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { presentResearch, researchIdentity, researchNumber, researchChartSvg } from "@pulse/domain";
import { formatTelegramResearch, telegramResearchMessage, telegramResearchFilename, telegramHistoryLabel, renderTelegramResearchChart } from "./telegramResearch.js";
import { globalResearchFixture as global, predictionResearchFixture as prediction, riskResearchFixture as risk } from "./telegramResearch.fixtures.js";
import { configureTelegramReportReader, deliverTelegramReportDurably, telegramDeliveryToken, runTelegramDeliveryCycle } from "./telegram.js";

test("all five Telegram exports contain public research sections and exclude provider and transport fields",()=>{
  for(const [serviceId,report] of [["global-quick",global],["global-pro",global],["prediction-quick",prediction],["prediction-pro",prediction],["risk-guard",risk]] as const){
    const txt=formatTelegramResearch(report,{serviceId});
    assert.match(txt,/PULSE research report/);assert.match(txt,/SUMMARY|confirmation|Public evidence|Market liquidity/i);
    assert.doesNotMatch(txt,/RAW_PROVIDER_DUMP|UNNECESSARY_DEBUG|PRIVATE_DELIVERY_TOKEN|RAW_IMAGE_UPLOAD|totalTokens|analysis \/|candles|internal-check-id|internal-component-key/);
    const message=telegramResearchMessage(report,{serviceId});assert.ok(message.length<=3900);assert.doesNotMatch(message,/\/ elliott|RAW_PROVIDER|PRIVATE_DELIVERY|<script>/);
    assert.match(txt,/DISCLAIMER/);
  }
  const txt=formatTelegramResearch(global);assert.match(txt,/BTC-USDT · 4H · Global Pro/);assert.match(txt,/Entry \/ trigger: 63,100/);assert.match(txt,/Stop loss: 60,000/);assert.match(txt,/A 4H close below support/);assert.match(txt,/A-B-C correction/);assert.match(txt,/No verified asset mapping/);assert.match(txt,/Thin liquidity/);
});
test("prediction keeps probability, counter-case, resolution and execution caveats",()=>{
  const txt=formatTelegramResearch(prediction);assert.match(txt,/Fair probability range: 38–47%/);assert.match(txt,/Probability: 42% · Bid: 40% · Ask: 44%/);assert.match(txt,/Resolution timing is uncertain/);assert.match(txt,/change in resolution rules/);assert.match(txt,/Unavailable source: open interest/);assert.match(txt,/underlying 4H asset structure/);
  assert.match(telegramResearchMessage(prediction),/Do not trade stale evidence/);
});
test("Risk Guard retains source coverage, separate provider assessment and unknowns",()=>{
  const txt=formatTelegramResearch(risk);assert.match(txt,/Provider score \(separate from PULSE\): 72/);assert.match(txt,/Contract scan · unavailable/);assert.match(txt,/Holder concentration unavailable/);assert.match(txt,/not a contract audit/);assert.match(txt,/Incomplete evidence cannot establish safety/);assert.match(txt,/authority change could prevent exit/);
});
test("history and downloads distinguish paid requests even before a report exists",()=>{
  const identity=researchIdentity({serviceId:"global-pro",input:{instId:"XAAPL-USDT",timeframe:"1D"}});
  const label=telegramHistoryLabel({...identity,status:"completed",createdAt:Date.parse("2026-10-04T08:30:00Z")});
  assert.match(label,/XAAPL-USDT · 1D · Global Pro · Ready/);assert.match(label,/10-04 08:30 UTC/);
  assert.equal(researchIdentity({serviceId:"prediction-quick",input:{primaryMarketId:"CaseSensitiveID"}}).subject,"CaseSensitiveID");
  assert.match(researchIdentity({serviceId:"risk-guard",input:{address:"0x"+"a".repeat(40)},networkKey:"base"}).label,/0xaaaa…aaaa · base · Risk Guard/);
  assert.equal(telegramResearchFilename(global),"PULSE-Global-Pro-BTC-USDT-4H.txt");
});
test("missing and malformed numeric evidence never becomes a zero price or probability",()=>{
  for(const value of [null,undefined,"",false,{},NaN,Infinity])assert.equal(researchNumber(value),undefined);
  assert.equal(researchNumber(0),0);
  const altered=structuredClone(prediction);(altered.analysis.fairProbabilityRange as any).low=null;(altered.predictionContext.markets[0].outcomes[0].features as any).midpointProbability=null;
  const txt=formatTelegramResearch(altered);assert.doesNotMatch(txt,/Probability: 0%|Fair probability range: 0/);assert.match(txt,/Probability: Unavailable/);
});
test("bounded Telegram HTML escapes markup, preserves Unicode and reserves space for risk conditions",()=>{
  const altered=structuredClone(global);altered.analysis.summary="<&> 😀 ".repeat(1500);altered.analysis.headline="<script>".repeat(500);altered.analysis.targets=Array.from({length:30},()=>({label:"Very long target",price:100000,rationale:"Targets ".repeat(100)}));
  const html=telegramResearchMessage(altered);assert.ok(html.length<=3900);assert.ok(!/[\uD800-\uDFFF]/u.test(html));assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/A 4H close below support/);assert.match(html,/Thin liquidity/);assert.match(html,/not financial advice/);
});
test("chart uses only a valid premium snapshot and renders a labelled PNG with no external references",()=>{
  const svg=researchChartSvg(global)!;assert.match(svg,/BTC-USDT · 4H/);assert.match(svg,/Count invalidation/);assert.match(svg,/A-B-C correction/);assert.doesNotMatch(svg,/https:\/\/|RAW_|PRIVATE_/);
  const png=renderTelegramResearchChart(global)!;assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(new DataView(png.buffer,png.byteOffset).getUint32(16),1200);assert.equal(new DataView(png.buffer,png.byteOffset).getUint32(20),680);assert.ok(png.length<10_000_000);
  assert.match(researchChartSvg(prediction)!,/4H underlying asset/);
  assert.equal(researchChartSvg(global,{serviceId:"global-quick"}),null);assert.equal(researchChartSvg(risk),null);assert.equal(researchChartSvg({...global,chart:{candles:[{close:null,low:null,high:null},{close:0,low:0,high:0}]}}),null);
  assert.equal(researchChartSvg({...prediction,underlyingSpot:{status:"unmapped"}}),null);
});
test("durable chart retry does not resend a delivered document or overview",async()=>{
  const originalFetch=globalThis.fetch,originalNow=Date.now,saved={token:process.env.TELEGRAM_BOT_TOKEN,secret:process.env.TELEGRAM_WEBHOOK_SECRET};
  process.env.TELEGRAM_BOT_TOKEN="research-fixture-token";process.env.TELEGRAM_WEBHOOK_SECRET="research-fixture-secret";
  let now=originalNow(),photos=0;Date.now=()=>now;const calls:{method:string;payload:Record<string,any>}[]=[];
  globalThis.fetch=(async(input,init)=>{const method=String(input).split("/").at(-1)!;const payload=init?.body instanceof FormData?Object.fromEntries(init.body.entries()):JSON.parse(String(init?.body));calls.push({method,payload});return Response.json(method==="sendPhoto"&&photos++===0?{ok:false}:{ok:true});}) as typeof fetch;
  configureTelegramReportReader(async()=>global);
  try {
    const id=randomUUID(),delivery=telegramDeliveryToken(123,process.env.TELEGRAM_WEBHOOK_SECRET);
    const first=await deliverTelegramReportDurably(id,delivery,"Old summary","https://pulse.test/report","report-fixture");assert.equal(first.queued,true);
    now+=61_000;await runTelegramDeliveryCycle();
    assert.equal(calls.filter(c=>c.method==="sendDocument").length,1);assert.equal(calls.filter(c=>c.method==="sendMessage").length,1);assert.equal(calls.filter(c=>c.method==="sendPhoto").length,2);
    assert.match(await calls.find(c=>c.method==="sendDocument")!.payload.document.text(),/BTC-USDT · 4H/);assert.equal(calls.find(c=>c.method==="sendMessage")!.payload.parse_mode,"HTML");
    await deliverTelegramReportDurably(id,delivery,"Duplicate","https://pulse.test/report","report-fixture");assert.equal(calls.length,4);
  }finally{globalThis.fetch=originalFetch;Date.now=originalNow;configureTelegramReportReader(async()=>null);if(saved.token===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=saved.token;if(saved.secret===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=saved.secret;}
});
