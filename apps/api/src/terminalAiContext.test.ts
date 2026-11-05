import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalMarketSnapshot } from "@pulse/domain";
import type { GlobalReport } from "@pulse/schemas";
import type { TerminalPosition, TerminalRadar } from "./terminalStore.js";
import { terminalAiContext, terminalSelectedInspection, TerminalInspectionUnavailableError } from "./terminalAiContext.js";
import { globalDesignFixture } from "../../../packages/domain/src/globalReport.fixtures.js";
import { advanceGlobalScenario, createGlobalScenarioDefinition } from "@pulse/analysis";

/** Generated software fixture only; no live market or performance assertion. */
function pricedReport(firstTarget = 110, nearestObstacle = 105): GlobalReport {
  const report = globalDesignFixture("pro"), born = Date.parse("2026-11-04T05:30:00Z"), minute = 60_000;
  report.decisionVersion = "decision-v5"; report.snapshot.instId = "BTC-USDT"; report.snapshot.observedAt = new Date(born).toISOString(); report.snapshot.price = 100;
  report.discretionaryPlan = { version: "discretionary-plan-v8", family: "level_retest", side: "long", objectiveTimeframe: "1H", entry: 100, stop: 95,
    entryBasis: { kind: "structure_zone", timeframe: "1H", knownAt: born - 120 * minute, price: 100 },
    stopBasis: { price: 96, timeframe: "1H", anchorTs: born - 180 * minute, knownAt: born - 120 * minute },
    reference: { timeframe: "15m", candleTs: born - 30 * minute, completedAt: born - 15 * minute, price: 100 },
    targets: [{ price: firstTarget, timeframe: "1H", anchorTs: born - 180 * minute, knownAt: born - 120 * minute, basis: "confirmed_swing" }],
    barriers: [{ price: nearestObstacle, timeframe: "1H", anchorTs: born - 180 * minute, knownAt: born - 120 * minute }],
    priceZones: { version: "price-zones-v1", entry: { lower: 99, upper: 100, sourceLower: 99, sourceUpper: 100, sourcePrice: 100 }, stop: { lower: 95, upper: 96 }, targets: [{ lower: firstTarget, upper: firstTarget + 1 }], payoffFloor: 1, payoffLimited: nearestObstacle < 105 },
    executionPolicy: { version: "execution-policy-v1", id: "observed-reclaim-retest-v1", configurationKey: "BTC:1H:ai-eligibility-test", family: "level_retest", mode: "confirmed_retest", sourceBoundary: 100, eventTimeframe: "15m", eventKnownAt: born - 15 * minute, eventAfter: born - 120 * minute, expiresAt: born + 60 * minute, confirmationBars: 1, fillWindowBars: 3, stopManagement: "structural_fixed", targetAllocations: [1], entryRegion: "defended_retest" },
  };
  const p = report.discretionaryPlan, policy = p.executionPolicy!;
  const definition = createGlobalScenarioDefinition({ market: "okx-public-spot:BTC-USDT", timeframe: "1H", family: "level_retest", side: "long", policyId: policy.id, configurationKey: policy.configurationKey,
    sourceKey: "fixture-confirmed-support", sourceKnownAt: p.entryBasis.knownAt, sourceTimeframe: "1H", sourceLower: 99, sourceUpper: 100, sourcePrice: 100,
    stopBasis: p.stopBasis, createdAt: born, mode: policy.mode, entryZone: [99, 100], hardStop: 95, targets: [{ id: "tp1", lower: firstTarget, upper: firstTarget + 1, allocation: 1 }],
    sourceBoundary: 100, eventTimeframe: "15m", eventAfter: policy.eventAfter, eventKnownAt: policy.eventKnownAt, expiresAt: policy.expiresAt,
    confirmationMaxAgeMs: 60 * minute, fillWindowMs: 45 * minute, confirmationBars: 1 });
  report.scenario = advanceGlobalScenario(definition, null, [{ id: "fixture-confirmation", kind: "confirmation", at: born - 15 * minute, candleTs: born - 30 * minute, price: 100, basis: "completed_candle" }], born);
  report.tradePlan = { side: "long", pathId: "recovery", state: "conditional", condition: "close_retest", triggerLevelId: "reclaim", invalidationLevelId: "floor", targetIds: ["target1"], referenceEntry: [99, 100], referenceStop: 95, grossRewardRisk: (firstTarget - 100) / 5, stopBufferAtr: .2, confirmationTs: born - 15 * minute, retestTs: null, blockers: firstTarget < 105 ? ["reward", "retest"] : ["retest"], method: "structure-v5" };
  return report;
}

