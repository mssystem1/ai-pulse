import test from "node:test";
import assert from "node:assert/strict";
import { inspectTelegramConfiguration, telegramMenu, telegramReportUrl } from "./telegram.js";
import { createTelegramRouter } from "./telegram.js";
import express from "express";
import { createHmac } from "node:crypto";
import { deliverTelegramReportDurably, runTelegramDeliveryCycle } from "./telegram.js";
import type { AppConfig } from "@pulse/config";

test("Telegram buttons open canonical destinations, not a stale configured tab", () => {
  const menu = telegramMenu("https://pulse.test/global?service=global&job=old#old", "test-capability", "/reports@pulsemi_bot");
  const first = menu.inline_keyboard[0][0];
  assert.equal(first.text, "My reports");
  const url = new URL(first.web_app.url);
  assert.equal(url.pathname, "/overview");
  assert.equal(url.hash, "#reports");
  assert.equal(url.searchParams.get("tg"), "test-capability");
  assert.equal(url.searchParams.has("job"), false);
  assert.equal(url.searchParams.has("service"), false);
  assert.deepEqual(new Set(menu.inline_keyboard.map(row => new URL(row[0].web_app.url).pathname)), new Set(["/overview", "/global", "/prediction", "/safety", "/spot", "/autopilot"]));
});

test("Telegram report delivery opens the readable frontend with a fragment capability", () => {
  const url = new URL(telegramReportUrl("https://pulse.test/global?old=1#old", "safe-test-share"));
  assert.equal(url.pathname, "/shared-report");
  assert.equal(url.search, "");
  assert.equal(url.hash, "#share=safe-test-share");
  assert.throws(() => telegramReportUrl("http://pulse.test", "share"), /HTTPS/);
});

test("Telegram configuration fails closed instead of using the API BASE_URL as a Mini App", () => {
  const inspected = inspectTelegramConfiguration({
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_BOT_USERNAME: "@pulsemi_bot",
    TELEGRAM_WEBHOOK_SECRET: "secret",
  });
  assert.equal(inspected.complete, false);
  assert.equal(inspected.miniAppUrl, "");
  assert.deepEqual(inspected.missing, ["TELEGRAM_MINI_APP_URL"]);
});

test("Telegram configuration requires an absolute HTTPS Mini App URL", () => {
  const base = {
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_BOT_USERNAME: "pulsemi_bot",
    TELEGRAM_WEBHOOK_SECRET: "secret",
  };
  assert.equal(inspectTelegramConfiguration({ ...base, TELEGRAM_MINI_APP_URL: "http://ai-pulse.tech" }).miniAppUrlError, "TELEGRAM_MINI_APP_URL must use HTTPS");
  assert.equal(inspectTelegramConfiguration({ ...base, TELEGRAM_MINI_APP_URL: "https://www.ai-pulse.tech" }).complete, true);
});

test("report delivery retries a failed send and suppresses an already confirmed duplicate", async () => {
  const saved = { token:process.env.TELEGRAM_BOT_TOKEN, secret:process.env.TELEGRAM_WEBHOOK_SECRET };
  process.env.TELEGRAM_BOT_TOKEN="fixture-token";process.env.TELEGRAM_WEBHOOK_SECRET="fixture-secret";
  const originalFetch=globalThis.fetch, originalNow=Date.now;
  let now=originalNow(), calls=0;
  Date.now=()=>now;
  const payload=`123.${now+86400000}`;
  const capability=`${payload}.${createHmac("sha256","fixture-secret").update(payload).digest("base64url")}`;
  globalThis.fetch=async()=>{calls++;return Response.json(calls===1?{ok:false,description:"Temporary failure"}:{ok:true});};
  try {
    const result=await deliverTelegramReportDurably("fixture-report-delivery",capability,"Complete report ready","https://pulse.test/shared-report#share=fixture");
    assert.equal(result.queued,true);
    now+=61000;await runTelegramDeliveryCycle();assert.equal(calls,2);
    await deliverTelegramReportDurably("fixture-report-delivery",capability,"Complete report ready","https://pulse.test/shared-report#share=fixture");
    assert.equal(calls,2);
  } finally {
    globalThis.fetch=originalFetch;Date.now=originalNow;
    if(saved.token===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=saved.token;
    if(saved.secret===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=saved.secret;
  }
});

test("webhook ignores groups, verifies its secret, acknowledges callbacks and deduplicates private updates", async () => {
  const env = { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_BOT_USERNAME: "test_bot", TELEGRAM_WEBHOOK_SECRET: "test-secret", TELEGRAM_MINI_APP_URL: "https://pulse.test" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const realFetch = globalThis.fetch;
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      calls.push({ method: url.split("/").at(-1)!, payload: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const app = express(); app.use(express.json()); app.use(createTelegramRouter({ FEATURE_TELEGRAM: true } as AppConfig));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object");
    const post = (body: unknown, secret = "test-secret") => realFetch(`http://127.0.0.1:${address.port}/v1/telegram/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(body) });
    assert.equal((await post({}, "wrong")).status, 401);
    await post({ update_id: 9001, message: { chat: { id: -1, type: "group" }, text: "/start" } });
    assert.equal(calls.length, 0);
    const update = { update_id: 9002, callback_query: { id: "callback", data: "/reports", message: { chat: { id: 123, type: "private" } } } };
    assert.equal((await post(update)).status, 200);
    assert.deepEqual(calls.map(call => call.method), ["answerCallbackQuery", "sendMessage"]);
    assert.match(String(calls[1].payload.text), /Sync with wallet/);
    const again = await post(update); assert.equal((await again.json() as { duplicate?: boolean }).duplicate, true);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(env)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
