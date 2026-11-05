import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, type AppConfig } from "@pulse/config";
import { advanceGlobalScenario, createGlobalScenarioDefinition, newGlobalScenario } from "@pulse/analysis";
import type { GlobalAssessment, GlobalReport, GlobalScenario } from "@pulse/schemas";
import { TerminalRuntime } from "./terminalRuntime.js";
import { grantTerminalPass, MemoryTerminalStorage, TerminalStore, type TerminalReportObject, type TerminalWatch, type TerminalWorkspace } from "./terminalStore.js";

const OWNER = `0x${"11".repeat(20)}`, OTHER = `0x${"22".repeat(20)}`, BORN = Date.parse("2026-11-03T10:00:00Z"), MINUTE = 60_000;
const config = (): AppConfig => ({ ...loadConfig(), NODE_ENV: "test", FEATURE_TRADING_TERMINAL: true, QUEUE_PROVIDER: "memory", FEATURE_TELEGRAM: false, TERMINAL_MONITOR_INTERVAL_MS: 15_000 });
const definition = () => createGlobalScenarioDefinition({ market: "okx-public-spot:BTC-USDT", timeframe: "1H", family: "level_retest", side: "long", policyId: "structural-zone-passive-v1", configurationKey: "BTC:1H:reference-test", sourceKey: "saved-support", sourceKnownAt: BORN - MINUTE, sourceTimeframe: "1H", sourceLower: 99, sourceUpper: 101, sourcePrice: 101, stopBasis: { price: 96, timeframe: "1H", anchorTs: BORN - 2 * MINUTE, knownAt: BORN - MINUTE }, createdAt: BORN, mode: "passive_limit", entryZone: [99, 101], hardStop: 95, targets: [{ id: "tp1", lower: 110, upper: 111, allocation: 1 }], sourceBoundary: 101, eventTimeframe: "15m", eventAfter: BORN - MINUTE, eventKnownAt: BORN - MINUTE, expiresAt: BORN + 60 * MINUTE, confirmationMaxAgeMs: 20 * MINUTE, fillWindowMs: 15 * MINUTE, confirmationBars: 1 });
const source = (large = false) => ({ snapshot: { instId: "BTC-USDT", timeframe: "1H", source: "okx-public-spot", observedAt: new Date(BORN).toISOString() }, scenario: newGlobalScenario(definition()), narrative: { headline: "Software storage fixture", summary: large ? "Reference capacity fixture. ".padEnd(510_000, "x") : "Source bytes stay immutable.", reasons: [], riskNotes: [], limitations: [], disclaimer: "Not market analysis." } } as unknown as GlobalReport);
const watch = (report: GlobalReport): TerminalWatch => ({ id: "tw_reference_test", instId: "BTC-USDT", timeframe: "1H", setupVersionId: report.scenario!.revisionId, createdAt: new Date(BORN).toISOString(), expiresAt: new Date(report.scenario!.expiresAt).toISOString(), paused: false, telegram: false, state: report.scenario!.state, reason: "Saved source", nextEvent: "Wait for the original policy", report, scenario: structuredClone(report.scenario!), lastObservedAt: new Date(BORN).toISOString() });
const addPass = (value: TerminalWorkspace) => grantTerminalPass(value, { requestId: "reference_test_pass", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "reference_test_payment", purchasedAt: new Date(BORN).toISOString(), simulated: true });
class CapturingStorage extends MemoryTerminalStorage {
  maxWriteBytes = 0;
  reportTtls: number[] = [];
  override async write(key: string, value: unknown, ttl: number) { this.maxWriteBytes = Math.max(this.maxWriteBytes, Buffer.byteLength(JSON.stringify(value))); if (key.includes(":report:")) this.reportTtls.push(ttl); return super.write(key, value, ttl); }
}

test("immutable report references preserve exact bytes, owner scope and expiry-plus-retention", async () => {
  const storage = new CapturingStorage(), state = new TerminalStore(storage, "report-ref-test", 180), report = source(), w = watch(report);
  const expiry = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const ref = await state.saveWatchReport(OWNER, report, expiry);
  assert.match(ref, /^trp_[\da-f]{64}$/);
  assert.equal(await state.saveWatchReport(OWNER, structuredClone(report), expiry), ref);
  const referenced = { ...w, reportRef: ref }; delete referenced.report;
  assert.equal(JSON.stringify(await state.loadWatchReport(OWNER, referenced)), JSON.stringify(report));
  assert.ok(storage.reportTtls.every(ttl => ttl >= 181 * 86_400));
  await assert.rejects(state.loadWatchReport(OTHER, referenced), /missing|integrity/);
  await assert.rejects(state.loadWatchReport(OWNER, { ...referenced, setupVersionId: `gsr_${"a".repeat(32)}` }), /identity/);
});