const marketSnapshot = (report: GlobalReport) => ({ observedAt: Date.parse(report.snapshot.observedAt), report, sources: [], tools: { value: {}, flow: {}, derivatives: {}, liquidity: {} } } as unknown as TerminalMarketSnapshot);

test("large source histories cannot push selected positions or fixed prices out of AI context", () => {
  const candles = Array.from({ length: 10_000 }, (_, ts) => ({ ts, open: 100, high: 103, low: 99, close: 101, volume: 1, confirmed: true }));
  const report = pricedReport(); report.context.candles = candles; report.context.sma55 = candles.map(candle => ({ ts: candle.ts, value: 100 }));
  const massive = { id: "value", source: "real-executions", status: "partial", knownAt: 1, windowStart: 0, windowEnd: 1, orderFlow: { profile: { poc: 101, val: 99, vah: 103, rows: candles } } };
  const snapshot = { observedAt: 1, report, sources: [massive], tools: { value: massive, flow: { points: candles }, derivatives: {}, liquidity: { bids: candles, asks: candles } } } as unknown as TerminalMarketSnapshot;
  const position = { id: "my-private-position", instId: "BTC-USDT", side: "short", averageEntry: 102, quantity: 2, hardStop: 106, protectionStatus: "user_reported", events: [{ kind: "open", price: 102, quantity: 2, provenance: "user_reported" }] } as unknown as TerminalPosition;
  const context = terminalAiContext({ snapshot, report, selected: { position }, exposure: [position] }), serialized = JSON.stringify(context), decoded = JSON.parse(serialized);
  assert.ok(serialized.length < 25_000); assert.equal(decoded.selected.position.id, position.id); assert.equal(decoded.selected.position.hardStop, 106); assert.equal(decoded.setup.stop, 95); assert.equal(decoded.setup.targets[0].price, 110);
  assert.equal(decoded.higherContext.candles.length, 16); assert.equal(decoded.higherContext.sma55.length, 16); assert.equal(decoded.sources[0].orderFlow, undefined); assert.equal(decoded.tools.value.profile.rows, undefined); assert.equal(decoded.tools.value.profile.highestVolumeRows.length, 8); assert.equal(decoded.exposure[0].quantity, 2);
});

test("Radar context retains its selected sequence without raw observations or an inline report", () => {
  const report = pricedReport(), snapshot = marketSnapshot(report);
  const radar = { id: "my-radar", definition: { boundary: 100 }, snapshot: { status: "developing", stage: 2, observations: new Array(512).fill({ price: 100 }), events: [{ kind: "second_stage", at: 1, price: 101 }] } } as unknown as TerminalRadar;
  const context = terminalAiContext({ snapshot, report, selected: { radar }, exposure: [] }), decoded = JSON.parse(JSON.stringify(context));
  assert.equal(decoded.selected.radar.sequence.stage, 2); assert.equal(decoded.selected.radar.sequence.events.length, 1); assert.ok(!JSON.stringify(context).includes("observations"));
});

test("confirmed scenario does not become qualified when the canonical decision says WAIT and nearest payoff is poor", () => {
  const report = pricedReport(101.65, 100.55), before = structuredClone(report);
  assert.equal(report.scenario!.state, "confirmed_awaiting_fill", "The fixture uses a genuinely advanced canonical lifecycle");
  const context = terminalAiContext({ snapshot: marketSnapshot(report), report, selected: {}, exposure: [] });
  assert.equal(context.scenario!.state, "confirmed_awaiting_fill");
  for (const eligibility of [context.selectedSetupEligibility, context.currentEligibility]) {
    assert.equal(eligibility.qualified, false); assert.equal(eligibility.currentAction, "WAIT"); assert.equal(eligibility.globalEligibility, "waiting_retest");
    assert.ok(eligibility.blockers.includes("reward")); assert.ok(eligibility.blockers.includes("nearest_obstacle_reward_below_required_floor"));
    assert.ok(Math.abs(eligibility.payoff!.worstToTP1 - .33) < 1e-9); assert.ok(Math.abs(eligibility.payoff!.worstToObstacle - .11) < 1e-9);
    assert.equal(eligibility.payoff!.leastFavorableEntry, 100); assert.equal(eligibility.payoff!.hardStop, 95); assert.equal(eligibility.payoff!.requiredNearestObstacleR, 1);
    assert.equal(eligibility.entryDeadline, report.scenario!.confirmationAt! + report.scenario!.definition.fillWindowMs); assert.equal(eligibility.risk?.distance, 5);
  }
  assert.deepEqual(report, before, "AI evidence cannot alter prices, policy or qualification");
});

