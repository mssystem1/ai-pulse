import express from "express";
import cors from "cors";
import morgan from "morgan";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createCircleWalletRouter } from "./circleWallet.js";
import { createTradeAutomationRouter } from "./tradeAutomation.js";
import { autopilotPassTargetExists, createAutopilotAutomationRouter, grantAutopilotPass } from "./autopilotAutomation.js";
import type { AppConfig } from "@pulse/config";
import { buildAspMetadata, getNetwork, priceLabel, type NetworkKey } from "@pulse/config";

export function estimateAiCostUsd(
  cfg: Pick<AppConfig, "XAI_INPUT_COST_PER_MILLION_USD" | "XAI_CACHED_INPUT_COST_PER_MILLION_USD" | "XAI_OUTPUT_COST_PER_MILLION_USD">,
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number },
): number {
  const cached = Math.min(usage.promptTokens, Math.max(0, usage.cachedTokens || 0));
  const cachedRate = Number.isFinite(cfg.XAI_CACHED_INPUT_COST_PER_MILLION_USD)
    ? cfg.XAI_CACHED_INPUT_COST_PER_MILLION_USD
    : cfg.XAI_INPUT_COST_PER_MILLION_USD;
  return ((usage.promptTokens - cached) * cfg.XAI_INPUT_COST_PER_MILLION_USD
    + cached * cachedRate
    + usage.completionTokens * cfg.XAI_OUTPUT_COST_PER_MILLION_USD) / 1_000_000;
}
import {
  buildX402InputRequired,
  createPaymentGate,
  getX402OutputSchema,
  type SettlementRequest,
} from "@pulse/payments";
import { buildFusedAiContext, buildSpotExecutionPlan, buildTechnicalStructure, calculateFusionFeatures, isAnalyticsEligible, preparePredictionContext, runGrokTokenRiskAnalysis, runPreparedSpotAnalysis, runPreparedV5Analysis, spotOutputTokenLimit } from "@pulse/analysis";
import {
  buildMarketContext,
  getCandles,
  getTicker,
  isCryptoTradingPrediction,
  searchSpotInstruments,
  toOkxBar,
} from "@pulse/market";
import { PolymarketClient } from "@pulse/market";
import {
  marketPulse,
  resolveQuery,
  runPreflight,
  scoreToGrade,
  scoreToVerdict,
  scanToken,
  scanWallet,
  swapQuote,
} from "@pulse/domain";
import {
  MarketPulseRequestSchema,
  PredictionAnalysisRequestSchema,
  PredictionAnalysisResponseSchema,
  FusedAnalysisRequestSchema,
  FusedAnalysisResponseSchema,
  DivergenceAnalysisRequestSchema,
  DivergenceAnalysisResponseSchema,
  EventRiskPreflightRequestSchema,
  EventRiskPreflightResponseSchema,
  PreflightRequestSchema,
  ResolveRequestSchema,
  SwapQuoteRequestSchema,
  TokenScanRequestSchema,
  WalletScanRequestSchema,
} from "@pulse/schemas";
import { z } from "zod";
import { createPaidFetch, buyerAddress } from "@pulse/buyer";
import { createMcpHandler } from "./mcp.js";
import { getReport, listReports, saveReport } from "./store.js";
import { executionAssetAliases, getOkbUsdt0Quote, getOkbUsdt0Swap, getOkxTradeTokens, searchOkxDefiOpportunities } from "./okxDex.js";
import { collectLiveContractEvidence, inspectEvmAddress, simulateEvmTransaction } from "./contractInspect.js";
import { getCdpNativeUsdcSwap } from "./cdpSwap.js";
import { getXLayerTokenCatalog } from "./tokenCatalog.js";
import { createPersistence, paymentIdempotencyKey, requestHash, runReceiptBoundOperation, verifyRecoveryToken, type AnalysisJob, type PaymentReceipt } from "./jobs.js";
import { DurableJobWorker } from "./jobWorker.js";
import { observeProvider, prometheusMetrics, recordAiUsage, recordJob, recordPayment, recordProvider, recordReport, setQueueDepth, telemetryMiddleware } from "./telemetry.js";
import { ArcBudgetExceededError, createArcBudgetStore, paymentPayer, type ArcBudgetStore } from "./arcBudget.js";
import { createV6Router } from "./v6Routes.js";
import { createTelegramRouter, deliverTelegramReportDurably, isTelegramDeliveryCapability } from "./telegram.js";
import { isKvUnavailableError, isTransientConnectivityError, kvCircuitStatus } from "./resilientKv.js";
import { ReportHistoryAuth } from "./reportHistoryAuth.js";
import { createAutomationTickRouter, type AutomationTickDependencies } from "./automationTick.js";
import { collectTokenRiskEvidence } from "./tokenRiskEvidence.js";

const AnalysisBodySchema = z.object({
  instId: z.string().min(3).max(32),
  timeframe: z.string().optional().default("1H"),
  lang: z.enum(["en", "zh"]).optional().default("en"),
  chartImageBase64: z.string().optional(),
  chartImageMime: z.string().optional(),
  userNote: z.string().max(500).optional(),
});

const AtomicAmountSchema = z.string().regex(/^\d{1,30}$/).refine((value) => BigInt(value) > 0n, "amount must be positive");
const DexSwapBodySchema = z.object({
  amount: AtomicAmountSchema,
  userWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  slippagePercent: z.coerce.number().min(0.1).max(5).default(0.5),
});
const CdpSwapBodySchema = z.object({
  network: z.enum(["base", "arbitrum"]), amount: AtomicAmountSchema,
  userWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

function findBrandDir(): string {
  const candidates = [
    resolve(process.cwd(), "assets"),
    resolve(process.cwd(), "../../assets"),
    resolve(process.cwd(), "apps/api/public"),
  ];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, "../../../assets"));
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    if (existsSync(resolve(c, "logo.png")) || existsSync(resolve(c, "logo.svg"))) {
      return c;
    }
  }
  return resolve(process.cwd(), "assets");
}

