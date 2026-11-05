import test from "node:test";
import assert from "node:assert/strict";
import type { GlobalReport } from "@pulse/schemas";
import { globalDesignFixture } from "./globalReport.fixtures.js";
import { globalExecutionInstructions } from "./globalExecutionInstructions.js";
import { globalEligibility } from "./globalPolicy.js";
import { globalTradeCards } from "./globalTradeDisplay.js";

function observedReport(mode: "passive_limit" | "confirmed_retest", lang: "en" | "zh" = "en") {
  const report = globalDesignFixture("pro", lang), born = Date.parse("2026-11-04T05:30:00Z");
  report.decisionVersion = "decision-v5";
  report.discretionaryPlan = { version: "discretionary-plan-v8", side: "long", family: "level_retest", objectiveTimeframe: "1H", entry: 100, stop: 95,
    reference: { timeframe: "15m", candleTs: born - 1800000, completedAt: born - 900000, price: 100 },
    entryBasis: { kind: "structure_zone", timeframe: "1H", knownAt: born - 3600000, price: 100 }, stopBasis: { price: 96, timeframe: "1H", anchorTs: born - 7200000, knownAt: born - 3600000 },
    targets: [{ price: 110, timeframe: "1H", anchorTs: born - 7200000, knownAt: born - 3600000, basis: "confirmed_swing" }], barriers: [],
    priceZones: { version: "price-zones-v1", entry: { lower: 99, upper: 100, sourceLower: 99, sourceUpper: 100, sourcePrice: 100 }, stop: { lower: 95, upper: 96 }, targets: [{ lower: 110, upper: 111 }], payoffFloor: 1, payoffLimited: false },
    executionPolicy: { version: "execution-policy-v1", id: mode === "passive_limit" ? "structural-zone-passive-v1" : "observed-reclaim-retest-v1", configurationKey: "observed-entry-projection-test", family: "level_retest", mode, sourceBoundary: 100, eventTimeframe: "15m", eventKnownAt: born - 900000, eventAfter: born - 3600000, expiresAt: born + 3600000, confirmationBars: 1, fillWindowBars: 3, stopManagement: "structural_fixed", targetAllocations: [1], entryRegion: "source_zone" },
  };
  report.scenario = { version: "scenario-lifecycle-v1", scenarioId: "observed-fixture", revisionId: "priced-fixture", state: "entry_observed", startedAt: born, updatedAt: born + 300000, expiresAt: born + 3600000,
    definition: { mode, fillWindowMs: 2700000 }, entryObservedAt: born + 300000, observationOnly: true, events: [], exits: [], remainingFraction: 1 } as GlobalReport["scenario"];
  return report;
}

for (const mode of ["passive_limit", "confirmed_retest"] as const) test(`${mode}: observed entry area supplies review instructions, never a reusable entry`, () => {
  const report = observedReport(mode), before = structuredClone(report), instruction = globalExecutionInstructions(report)!;
  assert.equal(globalEligibility(report), "no_trade");
  assert.match(instruction, /does not establish an actual fill or position/); assert.match(instruction, /cannot be reused as a new entry/);
  assert.match(instruction, /record the fill price, quantity and protection separately/);
  assert.doesNotMatch(instruction, /Passive limit plan: buy|Entry review remains limited|buy only within/);
  assert.equal(globalTradeCards(report)[0].condition, instruction, "The visible setup card uses the same observation-only instruction");
  assert.deepEqual(report, before, "Only the instruction projection changes; prices and lifecycle remain intact");
});

test("observed entry wording also stays distinct from a fill in the Chinese report", () => {
  const instruction = globalExecutionInstructions(observedReport("passive_limit", "zh"))!;
  assert.match(instruction, /不代表实际成交或持仓/); assert.match(instruction, /不能再次作为新入场/); assert.match(instruction, /单独记录实际价格/);
});
