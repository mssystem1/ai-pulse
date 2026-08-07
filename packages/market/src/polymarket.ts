export type PolymarketSourceStatus = "available" | "partial" | "unavailable";

export type PolymarketOutcome = Readonly<{
  name: string;
  tokenId: string;
  referencePrice: number | null;
}>;

export type NormalizedPolymarketMarket = Readonly<{
  id: `pm:${string}`;
  gammaMarketId: string;
  eventIds: readonly string[];
  conditionId: string;
  questionId: string | null;
  slug: string | null;
  question: string;
  description: string | null;
  resolutionSource: string | null;
  outcomes: readonly PolymarketOutcome[];
  active: boolean;
  closed: boolean;
  archived: boolean;
  restricted: boolean;
  enableOrderBook: boolean;
  negRisk: boolean;
  endDate: string | null;
  updatedAt: string | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  eligibility: "active" | "closed" | "resolved" | "archived" | "restricted" | "unavailable";
  observedAt: string;
}>;

export type GammaMarket = Record<string, unknown> & {
  id?: string | number;
  conditionId?: string;
  questionID?: string;
  slug?: string;
  question?: string;
  description?: string;
  resolutionSource?: string;
  outcomes?: string | string[];
  clobTokenIds?: string | string[];
  outcomePrices?: string | Array<string | number>;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  restricted?: boolean;
  enableOrderBook?: boolean;
  negRisk?: boolean;
  endDateIso?: string;
  endDate?: string;
  updatedAt?: string;
  volumeNum?: number;
  liquidityNum?: number;
  events?: Array<{ id?: string | number }>;
  umaResolutionStatus?: string;
};

export type GammaEvent = Record<string, unknown> & {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  restricted?: boolean;
  startDate?: string;
  endDate?: string;
  markets?: GammaMarket[];
};

export type ClobOrderBook = {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
  last_trade_price?: string;
};

export type ProbabilityPoint = Readonly<{ timestamp: number; probability: number }>;

function stringArray(value: unknown, field: string): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      if (value.trim()) return value.split(",").map((item) => item.trim());
    }
  }
  throw new Error(`Polymarket ${field} is not an array`);
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eligibility(raw: GammaMarket): NormalizedPolymarketMarket["eligibility"] {
  const resolution = String(raw.umaResolutionStatus || "").toLowerCase();
  if (resolution.includes("resolved")) return "resolved";
  if (raw.archived) return "archived";
  if (raw.restricted) return "restricted";
  if (raw.closed) return "closed";
  if (raw.active && raw.enableOrderBook) return "active";
  return "unavailable";
}

export function normalizeGammaMarket(
  raw: GammaMarket,
  observedAt = new Date().toISOString(),
): NormalizedPolymarketMarket {
  const conditionId = String(raw.conditionId || "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(conditionId)) {
    throw new Error("Polymarket market has no valid conditionId");
  }
  const names = stringArray(raw.outcomes, "outcomes");
  const tokenIds = stringArray(raw.clobTokenIds, "clobTokenIds");
  const prices = raw.outcomePrices === undefined ? [] : stringArray(raw.outcomePrices, "outcomePrices");
  if (names.length < 2 || names.length !== tokenIds.length) {
    throw new Error("Polymarket outcome/token mapping is inconsistent");
  }
  if (new Set(tokenIds).size !== tokenIds.length || tokenIds.some((token) => !/^\d+$/.test(token))) {
    throw new Error("Polymarket CLOB token IDs are invalid or duplicated");
  }
  const question = String(raw.question || "").trim();
  if (!question) throw new Error("Polymarket market has no question");

  return Object.freeze({
    id: `pm:${conditionId}`,
    gammaMarketId: String(raw.id ?? ""),
    eventIds: Object.freeze((raw.events || []).map((event) => String(event.id ?? "")).filter(Boolean)),
    conditionId,
    questionId: raw.questionID ? String(raw.questionID) : null,
    slug: raw.slug ? String(raw.slug) : null,
    question,
    description: raw.description ? String(raw.description) : null,
    resolutionSource: raw.resolutionSource ? String(raw.resolutionSource) : null,
    outcomes: Object.freeze(names.map((name, index) => Object.freeze({
      name,
      tokenId: tokenIds[index],
      referencePrice: optionalNumber(prices[index]),
    }))),
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    archived: Boolean(raw.archived),
    restricted: Boolean(raw.restricted),
    enableOrderBook: Boolean(raw.enableOrderBook),
    negRisk: Boolean(raw.negRisk),
    endDate: raw.endDateIso ? String(raw.endDateIso) : raw.endDate ? String(raw.endDate) : null,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    volumeUsd: optionalNumber(raw.volumeNum),
    liquidityUsd: optionalNumber(raw.liquidityNum),
    eligibility: eligibility(raw),
    observedAt,
  });
}

