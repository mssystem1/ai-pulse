import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, type AppConfig } from "@pulse/config";
import type { TerminalMarketSnapshot } from "@pulse/domain";
import type { GlobalAssessment, GlobalReport } from "@pulse/schemas";
import { TerminalRuntime, terminalConfirmationMessage } from "./terminalRuntime.js";
import { applyTerminalPositionEvent, grantTerminalPass, MemoryTerminalStorage, TerminalStore, terminalAccess, type TerminalPosition, type TerminalWorkspace } from "./terminalStore.js";

const OWNER = `0x${"12".repeat(20)}`, BORN = Date.parse("2026-11-04T10:00:00Z"), MINUTE = 60_000;
const cfg = (): AppConfig => ({ ...loadConfig(), NODE_ENV: "test", FEATURE_TRADING_TERMINAL: true, QUEUE_PROVIDER: "memory", STORAGE_PROVIDER: "memory", PERSISTENCE_NAMESPACE: "terminal-monitoring-test", FEATURE_TELEGRAM: true, TERMINAL_MONITOR_INTERVAL_MS: 15_000 });
const store = () => new TerminalStore(new MemoryTerminalStorage(), `terminal-monitoring-test:${Math.random()}`, 180);
const grant = (value: TerminalWorkspace, at = BORN, id = "active") => grantTerminalPass(value, { requestId: id, duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"34".repeat(20)}`, paymentId: id, purchasedAt: new Date(at).toISOString(), simulated: true });
const position = (): TerminalPosition => ({ id: "position-1", instId: "BTC-USDT", timeframe: "1H", side: "long", venue: "OKX", instrumentType: "spot", createdAt: new Date(BORN - MINUTE).toISOString(), paused: false, telegram: true, quantity: 1, averageEntry: 100, realizedPnl: 0, hardStop: 80, targets: [110], protectionStatus: "user_reported", status: "open", events: [] });
const market = (at: number, quoteAt: number, price = 90): TerminalMarketSnapshot => ({ version: "terminal-market-v1", instId: "BTC-USDT", timeframe: "1H", observedAt: at, report: { snapshot: { source: "okx-public-spot" }, currentMarket: { quote: { price, ts: quoteAt } } } as unknown as GlobalReport, tools: { derivatives: {} } as TerminalMarketSnapshot["tools"], observations: [], sources: [] });
function protection(p: TerminalPosition, executedAt: number, recordedAt = executedAt, hardStop = 95) {
  applyTerminalPositionEvent(p, { id: `protection:${executedAt}`, requestId: `protection:${executedAt}`, kind: "protection", hardStop, executedAt: new Date(executedAt).toISOString(), recordedAt: new Date(recordedAt).toISOString(), provenance: "user_reported" });
}

test("a pass renewed during recipient lookup cannot publish expiry or cancel valid queued alerts", async () => {
  const state = store();
  await state.mutate(OWNER, value => {
    grant(value, BORN - 25 * 60 * MINUTE, "expired"); value.positions.push(position());
    value.telegram = { enabled: true, events: ["pass_expired", "target_touched"] };
    value.activity.push({ id: "target", at: new Date(BORN).toISOString(), kind: "target_touched", subjectId: "position-1", message: "Observed target; no exit fill verified." });
    value.deliveries.push({ id: "target-delivery", eventId: "target", subjectId: "position-1", recipientId: 123, state: "queued", createdAt: new Date(BORN).toISOString() });
  });
  let renewed = false; const sent: string[] = [];
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => BORN, telegramRecipient: async () => {
    if (!renewed) { renewed = true; await state.mutate(OWNER, value => { grant(value, BORN, "renewed"); }); }
    return 123;
  }, telegramSend: async (_recipient, text) => { sent.push(text); return sent.length; } });
  await runtime.cycleOwner(OWNER);
  const value = await state.get(OWNER);
  assert.equal(terminalAccess(value, BORN).active, true);
  assert.equal(value.activity.filter(event => event.kind === "pass_expired").length, 0);
  assert.equal(value.deliveries[0].state, "acknowledged");
  assert.equal(sent.length, 1); assert.match(sent[0], /Observed target/);
});

test("an already-queued expiry notification is cancelled after a pass renews", async () => {
  const state = store(); let sends = 0;
  await state.mutate(OWNER, value => {
    grant(value, BORN - 25 * 60 * MINUTE, "expired"); grant(value, BORN, "renewed");
    value.telegram = { enabled: true, events: ["pass_expired"] };
    value.activity.push({ id: "expired-old", at: new Date(BORN - MINUTE).toISOString(), kind: "pass_expired", subjectId: "expired", message: "Terminal access expired." });
    value.deliveries.push({ id: "expiry-delivery", eventId: "expired-old", subjectId: "expired", recipientId: 123, state: "queued", createdAt: new Date(BORN - MINUTE).toISOString() });
  });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => BORN, telegramRecipient: async () => 123, telegramSend: async () => ++sends });
  await runtime.deliver(OWNER);
  assert.equal(sends, 0); assert.equal((await state.get(OWNER)).deliveries[0].state, "cancelled");
});

test("a pre-amendment quote cannot touch new protection; a later actual quote can", async () => {
  let now = BORN, quoteAt = BORN - 50_000; const state = store();
  await state.mutate(OWNER, value => { grant(value); const p = position(); protection(p, BORN - 30_000); value.positions.push(p); });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => market(now, quoteAt) });
  await runtime.cycleOwner(OWNER);
  let value = await state.get(OWNER);
  assert.equal(value.positions[0].lastMark, undefined); assert.equal(value.positions[0].lastRiskState, "source_interruption");
  assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 0);
  now += MINUTE; quoteAt = now;
  await runtime.cycleOwner(OWNER); value = await state.get(OWNER);
  assert.equal(value.positions[0].lastMark?.at, new Date(quoteAt).toISOString());
  assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 1);
  assert.equal(value.positions[0].quantity, 1); assert.equal(value.positions[0].status, "open");
});

test("a protection amendment made during a pending source read requires a subsequent mark", async () => {
  let now = BORN; const state = store(); await state.mutate(OWNER, value => { grant(value); value.positions.push(position()); });
  let release!: (value: TerminalMarketSnapshot) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<TerminalMarketSnapshot>(resolve => { release = resolve; });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => { entered(); return pending; } });
  const cycle = runtime.cycleOwner(OWNER); await started;
  now += 30_000; await state.mutate(OWNER, value => { protection(value.positions[0], now); });
  release(market(BORN, BORN + 1000)); await cycle;
  const value = await state.get(OWNER);
  assert.equal(value.positions[0].lastRiskState, "source_interruption");
  assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 0);
});

test("backdated user-reported protection uses its effective time rather than late journal recording time", async () => {
  const state = store(); await state.mutate(OWNER, value => { grant(value); const p = position(); p.createdAt = new Date(BORN).toISOString(); protection(p, BORN - MINUTE, BORN); value.positions.push(p); });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => BORN, snapshot: async () => market(BORN, BORN - 30_000) });
  await runtime.cycleOwner(OWNER);
  const value = await state.get(OWNER);
  assert.equal(value.positions[0].lastRiskState, "protection_touched");
  assert.equal(value.positions[0].lastMark?.at, new Date(BORN - 30_000).toISOString());
  assert.equal(value.positions[0].quantity, 1);
});

test("a superseded monitoring cycle cannot overwrite newer marks or send its stale transition", async () => {
  let now = BORN, calls = 0, sends = 0; const state = store();
  await state.mutate(OWNER, value => { grant(value); const p = position(); p.hardStop = 95; value.positions.push(p); value.telegram = { enabled: true, events: ["target_touched", "protection_touched"] }; });
  let release!: (value: TerminalMarketSnapshot) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<TerminalMarketSnapshot>(resolve => { release = resolve; });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => { if (calls++ === 0) { entered(); return pending; } return market(now, now, 111); }, telegramRecipient: async () => 123, telegramSend: async () => ++sends });
  const older = runtime.cycleOwner(OWNER); await started;
  now += 121_000; await runtime.cycleOwner(OWNER);
  assert.equal((await state.get(OWNER)).positions[0].lastMark?.price, 111);
  release(market(now, now - 1000, 90)); await older;
  const value = await state.get(OWNER);
  assert.equal(value.positions[0].lastMark?.price, 111); assert.equal(value.positions[0].lastRiskState, "target_touched");
  assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 0); assert.equal(sends, 1);
});

test("a timed-out monitoring lease discards even fresh results and leaves a later cycle able to retry", async () => {
  let now = BORN, delayed = true; const state = store();
  await state.mutate(OWNER, value => { grant(value); const p = position(); p.hardStop = 95; value.positions.push(p); });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => { if (delayed) { delayed = false; now += 121_000; } return market(now, now); } });
  await runtime.cycleOwner(OWNER);
  let value = await state.get(OWNER);
  assert.equal(value.positions[0].lastMark, undefined); assert.equal(value.positions[0].lastRiskState, undefined);
  assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 0); assert.equal(value.monitoringLease, undefined);
  await runtime.cycleOwner(OWNER); value = await state.get(OWNER);
  assert.equal(value.positions[0].lastMark?.price, 90); assert.equal(value.positions[0].lastRiskState, "protection_touched");
});

test("expiry publication and delivery cannot continue after their monitoring lease expires", async () => {
  let now = BORN, lookups = 0, sends = 0; const state = store();
  await state.mutate(OWNER, value => { grant(value, BORN - 25 * 60 * MINUTE, "expired"); value.telegram = { enabled: true, events: ["pass_expired"] }; });
  const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, telegramRecipient: async () => { if (lookups++ === 0) now += 121_000; return 123; }, telegramSend: async () => ++sends });
  await runtime.cycleOwner(OWNER);
  let value = await state.get(OWNER);
  assert.equal(value.activity.filter(event => event.kind === "pass_expired").length, 0); assert.equal(sends, 0);
  await runtime.cycleOwner(OWNER); value = await state.get(OWNER);
  assert.equal(value.activity.filter(event => event.kind === "pass_expired").length, 1); assert.equal(sends, 1);
});

test("sequential leases cannot rewind mark clocks or accept revised prices at an already observed timestamp", async t => {
  for (const instrumentType of ["spot", "perpetual"] as const) await t.test(instrumentType, async () => {
    let now = BORN, quoteAt = BORN, price = 111, sends = 0, outage = false; const state = store();
    await state.mutate(OWNER, value => { grant(value); const p = position(); p.instrumentType = instrumentType; p.hardStop = 95; value.positions.push(p); value.telegram = { enabled: true, events: ["target_touched", "protection_touched"] }; });
    const runtime = new TerminalRuntime(cfg(), { store: state, now: () => now, snapshot: async () => {
      if (outage) throw new Error("Deterministic source outage");
      const snapshot = market(now, quoteAt, price);
      snapshot.tools.derivatives = { id: "derivatives", label: "Derivatives", source: "okx-public-perpetual", status: "available", knownAt: now, markPrice: price, markPriceAt: quoteAt, instrumentId: "BTC-USDT-SWAP" };
      return snapshot;
    }, telegramRecipient: async () => 123, telegramSend: async () => ++sends });
    await runtime.cycleOwner(OWNER);
    assert.equal((await state.get(OWNER)).positions[0].lastMark?.price, 111);
    now += 15_000; quoteAt = BORN - 10_000; price = 90;
    await runtime.cycleOwner(OWNER);
    let value = await state.get(OWNER);
    assert.equal(value.positions[0].lastRiskState, "source_interruption", "An older but age-fresh source quote cannot establish current protection contact");
    assert.equal(value.positions[0].lastMark, undefined);
    assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 0);
    now += 15_000; outage = true; await runtime.cycleOwner(OWNER); outage = false;
    value = await state.get(OWNER);
    assert.equal(value.positions[0].lastMark, undefined);
    assert.equal(value.positions[0].lastMarkObservation?.at, new Date(BORN).toISOString());
    assert.equal(value.positions[0].lastMarkObservation?.price, 111);
    now += 15_000; quoteAt = BORN; // Same recorded source instant, conflicting price.
    await runtime.cycleOwner(OWNER); value = await state.get(OWNER);
    assert.equal(value.positions[0].lastRiskState, "source_interruption", "Clearing an unavailable current mark must not lose the accepted source-time watermark");
    assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 0);
    now += 15_000; price = 111; // Original identical quote can be re-read without a duplicate alert.
    await runtime.cycleOwner(OWNER); value = await state.get(OWNER);
    assert.equal(value.positions[0].lastMark?.price, 111);
    assert.equal(value.activity.filter(event => event.kind === "target_touched").length, 1); assert.equal(sends, 1);
    now += 15_000; quoteAt = now; price = 90;
    await runtime.cycleOwner(OWNER); value = await state.get(OWNER);
    assert.equal(value.positions[0].lastRiskState, "protection_touched");
    assert.equal(value.positions[0].lastMark?.at, new Date(now).toISOString());
    assert.equal(value.activity.filter(event => event.kind === "protection_touched").length, 1); assert.equal(sends, 2);
  });
});

test("price-policy confirmation keeps canonical WAIT, payoff and blockers distinct from trade admission", () => {
  const message = terminalConfirmationMessage({ state: "waiting_retest", blockers: ["reward", "context"], firstObstacleRewardRisk: 0.62 } as GlobalAssessment, "confirmed_awaiting_fill");
  assert.match(message, /Price policy confirmation observed/); assert.match(message, /WAIT \(waiting_retest\)/);
  assert.match(message, /Blockers: reward, context/); assert.match(message, /0\.62R/);
  assert.match(message, /event alone does not qualify an entry/); assert.match(message, /no venue fill or order authorization/);
});
