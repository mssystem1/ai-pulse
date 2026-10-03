import type { AppConfig } from "@pulse/config";
import { buildMarketContext, classifyGlobalInstrument, getTicker, summarizeCandles, toOkxBar, type Candle, type SpotMarketContext } from "@pulse/market";
import { getOkxTradeTokens, okxDexGetMany, createOkxDexHeaders } from "./okxDex.js";
import { ROBINHOOD_USDG, NATIVE_ETH, ROBINHOOD_WETH } from "./robinhoodExecutionAssets.js";
import { robinhoodStockCatalog } from "./robinhoodAssetRegistry.js";
import { robinhoodIssuerPrice } from "./robinhoodIssuerPrice.js";

const candleCaches = new WeakMap<AppConfig, Map<string, { expiresAt: number; request: Promise<Candle[]> }>>();

export const isRobinhoodMarket = (pair: string) => /^[A-Z0-9_]{1,16}\.[A-F0-9]{16}-USDG$/.test(pair);
export function assertExecutionMarketIdentity(network: string, pair: string) {
  if (network === "robinhood" && !isRobinhoodMarket(pair))
    throw new Error("Choose a Robinhood asset from the market picker; execution requires its contract-specific USDG market, not a research ticker");
}
export function robinhoodMarketId(token: { address: string; symbol: string }) {
  if (!/^0x[\da-f]{40}$/i.test(token.address)) throw new Error("Invalid Robinhood token address");
  const symbol = token.symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 16) || "TOKEN";
  return `${symbol}.${token.address.slice(2, 18).toUpperCase()}-USDG`;
}
export function robinhoodOrderMarket(sell: { address: string; symbol: string }, buy: { address: string; symbol: string }) {
  const sellingSettlement = sell.address.toLowerCase() === ROBINHOOD_USDG;
  const buyingSettlement = buy.address.toLowerCase() === ROBINHOOD_USDG;
  if (sellingSettlement === buyingSettlement) throw new Error("Robinhood orders require exactly one canonical USDG settlement token");
  const target = sellingSettlement ? buy : sell;
  assertRobinhoodMarketBinding({ token: target }, target.address, ROBINHOOD_USDG);
  return { pair: robinhoodMarketId(target), target: target.address, settlement: ROBINHOOD_USDG, executionPair: `${target.symbol}-USDG` };
}
export async function robinhoodMarketCatalog(cfg: AppConfig, erc20Only = false) {
  const tokens = await getOkxTradeTokens(cfg, "4663", "", 5000);
  const stocks = await robinhoodStockCatalog().catch(() => []);
  const researchSymbols = new Map(stocks.map(stock => [stock.address.toLowerCase(), `X${stock.symbol.toUpperCase()}-USDT`]));
  researchSymbols.set(ROBINHOOD_WETH, "ETH-USDT");
  researchSymbols.set(NATIVE_ETH, "ETH-USDT");
  const candidates = tokens.filter(token => token.address.toLowerCase() !== ROBINHOOD_USDG && (!erc20Only || token.address.toLowerCase() !== NATIVE_ETH))
    .map(token => ({ pair: robinhoodMarketId(token), analysisBase: token.symbol,
      researchPairs: researchSymbols.has(token.address.toLowerCase()) ? [researchSymbols.get(token.address.toLowerCase())!] : [],
      assetClass: classifyGlobalInstrument(token.symbol, stocks.some(stock => stock.address.toLowerCase() === token.address.toLowerCase()) ? "3" : undefined),
      executionPair: `${token.symbol}/USDG`, token, routeStatus: "checked-automatically" }));
  const seen = new Set<string>();
  for (const item of candidates) {
    if (seen.has(item.pair)) throw new Error("Ambiguous Robinhood market identifier");
    seen.add(item.pair);
  }
  return candidates;
}
export async function resolveRobinhoodMarket(cfg: AppConfig, pair: string) {
  if (!isRobinhoodMarket(pair)) throw new Error("Invalid Robinhood market identifier");
  const matches = (await robinhoodMarketCatalog(cfg)).filter(item => item.pair === pair);
  if (matches.length !== 1) throw new Error("Robinhood asset is not in the current DEX catalog");
  return matches[0];
}

/** Symbols are presentation metadata, never authorization to trade a contract. */
export function assertRobinhoodMarketBinding(market: { token: { address: string } }, target: string, settlement: string) {
  if (settlement.toLowerCase() !== ROBINHOOD_USDG) throw new Error("Robinhood settlement must be canonical USDG");
  if (market.token.address.toLowerCase() === NATIVE_ETH) throw new Error("Automated Robinhood orders require an ERC-20 asset");
  if (market.token.address.toLowerCase() !== target.toLowerCase()) throw new Error("Robinhood market does not match the target contract");
}

