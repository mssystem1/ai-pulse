import express from "express";
import cors from "cors";
import morgan from "morgan";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createCircleWalletRouter } from "./circleWallet.js";
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
import { buildFusedAiContext, calculateFusionFeatures, isAnalyticsEligible, preparePredictionContext, runPreparedSpotAnalysis, runPreparedV5Analysis } from "@pulse/analysis";
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
import { getOkbUsdt0Quote, getOkbUsdt0Swap } from "./okxDex.js";
import { collectLiveContractEvidence, inspectEvmAddress, simulateEvmTransaction } from "./contractInspect.js";
import { getCdpNativeUsdcSwap } from "./cdpSwap.js";
import { getXLayerTokenCatalog } from "./tokenCatalog.js";
import { createPersistence, paymentIdempotencyKey, requestHash, runReceiptBoundOperation, verifyRecoveryToken, type AnalysisJob, type PaymentReceipt } from "./jobs.js";
import { DurableJobWorker } from "./jobWorker.js";
import { observeProvider, prometheusMetrics, recordAiUsage, recordJob, recordPayment, recordProvider, recordReport, setQueueDepth, telemetryMiddleware } from "./telemetry.js";
import { ArcBudgetExceededError, createArcBudgetStore, paymentPayer, type ArcBudgetStore } from "./arcBudget.js";

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

