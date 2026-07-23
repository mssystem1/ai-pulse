import express from "express";
import cors from "cors";
import morgan from "morgan";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { AppConfig } from "@pulse/config";
import { buildAspMetadata, priceLabel } from "@pulse/config";
import { createPaymentGate } from "@pulse/payments";
import { runGrokAnalysis } from "@pulse/analysis";
import {
  getCandles,
  getTicker,
  searchSpotInstruments,
  toOkxBar,
} from "@pulse/market";
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
import { inspectXLayerAddress } from "./contractInspect.js";
import { getXLayerTokenCatalog } from "./tokenCatalog.js";

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

export function createApp(cfg: AppConfig) {
  const app = express();
  app.set("trust proxy", true);
    
  app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));
  app.use(express.json({ limit: "12mb" }));
  app.use(morgan(cfg.NODE_ENV === "production" ? "combined" : "dev"));

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
      })),
      mcp: "/mcp",
      metadata: "/v1/metadata",
    });
  });

  app.get("/v1/metadata", (_req, res) => {
    res.json(buildAspMetadata(cfg));
  });

  // ── Free OKX spot teaser ──────────────────────────────────────────
  app.get("/v1/market/instruments", async (req, res) => {
    try {
      const q = String(req.query.q || "");
      const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
      const list = await searchSpotInstruments(q, limit);
      res.json({ service: "instruments", query: q, count: list.length, instruments: list });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  app.get("/v1/xlayer/tokens", async (req, res) => {
    try {
      const q = String(req.query.q || "").slice(0, 100);
      const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 60);
      const tokens = await getXLayerTokenCatalog(cfg, q, limit);
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
      const ticker = await getTicker(instId);
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
      const candles = await getCandles(instId, bar, limit);
      res.json({ service: "candles", free: true, instId, bar, candles });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  // ── Free funding helper: official OKX Exchange OS DEX API ─────────
  app.get("/v1/dex/quote", async (req, res) => {
    try {
      const amount = AtomicAmountSchema.parse(req.query.amount);
      res.json({ service: "okx_dex_quote", ...(await getOkbUsdt0Quote(cfg, amount)) });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/v1/dex/swap", async (req, res) => {
    try {
      const body = DexSwapBodySchema.parse(req.body);
      res.json({
        service: "okx_dex_swap",
        ...(await getOkbUsdt0Swap(
          cfg,
          body.amount,
          body.userWalletAddress,
          String(body.slippagePercent),
        )),
      });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Free factual evidence for any X Layer address. This deliberately does not invent a risk score.
  app.post("/v1/contract/inspect", async (req, res) => {
    try {
      const body = z.object({
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address"),
      }).parse(req.body);
      res.json(await inspectXLayerAddress(cfg.X_LAYER_RPC, body.address));
    } catch (e) {
      const validation = e instanceof z.ZodError;
      res.status(validation ? 400 : 502).json({
        error: validation ? e.issues[0]?.message || "Invalid request" : e instanceof Error ? e.message : String(e),
      });
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

  // Payment gate for paid routes
  app.use(createPaymentGate(cfg));

  const grokCfg = {
    apiKey: cfg.XAI_API_KEY,
    baseUrl: cfg.XAI_BASE_URL,
    model: cfg.GROK_MODEL,
  };

  app.post("/v1/analysis/base", async (req, res) => {
    try {
      if (!cfg.hasXaiKey) {
        return res.status(503).json({ error: "XAI_API_KEY not configured on server" });
      }
      const body = AnalysisBodySchema.parse(req.body);
      const result = await runGrokAnalysis(grokCfg, { ...body, tier: "base" });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.post("/v1/analysis/premium", async (req, res) => {
    try {
      if (!cfg.hasXaiKey) {
        return res.status(503).json({ error: "XAI_API_KEY not configured on server" });
      }
      const body = AnalysisBodySchema.parse(req.body);
      const result = await runGrokAnalysis(grokCfg, { ...body, tier: "premium" });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

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
