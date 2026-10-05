import { createPublicClient, http, parseAbi, type Address } from "viem";
import { summarizeCandles, toOkxBar, type Candle, type SpotMarketContext } from "@pulse/market";

export const ARC_USDC = "0x3600000000000000000000000000000000000000";
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
export async function arcMarketCatalog() {
  return (await arcTokenCatalog()).filter(t => t.address !== ARC_USDC).map(token => ({
    pair: arcMarketId(token), analysisBase: token.symbol, researchPairs: [] as string[], assetClass: "crypto" as const,
    executionPair: `${token.symbol}/USDC`, token, routeStatus: "checked-automatically" as const,
  }));
}
export async function resolveArcMarket(pair: string) {
  if (!isArcMarket(pair)) throw new Error("Choose an Arc asset by its contract address");
  const address = `0x${pair.split(".")[1].slice(0, 40).toLowerCase()}`;
  const token = (await arcTokenCatalog()).find(t => t.address === address);
  if (!token || arcMarketId(token) !== pair) throw new Error("Arc asset is not in the current contract catalog");
  return { token, pair, executionPair: `${token.symbol}/USDC` };
}
export function assertArcMarketBinding(pair: string, target: string, settlement: string) {
  if (!isArcMarket(pair) || `0x${pair.split(".")[1].slice(0, 40)}`.toLowerCase() !== target.toLowerCase()
    || settlement.toLowerCase() !== ARC_USDC) throw new Error("Arc market must match the exact target contract and canonical USDC");
}
export function assertArcExecutionBinding(pair: string, target: string, settlement: string) {
  if (isArcMarket(pair)) return assertArcMarketBinding(pair, target, settlement);
  const address = pair === "ETH-USDT" ? "0x128cc466b61f542da60c70e3aa11c10e19b84edb"
    : pair === "BTC-USDT" ? "0x171a4217b86a807a64eb94757db6849fb4bdbaa0" : undefined;
  if (!address || target.toLowerCase() !== address || settlement.toLowerCase() !== ARC_USDC)
    throw new Error("Arc research mapping requires the canonical Arc wrapper and USDC; choose other assets by contract");
}
export function arcOrderMarket(sell: { address: string; symbol: string }, buy: { address: string; symbol: string }) {
  const sellingSettlement = sell.address.toLowerCase() === ARC_USDC, buyingSettlement = buy.address.toLowerCase() === ARC_USDC;
  if (sellingSettlement === buyingSettlement) throw new Error("Arc contract orders require exactly one canonical USDC settlement token");
  const target = sellingSettlement ? buy : sell;
  return { pair: arcMarketId(target), target: target.address, settlement: ARC_USDC, executionPair: `${target.symbol}-USDC` };
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
export function parseArcCandles(body: unknown, interval: number, now = Date.now(), before?: number): Candle[] {
  const rows = (body as { candles?: unknown[] })?.candles;
  if (!Array.isArray(rows) || (body as { tf?: number }).tf !== interval) throw new Error("Arc price history timeframe is unavailable");
  const unique = new Map<number, Candle>();
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (!r || [r.time, r.open, r.high, r.low, r.close, r.vol].some(v => finite(v) === null)) throw new Error("Invalid Arc candle");
    const [time, open, high, low, close, volumeCcy] = [r.time, r.open, r.high, r.low, r.close, r.vol].map(Number), ts = time * 1000;
    if (!Number.isSafeInteger(ts) || ts <= 0 || time % interval !== 0 || ts > now || low <= 0 || high < Math.max(open, close)
      || low > Math.min(open, close) || volumeCcy < 0) throw new Error("Invalid Arc candle");
    if (before !== undefined && ts >= before) continue;
    // RadarDex reports quote-token volume. Preserve it separately from the
    // estimated base quantity instead of relabelling quote volume as tokens.
    const candle = { ts, open, high, low, close, volume: volumeCcy / close, volumeCcy, confirmed: ts + interval * 1000 <= now };
    if (unique.has(ts) && JSON.stringify(unique.get(ts)) !== JSON.stringify(candle)) throw new Error("Conflicting Arc candles");
    unique.set(ts, candle);
  }
  return [...unique.values()].sort((a, b) => a.ts - b.ts);
}
export async function arcCandles(pair: string, timeframe: string, limit = 120, before?: number) {
  const { token } = await resolveArcMarket(pair), interval = intervals[timeframe];
  if (!interval) throw new Error("Unsupported Arc market timeframe");
  const body = await feed(`/token/${token.address}/chart?tf=${interval}&limit=${Math.min(Math.max(limit, 1), 300)}${before === undefined ? "" : `&before=${Math.floor(before / 1000)}`}`);
  return parseArcCandles(body, interval, Date.now(), before).slice(-limit);
}
export async function arcMarketContext(input: { instId: string; timeframe: string; candleLimit: number; completedOnly?: boolean }): Promise<SpotMarketContext> {
  const { token } = await resolveArcMarket(input.instId);
  const [raw, detail] = await Promise.all([arcCandles(input.instId, input.timeframe, input.candleLimit), feed(`/token/${token.address}`)]);
  if (String(detail.address).toLowerCase() !== token.address || Number(detail.decimals) !== token.decimals
    || String(detail.quoteToken).toLowerCase() !== ARC_USDC || positive(detail.price) === null) throw new Error("Arc market price identity is unavailable");
  const ts = Number(detail.lastSwap ?? 0) * 1000;
  // The detail endpoint omits lastSwap on some deployments: the indexed
  // catalog supplies the last observed swap, never the HTTP request time.
  const priceTs = ts || (token.lastSwap || 0) * 1000;
  if (!Number.isSafeInteger(priceTs) || Date.now() - priceTs > 180_000 || priceTs > Date.now() + 30_000) throw new Error("Arc last-trade mark is stale; no live market price is available");
  const candles = input.completedOnly ? raw.filter(c => c.confirmed) : raw;
  if (candles.length < 2) throw new Error("Arc price history is not yet available");
  const price = Number(detail.price), change = finite(detail.change24h);
  const day = await arcCandles(input.instId, "1H", 25), recent = day.filter(c => c.ts >= Date.now() - 24 * 3600_000);
  const open24h = change !== null && change > -100 ? price / (1 + change / 100) : recent[0]?.open;
  if (!open24h) throw new Error("Arc 24-hour market evidence is unavailable");
  return { source: "arc-indexed-dex", instId: input.instId, bar: toOkxBar(input.timeframe), candles,
    ticker: { instId: input.instId, priceCurrency: "USDC", statisticsApproximate: true, last: price, open24h,
      high24h: Math.max(price, ...recent.map(c => c.high)), low24h: Math.min(price, ...recent.map(c => c.low)),
      vol24h: recent.reduce((sum,c) => sum + c.volume, 0), volCcy24h: Number(detail.volume24) || recent.reduce((sum,c) => sum+c.volumeCcy,0),
      change24hPct: (price / open24h - 1) * 100, ts: String(priceTs) }, summary: summarizeCandles(candles), fetchedAt: new Date().toISOString() };
}
export function assertArcAutomationHistory(candles: Candle[], timeframe: string, now = Date.now()) {
  const interval = intervals[timeframe] * 1000, recent = candles.slice(-50);
  if (!interval || recent.length < 50 || recent.some(c => !c.confirmed)
    || recent.some((c,i) => i > 0 && c.ts - recent[i-1].ts !== interval)
    || recent.at(-1)!.ts + interval > now || now - (recent.at(-1)!.ts + interval) > interval)
    throw new Error("Arc Autopilot requires 50 recent, consecutive completed candles for this contract and timeframe");
}
