import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, type AppConfig } from "@pulse/config";
import { advanceGlobalScenario, applyGlobalScenario, createGlobalScenarioDefinition, newGlobalScenario } from "@pulse/analysis";
import type { GlobalAssessment, GlobalReport } from "@pulse/schemas";
import type { TerminalMarketSnapshot } from "@pulse/domain";
import { TerminalRuntime } from "./terminalRuntime.js";
import { MemoryTerminalStorage, TerminalStore, type TerminalWatch } from "./terminalStore.js";
import { terminalPricePathEvents } from "./terminalPricePath.js";

const OWNER = `0x${"11".repeat(20)}`, OTHER = `0x${"22".repeat(20)}`, BORN = Date.parse("2026-11-03T10:00:00Z"), MINUTE = 60_000;
const config = (): AppConfig => ({ ...loadConfig(), NODE_ENV: "test", FEATURE_TRADING_TERMINAL: true, QUEUE_PROVIDER: "memory", FEATURE_TELEGRAM: false });
/** Deterministic lifecycle fixtures reproduce the observed refresh failure:
 * same source, 17 minutes later, no price revisit to Entry; optionally TP1
 * already crossed and the regenerated candidate promotes the next objective.
 * These verify causal behavior, not trading performance. */
function candidate(minute = 0, promotedTarget = false): TerminalMarketSnapshot {
  const now = BORN + minute * MINUTE;
  const candles = minute ? [
    { ts: BORN, open: 103, high: 106, low: 102, close: 105, volume: 1, confirmed: true },
    { ts: BORN + 5 * MINUTE, open: 105, high: promotedTarget ? 111 : 108, low: 104, close: 107, volume: 1, confirmed: true },
    { ts: BORN + 10 * MINUTE, open: 107, high: promotedTarget ? 112 : 109, low: 106, close: 108, volume: 1, confirmed: true },
  ] : [];
  const report = {
    snapshot: { instId: "BTC-USDT", source: "okx-public-spot", priceCurrency: "USDT", timeframe: "1H", observedAt: new Date(now).toISOString() },
    candles: [{ ts: BORN - 60 * MINUTE, open: 100, high: 105, low: 96, close: 103, volume: 1, confirmed: true }], indicators: { pivots: [] },
    entryStudy: { status: "available", source: "okx-public-spot", timeframe: "5m", pivots: [], candles },
    discretionaryPlan: { version: "discretionary-plan-v8", family: "level_retest", objectiveTimeframe: "1H", side: "long", entry: 101, stop: 95,
      reference: { timeframe: "5m", candleTs: now - 5 * MINUTE, completedAt: now, price: 108 },
      entryBasis: { kind: "structure_zone", timeframe: "1H", knownAt: BORN - 120 * MINUTE, price: 101 },
      stopBasis: { price: 96, timeframe: "1H", anchorTs: BORN - 180 * MINUTE, knownAt: BORN - 120 * MINUTE },
      targets: [{ price: promotedTarget ? 120 : 110, timeframe: "1H", anchorTs: BORN - 180 * MINUTE, knownAt: BORN - 120 * MINUTE, basis: "structure_zone" }], barriers: [],
      priceZones: { version: "price-zones-v1", entry: { lower: 99, upper: 101, sourceLower: 99, sourceUpper: 101, sourcePrice: 101 }, stop: { lower: 95, upper: 96 }, targets: [{ lower: promotedTarget ? 120 : 110, upper: promotedTarget ? 121 : 111 }], payoffFloor: 1, payoffLimited: false },
      executionPolicy: { version: "execution-policy-v1", id: "structural-zone-passive-v1", configurationKey: "BTC:1H:terminal-clock-test", family: "level_retest", mode: "passive_limit", sourceBoundary: 101, eventTimeframe: "5m", eventKnownAt: BORN - 120 * MINUTE, eventAfter: BORN - 120 * MINUTE, expiresAt: now + 60 * MINUTE, confirmationBars: 1, fillWindowBars: 3, stopManagement: "structural_fixed", targetAllocations: [1], entryRegion: "source_zone" },
    },
  } as unknown as GlobalReport;
  applyGlobalScenario(report);
  return { version: "terminal-market-v1", instId: "BTC-USDT", timeframe: "1H", observedAt: now, report, tools: {} as TerminalMarketSnapshot["tools"], observations: [], sources: [] };
}
const runtime = () => new TerminalRuntime(config(), { store: new TerminalStore(new MemoryTerminalStorage(), `terminal-binding-${Math.random()}`, 180), now: () => BORN + 17 * MINUTE });

