export type MarketCandle = { ts: number; open: number; high: number; low: number; close: number; volume: number; volumeCcy?: number; confirmed?: boolean };
export type MarketTicker = { instId: string; last: number; change24hPct: number; high24h: number; low24h: number; volCcy24h: number; ts: string };
export type MarketPreviewData = { ticker: MarketTicker; candles: MarketCandle[]; fetchedAt: number };
export type TradeMarker = { id: string; side: "buy" | "sell"; price: number; ts: number; txHash: string };
export type ChartActivity = { id: string; source: string; kind: string; status: string; pair?: string; account?: string; txHash?: string; fillPrice?: number; fillSide?: "buy" | "sell"; fillObservedAt?: string; createdAt: string };

/** Only confirmed fills for this market and account; never funding or pending orders. */
export function confirmedTradeMarkers(activity: readonly ChartActivity[], pair: string, account?: string): TradeMarker[] {
  const seen = new Set<string>();
  return activity.flatMap(item => {
    if (item.status !== "confirmed" || item.pair !== pair || !item.txHash || !Number.isFinite(item.fillPrice) || item.fillPrice! <= 0) return [];
    if (account ? item.source !== "autopilot" || item.account?.toLowerCase() !== account.toLowerCase() : item.source === "autopilot") return [];
    const side = item.fillSide || (/^(market_buy|buy_filled|automatic_entry_protected)$/.test(item.kind) ? "buy"
      : /^(market_sell|sell_filled|sell_partial_filled|automatic_take_profit|automatic_stop_loss)$/.test(item.kind) ? "sell" : undefined);
    const ts = Date.parse(item.fillObservedAt || item.createdAt), id = `${item.txHash.toLowerCase()}:${side}`;
    if (!side || !Number.isFinite(ts) || seen.has(id)) return [];
    seen.add(id);
    return [{ id, side, price: item.fillPrice!, ts, txHash: item.txHash }];
  }).sort((a, b) => a.ts - b.ts);
}

export function visibleTradeMarkers(markers: readonly TradeMarker[], candles: readonly MarketCandle[]) {
  if (candles.length < 2) return [];
  const interval = candles.at(-1)!.ts - candles.at(-2)!.ts;
  return markers.filter(marker => marker.ts >= candles[0].ts && marker.ts < candles.at(-1)!.ts + interval);
}
type ReadResult = { ok: boolean; status: number; data: unknown };

export async function loadHistoricalCandles(read: (path: string) => Promise<ReadResult>, pair: string, timeframe: string, before: number): Promise<MarketCandle[]> {
  if (!Number.isSafeInteger(before) || before <= 0) throw new Error("Choose a valid history timestamp");
  const response = await read(`/v1/market/candles?instId=${encodeURIComponent(pair)}&bar=${encodeURIComponent(timeframe)}&limit=100&before=${before}`);
  if (!response.ok) throw new Error("Older market data is temporarily unavailable. Retry this range.");
  const raw = (response.data as { candles?: MarketCandle[] })?.candles;
  if (!Array.isArray(raw)) throw new Error("Historical market data was incomplete");
  const rows = raw.filter(c => [c.ts, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.ts < before && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close));
  if (raw.length && !rows.length) throw new Error("Historical market data did not contain valid older candles");
  return [...new Map(rows.map(c => [c.ts, c])).values()].sort((a, b) => a.ts - b.ts);
}

/** Shared by Global and Spot. Coalesces concurrent requests and bounds the cache. */
export function createMarketPreviewLoader(read: (path: string) => Promise<ReadResult>, now = Date.now) {
  const cache = new Map<string, { expires: number; request: Promise<MarketPreviewData> }>();
  return function load(pair: string, timeframe: string): Promise<MarketPreviewData> {
    const key = `${pair}:${timeframe}`;
    const existing = cache.get(key);
    if (existing && existing.expires > now()) return existing.request;
    if (cache.size >= 48) cache.delete(cache.keys().next().value!);
    const entry = { expires: Infinity, request: Promise.resolve(null as unknown as MarketPreviewData) };
    entry.request = Promise.all([
      read(`/v1/market/ticker?instId=${encodeURIComponent(pair)}`),
      read(`/v1/market/candles?instId=${encodeURIComponent(pair)}&bar=${encodeURIComponent(timeframe)}&limit=100`),
    ]).then(([tickerResponse, candleResponse]) => {
      if (!tickerResponse.ok || !candleResponse.ok) throw new Error("Market feed temporarily unavailable");
      const ticker = (tickerResponse.data as { ticker?: MarketTicker })?.ticker;
      const raw = (candleResponse.data as { candles?: MarketCandle[] })?.candles;
      if (!ticker || ticker.instId !== pair || !Number.isFinite(ticker.last) || ticker.last <= 0 || !Array.isArray(raw)) throw new Error("Market feed returned incomplete data");
      if (![ticker.change24hPct, ticker.high24h, ticker.low24h, ticker.volCcy24h, Number(ticker.ts)].every(Number.isFinite) || Number(ticker.ts) <= 0) throw new Error("Market feed returned incomplete statistics");
      const candles = raw.filter(c => [c.ts, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)).sort((a, b) => a.ts - b.ts);
      if (candles.length < 2) throw new Error("Market chart is not available yet");
      entry.expires = now() + 30_000;
      return { ticker, candles, fetchedAt: now() };
    }).catch(error => {
      // Brief negative cache prevents duplicate mounts/retry clicks from hammering a failed provider.
      entry.expires = now() + 5_000;
      throw error;
    });
    cache.set(key, entry);
    return entry.request;
  };
}

export function sparklinePoints(values: readonly number[], width = 240, height = 56): string {
  if (values.length < 2 || values.some(value => !Number.isFinite(value))) return "";
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  return values.map((value, i) => `${(i * width / (values.length - 1)).toFixed(2)},${(high === low ? height / 2 : 4 + (high - value) / span * (height - 8)).toFixed(2)}`).join(" ");
}
