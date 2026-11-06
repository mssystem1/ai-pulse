import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, type AppConfig } from "@pulse/config";
import { createPaymentGate } from "@pulse/payments";
import { createGlobalScenarioDefinition, newGlobalScenario } from "@pulse/analysis";
import type { GlobalAssessment, GlobalReport } from "@pulse/schemas";
import type { TerminalMarketSnapshot, TerminalTapeoutComponent } from "@pulse/domain";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { TerminalAuth } from "./terminalAuth.js";
import { TerminalPayments } from "./terminalPayments.js";
import { TerminalRuntime } from "./terminalRuntime.js";
import { applyTerminalPositionEvent, emptyTerminalWorkspace, grantTerminalPass, MemoryTerminalStorage, TerminalStore, terminalAccess, type TerminalPosition, type TerminalPurchase, type TerminalWorkspace } from "./terminalStore.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`), other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const OWNER = account.address.toLowerCase(), OTHER = other.address.toLowerCase(), BORN = Date.parse("2026-11-03T10:00:00Z"), MINUTE = 60_000;
const cfg = (): AppConfig => ({ ...loadConfig(), NODE_ENV: "test", FEATURE_TRADING_TERMINAL: true, X402_MOCK: true, paymentMode: "mock", QUEUE_PROVIDER: "memory", STORAGE_PROVIDER: "memory", PERSISTENCE_NAMESPACE: "terminal-test", FEATURE_TELEGRAM: true, enabledNetworks: ["xlayer", "base"], FEATURE_BASE_PAYMENTS: true, TERMINAL_MONITOR_INTERVAL_MS: 15_000 });
const store = (storage = new MemoryTerminalStorage()) => new TerminalStore(storage, `terminal-test-${Math.random()}`, 180);
const purchase = (requestId = "purchase_request_001"): TerminalPurchase => ({ requestId, duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payee: `0x${"33".repeat(20)}`, createdAt: new Date(BORN).toISOString(), state: "authorizing", paymentId: `base:${requestId}`, nonce: `0x${"44".repeat(32)}`, simulated: true });
const grant = (value: TerminalWorkspace, now = BORN, id = "initial") => grantTerminalPass(value, { requestId: id, duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: purchase().asset, paymentId: id, purchasedAt: new Date(now).toISOString(), simulated: true });
const position = (): TerminalPosition => ({ id: "position-1", instId: "BTC-USDT", timeframe: "1H", side: "long", venue: "Manual journal", instrumentType: "spot", createdAt: new Date(BORN).toISOString(), paused: false, telegram: true, quantity: 0, averageEntry: 0, realizedPnl: 0, hardStop: 90, targets: [110], protectionStatus: "user_reported", status: "open", events: [] });
const fixture = (now = BORN): TerminalMarketSnapshot => ({ version: "terminal-market-v1", instId: "BTC-USDT", timeframe: "1H", observedAt: now, report: { snapshot: { instId: "BTC-USDT", timeframe: "1H", source: "okx-public-spot", observedAt: new Date(now).toISOString() }, currentMarket: { quote: { price: 111, ts: now } } } as unknown as GlobalReport, observations: [], sources: [], tools: { value: { id: "value", label: "Value", source: "fixture", knownAt: now, status: "unavailable" }, flow: { id: "flow", label: "Flow", source: "fixture", knownAt: now, status: "unavailable", points: [], marketType: "spot" }, derivatives: { id: "derivatives", label: "OI", source: "okx-public-perpetual", knownAt: now, status: "available", markPriceAt: now, markPrice: 99, instrumentId: "BTC-USDT-SWAP" }, liquidity: { id: "liquidity", label: "Book", source: "fixture", knownAt: now, status: "unavailable" } } });

