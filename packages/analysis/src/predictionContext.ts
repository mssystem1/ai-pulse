import type { ClobOrderBook, NormalizedPolymarketMarket, ProbabilityPoint } from "@pulse/market";
import { calculatePredictionFeatures, type PredictionFeatures } from "./predictionFeatures.js";
import { validateMarketSelection, type RejectedMarket } from "./selection.js";

export type PredictionDataSource = Readonly<{
  getMarket(id: string): Promise<NormalizedPolymarketMarket>;
  getOrderBook(tokenId: string): Promise<ClobOrderBook>;
  getHistory(tokenId: string, interval?: string, fidelity?: number): Promise<ProbabilityPoint[]>;
  getOpenInterest(conditionId: string): Promise<number | null>;
}>;

export type PreparedPredictionMarket = Readonly<{
  market: NormalizedPolymarketMarket;
  outcomes: readonly Readonly<{
    name: string;
    tokenId: string;
    orderBook: ClobOrderBook;
    history: readonly ProbabilityPoint[];
    features: PredictionFeatures;
  }>[];
  openInterest: number | null;
  partial: boolean;
  missingSources: readonly string[];
}>;

export type PreparedPredictionContext = Readonly<{
  selectionMode: "user";
  primaryMarketId: string;
  requestedAdditionalMarketIds: readonly string[];
  usedMarketIds: readonly string[];
  rejectedMarkets: readonly RejectedMarket[];
  markets: readonly PreparedPredictionMarket[];
  partial: boolean;
  missingSources: readonly string[];
  observedAt: string;
}>;

export async function preparePredictionContext(input: {
  primaryMarketId: string;
  additionalMarketIds?: readonly string[];
  maxSelected: number;
  source: PredictionDataSource;
}): Promise<PreparedPredictionContext> {
  const selection = await validateMarketSelection({
    primaryMarketId: input.primaryMarketId,
    additionalMarketIds: input.additionalMarketIds,
    maxSelected: input.maxSelected,
    load: (id) => input.source.getMarket(id),
  });
  if (!selection.primaryMarket) throw new Error("The selected primary Polymarket market is unavailable or ineligible");

  const rejectedMarkets = [...selection.rejectedMarkets];
  const prepared: PreparedPredictionMarket[] = [];
  for (const market of [selection.primaryMarket, ...selection.additionalMarkets]) {
    const outcomes = [];
    const missingSources: string[] = [];
    let requiredBookFailed = false;
    for (const outcome of market.outcomes) {
      try {
        const orderBook = await input.source.getOrderBook(outcome.tokenId);
        let history: ProbabilityPoint[] = [];
        try { history = await input.source.getHistory(outcome.tokenId, "1w", 60); }
        catch { missingSources.push(`history:${outcome.tokenId}`); }
        outcomes.push(Object.freeze({
          name: outcome.name, tokenId: outcome.tokenId, orderBook, history,
          features: calculatePredictionFeatures({ market, outcomeTokenId: outcome.tokenId, orderBook, history }),
        }));
      } catch {
        requiredBookFailed = true;
        missingSources.push(`orderbook:${outcome.tokenId}`);
      }
    }
    if (requiredBookFailed || outcomes.length !== market.outcomes.length) {
      rejectedMarkets.push(Object.freeze({ id: market.id, reason: "required_orderbook_unavailable" }));
      if (market.id === selection.primaryMarket.id) throw new Error("Required order-book data for the primary market is unavailable");
      continue;
    }
    let openInterest: number | null = null;
    try { openInterest = await input.source.getOpenInterest(market.conditionId); }
    catch { missingSources.push(`open_interest:${market.conditionId}`); }
    prepared.push(Object.freeze({
      market, outcomes: Object.freeze(outcomes), openInterest,
      partial: missingSources.length > 0, missingSources: Object.freeze(missingSources),
    }));
  }
  const missingSources = prepared.flatMap((market) => market.missingSources);
  return Object.freeze({
    selectionMode: "user", primaryMarketId: input.primaryMarketId,
    requestedAdditionalMarketIds: Object.freeze([...(input.additionalMarketIds || [])]),
    usedMarketIds: Object.freeze(prepared.map((item) => item.market.id)),
    rejectedMarkets: Object.freeze(rejectedMarkets), markets: Object.freeze(prepared),
    partial: missingSources.length > 0 || rejectedMarkets.length > 0,
    missingSources: Object.freeze(missingSources), observedAt: new Date().toISOString(),
  });
}
