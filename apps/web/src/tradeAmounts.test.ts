import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTOPILOT_CAPITAL,
  DEFAULT_TRADE_AMOUNT,
  positiveTokenAmount,
} from "./tradeAmounts.js";

test("Spot and Autopilot leave financial decisions empty by default", () => {
  assert.equal(DEFAULT_TRADE_AMOUNT, "");
  assert.equal(DEFAULT_AUTOPILOT_CAPITAL, "");
});

test("0.1 USDC and USDT0 are valid on every six-decimal settlement network", () => {
  for (const network of ["xlayer", "base", "arbitrum"]) {
    assert.equal(positiveTokenAmount("0.1", 6), 100_000n, network);
  }
});

test("validation allows any positive representable amount and rejects zero or excess precision", () => {
  assert.equal(positiveTokenAmount("0.000001", 6), 1n);
  assert.equal(positiveTokenAmount("1", 6), 1_000_000n);
  assert.equal(positiveTokenAmount("0", 6), null);
  assert.equal(positiveTokenAmount("-0.1", 6), null);
  assert.equal(positiveTokenAmount("0.0000001", 6), null);
});
