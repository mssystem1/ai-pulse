import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, type AppConfig } from "@pulse/config";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { TerminalRuntime, terminalWatchSourceIssue } from "./terminalRuntime.js";
import { TelegramBotChat } from "./telegramBotChat.js";
import { TelegramCommerce } from "./telegramCommerce.js";
import { TelegramWalletLink } from "./telegramWalletLink.js";
import { MemoryJobStore, MemoryReportStore } from "./jobs.js";
import { grantTerminalPass, MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`), OWNER = signer.address.toLowerCase(), NOW = Date.parse("2026-11-05T10:00:00Z");
const cfg = (): AppConfig => ({ ...loadConfig(), NODE_ENV: "test", FEATURE_TRADING_TERMINAL: true, FEATURE_TELEGRAM: true, QUEUE_PROVIDER: "memory", STORAGE_PROVIDER: "memory" });
const store = () => new TerminalStore(new MemoryTerminalStorage(), `terminal-telegram-${Math.random()}`, 180);

test("Terminal exposes the configured bot and exact verified wallet without publishing a chat ID", async () => {
  const settings = { TELEGRAM_BOT_TOKEN: "fixture-token", TELEGRAM_BOT_USERNAME: "pulsemi_bot", TELEGRAM_WEBHOOK_SECRET: "fixture-secret", TELEGRAM_MINI_APP_URL: "https://pulse.test" };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]])); Object.assign(process.env, settings);
  try {
    let recipient: number | null = null, lookupError = false;
    const runtime = new TerminalRuntime(cfg(), { store: store(), now: () => NOW, telegramRecipient: async () => { if (lookupError) throw new Error("private://storage/token-secret"); return recipient; } });
    let value = await runtime.workspace(OWNER);
    assert.equal(value.telegram.configured, true); assert.equal(value.telegram.linkState, "not_linked"); assert.equal(value.telegram.linkedWallet, null);
    assert.equal(value.telegram.linkUrl, "https://t.me/pulsemi_bot?start=terminal_alerts"); assert.match(value.telegram.nextStep, /confirm the address in Telegram/);
    recipient = 123; value = await runtime.workspace(OWNER);
    assert.equal(value.telegram.linkState, "linked"); assert.equal(value.telegram.linkedWallet, OWNER); assert.equal("recipientId" in value.telegram, false);
    assert.equal(value.telegram.enabled, false, "Linking alone cannot opt the owner into notifications");
    lookupError = true; value = await runtime.workspace(OWNER);
    assert.equal(value.telegram.linkState, "unavailable"); assert.equal(value.telegram.linked, false); assert.doesNotMatch(JSON.stringify(value), /token-secret/);
  } finally { for (const key of Object.keys(settings)) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
});

test("enable, event selection and pause require wallet identity and cancel queued delivery", async () => {
  const state = store(); let linked = false;
  await state.mutate(OWNER, value => { grantTerminalPass(value, { requestId: "telegram_fixture_grant", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "fixture", purchasedAt: new Date(NOW).toISOString(), simulated: true }); });
  const routes = createTerminalRoutes(cfg(), { store: state, now: () => NOW, telegramRecipient: async () => linked ? 123 : null });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal`;
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("telegram", { enabled: true, events: ["target_touched"] })).status, 401);
    const challenge = await (await post("auth/challenge", { wallet: OWNER })).json();
    const session = await (await post("auth/verify", { challengeId: challenge.challengeId, signature: await signer.signMessage({ message: challenge.message }) })).json();
    let response = await post("telegram", { enabled: true, events: ["target_touched"] }, session.token);
    assert.equal(response.status, 409); assert.equal((await response.json()).code, "terminal_telegram_link_required");
    linked = true;
    response = await post("telegram", { enabled: true, events: [] }, session.token); assert.equal(response.status, 400);
    response = await post("telegram", { enabled: true, events: ["target_touched", "target_touched"] }, session.token); assert.equal(response.status, 200);
    let saved = await state.get(OWNER); assert.deepEqual(saved.telegram, { enabled: true, events: ["target_touched"] }); assert.equal(saved.activity.filter(e => e.kind === "telegram_enabled").length, 1);
    await post("telegram", { enabled: true, events: ["target_touched"] }, session.token);
    assert.equal((await state.get(OWNER)).activity.filter(e => e.kind === "telegram_enabled").length, 1, "Identical retries do not repeat settings activity");
    await state.mutate(OWNER, value => { value.deliveries.push({ id: "queued", eventId: "target", subjectId: "position", recipientId: 123, state: "queued", createdAt: new Date(NOW).toISOString() }); });
    response = await post("telegram", { enabled: false, events: ["target_touched"] }, session.token); assert.equal(response.status, 200);
    saved = await state.get(OWNER); assert.equal(saved.deliveries[0].state, "cancelled"); assert.equal(saved.telegram.enabled, false); assert.equal(saved.activity.at(-1)?.kind, "telegram_paused");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("bot Terminal deep link explains opt-in and uses the existing ownership-confirmation flow", async () => {
  const calls: Array<{ method: string; payload: any }> = [];
  const api = async (method: string, payload: unknown) => { calls.push({ method, payload }); return { result: true }; };
  const commerce = new TelegramCommerce(cfg(), { jobs: new MemoryJobStore(), reports: new MemoryReportStore(), wakeWorker() {}, validateGlobal: input => input }, "fixture", api, () => "fixture");
  let linked = false; commerce.walletLinks!.association = async () => linked ? { wallet: OWNER, linkedAt: new Date(NOW).toISOString() } : null;
  const chat = new TelegramBotChat(cfg(), commerce, api, "https://app.pulse.test/global?old=1");
  await chat.handle(123, "/start terminal_alerts");
  let reply = calls.at(-1)!.payload; assert.match(reply.text, /Linking alone does not enable notifications/); assert.equal(reply.reply_markup.inline_keyboard[0][0].callback_data, "wallet_link");
  assert.equal(reply.reply_markup.inline_keyboard[1][0].url, "https://app.pulse.test/trading-terminal");
  linked = true; await chat.handle(123, "/terminal"); reply = calls.at(-1)!.payload;
  assert.match(reply.text, new RegExp(OWNER)); assert.match(reply.text, /each setup, Radar or position/); assert.equal(reply.reply_markup.inline_keyboard[0][0].callback_data, "/wallet");
  assert.ok(calls.every(call => call.method === "sendMessage"), "All bot calls use a test capture; no payment or external request occurs");
});

