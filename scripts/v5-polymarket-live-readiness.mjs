import { PolymarketClient } from "../packages/market/dist/polymarket.js";

const events = [];
const client = new PolymarketClient({ cacheTtlMs: 5_000, maxRetries: 2, observer: (event) => events.push(event) });
const markets = await client.trending(20);
// Gamma marks markets restricted according to the probe's geography. Restricted
// markets must remain ineligible for paid analysis, but their public data is
// still useful for validating provider integration and identifier mapping.
const market = markets.find((item) => item.active && !item.closed && item.enableOrderBook && item.outcomes.length >= 2);
if (!market) throw new Error("No live order-book-enabled normalized Polymarket market was available");
const fresh = await client.getMarket(market.id);
const tokenId = fresh.outcomes[0]?.tokenId;
if (!tokenId) throw new Error("Selected market has no CLOB token ID");

const [bookResult, historyResult, openInterestResult] = await Promise.allSettled([
  client.getOrderBook(tokenId), client.getHistory(tokenId), client.getOpenInterest(fresh.conditionId),
]);
const providers = Object.fromEntries(["gamma", "clob", "data"].map((provider) => {
  const rows = events.filter((event) => event.provider === provider);
  return [provider, { calls: rows.length, successes: rows.filter((event) => event.success).length, retries: rows.reduce((sum, event) => sum + event.retries, 0), maxLatencyMs: Math.round(Math.max(0, ...rows.map((event) => event.durationMs))) }];
}));
const mappingStable = fresh.conditionId === market.conditionId
  && JSON.stringify(fresh.outcomes.map((item) => item.tokenId)) === JSON.stringify(market.outcomes.map((item) => item.tokenId));
const output = {
  observedAt: new Date().toISOString(),
  market: { id: fresh.id, gammaMarketId: fresh.gammaMarketId, eligibility: fresh.eligibility, outcomes: fresh.outcomes.length, mappingStable },
  clob: { orderBook: bookResult.status, history: historyResult.status, bidRows: bookResult.status === "fulfilled" ? bookResult.value.bids.length : null, askRows: bookResult.status === "fulfilled" ? bookResult.value.asks.length : null, historyPoints: historyResult.status === "fulfilled" ? historyResult.value.length : null },
  data: { openInterest: openInterestResult.status, valueAvailable: openInterestResult.status === "fulfilled" && openInterestResult.value !== null },
  providers,
};
console.log(JSON.stringify(output, null, 2));
if (!mappingStable || bookResult.status !== "fulfilled" || historyResult.status !== "fulfilled") process.exitCode = 1;
