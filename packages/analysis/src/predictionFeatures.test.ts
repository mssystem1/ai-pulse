import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClobOrderBook, NormalizedPolymarketMarket } from "@pulse/market";
import { calculateFusionFeatures, calculatePredictionFeatures } from "./predictionFeatures.js";
import { validateMarketSelection } from "./selection.js";

const market = {
  id: `pm:0x${"a".repeat(64)}`,
  gammaMarketId: "1", eventIds: [], conditionId: `0x${"a".repeat(64)}`,
  questionId: null, slug: null, question: "Will it happen?", description: null,
  resolutionSource: null, outcomes: [{ name: "Yes", tokenId: "1", referencePrice: 0.5 }],
  active: true, closed: false, archived: false, restricted: false, enableOrderBook: true,
  negRisk: false, endDate: "2026-08-04T00:00:00.000Z", updatedAt: null,
  volumeUsd: 10_000, liquidityUsd: 50_000, eligibility: "active",
  observedAt: "2026-08-03T00:00:00.000Z",
} as NormalizedPolymarketMarket;

const book: ClobOrderBook = {
  market: market.conditionId, asset_id: "1", timestamp: String(Date.parse("2026-08-03T00:00:00Z")),
  hash: "hash", bids: [{ price: "0.48", size: "10000" }], asks: [{ price: "0.52", size: "10000" }],
  min_order_size: "1", tick_size: "0.01", neg_risk: false, last_trade_price: "0.51",
};

describe("prediction and fusion features", () => {
  it("distinguishes midpoint, executable prices, quality, and probability change", () => {
    const features = calculatePredictionFeatures({
      market, outcomeTokenId: "1", orderBook: book,
      history: [{ timestamp: 1, probability: 0.4 }, { timestamp: 2, probability: 0.5 }],
      nowMs: Date.parse("2026-08-03T00:01:00Z"),
    });
    assert.equal(features.bestBid, 0.48);
    assert.equal(features.bestAsk, 0.52);
    assert.equal(features.midpointProbability, 0.5);
    assert.equal(features.probabilityDirection, "rising");
    assert.equal(features.spreadQuality, "medium");
    assert.equal(features.stale, false);
  });

  it("calculates divergence only for compatible horizons", () => {
    const prediction = calculatePredictionFeatures({
      market, outcomeTokenId: "1", orderBook: book,
      history: [{ timestamp: 1, probability: 0.6 }, { timestamp: 2, probability: 0.4 }],
      nowMs: Date.parse("2026-08-03T00:00:00Z"),
    });
    const fusion = calculateFusionFeatures({ spotChangePct: 3, spotTimeframeHours: 4, prediction });
    assert.equal(fusion.agreement, "divergence");
    assert.ok(fusion.divergenceStrength > 0);
  });

  it("reports rejected selected markets without substitution", async () => {
    const rejected = { ...market, id: "pm:closed", active: false, closed: true, eligibility: "closed" } as NormalizedPolymarketMarket;
    const result = await validateMarketSelection({
      primaryMarketId: market.id,
      additionalMarketIds: [rejected.id, "pm:missing"],
      maxSelected: 3,
      load: async (id) => {
        if (id === market.id) return market;
        if (id === rejected.id) return rejected;
        throw new Error("market_unavailable");
      },
    });
    assert.deepEqual(result.usedMarketIds, [market.id]);
    assert.deepEqual(result.rejectedMarkets.map((item) => item.id), [rejected.id, "pm:missing"]);
  });

  it("allows restricted markets for read-only analytics while retaining the restriction flag", async () => {
    const restricted = {
      ...market,
      restricted: true,
      eligibility: "restricted",
    } as NormalizedPolymarketMarket;
    const result = await validateMarketSelection({
      primaryMarketId: restricted.id,
      maxSelected: 1,
      load: async () => restricted,
    });
    assert.equal(result.primaryMarket?.id, restricted.id);
    assert.equal(result.primaryMarket?.restricted, true);
    assert.deepEqual(result.rejectedMarkets, []);
  });
});
