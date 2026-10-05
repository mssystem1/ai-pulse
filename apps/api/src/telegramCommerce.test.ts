import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import { z } from "zod";
import type { AppConfig } from "@pulse/config";
import { MemoryJobStore, MemoryReportStore } from "./jobs.js";
import { createTelegramRouter, telegramServiceMenu } from "./telegram.js";
import { validateTelegramInitData, TELEGRAM_SERVICES, TelegramCommerce } from "./telegramCommerce.js";

function signedData(userId = 123, date = Math.floor(Date.now() / 1000), token = "test-token") {
  const params = new URLSearchParams({ auth_date: String(date), query_id: "fixture", user: JSON.stringify({ id: userId, first_name: "Alex" }) });
  const data = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => `${key}=${value}`).join("\n");
  params.set("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(token).digest()).update(data).digest("hex"));
  return params.toString();
}
test("signed Mini App identity rejects tampering, old sessions, future sessions and duplicate fields", () => {
  assert.equal(validateTelegramInitData(signedData(), "test-token").id, 123);
  assert.throws(() => validateTelegramInitData(signedData().replace("Alex", "Eve"), "test-token"), /Invalid Telegram session/);
  assert.throws(() => validateTelegramInitData(signedData(123, Math.floor(Date.now()/1000)-3601), "test-token"), /expired/);
  assert.throws(() => validateTelegramInitData(signedData(123, Math.floor(Date.now()/1000)+90), "test-token"), /expired/);
  assert.throws(() => validateTelegramInitData(`${signedData()}&auth_date=1`, "test-token"), /Invalid/);
  assert.throws(() => validateTelegramInitData(signedData(-1), "test-token"), /Invalid Telegram user/);
});
test("service menu exposes all five services and strips stale navigation secrets", () => {
  const menu = telegramServiceMenu("https://pulse.test/global?job=old&recoveryToken=secret#old", "delivery");
  const buttons = menu.inline_keyboard.flat().filter(item => "web_app" in item);
  assert.equal(buttons.length, 8);
  const urls = buttons.map(button => new URL(button.web_app!.url));
  assert.ok(urls.every(url => url.pathname === "/miniapp" && !url.hash && !url.searchParams.has("job") && !url.searchParams.has("recoveryToken")));
  assert.deepEqual(urls.map(url => url.searchParams.get("service")).filter(Boolean), TELEGRAM_SERVICES.map(service => service.id));
});