export function assertMarketMapping(
  expected: NormalizedPolymarketMarket,
  fresh: NormalizedPolymarketMarket,
): void {
  if (expected.conditionId.toLowerCase() !== fresh.conditionId.toLowerCase()) {
    throw new Error("Polymarket condition changed");
  }
  const expectedMapping = expected.outcomes.map((item) => `${item.name}\0${item.tokenId}`);
  const freshMapping = fresh.outcomes.map((item) => `${item.name}\0${item.tokenId}`);
  if (JSON.stringify(expectedMapping) !== JSON.stringify(freshMapping)) {
    throw new Error("Polymarket outcome/token mapping changed");
  }
  if (fresh.eligibility !== "active") {
    throw new Error(`Polymarket market is no longer active: ${fresh.eligibility}`);
  }
}

type ClientOptions = {
  gammaUrl?: string;
  clobUrl?: string;
  dataUrl?: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  maxRetries?: number;
  observer?: (event: { provider: "gamma" | "clob" | "data"; operation: string; durationMs: number; success: boolean; retries: number; cacheHit: boolean; cacheAgeMs: number }) => void;
};

const CRYPTO_ASSET = /\b(bitcoin|btc|ethereum|ether|eth|solana|sol|xrp|dogecoin|doge|bnb|sui|cardano|ada|avalanche|avax|chainlink|link|crypto)\b/i;
const TRADING_PREDICATE = /\b(up\s+or\s+down|above|below|higher|lower|price|reach|hit|close|trade|worth|all[- ]time high|ath|market cap)\b/i;

/** Keep prediction discovery focused on questions a crypto trader can analyze. */
export function isCryptoTradingPrediction(question: string): boolean {
  return CRYPTO_ASSET.test(question) && TRADING_PREDICATE.test(question);
}

export class PolymarketClient {
  private gammaUrl: string;
  private clobUrl: string;
  private dataUrl: string;
  private fetchImpl: typeof fetch;
  private cache = new Map<string, { expiresAt: number; createdAt: number; value: unknown }>();
  private cacheTtlMs: number;
  private maxRetries: number;
  private observer?: ClientOptions["observer"];
  private circuits = new Map<string, ProviderCircuitBreaker>();

  constructor(options: ClientOptions = {}) {
    this.gammaUrl = (options.gammaUrl || "https://gamma-api.polymarket.com").replace(/\/$/, "");
    this.clobUrl = (options.clobUrl || "https://clob.polymarket.com").replace(/\/$/, "");
    this.dataUrl = (options.dataUrl || "https://data-api.polymarket.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl || fetch;
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 5_000);
    this.maxRetries = Math.min(Math.max(options.maxRetries ?? 2, 0), 4);
    this.observer = options.observer;
  }