export function createApp(cfg: AppConfig, dependencies: {
  polymarket?: PolymarketClient;
  persistence?: ReturnType<typeof createPersistence>;
  arcBudget?: ArcBudgetStore;
  spotContext?: typeof buildMarketContext;
} = {}) {
  const app = express();
  const polymarket = dependencies.polymarket || new PolymarketClient({
    gammaUrl: cfg.POLYMARKET_GAMMA_URL,
    clobUrl: cfg.POLYMARKET_CLOB_URL,
    dataUrl: cfg.POLYMARKET_DATA_URL,
    observer: recordProvider,
  });
  const persistence = dependencies.persistence || createPersistence(cfg);
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

  app.get("/v1/jobs/:jobId", async (req, res) => {
    const job = await authorizedJob(req);
    if (job === null) return res.status(404).json({ error: "Job not found" });
    if (job === false) return res.status(403).json({ error: "Valid PULSE-RECOVERY-TOKEN required" });
    const report = job.reportId ? await persistence.reports.get(job.reportId) : null;
    return res.json({ job: publicJobView(job), ...(report ? { storedReport: privateRecordView(report) } : {}) });
  });

  app.get("/v1/jobs/:jobId/report", async (req, res) => {
    const job = await authorizedJob(req);
    if (job === null) return res.status(404).json({ error: "Job not found" });
    if (job === false) return res.status(403).json({ error: "Valid PULSE-RECOVERY-TOKEN required" });
    if (!job.reportId) return res.status(409).json({ error: "Report is not ready", stage: job.stage });
    const record = await persistence.reports.get(job.reportId);
    if (!record) return res.status(404).json({ error: "Stored report not found" });
    return res.json({ report: await persistence.reports.read(record), metadata: privateRecordView(record), job: publicJobView(job) });
  });

  app.get("/v1/private/reports/:reportId", async (req, res) => {
    const record = await persistence.reports.get(req.params.reportId);
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!reportOwner(req) || reportOwner(req) !== record.ownerWallet) return res.status(403).json({ error: "Report owner authorization required" });
    return res.json({ report: await persistence.reports.read(record), metadata: privateRecordView(record) });
  });

  app.post("/v1/private/reports/:reportId/shares", async (req, res) => {
    if (!cfg.REPORT_SHARE_LINK_ENABLED) return res.status(404).json({ error: "Report sharing disabled" });
    const record = await persistence.reports.get(req.params.reportId);
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!reportOwner(req) || reportOwner(req) !== record.ownerWallet) return res.status(403).json({ error: "Report owner authorization required" });
    const share = await persistence.reports.createShare(record.id);
    return res.status(201).json({ reportId: record.id, shareToken: share.token, shareUrl: `${cfg.BASE_URL.replace(/\/$/, "")}/v1/shared/reports/${share.token}` });
  });

  app.delete("/v1/private/reports/:reportId/shares/:shareToken", async (req, res) => {
    const record = await persistence.reports.get(req.params.reportId);
    if (!record) return res.status(404).json({ error: "Report not found" });
    if (!reportOwner(req) || reportOwner(req) !== record.ownerWallet) return res.status(403).json({ error: "Report owner authorization required" });
    const sharedRecord = await persistence.reports.resolveShare(req.params.shareToken);
    if (!sharedRecord || sharedRecord.id !== record.id) return res.status(404).json({ error: "Share not found" });
    await persistence.reports.revokeShare(req.params.shareToken);
    return res.status(204).end();
  });

  app.get("/v1/shared/reports/:shareToken", async (req, res) => {
    if (!cfg.REPORT_SHARE_LINK_ENABLED) return res.status(404).json({ error: "Report sharing disabled" });
    const record = await persistence.reports.resolveShare(req.params.shareToken);
    if (!record) return res.status(404).json({ error: "Share not found or revoked" });
    return res.json({ report: await persistence.reports.read(record), metadata: privateRecordView(record) });
  });

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
    if ((parsed.data.chainId ?? "196") !== "196") {
      return res.status(400).json(
        buildX402InputRequired("/v1/token/scan", [
          { path: ["chainId"], message: "Token Risk Scan is available on X Layer chain 196 only." },
        ]),
      );
    }
    req.body = parsed.data;
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

  const grokCfg = {
    apiKey: cfg.XAI_API_KEY,
    baseUrl: cfg.XAI_BASE_URL,
    model: cfg.GROK_MODEL,
  };
  const isArc = (req: express.Request) => (req as express.Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey === "arc-testnet";
  const modelLimits = (tier: "standard" | "premium") => ({
    maxInputTokens: tier === "premium" ? cfg.GROK_MAX_INPUT_PREMIUM : cfg.GROK_MAX_INPUT_STANDARD,
    maxOutputTokens: tier === "premium" ? cfg.GROK_MAX_OUTPUT_PREMIUM : cfg.GROK_MAX_OUTPUT_STANDARD,
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
        const fixture = {
          service: tier === "premium" ? "analysis_premium" : "analysis_base", tier, instId: body.instId,
          timeframe: body.timeframe, model: "fixture", lang: body.lang,
          market: { ticker: market.ticker, summary: market.summary, bar: market.bar, candleCount: market.candles.length, source: market.source },
          analysis: { headline: "Arc fixture spot analysis", summary: "Deterministic fixture output validates the Arc payment and delivery path without calling xAI.", confidence: 0, limitations: ["Fixture mode does not make a market inference."], disclaimer: "TEST FIXTURE · NFA / DYOR" },
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
      return canonical ? {
        ...result,
        service: `spot_analysis_${tier === "base" ? "standard" : "premium"}`,
        tier: tier === "base" ? "standard" : "premium",
      } : result;
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
    const { chartImageBase64: _chart, chartImageMime: _chartMime, ...durableInput } =
      (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
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
  let durableWorker: DurableJobWorker;
  const wakeWorker = () => {
    void durableWorker?.notify();
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
      if (jobId) { await persistence.jobs.transition(jobId, "failed_retriable", error instanceof Error ? error.message : String(error)); recordReport("failed"); }
      if (!res.headersSent) return res.status(error instanceof z.ZodError ? 400 : 502).json({ error: error instanceof Error ? error.message : String(error), ...(jobId ? { jobId } : {}) });
      return;
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
      if (jobId) { await persistence.jobs.transition(jobId, "failed_retriable", error instanceof Error ? error.message : String(error)); recordReport("failed"); }
      if (!res.headersSent) return res.status(error instanceof z.ZodError ? 400 : 502).json({ error: error instanceof Error ? error.message : String(error), ...(jobId ? { jobId } : {}) });
      return;
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
      if (jobId) { await persistence.jobs.transition(jobId, "failed_retriable", error instanceof Error ? error.message : String(error)); recordReport("failed"); }
      if (!res.headersSent) return res.status(error instanceof z.ZodError ? 400 : 502).json({ error: error instanceof Error ? error.message : String(error), ...(jobId ? { jobId } : {}) });
      return;
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
        if (jobId) { await persistence.jobs.transition(jobId, "failed_retriable", error instanceof Error ? error.message : String(error)); recordReport("failed"); }
        if (!res.headersSent) return res.status(error instanceof z.ZodError ? 400 : 502).json({ error: error instanceof Error ? error.message : String(error), ...(jobId ? { jobId } : {}) });
        return;
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
        if (jobId) { await persistence.jobs.transition(jobId, "failed_retriable", error instanceof Error ? error.message : String(error)); recordReport("failed"); }
        if (!res.headersSent) return res.status(error instanceof z.ZodError ? 400 : 502).json({ error: error instanceof Error ? error.message : String(error), ...(jobId ? { jobId } : {}) });
        return;
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
        report = PredictionAnalysisResponseSchema.parse({
          service: `prediction_analysis_${tier}`, tier, predictionContext: context, analysis, aiCost: aiCost(analysis),
          analysisProfile: { mode: isArc(req) && cfg.ARC_AI_MODE === "fixture" ? "fixture" : "live", model: isArc(req) && cfg.ARC_AI_MODE === "fixture" ? "fixture" : cfg.GROK_MODEL, reasoningEffort: predictionModelLimits(tier).reasoningEffort },
          methodology_version: "pulse-v3.0.0", generatedAt: new Date().toISOString(),
        });
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
  void durableWorker.start().catch((error) => console.error("Durable job worker failed to start", error));

  const mv = cfg.methodologyVersion;

  app.post("/v1/token/scan", (req, res) => {
    try {
      const body = TokenScanRequestSchema.parse(req.body);
      res.json(scanToken(body.address, body.chainId ?? "196", mv));
    } catch (e) {
      res.status(400).json({ error: String(e) });
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

  app.post("/v1/preflight", (req, res) => {
    try {
      const body = PreflightRequestSchema.parse(req.body);
      const report = runPreflight(body, mv);
      saveReport(report);
      res.json(report);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  const mcp = createMcpHandler(cfg);
  app.all("/mcp", mcp);
  app.all("/mcp/", mcp);

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