test("Arc Stars checkout pins Risk Guard chain 5042 and native Global market identity", async t => {
  const env = { TELEGRAM_STARS_ENABLED: "1", TELEGRAM_STARS_RISK_GUARD: "25", TELEGRAM_STARS_GLOBAL_QUICK: "25" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
  const jobs = new MemoryJobStore(), reports = new MemoryReportStore();
  let invoices = 0;
  const commerce = new TelegramCommerce({ FEATURE_TELEGRAM: true, NODE_ENV: "test", PAID_REGENERATION_MAX_ATTEMPTS: 2 } as AppConfig,
    { jobs, reports, wakeWorker: () => {}, validateGlobal: input => z.object({ instId: z.string().max(64), timeframe: z.string(), lang: z.literal("en") }).parse(input) },
    "fixture-token", async method => { if (method === "createInvoiceLink") invoices++; return { result: method === "createInvoiceLink" ? "https://t.me/$fixture" : true }; }, () => "fixture-delivery",
    { appUrl: "https://pulse.test", webhookSecret: "fixture-secret" });
  const address = "0xeb64987643db71c76b2a2be7e723decc995e5b37";
  const nativeId = "COOL.EB64987643DB71C76B2A2BE7E723DECC995E5B37-USDC";
  await assert.rejects(commerce.createInvoice(123, "global-quick", { instId: nativeId, timeframe: "1H", lang: "en" }, "base"), /Arc Mainnet/);
  assert.equal(invoices, 0, "a mismatched native market cannot create a checkout");
  const paid = async (orderId: string, charge: string) => commerce.handleUpdate({ message: { chat: { id: 123, type: "private" }, from: { id: 123 }, successful_payment: { currency: "XTR", total_amount: 25, invoice_payload: orderId, telegram_payment_charge_id: charge } } });
  const risk = await commerce.createInvoice(123, "risk-guard", { address, chainId: "196", lang: "en" }, "arc");
  await paid(risk.orderId, "fixture-arc-risk");
  await paid(risk.orderId, "fixture-arc-risk");
  const global = await commerce.createInvoice(123, "global-quick", { instId: nativeId, timeframe: "1H", lang: "en" }, "arc");
  await paid(global.orderId, "fixture-arc-global");
  const owned = await jobs.listByPayer("telegram:123", "arc");
  assert.equal(owned.length, 2, "duplicate payment delivery cannot enqueue another job");
  const riskJob = owned.find(job => job.mode === "risk")!;
  assert.equal((riskJob.input as { chainId: string }).chainId, "5042");
  assert.equal((riskJob.input as { address: string }).address, address);
  assert.equal((owned.find(job => job.mode === "spot")!.input as { instId: string }).instId, nativeId);
  assert.ok(owned.every(job => job.receipt?.provider === "telegram_stars" && job.receipt.network === "telegram:stars"));
  assert.equal((await jobs.listByPayer("telegram:123", "xlayer")).length, 0);
});
test("Stars invoice, checkout, duplicate payment, account isolation, full report and refund flow", async () => {
  const env = { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_BOT_USERNAME: "test_bot", TELEGRAM_WEBHOOK_SECRET: "test-secret", TELEGRAM_MINI_APP_URL: "https://pulse.test", TELEGRAM_TON_MINI_APP_ENABLED:"1",TELEGRAM_TON_MINI_APP_URL:"https://pulse.test/ton-miniapp", TELEGRAM_STARS_ENABLED: "1", TELEGRAM_STARS_GLOBAL_QUICK: "25", TELEGRAM_STARS_GLOBAL_PRO: "50", TELEGRAM_STARS_RISK_GUARD: "25", TELEGRAM_STARS_PREDICTION_QUICK: "25", TELEGRAM_STARS_PREDICTION_PRO: "50" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  const realFetch = globalThis.fetch;
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith("https://api.telegram.org/")) {
      const method = String(input).split("/").at(-1)!; calls.push({ method, payload: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, result: method === "createInvoiceLink" ? "https://t.me/$fixture" : true });
    } return realFetch(input, init);
  }) as typeof fetch;
  const jobs = new MemoryJobStore(), reports = new MemoryReportStore();
  const cfg = { FEATURE_TELEGRAM: true, FEATURE_PREDICTION_ANALYSIS: true, NODE_ENV: "test", PAID_REGENERATION_MAX_ATTEMPTS: 2 } as AppConfig;
  const app = express(); app.use(express.json()); app.use(createTelegramRouter(cfg, { jobs, reports, wakeWorker: () => {}, validateGlobal: input => z.object({ instId: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/), timeframe: z.string(), lang: z.literal("en") }).parse(input) }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
    const request = (path: string, body?: unknown, user = 123) => realFetch(`${origin}/v1/telegram/ton/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "PULSE-TELEGRAM-INIT-DATA": signedData(user) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const webhook = (body: unknown) => realFetch(`${origin}/v1/telegram/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "test-secret" }, body: JSON.stringify(body) });
    assert.equal((await realFetch(`${origin}/v1/telegram/ton/orders`)).status, 401);
    assert.equal((await request("orders", { serviceId: "global-quick", input: { instId: "bad" } })).status, 400);
    assert.equal(calls.length, 0);
    const invoiceResponse = await request("orders", { serviceId: "global-quick", stars: 1, input: { instId: "TON-USDT", timeframe: "4H", lang: "en" } });
    assert.equal(invoiceResponse.status, 201); const invoice = await invoiceResponse.json() as { orderId: string; stars: number };
    assert.equal(invoice.stars, 25); assert.equal(calls[0].payload.currency, "XTR"); assert.equal(calls[0].payload.provider_token, "");
    assert.equal((await request(`orders/${invoice.orderId}`, undefined, 456)).status, 404);
    const query = { id: "checkout", from: { id: 123 }, currency: "XTR", total_amount: 25, invoice_payload: invoice.orderId };
    await webhook({ update_id: 99101, pre_checkout_query: { ...query, total_amount: 1 } }); assert.equal(calls.at(-1)?.payload.ok, false);
    await webhook({ update_id: 99102, pre_checkout_query: query }); assert.equal(calls.at(-1)?.payload.ok, true);
    await webhook({ update_id: 99106, pre_checkout_query: query }); assert.equal(calls.at(-1)?.payload.ok, true);
    await webhook({ update_id: 99107, pre_checkout_query: { ...query,id:"another-checkout" } }); assert.equal(calls.at(-1)?.payload.ok, false,"An invoice cannot authorize two different checkouts");
    // Client polling and checkout approval never grant a report or queue work.
    assert.equal((await jobs.queueStats()).ready, 0);
    const paid = { message: { chat: { id: 123, type: "private" }, from: { id: 123 }, successful_payment: { currency: "XTR", total_amount: 25, invoice_payload: invoice.orderId, telegram_payment_charge_id: "fixture-charge" } } };
    process.env.TELEGRAM_STARS_ENABLED="0";
    assert.equal((await webhook({ update_id: 99103, ...paid })).status, 200,"Already-paid orders fulfill even after new checkout is paused");
    process.env.TELEGRAM_STARS_ENABLED="1";
    assert.equal((await webhook({ update_id: 99104, ...paid })).status, 200);
    const owned = await jobs.listByPayer("telegram:123", "xlayer"); assert.equal(owned.length, 1); assert.equal(owned[0].receipt?.asset, "XTR"); assert.equal(owned[0].receipt?.finality.scope, "telegram"); assert.equal((await jobs.queueStats()).ready, 1);
    assert.equal((await request(`orders/${invoice.orderId}/refund`, {})).status, 409);
    await jobs.transition(owned[0].id, "failed_terminal", "fixture failure");
    assert.equal((await request(`orders/${invoice.orderId}/refund`, {}, 456)).status, 404);
    assert.equal((await request(`orders/${invoice.orderId}/refund`, {})).status, 200);
    assert.equal((await request(`orders/${invoice.orderId}/refund`, {})).status, 200);
    assert.equal(calls.filter(call => call.method === "refundStarPayment").length, 1);
    const library = await (await request("orders")).json() as { orders: Array<{ status: string }> }; assert.equal(library.orders[0].status, "refunded");
    // Verify fulfilled TON reports and reject execution handoffs.
    const second = await (await request("orders", { serviceId: "global-pro", input: { instId: "TON-USDT", timeframe: "4H", lang: "en" } })).json() as { orderId: string };
    await webhook({ update_id: 99105, message: { ...paid.message, successful_payment: { ...paid.message.successful_payment, total_amount: 50, invoice_payload: second.orderId, telegram_payment_charge_id: "fixture-charge-2" } } });
    const job = (await jobs.listByPayer("telegram:123", "xlayer")).find(item => item.tier === "premium")!;
    const report = await reports.save("telegram:123", { instId: "TON-USDT", analysis: { summary: "fixture complete" } }); await jobs.attachReport(job.id, report.id);
    const retrieved = await (await request(`orders/${second.orderId}`)).json() as { report: { instId: string } }; assert.equal(retrieved.report.instId, "TON-USDT");
    assert.equal((await request(`orders/${second.orderId}/refund`, {})).status, 409);
    assert.equal((await request(`orders/${second.orderId}/handoff`, {}, 456)).status, 404);
    assert.equal((await request(`orders/${second.orderId}/handoff`, {})).status,404);
  } finally {
    globalThis.fetch = realFetch; for (const key of Object.keys(env)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
