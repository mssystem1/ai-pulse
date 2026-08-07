import type { NormalizedPolymarketMarket } from "@pulse/market";

export type RejectedMarket = Readonly<{ id: string; reason: string }>;
export type ValidatedSelection = Readonly<{
  primaryMarket: NormalizedPolymarketMarket | null;
  additionalMarkets: readonly NormalizedPolymarketMarket[];
  usedMarketIds: readonly string[];
  rejectedMarkets: readonly RejectedMarket[];
}>;

/**
 * PULSE consumes public market data and never places a Polymarket order.
 * `restricted` is therefore a trading/compliance signal, not a reason to
 * suppress read-only analysis. Closed, archived, inactive, or non-CLOB
 * markets remain ineligible because their evidence cannot support a live
 * report.
 */
export function isAnalyticsEligible(market: NormalizedPolymarketMarket): boolean {
  return market.active && !market.closed && !market.archived && market.enableOrderBook;
}

export async function validateMarketSelection(input: {
  primaryMarketId: string;
  additionalMarketIds?: readonly string[];
  maxSelected: number;
  load: (id: string) => Promise<NormalizedPolymarketMarket>;
}): Promise<ValidatedSelection> {
  const requested = [input.primaryMarketId, ...(input.additionalMarketIds || [])];
  const unique = [...new Set(requested)];
  const rejected: RejectedMarket[] = [];
  if (unique.length > input.maxSelected) {
    for (const id of unique.slice(input.maxSelected)) rejected.push(Object.freeze({ id, reason: "selection_limit_exceeded" }));
  }
  const acceptedIds = unique.slice(0, input.maxSelected);
  const loaded = await Promise.all(acceptedIds.map(async (id) => {
    try {
      const market = await input.load(id);
      if (!isAnalyticsEligible(market)) {
        rejected.push(Object.freeze({ id, reason: `market_${market.eligibility}` }));
        return null;
      }
      return market;
    } catch (error) {
      rejected.push(Object.freeze({ id, reason: error instanceof Error ? error.message : "market_unavailable" }));
      return null;
    }
  }));
  const primary = loaded[0] || null;
  const additional = loaded.slice(1).filter((market): market is NormalizedPolymarketMarket => market !== null);
  return Object.freeze({
    primaryMarket: primary,
    additionalMarkets: Object.freeze(additional),
    usedMarketIds: Object.freeze([...(primary ? [primary.id] : []), ...additional.map((market) => market.id)]),
    rejectedMarkets: Object.freeze(rejected),
  });
}
