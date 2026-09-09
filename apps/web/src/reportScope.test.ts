import test from "node:test";
import assert from "node:assert/strict";
import { storeScopedReport } from "./reportScope";
test("Risk Guard results never replace Global reports, including delayed completion after navigation", () => {
  const global = { service: "spot_analysis_standard", instId: "WIF-USDT" };
  const risk = { service: "preflight", token: { symbol: "AERO" } };
  const slots = storeScopedReport({ global, risk: null }, risk, "global");
  assert.equal(slots.global, global);
  assert.equal(slots.risk, risk);
  assert.deepEqual(storeScopedReport(slots, null, "risk"), { global, risk: null });
});
