import type { ClobOrderBook, NormalizedPolymarketMarket, ProbabilityPoint } from "@pulse/market";

export type Quality = "high" | "medium" | "low" | "unknown";
export type Direction = "rising" | "falling" | "flat" | "unknown";

export type PredictionFeatureInput = {
  market: NormalizedPolymarketMarket;
  outcomeTokenId: string;
  orderBook: ClobOrderBook;
  history: readonly ProbabilityPoint[];
  nowMs?: number;
};

export type PredictionFeatures = Readonly<{
  marketId: string;
  conditionId: string;
  outcomeTokenId: string;
  midpointProbability: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  lastTrade: number | null;
  probabilityChange: number | null;
  probabilityDirection: Direction;
  spreadQuality: Quality;
  depthQuality: Quality;
  liquidityQuality: Quality;
  bidDepthUsd: number;
  askDepthUsd: number;
  timeToResolutionHours: number | null;
  stale: boolean;
}>;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function top(levels: Array<{ price: string; size: string }>, side: "bid" | "ask"): number | null {
  const prices = levels.map((level) => finite(level.price)).filter((value): value is number => value !== null);
  if (!prices.length) return null;
  return side === "bid" ? Math.max(...prices) : Math.min(...prices);
}

function depth(levels: Array<{ price: string; size: string }>): number {
  return levels.reduce((sum, level) => {
    const price = finite(level.price) ?? 0;
    const size = finite(level.size) ?? 0;
    return sum + price * size;
  }, 0);
}

function spreadQuality(spread: number | null): Quality {
  if (spread === null) return "unknown";
  if (spread <= 0.02) return "high";
  if (spread <= 0.06) return "medium";
  return "low";
}

function depthQuality(total: number): Quality {
  if (total >= 25_000) return "high";
  if (total >= 2_500) return "medium";
  return total > 0 ? "low" : "unknown";
}

function liquidityQuality(value: number | null): Quality {
  if (value === null) return "unknown";
  if (value >= 100_000) return "high";
  if (value >= 10_000) return "medium";
  return "low";
}

export function calculatePredictionFeatures(input: PredictionFeatureInput): PredictionFeatures {
  const now = input.nowMs ?? Date.now();
  const bestBid = top(input.orderBook.bids, "bid");
  const bestAsk = top(input.orderBook.asks, "ask");
  const spread = bestBid !== null && bestAsk !== null ? Math.max(0, bestAsk - bestBid) : null;
  const midpointProbability = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const history = [...input.history].sort((a, b) => a.timestamp - b.timestamp);
  const probabilityChange = history.length >= 2
    ? history[history.length - 1].probability - history[0].probability
    : null;
  const probabilityDirection: Direction = probabilityChange === null
    ? "unknown"
    : probabilityChange > 0.01 ? "rising" : probabilityChange < -0.01 ? "falling" : "flat";
  const bidDepthUsd = depth(input.orderBook.bids);
  const askDepthUsd = depth(input.orderBook.asks);
  const endMs = input.market.endDate ? Date.parse(input.market.endDate) : Number.NaN;
  const timeToResolutionHours = Number.isFinite(endMs) ? Math.max(0, (endMs - now) / 3_600_000) : null;
  const bookTimestamp = Number(input.orderBook.timestamp);
  const bookMs = Number.isFinite(bookTimestamp)
    ? (bookTimestamp < 10_000_000_000 ? bookTimestamp * 1000 : bookTimestamp)
    : Number.NaN;

  return Object.freeze({
    marketId: input.market.id,
    conditionId: input.market.conditionId,
    outcomeTokenId: input.outcomeTokenId,
    midpointProbability,
    bestBid,
    bestAsk,
    spread,
    lastTrade: finite(input.orderBook.last_trade_price),
    probabilityChange,
    probabilityDirection,
    spreadQuality: spreadQuality(spread),
    depthQuality: depthQuality(bidDepthUsd + askDepthUsd),
    liquidityQuality: liquidityQuality(input.market.liquidityUsd),
    bidDepthUsd,
    askDepthUsd,
    timeToResolutionHours,
    stale: Number.isFinite(bookMs) ? now - bookMs > 120_000 : true,
  });
}

export type FusionFeatures = Readonly<{
  spotDirection: "bullish" | "bearish" | "neutral";
  predictionDirection: Direction;
  agreement: "agreement" | "divergence" | "neutral" | "incompatible";
  divergenceStrength: number;
  horizonCompatibility: "high" | "medium" | "low" | "unknown";
}>;

export function calculateFusionFeatures(input: {
  spotChangePct: number;
  spotTimeframeHours: number;
  prediction: PredictionFeatures;
}): FusionFeatures {
  const spotDirection = input.spotChangePct > 0.25 ? "bullish"
    : input.spotChangePct < -0.25 ? "bearish" : "neutral";
  const predictionDirection = input.prediction.probabilityDirection;
  const resolutionHours = input.prediction.timeToResolutionHours;
  const ratio = resolutionHours && input.spotTimeframeHours > 0
    ? resolutionHours / input.spotTimeframeHours : null;
  const horizonCompatibility = ratio === null ? "unknown"
    : ratio >= 0.5 && ratio <= 8 ? "high"
      : ratio >= 0.125 && ratio <= 24 ? "medium" : "low";
  const comparable = horizonCompatibility !== "low" && horizonCompatibility !== "unknown";
  const same = (spotDirection === "bullish" && predictionDirection === "rising")
    || (spotDirection === "bearish" && predictionDirection === "falling");
  const opposite = (spotDirection === "bullish" && predictionDirection === "falling")
    || (spotDirection === "bearish" && predictionDirection === "rising");
  const agreement = !comparable ? "incompatible" : same ? "agreement" : opposite ? "divergence" : "neutral";
  const spotStrength = Math.min(1, Math.abs(input.spotChangePct) / 5);
  const predictionStrength = Math.min(1, Math.abs(input.prediction.probabilityChange ?? 0) / 0.2);
  const qualityMultiplier = input.prediction.spreadQuality === "high" ? 1
    : input.prediction.spreadQuality === "medium" ? 0.75 : 0.4;
  const divergenceStrength = agreement === "divergence"
    ? Math.round(((spotStrength + predictionStrength) / 2) * qualityMultiplier * 100)
    : 0;
  return Object.freeze({ spotDirection, predictionDirection, agreement, divergenceStrength, horizonCompatibility });
}
