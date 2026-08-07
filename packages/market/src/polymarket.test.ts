import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertMarketMapping, isCryptoTradingPrediction, normalizeGammaMarket, PolymarketClient } from "./polymarket.js";

const conditionId = `0x${"a".repeat(64)}`;
const raw = {
  id: "42",
  conditionId,
  questionID: "question-1",
  slug: "will-it-happen",
  question: "Will it happen?",
  outcomes: '["Yes","No"]',
  clobTokenIds: '["1001","1002"]',
  outcomePrices: '["0.6","0.4"]',
  active: true,
  closed: false,
  archived: false,
  restricted: false,
  enableOrderBook: true,
  events: [{ id: "7" }],
};

describe("crypto prediction discovery", () => {
  it("keeps price and direction markets and rejects unrelated trending markets", () => {
    assert.equal(isCryptoTradingPrediction("Bitcoin up or down in the next 5 minutes?"), true);
    assert.equal(isCryptoTradingPrediction("Will ETH be above $4,000 on August 5?"), true);
    assert.equal(isCryptoTradingPrediction("Will the U.S. invade Iran before 2027?"), false);
    assert.equal(isCryptoTradingPrediction("Will Team Liquid win its next match?"), false);
  });
});

describe("Polymarket normalization", () => {
  it("uses condition ID as canonical identity and preserves aligned token IDs", () => {
    const market = normalizeGammaMarket(raw, "2026-08-03T00:00:00.000Z");
    assert.equal(market.id, `pm:${conditionId}`);
    assert.equal(market.eligibility, "active");
    assert.deepEqual(market.outcomes, [
      { name: "Yes", tokenId: "1001", referencePrice: 0.6 },
      { name: "No", tokenId: "1002", referencePrice: 0.4 },
    ]);
  });

  it("rejects inconsistent or duplicate mappings", () => {
    assert.throws(() => normalizeGammaMarket({ ...raw, clobTokenIds: '["1001"]' }), /inconsistent/);
    assert.throws(() => normalizeGammaMarket({ ...raw, clobTokenIds: '["1001","1001"]' }), /duplicated/);
  });

  it("rejects changed mappings and inactive markets without substitution", () => {
    const expected = normalizeGammaMarket(raw);
    const changed = normalizeGammaMarket({ ...raw, clobTokenIds: '["1001","2002"]' });
    assert.throws(() => assertMarketMapping(expected, changed), /mapping changed/);
    const closed = normalizeGammaMarket({ ...raw, active: false, closed: true });
    assert.throws(() => assertMarketMapping(expected, closed), /no longer active: closed/);
  });
});

describe("Polymarket public client", () => {
  it("uses public read-only endpoints without authentication headers", async () => {
    const urls: string[] = [];
    const client = new PolymarketClient({
      fetchImpl: async (input, init) => {
        urls.push(String(input));
        assert.deepEqual(init?.headers, { Accept: "application/json" });
        return new Response(JSON.stringify({ events: [], markets: [raw] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const result = await client.search("election", 10);
    assert.equal(result.markets[0].conditionId, conditionId);
    assert.match(urls[0], /\/public-search\?/);
    assert.match(urls[0], /q=election/);
  });

  it("reports retries and cache hits to the provider observer", async () => {
    const events: Array<{ success: boolean; retries: number; cacheHit: boolean; provider: string }> = [];
    let calls = 0;
    const client = new PolymarketClient({
      maxRetries: 1, cacheTtlMs: 5_000,
      observer: (event) => events.push(event),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("temporary", { status: 500 });
        return new Response(JSON.stringify([raw]), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    await client.listMarkets({ limit: 1 });
    await client.listMarkets({ limit: 1 });
    assert.equal(calls, 2);
    assert.deepEqual(events.map(({ success, retries, cacheHit, provider }) => ({ success, retries, cacheHit, provider })), [
      { success: true, retries: 1, cacheHit: false, provider: "gamma" },
      { success: true, retries: 0, cacheHit: true, provider: "gamma" },
    ]);
  });
});