export async function verifyRobinhoodMarketBinding(cfg: AppConfig, pair: string, target: string, settlement: string) {
  assertRobinhoodMarketBinding(await resolveRobinhoodMarket(cfg, pair), target, settlement);
}

export function assertRobinhoodAutomationHistory(candles: Candle[], timeframe: string, now = Date.now()) {
  const interval = ({ "15m": 900_000, "1H": 3_600_000, "4H": 14_400_000, "1D": 86_400_000 } as Record<string, number>)[timeframe];
  if (!interval) throw new Error("Unsupported Robinhood Autopilot timeframe");
  const history = candles.slice(-50);
  if (history.length < 50 || history.some(candle => candle.confirmed !== true)) throw new Error("Robinhood Autopilot requires at least 50 completed candles before setup");
  if (candles.some(candle => ![candle.ts, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.volumeCcy].every(Number.isFinite)
    || !Number.isSafeInteger(candle.ts) || candle.ts <= 0 || candle.low <= 0 || candle.high < Math.max(candle.open, candle.close)
    || candle.low > Math.min(candle.open, candle.close) || candle.volume < 0 || candle.volumeCcy < 0))
    throw new Error("Robinhood Autopilot signal history contains invalid values");
  if (history.some((candle, index) => index > 0 && candle.ts - history[index - 1].ts !== interval)) throw new Error("Robinhood Autopilot price history has gaps; retry when coverage is available");
  const last = history.at(-1)!;
  if (last.ts + interval > now || now - (last.ts + interval) > interval) throw new Error("Robinhood Autopilot completed price history is stale or invalid");
}

export function parseRobinhoodCandles(rows: unknown[], before?: number): Candle[] {
  const candles = rows.map(row => {
    if (!Array.isArray(row) || row.length < 8) throw new Error("Incomplete on-chain candle");
    if (row.slice(0, 7).some(value => (typeof value !== "string" && typeof value !== "number") || String(value).trim() === "")
      || !["0", "1"].includes(String(row[7]))) throw new Error("Invalid on-chain candle fields");
    const [ts, open, high, low, close, volume, volumeCcy] = row.slice(0, 7).map(Number);
    if (![ts, open, high, low, close, volume, volumeCcy].every(Number.isFinite) || !Number.isSafeInteger(ts) || ts <= 0 || low <= 0
      || high < Math.max(open, close) || low > Math.min(open, close) || volume < 0 || volumeCcy < 0) throw new Error("Invalid on-chain candle");
    return { ts, open, high, low, close, volume, volumeCcy, confirmed: String(row[7]) === "1" };
  }).filter(candle => before === undefined || candle.ts < before);
  const unique = new Map<number, Candle>();
  for (const candle of candles) {
    const previous = unique.get(candle.ts);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candle)) throw new Error("Conflicting on-chain candles");
    unique.set(candle.ts, candle);
  }
  return [...unique.values()].sort((a, b) => a.ts - b.ts);
}
export async function robinhoodCandles(cfg: AppConfig, pair: string, timeframe: string, limit = 100, before?: number) {
  const market = await resolveRobinhoodMarket(cfg, pair);
  const token = market.token.address.toLowerCase() === NATIVE_ETH ? ROBINHOOD_WETH : market.token.address.toLowerCase();
  return robinhoodTokenCandles(cfg, token, timeframe, limit, before);
}
async function robinhoodTokenCandles(cfg: AppConfig, token: string, timeframe: string, limit: number, before?: number) {
  let cache = candleCaches.get(cfg);
  if (!cache) { cache = new Map(); candleCaches.set(cfg, cache); }
  const key = JSON.stringify([token, toOkxBar(timeframe), limit, before]);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.request;
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  const entry = { expiresAt: Infinity, request: Promise.resolve([] as Candle[]) };
  entry.request = okxDexGetMany(cfg, before === undefined ? "/api/v6/dex/market/candles" : "/api/v6/dex/market/historical-candles", {
    chainIndex: "4663", tokenContractAddress: token, bar: toOkxBar(timeframe), limit: String(Math.min(299, Math.max(1, limit))),
    ...(before === undefined ? {} : { after: String(before) }),
  }).then(raw => {
    const candles = parseRobinhoodCandles(raw, before);
    entry.expiresAt = Date.now() + (before === undefined ? 10_000 : 60_000);
    return candles;
  }).catch(error => { if (cache!.get(key) === entry) cache!.delete(key); throw error; });
  cache.set(key, entry);
  return entry.request;
}