test("twenty half-megabyte reports leave a small owner CAS request and no reports in workspace output", async () => {
  const storage = new CapturingStorage(), state = new TerminalStore(storage, "report-capacity-test", 180), report = source(true), inline = watch(report);
  const old = Array.from({ length: 20 }, (_, i) => ({ ...inline, id: `tw_capacity_${i}` }));
  assert.ok(Buffer.byteLength(JSON.stringify(old)) > 10_000_000, "Representative inline watch source payload exceeds the supported KV request budget");
  const reportRef = await state.saveWatchReport(OWNER, report, inline.expiresAt);
  await state.mutate(OWNER, value => { addPass(value); value.watches = old.map(({ report: _source, ...item }) => ({ ...item, reportRef })); });
  const value = await state.get(OWNER), restCommand = ["EVAL", "compare-and-set", 2, "owner-key", "owner-index", 0, JSON.stringify(value), 180 * 86400, BORN, OWNER];
  assert.ok(Buffer.byteLength(JSON.stringify(restCommand)) < 100_000, "CAS no longer resends immutable report bodies");
  assert.ok(storage.maxWriteBytes < 1_000_000, "Each immutable source write remains comfortably below the supported provider request limit");
  const runtime = new TerminalRuntime(config(), { store: state, now: () => BORN });
  assert.equal((await runtime.workspace(OWNER)).watches.length, 20);
  assert.ok((await runtime.workspace(OWNER)).watches.every(item => !("report" in item)));
});

test("missing or tampered report objects keep watch progress intact and produce Data needed", async () => {
  const storage = new MemoryTerminalStorage(), state = new TerminalStore(storage, "report-integrity-test", 180), report = source(), w = watch(report);
  const reportRef = await state.saveWatchReport(OWNER, report, w.expiresAt), key = state.key("report", `${OWNER}:${reportRef}`), original = await storage.read<TerminalReportObject>(key);
  const referenced = { ...w, reportRef }; delete referenced.report;
  await state.mutate(OWNER, value => { addPass(value); value.watches.push(referenced); });
  let now = BORN, assessments = 0;
  const runtime = new TerminalRuntime(config(), { store: state, now: () => now, assess: async input => { assessments++; return { scenario: input.scenario, assessedAt: new Date(now).toISOString(), blockers: [], lines: [] } as unknown as GlobalAssessment; } });
  await storage.take(key); await runtime.cycleOwner(OWNER);
  let saved = (await state.get(OWNER)).watches[0]; assert.equal(saved.state, "data_needed"); assert.deepEqual(saved.scenario, w.scenario); assert.match(saved.reason, /source report is missing|integrity/); assert.equal(assessments, 0);
  await storage.write(key, { ...original!, serializedReport: original!.serializedReport + " " }, 180 * 86400);
  now += MINUTE; await runtime.cycleOwner(OWNER);
  saved = (await state.get(OWNER)).watches[0]; assert.equal(saved.state, "data_needed"); assert.deepEqual(saved.scenario, w.scenario); assert.equal(assessments, 0);
  await storage.write(key, original, 180 * 86400); now += MINUTE; await runtime.cycleOwner(OWNER);
  saved = (await state.get(OWNER)).watches[0]; assert.equal(saved.state, "awaiting_location"); assert.deepEqual({ ...saved.scenario, updatedAt: w.scenario.updatedAt }, w.scenario); assert.equal(saved.scenario.updatedAt, now); assert.equal(assessments, 1);
});

test("legacy inline sources migrate without changing priced revision, event history or original clock", async () => {
  const storage = new MemoryTerminalStorage(), state = new TerminalStore(storage, "report-legacy-test", 180), report = source(), legacy = watch(report);
  legacy.scenario = advanceGlobalScenario(legacy.scenario.definition, legacy.scenario, [{ id: "existing-location-test", kind: "location_test", at: BORN + MINUTE, candleTs: BORN, basis: "completed_candle", price: 100 }], BORN + MINUTE);
  legacy.state = legacy.scenario.state;
  await state.mutate(OWNER, value => { addPass(value); value.watches.push(legacy); });
  const before = structuredClone(legacy.scenario);
  assert.deepEqual(await state.loadWatchReport(OWNER, legacy), report);
  let admitted: GlobalScenario | undefined;
  const runtime = new TerminalRuntime(config(), { store: state, now: () => BORN + 5 * MINUTE, assess: async input => { admitted = structuredClone(input.scenario); return { scenario: input.scenario, assessedAt: new Date(BORN + 5 * MINUTE).toISOString(), blockers: [], lines: [] } as unknown as GlobalAssessment; } });
  assert.equal("report" in (await runtime.workspace(OWNER)).watches[0], false, "Legacy reports are also excluded from API output before migration");
  await runtime.cycleOwner(OWNER);
  const saved = (await state.get(OWNER)).watches[0]; assert.equal(saved.report, undefined); assert.match(saved.reportRef!, /^trp_[\da-f]{64}$/); assert.deepEqual({ ...saved.scenario, updatedAt: before.updatedAt }, before); assert.equal(saved.scenario.updatedAt, BORN + 5 * MINUTE); assert.deepEqual(admitted, before); assert.equal(saved.setupVersionId, legacy.setupVersionId); assert.equal(saved.expiresAt, legacy.expiresAt);
});
