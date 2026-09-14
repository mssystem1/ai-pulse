import assert from "node:assert/strict";
import test from "node:test";
import { formatRuleEvidence } from "./evidenceDisplay";

test("rule evidence removes floating point noise without losing small token prices", () => {
  assert.equal(formatRuleEvidence("2496.4010000000007"), "2,496.401");
  assert.equal(formatRuleEvidence("> 2512.5353999999998"), "> 2,512.5354");
  assert.equal(formatRuleEvidence("0.000003426"), "0.000003426");
  assert.equal(formatRuleEvidence(">= 80%"), ">= 80%");
  assert.equal(formatRuleEvidence("-0.00001"), "-0.00001");
});

test("rule evidence preserves text, missing data and identifiers", () => {
  for (const value of ["bullish", "not evaluated", "SMA20 above SMA50", "0x12345", "—", "NaN", "Infinity"]) {
    assert.equal(formatRuleEvidence(value), value);
  }
});