test("17-minute refresh preserves the first source clock/expiry and does not mutate another owner or raw shared cache", async () => {
  const terminal = runtime(), initial = candidate(), fresh = candidate(17), rawBefore = structuredClone(fresh);
  assert.equal(initial.report.scenario!.scenarioId, fresh.report.scenario!.scenarioId);
  assert.equal(initial.report.scenario!.revisionId, fresh.report.scenario!.revisionId);
  assert.notEqual(initial.report.scenario!.startedAt, fresh.report.scenario!.startedAt);
  const first = await terminal.bindOwnerSnapshot(OWNER, initial), second = await terminal.bindOwnerSnapshot(OWNER, fresh);
  assert.deepEqual(second.report.scenario!.definition, first.report.scenario!.definition);
  assert.equal(second.report.scenario!.startedAt, BORN); assert.equal(second.report.scenario!.expiresAt, first.report.scenario!.expiresAt);
  assert.deepEqual(fresh, rawBefore, "Owner binding must not edit the shared raw snapshot");
  const other = await terminal.bindOwnerSnapshot(OTHER, fresh);
  assert.equal(other.report.scenario!.startedAt, fresh.report.scenario!.startedAt, "Another owner has its own publication history");
});

test("refresh restores crossed original TP1 instead of promoting a distant objective and reviving entry", async () => {
  const terminal = runtime(), initial = candidate(), refreshed = candidate(17, true);
  assert.equal(initial.report.scenario!.scenarioId, refreshed.report.scenario!.scenarioId);
  assert.notEqual(initial.report.scenario!.revisionId, refreshed.report.scenario!.revisionId);
  await terminal.bindOwnerSnapshot(OWNER, initial);
  const bound = await terminal.bindOwnerSnapshot(OWNER, refreshed);
  assert.equal(bound.report.discretionaryPlan!.targets[0].price, 110);
  assert.equal(bound.report.scenario!.revisionId, initial.report.scenario!.revisionId);
  assert.deepEqual(bound.report.scenario!.definition, initial.report.scenario!.definition);
  assert.equal(bound.report.scenario!.state, "invalidated"); assert.equal(bound.report.scenario!.reason, "target_before_entry");
  const later = candidate(34, true); later.report.entryStudy!.candles = refreshed.report.entryStudy!.candles;
  const again = await terminal.bindOwnerSnapshot(OWNER, later);
  assert.equal(again.report.scenario!.state, "invalidated"); assert.equal(again.report.scenario!.reason, "target_before_entry"); assert.equal(again.report.scenario!.startedAt, BORN);
});

test("first owner publication seeds an existing followed report before evaluating a changed new candidate", async () => {
  const terminal = runtime(), initial = candidate(), source = initial.report, scenario = source.scenario!;
  const reportRef = await terminal.store.saveWatchReport(OWNER, source, new Date(scenario.expiresAt).toISOString());
  const watch: TerminalWatch = { id: "tw_legacy_publication", instId: "BTC-USDT", timeframe: "1H", setupVersionId: scenario.revisionId, createdAt: new Date(BORN).toISOString(), expiresAt: new Date(scenario.expiresAt).toISOString(), paused: false, telegram: false, state: scenario.state, reason: "Existing followed source", nextEvent: "Wait", reportRef, scenario, lastObservedAt: new Date(BORN).toISOString() };
  await terminal.store.mutate(OWNER, value => { value.watches.push(watch); });
  const delivered = await terminal.bindOwnerSnapshot(OWNER, candidate(17, true));
  assert.equal(delivered.report.discretionaryPlan!.targets[0].price, 110); assert.equal(delivered.report.scenario!.startedAt, BORN); assert.equal(delivered.report.scenario!.state, "invalidated"); assert.equal(delivered.report.scenario!.reason, "target_before_entry");
});