test("Terminal signature auth is owner-bound, one-time and expires; production cannot use memory grants", async () => {
  const storage = store(), auth = new TerminalAuth(storage, "https://app.ai-pulse.tech");
  const challenge = await auth.challenge(OWNER, BORN);
  const signature = await account.signMessage({ message: challenge.message });
  const session = await auth.verify(challenge.challengeId, signature, BORN);
  assert.equal((await auth.authenticate(`Bearer ${session.token}`, BORN))?.owner, OWNER);
  assert.equal(await auth.authenticate(`Bearer ${session.token}`, BORN + 61 * MINUTE), null);
  await assert.rejects(auth.verify(challenge.challengeId, signature, BORN), /invalid|expired/);
  const next = await auth.challenge(OWNER, BORN);
  await assert.rejects(auth.verify(next.challengeId, await other.signMessage({ message: next.message }), BORN), /invalid|expired/);
  const once = await auth.challenge(OWNER, BORN), signed = await account.signMessage({ message: once.message });
  const concurrent = await Promise.allSettled([auth.verify(once.challengeId, signed, BORN), auth.verify(once.challengeId, signed, BORN)]);
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  assert.throws(() => new TerminalRuntime({ ...cfg(), NODE_ENV: "production" }), /durable/);
});

test("settled receipt survives grant-write outage, recovers original terms exactly once and rejects other owners", async () => {
  class FailingStorage extends MemoryTerminalStorage {
    failGrant = false;
    override async compareAndSet(key: string, revision: number, value: TerminalWorkspace, ttl: number, index: string) { if (this.failGrant && value.grants.length) { this.failGrant = false; throw new Error("simulated durable grant outage"); } return super.compareAndSet(key, revision, value, ttl, index); }
  }
  const adapter = new FailingStorage(), state = store(adapter), payments = new TerminalPayments(state, () => BORN);
  assert.equal(await payments.prepare(OWNER, purchase()), true);
  assert.equal(await payments.prepare(OWNER, purchase()), false);
  adapter.failGrant = true;
  await assert.rejects(payments.settled(OWNER, purchase().requestId, { settledAt: new Date(BORN).toISOString(), settlementTx: `0x${"55".repeat(32)}` }), /outage/);
  assert.equal((await state.get(OWNER)).pendingPurchases?.[0]?.state, "settled");
  const results = await Promise.all([payments.recover(OWNER, purchase().requestId), payments.recover(OWNER, purchase().requestId)]);
  assert.equal(results[0].grant?.priceUsd, "1.5"); assert.equal(results[0].grant?.amountAtomic, "1500000");
  assert.equal((await state.get(OWNER)).grants.length, 1);
  assert.equal(results[0].access.expiresAt, new Date(BORN + 86_400_000).toISOString());
  await assert.rejects(payments.recover(OTHER, purchase().requestId), /belongs|pending/);
  await assert.rejects(payments.prepare(OWNER, { ...purchase(), duration: "7d" }), /identity/);
  const another = purchase("purchase_request_002"); await payments.prepare(OWNER, another);
  await assert.rejects(payments.recover(OWNER, another.requestId), /reconciliation/);
  assert.equal((await state.get(OWNER)).grants.length, 1);
});

test("ambiguous settlement can recover only from its original verified authorization receipt", async () => {
  const state = store(); let calls = 0;
  const service = new TerminalPayments(state, () => BORN, async (owner, pending, tx) => { calls++; assert.equal(owner, OWNER); assert.equal(pending.nonce, purchase().nonce); if (tx !== `0x${"66".repeat(32)}`) throw new Error("receipt mismatch"); return { settlementTx: tx, settledAt: new Date(BORN).toISOString() }; });
  await service.prepare(OWNER, purchase());
  await assert.rejects(service.recover(OWNER, purchase().requestId, `0x${"77".repeat(32)}`), /mismatch/);
  assert.equal((await state.get(OWNER)).grants.length, 0);
  await service.recover(OWNER, purchase().requestId, `0x${"66".repeat(32)}`);
  await service.recover(OWNER, purchase().requestId);
  assert.equal(calls, 2); assert.equal((await state.get(OWNER)).grants.length, 1);
});

