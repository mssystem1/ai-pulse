const OKX_REST = "https://www.okx.com";
import { ProviderCircuitBreaker, retryDelayMs } from "./resilience.js";

export * from "./polymarket.js";
export * from "./resilience.js";

export type SpotInstrument = {
  instId: string;
  baseCcy: string;
  quoteCcy: string;
  state: string;
  assetClass: GlobalAssetClass;
};

export type GlobalAssetClass = "crypto" | "tokenized_stock" | "tokenized_etf" | "rwa";

const TOKENIZED_ETF_TICKERS = new Set(["ARKK", "DIA", "GLD", "IBIT", "IWM", "QQQ", "SLV", "SPY", "TLT", "VOO"]);
const NON_EQUITY_RWA = new Set(["PAXG", "XAUT"]);
const CRYPTO_X_TICKERS = new Set(["XEC", "XEM", "XLM", "XMR", "XNO", "XRP", "XTZ"]);

/** Classify a live OKX instrument without implying an on-chain execution route. */
export function classifyGlobalInstrument(baseCcy: string): GlobalAssetClass {
  const symbol = baseCcy.trim().toUpperCase();
  if (NON_EQUITY_RWA.has(symbol)) return "rwa";
  if (!CRYPTO_X_TICKERS.has(symbol) && /^X[A-Z0-9]{1,10}$/.test(symbol)) {
    const underlying = symbol.slice(1);
    return TOKENIZED_ETF_TICKERS.has(underlying) ? "tokenized_etf" : "tokenized_stock";
  }
  return "crypto";
}

export type SpotTicker = {
  instId: string;
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  vol24h: number;
  volCcy24h: number;
  change24hPct: number;
  ts: string;
};

export type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeCcy: number;
};

export type SpotMarketContext = {
  source: "okx-public-spot";
  instId: string;
  bar: string;
  ticker: SpotTicker;
  candles: Candle[];
  summary: ReturnType<typeof summarizeCandles>;
  fetchedAt: string;
};

const okxCircuit = new ProviderCircuitBreaker("okx-public", 5, 30_000);
async function okxGet<T>(path: string): Promise<T> {
  return okxCircuit.run(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch(`${OKX_REST}${path}`, {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { code: string; msg: string; data: T };
        if (body.code !== "0") throw new Error(`OKX error ${body.code}: ${body.msg}`);
        return body.data;
      }
      lastError = new Error(`OKX HTTP ${res.status} ${path}`);
      if (attempt >= 2 || (res.status < 500 && res.status !== 429)) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, attempt)));
    }
    throw lastError;
  });
}

/** Map UI timeframe → OKX bar */
export function toOkxBar(tf: string): string {
  const m: Record<string, string> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1H": "1H",
    "1h": "1H",
    "4H": "4H",
    "4h": "4H",
    "1D": "1D",
    "1d": "1D",
    "1W": "1W",
    "1w": "1W",
  };
  return m[tf] ?? "1H";
}

export async function listSpotInstruments(limit = 200): Promise<SpotInstrument[]> {
  const data = await okxGet<
    Array<{ instId: string; baseCcy: string; quoteCcy: string; state: string }>
  >("/api/v5/public/instruments?instType=SPOT");
  return data
    .filter((i) => i.state === "live")
    .slice(0, limit)
    .map((i) => ({
      instId: i.instId,
      baseCcy: i.baseCcy,
      quoteCcy: i.quoteCcy,
      state: i.state,
      assetClass: classifyGlobalInstrument(i.baseCcy),
    }));
}

