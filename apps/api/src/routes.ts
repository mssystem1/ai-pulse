import { Router } from "express";
import type { AppConfig } from "@pulse/config";
import { priceLabel } from "@pulse/config";
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
import { getReport, listReports, saveReport } from "./store.js";

function parseOr400<T>(
  schema: { parse: (v: unknown) => T },
  body: unknown,
): T {
  return schema.parse(body);
}

export function createApiRouter(cfg: AppConfig): Router {
  const r = Router();
  const mv = () => cfg.methodologyVersion;

  r.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: cfg.productName,
      version: "1.0.0",
      mockPayments: cfg.X402_MOCK,
      network: cfg.X402_NETWORK,
    });
  });

  r.get("/v1/meta", (_req, res) => {
    res.json({
      name: cfg.productName,
      tagline: cfg.productTagline,
      methodology_version: cfg.methodologyVersion,
      network: cfg.X402_NETWORK,
      asset: cfg.X402_ASSET,
      mock: cfg.X402_MOCK,
      routes: Object.entries(cfg.routes).map(([route, info]) => ({
        route,
        price: priceLabel(info.priceUsd),
        priceUsd: info.priceUsd,
        free: Boolean(info.free),
        description: info.description,
      })),
      mcp: "/mcp",
      docs: "/v1/openapi.json",
    });
  });

  r.get("/v1/openapi.json", (_req, res) => {
    res.json(openApiDoc(cfg));
  });

  r.post("/v1/resolve", (req, res) => {
    try {
      const body = parseOr400(ResolveRequestSchema, req.body);
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

  r.post("/v1/token/scan", (req, res) => {
    try {
      const body = parseOr400(TokenScanRequestSchema, req.body);
      res.json(scanToken(body.address, body.chainId ?? "196", mv()));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  r.post("/v1/wallet/scan", (req, res) => {
    try {
      const body = parseOr400(WalletScanRequestSchema, req.body);
      res.json(scanWallet(body.address, body.chainId ?? "196", mv()));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  r.post("/v1/market/pulse", (req, res) => {
    try {
      const body = parseOr400(MarketPulseRequestSchema, req.body);
      res.json(marketPulse({ ...body, methodologyVersion: mv() }));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  r.post("/v1/swap/quote", (req, res) => {
    try {
      const body = parseOr400(SwapQuoteRequestSchema, req.body);
      res.json(swapQuote({ ...body, methodologyVersion: mv() }));
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  r.post("/v1/preflight", (req, res) => {
    try {
      const body = parseOr400(PreflightRequestSchema, req.body);
      const report = runPreflight(body, mv());
      saveReport(report);
      res.json(report);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  r.get("/v1/reports/:shareId", (req, res) => {
    const report = getReport(req.params.shareId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  });

  r.get("/v1/reports", (_req, res) => {
    res.json({ reports: listReports(30) });
  });

  return r;
}

function openApiDoc(cfg: AppConfig) {
  return {
    openapi: "3.0.3",
    info: {
      title: "PULSE API",
      version: "1.0.0",
      description: cfg.productTagline,
    },
    servers: [{ url: cfg.BASE_URL }],
    paths: {
      "/v1/resolve": { post: { summary: "Resolve token (free)" } },
      "/v1/token/scan": { post: { summary: "Token risk scan (x402)" } },
      "/v1/wallet/scan": { post: { summary: "Wallet risk scan (x402)" } },
      "/v1/market/pulse": { post: { summary: "Market pulse (x402)" } },
      "/v1/swap/quote": { post: { summary: "Swap quote quality (x402)" } },
      "/v1/preflight": { post: { summary: "Full preflight report (x402)" } },
      "/mcp": { post: { summary: "MCP Streamable HTTP" } },
    },
  };
}