test("selected historical setup and current market keep separate deterministic eligibility and deadlines", () => {
  const saved = pricedReport(101.65, 100.55), current = structuredClone(saved);
  current.snapshot.observedAt = new Date(Date.parse(saved.snapshot.observedAt) + 120 * 60_000).toISOString(); current.scenario!.state = "expired";
  const context = terminalAiContext({ snapshot: marketSnapshot(current), report: saved, selected: {}, exposure: [] });
  assert.equal(context.selectedSetupMatchesCurrentSnapshot, false); assert.equal(context.selectedSetupEligibility.globalEligibility, "waiting_retest");
  assert.equal(context.currentEligibility.globalEligibility, "expired"); assert.equal(context.currentEligibility.currentAction, "WAIT"); assert.equal(context.currentEligibility.qualified, false);
  assert.notEqual(context.selectedSetupEligibility.assessedAt, context.currentEligibility.assessedAt);
  assert.equal(context.scenario!.state, "confirmed_awaiting_fill"); assert.equal(context.currentScenario!.state, "expired");
});

test("tool inspection preserves a displayed older footprint instead of the two latest buckets", () => {
  const report = pricedReport(), displayed = marketSnapshot(report), current = marketSnapshot(structuredClone(report));
  displayed.instId = current.instId = "BTC-USDT"; displayed.timeframe = current.timeframe = "1H";
  displayed.observedAt = 500; current.observedAt = 900;
  const rows = [{ low: 99, high: 100, buy: 5, sell: 3, trades: 2 }];
  const bars = [100, 200, 300, 400].map(start => ({ start, end: start + 100, knownAt: start + 100, open: 99.5, high: 99.9, low: 99.1, close: 99.8, buy: start, sell: 3, volume: start + 3, delta: start - 3, trades: 2, rows }));
  displayed.tools.value = { id: "value", label: "Value", source: "displayed-executions", status: "partial", knownAt: 500, windowStart: 100, windowEnd: 500,
    orderFlow: { profile: { ...bars[0], start: 100, end: 500 }, footprints: bars } as unknown as NonNullable<typeof displayed.tools.value.orderFlow> };
  current.tools.value = { ...displayed.tools.value, source: "newer-executions", knownAt: 900, orderFlow: { ...displayed.tools.value.orderFlow!, footprints: bars.slice(-2) } };
  const context = terminalAiContext({ snapshot: current, report, inspection: { tool: "footprint", footprintStart: 100 }, inspectionEvidence: displayed, selected: {}, exposure: [] });
  const selected = JSON.parse(JSON.stringify(context.selectedInspection));
  assert.equal(selected.windowKind, "completed-footprint"); assert.equal(selected.observedAt, 500); assert.equal(selected.source.source, "displayed-executions");
  assert.equal(selected.values.start, 100); assert.equal(selected.values.buy, 100); assert.equal(selected.values.totalPriceRows, 1); assert.equal(selected.values.highestVolumeRows[0].buy, 5);
  assert.equal(context.tools.value.footprints[0].start, 300, "Current overview remains distinct from the selected historical bucket");
  assert.throws(() => terminalSelectedInspection(current, { tool: "footprint", footprintStart: 100 }), TerminalInspectionUnavailableError);
});

test("tool inspection preserves the selected perpetual stream and does not substitute Spot when absent", () => {
  const displayed = marketSnapshot(pricedReport()); displayed.instId = "BTC-USDT"; displayed.timeframe = "1H";
  displayed.tools.flow = { id: "flow", label: "Spot", source: "spot-trades", status: "partial", knownAt: 500, marketType: "spot", units: "base", buy: 1, sell: 2, delta: -1, points: [] };
  displayed.tools.perpetualFlow = { id: "perpetual-flow", label: "Perpetual", source: "perpetual-trades", status: "partial", knownAt: 500, marketType: "perpetual", units: "contracts", buy: 100, sell: 30, delta: 70, points: [] };
  const selected = JSON.parse(JSON.stringify(terminalSelectedInspection(displayed, { tool: "flow", stream: "perpetual" })));
  assert.equal(selected.stream, "perpetual"); assert.equal(selected.source.units, "contracts"); assert.equal(selected.values.buy, 100); assert.equal(selected.values.marketType, "perpetual");
  displayed.tools.perpetualFlow = undefined;
  const absent = JSON.parse(JSON.stringify(terminalSelectedInspection(displayed, { tool: "flow", stream: "perpetual" })));
  assert.equal(absent.unavailable, true); assert.equal(absent.source.status, "unavailable"); assert.equal(absent.values, undefined);
});
