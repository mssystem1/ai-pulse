import assert from "node:assert/strict";
import { it } from "node:test";
import type { NormalizedPolymarketMarket } from "@pulse/market";
import { preparePredictionContext } from "./predictionContext.js";

const market: NormalizedPolymarketMarket = Object.freeze({
  id: "pm:condition", gammaMarketId: "1", eventIds: Object.freeze([]), conditionId: "condition",
  questionId: null, question: "Will it happen?", description: null, resolutionSource: null,
  slug: "will-it-happen", outcomes: Object.freeze([
    Object.freeze({ name: "Yes", tokenId: "100", referencePrice: 0.55 }),
    Object.freeze({ name: "No", tokenId: "101", referencePrice: 0.45 }),
  ]), active: true, closed: false, archived: false, restricted: false, enableOrderBook: true,
  negRisk: false, eligibility: "active", endDate: new Date(Date.now() + 86_400_000).toISOString(),
  updatedAt: null, liquidityUsd: 50_000, volumeUsd: 5_000, observedAt: new Date().toISOString(),
});

it("prepares only explicitly selected markets and records optional source failures", async () => {
  const context = await preparePredictionContext({
    primaryMarketId: market.id, additionalMarketIds: [], maxSelected: 3,
    source: {
      async getMarket() { return market; },
      async getOrderBook(tokenId) { return { market: tokenId, asset_id: tokenId, timestamp: String(Date.now()), hash: "h", bids: [{ price: "0.54", size: "10000" }], asks: [{ price: "0.56", size: "10000" }], min_order_size: "1", tick_size: "0.01", neg_risk: false }; },
      async getHistory() { return [{ timestamp: 1, probability: 0.5 }, { timestamp: 2, probability: 0.55 }]; },
      async getOpenInterest() { throw new Error("optional unavailable"); },
    },
  });
  assert.deepEqual(context.usedMarketIds, ["pm:condition"]);
  assert.equal(context.markets[0].outcomes.length, 2);
  assert.equal(context.partial, true);
  assert.match(context.missingSources[0], /open_interest/);
});
