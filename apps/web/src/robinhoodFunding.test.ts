import test from "node:test";
import assert from "node:assert/strict";
import { submitRobinhoodFunding, validateFundingQuote, type RobinhoodFundingQuote, type FundingProvider } from "./robinhoodFunding.js";
const owner = "0x1111111111111111111111111111111111111111";
const value = 100_000_000_000_000n;
const quote = (): RobinhoodFundingQuote => ({ network: "robinhood", chainId: 4663, fromAmount: value.toString(), toAmount: "300000", minToAmount: "298500",
  toToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", expiresAt: Date.now() + 45_000, priceImpactPercent: "0.02", route: ["Uniswap V3"],
  transaction: { from: owner, to: "0x6e2a35a7ad683cf634d91492d73bb7ff774c6919", data: "0xf2c4269600", value: value.toString() } });
function wallet(override: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const values: Record<string, unknown> = { eth_chainId: "0x1237", eth_accounts: [owner], eth_call: "0x", eth_estimateGas: "0x186a0",
    eth_gasPrice: "0x5f5e100", eth_getBalance: "0x38d7ea4c68000", eth_sendTransaction: `0x${"a".repeat(64)}`, ...override };
  const provider: FundingProvider = { async request({ method, params }) {
    calls.push(method);
    if (method === "eth_sendTransaction") assert.equal((params![0] as { chainId: string }).chainId, "0x1237");
    if (values[method] instanceof Error) throw values[method];
    return values[method];
  } };
  return { provider, calls };
}
test("funding simulates and checks gas/balance/account before one wallet submission", async () => {
  const w = wallet(); assert.match(await submitRobinhoodFunding(w.provider, quote(), owner, value), /^0xa{64}$/);
  assert.equal(w.calls.filter(x => x === "eth_sendTransaction").length, 1);
  assert.ok(w.calls.indexOf("eth_call") < w.calls.indexOf("eth_sendTransaction"));
  assert.equal(w.calls.filter(x => x === "eth_chainId").length, 2);
});
test("failed simulation, gas reserve, wrong wallet and wrong chain never request a signature", async () => {
  for (const change of [{ eth_call: new Error("revert") }, { eth_getBalance: `0x${value.toString(16)}` }, { eth_chainId: "0x2105" }, { eth_accounts: [] }]) {
    const w = wallet(change); await assert.rejects(submitRobinhoodFunding(w.provider, quote(), owner, value));
    assert.equal(w.calls.includes("eth_sendTransaction"), false);
  }
});
test("expired quote, changed amount and wrong output cannot be signed", () => {
  assert.throws(() => validateFundingQuote({ ...quote(), expiresAt: Date.now() - 1 }, owner, value), /expired/);
  assert.throws(() => validateFundingQuote(quote(), owner, value + 1n), /match/);
  assert.throws(() => validateFundingQuote({ ...quote(), toToken: owner }, owner, value), /match/);
});
