import { createPublicClient, http, parseAbi, type Address } from "viem";
import { buildMarketContext, type Candle } from "@pulse/market";

export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const ARC_OKX_MARKETS = [
  { pair: "BTC-USDT", address: "0x171a4217b86a807a64eb94757db6849fb4bdbaa0", symbol: "cirBTC", name: "Circle Wrapped Bitcoin", decimals: 8 },
  { pair: "ETH-USDT", address: "0x128cc466b61f542da60c70e3aa11c10e19b84edb", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
] as const;
export function assertArcOkxMarket(pair: string) {
  if (!ARC_OKX_MARKETS.some(market => market.pair === pair))
    throw new Error("Arc trading requires a reviewed token mapping with live OKX market data. Choose BTC (cirBTC) or ETH (WETH); indexed tokens are available in Risk Guard only.");
}
export const ARC_MARKET_FEED = "https://www.arcodex.fun/api/radar";
const ADDRESS = /^0x[\da-f]{40}$/i;
export const isArcMarket = (pair: string) => /^[A-Z0-9_]{1,16}\.[A-F0-9]{40}-USDC$/.test(pair);
export function arcMarketId(token: { symbol: string; address: string }) {
  if (!ADDRESS.test(token.address) || token.address.toLowerCase() === ARC_USDC) throw new Error("Invalid Arc target contract");
  const symbol = token.symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 16) || "TOKEN";
  return `${symbol}.${token.address.slice(2).toUpperCase()}-USDC`;
}
export type ArcIndexedToken = {
  address: string; symbol: string; name: string; decimals: number; logoUrl: string | null;
  priceUsd: number | null; change24h: number | null; liquidityUsd: number | null;
  marketCapUsd: number | null; holders: number | null; hasUsdc: boolean; lastSwap: number | null;
  provider: string; chainId: string;
};
const finite = (v: unknown): number | null => v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const positive = (v: unknown) => { const n = finite(v); return n !== null && n > 0 ? n : null; };
const safeImage = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === "https:" ? u.href : null; } catch { return null; } };
export function parseArcTokens(body: unknown): ArcIndexedToken[] {
  const rows = (body as { tokens?: unknown[] })?.tokens;
  if (!Array.isArray(rows)) throw new Error("Arc token catalog is unavailable");
  const seen = new Set<string>();
  return rows.slice(0, 5_000).flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>, address = String(r.address || "").toLowerCase();
    const decimals = Number(r.decimals);
    if (!ADDRESS.test(address) || /^0x0{40}$/.test(address) || /^0xe{40}$/.test(address) || seen.has(address)
      || !Number.isInteger(decimals) || decimals < 0 || decimals > 36
      || (r.chainId !== undefined && String(r.chainId) !== "5042")) return [];
    seen.add(address);
    return [{ address, symbol: String(r.symbol || "TOKEN").slice(0, 80), name: String(r.name || r.symbol || "Arc token").slice(0, 180), decimals,
      logoUrl: safeImage(r.icon), priceUsd: positive(r.price), change24h: finite(r.change24h), liquidityUsd: finite(r.liquidityUsdc),
      marketCapUsd: finite(r.mcap), holders: finite(r.holderCount), hasUsdc: r.hasUsdc === true,
      lastSwap: positive(r.lastSwap), provider: "RadarDex via Arcodex · indexed Arc mainnet", chainId: "5042" }];
  });
}
async function feed(path: string) {
  const response = await fetch(`${ARC_MARKET_FEED}${path}`, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error(`Arc market feed unavailable (${response.status})`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
    if (bytes > 8_000_000) throw new Error("Arc market feed response too large"); chunks.push(chunk.value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
let catalog: { until: number; tokens: ArcIndexedToken[] } | undefined;
let pending: Promise<ArcIndexedToken[]> | undefined;
const canonicalTokens = parseArcTokens({ tokens: [
  { address: ARC_USDC, symbol: "USDC", name: "USD Coin", decimals: 6 },
  { address: "0x128cc466b61f542da60c70e3aa11c10e19b84edb", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  { address: "0x171a4217b86a807a64eb94757db6849fb4bdbaa0", symbol: "cirBTC", name: "Circle Wrapped Bitcoin", decimals: 8 },
  { address: "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1", symbol: "EURC", name: "Euro Coin", decimals: 6 },
] }).map(t => ({ ...t, provider: "Arc official mainnet deployment" }));
export async function arcTokenCatalog() {
  if (catalog && catalog.until > Date.now()) return catalog.tokens;
  pending ||= feed("/tokens?sort=volume24&dir=desc&limit=5000&window=24h").then(body => {
    const indexed = parseArcTokens(body), addresses = new Set(canonicalTokens.map(t => t.address));
    const tokens = [...canonicalTokens, ...indexed.filter(t => !addresses.has(t.address))];
    catalog = { until: Date.now() + 60_000, tokens }; return tokens;
  }).finally(() => { pending = undefined; });
  return pending;
}
export function assertArcExecutionBinding(pair: string, target: string, settlement: string) {
  assertArcOkxMarket(pair);
  const address = ARC_OKX_MARKETS.find(market => market.pair === pair)!.address;
  if (!address || target.toLowerCase() !== address || settlement.toLowerCase() !== ARC_USDC)
    throw new Error("Arc OKX research mapping requires the exact published wrapper and canonical USDC");
}
export function arcOrderMarket(sell: { address: string; symbol: string }, buy: { address: string; symbol: string }) {
  const sellingSettlement = sell.address.toLowerCase() === ARC_USDC, buyingSettlement = buy.address.toLowerCase() === ARC_USDC;
  if (sellingSettlement === buyingSettlement) throw new Error("Arc contract orders require exactly one canonical USDC settlement token");
  const target = sellingSettlement ? buy : sell;
  const mapping = ARC_OKX_MARKETS.find(market => market.address === target.address.toLowerCase());
  if (!mapping || mapping.symbol !== target.symbol) throw new Error("Arc token has no reviewed OKX research mapping; use Risk Guard for indexed tokens");
  return { pair: mapping.pair, target: target.address, settlement: ARC_USDC, executionPair: `${mapping.symbol}-USDC` };
}
export function arcSwapMarket(from: string, to: string) {
  const token = (address: string) => ({ address, symbol: ARC_OKX_MARKETS.find(m => m.address === address.toLowerCase())?.symbol || "USDC" });
  return arcOrderMarket(token(from), token(to));
}
export async function verifyArcToken(token: { address: string; decimals: number; symbol: string }) {
  const abi = parseAbi(["function symbol() view returns(string)", "function decimals() view returns(uint8)"]);
  const urls = [...new Set([process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io", process.env.ARC_RPC_FALLBACK_URL || "https://rpc.quicknode.mainnet.arc.io"])];
  for (const url of urls) {
    const client = createPublicClient({ transport: http(url, { retryCount: 0, timeout: 8_000 }) });
    let chainId: number; try { chainId = await client.getChainId(); } catch { continue; }
    if (chainId !== 5042) throw new Error("Arc token RPC network mismatch");
    let symbol: string, decimals: number;
    try { [symbol, decimals] = await Promise.all([
      client.readContract({ address: token.address as Address, abi, functionName: "symbol" }),
      client.readContract({ address: token.address as Address, abi, functionName: "decimals" }),
    ]); } catch { continue; }
    if (symbol !== token.symbol || decimals !== token.decimals) throw new Error("Arc indexed token metadata does not match its contract");
    return;
  }
  throw new Error("Arc token contract evidence is unavailable; retry before trading");
}
const intervals: Record<string, number> = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1H": 3600, "2H": 7200, "4H": 14400, "6H": 21600, "12H": 43200, "1D": 86400, "1Dutc": 86400, "1W": 604800, "1Wutc": 604800 };
/** Arc follows the same OKX exchange-reference model as Base and Arbitrum. */
export async function arcOkxMarketContext(input: { instId: string; timeframe: string; candleLimit: number; completedOnly?: boolean }) {
  assertArcOkxMarket(input.instId);
  const market = await buildMarketContext(input);
  assertArcOkxMarketData(market, input.instId);
  if (input.completedOnly) assertArcAutomationHistory(market.candles, input.timeframe);
  return market;
}
export function assertArcOkxMarketData(market: {
  source?: string; instId: string; ticker: { instId: string; last: number; ts: string };
  candles: readonly Pick<Candle, "close">[];
}, instId: string, now = Date.now()) {
  assertArcOkxMarket(instId);
  const timestamp = Number(market.ticker.ts);
  if (market.source !== "okx-public-spot" || market.instId !== instId || market.ticker.instId !== instId
    || !Number.isFinite(market.ticker.last) || market.ticker.last <= 0 || !Number.isSafeInteger(timestamp)
    || now - timestamp > 180_000 || timestamp > now + 30_000
    || market.candles.length < 2 || market.candles.some(c => !Number.isFinite(c.close) || c.close <= 0))
    throw new Error("Live OKX market data is unavailable; no Arc trading can be prepared");
}
export function assertArcAutomationHistory(candles: Candle[], timeframe: string, now = Date.now()) {
  const interval = intervals[timeframe] * 1000, recent = candles.slice(-50);
  if (!interval || recent.length < 50 || recent.some(c => !c.confirmed)
    || recent.some((c,i) => i > 0 && c.ts - recent[i-1].ts !== interval)
    || recent.at(-1)!.ts + interval > now || now - (recent.at(-1)!.ts + interval) > interval)
    throw new Error("Arc Autopilot requires 50 recent, consecutive completed OKX candles for this market and timeframe");
}
