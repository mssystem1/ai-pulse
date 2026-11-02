import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalScenarioSchema, type GlobalReport, type GlobalScenarioDefinition, type GlobalScenarioEvent } from "@pulse/schemas";
import { advanceGlobalScenario, applyGlobalScenario, createGlobalScenarioDefinition, observeGlobalScenarioCandles } from "./globalScenarioLifecycle.js";
import { evaluateGlobalStrategyMix } from "./globalStrategyMix.js";

const MIN = 60_000, BORN = 60 * MIN;
const definition = (patch: Partial<Omit<GlobalScenarioDefinition, "version" | "scenarioId" | "revisionId">> = {}) => createGlobalScenarioDefinition({
  market: "okx:BTC-USDT", timeframe: "1H", family: "level_retest", side: "long", policyId: "structural-zone-passive-v1", configurationKey: "BTC:1H:v1",
  sourceKey: "support:1H:120000", sourceKnownAt: 2 * MIN, sourceTimeframe: "1H", sourceLower: 99, sourceUpper: 101, sourcePrice: 101,
  stopBasis: { price: 96, timeframe: "1H", anchorTs: 0, knownAt: 2 * MIN }, createdAt: BORN,
  mode: "passive_limit", entryZone: [99, 101], hardStop: 95,
  targets: [{ id: "tp1", lower: 110, upper: 111, allocation: .5 }, { id: "tp2", lower: 120, upper: 121, allocation: .5 }],
  sourceBoundary: 101, eventTimeframe: "5m", eventAfter: 2 * MIN, eventKnownAt: 2 * MIN, expiresAt: BORN + 120 * MIN,
  confirmationMaxAgeMs: 20 * MIN, fillWindowMs: 15 * MIN, confirmationBars: 2, ...patch,
});
const event = (kind: GlobalScenarioEvent["kind"], minute: number, targetId?: string): GlobalScenarioEvent => ({
  id: `${kind}:${minute}:${targetId ?? ""}`, kind, at: BORN + minute * MIN, candleTs: BORN + (minute - 5) * MIN,
  basis: "completed_candle", ...(targetId ? { targetId } : {}),
});
const bar = (minute: number, low: number, high: number, close: number, confirmed = true) => ({ ts: BORN + minute * MIN, open: close, high, low, close, confirmed });

function observedSwingSweep(): GlobalReport {
  // The fresh 4H audit exposed this sequence: an hourly sweep/reclaim, then a
  // separate held candle which breaks the test high and stays above the source.
  // Requiring that held candle to touch the source again erases the real event.
  const hour = 60 * MIN, anchor = Date.UTC(2026, 10, 1, 20), known = anchor - hour, completed = anchor + 4 * hour, at = anchor + 6 * hour + 10 * MIN;
  const candle = (i: number, low: number, high: number, close: number) => ({ ts: anchor + i * hour, open: close, high, low, close, volume: 1, confirmed: true });
  const report = {
    snapshot: { instId: "BTC-USDT", timeframe: "4H", source: "okx-public-spot", venue: "OKX Spot", priceCurrency: "USDT", observedAt: new Date(at).toISOString(), pricePrecision: 2 },
    candles: [], entryStudy: { status: "available", timeframe: "1H", source: "okx-public-spot", candles: [candle(0, 101, 103, 102), candle(1, 101, 103, 102), candle(2, 99.99, 103.6, 102.5), candle(3, 102.49, 106, 105), candle(4, 104, 107, 106), candle(5, 105, 108, 107)] },
    indicators: { pivots: [], vwap: null }, setupSelection: { side: "none", assessment: "sideways", regime: "transition" },
    horizonContext: { zones: [{ id: "known-support", role: "support", lower: 100, upper: 100, knownAt: known }] },
    discretionaryPlan: {
      version: "discretionary-plan-v8", family: "level_retest", side: "long", objectiveTimeframe: "4H", entry: 102.5, stop: 95, barriers: [],
      entryBasis: { kind: "reclaimed_level", timeframe: "4H", knownAt: known, price: 100 },
      evidence: { kind: "primary_reclaim", timeframe: "1H", level: 100, testTs: anchor + 2 * hour, completedAt: completed, extreme: 99.99 },
      reference: { timeframe: "1H", candleTs: anchor + 5 * hour, completedAt: anchor + 6 * hour, price: 107 },
      stopBasis: { timeframe: "4H", anchorTs: anchor, knownAt: completed, price: 99.99 },
      targets: [{ price: 110 }, { price: 120 }], priceZones: { entry: { lower: 100, upper: 102.5, sourceLower: 100, sourceUpper: 102.5, sourcePrice: 100 }, targets: [{ lower: 110, upper: 111 }, { lower: 120, upper: 121 }] },
      executionPolicy: { id: "observed-reclaim-retest-v1", configurationKey: "BTC-USDT:4H:level_retest:v1", mode: "confirmed_retest", sourceBoundary: 100, eventTimeframe: "1H", eventKnownAt: completed, eventAfter: known, expiresAt: at + 16 * hour, confirmationBars: 1, fillWindowBars: 4, targetAllocations: [.5, .5] },
    },
  } as unknown as GlobalReport;
  report.strategyMix = evaluateGlobalStrategyMix(report);
  return report;
}

