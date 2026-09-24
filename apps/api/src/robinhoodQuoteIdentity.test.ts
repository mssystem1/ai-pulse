import test from "node:test";
import assert from "node:assert/strict";
import { assertRobinhoodQuoteIdentity } from "./okxDex.js";

const input = { chainId: "4663", fromTokenAddress: "0x1111111111111111111111111111111111111111", toTokenAddress: "0x2222222222222222222222222222222222222222", amount: "1000000" };
const quote = { chainIndex: "4663", fromToken: { tokenContractAddress: input.fromTokenAddress }, toToken: { tokenContractAddress: input.toTokenAddress }, fromTokenAmount: "1000000", toTokenAmount: "25" };

test("Robinhood exact-input route evidence binds contracts, amount and any supplied chain", () => {
  assert.doesNotThrow(() => assertRobinhoodQuoteIdentity(quote, input));
  assert.doesNotThrow(() => assertRobinhoodQuoteIdentity({ ...quote, chainIndex: undefined }, input));
  for (const changed of [
    { chainIndex: "8453" }, { fromToken: quote.toToken }, { toToken: quote.fromToken },
    { fromTokenAmount: "999999" }, { fromTokenAmount: "1e6" }, { toTokenAmount: "0" },
    { toTokenAmount: "-1" }, { toTokenAmount: "NaN" },
  ]) assert.throws(() => assertRobinhoodQuoteIdentity({ ...quote, ...changed }, input), /Robinhood quote/);
  assert.throws(() => assertRobinhoodQuoteIdentity({}, input), /Robinhood quote/);
});

test("Robinhood-specific route guard leaves other networks unchanged", () => {
  assert.doesNotThrow(() => assertRobinhoodQuoteIdentity({}, { ...input, chainId: "8453" }));
});
