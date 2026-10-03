import test from "node:test";
import assert from "node:assert/strict";
import { parseRobinhoodIssuerPrice } from "./robinhoodIssuerPrice.js";
const stock = { address: "0x1111111111111111111111111111111111111111", symbol: "AMAT" };
const now = Date.now();
const quote = { tokenSymbol: stock.symbol, currency: "USD", bid: "100", ask: "102", generatedAt: new Date(now).toISOString(), isTradingHalt: false,
  deployments: [{ chainId: 4663, contractAddress: stock.address }] };
test("issuer bid/ask applies verified shares-per-token exactly once", () => {
  const result = parseRobinhoodIssuerPrice({ quotes: [{ ...quote, tokenBid: "999", tokenAsk: "999" }] }, stock, 1500000000000000000n, now);
  assert.equal(result.close, 151.5); assert.equal(result.ts, now); assert.equal(result.source, "robinhood-issuer-reference");
});
test("a ticker name cannot substitute a different token deployment", () => {
  assert.throws(() => parseRobinhoodIssuerPrice({ quotes: [{ ...quote, deployments: [{ ...quote.deployments[0], chainId: 1 }] }] }, stock, 10n ** 18n, now), /identity/);
  assert.throws(() => parseRobinhoodIssuerPrice({ quotes: [quote, quote] }, stock, 10n ** 18n, now), /ambiguous/);
});
test("halted, stale, future and crossed issuer quotes do not become executable marks", () => {
  for (const patch of [{ isTradingHalt: true }, { generatedAt: new Date(now - 180001).toISOString() }, { generatedAt: new Date(now + 30001).toISOString() }, { bid: "103" }, { bid: "0" }])
    assert.throws(() => parseRobinhoodIssuerPrice({ quotes: [{ ...quote, ...patch }] }, stock, 10n ** 18n, now));
  assert.throws(() => parseRobinhoodIssuerPrice({ quotes: [quote] }, stock, 0n, now), /invalid/);
});