export async function searchSpotInstruments(q: string, limit = 30): Promise<SpotInstrument[]> {
  const query = q.trim().toUpperCase();
  const popular = [
    "BTC-USDT", "ETH-USDT", "OKB-USDT", "SOL-USDT", "XRP-USDT",
    "DOGE-USDT", "SUI-USDT", "PEPE-USDT", "ADA-USDT", "LINK-USDT",
  ];
  const data = await okxGet<
    Array<{ instId: string; baseCcy: string; quoteCcy: string; state: string }>
  >("/api/v5/public/instruments?instType=SPOT");
  return data
    .filter((i) => i.state === "live")
    .filter(
      (i) =>
        !query ||
        i.instId.includes(query) ||
        i.baseCcy.includes(query) ||
        i.quoteCcy.includes(query),
    )
    .sort((a, b) => {
      const aPopular = popular.indexOf(a.instId);
      const bPopular = popular.indexOf(b.instId);
      const aRank = aPopular === -1 ? Number.MAX_SAFE_INTEGER : aPopular;
      const bRank = bPopular === -1 ? Number.MAX_SAFE_INTEGER : bPopular;
      if (!query && aRank !== bRank) return aRank - bRank;
      const aExact = a.instId === query ? 1 : 0;
      const bExact = b.instId === query ? 1 : 0;
      const aStarts = a.instId.startsWith(query) ? 1 : 0;
      const bStarts = b.instId.startsWith(query) ? 1 : 0;
      return bExact - aExact || bStarts - aStarts || Number(b.quoteCcy === "USDT") - Number(a.quoteCcy === "USDT") || a.instId.localeCompare(b.instId);
    })
    .slice(0, limit)
    .map((i) => ({
      instId: i.instId,
      baseCcy: i.baseCcy,
      quoteCcy: i.quoteCcy,
      state: i.state,
      assetClass: classifyGlobalInstrument(i.baseCcy),
    }));
}

export async function getTicker(instId: string): Promise<SpotTicker> {
  const data = await okxGet<
    Array<{
      instId: string;
      last: string;
      open24h: string;
      high24h: string;
      low24h: string;
      vol24h: string;
      volCcy24h: string;
      ts: string;
    }>
  >(`/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`);
  const t = data[0];
  if (!t) throw new Error(`No ticker for ${instId}`);
  const last = Number(t.last);
  const open = Number(t.open24h);
  const change24hPct = open ? ((last - open) / open) * 100 : 0;
  return {
    instId: t.instId,
    last,
    open24h: open,
    high24h: Number(t.high24h),
    low24h: Number(t.low24h),
    vol24h: Number(t.vol24h),
    volCcy24h: Number(t.volCcy24h),
    change24hPct: Math.round(change24hPct * 100) / 100,
    ts: t.ts,
  };
}

/** OKX returns newest first: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] */
export async function getCandles(
  instId: string,
  bar = "1H",
  limit = 100,
): Promise<Candle[]> {
  const data = await okxGet<string[][]>(
    `/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${encodeURIComponent(bar)}&limit=${limit}`,
  );
  return data
    .map((row) => ({
      ts: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      volumeCcy: Number(row[6]),
    }))
    .reverse(); // chronological
}

export function summarizeCandles(candles: Candle[]) {
  if (!candles.length) return null;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const changePct =
    first.open !== 0 ? ((last.close - first.open) / first.open) * 100 : 0;
  return {
    count: candles.length,
    fromTs: first.ts,
    toTs: last.ts,
    open: first.open,
    close: last.close,
    rangeHigh,
    rangeLow,
    changePct: Math.round(changePct * 100) / 100,
    lastVolume: last.volume,
  };
}

export async function buildMarketContext(opts: {
  instId: string;
  timeframe?: string;
  candleLimit?: number;
}): Promise<SpotMarketContext> {
  const bar = toOkxBar(opts.timeframe ?? "1H");
  const [ticker, candles] = await Promise.all([
    getTicker(opts.instId),
    getCandles(opts.instId, bar, opts.candleLimit ?? 100),
  ]);
  return {
    source: "okx-public-spot",
    instId: opts.instId,
    bar,
    ticker,
    candles,
    summary: summarizeCandles(candles),
    fetchedAt: new Date().toISOString(),
  };
}