describe("persistent research scenario lifecycle", () => {
  it("separates stable source identity from priced revisions and render time", () => {
    const d = definition(), later = definition({ createdAt: BORN + 5 * MIN, expiresAt: BORN + 180 * MIN });
    assert.equal(d.scenarioId, later.scenarioId); assert.equal(d.revisionId, later.revisionId);
    const changed = definition({ entryZone: [99, 100] });
    assert.equal(d.scenarioId, changed.scenarioId); assert.notEqual(d.revisionId, changed.revisionId);
    assert.notEqual(d.scenarioId, definition({ side: "short", entryZone: [99, 101], hardStop: 105, targets: [{ id: "tp1", lower: 89, upper: 90, allocation: 1 }] }).scenarioId);
  });
  it("retains confirmation and original deadlines across repeated report views", () => {
    const d = definition({ mode: "confirmed_retest" });
    const first = advanceGlobalScenario(d, null, [event("confirmation", 5)], BORN + 6 * MIN);
    assert.equal(first.state, "confirmed_awaiting_fill");
    const viewed = advanceGlobalScenario(d, first, [event("confirmation", 5)], BORN + 8 * MIN);
    assert.equal(viewed.confirmationAt, first.confirmationAt); assert.equal(viewed.events.length, 1);
    assert.equal(viewed.startedAt, BORN); assert.equal(viewed.expiresAt, d.expiresAt);
    assert.equal(advanceGlobalScenario(d, viewed, [], BORN + 21 * MIN).reason, "confirmation_fill_deadline");
  });
  it("requires a later bounded return and never calls a confirmation close a fill", () => {
    const d = definition({ mode: "confirmed_retest" });
    const sameBar = advanceGlobalScenario(d, null, [event("confirmation", 5), event("entry_touch", 5)], BORN + 5 * MIN);
    assert.equal(sameBar.state, "confirmed_awaiting_fill"); assert.equal(sameBar.entryObservedAt, undefined);
    const later = advanceGlobalScenario(d, sameBar, [event("entry_touch", 10)], BORN + 10 * MIN);
    assert.equal(later.state, "entry_observed"); assert.equal(later.observationOnly, true);
    assert.equal(later.reason, "price_touch_only_no_fill");
  });
  it("does not extend the first fill deadline when a distinct later retest confirms", () => {
    const d = definition({ mode: "confirmed_retest" });
    const first = advanceGlobalScenario(d, null, [event("confirmation", 5)], BORN + 6 * MIN);
    const later = advanceGlobalScenario(d, first, [event("confirmation", 15)], BORN + 15 * MIN);
    assert.equal(later.confirmationAt, BORN + 5 * MIN);
    assert.equal(later.events.filter(e => e.kind === "confirmation").length, 2);
    const ended = advanceGlobalScenario(d, later, [], BORN + 21 * MIN);
    assert.equal(ended.state, "expired"); assert.equal(ended.reason, "confirmation_fill_deadline");
  });
  it("never retroactively enters on a pre-publication or straddling candle", () => {
    const d = definition(), old = { ...event("entry_touch", -5), candleTs: BORN - 10 * MIN };
    const straddles = { ...event("entry_touch", 2), candleTs: BORN - 3 * MIN };
    assert.equal(advanceGlobalScenario(d, null, [old, straddles], BORN + 2 * MIN).state, "awaiting_location");
  });
  it("rejects stale pre-publication confirmations without erasing fresh causal events", () => {
    const d = definition({ mode: "confirmed_retest" });
    assert.equal(advanceGlobalScenario(d, null, [event("confirmation", -25)], BORN).state, "awaiting_location");
    assert.equal(advanceGlobalScenario(d, null, [event("confirmation", -5)], BORN).state, "confirmed_awaiting_fill");
    const observedLater = advanceGlobalScenario(d, null, [event("confirmation", 5), event("entry_touch", 10)], BORN + 100 * MIN);
    assert.equal(observedLater.state, "entry_observed");
  });
  it("cancels a target reached before an attainable entry rather than recycling it", () => {
    const d = definition();
    const state = advanceGlobalScenario(d, null, [event("target_touch", 5, "tp1"), event("entry_touch", 10)], BORN + 10 * MIN);
    assert.equal(state.state, "invalidated"); assert.equal(state.reason, "target_before_entry"); assert.equal(state.entryObservedAt, undefined);
    const replay = advanceGlobalScenario(d, state, [event("entry_touch", 20)], BORN + 20 * MIN);
    assert.equal(replay.state, "invalidated");
  });
  it("records same-bar entry and stop as ambiguous, not a fabricated loss", () => {
    const d = definition();
    const state = advanceGlobalScenario(d, null, [event("entry_touch", 5), event("stop_touch", 5)], BORN + 5 * MIN);
    assert.equal(state.outcome?.kind, "ambiguous_bar"); assert.equal(state.state, "completed");
    assert.equal(state.observationOnly, true);
  });
  it("keeps fixed protection and declared partial exits beyond setup expiry", () => {
    const d = definition({ expiresAt: BORN + 10 * MIN });
    const entered = advanceGlobalScenario(d, null, [event("entry_touch", 5)], BORN + 5 * MIN);
    const partial = advanceGlobalScenario(d, entered, [event("target_touch", 15, "tp1")], BORN + 15 * MIN);
    assert.equal(partial.state, "entry_observed"); assert.equal(partial.remainingFraction, .5);
    assert.equal(partial.definition.hardStop, 95);
    const stopped = advanceGlobalScenario(d, partial, [event("stop_touch", 20)], BORN + 20 * MIN);
    assert.equal(stopped.outcome?.kind, "stop_observed"); assert.equal(stopped.exits.length, 1); assert.equal(stopped.remainingFraction, 0);
    assert.equal(GlobalScenarioSchema.safeParse(stopped).success, true);
  });
  it("deduplicates partial exits and respects long/short symmetry", () => {
    for (const side of ["long", "short"] as const) {
      const d = side === "long" ? definition() : definition({ side, hardStop: 105, targets: [{ id: "tp1", lower: 89, upper: 90, allocation: .5 }, { id: "tp2", lower: 79, upper: 80, allocation: .5 }] });
      const state = advanceGlobalScenario(d, null, [event("entry_touch", 5), event("target_touch", 10, "tp1"), event("target_touch", 10, "tp1"), event("target_touch", 15, "tp2")], BORN + 15 * MIN);
      assert.equal(state.outcome?.kind, "target_observed"); assert.equal(state.exits.length, 2); assert.equal(state.remainingFraction, 0);
    }
  });
  it("observes acceptance then a distinct defended test with exact event-frame clocks", () => {
    const d = definition({ mode: "confirmed_retest", policyId: "accepted-breakout-retest-v1" });
    const bars = [bar(0, 101.5, 104, 103), bar(5, 100, 103, 102), bar(10, 99.5, 101.5, 101.2), bar(15, 101, 111, 110, false)];
    const events = observeGlobalScenarioCandles(d, bars, BORN + 25 * MIN);
    assert.equal(events.find(e => e.kind === "acceptance")?.at, BORN + 5 * MIN);
    assert.equal(events.find(e => e.kind === "confirmation")?.at, BORN + 10 * MIN);
    assert.ok(events.every(e => e.at <= BORN + 15 * MIN));
    const state = advanceGlobalScenario(d, null, events, BORN + 15 * MIN);
    assert.equal(state.state, "entry_observed"); assert.equal(state.entryObservedAt, BORN + 15 * MIN);
  });
  it("does not let later tests erase a valid confirmation or rewind persisted state", () => {
    const d = definition({ mode: "confirmed_retest" });
    const confirmed = advanceGlobalScenario(d, null, [event("confirmation", 5)], BORN + 5 * MIN);
    const next = advanceGlobalScenario(d, confirmed, [event("location_test", 10)], BORN + 10 * MIN);
    assert.equal(next.state, "confirmed_awaiting_fill");
    assert.deepEqual(advanceGlobalScenario(d, next, [], BORN + 6 * MIN), next);
  });
  it("requires an explicit priced revision instead of silently changing active risk", () => {
    const d = definition(), state = advanceGlobalScenario(d, null, [event("entry_touch", 5)], BORN + 5 * MIN);
    assert.throws(() => advanceGlobalScenario(definition({ hardStop: 94 }), state, [], BORN + 6 * MIN), /bound priced revision/);
  });
  it("cannot confirm a price event before its actual admission evidence is known", () => {
    const d = definition({ mode: "confirmed_retest", eventKnownAt: BORN });
    const state = advanceGlobalScenario(d, null, [event("confirmation", -5)], BORN);
    assert.equal(state.confirmationAt, undefined);
    const observed = observeGlobalScenarioCandles(d, [bar(-10, 100, 103, 102), bar(-5, 100, 103, 102)], BORN);
    assert.ok(observed.filter(e => e.kind === "confirmation").every(e => e.at >= BORN));
  });
  it("does not turn a historical passive price touch into a missing confirmation event", () => {
    const d = definition();
    assert.equal(advanceGlobalScenario(d, null, [event("location_test", -5)], BORN).state, "awaiting_location");
  });
  it("uses a causal close invalidation even if that candle opened before publication", () => {
    const d = definition(), closedAfterPublication = { ...event("invalidation", 2), candleTs: BORN - 58 * MIN };
    const state = advanceGlobalScenario(d, null, [closedAfterPublication], BORN + 2 * MIN);
    assert.equal(state.state, "invalidated"); assert.equal(state.reason, "premise_failed_before_entry");
  });
  it("retains a selected 4H sweep's actual hourly held confirmation without demanding another boundary touch", () => {
    const report = observedSwingSweep(), evidence = report.discretionaryPlan!.evidence!;
    assert.equal(report.strategyMix!.selectedVariant, "sweep_reclaim");
    assert.ok(report.entryStudy!.candles[3].low > evidence.level, "The held candle confirms recovery without touching the swept boundary again");
    const state = applyGlobalScenario(report)!;
    assert.equal(state.state, "confirmed_awaiting_fill"); assert.equal(state.confirmationAt, evidence.completedAt);
    assert.equal(state.entryObservedAt, undefined); assert.equal(state.observationOnly, true);
    const event = state.events.find(e => e.kind === "confirmation")!;
    assert.equal(event.candleTs, report.entryStudy!.candles[3].ts); assert.equal(event.price, report.entryStudy!.candles[3].close);
    report.snapshot.observedAt = new Date(Date.parse(report.snapshot.observedAt) + 10 * MIN).toISOString();
    const viewed = applyGlobalScenario(report, state)!;
    assert.equal(viewed.confirmationAt, state.confirmationAt); assert.equal(viewed.startedAt, state.startedAt);
    assert.equal(viewed.events.filter(e => e.kind === "confirmation").length, 1);
  });
  it("cannot borrow a selected-method label when its actual held event, source or completion is unavailable", () => {
    for (const change of [
      (r: GlobalReport) => { r.entryStudy!.candles[3].close = 103; },
      (r: GlobalReport) => { r.entryStudy!.candles[3].confirmed = false; },
      (r: GlobalReport) => { r.horizonContext!.zones[0].knownAt = r.discretionaryPlan!.evidence!.testTs + 1; },
      (r: GlobalReport) => { r.discretionaryPlan!.evidence!.completedAt += 60 * MIN; },
      (r: GlobalReport) => { r.strategyMix!.candidates.find(c => c.id === "sweep_reclaim")!.source!.price = 101; },
    ]) {
      const report = observedSwingSweep(); change(report);
      assert.equal(applyGlobalScenario(report)!.confirmationAt, undefined);
    }
  });
  it("a free recheck recovers an admitted held event without resetting the old report's clock", () => {
    const report = observedSwingSweep(), born = Date.parse(report.snapshot.observedAt);
    const initial = applyGlobalScenario(report)!, d = initial.definition;
    const prior = advanceGlobalScenario(d, null, observeGlobalScenarioCandles(d, report.entryStudy!.candles, born), born);
    assert.equal(prior.state, "awaiting_event"); assert.equal(prior.confirmationAt, undefined);
    report.snapshot.observedAt = new Date(born + 60 * MIN).toISOString();
    assert.notEqual(evaluateGlobalStrategyMix(report).candidates.find(c => c.id === "sweep_reclaim")!.status, "eligible", "The new-event scanner has moved beyond this event's search window");
    const recovered = applyGlobalScenario(report, prior)!;
    assert.equal(recovered.confirmationAt, d.eventKnownAt); assert.equal(recovered.state, "confirmed_awaiting_fill");
    assert.equal(recovered.startedAt, born); assert.equal(recovered.expiresAt, prior.expiresAt); assert.equal(recovered.revisionId, prior.revisionId);
    assert.equal(recovered.entryObservedAt, undefined);
  });
  it("retains the symmetric short sweep's held rejection without another source touch", () => {
    const report = observedSwingSweep(), p = report.discretionaryPlan!, z = p.priceZones!;
    report.entryStudy!.candles = report.entryStudy!.candles.map(c => ({ ...c, open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));
    report.horizonContext!.zones[0].role = "resistance";
    p.side = "short"; p.entry = 97.5; p.stop = 105; p.reference.price = 93; p.stopBasis.price = 100.01; p.evidence!.extreme = 100.01;
    z.entry = { lower: 97.5, upper: 100, sourceLower: 97.5, sourceUpper: 100, sourcePrice: 100 };
    p.targets[0].price = 90; p.targets[1].price = 80; z.targets = [{ lower: 89, upper: 90 }, { lower: 79, upper: 80 }];
    report.strategyMix = evaluateGlobalStrategyMix(report);
    assert.equal(report.strategyMix.selectedVariant, "sweep_reclaim"); assert.equal(report.strategyMix.candidates[0].side, "short");
    assert.ok(report.entryStudy!.candles[3].high < p.evidence!.level);
    const state = applyGlobalScenario(report)!;
    assert.equal(state.state, "confirmed_awaiting_fill"); assert.equal(state.confirmationAt, p.evidence!.completedAt);
    assert.equal(state.entryObservedAt, undefined); assert.equal(state.observationOnly, true);
  });
});
