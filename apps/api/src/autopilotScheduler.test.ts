import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS,
  AUTOPILOT_PROVIDER_BLOCK_BACKOFF_MS,
  autopilotPassRemainingMs,
  nextAutopilotAiRetryAt,
  type AutopilotPass,
} from "./autopilotAutomation.js";

const pass = (overrides: Partial<AutopilotPass> = {}): AutopilotPass => ({
  owner: "0x0000000000000000000000000000000000000001",
  network: "base",
  vault: "0x0000000000000000000000000000000000000002",
  purchasedAt: "2026-08-31T10:00:00.000Z",
  expiresAt: "2026-09-01T10:00:00.000Z",
  signalLimit: 3,
  signalsUsed: 0,
  ...overrides,
});

describe("Autopilot scheduler cost controls", () => {
  it("never retries a generic provider failure sooner than 15 minutes", () => {
    const now = Date.parse("2026-08-31T10:00:00.000Z");
    assert.equal(nextAutopilotAiRetryAt({ now, minimumIntervalMs: 60_000, failureStreak: 1 }), now + AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS);
  });

  it("backs off billing and permission failures for six hours", () => {
    const now = Date.parse("2026-08-31T10:00:00.000Z");
    assert.equal(nextAutopilotAiRetryAt({ now, minimumIntervalMs: AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS, failureStreak: 1, error: "Grok API 403: permission-denied; credits exhausted" }), now + AUTOPILOT_PROVIDER_BLOCK_BACKOFF_MS);
  });

  it("freezes paid time at the moment a vault is paused", () => {
    const pausedAt = "2026-08-31T12:00:00.000Z";
    assert.equal(autopilotPassRemainingMs(pass({ pausedAt }), Date.parse("2026-08-31T18:00:00.000Z")), 22 * 60 * 60_000);
  });
});