test("finer price bars do not supply 4H confirmation; publication-straddling bars are excluded and same-bar entry/TP stays ambiguous", () => {
  const raw = candidate(), original = raw.report.scenario!.definition;
  const definition = createGlobalScenarioDefinition({ ...original, eventTimeframe: "4H", createdAt: BORN + MINUTE });
  raw.report.currentMarket = { source: "okx-public-spot", frames: [{ timeframe: "5m", candles: [
    { ts: BORN, open: 103, high: 120, low: 90, close: 100, volume: 1, confirmed: true },
    { ts: BORN + 5 * MINUTE, open: 103, high: 111, low: 100, close: 108, volume: 1, confirmed: true },
  ] }] };
  const events = terminalPricePathEvents(raw.report, definition, BORN + 10 * MINUTE, "USDT");
  assert.ok(events.length > 0); assert.ok(events.every(event => event.candleTs === BORN + 5 * MINUTE));
  assert.deepEqual(events.map(event => event.kind).sort(), ["entry_touch", "target_touch"]);
  const observed = advanceGlobalScenario(definition, newGlobalScenario(definition), events, BORN + 10 * MINUTE);
  assert.equal(observed.state, "completed"); assert.equal(observed.reason, "intrabar_sequence_unknown"); assert.equal(observed.outcome?.kind, "ambiguous_bar"); assert.equal(observed.confirmationAt, undefined);
  assert.deepEqual(terminalPricePathEvents({ ...raw.report, snapshot: { ...raw.report.snapshot, priceCurrency: "USDC" } }, definition, BORN + 10 * MINUTE, "USDT"), []);
  const quoteOnly = structuredClone(raw.report); quoteOnly.currentMarket!.quote = { price: 120, ts: BORN + 10 * MINUTE }; quoteOnly.currentMarket!.frames[0].candles = [];
  assert.deepEqual(terminalPricePathEvents(quoteOnly, definition, BORN + 10 * MINUTE, "USDT"), [], "A quote does not establish within-bar order");
});

const DAILY_BORN = Date.parse("2026-11-04T05:23:00Z");
/** The 04:00-08:00 strategy candle confirms later than a genuine 06:55-07:00
 * target touch. Advancing that coarse candle first used to hide the touch. */
function coarseCandidate(refreshed: boolean): TerminalMarketSnapshot {
  const raw = candidate(0, refreshed), report = raw.report, plan = report.discretionaryPlan!, at = refreshed ? Date.parse("2026-11-04T08:10:00Z") : DAILY_BORN;
  raw.timeframe = "1Dutc"; raw.observedAt = at;
  report.snapshot.timeframe = "1Dutc"; report.snapshot.observedAt = new Date(at).toISOString();
  report.candles[0].ts = Date.parse("2026-11-03T00:00:00Z");
  plan.objectiveTimeframe = "1Dutc"; plan.entryBasis.timeframe = "1Dutc"; plan.entryBasis.knownAt = DAILY_BORN - 24 * 60 * MINUTE;
  plan.stopBasis = { price: 96, timeframe: "1Dutc", anchorTs: DAILY_BORN - 48 * 60 * MINUTE, knownAt: DAILY_BORN - 24 * 60 * MINUTE };
  plan.reference = { timeframe: "4H", candleTs: Date.parse("2026-11-04T04:00:00Z"), completedAt: Date.parse("2026-11-04T08:00:00Z"), price: 108 };
  Object.assign(plan.executionPolicy!, { mode: "confirmed_retest", eventTimeframe: "4H", eventKnownAt: DAILY_BORN - 24 * 60 * MINUTE, eventAfter: DAILY_BORN - 24 * 60 * MINUTE, expiresAt: at + 24 * 60 * MINUTE });
  report.entryStudy = { status: "available", source: "okx-public-spot", timeframe: "4H", pivots: [], candles: refreshed ? [{ ts: Date.parse("2026-11-04T04:00:00Z"), open: 105, high: 112, low: 100, close: 108, volume: 1, confirmed: true }] : [] } as GlobalReport["entryStudy"];
  report.currentMarket = { source: "okx-public-spot", frames: [{ timeframe: "5m", candles: refreshed ? [{ ts: Date.parse("2026-11-04T06:55:00Z"), open: 105, high: 111, low: 104, close: 108, volume: 1, confirmed: true }] : [] }] };
  delete report.scenario; applyGlobalScenario(report);
  return raw;
}

