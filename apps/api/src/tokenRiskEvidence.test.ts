import { test } from "node:test";
import assert from "node:assert/strict";
import { compactPair } from "./tokenRiskEvidence.js";

test("DexScreener quote-token evidence cannot inherit the other asset's valuation or website", () => {
  const pair = { baseToken: { address: "0xabc", symbol: "BASE" }, quoteToken: { address: "0xdef", symbol: "QUOTE" }, priceUsd: "10", marketCap: 1_000_000, fdv: 2_000_000, priceChange: { h24: 50 }, liquidity: { usd: 100 }, info: { websites: [{ url: "https://base.example" }] } };
  const quote = compactPair(pair, "0xdef");
  assert.equal(quote.token.symbol, "QUOTE");
  assert.equal(quote.priceUsd, null);
  assert.equal(quote.marketCap, null);
  assert.equal(quote.fdv, null);
  assert.equal(quote.priceChange, null);
  assert.deepEqual(quote.websites, []);
  assert.deepEqual(quote.liquidity, { usd: 100 });
  const base = compactPair(pair, "0xABC");
  assert.equal(base.marketCap, 1_000_000);
  assert.equal(base.websites.length, 1);
});