  private async json<T>(url: string): Promise<T> {
    const started = performance.now();
    const parsedUrl = new URL(url);
    const provider = parsedUrl.origin === new URL(this.gammaUrl).origin ? "gamma" : parsedUrl.origin === new URL(this.clobUrl).origin ? "clob" : "data";
    const operation = parsedUrl.pathname.replace(/[^a-zA-Z0-9/_-]/g, "_");
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      this.observer?.({ provider, operation, durationMs: performance.now() - started, success: true, retries: 0, cacheHit: true, cacheAgeMs: Date.now() - cached.createdAt });
      return cached.value as T;
    }
    const circuit = this.circuits.get(provider) || new ProviderCircuitBreaker(`polymarket-${provider}`, 5, 30_000);
    this.circuits.set(provider, circuit);
    return circuit.run(async () => {
    let last: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429) throw new Error(`Polymarket HTTP ${response.status}: ${new URL(url).pathname}`);
          throw Object.assign(new Error(`Polymarket retriable HTTP ${response.status}: ${new URL(url).pathname}`), { retryDelayMs: retryDelayMs(response, attempt) });
        }
        const value = await response.json() as T;
        const createdAt = Date.now();
        if (this.cacheTtlMs > 0) this.cache.set(url, { expiresAt: createdAt + this.cacheTtlMs, createdAt, value });
        this.observer?.({ provider, operation, durationMs: performance.now() - started, success: true, retries: attempt, cacheHit: false, cacheAgeMs: 0 });
        return value;
      } catch (error) {
        last = error;
        if (attempt < this.maxRetries) {
          const delay = Number((error as { retryDelayMs?: unknown })?.retryDelayMs) || 150 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    this.observer?.({ provider, operation, durationMs: performance.now() - started, success: false, retries: this.maxRetries, cacheHit: false, cacheAgeMs: 0 });
    throw last;
    });
  }

  async listMarkets(params: { limit?: number; offset?: number; active?: boolean; closed?: boolean } = {}) {
    const query = new URLSearchParams({
      limit: String(Math.min(Math.max(params.limit ?? 50, 1), 100)),
      offset: String(Math.max(params.offset ?? 0, 0)),
    });
    if (params.active !== undefined) query.set("active", String(params.active));
    if (params.closed !== undefined) query.set("closed", String(params.closed));
    const rows = await this.json<GammaMarket[]>(`${this.gammaUrl}/markets?${query}`);
    return rows.map((row) => normalizeGammaMarket(row));
  }

  async listEvents(params: { limit?: number; offset?: number; active?: boolean; closed?: boolean } = {}) {
    const query = new URLSearchParams({
      limit: String(Math.min(Math.max(params.limit ?? 30, 1), 100)),
      offset: String(Math.max(params.offset ?? 0, 0)),
    });
    if (params.active !== undefined) query.set("active", String(params.active));
    if (params.closed !== undefined) query.set("closed", String(params.closed));
    return this.json<GammaEvent[]>(`${this.gammaUrl}/events?${query}`);
  }

  async search(queryText: string, limit = 30): Promise<{
    events: GammaEvent[];
    markets: NormalizedPolymarketMarket[];
    rejectedMarketCount: number;
  }> {
    const query = queryText.trim();
    if (!query) return { events: [], markets: [], rejectedMarketCount: 0 };
    const params = new URLSearchParams({ q: query, limit_per_type: String(Math.min(Math.max(limit, 1), 50)) });
    const result = await this.json<Record<string, unknown>>(`${this.gammaUrl}/public-search?${params}`);
    const events = Array.isArray(result.events) ? result.events as GammaEvent[] : [];
    const directMarkets = Array.isArray(result.markets) ? result.markets as GammaMarket[] : [];
    // Gamma public-search commonly returns matching markets nested under events.
    // Flatten both response shapes and deduplicate by condition/id.
    const rawMarkets = [...directMarkets, ...events.flatMap((event) => Array.isArray(event.markets) ? event.markets : [])];
    const markets: NormalizedPolymarketMarket[] = [];
    const seen = new Set<string>();
    let rejectedMarketCount = 0;
    for (const raw of rawMarkets) {
      try {
        const market = normalizeGammaMarket(raw);
        if (!seen.has(market.id)) { seen.add(market.id); markets.push(market); }
      } catch { rejectedMarketCount += 1; }
    }
    return { events, markets, rejectedMarketCount };
  }

  async trending(limit = 20): Promise<NormalizedPolymarketMarket[]> {
    const query = new URLSearchParams({
      active: "true",
      closed: "false",
      order: "volume24hr",
      ascending: "false",
      limit: String(Math.min(Math.max(limit, 1), 100)),
    });
    const rows = await this.json<GammaMarket[]>(`${this.gammaUrl}/markets?${query}`);
    return rows.flatMap((row) => {
      try { return [normalizeGammaMarket(row)]; } catch { return []; }
    });
  }

  async getMarket(identifier: string): Promise<NormalizedPolymarketMarket> {
    const rawId = identifier.startsWith("pm:") ? identifier.slice(3) : identifier;
    const query = /^0x[a-fA-F0-9]{64}$/.test(rawId)
      ? `condition_ids=${encodeURIComponent(rawId)}`
      : `id=${encodeURIComponent(rawId)}`;
    const rows = await this.json<GammaMarket[]>(`${this.gammaUrl}/markets?${query}`);
    if (!rows[0]) throw new Error(`Polymarket market not found: ${identifier}`);
    return normalizeGammaMarket(rows[0]);
  }

  async getOrderBook(tokenId: string): Promise<ClobOrderBook> {
    if (!/^\d+$/.test(tokenId)) throw new Error("Invalid Polymarket token ID");
    return this.json<ClobOrderBook>(`${this.clobUrl}/book?token_id=${encodeURIComponent(tokenId)}`);
  }

  async getHistory(tokenId: string, interval = "1w", fidelity = 60): Promise<ProbabilityPoint[]> {
    if (!/^\d+$/.test(tokenId)) throw new Error("Invalid Polymarket token ID");
    const query = new URLSearchParams({ market: tokenId, interval, fidelity: String(fidelity) });
    const result = await this.json<{ history: Array<{ t: number; p: number }> }>(
      `${this.clobUrl}/prices-history?${query}`,
    );
    return result.history.map((point) => Object.freeze({ timestamp: point.t, probability: point.p }));
  }

  async getOpenInterest(conditionId: string): Promise<number | null> {
    const result = await this.json<Array<{ market: string; value: number }>>(
      `${this.dataUrl}/oi?market=${encodeURIComponent(conditionId)}`,
    );
    return result.find((item) => item.market.toLowerCase() === conditionId.toLowerCase())?.value ?? null;
  }
}
import { ProviderCircuitBreaker, retryDelayMs } from "./resilience.js";