test("earlier fine-bar TP1 and later coarse confirmation advance atomically against the original priced contract", async () => {
  const terminal = runtime(), first = await terminal.bindOwnerSnapshot(OWNER, coarseCandidate(false)), fresh = coarseCandidate(true);
  const coarseOnly = structuredClone(fresh.report);
  applyGlobalScenario(coarseOnly, first.report.scenario);
  assert.equal(coarseOnly.scenario!.state, "confirmed_awaiting_fill", "The fixture genuinely supplies a later canonical 4H confirmation");
  assert.equal(coarseOnly.scenario!.confirmationAt, Date.parse("2026-11-04T08:00:00Z"));
  const bound = await terminal.bindOwnerSnapshot(OWNER, fresh), scenario = bound.report.scenario!;
  assert.equal(bound.report.discretionaryPlan!.targets[0].price, 110, "Refreshing must not promote the next objective after the original TP1 was crossed");
  assert.equal(scenario.startedAt, DAILY_BORN); assert.equal(scenario.expiresAt, first.report.scenario!.expiresAt);
  assert.equal(scenario.state, "invalidated"); assert.equal(scenario.reason, "target_before_entry");
  assert.equal(scenario.events.find(e => e.kind === "target_touch")?.at, Date.parse("2026-11-04T07:00:00Z"));
  assert.equal(scenario.confirmationAt, undefined); assert.equal(scenario.entryObservedAt, undefined);
  const again = await terminal.bindOwnerSnapshot(OWNER, fresh);
  assert.equal(again.report.scenario!.state, "invalidated"); assert.equal(again.report.scenario!.reason, "target_before_entry");
});

test("a delayed fine-bar backfill reconciles before an already retained later coarse confirmation", async () => {
  const terminal = runtime(), first = await terminal.bindOwnerSnapshot(OWNER, coarseCandidate(false));
  const unavailable = coarseCandidate(true); unavailable.report.currentMarket!.frames = [];
  const coarse = await terminal.bindOwnerSnapshot(OWNER, unavailable);
  assert.equal(coarse.report.scenario!.state, "confirmed_awaiting_fill");
  assert.equal(coarse.report.scenario!.lastEventAt, Date.parse("2026-11-04T08:00:00Z"));
  const backfilled = coarseCandidate(true); backfilled.observedAt = Date.parse("2026-11-04T08:15:00Z"); backfilled.report.snapshot.observedAt = new Date(backfilled.observedAt).toISOString();
  const result = await terminal.bindOwnerSnapshot(OWNER, backfilled), scenario = result.report.scenario!;
  assert.equal(scenario.state, "invalidated"); assert.equal(scenario.reason, "target_before_entry");
  assert.equal(scenario.confirmationAt, undefined); assert.equal(scenario.entryObservedAt, undefined);
  assert.deepEqual(scenario.definition, first.report.scenario!.definition);
  assert.equal(scenario.events.find(e => e.kind === "target_touch")?.at, Date.parse("2026-11-04T07:00:00Z"));
});

test("fine price observer rejects wrong venue/instrument, incomplete/future and invalid OHLC without importing strategy events", () => {
  const raw = coarseCandidate(true), definition = coarseCandidate(false).report.scenario!.definition, cutoff = Date.parse("2026-11-04T08:10:00Z");
  const valid = terminalPricePathEvents(raw.report, definition, cutoff, "USDT");
  assert.deepEqual(valid.map(e => e.kind), ["target_touch"]);
  for (const patch of [{ source: "another-venue" }, { instId: "ETH-USDT" }]) {
    assert.deepEqual(terminalPricePathEvents({ ...raw.report, snapshot: { ...raw.report.snapshot, ...patch } }, definition, cutoff, "USDT"), []);
  }
  const changed = structuredClone(raw.report);
  changed.currentMarket!.frames[0].candles.push(
    { ts: cutoff, open: 105, high: 120, low: 104, close: 108, volume: 1, confirmed: true },
    { ts: cutoff - 5 * MINUTE, open: 105, high: 120, low: 104, close: 108, volume: 1, confirmed: false },
    { ts: cutoff - 10 * MINUTE, open: 105, high: 104, low: 103, close: 108, volume: 1, confirmed: true },
  );
  assert.deepEqual(terminalPricePathEvents(changed, definition, cutoff, "USDT"), valid);
});