test("position basis, partial closes and retries use actual manual quantities, never chart fills", () => {
  const p = position();
  const event = (kind: "open" | "add" | "close", quantity: number, price: number, minute: number) => ({ id: `${kind}:${minute}`, requestId: `${kind}:${minute}`, kind, quantity, price, executedAt: new Date(BORN + minute * MINUTE).toISOString(), recordedAt: new Date(BORN).toISOString(), provenance: "user_reported" as const });
  applyTerminalPositionEvent(p, event("open", 2, 100, 0)); applyTerminalPositionEvent(p, event("add", 1, 130, 1));
  assert.equal(p.averageEntry, 110); assert.equal(p.quantity, 3);
  const close = event("close", 1, 140, 2); applyTerminalPositionEvent(p, close); applyTerminalPositionEvent(p, close);
  assert.equal(p.quantity, 2); assert.equal(p.realizedPnl, 30);
  assert.throws(() => applyTerminalPositionEvent(p, event("close", 3, 140, 3)), /exceeds/);
  applyTerminalPositionEvent(p, event("close", 2, 100, 4)); assert.equal(p.status, "closed"); assert.equal(p.realizedPnl, 10);
});

test("perpetual mark uses derivative source; Telegram transition dedup and expiry preserve positions", async () => {
  let now = BORN; const state = store(); let sends = 0;
  await state.mutate(OWNER, value => { grant(value); value.telegram = { enabled: true, events: ["target_touched", "protection_touched", "pass_expired"] }; const spot = position(); spot.quantity = 1; spot.averageEntry = 100; value.positions.push(spot); value.positions.push({ ...position(), id: "perp-1", instrumentType: "perpetual", venue: "OKX", quantity: 1, averageEntry: 100 }); });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => fixture(now), telegramRecipient: async () => 123, telegramSend: async () => { sends++; return sends; } });
  await runtime.cycleOwner(OWNER);
  let value = await state.get(OWNER);
  assert.equal(value.positions[0].lastMark?.price, 111); assert.equal(value.positions[0].lastMark?.venueMatches, false);
  assert.equal(value.positions[1].lastMark?.price, 99); assert.equal(value.positions[1].lastMark?.kind, "perpetual-mark-reference");
  assert.equal(value.positions[0].quantity, 1); assert.equal(value.positions[0].status, "open"); assert.equal(sends, 1);
  now += MINUTE; await runtime.cycleOwner(OWNER); assert.equal(sends, 1);
  now += 25 * 60 * MINUTE; await runtime.cycleOwner(OWNER); assert.equal(terminalAccess(await state.get(OWNER), now).active, false);
  assert.equal((await state.get(OWNER)).positions[0].status, "open"); assert.equal(sends, 2);
  await runtime.cycleOwner(OWNER); assert.equal(sends, 2);
});

test("notification consent is checked again before delivery; ambiguous send is never blindly retried", async () => {
  let now = BORN; const state = store(); let sends = 0;
  await state.mutate(OWNER, value => { grant(value); const p = position(); p.quantity = 1; p.averageEntry = 100; value.positions.push(p); value.telegram = { enabled: true, events: ["target_touched"] }; });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => fixture(now), telegramRecipient: async () => 123, telegramSend: async () => { sends++; throw new Error("timeout after possible acceptance"); } });
  await runtime.cycleOwner(OWNER); assert.equal(sends, 1);
  assert.equal((await state.get(OWNER)).deliveries[0]?.state, "uncertain");
  now += MINUTE; await runtime.cycleOwner(OWNER); assert.equal(sends, 1);
  await state.mutate(OWNER, value => { value.deliveries.push({ id: "queued", eventId: value.activity.find(e => e.kind === "target_touched")!.id, subjectId: "position-1", recipientId: 123, state: "queued", createdAt: new Date(now).toISOString() }); value.positions[0].paused = true; });
  await runtime.deliver(OWNER); assert.equal(sends, 1); assert.equal((await state.get(OWNER)).deliveries.at(-1)?.state, "cancelled");
});

test("fresh OI/funding metadata cannot refresh an old perpetual mark", async () => {
  const state = store(); await state.mutate(OWNER, value => { grant(value); value.positions.push({ ...position(), instrumentType: "perpetual", quantity: 1, averageEntry: 100 }); });
  const snapshot = fixture(); snapshot.tools.derivatives.markPriceAt = BORN - 5 * MINUTE;
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => BORN, snapshot: async () => snapshot });
  await runtime.cycleOwner(OWNER);
  const value = await state.get(OWNER); assert.equal(value.positions[0].lastMark, undefined); assert.equal(value.positions[0].lastRiskState, "source_interruption"); assert.equal(value.positions[0].quantity, 1);
});