function findDocsDir(): string {
  const candidates = [resolve(process.cwd(), "docs"), resolve(process.cwd(), "../../docs")];
  try { candidates.push(resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs")); } catch { /* ignore */ }
  return candidates.find((candidate) => existsSync(resolve(candidate, "PRODUCT_TESTING_GUIDE.md"))) || resolve(process.cwd(), "docs");
}

export function createApp(cfg: AppConfig, dependencies: {
  polymarket?: PolymarketClient;
  persistence?: ReturnType<typeof createPersistence>;
  arcBudget?: ArcBudgetStore;
  spotContext?: typeof buildMarketContext;
  automationTick?: Partial<AutomationTickDependencies>;
  startDurableWorker?: boolean;
} = {}) {
  const app = express();
  const polymarket = dependencies.polymarket || new PolymarketClient({
    gammaUrl: cfg.POLYMARKET_GAMMA_URL,
    clobUrl: cfg.POLYMARKET_CLOB_URL,
    dataUrl: cfg.POLYMARKET_DATA_URL,
    observer: recordProvider,
  });
  const persistence = dependencies.persistence || createPersistence(cfg);
  const shouldRunDurableWorker = dependencies.startDurableWorker !== false;
  let durableWorker: DurableJobWorker | undefined;
  const wakeWorker = () => {
    if (shouldRunDurableWorker) void durableWorker?.notify();
  };
  const reportHistoryAuth = new ReportHistoryAuth(cfg.KV_REST_API_URL, cfg.KV_REST_API_TOKEN, cfg.PERSISTENCE_NAMESPACE);
  const loadSpotContext = dependencies.spotContext || buildMarketContext;
  const arcBudget = dependencies.arcBudget || createArcBudgetStore({
    QUEUE_PROVIDER: cfg.QUEUE_PROVIDER, KV_REST_API_URL: cfg.KV_REST_API_URL, KV_REST_API_TOKEN: cfg.KV_REST_API_TOKEN,
    PERSISTENCE_NAMESPACE: cfg.PERSISTENCE_NAMESPACE,
    walletHourly: cfg.ARC_LIVE_WALLET_HOURLY_LIMIT, ipHourly: cfg.ARC_LIVE_IP_HOURLY_LIMIT,
    walletDaily: cfg.ARC_LIVE_WALLET_DAILY_LIMIT, dailyCostMicrousd: Math.floor(cfg.ARC_LIVE_DAILY_COST_LIMIT_USD * 1_000_000),
  });
  app.set("trust proxy", true);
    
  app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));
  app.use(express.json({ limit: "12mb" }));
  app.use(createAutomationTickRouter(cfg, dependencies.automationTick));
  app.use(createV6Router(cfg));
  app.use(createTradeAutomationRouter());
  app.use(createAutopilotAutomationRouter(cfg));
  app.use(createTelegramRouter(cfg));
  app.use(telemetryMiddleware);
  app.use(morgan(cfg.NODE_ENV === "production" ? "combined" : "dev"));
  // Authentication and challenge creation must not pass through a payment-network route.
  // CIRCLE_API_KEY remains server-only; responses are explicitly non-cacheable.
  app.use("/v1/circle/wallet", createCircleWalletRouter());
  app.get("/metrics", async (_req, res) => {
    try {
      const queue = await persistence.jobs.queueStats();
      setQueueDepth(queue.ready, queue.leased);
      return res.type("text/plain; version=0.0.4").send(prometheusMetrics());
    } catch {
      return res.status(503).type("text/plain").send("pulse_metrics_collection_error 1\n");
    }
  });

  const networkAliases = { xlayer: "xlayer", base: "base", arbitrum: "arbitrum", arc: "arc-testnet" } as const;
  app.use((req, res, next) => {
    const match = req.url.match(/^\/(xlayer|base|arbitrum|arc)(?=\/)/);
    const alias = match?.[1] as keyof typeof networkAliases | undefined;
    const networkKey = alias ? networkAliases[alias] : "xlayer";
    if (!cfg.enabledNetworks.includes(networkKey)) return res.status(404).json({ error: `Network disabled: ${networkKey}` });
    const enabled = networkKey === "xlayer"
      || (networkKey === "base" && cfg.FEATURE_BASE_PAYMENTS)
      || (networkKey === "arbitrum" && cfg.FEATURE_ARBITRUM_PAYMENTS)
      || (networkKey === "arc-testnet" && cfg.FEATURE_ARC_PAYMENTS && cfg.CIRCLE_GATEWAY_ENABLED);
    if (!enabled) return res.status(404).json({ error: `Network payment route disabled: ${networkKey}` });
    const network = cfg.enabledNetworks.includes(networkKey) ? networkKey : "xlayer";
    Object.assign(req, { pulseNetworkKey: network });
    if (match) req.url = req.url.slice(match[0].length) || "/";
    next();
  });

  const brandDir = findBrandDir();
  app.use("/brand", express.static(brandDir, { maxAge: "1d" }));
  app.use("/guides", express.static(findDocsDir(), { maxAge: "5m", fallthrough: false }));

  app.get("/", (_req, res) => {
    res.json({
      product: cfg.productName,
      tagline: cfg.productTagline,
      taglineZh: cfg.productTaglineZh,
      logo: cfg.logoUrl,
      description: cfg.productShortDescription,
      health: "/healthz",
      meta: "/v1/meta",
      metadata: "/v1/metadata",
      mcp: "/mcp",
      paymentMode: cfg.paymentMode,
      grokModel: cfg.GROK_MODEL,
      hasXaiKey: cfg.hasXaiKey,
    });
  });

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: cfg.productName,
      version: "2.0.0",
      paymentMode: cfg.paymentMode,
      mockPayments: cfg.paymentMode === "mock",
      hasOkxCredentials: cfg.hasOkxCredentials,
      hasXaiKey: cfg.hasXaiKey,
      hasServerPay: cfg.hasServerPay,
      grokModel: cfg.GROK_MODEL,
      network: cfg.X402_NETWORK,
      logo: cfg.logoUrl,
      reportStorage: { provider: cfg.STORAGE_PROVIDER, blobAccess: cfg.STORAGE_PROVIDER === "vercel_blob" ? cfg.BLOB_ACCESS : null },
      dependencies: { kv: kvCircuitStatus() },
    });
  });

  app.get("/v1/meta", (_req, res) => {
    res.json({
      name: cfg.productName,
      tagline: cfg.productTagline,
      taglineZh: cfg.productTaglineZh,
      description: cfg.productShortDescription,
      logo: cfg.logoUrl,
      methodology_version: cfg.methodologyVersion,
      network: cfg.X402_NETWORK,
      asset: cfg.X402_ASSET,
      paymentMode: cfg.paymentMode,
      payTo: cfg.PAY_TO_ADDRESS,
      grokModel: cfg.GROK_MODEL,
      hasXaiKey: cfg.hasXaiKey,
      languages: ["en", "zh"],
      routes: Object.entries(cfg.routes).map(([route, info]) => ({
        route,
        name: info.name,
        price: priceLabel(info.priceUsd),
        priceUsd: info.priceUsd,
        free: Boolean(info.free),
        description: info.description,
        outputSchema: info.free ? undefined : getX402OutputSchema(route.split(" ")[1] || route),
      })),
      mcp: "/mcp",
      metadata: "/v1/metadata",
    });
  });

  app.get("/v1/metadata", (_req, res) => {
    const metadata = buildAspMetadata(cfg);
    const withInputContract = <T extends { path: string; free: boolean }>(service: T) => ({
      ...service,
      outputSchema: service.free ? undefined : getX402OutputSchema(service.path),
    });
    res.json({
      ...metadata,
      asp: {
        ...metadata.asp,
        services: metadata.asp.services.map(withInputContract),
        featuredServices: metadata.asp.featuredServices.map(withInputContract),
      },
    });
  });

  // ── Free OKX spot teaser ──────────────────────────────────────────
  app.get("/v1/market/instruments", async (req, res) => {
    try {
      const q = String(req.query.q || "");
      const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
      const list = await observeProvider("okx", "spot_instruments", () => searchSpotInstruments(q, limit));
      res.json({ service: "instruments", query: q, count: list.length, instruments: list });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  app.get("/v1/xlayer/tokens", async (req, res) => {
    try {
      const q = String(req.query.q || "").slice(0, 100);
      const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 60);
      const tokens = await observeProvider("okx_dex", "token_catalog", () => getXLayerTokenCatalog(cfg, q, limit));
      res.json({
        service: "xlayer_token_catalog",
        chainId: "196",
        query: q,
        count: tokens.length,
        sources: ["OKX Onchain OS", "DexScreener when X Layer data is available"],
        tokens,
      });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/v1/market/ticker", async (req, res) => {
    try {
      const instId = String(req.query.instId || "");
      if (!instId) return res.status(400).json({ error: "instId required" });
      const ticker = await observeProvider("okx", "ticker", () => getTicker(instId));
      res.json({ service: "ticker", free: true, ticker });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  app.get("/v1/market/candles", async (req, res) => {
    try {
      const instId = String(req.query.instId || "");
      if (!instId) return res.status(400).json({ error: "instId required" });
      const bar = toOkxBar(String(req.query.bar || req.query.timeframe || "1H"));
      const limit = Math.min(Number(req.query.limit) || 100, 300);
      const candles = await observeProvider("okx", "candles", () => getCandles(instId, bar, limit));
      res.json({ service: "candles", free: true, instId, bar, candles });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  // ── Free read-only Polymarket data ─────────────────────────────────────
  if (cfg.FEATURE_POLYMARKET) {
    app.get("/v1/polymarket/events", async (req, res) => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const events = await polymarket.listEvents({ limit, offset, active: true, closed: false });
        res.json({
          service: "polymarket_events", free: true, count: events.length, limit, offset, events,
          source: { provider: "polymarket-gamma", observedAt: new Date().toISOString() },
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get("/v1/polymarket/search", async (req, res) => {
      try {
        const query = String(req.query.q || "").trim().slice(0, 200);
        if (!query) return res.status(400).json({ error: "q required" });
        const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
        const result = await polymarket.search(query, limit);
        res.json({
          service: "polymarket_search", free: true, query, ...result,
          source: { provider: "polymarket-gamma", observedAt: new Date().toISOString() },
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get("/v1/polymarket/trending", async (req, res) => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
        const markets = await polymarket.trending(limit);
        res.json({
          service: "polymarket_trending", free: true, count: markets.length, markets,
          source: { provider: "polymarket-gamma", observedAt: new Date().toISOString() },
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get("/v1/polymarket/crypto", async (req, res) => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 50);
        const queries = ["Bitcoin", "BTC up or down", "Ethereum", "ETH up or down", "Solana", "SOL up or down", "crypto prices"];
        const results = await Promise.allSettled(queries.map((query) => polymarket.search(query, 50)));
        const unique = new Map<string, Awaited<ReturnType<typeof polymarket.search>>["markets"][number]>();
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          for (const market of result.value.markets) {
            const future = !market.endDate || Date.parse(market.endDate) > Date.now();
            if (isCryptoTradingPrediction(market.question) && market.active && !market.closed && !market.archived && market.enableOrderBook && future) unique.set(market.id, market);
          }
        }
        const markets = [...unique.values()]
          .sort((a, b) => {
            const aEnd = a.endDate ? Date.parse(a.endDate) : Number.MAX_SAFE_INTEGER;
            const bEnd = b.endDate ? Date.parse(b.endDate) : Number.MAX_SAFE_INTEGER;
            const aNear = aEnd - Date.now() < 7 * 86_400_000 ? 1 : 0;
            const bNear = bEnd - Date.now() < 7 * 86_400_000 ? 1 : 0;
            return bNear - aNear || (b.volumeUsd || 0) - (a.volumeUsd || 0);
          })
          .slice(0, limit);
        res.json({
          service: "polymarket_crypto_discovery", free: true, count: markets.length, markets,
          filters: { assets: ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "SUI", "ADA", "AVAX", "LINK"], intent: "price-or-direction" },
          source: { provider: "polymarket-gamma", observedAt: new Date().toISOString() },
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get("/v1/polymarket/markets", async (req, res) => {
      try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const markets = await polymarket.listMarkets({ limit, offset, active: true, closed: false });
        res.json({
          service: "polymarket_markets",
          free: true,
          count: markets.length,
          limit,
          offset,
          markets,
          source: { provider: "polymarket-gamma", observedAt: new Date().toISOString() },
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get("/v1/polymarket/markets/:marketId", async (req, res) => {
      try {
        const market = await polymarket.getMarket(req.params.marketId);
        res.json({ service: "polymarket_market", free: true, market });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(message.includes("not found") ? 404 : 502).json({ error: message });
      }
    });

    app.get("/v1/polymarket/markets/:marketId/history", async (req, res) => {
      try {
        const market = await polymarket.getMarket(req.params.marketId);
        const interval = String(req.query.interval || "1w");
        const fidelity = Math.min(Math.max(Number(req.query.fidelity) || 60, 1), 1_440);
        const histories = await Promise.all(market.outcomes.map(async (outcome) => ({
          outcome: outcome.name,
          tokenId: outcome.tokenId,
          points: await polymarket.getHistory(outcome.tokenId, interval, fidelity),
        })));
        res.json({
          service: "polymarket_history",
          free: true,
          marketId: market.id,
          conditionId: market.conditionId,
          interval,
          fidelity,
          histories,
          source: { provider: "polymarket-clob", observedAt: new Date().toISOString() },
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get("/v1/polymarket/markets/:marketId/orderbook", async (req, res) => {
      try {
        const market = await polymarket.getMarket(req.params.marketId);
        const books = await Promise.all(market.outcomes.map(async (outcome) => ({
          outcome: outcome.name,
          tokenId: outcome.tokenId,
          book: await polymarket.getOrderBook(outcome.tokenId),
        })));
        res.json({
          service: "polymarket_orderbook",
          free: true,
          marketId: market.id,
          conditionId: market.conditionId,
          books,
          source: { provider: "polymarket-clob", observedAt: new Date().toISOString() },
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get("/v1/polymarket/markets/:marketId/context", async (req, res) => {
      try {
        const market = await polymarket.getMarket(req.params.marketId);
        const [booksResult, historiesResult, openInterestResult] = await Promise.allSettled([
          Promise.all(market.outcomes.map(async (outcome) => ({
            outcome: outcome.name,
            tokenId: outcome.tokenId,
            book: await polymarket.getOrderBook(outcome.tokenId),
          }))),
          Promise.all(market.outcomes.map(async (outcome) => ({
            outcome: outcome.name,
            tokenId: outcome.tokenId,
            points: await polymarket.getHistory(outcome.tokenId, "1w", 60),
          }))),
          polymarket.getOpenInterest(market.conditionId),
        ]);
        const missingSources: string[] = [];
        if (booksResult.status === "rejected") missingSources.push("polymarket-clob-orderbook");
        if (historiesResult.status === "rejected") missingSources.push("polymarket-clob-history");
        if (openInterestResult.status === "rejected") missingSources.push("polymarket-data-open-interest");
        if (booksResult.status === "rejected") {
          return res.status(502).json({ error: "Required Polymarket order-book data unavailable", missingSources });
        }
        res.json({
          service: "polymarket_context",
          free: true,
          market,
          books: booksResult.value,
          histories: historiesResult.status === "fulfilled" ? historiesResult.value : [],
          openInterest: openInterestResult.status === "fulfilled" ? openInterestResult.value : null,
          partial: missingSources.length > 0,
          missingSources,
          observedAt: new Date().toISOString(),
        });
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  // ── Free funding helper: official OKX Exchange OS DEX API ─────────
  app.get("/v1/dex/quote", async (req, res) => {
    try {
      const amount = AtomicAmountSchema.parse(req.query.amount);
      res.json({ service: "okx_dex_quote", ...(await observeProvider("okx_dex", "quote", () => getOkbUsdt0Quote(cfg, amount))) });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/v1/dex/swap", async (req, res) => {
    try {
      const body = DexSwapBodySchema.parse(req.body);
      res.json({
        service: "okx_dex_swap",
        ...(await observeProvider("okx_dex", "swap", () => getOkbUsdt0Swap(
            cfg,
            body.amount,
            body.userWalletAddress,
            String(body.slippagePercent),
          ))),
      });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/v1/dex/cdp/native-usdc", async (req, res) => {
    try {
      const body = CdpSwapBodySchema.parse(req.body);
      const quote = await observeProvider("cdp_trade", `${body.network}_native_usdc`, () => getCdpNativeUsdcSwap(cfg, body.network, body.amount, body.userWalletAddress));
      res.json({ service: "cdp_native_usdc_swap", ...quote });
    } catch (e) {
      res.status(e instanceof z.ZodError ? 400 : 502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Free factual evidence for any X Layer address. This deliberately does not invent a risk score.
  const configuredRpcUrls = (key: NetworkKey): readonly string[] => {
    const values = key === "xlayer" ? [cfg.X_LAYER_RPC, cfg.X_LAYER_RPC_FALLBACK]
      : key === "base" ? [cfg.BASE_RPC_URL, cfg.BASE_RPC_FALLBACK_URL]
      : key === "arbitrum" ? [cfg.ARBITRUM_RPC_URL, cfg.ARBITRUM_RPC_FALLBACK_URL]
      : [cfg.ARC_RPC_URL, cfg.ARC_RPC_FALLBACK_URL];
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  };

  app.post("/v1/contract/inspect", async (req, res) => {
    try {
      const body = z.object({
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address"),
      }).parse(req.body);
      const key = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
      const network = getNetwork(key);
      res.json(await inspectEvmAddress({ rpcUrl: configuredRpcUrls(key), address: body.address, expectedChainHex: `0x${network.chainId.toString(16)}`, chainId: String(network.chainId), network: `${network.label} ${network.environment}` }));
    } catch (e) {
      const validation = e instanceof z.ZodError;
      res.status(validation ? 400 : 502).json({
        error: validation ? e.issues[0]?.message || "Invalid request" : e instanceof Error ? e.message : String(e),
      });
    }
  });

  const safetyNetwork = (req: express.Request) => {
    const key = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
    const network = getNetwork(key);
    return { key, network, rpcUrl: configuredRpcUrls(key) };
  };

  app.post("/v1/safety/evidence", async (req, res) => {
    if (!cfg.FEATURE_LIVE_SAFETY) return res.status(503).json({ error: "Live safety evidence is disabled", evidenceStatus: "unavailable", safetyVerdict: "unknown" });
    try {
      const body = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address") }).parse(req.body);
      const { network, rpcUrl } = safetyNetwork(req);
      res.json(await collectLiveContractEvidence({ rpcUrl, address: body.address, expectedChainHex: `0x${network.chainId.toString(16)}`, chainId: String(network.chainId), network: `${network.label} ${network.environment}` }));
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 502).json({ error: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : String(error), evidenceStatus: "unavailable", safetyVerdict: "unknown" });
    }
  });

  app.post("/v1/safety/simulate", async (req, res) => {
    if (!cfg.FEATURE_LIVE_SAFETY) return res.status(503).json({ error: "Live transaction simulation is disabled", evidenceStatus: "unavailable", safetyVerdict: "unknown" });
    try {
      const hex = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/, "data must be even-length hex");
      const body = z.object({ transaction: z.object({
        from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid from address"),
        to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid to address"),
        data: hex.max(262_146).optional(),
        value: z.string().regex(/^0x[0-9a-fA-F]+$/, "value must be a hex quantity").optional(),
      }) }).parse(req.body);
      const { network, rpcUrl } = safetyNetwork(req);
      res.json(await simulateEvmTransaction({ rpcUrl, expectedChainHex: `0x${network.chainId.toString(16)}`, chainId: String(network.chainId), network: `${network.label} ${network.environment}`, transaction: body.transaction }));
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 502).json({ error: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : String(error), evidenceStatus: "unavailable", safetyVerdict: "unknown" });
    }
  });

  /**
   * Server-side x402 checkout: pays with TEST_WALLET_PRIVATE_KEY then returns the paid resource.
   * Enable with ENABLE_SERVER_PAY=1. Never expose the private key to the browser.
   */
  app.post("/v1/checkout", async (req, res) => {
    try {
      if (!cfg.hasServerPay || !cfg.TEST_WALLET_PRIVATE_KEY) {
        return res.status(503).json({
          error: "Server pay disabled. Set ENABLE_SERVER_PAY=1 and TEST_WALLET_PRIVATE_KEY.",
        });
      }
      const path = String(req.body?.path || "");
      const allowed = [
        "/v1/analysis/base",
        "/v1/analysis/premium",
        "/v1/token/scan",
        "/v1/preflight",
      ];
      if (!allowed.includes(path)) {
        return res.status(400).json({ error: `path not allowed: ${path}`, allowed });
      }
      const body = req.body?.body ?? {};
      const origin = `http://127.0.0.1:${cfg.PORT}`;
      const paidFetch = createPaidFetch({
        privateKey: cfg.TEST_WALLET_PRIVATE_KEY,
        rpcUrl: cfg.X_LAYER_RPC,
        network: cfg.X402_NETWORK,
      });
      const from = buyerAddress(cfg.TEST_WALLET_PRIVATE_KEY);
      const r = await paidFetch(`${origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* keep text */
      }
      if (!r.ok) {
        return res.status(r.status).json({
          error: "Paid request failed",
          status: r.status,
          from,
          data,
        });
      }
      res.setHeader(
        "PAYMENT-RESPONSE",
        r.headers.get("PAYMENT-RESPONSE") || r.headers.get("payment-response") || "",
      );
      res.json({
        ok: true,
        path,
        paidBy: from,
        payTo: cfg.PAY_TO_ADDRESS,
        result: data,
      });
    } catch (e) {
      console.error("[checkout]", e);
      res.status(500).json({ error: String(e) });
    }
  });

  app.post("/v1/resolve", (req, res) => {
    try {
      const body = ResolveRequestSchema.parse(req.body);
      const matches = resolveQuery(body.query, body.chainId ?? "196").map((m) => ({
        address: m.address,
        symbol: m.symbol,
        name: m.name,
        chainId: m.chainId,
        kind: m.kind,
      }));
      res.json({
        service: "resolve",
        query: body.query,
        matches,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get("/v1/reports/:shareId", (req, res) => {
    const report = getReport(req.params.shareId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  });

  app.get("/v1/reports", (_req, res) => {
    res.json({ reports: listReports(30) });
  });

  const reportOwner = (req: express.Request) => {
    const authorization = String(req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT") || "");
    return authorization ? `payment:${requestHash(authorization)}` : "";
  };
  const privateRecordView = (record: { id: string; visibility: string; checksum: string; createdAt: string }) => ({
    id: record.id, visibility: record.visibility, checksum: record.checksum, createdAt: record.createdAt,
  });
  const publicJobView = (job: AnalysisJob) => ({
    id: job.id, mode: job.mode, tier: job.tier, network: job.network, stage: job.stage,
    events: job.events, reportId: job.reportId, receipt: job.receipt,
    regenerationAttempts: job.regenerationAttempts, maxRegenerationAttempts: job.maxRegenerationAttempts,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
  });
  const authorizedJob = async (req: express.Request) => {
    const job = await persistence.jobs.get(String(req.params.jobId));
    if (!job) return null;
    const token = String(req.header("PULSE-RECOVERY-TOKEN") || req.query.recoveryToken || "");
    return verifyRecoveryToken(job, token) ? job : false;
  };
  const retrySettledReportJob = async (job: AnalysisJob) => {
    if (job.reportId || job.stage === "completed" || job.stage === "completed_partial") {
      return { status: 200, body: { job: publicJobView(job), reportReady: true } } as const;
    }
    if (!job.receiptId || job.receipt?.settlementResult !== "settled") {
      return { status: 409, body: { error: "A settled receipt is required before report regeneration" } } as const;
    }
    const retryable = job.stage === "failed_retriable" || job.stage === "failed_terminal" || job.stage === "manual_reconciliation";
    if (!retryable) {
      // The job is already owned by the durable worker. Wake maintenance, but
      // never enqueue a duplicate concurrent model call.
      wakeWorker();
      return { status: 202, body: { job: publicJobView(job), alreadyProcessing: true } } as const;
    }
    const queued = await persistence.jobs.transition(job.id, "fetching_context", "owner-requested receipt-bound recovery; no new payment");
    await persistence.jobs.enqueue(job.id);
    wakeWorker();
    return { status: 202, body: { job: publicJobView(queued), retriedWithoutPayment: true } } as const;
  };
  const asyncRoute = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
    (req, res, next) => { void handler(req, res).catch(next); };

  const HistoryIdentitySchema = z.object({
    wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    networkKey: z.enum(["xlayer", "base", "arbitrum", "arc-testnet"]),
  });

  app.get("/v1/tokens", async (req, res) => {
    try {
      const key = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
      const network = getNetwork(key);
      const q = String(req.query.q || "").trim().slice(0, 100);
      const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 60);
      if (key === "xlayer") {
        const tokens = await observeProvider("okx_dex", "token_catalog", () => getXLayerTokenCatalog(cfg, q, limit));
        return res.json({ service: "network_token_catalog", network: key, chainId: String(network.chainId), query: q, count: tokens.length, sources: ["OKX Onchain OS", "DexScreener when available"], tokens });
      }

      const configured = network.paymentAsset.address ? [{
        symbol: network.paymentAsset.symbol,
        name: network.paymentAsset.name,
        address: network.paymentAsset.address,
        decimals: network.paymentAsset.decimals,
        logoUrl: null,
        provider: key === "arc-testnet" ? "Arc Testnet configuration" : "PULSE network registry",
      }] : [];
      const routed = key === "arc-testnet" ? [] : await observeProvider("okx_dex", "token_catalog", () => getOkxTradeTokens(cfg, String(network.chainId), q, limit)).catch(() => []);
      const normalizedQuery = q.toLowerCase();
      const relevance = (item: { symbol: string; name: string }) => {
        const symbol = item.symbol.toLowerCase();
        const name = item.name.toLowerCase();
        if (!normalizedQuery) return 0;
        if (symbol === normalizedQuery) return 4;
        if (symbol === `w${normalizedQuery}` || symbol === `cb${normalizedQuery}` || symbol === `x${normalizedQuery}`) return 3;
        if (symbol.startsWith(normalizedQuery)) return 2;
        if (name.startsWith(normalizedQuery)) return 1;
        return 0;
      };
      const tokens = [...configured, ...routed]
        .filter((item) => !/^0x[eE]{40}$/.test(item.address) && !/^0x0{40}$/.test(item.address))
        .filter((item, index, all) => all.findIndex((candidate) => candidate.address.toLowerCase() === item.address.toLowerCase()) === index)
        .filter((item) => !normalizedQuery || [item.symbol, item.name, item.address].some((value) => value.toLowerCase().includes(normalizedQuery)))
        .sort((a, b) => relevance(b) - relevance(a))
        .slice(0, limit)
        .map((item) => ({
          address: item.address,
          symbol: item.symbol,
          name: item.name,
          logoUrl: item.logoUrl || null,
          priceUsd: null,
          change24h: null,
          liquidityUsd: null,
          marketCapUsd: null,
          holders: null,
          communityRecognized: false,
          dexUrl: null,
          sources: [item.provider || "OKX Onchain OS"],
        }));
      return res.json({ service: "network_token_catalog", network: key, chainId: String(network.chainId), query: q, count: tokens.length, sources: key === "arc-testnet" ? ["Arc Testnet network registry"] : ["OKX Onchain OS"], tokens, manualAddressSupported: true });
    } catch (e) {
      return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  const historySession = async (req: express.Request) => {
    const header = String(req.header("Authorization") || "");
    return reportHistoryAuth.authenticate(header.startsWith("Bearer ") ? header.slice(7) : "");
  };
  const historyLabel = (job: AnalysisJob) => {
    const input = job.input && typeof job.input === "object" ? job.input as Record<string, unknown> : {};
    if (job.mode === "spot") return `${String(input.instId || "Global market")} · ${String(input.timeframe || "report")}`;
    if (job.mode === "prediction") return `Prediction · ${String(input.primaryMarketId || "selected market").slice(0, 42)}`;
    return `${job.mode.replaceAll("-", " ")} report`;
  };

  app.use("/v1/report-history", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  app.post("/v1/report-history/challenge", asyncRoute(async (req, res) => {
    const identity = HistoryIdentitySchema.parse(req.body);
    return res.json(await reportHistoryAuth.issue(identity.wallet, identity.networkKey));
  }));
  app.post("/v1/report-history/session", asyncRoute(async (req, res) => {
    const body = HistoryIdentitySchema.extend({ nonce: z.string().min(20).max(100), signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/) }).parse(req.body);
    try { return res.json(await reportHistoryAuth.authorize(body.wallet, body.networkKey, body.nonce, body.signature as `0x${string}`)); }
    catch (error) { return res.status(401).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));
  app.get("/v1/report-history", asyncRoute(async (req, res) => {
    const session = await historySession(req);
    if (!session) return res.status(401).json({ error: "A current wallet-signed report-history session is required" });
    const jobs = await persistence.jobs.listByPayer(session.wallet, session.networkKey, 30);
    return res.json({ wallet: session.wallet, networkKey: session.networkKey, reports: jobs.map((job) => ({ id: job.id, mode: job.mode, tier: job.tier, stage: job.stage, label: historyLabel(job), createdAt: job.createdAt, updatedAt: job.updatedAt, ready: Boolean(job.reportId) })) });
  }));
  app.get("/v1/report-history/:jobId/report", asyncRoute(async (req, res) => {
    const session = await historySession(req);
    if (!session) return res.status(401).json({ error: "A current wallet-signed report-history session is required" });
    const job = await persistence.jobs.get(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: "Report job not found" });
    if (job.payer.toLowerCase() !== session.wallet || job.networkKey !== session.networkKey) return res.status(403).json({ error: "This report does not belong to the authenticated wallet and network" });
    if (!job.reportId) return res.status(409).json({ error: "Report is not ready", stage: job.stage });
    const record = await persistence.reports.get(job.reportId);
    if (!record || record.ownerWallet !== session.wallet) return res.status(404).json({ error: "Stored report not found" });
    return res.json({ report: await persistence.reports.read(record), metadata: privateRecordView(record), job: publicJobView(job) });
  }));
  app.post("/v1/report-history/:jobId/retry", asyncRoute(async (req, res) => {
    const session = await historySession(req);
    if (!session) return res.status(401).json({ error: "A current wallet-signed report-history session is required" });
    const job = await persistence.jobs.get(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: "Report job not found" });
    if (job.payer.toLowerCase() !== session.wallet || job.networkKey !== session.networkKey) {
      return res.status(403).json({ error: "This report does not belong to the authenticated wallet and network" });
    }
    const outcome = await retrySettledReportJob(job);
    return res.status(outcome.status).json(outcome.body);
  }));

  // Job state is a live coordination resource. Browser ETags caused Safari to
  // keep replaying a stale 304 while the worker was progressing in KV, so no
  // job/status/report response may be cached by a browser or intermediary.
  app.use("/v1/jobs", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.removeHeader("ETag");
    next();
  });

  app.get("/v1/jobs/:jobId", asyncRoute(async (req, res) => {
    const job = await authorizedJob(req);
    if (job === null) return res.status(404).json({ error: "Job not found" });
    if (job === false) return res.status(403).json({ error: "Valid PULSE-RECOVERY-TOKEN required" });
    const report = job.reportId ? await persistence.reports.get(job.reportId) : null;
    return res.json({ job: publicJobView(job), ...(report ? { storedReport: privateRecordView(report) } : {}) });
  }));

  app.get("/v1/jobs/:jobId/report", asyncRoute(async (req, res) => {
    const job = await authorizedJob(req);
    if (job === null) return res.status(404).json({ error: "Job not found" });
    if (job === false) return res.status(403).json({ error: "Valid PULSE-RECOVERY-TOKEN required" });
    if (!job.reportId) return res.status(409).json({ error: "Report is not ready", stage: job.stage });
    const record = await persistence.reports.get(job.reportId);
    if (!record) return res.status(404).json({ error: "Stored report not found" });
    try {
      return res.json({ report: await persistence.reports.read(record), metadata: privateRecordView(record), job: publicJobView(job) });
    } catch (error) {
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ error: "Report storage is temporarily unavailable", recoverable: true, retryAfterSeconds: 5, detail: error instanceof Error ? error.message : String(error) });
    }
  }));

  app.post("/v1/jobs/:jobId/retry", asyncRoute(async (req, res) => {
    const job = await authorizedJob(req);
    if (job === null) return res.status(404).json({ error: "Job not found" });
    if (job === false) return res.status(403).json({ error: "Valid PULSE-RECOVERY-TOKEN required" });
    const outcome = await retrySettledReportJob(job);
    return res.status(outcome.status).json(outcome.body);
  }));

  app.get("/v1/private/reports/:reportId", asyncRoute(async (req, res) => {
    const record = await persistence.reports.get(String(req.params.reportId));
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!reportOwner(req) || reportOwner(req) !== record.ownerWallet) return res.status(403).json({ error: "Report owner authorization required" });
    return res.json({ report: await persistence.reports.read(record), metadata: privateRecordView(record) });
  }));

  app.post("/v1/private/reports/:reportId/shares", asyncRoute(async (req, res) => {
    if (!cfg.REPORT_SHARE_LINK_ENABLED) return res.status(404).json({ error: "Report sharing disabled" });
    const record = await persistence.reports.get(String(req.params.reportId));
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!reportOwner(req) || reportOwner(req) !== record.ownerWallet) return res.status(403).json({ error: "Report owner authorization required" });
    const share = await persistence.reports.createShare(record.id);
    return res.status(201).json({ reportId: record.id, shareToken: share.token, shareUrl: `${cfg.BASE_URL.replace(/\/$/, "")}/v1/shared/reports/${share.token}` });
  }));

  app.delete("/v1/private/reports/:reportId/shares/:shareToken", asyncRoute(async (req, res) => {
    const record = await persistence.reports.get(String(req.params.reportId));
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!reportOwner(req) || reportOwner(req) !== record.ownerWallet) return res.status(403).json({ error: "Report owner authorization required" });
    const sharedRecord = await persistence.reports.resolveShare(String(req.params.shareToken));
    if (!sharedRecord || sharedRecord.id !== record.id) return res.status(404).json({ error: "Share not found" });
    await persistence.reports.revokeShare(String(req.params.shareToken));
    return res.status(204).end();
  }));

  app.get("/v1/shared/reports/:shareToken", asyncRoute(async (req, res) => {
    if (!cfg.REPORT_SHARE_LINK_ENABLED) return res.status(404).json({ error: "Report sharing disabled" });
    const record = await persistence.reports.resolveShare(String(req.params.shareToken));
    if (!record) return res.status(404).json({ error: "Share not found or revoked" });
    return res.json({ report: await persistence.reports.read(record), metadata: privateRecordView(record) });
  }));

  // OKX.AI task clients probe paid endpoints with GET before they know the
  // business parameters. Return a machine-readable contract that the client
  // can use to assemble the POST body before requesting payment.
  for (const path of [
    "/v1/analysis/base",
    "/v1/analysis/premium",
    "/v1/analysis/spot/standard",
    "/v1/analysis/spot/premium",
    "/v1/analysis/prediction/standard",
    "/v1/analysis/prediction/premium",
    "/v1/analysis/fused/standard",
    "/v1/analysis/fused/premium",
    "/v1/analysis/divergence",
    "/v1/preflight/event-risk",
    "/v1/token/scan",
    "/v1/preflight",
    "/v1/wallet/scan",
    "/v1/market/pulse",
    "/v1/swap/quote",
  ]) {
    app.get(path, (_req, res) => {
      res.status(400).json(buildX402InputRequired(path));
    });
  }

  // Validate the scan body before the payment gate. This prevents a buyer from
  // paying for a request that cannot produce a report.
  app.post("/v1/token/scan", (req, res, next) => {
    const parsed = TokenScanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(buildX402InputRequired("/v1/token/scan", parsed.error.issues));
    }
    const key = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
    const expectedChainId = String(getNetwork(key).chainId);
    if (parsed.data.chainId && parsed.data.chainId !== expectedChainId) {
      return res.status(400).json(
        buildX402InputRequired("/v1/token/scan", [
          { path: ["chainId"], message: `Selected ${getNetwork(key).label} route requires chain ${expectedChainId}.` },
        ]),
      );
    }
    req.body = { ...parsed.data, chainId: expectedChainId };
    next();
  });
  app.post("/v1/preflight", (req, res, next) => {
    const parsed = PreflightRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json(buildX402InputRequired("/v1/preflight", parsed.error.issues));
    const inspectedAddress = parsed.data.tokenAddress || parsed.data.toToken || parsed.data.fromToken;
    if (!inspectedAddress) return res.status(400).json(buildX402InputRequired("/v1/preflight", [
      { path: ["tokenAddress"], message: "Risk Guard requires the exact token contract address." },
    ]));
    const key = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
    req.body = { ...parsed.data, chainId: String(getNetwork(key).chainId) };
    next();
  });

  const v5InputSchemas = new Map<string, z.ZodType>([
    ["/v1/analysis/spot/standard", AnalysisBodySchema],
    ["/v1/analysis/spot/premium", AnalysisBodySchema],
    ["/v1/analysis/prediction/standard", PredictionAnalysisRequestSchema],
    ["/v1/analysis/prediction/premium", PredictionAnalysisRequestSchema],
    ["/v1/analysis/fused/standard", FusedAnalysisRequestSchema],
    ["/v1/analysis/fused/premium", FusedAnalysisRequestSchema],
    ["/v1/analysis/divergence", DivergenceAnalysisRequestSchema],
    ["/v1/preflight/event-risk", EventRiskPreflightRequestSchema],
  ]);
  app.use((req, res, next) => {
    if (req.method !== "POST") return next();
    const schema = v5InputSchemas.get(req.path);
    if (!schema) return next();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(buildX402InputRequired(req.path, parsed.error.issues));
    req.body = parsed.data;
    return next();
  });

  // Validate the primary prediction-market evidence before presenting a 402
  // challenge. This prevents charging for a request that cannot produce a
  // report. The durable worker intentionally validates again after settlement
  // so a stale or changed market can never be treated as fresh evidence.
  const predictionEvidencePaths = new Set([
    "/v1/analysis/prediction/standard",
    "/v1/analysis/prediction/premium",
    "/v1/analysis/fused/standard",
    "/v1/analysis/fused/premium",
    "/v1/analysis/divergence",
    "/v1/preflight/event-risk",
  ]);
  app.use(async (req, res, next) => {
    if (req.method !== "POST" || !predictionEvidencePaths.has(req.path)) return next();
    const body = req.body as { primaryMarketId: string };
    try {
      const market = await polymarket.getMarket(body.primaryMarketId);
      if (!isAnalyticsEligible(market)) {
        return res.status(422).json({
          error: "The selected primary Polymarket market is unavailable for live analysis",
          code: `market_${market.eligibility}`,
        });
      }
      await Promise.all(market.outcomes.map((outcome) => polymarket.getOrderBook(outcome.tokenId)));
      return next();
    } catch (error) {
      return res.status(503).json({
        error: "Required Polymarket evidence is temporarily unavailable",
        code: "prediction_evidence_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Reject a saturated Arc source before it is asked to pay. Wallet and cost
  // reservations happen after payment verification because payer identity is
  // carried by the signed authorization.
  app.use(async (req, res, next) => {
    const network = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey;
    if (network !== "arc-testnet" || cfg.ARC_AI_MODE !== "live" || !req.path.match(/^\/v1\/analysis\/(?:base$|premium$|spot\/|prediction\/|fused\/)/)) return next();
    try { await arcBudget.checkIp(req.ip || req.socket.remoteAddress || "unknown"); return next(); }
    catch (error) {
      if (error instanceof ArcBudgetExceededError) {
        res.setHeader("Retry-After", "3600");
        return res.status(429).json({ error: error.message, code: error.dimension });
      }
      return next(error);
    }
  });

  const AutopilotPassBodySchema = z.object({
    owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    telegramDelivery: z.string().max(160).optional(),
  });
  const autopilotPassPaths = new Set([
    "/v1/autopilot/pass/24h",
    "/v1/autopilot/pass/7d",
    "/v1/autopilot/pass/30d",
  ]);

  // Resolve schema, network availability and owner/vault registration before
  // x402. A bad or stale UI selection must never result in a paid rejection.
  app.use(async (req, res, next) => {
    if (req.method !== "POST" || !autopilotPassPaths.has(req.path)) return next();
    const parsed = AutopilotPassBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const network = ((req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer");
    if (network === "arc-testnet") return res.status(422).json({ error: "Autopilot is not available on Arc Testnet" });
    if (!(await autopilotPassTargetExists({ owner: parsed.data.owner, vault: parsed.data.vault, network }))) {
      return res.status(404).json({ error: "This wallet does not own the selected Autopilot on the selected network" });
    }
    return next();
  });

  // Payment gate for paid routes, measured only until challenge rejection or
  // verified/settled continuation (never including downstream provider work).
  const paymentGate = createPaymentGate(cfg);
  app.use((req, res, next) => {
    const route = cfg.routes[`${req.method.toUpperCase()} ${req.path}`];
    if (!route || route.free || route.priceUsd <= 0) return paymentGate(req, res, next);
    const network = getNetwork((req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer");
    const provider = cfg.X402_MOCK ? "mock" : network.paymentProvider;
    const signed = Boolean(req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT"));
    const started = performance.now(); let recorded = false;
    const record = (success: boolean) => {
      if (recorded) return; recorded = true;
      recordPayment({ provider, network: network.caip2, phase: signed ? "verify_settle" : "challenge", durationMs: performance.now() - started, success, ...(signed && success ? { amountAtomic: String(Math.round(route.priceUsd * 1_000_000)) } : {}) });
    };
    res.once("finish", () => { if (!recorded) record(!signed ? res.statusCode === 402 : res.statusCode < 500 && res.statusCode !== 402); });
    return paymentGate(req, res, (error?: unknown) => { record(!error); return error ? next(error) : next(); });
  });

  for (const [path, days] of [["/v1/autopilot/pass/24h", 1], ["/v1/autopilot/pass/7d", 7], ["/v1/autopilot/pass/30d", 30]] as const) {
    app.post(path, async (req, res, next) => {
      try {
        const parsed = AutopilotPassBodySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
        const network = ((req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer");
        if (network === "arc-testnet") return res.status(422).json({ error: "Autopilot is not available on Arc Testnet" });
        const payer = paymentPayer(req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT"));
        if (!cfg.X402_MOCK && (!payer || payer !== parsed.data.owner.toLowerCase())) return res.status(403).json({ error: "The paying wallet must own the selected Autopilot" });
        const aiPass = await grantAutopilotPass({ owner: parsed.data.owner, network, vault: parsed.data.vault, days, ...(parsed.data.telegramDelivery && isTelegramDeliveryCapability(parsed.data.telegramDelivery) ? { telegramDelivery: parsed.data.telegramDelivery } : {}) });
        return res.status(201).json({ aiPass, behavior: { newEntries: "AI-assisted while the pass is active and signals remain", expired: "Hold new entries; deterministic risk monitoring and exits continue" } });
      } catch (error) { return next(error); }
    });
  }

  const grokCfg = {
    apiKey: cfg.XAI_API_KEY,
    baseUrl: cfg.XAI_BASE_URL,
    model: cfg.GROK_MODEL,
  };
  const isArc = (req: express.Request) => (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey === "arc-testnet";
  const modelLimits = (tier: "standard" | "premium") => ({
    maxInputTokens: tier === "premium" ? cfg.GROK_MAX_INPUT_PREMIUM : cfg.GROK_MAX_INPUT_STANDARD,
    maxOutputTokens: spotOutputTokenLimit(tier === "premium" ? "premium" : "base", tier === "premium" ? cfg.GROK_MAX_OUTPUT_PREMIUM : cfg.GROK_MAX_OUTPUT_STANDARD),
    reasoningEffort: tier === "premium" ? cfg.GROK_REASONING_PREMIUM : cfg.GROK_REASONING_STANDARD,
  });
  const predictionModelLimits = (tier: "standard" | "premium") => ({
    maxInputTokens: tier === "premium" ? cfg.GROK_MAX_INPUT_PREDICTION_PREMIUM : cfg.GROK_MAX_INPUT_PREDICTION_STANDARD,
    maxOutputTokens: tier === "premium" ? cfg.GROK_MAX_OUTPUT_PREDICTION_PREMIUM : cfg.GROK_MAX_OUTPUT_PREDICTION_STANDARD,
    reasoningEffort: tier === "premium" ? cfg.GROK_REASONING_PREMIUM : cfg.GROK_REASONING_STANDARD,
  });
  const reserveArcAi = async (req: express.Request, tier: "standard" | "premium", limits = modelLimits(tier)) => {
    if (!isArc(req) || cfg.ARC_AI_MODE !== "live") return;
    const wallet = paymentPayer(req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT"))
      || (req as express.Request & { pulseJobPayer?: string }).pulseJobPayer;
    if (!wallet) throw new Error("Arc live AI requires a decodable payer address in the payment authorization");
    const estimatedCostMicrousd = Math.ceil(limits.maxInputTokens * cfg.XAI_INPUT_COST_PER_MILLION_USD + limits.maxOutputTokens * cfg.XAI_OUTPUT_COST_PER_MILLION_USD);
    await arcBudget.reserve({ wallet, ip: req.ip || req.socket.remoteAddress || "unknown", estimatedCostMicrousd });
  };

  const buildSpotReport = async (req: express.Request, body: z.infer<typeof AnalysisBodySchema>, tier: "base" | "premium", canonical: boolean, onContextReady?: () => Promise<void>) => {
      const market = await observeProvider("okx", "spot_context", () => loadSpotContext({
        instId: body.instId,
        timeframe: body.timeframe,
        candleLimit: tier === "premium" ? 120 : 80,
      }));
      await onContextReady?.();
      if (isArc(req) && cfg.ARC_AI_MODE === "fixture") {
        const fixtureAnalysis = body.lang === "zh"
          ? { headline: "Arc 测试现货分析", summary: "确定性测试输出用于验证 Arc 支付和报告交付链路，不调用 xAI。", confidence: 0, limitations: ["测试模式不进行市场推断。"], disclaimer: "测试数据 · 非财务建议 · 请自行研究" }
          : { headline: "Arc fixture spot analysis", summary: "Deterministic fixture output validates the Arc payment and delivery path without calling xAI.", confidence: 0, limitations: ["Fixture mode does not make a market inference."], disclaimer: "TEST FIXTURE · NFA / DYOR" };
        const fixture = {
          service: tier === "premium" ? "analysis_premium" : "analysis_base", tier, instId: body.instId,
          timeframe: body.timeframe, model: "fixture", lang: body.lang,
          market: { ticker: market.ticker, summary: market.summary, bar: market.bar, candleCount: market.candles.length, source: market.source },
          analysis: fixtureAnalysis,
          generatedAt: new Date().toISOString(), methodology_version: cfg.methodologyVersion,
          analysisProfile: { mode: "fixture", model: "fixture", reasoningEffort: "none" },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, fixture: true,
        };
        return canonical ? { ...fixture, service: `spot_analysis_${tier === "base" ? "standard" : "premium"}`, tier: tier === "base" ? "standard" : "premium" } : fixture;
      }
      if (!cfg.hasXaiKey) throw new Error("XAI_API_KEY not configured on server");
      const normalizedTier = tier === "premium" ? "premium" : "standard";
      await reserveArcAi(req, normalizedTier);
      const result = await observeProvider("xai", `spot_${normalizedTier}`, () => runPreparedSpotAnalysis(grokCfg, { ...body, tier, ...modelLimits(normalizedTier) }, market));
      if (result.usage) {
        const cost = estimateAiCostUsd(cfg, result.usage);
        recordAiUsage(result.usage.promptTokens, result.usage.completionTokens, cost, result.usage.cachedTokens, result.usage.reasoningTokens);
      }
      const selectedNetwork = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
      const defiChainId = selectedNetwork === "xlayer" ? "196" : selectedNetwork === "base" ? "8453" : selectedNetwork === "arbitrum" ? "42161" : null;
      const assetSymbol = body.instId.split("-")[0]?.trim().toUpperCase() || "";
      // Reuse the same identity-preserving chain aliases as Spot and
      // Autopilot. This makes BTC -> cbBTC and DOGE -> cbDOGE on Base visible
      // in DeFi without ever substituting an unrelated derivative.
      const defiAliases = defiChainId
        ? executionAssetAliases(assetSymbol, defiChainId)
        : [assetSymbol];
      let defiAsset = defiAliases[0] || assetSymbol;
      let defiTokenAddress = "";
      let opportunities: Awaited<ReturnType<typeof searchOkxDefiOpportunities>> = [];
      if (defiChainId && assetSymbol) {
        const tokenCandidates = await getOkxTradeTokens(cfg, defiChainId, assetSymbol, 100).catch(() => []);
        const bySymbol = new Map(tokenCandidates.map((token) => [token.symbol.toUpperCase(), token]));
        const executionToken = defiAliases.map((alias) => bySymbol.get(alias.toUpperCase())).find(Boolean);
        if (executionToken) {
          defiAsset = executionToken.symbol;
          defiTokenAddress = executionToken.address;
          opportunities = await searchOkxDefiOpportunities(cfg, executionToken.symbol, defiChainId, executionToken.address).catch(() => []);
        }
      }
      const technical = buildTechnicalStructure(market.candles);
      const executionPlan = buildSpotExecutionPlan({
        instId: body.instId,
        timeframe: market.bar,
        tier: normalizedTier,
        lastPrice: Number((market.ticker as { last?: unknown }).last || market.candles.at(-1)?.close || 0),
        analysis: result.analysis,
        technical,
      });
      const enhanced = {
        ...result,
        chart: { source: market.source, timeframe: market.bar, candles: market.candles },
        technical,
        executionPlan,
        defi: { network: selectedNetwork, chainId: defiChainId, requestedAsset: assetSymbol, asset: defiAsset, tokenAddress: defiTokenAddress || null, aliasesChecked: [...new Set(defiAliases.filter(Boolean))], status: opportunities.length ? "live_verified_contract" : defiTokenAddress ? "no_verified_opportunity" : "no_identity_safe_chain_asset", observedAt: new Date().toISOString(), opportunities, explanation: body.lang === "zh"
          ? opportunities.length
            ? `${assetSymbol} 在 ${selectedNetwork} 上由 ${defiAsset}（${defiTokenAddress}）表示。以下产品均与该标的代币合约精确匹配，并依据可执行性、退出支持、TVL、风险标记和已观测 APY 综合排序，而非仅按 APY 排序。`
            : defiTokenAddress
              ? `PULSE 已验证 ${defiAsset}（${defiTokenAddress}）是所选链上的对应资产，但没有使用该精确标的合约的 DeFi 产品通过验证。PULSE 不会虚构 APY。`
              : `检查 ${[...new Set(defiAliases.filter(Boolean))].join(", ")} 后，仍未验证到身份安全的 ${assetSymbol} 链上表示。PULSE 不会用流动性质押代币或无关衍生品替代。`
          : opportunities.length ? `${assetSymbol} is represented by ${defiAsset} (${defiTokenAddress}) on ${selectedNetwork}. Every product below was matched to that exact underlying token contract and ranked using execution availability, exit support, TVL, risk flags and observed APY—not APY alone.` : defiTokenAddress ? `PULSE verified ${defiAsset} (${defiTokenAddress}) as the selected-chain representation, but no DeFi product with that exact underlying contract passed verification. No APY is fabricated.` : `No identity-safe ${assetSymbol} representation was verified after checking ${[...new Set(defiAliases.filter(Boolean))].join(", ")}. PULSE will not substitute a liquid-staking token or unrelated derivative.` },
        reportVersion: cfg.methodologyVersion,
      };
      return canonical ? {
        ...enhanced,
        service: `spot_analysis_${tier === "base" ? "standard" : "premium"}`,
        tier: tier === "base" ? "standard" : "premium",
      } : enhanced;
  };

  const runSpot = async (req: express.Request, res: express.Response, tier: "base" | "premium") => {
    try {
      const body = AnalysisBodySchema.parse(req.body);
      return res.json(await buildSpotReport(req, body, tier, false));
    } catch (e) {
      return res.status(e instanceof z.ZodError ? 400 : 502).json({ error: String(e) });
    }
  };

  app.post("/v1/analysis/base", (req, res) => void runSpot(req, res, "base"));
  app.post("/v1/analysis/premium", (req, res) => void runSpot(req, res, "premium"));

  const acquireV5Job = async (
    req: express.Request,
    mode: "spot" | "prediction" | "fused" | "divergence" | "event-risk",
    tier: "standard" | "premium" | null,
  ) => {
    const authorization = String(req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT") || "settled-by-middleware");
    const authorizationId = requestHash(authorization);
    const payer = paymentPayer(authorization) || `payment:${authorizationId}`;
    const bodyHash = requestHash(req.body);
    const network = getNetwork((req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer");
    const payee = network.key === "arc-testnet" ? cfg.CIRCLE_GATEWAY_SELLER_ADDRESS : cfg.PAY_TO_ADDRESS;
    // Canonical V5 analysis uses server-fetched evidence only. Never persist a
    // deprecated browser screenshot in Redis merely because an old client sent it.
    const { chartImageBase64: _chart, chartImageMime: _chartMime, ...durableBody } =
      (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const telegramDelivery = String(req.header("PULSE-TELEGRAM-DELIVERY") || "").slice(0, 100);
    const durableInput = { ...durableBody, ...(telegramDelivery && isTelegramDeliveryCapability(telegramDelivery) ? { _telegramDelivery: telegramDelivery } : {}) };
    return persistence.jobs.acquire({
      idempotencyKey: paymentIdempotencyKey({
        network: network.caip2, provider: cfg.X402_MOCK ? "mock" : network.paymentProvider,
        authorizationId, payer, payee,
        amount: String(Math.round((cfg.routes[`POST ${req.path}`]?.priceUsd || 0) * 1_000_000)),
        asset: network.paymentAsset.address || cfg.X402_ASSET, resourceUrl: req.originalUrl.split("?")[0], requestHash: bodyHash, mode, tier,
      }),
      requestHash: bodyHash, resourceUrl: req.originalUrl.split("?")[0], network: network.caip2, mode, tier,
      payer, input: durableInput,
      networkKey: network.key,
      requesterIp: req.ip || req.socket.remoteAddress || "unknown",
      maxRegenerationAttempts: cfg.PAID_REGENERATION_MAX_ATTEMPTS,
    });
  };
  const settlementTransaction = (header: string): string | undefined => {
    try {
      const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<string, unknown>;
      const candidates = [parsed.transaction, parsed.txHash, parsed.transactionHash, parsed.hash];
      return candidates.find((value): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value));
    } catch { return undefined; }
  };
  const receiptFor = (req: express.Request, res: express.Response, mode: string, tier: string | null): PaymentReceipt => {
    const authorization = String(req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT") || "settled-by-middleware");
    const inline = (req as SettlementRequest).pulseSettlement;
    const settlementHeader = res.getHeader("PAYMENT-RESPONSE");
    const settlement = typeof settlementHeader === "string" ? settlementHeader : authorization;
    const authorizationId = requestHash(authorization);
    const payer = paymentPayer(authorization) || `payment:${authorizationId}`;
    const network = getNetwork((req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer");
    const amountAtomic = String(Math.round((cfg.routes[`POST ${req.path}`]?.priceUsd || 0) * 1_000_000));
    const at = new Date().toISOString();
    const verifiedAt = inline?.verifiedAt || at;
    const settledAt = inline?.settledAt || at;
    const settlementTx = typeof inline?.result.transaction === "string"
      ? inline.result.transaction
      : settlementTransaction(settlement);
    const settlementMode = cfg.X402_MOCK ? "mock" : network.key === "arc-testnet" ? "gateway_batch" : "synchronous_onchain";
    const finality = cfg.X402_MOCK
      ? { status: "simulated" as const, scope: "mock" as const }
      : network.key === "arc-testnet"
        ? { status: "gateway_batch_accepted" as const, scope: "gateway" as const }
        : network.key === "arbitrum"
          ? { status: "facilitator_confirmed" as const, scope: "l2" as const, parentChainStatus: "unknown" as const }
          : { status: "facilitator_confirmed" as const, scope: "l1" as const };
    recordJob("payment_settled", network.caip2);
    return Object.freeze({
      id: requestHash(settlement), provider: cfg.X402_MOCK ? "mock" : network.paymentProvider,
      network: network.caip2, chainId: network.chainId, asset: network.paymentAsset.address || cfg.X402_ASSET, amountAtomic,
      payer, payee: network.key === "arc-testnet" ? cfg.CIRCLE_GATEWAY_SELLER_ADDRESS : cfg.PAY_TO_ADDRESS,
      authorizationId, resourceUrl: req.originalUrl.split("?")[0], requestHash: requestHash(req.body),
      verificationResult: "accepted_by_middleware", settlementResult: "settled",
      settlementMode, finality,
      ...(settlementTx ? { settlementTx } : {}),
      createdAt: verifiedAt, verifiedAt, settledAt,
    });
  };
  const aiControls = (req: express.Request, tier: "standard" | "premium") => ({
    fixture: isArc(req) && cfg.ARC_AI_MODE === "fixture",
    ...modelLimits(tier),
  });
  const withReceiptBoundRegeneration = <T>(jobId: string, operation: () => Promise<T>) =>
    runReceiptBoundOperation(persistence.jobs, jobId, cfg.PAID_REGENERATION_MAX_ATTEMPTS, operation);
  const aiCost = (analysis: { usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number; reasoningTokens?: number } }) => {
    const usage = analysis.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 };
    const configured = cfg.XAI_INPUT_COST_PER_MILLION_USD > 0 || cfg.XAI_OUTPUT_COST_PER_MILLION_USD > 0;
    const estimatedCostUsd = estimateAiCostUsd(cfg, usage);
    recordAiUsage(usage.promptTokens, usage.completionTokens, estimatedCostUsd, usage.cachedTokens || 0, usage.reasoningTokens || 0);
    return { ...usage, cachedTokens: usage.cachedTokens || 0, reasoningTokens: usage.reasoningTokens || 0, estimatedCostUsd, pricingConfigured: configured };
  };
  const respondToQueuedJobFailure = async (
    res: express.Response,
    error: unknown,
    jobId: string,
  ) => {
    const detail = error instanceof Error ? error.message : String(error);
    const connectivityFailure = isKvUnavailableError(error) || isTransientConnectivityError(error);
    if (jobId) {
      try {
        await persistence.jobs.transition(jobId, "failed_retriable", detail);
        recordReport("failed");
      } catch (persistenceError) {
        // The durable record remains recoverable by its idempotency key. Do not
        // let a second KV failure escape an Express 4 async request and kill Node.
        console.warn("[jobs] failure state will reconcile after persistence reconnects", {
          jobId,
          reason: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
        });
      }
    }
    if (res.headersSent) return;
    if (connectivityFailure) res.setHeader("Retry-After", "5");
    return res.status(error instanceof z.ZodError ? 400 : connectivityFailure ? 503 : 502).json({
      error: detail,
      ...(jobId ? { jobId, paymentReplaySafe: true } : {}),
      ...(connectivityFailure ? {
        code: "DEPENDENCY_CONNECTIVITY_LOSS",
        recoverable: true,
        retryAfterSeconds: 5,
      } : {}),
    });
  };

  const runSpotJob = async (req: express.Request, res: express.Response, tier: "standard" | "premium") => {
    let jobId = "";
    try {
      const body = AnalysisBodySchema.parse(req.body);
      const acquired = await acquireV5Job(req, "spot", tier);
      jobId = acquired.job.id;
      if (!acquired.created) { recordReport("recovered"); return res.status(202).json({ job: publicJobView(acquired.job), replay: true }); }
      await persistence.jobs.transition(jobId, "payment_verified");
      await persistence.jobs.transition(jobId, "payment_settled");
      await persistence.jobs.bindReceiptAndEnqueue(jobId, receiptFor(req, res, "spot", tier));
      const accepted = await persistence.jobs.get(jobId);
      res.status(202).json({ job: publicJobView(accepted!), recoveryToken: acquired.recoveryToken, pollUrl: `/v1/jobs/${jobId}` });
      wakeWorker();
      return;
    } catch (error) {
      return respondToQueuedJobFailure(res, error, jobId);
    }
  };

  app.post("/v1/analysis/spot/standard", (req, res) => void runSpotJob(req, res, "standard"));
  app.post("/v1/analysis/spot/premium", (req, res) => void runSpotJob(req, res, "premium"));

  const runPrediction = async (req: express.Request, res: express.Response, tier: "standard" | "premium") => {
    let jobId = "";
    try {
      const body = PredictionAnalysisRequestSchema.parse(req.body);
      const acquired = await acquireV5Job(req, "prediction", tier);
      jobId = acquired.job.id;
      if (!acquired.created) { recordReport("recovered"); return res.status(202).json({ job: publicJobView(acquired.job), replay: true }); }
      await persistence.jobs.transition(jobId, "payment_verified");
      await persistence.jobs.transition(jobId, "payment_settled");
      await persistence.jobs.bindReceiptAndEnqueue(jobId, receiptFor(req, res, "prediction", tier));
      const accepted = await persistence.jobs.get(jobId);
      res.status(202).json({ job: publicJobView(accepted!), recoveryToken: acquired.recoveryToken, pollUrl: `/v1/jobs/${jobId}` });
      wakeWorker();
      return;
    } catch (error) {
      return respondToQueuedJobFailure(res, error, jobId);
    }
  };

  if (cfg.FEATURE_PREDICTION_ANALYSIS) {
    app.post("/v1/analysis/prediction/standard", (req, res) => void runPrediction(req, res, "standard"));
    app.post("/v1/analysis/prediction/premium", (req, res) => void runPrediction(req, res, "premium"));
  }

  const timeframeHours = (timeframe: string) => ({ "1m": 1 / 60, "5m": 1 / 12, "15m": 0.25, "1H": 1, "1h": 1, "4H": 4, "4h": 4, "1D": 24, "1d": 24, "1W": 168, "1w": 168 }[timeframe] ?? 1);
  const prepareFused = async (body: z.infer<typeof FusedAnalysisRequestSchema>, tier: "standard" | "premium") => {
    const [market, predictionContext] = await Promise.all([
      observeProvider("okx", "spot_context", () => loadSpotContext({ instId: body.instId, timeframe: body.timeframe, candleLimit: tier === "premium" ? 120 : 80 })),
      preparePredictionContext({
        ...body, source: polymarket,
        maxSelected: tier === "premium" ? cfg.POLYMARKET_PREMIUM_MAX_SELECTED : cfg.POLYMARKET_STANDARD_MAX_SELECTED,
      }),
    ]);
    const primaryFeatures = predictionContext.markets[0]?.outcomes[0]?.features;
    if (!primaryFeatures) throw new Error("Primary prediction-market outcome features are unavailable");
    const fusion = calculateFusionFeatures({
      spotChangePct: market.summary?.changePct ?? 0,
      spotTimeframeHours: timeframeHours(body.timeframe),
      prediction: primaryFeatures,
    });
    return { market, predictionContext, fusion };
  };

  const runFused = async (req: express.Request, res: express.Response, tier: "standard" | "premium") => {
    let jobId = "";
    try {
      const body = FusedAnalysisRequestSchema.parse(req.body);
      const acquired = await acquireV5Job(req, "fused", tier);
      jobId = acquired.job.id;
      if (!acquired.created) { recordReport("recovered"); return res.status(202).json({ job: publicJobView(acquired.job), replay: true }); }
      await persistence.jobs.transition(jobId, "payment_verified");
      await persistence.jobs.transition(jobId, "payment_settled");
      await persistence.jobs.bindReceiptAndEnqueue(jobId, receiptFor(req, res, "fused", tier));
      const accepted = await persistence.jobs.get(jobId);
      res.status(202).json({ job: publicJobView(accepted!), recoveryToken: acquired.recoveryToken, pollUrl: `/v1/jobs/${jobId}` });
      wakeWorker();
      return;
    } catch (error) {
      return respondToQueuedJobFailure(res, error, jobId);
    }
  };

  if (cfg.FEATURE_FUSED_ANALYSIS) {
    app.post("/v1/analysis/fused/standard", (req, res) => void runFused(req, res, "standard"));
    app.post("/v1/analysis/fused/premium", (req, res) => void runFused(req, res, "premium"));
  }

  if (cfg.FEATURE_DIVERGENCE_ANALYSIS) {
    app.post("/v1/analysis/divergence", async (req, res) => {
      let jobId = "";
      try {
        const body = DivergenceAnalysisRequestSchema.parse(req.body);
        const acquired = await acquireV5Job(req, "divergence", null);
        jobId = acquired.job.id;
        if (!acquired.created) { recordReport("recovered"); return res.status(202).json({ job: publicJobView(acquired.job), replay: true }); }
        await persistence.jobs.transition(jobId, "payment_verified");
        await persistence.jobs.transition(jobId, "payment_settled");
        await persistence.jobs.bindReceiptAndEnqueue(jobId, receiptFor(req, res, "divergence", null));
        const accepted = await persistence.jobs.get(jobId);
        res.status(202).json({ job: publicJobView(accepted!), recoveryToken: acquired.recoveryToken, pollUrl: `/v1/jobs/${jobId}` });
        wakeWorker();
        return;
      } catch (error) {
        return respondToQueuedJobFailure(res, error, jobId);
      }
    });
  }

  if (cfg.FEATURE_EVENT_RISK_ANALYSIS) {
    app.post("/v1/preflight/event-risk", async (req, res) => {
      let jobId = "";
      try {
        const body = EventRiskPreflightRequestSchema.parse(req.body);
        const acquired = await acquireV5Job(req, "event-risk", null);
        jobId = acquired.job.id;
        if (!acquired.created) { recordReport("recovered"); return res.status(202).json({ job: publicJobView(acquired.job), replay: true }); }
        await persistence.jobs.transition(jobId, "payment_verified");
        await persistence.jobs.transition(jobId, "payment_settled");
        await persistence.jobs.bindReceiptAndEnqueue(jobId, receiptFor(req, res, "event-risk", null));
        const accepted = await persistence.jobs.get(jobId);
        res.status(202).json({ job: publicJobView(accepted!), recoveryToken: acquired.recoveryToken, pollUrl: `/v1/jobs/${jobId}` });
        wakeWorker();
        return;
      } catch (error) {
        return respondToQueuedJobFailure(res, error, jobId);
      }
    });
  }

  const jobRequest = (job: AnalysisJob): express.Request => ({
    pulseNetworkKey: job.networkKey,
    pulseJobPayer: job.payer,
    ip: job.requesterIp,
    socket: { remoteAddress: job.requesterIp },
    header: () => undefined,
  } as unknown as express.Request);

  const executePersistedJob = async (claimed: AnalysisJob) => {
    const current = await persistence.jobs.get(claimed.id);
    if (!current || current.reportId || current.stage === "completed" || current.stage === "completed_partial") return;
    if (!current.receiptId || current.receipt?.settlementResult !== "settled") {
      await persistence.jobs.transition(current.id, "manual_reconciliation", "worker refused an item without a settled receipt");
      throw new Error("Durable worker requires a settled receipt");
    }
    const req = jobRequest(current);
    const tier = current.tier || "standard";
    try {
      await persistence.jobs.transition(current.id, "fetching_context", "claimed by durable worker");
      let report: unknown;
      let partial = false;

      if (current.mode === "spot") {
        const body = AnalysisBodySchema.parse(current.input);
        report = await withReceiptBoundRegeneration(current.id, () => buildSpotReport(
          req, body, tier === "premium" ? "premium" : "base", true,
          async () => {
            await persistence.jobs.transition(current.id, "calculating_features");
            await persistence.jobs.transition(current.id, "generating_analysis");
          },
        ));
      } else if (current.mode === "prediction") {
        const body = PredictionAnalysisRequestSchema.parse(current.input);
        const context = await preparePredictionContext({
          ...body, source: polymarket,
          maxSelected: tier === "premium" ? cfg.POLYMARKET_PREMIUM_MAX_SELECTED : cfg.POLYMARKET_STANDARD_MAX_SELECTED,
        });
        await persistence.jobs.transition(current.id, "calculating_features");
        await persistence.jobs.transition(current.id, "generating_analysis");
        const analysis = await withReceiptBoundRegeneration(current.id, async () => {
          const limits = predictionModelLimits(tier);
          await reserveArcAi(req, tier, limits);
          return observeProvider("xai", `prediction_${tier}`, () => runPreparedV5Analysis(grokCfg, {
            mode: "prediction", tier, lang: body.lang, context, userNote: body.userNote,
            fixture: isArc(req) && cfg.ARC_AI_MODE === "fixture", ...limits,
          }));
        });
        const predictionReport = PredictionAnalysisResponseSchema.parse({
          service: `prediction_analysis_${tier}`, tier, predictionContext: context, analysis, aiCost: aiCost(analysis),
          analysisProfile: { mode: isArc(req) && cfg.ARC_AI_MODE === "fixture" ? "fixture" : "live", model: isArc(req) && cfg.ARC_AI_MODE === "fixture" ? "fixture" : cfg.GROK_MODEL, reasoningEffort: predictionModelLimits(tier).reasoningEffort },
          methodology_version: "pulse-v3.0.0", generatedAt: new Date().toISOString(),
        });
        if (tier === "premium") {
          const searchable = JSON.stringify(context).toUpperCase();
          const symbol = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"].find((candidate) => new RegExp(`\\b${candidate}\\b`).test(searchable));
          if (symbol) {
            const underlying = await observeProvider("okx", "prediction_underlying_4h", () => loadSpotContext({ instId: `${symbol}-USDT`, timeframe: "4H", candleLimit: 120 }));
            report = { ...predictionReport, underlyingSpot: { instId: `${symbol}-USDT`, timeframe: "4H", chart: { source: underlying.source, candles: underlying.candles }, technical: buildTechnicalStructure(underlying.candles), explanation: body.lang === "zh" ? "与预测问题所指资产对应的独立 OKX 现货 4 小时结构。它提供市场背景，但不会取代预测市场的概率证据。" : "Independent 4H OKX spot structure for the asset referenced by the prediction question. It provides market context and does not replace prediction-market probability evidence." } };
          } else report = { ...predictionReport, underlyingSpot: { status: "unmapped", explanation: body.lang === "zh" ? "无法可靠映射受支持的标的资产；PULSE 未附加无关图表。" : "No supported underlying asset could be mapped confidently; PULSE did not attach an unrelated chart." } };
        } else report = predictionReport;
        partial = context.partial;
      } else if (current.mode === "fused") {
        const body = FusedAnalysisRequestSchema.parse(current.input);
        const prepared = await prepareFused(body, tier);
        await persistence.jobs.transition(current.id, "calculating_features");
        await persistence.jobs.transition(current.id, "generating_analysis");
        const analysis = await withReceiptBoundRegeneration(current.id, async () => {
          await reserveArcAi(req, tier);
          return observeProvider("xai", `fused_${tier}`, () => runPreparedV5Analysis(grokCfg, {
            mode: "fused", tier, lang: body.lang, userNote: body.userNote,
            context: buildFusedAiContext(prepared),
            ...aiControls(req, tier),
            ...(tier === "standard" ? { maxInputTokens: cfg.GROK_MAX_INPUT_FUSED_STANDARD } : {}),
          }));
        });
        report = FusedAnalysisResponseSchema.parse({
          service: `fused_analysis_${tier}`, tier, instId: body.instId, timeframe: body.timeframe,
          ...prepared, analysis, aiCost: aiCost(analysis), methodology_version: "pulse-v3.0.0", generatedAt: new Date().toISOString(),
          analysisProfile: { mode: isArc(req) && cfg.ARC_AI_MODE === "fixture" ? "fixture" : "live", model: isArc(req) && cfg.ARC_AI_MODE === "fixture" ? "fixture" : cfg.GROK_MODEL, reasoningEffort: modelLimits(tier).reasoningEffort },
        });
        partial = prepared.predictionContext.partial;
      } else if (current.mode === "divergence") {
        const body = DivergenceAnalysisRequestSchema.parse(current.input);
        const prepared = await prepareFused(body, "standard");
        await persistence.jobs.transition(current.id, "calculating_features");
        report = DivergenceAnalysisResponseSchema.parse({
          service: "divergence_analysis", instId: body.instId, timeframe: body.timeframe,
          ...prepared, methodology_version: "pulse-v3.0.0", generatedAt: new Date().toISOString(),
          analysisProfile: { mode: "deterministic", model: "none", reasoningEffort: "none" },
        });
        partial = prepared.predictionContext.partial;
      } else {
        const body = EventRiskPreflightRequestSchema.parse(current.input);
        const predictionContext = await preparePredictionContext({
          ...body, source: polymarket, maxSelected: cfg.POLYMARKET_STANDARD_MAX_SELECTED,
        });
        await persistence.jobs.transition(current.id, "calculating_features");
        const feature = predictionContext.markets[0]?.outcomes[0]?.features;
        if (!feature) throw new Error("Primary event-risk features are unavailable");
        const reasons: string[] = [];
        let score = 0;
        if (feature.stale) { score += 25; reasons.push("Primary order book is stale."); }
        if (feature.spreadQuality === "low" || feature.spreadQuality === "unknown") { score += 20; reasons.push("Executable spread quality is weak."); }
        if (feature.depthQuality === "low" || feature.depthQuality === "unknown") { score += 20; reasons.push("Order-book depth is weak."); }
        if (Math.abs(feature.probabilityChange ?? 0) >= 0.1) { score += 25; reasons.push("Market-implied probability moved materially during the observed window."); }
        if (predictionContext.partial) { score += 10; reasons.push("Prediction context is partial."); }
        score = Math.min(100, score);
        const verdict = score >= 60 ? "FAIL" : score >= 25 ? "WARN" : "PASS";
        if (!reasons.length) reasons.push("No material selected-event warning was detected from supplied market data.");
        report = EventRiskPreflightResponseSchema.parse({
          service: "event_risk_preflight", predictionContext, eventRisk: { verdict, score, reasons },
          methodology_version: "pulse-v3.0.0", generatedAt: new Date().toISOString(),
          analysisProfile: { mode: "deterministic", model: "none", reasoningEffort: "none" },
        });
        partial = predictionContext.partial;
      }

      await persistence.jobs.transition(current.id, "validating_report");
      const stored = await persistence.reports.save(current.payer, report);
      const telegramDelivery = typeof (current.input as Record<string, unknown>)._telegramDelivery === "string" ? String((current.input as Record<string, unknown>)._telegramDelivery) : "";
      if (telegramDelivery && cfg.REPORT_SHARE_LINK_ENABLED) {
        try { const share=await persistence.reports.createShare(stored.id);const reportRecord=report as {analysis?:{headline?:unknown;summary?:unknown};service?:unknown};const headline=String(reportRecord.analysis?.headline||reportRecord.service||"PULSE report ready");const summary=String(reportRecord.analysis?.summary||"Your paid report completed successfully.");await deliverTelegramReportDurably(current.id,telegramDelivery,`${headline}\n\n${summary}`,`${cfg.BASE_URL.replace(/\/$/,"")}/v1/shared/reports/${share.token}`); }
        catch(error){console.error("Telegram report delivery failed",error);}
      }
      const completed = await persistence.jobs.attachReport(current.id, stored.id, partial);
      recordJob(completed.stage, completed.network);
      recordReport(partial ? "partial" : "completed");
    } catch (error) {
      const latest = await persistence.jobs.get(current.id);
      if (latest?.stage !== "manual_reconciliation") {
        const failed = await persistence.jobs.transition(current.id, "failed_terminal", error instanceof Error ? error.message : String(error));
        recordJob(failed.stage, failed.network);
      } else {
        recordJob("manual_reconciliation", current.network);
      }
      recordReport("failed");
      throw error;
    }
  };

  durableWorker = new DurableJobWorker(
    persistence.jobs,
    cfg.JOB_WORKER_CONCURRENCY,
    executePersistedJob,
  );
  if (shouldRunDurableWorker) {
    void durableWorker.start().catch((error) => console.error("Durable job worker failed to start", error));
  }

  const mv = cfg.methodologyVersion;

  const buildPaidTokenRisk = async (req: express.Request, address: string, lang: "en" | "zh") => {
    const key = (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
    const network = getNetwork(key);
    const evidence = cfg.NODE_ENV === "test"
      ? { observedAt: new Date().toISOString(), network: { key, label: network.label, chainId: String(network.chainId) }, tokenAddress: address.toLowerCase(), sources: [{ source: key === "xlayer" ? "OKX Onchain OS" : "Blockscout API", status: "observed", data: { testFixture: true } }], onchainAuthority: key === "xlayer" ? "OKX Onchain OS API" : "Blockscout API", sourcePolicy: "Test fixture" }
      : await collectTokenRiskEvidence({ cfg, networkKey: key, network, address });

    let ai: Awaited<ReturnType<typeof runGrokTokenRiskAnalysis>> | null = null;
    if (cfg.hasXaiKey) {
      ai = await observeProvider("xai", "token_risk", () => runGrokTokenRiskAnalysis(grokCfg, { evidence, lang, maxOutputTokens: cfg.GROK_MAX_OUTPUT_STANDARD }));
      if (ai.usage) {
        const cost = estimateAiCostUsd(cfg, ai.usage);
        recordAiUsage(ai.usage.promptTokens, ai.usage.completionTokens, cost, ai.usage.cachedTokens, 0);
      }
    } else if (cfg.NODE_ENV !== "test") {
      throw new Error("XAI_API_KEY is required for the paid Token Risk report");
    }

    const fixtureScan = cfg.NODE_ENV === "test" ? scanToken(address, String(network.chainId), mv) : null;
    const analysis = ai?.analysis || {
      headline: `TEST FIXTURE · ${fixtureScan?.symbol || "Token"} token risk`, summary: "Deterministic test-only report; production requires Grok and live source collection.",
      riskScore: fixtureScan?.riskScore || 0, confidence: 0,
      components: (fixtureScan?.components || []).slice(0, 5).map((component, index) => ({ ...component, key: ["contract", "market", "holders", "project", "promotion"][index] || component.key, evidence: ["Test fixture"] })),
      criticalRisks: fixtureScan?.flags || [], positiveSignals: [], unknowns: ["Live sources are disabled in the test fixture"],
      mostLikelyLossScenario: "Not evaluated in fixture mode.", recommendedAction: "Do not use fixture output for a real transaction.", maxExposurePct: 0,
      projectAssessment: "Not evaluated.", promotionAssessment: "Not evaluated.", disclaimer: "TEST FIXTURE · NFA / DYOR",
    };
    const score = Math.round(analysis.riskScore * 10) / 10;
    const verdict = scoreToVerdict(score);
    const grade = scoreToGrade(score);
    const evidenceSources = evidence.sources as Array<{ source: string; status: string; error?: string; data?: unknown }>;
    const sources = evidenceSources.map((source) => ({ name: source.source, status: source.status, detail: source.error || null }));
    const sourceData = (name: string) => evidenceSources.find((source) => source.source === name)?.data;
    const pairs = (sourceData("DexScreener pairs") || []) as Array<Record<string, unknown>>;
    const pair = pairs[0] || {};
    const pairToken = (pair.token || {}) as Record<string, unknown>;
    const okxTokens = (sourceData("OKX Onchain OS") || []) as Array<Record<string, unknown>>;
    const okxToken = okxTokens[0] || {};
    const blockToken = (sourceData("Blockscout token") || {}) as Record<string, unknown>;
    const verifiedContract = (sourceData("Blockscout verified contract") || {}) as Record<string, unknown>;
    const liquidityUsd = Number(((pair.liquidity as Record<string, unknown> | undefined)?.usd) ?? okxToken.liquidityUsd);
    const holders = Number(blockToken.holders ?? okxToken.holders);
    const pairCreatedAt = Number(pair.pairCreatedAt);
    const ageDays = Number.isFinite(pairCreatedAt) && pairCreatedAt > 0 ? Math.max(0, Math.floor((Date.now() - pairCreatedAt) / 86_400_000)) : null;
    const legacy = runPreflight({ intent: "generic", tokenAddress: address, chainId: String(network.chainId) as "196" | "1" | "56" | "137" | "8453" | "42161", lang }, mv);
    const token = {
      service: "token_scan", methodology_version: mv, chainId: String(network.chainId), address: address.toLowerCase(),
      symbol: String(blockToken.symbol || okxToken.symbol || pairToken.symbol || fixtureScan?.symbol || "Unknown"),
      name: String(blockToken.name || okxToken.name || pairToken.name || fixtureScan?.name || "Unknown token"),
      riskScore: score, grade, verdict,
      components: analysis.components.map(({ evidence: _evidence, ...component }) => component), flags: analysis.criticalRisks,
      liquidityUsd: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
      holdersEstimate: Number.isFinite(holders) ? holders : null,
      contractAgeDays: ageDays,
      isVerified: typeof verifiedContract.isVerified === "boolean" ? verifiedContract.isVerified : null,
      limitations: [...analysis.unknowns, analysis.disclaimer],
      intelligence: analysis, generatedAt: new Date().toISOString(),
    };
    return {
      service: "preflight" as const, serviceName: "PULSE Token Risk Guard", methodology_version: mv,
      intent: "token_due_diligence", chainId: String(network.chainId), networkKey: key, network: network.caip2,
      address: address.toLowerCase(), overallScore: score, riskScore: score, grade, verdict, headline: analysis.headline,
      summary: analysis.summary, confidence: analysis.confidence,
      checklist: analysis.components.map((component) => ({ id: component.key, title: component.label, status: component.score >= 75 ? "pass" : component.score >= 45 ? "warn" : "fail", detail: component.reason, evidence: component.evidence })),
      token, intelligence: analysis, recommendations: [analysis.recommendedAction], mostLikelyLossScenario: analysis.mostLikelyLossScenario,
      sourceCoverage: sources, evidence, evidenceMethod: "OKX API on X Layer or Blockscout API on Base/Arbitrum + DexScreener market/social/promotion + bounded project website + Grok synthesis; no automatic RPC eth_call",
      analysisProfile: { mode: ai ? "live" : "fixture", model: ai?.model || "fixture", reasoningEffort: ai ? "low" : "none" },
      aiUsage: ai?.usage, shareId: legacy.shareId, limitations: analysis.unknowns, generatedAt: new Date().toISOString(),
    };
  };

  app.post("/v1/token/scan", async (req, res) => {
    try {
      const body = TokenScanRequestSchema.parse(req.body);
      const report = await buildPaidTokenRisk(req, body.address, body.lang);
      saveReport(report);
      res.json({ ...report.token, report });
    } catch (e) {
      res.status(e instanceof z.ZodError ? 400 : 502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/v1/wallet/scan", (req, res) => {
    try {
      const body = WalletScanRequestSchema.parse(req.body);
      res.json(scanWallet(body.address, body.chainId ?? "196", mv));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post("/v1/market/pulse", (req, res) => {
    try {
      const body = MarketPulseRequestSchema.parse(req.body);
      res.json(marketPulse({ ...body, methodologyVersion: mv }));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post("/v1/swap/quote", (req, res) => {
    try {
      const body = SwapQuoteRequestSchema.parse(req.body);
      res.json(swapQuote({ ...body, methodologyVersion: mv }));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post("/v1/preflight", async (req, res) => {
    try {
      const body = PreflightRequestSchema.parse(req.body);
      const inspectedAddress = body.tokenAddress || body.toToken || body.fromToken;
      if (!inspectedAddress) return res.status(400).json({ error: "Risk Guard requires an exact token contract address" });
      const report = await buildPaidTokenRisk(req, inspectedAddress, body.lang);
      saveReport(report);
      res.json(report);
    } catch (e) {
      res.status(e instanceof z.ZodError ? 400 : 502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  const mcp = createMcpHandler(cfg);
  app.all("/mcp", mcp);
  app.all("/mcp/", mcp);

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (isKvUnavailableError(err) || isTransientConnectivityError(err)) {
        const retryAfterSeconds = isKvUnavailableError(err) ? err.retryAfterSeconds : 5;
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return res.status(503).json({ error: "A remote dependency is temporarily unavailable", code: isKvUnavailableError(err) ? err.code : "DEPENDENCY_CONNECTIVITY_LOSS", recoverable: true, retryAfterSeconds });
      }
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
