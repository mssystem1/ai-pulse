import assert from "node:assert/strict";
import test from "node:test";
import { TradeSchema } from "./v6Routes.js";

const tokenA = "0x1111111111111111111111111111111111111111";
const tokenB = "0x2222222222222222222222222222222222222222";

test("Spot accepts 0.1 settlement token and every smaller positive atomic amount on all execution RPCs", () => {
  for (const network of ["xlayer", "base", "arbitrum"] as const) {
    for (const amount of ["100000", "1"]) {
      assert.equal(
        TradeSchema.safeParse({
          network,
          fromTokenAddress: tokenA,
          toTokenAddress: tokenB,
          amount,
        }).success,
        true,
        `${network} should accept ${amount} atomic units`,
      );
    }
  }
});

test("Spot rejects zero without inventing a fiat-denominated minimum", () => {
  assert.equal(
    TradeSchema.safeParse({
      network: "base",
      fromTokenAddress: tokenA,
      toTokenAddress: tokenB,
      amount: "0",
    }).success,
    false,
  );
});