test("monitoring results are not applied after a pass expires during a slow source read", async () => {
  let now = BORN; const state = store(); await state.mutate(OWNER, value => { grant(value); value.positions.push({ ...position(), quantity: 1, averageEntry: 100 }); });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => { now += 25 * 60 * MINUTE; return fixture(now); } });
  await runtime.cycleOwner(OWNER);
  const value = await state.get(OWNER); assert.equal(terminalAccess(value, now).active, false); assert.equal(value.positions[0].lastMark, undefined); assert.equal(value.positions[0].lastRiskState, undefined); assert.equal(value.positions[0].quantity, 1);
});

test("Follow setup rejects a played opportunity and never rewrites its original version/expiry", async () => {
  const definition = createGlobalScenarioDefinition({ market: "okx-public-spot:BTC-USDT", timeframe: "1H", family: "level_retest", side: "long", policyId: "structural-zone-passive-v1", configurationKey: "BTC:1H:test", sourceKey: "support", sourceKnownAt: BORN - MINUTE, sourceTimeframe: "1H", sourceLower: 99, sourceUpper: 101, sourcePrice: 101, stopBasis: { price: 96, timeframe: "1H", anchorTs: BORN - 2 * MINUTE, knownAt: BORN - MINUTE }, createdAt: BORN, mode: "passive_limit", entryZone: [99, 101], hardStop: 95, targets: [{ id: "tp1", lower: 110, upper: 111, allocation: 1 }], sourceBoundary: 101, eventTimeframe: "15m", eventAfter: BORN - MINUTE, eventKnownAt: BORN - MINUTE, expiresAt: BORN + 60 * MINUTE, confirmationMaxAgeMs: 20 * MINUTE, fillWindowMs: 15 * MINUTE, confirmationBars: 1 });
  const scenario = newGlobalScenario(definition), state = store(), snapshot = fixture(); snapshot.report.scenario = scenario;
  snapshot.report.currentMarket!.quote = { price: 105, ts: BORN };
  snapshot.report.candles = []; snapshot.report.indicators = { pivots: [] } as unknown as GlobalReport["indicators"];
  snapshot.report.discretionaryPlan = { version: "discretionary-plan-v8", family: "level_retest", side: "long", objectiveTimeframe: "1H", entry: 101, stop: 95, targets: [{ price: 110, timeframe: "1H", anchorTs: BORN - 2 * MINUTE, knownAt: BORN - MINUTE, basis: "confirmed_swing" }], barriers: [], priceZones: { version: "price-zones-v1", entry: { lower: 99, upper: 101, sourceLower: 99, sourceUpper: 101, sourcePrice: 101 }, stop: { lower: 95, upper: 96 }, targets: [{ lower: 110, upper: 111 }], payoffFloor: 1, payoffLimited: false } } as NonNullable<GlobalReport["discretionaryPlan"]>;
  let played = true;
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => BORN + 5 * MINUTE, assess: async input => ({ scenario: { ...input.scenario!, events: played ? [{ id: "actual-post-publication-entry-touch", kind: "entry_touch", at: BORN + 5 * MINUTE, candleTs: BORN, basis: "completed_candle", price: 101 }] : input.scenario!.events }, blockers: [], lines: [], assessedAt: new Date(BORN + 5 * MINUTE).toISOString() }) as unknown as GlobalAssessment });
  await state.mutate(OWNER, value => { grant(value); });
  await state.storage.write(state.key("setup", `${OWNER}:${scenario.revisionId}`), snapshot, 3600);
  await assert.rejects(runtime.createWatch(OWNER, { instId: "BTC-USDT", timeframe: "1H", setupVersionId: scenario.revisionId, telegram: false }), /ended|already/);
  played = false;
  await assert.rejects(runtime.createWatch(OWNER, { instId: "BTC-USDT", timeframe: "1H", setupVersionId: scenario.revisionId, telegram: false }), /ended|already/, "The canonical entry event remains observed when a later source omits it");
  await state.mutate(OTHER, value => { grant(value); }); await state.storage.write(state.key("setup", `${OTHER}:${scenario.revisionId}`), snapshot, 3600);
  await runtime.createWatch(OTHER, { instId: "BTC-USDT", timeframe: "1H", setupVersionId: scenario.revisionId, telegram: false });
  const watch = (await state.get(OTHER)).watches[0]; assert.equal(watch.scenario.revisionId, scenario.revisionId); assert.equal(watch.scenario.startedAt, BORN); assert.equal(Date.parse(watch.expiresAt), definition.expiresAt);
  assert.equal((await state.get(OWNER)).watches.length, 0);
});

