import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalDesignFixture } from "../../../packages/domain/dist/globalReport.fixtures.js";
import { formatTelegramResearch, telegramResearchMessage, telegramResearchCaption, telegramResearchOrder, renderTelegramResearchChart } from "./telegramResearch.js";
import { fullReportDelivery } from "./reportDelivery.js";
import { configureTelegramReportReader, telegramDeliveryToken, deliverTelegramReportDurably, runTelegramDeliveryCycle } from "./telegram.js";

test("the Telegram photo caption preserves setup expiry alongside its candle confirmation",()=>{
  for(const lang of ["en","zh"] as const){const report=globalDesignFixture("pro",lang);report.setup.expiresAt=Date.parse("2026-10-09T00:00:00Z");const caption=telegramResearchCaption(report);assert.ok(caption.includes("2026-10-09T00:00:00.000Z"));assert.ok(caption.includes(lang==="en"?"completed 1H close":"1H 完整收盘"));assert.ok(caption.includes("113.12"));assert.ok(caption.length<=1024);}
});

test("Telegram terminal setups retain status without promising pending protection",()=>{
  for(const state of ["cancelled","expired"] as const)for(const lang of ["en","zh"] as const){const report=globalDesignFixture("pro",lang);report.setup.state=state;const expected=lang==="zh"?state==="cancelled"?"计划已取消":"计划已过期":state==="cancelled"?"Plan cancelled":"Plan expired";for(const output of [telegramResearchMessage(report),formatTelegramResearch(report)]){assert.ok(output.includes(expected));assert.doesNotMatch(output,/Pending the observed retest|等待实际回测/);}assert.ok(telegramResearchCaption(report).length<=1024);assert.ok(renderTelegramResearchChart(report)!.length<10_000_000);}
});

test("Telegram keeps timeframe and all conditions when the optional summary is long",()=>{
  for(const lang of ["en","zh"] as const){
    const report=globalDesignFixture("pro",lang);report.narrative.headline="Market view";report.narrative.summary="<summary & evidence> ".repeat(500);
    const message=telegramResearchMessage(report),caption=telegramResearchCaption(report),txt=formatTelegramResearch(report);
    assert.ok(message.length<=3900);assert.ok(caption.length<=1024);
    const duration=lang==="en"?"1-hour candles":"每根 K 线 1 小时";
    assert.ok(message.includes(duration)&&caption.includes(duration)&&txt.includes(duration));
    assert.ok(message.indexOf("Market view")<message.indexOf(lang==="en"?"Spot plan":"现货计划"));
    assert.equal(message.split("\n").filter(line=>line.includes(lang==="en"?"Spot plan":"现货计划")).length,1);
    assert.ok(message.includes("&lt;summary &amp; evidence&gt;"));assert.ok(message.includes("113.12"));
    assert.ok(message.includes(lang==="en"?"4-hour candles":"每根 K 线 4 小时"));
    assert.ok(!message.includes("<summary"));
  }
});

test("Quick and Pro Telegram images, captions, overview and TXT resolve the same setup IDs",()=>{for(const tier of ["quick","pro"] as const)for(const lang of ["en","zh"] as const){const report=globalDesignFixture(tier,lang),message=telegramResearchMessage(report),caption=telegramResearchCaption(report),txt=formatTelegramResearch(report),png=renderTelegramResearchChart(report)!;assert.deepEqual(telegramResearchOrder(report),["chart","overview","document"]);assert.ok(message.length<=3900);assert.ok(caption.length<=1024);for(const price of ["117.3","120.56","124.8"]){assert.ok(message.includes(price));assert.ok(caption.includes(price));assert.ok(txt.includes(price));}assert.ok(message.includes("113.12"));assert.match(message,lang==="en"?/Cancel: completed 1H close below/:/取消/);assert.match(message,lang==="en"?/Pending the observed retest/:/等待实际回测/);assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(new DataView(png.buffer,png.byteOffset).getUint32(16),1300);assert.ok(png.length<10000000);assert.ok(txt.includes(tier==="pro"?"Global Pro":"Global Quick"));}});
test("full paid delivery excludes conflicting legacy numbers, raw provider text and embedded images",()=>{const report={global:globalDesignFixture("pro"),analysis:{summary:"WRONG_LEGACY",targets:[{price:777}]},usage:{private:"USAGE"},rawText:"RAW_PROVIDER",chartImageBase64:"BASE64_PROVIDER",recoveryToken:"RECOVERY"};const markdown=fullReportDelivery(report).reportMarkdown;for(const secret of ["WRONG_LEGACY","777","USAGE","RAW_PROVIDER","BASE64_PROVIDER","RECOVERY"])assert.ok(!markdown.includes(secret));assert.match(markdown,/117.3/);assert.match(markdown,/Cancel: completed 1H close below 113.12/);assert.match(markdown,/Pro evidence/);});
test("a failed first chart still delivers its summary and TXT; retry sends only the missing chart",async()=>{const previous={fetch:globalThis.fetch,now:Date.now,token:process.env.TELEGRAM_BOT_TOKEN,secret:process.env.TELEGRAM_WEBHOOK_SECRET};process.env.TELEGRAM_BOT_TOKEN="global-test-token";process.env.TELEGRAM_WEBHOOK_SECRET="global-test-secret";let now=previous.now(),photo=0;Date.now=()=>now;const calls:string[]=[];globalThis.fetch=(async(input)=>{const method=String(input).split("/").at(-1)!;calls.push(method);return Response.json(method==="sendPhoto"&&photo++===0?{ok:false}:{ok:true});}) as typeof fetch;configureTelegramReportReader(async()=>globalDesignFixture());try{const id=randomUUID(),delivery=telegramDeliveryToken(54321,process.env.TELEGRAM_WEBHOOK_SECRET);assert.equal((await deliverTelegramReportDurably(id,delivery,"","https://pulse.test/saved","saved-global")).queued,true);assert.deepEqual(calls,["sendPhoto","sendMessage","sendDocument"]);now+=61000;await runTelegramDeliveryCycle();assert.deepEqual(calls,["sendPhoto","sendMessage","sendDocument","sendPhoto"]);assert.equal((await deliverTelegramReportDurably(id,delivery,"","https://pulse.test/saved","saved-global")).delivered,true);assert.equal(calls.length,4);}finally{globalThis.fetch=previous.fetch;Date.now=previous.now;configureTelegramReportReader(async()=>null);for(const key of ["token","secret"] as const){const name=key==="token"?"TELEGRAM_BOT_TOKEN":"TELEGRAM_WEBHOOK_SECRET";if(previous[key]===undefined)delete process.env[name];else process.env[name]=previous[key];}}});
