import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { ROBINHOOD_FUNDING as C, ROBINHOOD_FUNDING_ABI as abi, validateRobinhoodFunding, validateRobinhoodSwap } from "./robinhoodFunding.js";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const now = 1_800_000_000_000;
const base = { fromToken: BigInt(C.native), toToken: C.usdg, fromTokenAmount: 100_000_000_000_000n,
  minReturnAmount: 298_500n, deadLine: BigInt(now / 1000 + 600) };
function sample(changes: Partial<typeof base> = {}, receiver: `0x${string}` = owner) {
  return { quote: { chainId: "4663", fromTokenAmount: base.fromTokenAmount.toString(), toTokenAmount: "300000",
    fromToken: { address: C.native, decimals: 18, symbol: "ETH" }, toToken: { address: C.usdg, decimals: 6, symbol: "USDG" },
    priceImpactPercent: "0.02", estimateGasFee: "0", tradeFee: "0", route: ["Uniswap V3"], quoteId: "fixture" },
    tx: { from: owner, to: C.router, value: base.fromTokenAmount.toString(), gas: "1", gasPrice: "1", maxPriorityFeePerGas: null,
      data: encodeFunctionData({ abi, functionName: "dagSwapTo", args: [1n, receiver, { ...base, ...changes }, []] }) },
    slippage: { mode: "manual", percent: "0.5", maxPercent: null } };
}
const validate = (swap = sample()) => validateRobinhoodFunding(swap, base.fromTokenAmount.toString(), owner, now);

test("execution validation binds the signed router calldata to the requested wallet/assets/amount", () => {
  const request = { from: C.native, to: C.usdg, amount: base.fromTokenAmount.toString(), receiver: owner, slippageBps: 50 };
  assert.equal(validateRobinhoodSwap(sample(), request, now).minimum, 298500n);
  assert.throws(() => validateRobinhoodSwap(sample({}, other), request, now), /identity/);
  assert.throws(() => validateRobinhoodSwap(sample({ minReturnAmount: 1n }), request, now), /minimum/);
  assert.throws(() => validateRobinhoodSwap(sample(), { ...request, slippageBps: 1001 }, now), /slippage/);
  assert.throws(() => validateRobinhoodSwap({ ...sample(), quote: null }, request, now), /identity/);
});
test("verified Robinhood DAG ABI checks the same selector returned by the live API", () => {
  const byOrder = sample();
  byOrder.tx.data = encodeFunctionData({ abi, functionName: "dagSwapByOrderId", args: [1n, base, []] });
  assert.equal(byOrder.tx.data.slice(0, 10), "0xf2c42696");
  assert.equal(validate(byOrder).minToAmount, "298500");
  const q = validate(); assert.equal(q.minToAmount, "298500"); assert.equal(q.expiresAt, now + 45_000);
});
test("funding rejects recipient/output/amount changes inside valid-looking transaction metadata", () => {
  for (const bad of [sample({}, other), sample({ toToken: other }), sample({ fromTokenAmount: 1n }), sample({ fromToken: 1n })]) {
    assert.throws(() => validate(bad), /calldata/);
  }
});
test("funding rejects missing, excessive or expired slippage protection", () => {
  for (const minReturnAmount of [0n, 298_499n, 300_001n]) assert.throws(() => validate(sample({ minReturnAmount })), /minimum/);
  assert.throws(() => validate(sample({ deadLine: BigInt(now / 1000) })), /expired/);
});
test("funding rejects another router, value, chain, decimals, asset and large impact", () => {
  const altered = [() => { const q = sample(); q.tx.to = other; return q; },
    () => { const q = sample(); q.tx.value = "1"; return q; },
    () => { const q = sample(); q.quote.chainId = "8453"; return q; },
    () => { const q = sample(); q.quote.toToken.decimals = 18; return q; },
    () => { const q = sample(); q.quote.toToken.address = other; return q; },
    () => { const q = sample(); q.quote.priceImpactPercent = "1.01"; return q; }];
  for (const make of altered) assert.throws(() => validate(make()));
});