test("enabled Terminal API enforces sign-in before 402 and recovers lost purchase response without charging again", async () => {
  const config = cfg(); config.routes["POST /v1/terminal/pass/24h"] = { priceUsd: 1.234567, name: "Terminal", description: "Standalone pass" };
  const state = store(), routes = createTerminalRoutes(config, { store: state, now: () => BORN });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use((req, _res, next) => { Object.assign(req, { pulseNetworkKey: "base" }); next(); }); app.use(routes.beforePayment); app.use(createPaymentGate(config)); app.use(routes.afterPayment); app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); const address = server.address(); const base = `http://127.0.0.1:${typeof address === "object" ? address!.port : 0}/v1/terminal`;
  const post = (path: string, body: unknown, token?: string, payment?: string) => fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payment ? { "PAYMENT-SIGNATURE": payment } : {}) }, body: JSON.stringify(body) });
  try {
    const unsigned = await post("pass/24h", { requestId: "receipt_request_001" }); assert.equal(unsigned.status, 401);
    const challenge = await (await post("auth/challenge", { wallet: OWNER })).json() as { challengeId: string; message: string };
    const session = await (await post("auth/verify", { challengeId: challenge.challengeId, signature: await account.signMessage({ message: challenge.message }) })).json() as { token: string };
    const challenged = await post("pass/24h", { requestId: "receipt_request_001" }, session.token); assert.equal(challenged.status, 402);
    assert.equal((await challenged.json() as { accepts: Array<{ amount: string }> }).accepts[0].amount, "1234567");
    const accepted = await post("pass/24h", { requestId: "receipt_request_001" }, session.token, "explicit-test-only-mock-proof"); assert.equal(accepted.status, 201);
    const recovered = await post("pass/24h", { requestId: "receipt_request_001" }, session.token); assert.equal(recovered.status, 200);
    assert.equal((await recovered.json() as { recovered: boolean }).recovered, true); assert.equal((await state.get(OWNER)).grants.length, 1);
    const otherChallenge = await (await post("auth/challenge", { wallet: OTHER })).json() as { challengeId: string; message: string };
    const otherSession = await (await post("auth/verify", { challengeId: otherChallenge.challengeId, signature: await other.signMessage({ message: otherChallenge.message }) })).json() as { token: string };
    const workspace = await (await fetch(`${base}/workspace`, { headers: { authorization: `Bearer ${otherSession.token}` } })).json() as { access: { active: boolean }; grants: unknown[] }; assert.equal(workspace.access.active, false); assert.equal(workspace.grants.length, 0);
    const attempt = await post("pass/recover", { requestId: "receipt_request_001" }, otherSession.token); assert.equal(attempt.status, 409);
    const proof = { payload: { authorization: { from: OWNER, nonce: `0x${"88".repeat(32)}` } }, accepted: { asset: purchase().asset } };
    const firstProof = Buffer.from(JSON.stringify(proof)).toString("base64"), sameProofDifferentEncoding = Buffer.from(JSON.stringify(proof, null, 2)).toString("base64");
    assert.equal((await post("pass/24h", { requestId: "receipt_request_002" }, session.token, firstProof)).status, 201);
    const replay = await post("pass/24h", { requestId: "receipt_request_003" }, session.token, sameProofDifferentEncoding); assert.equal(replay.status, 200);
    assert.equal((await state.get(OWNER)).grants.length, 2, "JSON re-encoding cannot credit the same authorization twice");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("position creation binds retries to the original owner-scoped fill and reports capacity conflicts", async t => {
  const config = { ...cfg(), TERMINAL_MAX_POSITIONS: 1 }, state = store();
  await state.mutate(OWNER, value => { grant(value); }); await state.mutate(OTHER, value => { grant(value); });
  const routes = createTerminalRoutes(config, { store: state, now: () => BORN, telegramRecipient: async () => null });
  const app = express(); app.use(express.json()); app.use(routes.publicRouter); app.use(routes.beforePayment);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/terminal`;
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const signIn = async (signer: typeof account) => {
    const challenge = await (await post("auth/challenge", { wallet: signer.address })).json() as { challengeId: string; message: string };
    const response = await post("auth/verify", { challengeId: challenge.challengeId, signature: await signer.signMessage({ message: challenge.message }) });
    assert.equal(response.status, 200); return (await response.json() as { token: string }).token;
  };
  const input = { requestId: "opening_fill_request_001", instId: "BTC-USDT", timeframe: "1D", side: "long", instrumentType: "perpetual", venue: "Manual journal", quantity: 2, price: 100, executedAt: new Date(BORN - MINUTE).toISOString(), hardStop: 90, targets: [110, 120], setupVersionId: "saved-setup-one", telegram: false };
  try {
    const ownerToken = await signIn(account), otherToken = await signIn(other);
    assert.equal((await post("positions", input, ownerToken)).status, 201);
    const original = await state.get(OWNER), id = original.positions[0].id;
    await t.test("identical and canonically equivalent retries do not add a second fill at capacity", async () => {
      assert.equal((await post("positions", input, ownerToken)).status, 201);
      assert.equal((await post("positions", { ...input, timeframe: "1Dutc", executedAt: input.executedAt.replace(".000Z", "Z") }, ownerToken)).status, 201);
      assert.deepEqual(await state.get(OWNER), original);
    });
    await t.test("every changed opening identity returns 409 without changing the original ledger", async () => {
      const changes: Record<string, unknown>[] = [{ quantity: 3 }, { price: 101 }, { instId: "ETH-USDT" }, { timeframe: "4H" }, { side: "short" }, { instrumentType: "spot" }, { venue: "Other venue" }, { executedAt: new Date(BORN - 2 * MINUTE).toISOString() }, { hardStop: 91 }, { hardStop: null }, { targets: [111, 120] }, { targets: [120, 110] }, { setupVersionId: "saved-setup-two" }, { telegram: true }];
      for (const change of changes) {
        const response = await post("positions", { ...input, ...change }, ownerToken), body = await response.json() as { code: string };
        assert.equal(response.status, 409, JSON.stringify(change)); assert.equal(body.code, "terminal_position_request_conflict");
        assert.deepEqual(await state.get(OWNER), original, `Conflict must not write: ${JSON.stringify(change)}`);
      }
    });
    await t.test("a new fill at the position cap returns a specific 409 and preserves the ledger", async () => {
      const response = await post("positions", { ...input, requestId: "opening_fill_request_002" }, ownerToken);
      assert.equal(response.status, 409); assert.equal((await response.json() as { code: string }).code, "terminal_position_limit"); assert.deepEqual(await state.get(OWNER), original);
    });
    await t.test("another owner can use the same request ID without exposing or changing the first fill", async () => {
      assert.equal((await post("positions", { ...input, quantity: 3 }, otherToken)).status, 201);
      const otherWorkspace = await state.get(OTHER); assert.equal(otherWorkspace.positions.length, 1); assert.equal(otherWorkspace.positions[0].quantity, 3); assert.notEqual(otherWorkspace.positions[0].id, id);
      assert.deepEqual(await state.get(OWNER), original);
    });
    await t.test("retry after a partial close and protection update preserves the latest position", async () => {
      assert.equal((await post(`positions/${id}/events`, { requestId: "later_close_request_001", kind: "close", quantity: 1, price: 110, executedAt: new Date(BORN).toISOString(), hardStop: 95, targets: [115] }, ownerToken)).status, 200);
      const changed = await state.get(OWNER); assert.equal(changed.positions[0].quantity, 1); assert.equal(changed.positions[0].hardStop, 95); assert.equal(changed.positions[0].realizedPnl, 10);
      assert.equal((await post("positions", input, ownerToken)).status, 201); assert.deepEqual(await state.get(OWNER), changed);
      const collision = await post("positions", { ...input, requestId: "later_close_request_001" }, ownerToken);
      assert.equal(collision.status, 409); assert.equal((await collision.json() as { code: string }).code, "terminal_position_request_conflict"); assert.deepEqual(await state.get(OWNER), changed);
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
