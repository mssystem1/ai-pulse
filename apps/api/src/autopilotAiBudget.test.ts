import assert from "node:assert/strict";
import test from "node:test";
import { AutopilotAiBudgetExceededError, actualAutopilotSignalCostUsd, estimatedAutopilotSignalCostUsd, reserveAutopilotAiBudget, resetAutopilotAiBudgetForTests } from "./autopilotAiBudget.js";

const limits = { maxCallsPerVaultDay: 2, maxCallsGlobalDay: 3, maxUsdPerVaultDay: 0.02, maxUsdGlobalDay: 0.03 };

test("reserves compact Autopilot model cost and deduplicates a signal call", async () => {
  resetAutopilotAiBudgetForTests();
  const estimated = estimatedAutopilotSignalCostUsd({ maxInputTokens: 4000, maxOutputTokens: 320, inputUsdPerMillion: 1.25, outputUsdPerMillion: 2.5 });
  assert.equal(estimated, 0.0058);
  await reserveAutopilotAiBudget({ strategyId: "vault-a", reservationId: "same-candle", estimatedCostUsd: estimated, limits, now: new Date("2026-08-29T00:00:00Z") });
  await reserveAutopilotAiBudget({ strategyId: "vault-a", reservationId: "same-candle", estimatedCostUsd: estimated, limits, now: new Date("2026-08-29T00:00:00Z") });
  await reserveAutopilotAiBudget({ strategyId: "vault-a", reservationId: "second", estimatedCostUsd: estimated, limits, now: new Date("2026-08-29T01:00:00Z") });
  await assert.rejects(() => reserveAutopilotAiBudget({ strategyId: "vault-a", reservationId: "third", estimatedCostUsd: estimated, limits, now: new Date("2026-08-29T02:00:00Z") }), (error) => error instanceof AutopilotAiBudgetExceededError && error.dimension === "vault_calls");
});

test("computes actual cached-input cost separately from the fail-closed reservation", () => {
  assert.equal(actualAutopilotSignalCostUsd({ promptTokens: 2000, completionTokens: 200, cachedTokens: 1000, inputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 2.5 }), 0.00195);
});