test("verified wallet to app opt-in to selected position to worker to one Telegram acknowledgement", async () => {
  let now = NOW, price = 105; const state = store(), config = { ...cfg(), TERMINAL_MONITOR_INTERVAL_MS: 15_000 };
  const links = new TelegramWalletLink(config, new MemoryJobStore()), attempt = await links.start(123);
  const challenge = await links.challenge(attempt.token, signer.address);
  await links.signed(attempt.token, signer.address, await signer.signMessage({ message: challenge.message }));
  assert.equal(await links.association(123), null, "Ownership signature alone is insufficient");
  await links.confirm(123, attempt.id);
  await state.mutate(OWNER, value => { grantTerminalPass(value, { requestId: "delivery_fixture_grant", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "fixture", purchasedAt: new Date(NOW).toISOString(), simulated: true }); });
  const sent: Array<{ recipient: number; text: string }> = [];
  const routes = createTerminalRoutes(config, { store: state, now: () => now,
    telegramRecipient: async owner => (await links.association(123))?.wallet === owner ? 123 : null,
    telegramSend: async (recipient, text) => { sent.push({ recipient, text }); return 77; },
    snapshot: async () => ({ observedAt: now, report: { snapshot: { source: "okx-public-spot" }, currentMarket: { quote: { price, ts: now } } }, tools: { derivatives: {} } } as any),
  });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal`;
  const request = (path: string, body: unknown, token?: string, method = "POST") => fetch(`${base}/${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const authChallenge = await (await request("auth/challenge", { wallet: OWNER })).json();
    const token = (await (await request("auth/verify", { challengeId: authChallenge.challengeId, signature: await signer.signMessage({ message: authChallenge.message }) })).json()).token;
    assert.equal((await request("telegram", { enabled: true, events: ["target_touched", "protection_touched"] }, token)).status, 200);
    const recorded = await request("positions", { requestId: "telegram_position_fill", instId: "BTC-USDT", timeframe: "1H", side: "long", instrumentType: "spot", quantity: 1, price: 100, executedAt: new Date(NOW).toISOString(), venue: "OKX", hardStop: 90, targets: [110] }, token);
    assert.equal(recorded.status, 201); const positionId = (await recorded.json()).positions[0].id;
    price = 111; assert.equal((await request("refresh", {}, token)).status, 200); assert.equal(sent.length, 0, "Global consent does not select a subject automatically");
    assert.equal((await request(`positions/${positionId}`, { telegram: true }, token, "PATCH")).status, 200);
    now += 15_000; price = 105; await request("refresh", {}, token);
    now += 15_000; price = 111; await request("refresh", {}, token);
    assert.equal(sent.length, 1); assert.equal(sent[0].recipient, 123); assert.match(sent[0].text, /target touched/i); assert.match(sent[0].text, /no protective order or exit fill is verified/);
    let saved = await state.get(OWNER); assert.equal(saved.deliveries[0].state, "acknowledged"); assert.equal(saved.deliveries[0].messageId, 77); assert.equal(saved.positions[0].quantity, 1);
    now += 15_000; await request("refresh", {}, token); assert.equal(sent.length, 1, "Unchanged market state never repeats a delivered alert");
    assert.equal((await request("telegram", { enabled: false, events: ["target_touched", "protection_touched"] }, token)).status, 200);
    now += 15_000; price = 85; await request("refresh", {}, token); assert.equal(sent.length, 1, "App pause suppresses subsequent worker notifications");
    saved = await state.get(OWNER); assert.equal(saved.positions[0].lastRiskState, "protection_touched", "Monitoring continues while Telegram is paused"); assert.equal(saved.positions[0].quantity, 1, "A risk alert does not close the manual journal position");
    await links.unlink(123); assert.equal((await routes.runtime!.workspace(OWNER)).telegram.linked, false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("source interruptions expose a safe actionable diagnosis without leaking provider errors", () => {
  for (const [error, expected] of [[new Error("Recheck evidence predates the saved report"), "source_clock_behind"], [new Error("Recheck market identity does not match"), "source_identity_mismatch"], [new Error("Request timeout https://private.test?token=secret"), "source_timeout"], [new Error("GET private-storage-key token=secret"), "source_unavailable"]] as const) {
    const issue = terminalWatchSourceIssue({ error }, NOW); assert.equal(issue.code, expected); assert.doesNotMatch(JSON.stringify(issue), /secret|private.test|private-storage-key/); assert.equal(issue.detectedAt, new Date(NOW).toISOString());
  }
  assert.equal(terminalWatchSourceIssue({ assessment: { blockers: ["history", "quote"] } as any }, NOW).code, "candle_history_incomplete");
  assert.equal(terminalWatchSourceIssue({ assessment: { blockers: ["source_revised"] } as any }, NOW).code, "candles_revised");
  assert.equal(terminalWatchSourceIssue({ assessment: { blockers: ["quote"] } as any }, NOW).code, "quote_unavailable");
});