/** Approximate rolling-day statistics require all 24 hourly buckets, not two rows. */
export function robinhoodDayWindow(candles: Candle[], now = Date.now()) {
  const hour = 3_600_000, current = Math.floor(now / hour) * hour;
  const window = candles.filter(candle => candle.ts >= current - 23 * hour && candle.ts <= current);
  if (window.length !== 24 || window.some((candle, index) => candle.ts !== current - (23 - index) * hour))
    throw new Error("Robinhood 24-hour market statistics are incomplete");
  return window;
}

/** Convert simultaneous USD marks, never assume a stablecoin is exactly $1. */
export function robinhoodSettlementMark(asset: Pick<Candle, "ts" | "close">, settlement: Pick<Candle, "ts" | "close">, now = Date.now()) {
  for (const mark of [asset, settlement]) {
    if (!Number.isFinite(mark.close) || mark.close <= 0 || !Number.isSafeInteger(mark.ts)
      || now - mark.ts > 180_000 || mark.ts > now + 30_000) throw new Error("Robinhood settlement mark is stale or invalid");
  }
  if (Math.abs(asset.ts - settlement.ts) > 30_000) throw new Error("Robinhood asset and USDG marks are not synchronized");
  const value = asset.close / settlement.close;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid Robinhood settlement price");
  return value;
}

