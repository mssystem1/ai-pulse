import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTOPILOT_CAPITAL,
  DEFAULT_TRADE_AMOUNT,
  positiveTokenAmount,
  arcLimitMinimum,
} from "./tradeAmounts.js";

test("Spot and Autopilot leave financial decisions empty by default", () => {
  assert.equal(DEFAULT_TRADE_AMOUNT, "");
  assert.equal(DEFAULT_AUTOPILOT_CAPITAL, "");
});

test("Arc cirBTC limit minimum uses eight decimals and cannot overstate signed output", () => {
  assert.equal(arcLimitMinimum("0.2", "82753", "0.5", "buy", 6, 8), "0.0000024");
  assert.equal(arcLimitMinimum("0.0000024", "82753", "0.5", "sell", 8, 6), "0.197614");
  assert.equal(arcLimitMinimum("0.000001", "82753", "0.5", "buy", 6, 8), "");
});

test("0.1 USDC, USDT0 and USDG are valid on every six-decimal settlement network", () => {
  for (const network of ["xlayer", "base", "arbitrum", "robinhood"]) {
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