test("entry-area touch prices stay within the actual fine-bar overlap for either direction", () => {
  const raw = coarseCandidate(true), long = coarseCandidate(false).report.scenario!.definition;
  const bar = { ts: Date.parse("2026-11-04T06:55:00Z"), open: 100.1, high: 100.5, low: 100, close: 100.2, volume: 1, confirmed: true };
  raw.report.currentMarket!.frames[0].candles = [bar];
  const short = createGlobalScenarioDefinition({ ...long, side: "short", hardStop: 105, targets: [{ id: "tp1", lower: 90, upper: 91, allocation: 1 }] });
  for (const definition of [long, short]) {
    const event = terminalPricePathEvents(raw.report, definition, Date.parse("2026-11-04T07:00:00Z"), "USDT").find(e => e.kind === "entry_touch")!;
    assert.ok(event); assert.ok(event.price! >= bar.low && event.price! <= bar.high);
    assert.ok(event.price! >= definition.entryZone[0] && event.price! <= definition.entryZone[1]);
    assert.equal(event.price, definition.side === "long" ? bar.high : bar.low);
  }
});

test("Follow/recheck assessment merges actual coarse events with earlier fine prices before persisting eligibility", async () => {
  const original = coarseCandidate(false), fresh = coarseCandidate(true);
  const terminal = new TerminalRuntime(config(), {
    store: new TerminalStore(new MemoryTerminalStorage(), `terminal-assess-binding-${Math.random()}`, 180),
    now: () => fresh.observedAt, snapshot: async () => structuredClone(fresh),
    assess: async saved => {
      const observed = structuredClone(fresh.report); observed.discretionaryPlan = structuredClone(saved.discretionaryPlan);
      applyGlobalScenario(observed, saved.scenario);
      assert.equal(observed.scenario!.confirmationAt, Date.parse("2026-11-04T08:00:00Z"));
      return { version: "pulse-global-assessment-v1", sourceRef: "saved", sourceObservedAt: saved.snapshot.observedAt, assessedAt: fresh.report.snapshot.observedAt,
        instId: "BTC-USDT", timeframe: "1Dutc", priceCurrency: "USDT", state: "technical_valid", side: "long", pathId: null,
        lastCompletedClose: 108, lastCompletedAt: Date.parse("2026-11-04T08:00:00Z"), confirmationTs: observed.scenario!.confirmationAt, retestTs: Date.parse("2026-11-04T04:00:00Z"),
        retestDeadline: fresh.observedAt + 60 * MINUTE, expiresAt: saved.scenario!.expiresAt, permittedEntry: [99, 101], observedStop: 95,
        targets: [110], grossRewardRisk: 1.5, stopDistancePercent: 6, stopDistanceAtr: 1, context: "neutral", blockers: [], lines: [], scenario: observed.scenario } as GlobalAssessment;
    },
  });
  const source = await terminal.bindOwnerSnapshot(OWNER, original), result = await terminal.assessOwner(OWNER, source.report);
  assert.equal(result.scenario!.state, "invalidated"); assert.equal(result.scenario!.reason, "target_before_entry");
  assert.equal(result.state, "invalidated"); assert.equal(result.permittedEntry, null); assert.equal(result.observedStop, null);
  assert.equal(result.scenario!.confirmationAt, undefined); assert.equal(result.scenario!.entryObservedAt, undefined);
  const record = await terminal.scenarios.get({ ownerWallet: OWNER, networkKey: "terminal" }, source.report.scenario!.scenarioId);
  assert.equal(record!.snapshot.state, "invalidated"); assert.equal(record!.snapshot.events[0].at, Date.parse("2026-11-04T07:00:00Z"));
});