export async function executionSettlementTicker(cfg: AppConfig, pair: string) {
  if (!isRobinhoodMarket(pair)) return getTicker(pair);
  const market = await resolveRobinhoodMarket(cfg, pair);
  const [latestAsset, latestSettlement] = await robinhoodLiveMarks(cfg, [market.token.address, ROBINHOOD_USDG]);
  return { instId: pair, last: robinhoodSettlementMark(latestAsset, latestSettlement), priceCurrency: "USDG" as const,
    usdPerSettlement: latestSettlement.close, ts: String(latestAsset.ts), priceSource: latestAsset.source };
}
/** Last-trade candles are history, not a live quote clock on quiet markets. */
export async function robinhoodLiveMarks(cfg: AppConfig, addresses: string[]): Promise<Array<{ ts: number; close: number; source: string }>> {
  const tokens = addresses.map(address => address.toLowerCase() === NATIVE_ETH ? ROBINHOOD_WETH : address.toLowerCase());
  const stocks = tokens.some(token => token !== ROBINHOOD_WETH && token !== ROBINHOOD_USDG) ? await robinhoodStockCatalog() : [];
  if (tokens.some(token => stocks.filter(stock => stock.address === token).length > 1)) throw new Error("Robinhood issuer registry contract identity is ambiguous");
  const issuer = new Map(stocks.map(stock => [stock.address, stock]));
  const dexTokens = tokens.filter(token => !issuer.has(token));
  const dex = dexTokens.length ? await robinhoodDexLiveMarks(cfg, dexTokens) : [];
  return Promise.all(tokens.map(token => issuer.has(token) ? robinhoodIssuerPrice(issuer.get(token)!)
    : Promise.resolve({ ...dex[dexTokens.indexOf(token)], source: "okx-token-market" })));
}
async function robinhoodDexLiveMarks(cfg: AppConfig, addresses: string[]) {
  if (!cfg.hasOkxCredentials) throw new Error("OKX DEX credentials are not configured");
  const tokens = addresses.map(address => address.toLowerCase() === NATIVE_ETH ? ROBINHOOD_WETH : address.toLowerCase());
  const path = "/api/v6/dex/market/price";
  const body = JSON.stringify([...new Set(tokens)].map(tokenContractAddress => ({ chainIndex: "4663", tokenContractAddress })));
  const response = await fetch(`${cfg.OKX_BASE_URL.replace(/\/$/, "")}${path}`, {
    method: "POST", headers: { ...createOkxDexHeaders(cfg, new Date().toISOString(), "POST", path, body), "Content-Type": "application/json" },
    body, signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json() as { code?: string; data?: Array<{ chainIndex: string; tokenContractAddress: string; time: string; price: string }> };
  if (!response.ok || result.code !== "0" || !Array.isArray(result.data)) throw new Error("Robinhood live price provider is unavailable; retry before signing");
  return tokens.map(token => {
    const matches = result.data!.filter(row => row.chainIndex === "4663" && row.tokenContractAddress?.toLowerCase() === token);
    if (matches.length !== 1) throw new Error("Robinhood live price identity is missing or ambiguous");
    const mark = { ts: Number(matches[0].time), close: Number(matches[0].price) };
    // Validate the provider timestamp, never replace it with the request time.
    robinhoodSettlementMark(mark, mark);
    return mark;
  });
}
export async function robinhoodMarketContext(cfg: AppConfig, input: { instId: string; timeframe: string; candleLimit: number; completedOnly?: boolean }): Promise<SpotMarketContext> {
  const market = await resolveRobinhoodMarket(cfg, input.instId);
  const [rawCandles, marks] = await Promise.all([robinhoodCandles(cfg, input.instId, input.timeframe, input.candleLimit), robinhoodLiveMarks(cfg, [market.token.address])]);
  const candles = input.completedOnly ? rawCandles.filter(candle => candle.confirmed === true) : rawCandles;
  const latest = marks[0];
  if (!latest || Date.now() - latest.ts > 180_000 || latest.ts > Date.now() + 30_000) throw new Error("Robinhood live mark is stale or unavailable");
  if (candles.length < 2) throw new Error("Robinhood price history is not yet available");
  // These are per-token DEX prices, not underlying-equity quotes. Do not apply
  // a corporate-action multiplier a second time.
  const day = await robinhoodCandles(cfg, input.instId, "1H", 25);
  const window = robinhoodDayWindow(day);
  const open24h = window[0].open;
  return { source: "okx-robinhood-dex", instId: input.instId, bar: toOkxBar(input.timeframe), candles,
    ticker: { priceCurrency: "USD", statisticsApproximate: true, instId: input.instId, last: latest.close, open24h, high24h: Math.max(...window.map(c => c.high)), low24h: Math.min(...window.map(c => c.low)),
      vol24h: window.reduce((sum, c) => sum + c.volume, 0), volCcy24h: window.reduce((sum, c) => sum + c.volumeCcy, 0), change24hPct: (latest.close / open24h - 1) * 100, ts: String(latest.ts) },
    summary: summarizeCandles(candles), fetchedAt: new Date().toISOString() };
}
export const executionMarketContext = (cfg: AppConfig, input: { instId: string; timeframe: string; candleLimit: number; completedOnly?: boolean }) =>
  isRobinhoodMarket(input.instId) ? robinhoodMarketContext(cfg, input) : buildMarketContext(input);
export const executionTicker = async (cfg: AppConfig, pair: string) => isRobinhoodMarket(pair)
  ? (await robinhoodMarketContext(cfg, { instId: pair, timeframe: "1H", candleLimit: 25 })).ticker : getTicker(pair);

/** Reference candles are signals, never prices or liquidity for the traded token. */
export async function robinhoodAutopilotContext(cfg: AppConfig, input: { instId: string; timeframe: string; signalMarket?: string }) {
  const binding = await resolveRobinhoodMarket(cfg, input.instId);
  const allowed = [input.instId, ...binding.researchPairs];
  if (input.signalMarket && !allowed.includes(input.signalMarket)) throw new Error("Signed signal market is not verified for this Robinhood contract");
  const candidates = input.signalMarket ? [input.signalMarket] : allowed;
  let lastError: unknown;
  const nativeContext = async () => {
    const [raw, marks] = await Promise.all([
      robinhoodTokenCandles(cfg, binding.token.address, input.timeframe, 120),
      robinhoodDexLiveMarks(cfg, [binding.token.address]),
    ]);
    const candles = raw.filter(candle => candle.confirmed === true);
    // Display-only 24h statistics must not prevent a strategy with valid
    // completed timeframe history. Missing statistics are omitted, never zeroed.
    return { source: "okx-robinhood-dex" as const, instId: input.instId, bar: toOkxBar(input.timeframe), candles,
      ticker: { instId: input.instId, last: marks[0].close, ts: String(marks[0].ts), priceCurrency: "USD" as const },
      summary: summarizeCandles(candles), fetchedAt: new Date().toISOString() };
  };
  for (const signalMarket of candidates) {
    try {
      const market = signalMarket === input.instId
        ? await nativeContext()
        : await buildMarketContext({ instId: signalMarket, timeframe: input.timeframe, candleLimit: 120, completedOnly: true });
      assertRobinhoodAutomationHistory(market.candles, input.timeframe);
      if (market.ticker.instId !== signalMarket) throw new Error("Signal ticker identity does not match the signed market");
      const settlementTicker = await executionSettlementTicker(cfg, input.instId);
      const ts = Number(market.ticker.ts);
      if (!Number.isSafeInteger(ts) || Date.now() - ts > 180_000 || ts > Date.now() + 30_000 || Math.abs(ts - Number(settlementTicker.ts)) > 30_000)
        throw new Error("Signal and Robinhood execution prices are not fresh and synchronized");
      if (!Number.isFinite(market.ticker.last) || market.ticker.last <= 0) throw new Error("Signal reference price is invalid");
      return { market, signalMarket, signalSource: signalMarket === input.instId ? "token-dex" as const : "verified-reference" as const,
        settlementTicker, analysisToSettlement: settlementTicker.last / market.ticker.last };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("No verified signal history is available for this token");
}
