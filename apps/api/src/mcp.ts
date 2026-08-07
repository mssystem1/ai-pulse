import type { Request, Response } from "express";
import type { AppConfig } from "@pulse/config";
import { createMcpPaymentGate } from "@pulse/payments";
import { runGrokAnalysis } from "@pulse/analysis";
import { getTicker, searchSpotInstruments } from "@pulse/market";
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
import { saveReport } from "./store.js";

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: "spot_search",
    description: "Free: search OKX spot instruments",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "spot_ticker",
    description: "Free: live OKX spot ticker teaser",
    inputSchema: {
      type: "object",
      properties: { instId: { type: "string" } },
      required: ["instId"],
    },
  },
  {
    name: "analysis_base",
    description: "Paid $0.03: Grok base analysis grounded in live OKX spot OHLCV",
    inputSchema: {
      type: "object",
      properties: {
        instId: { type: "string" },
        timeframe: { type: "string" },
        lang: { type: "string", enum: ["en", "zh"] },
        userNote: { type: "string" },
      },
      required: ["instId"],
    },
  },
  {
    name: "analysis_premium",
    description: "Paid $0.06: Grok premium multi-scenario OKX spot analysis",
    inputSchema: {
      type: "object",
      properties: {
        instId: { type: "string" },
        timeframe: { type: "string" },
        lang: { type: "string", enum: ["en", "zh"] },
        userNote: { type: "string" },
      },
      required: ["instId"],
    },
  },
  {
    name: "token_scan",
    description: "Paid: token risk safety scan",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string" }, chainId: { type: "string" } },
      required: ["address"],
    },
  },
  {
    name: "preflight",
    description: "Paid: composite pre-trade safety check",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string" },
        tokenAddress: { type: "string" },
        fromToken: { type: "string" },
        toToken: { type: "string" },
        amount: { type: "string" },
        counterparty: { type: "string" },
      },
    },
  },
  {
    name: "resolve",
    description: "Free: resolve token metadata",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  ...["standard", "premium"].flatMap((tier) => [
    { name: `spot_analysis_${tier}`, description: `Paid: ${tier} OKX spot analysis`, inputSchema: { type: "object", properties: { instId: { type: "string" }, timeframe: { type: "string" }, lang: { type: "string", enum: ["en", "zh"] }, userNote: { type: "string" } }, required: ["instId"] } },
    { name: `prediction_analysis_${tier}`, description: `Paid: ${tier} selected-market prediction analysis`, inputSchema: { type: "object", properties: { primaryMarketId: { type: "string" }, additionalMarketIds: { type: "array", items: { type: "string" } }, lang: { type: "string", enum: ["en", "zh"] }, userNote: { type: "string" } }, required: ["primaryMarketId"] } },
    { name: `fused_analysis_${tier}`, description: `Paid: ${tier} fused spot and selected-market analysis`, inputSchema: { type: "object", properties: { instId: { type: "string" }, timeframe: { type: "string" }, primaryMarketId: { type: "string" }, additionalMarketIds: { type: "array", items: { type: "string" } }, lang: { type: "string", enum: ["en", "zh"] }, userNote: { type: "string" } }, required: ["instId", "primaryMarketId"] } },
  ]),
  { name: "divergence_analysis", description: "Paid: deterministic spot and selected-market divergence", inputSchema: { type: "object", properties: { instId: { type: "string" }, timeframe: { type: "string" }, primaryMarketId: { type: "string" }, additionalMarketIds: { type: "array", items: { type: "string" } } }, required: ["instId", "primaryMarketId"] } },
  { name: "event_risk_preflight", description: "Paid: selected prediction-market event-risk preflight", inputSchema: { type: "object", properties: { primaryMarketId: { type: "string" }, additionalMarketIds: { type: "array", items: { type: "string" } }, intent: { type: "string" } }, required: ["primaryMarketId"] } },
  { name: "job_status", description: "Free authenticated status read for a previously paid durable job; never pay again to poll", inputSchema: { type: "object", properties: { jobId: { type: "string" }, recoveryToken: { type: "string" } }, required: ["jobId", "recoveryToken"] } },
  { name: "job_report", description: "Free authenticated final-report retrieval for a previously paid durable job; never pay again to retrieve", inputSchema: { type: "object", properties: { jobId: { type: "string" }, recoveryToken: { type: "string" } }, required: ["jobId", "recoveryToken"] } },
];

const AnalysisArgs = z.object({
  instId: z.string(),
  timeframe: z.string().optional(),
  lang: z.enum(["en", "zh"]).optional(),
  userNote: z.string().optional(),
});

function availableTools(cfg: AppConfig) {
  return TOOLS.filter((tool) => {
    if (tool.name.startsWith("prediction_analysis_")) return cfg.FEATURE_PREDICTION_ANALYSIS;
    if (tool.name.startsWith("fused_analysis_")) return cfg.FEATURE_FUSED_ANALYSIS;
    if (tool.name === "divergence_analysis") return cfg.FEATURE_DIVERGENCE_ANALYSIS;
    if (tool.name === "event_risk_preflight") return cfg.FEATURE_EVENT_RISK_ANALYSIS;
    return true;
  });
}

export function createMcpHandler(cfg: AppConfig) {
  const gate = createMcpPaymentGate(cfg);
  const grokCfg = {
    apiKey: cfg.XAI_API_KEY,
    baseUrl: cfg.XAI_BASE_URL,
    model: cfg.GROK_MODEL,
  };

  return async function mcpHandler(req: Request, res: Response) {
    if (req.method === "GET") {
      return res.json({
        name: cfg.productName.toLowerCase(),
        version: "2.0.0",
        tools: availableTools(cfg).map((t) => t.name),
      });
    }

    const body = (req.body ?? {}) as JsonRpc;
    const id = body.id ?? null;
    const method = body.method ?? "";

    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: cfg.productName.toLowerCase(), version: "2.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: availableTools(cfg) } });
    }
    if (method === "notifications/initialized") return res.status(204).end();

    if (method === "tools/call") {
      const params = body.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const paymentSig =
        (req.header("PAYMENT-SIGNATURE") || req.header("payment-signature") || "") as string;

      const gated = gate(name, paymentSig);
      if (!gated.ok) {
        for (const [k, v] of Object.entries(gated.headers)) res.setHeader(k, v);
        return res.status(gated.status).json(gated.body);
      }

      try {
        const result = await dispatch(name, args, cfg, grokCfg, paymentSig);
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          },
        });
      } catch (err) {
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: err instanceof Error ? err.message : "Tool error" },
        });
      }
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  };
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  cfg: AppConfig,
  grokCfg: { apiKey: string; baseUrl: string; model: string },
  paymentSignature = "",
): Promise<unknown> {
  const mv = cfg.methodologyVersion;
  if (name === "job_status" || name === "job_report") {
    const jobId = z.string().uuid().parse(args.jobId);
    const recoveryToken = z.string().min(32).parse(args.recoveryToken);
    const suffix = name === "job_report" ? "/report" : "";
    const response = await fetch(`${cfg.BASE_URL.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(jobId)}${suffix}`, {
      headers: { "PULSE-RECOVERY-TOKEN": recoveryToken, Accept: "application/json" },
    });
    const result = await response.json() as unknown;
    if (!response.ok) throw new Error(`PULSE job read ${response.status}: ${JSON.stringify(result)}`);
    return result;
  }

  const legacyPaidRoute: Record<string, string> = {
    analysis_base: "/v1/analysis/base", analysis_premium: "/v1/analysis/premium",
    token_scan: "/v1/token/scan", wallet_scan: "/v1/wallet/scan", market_pulse: "/v1/market/pulse",
    swap_quote: "/v1/swap/quote", preflight: "/v1/preflight",
  };
  if (!cfg.X402_MOCK && cfg.paymentMode !== "mock" && legacyPaidRoute[name]) {
    const response = await fetch(`${cfg.BASE_URL.replace(/\/$/, "")}${legacyPaidRoute[name]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(paymentSignature ? { "PAYMENT-SIGNATURE": paymentSignature } : {}) },
      body: JSON.stringify(args),
    });
    const result = await response.json() as unknown;
    if (!response.ok) throw new Error(`PULSE REST ${response.status}: ${JSON.stringify(result)}`);
    return result;
  }
  switch (name) {
    case "spot_search": {
      const q = String(args.query ?? "");
      return { instruments: await searchSpotInstruments(q, 30) };
    }
    case "spot_ticker": {
      const instId = String(args.instId ?? "");
      return { ticker: await getTicker(instId) };
    }
    case "analysis_base": {
      const p = AnalysisArgs.parse(args);
      return runGrokAnalysis(grokCfg, { ...p, tier: "base" });
    }
    case "analysis_premium": {
      const p = AnalysisArgs.parse(args);
      return runGrokAnalysis(grokCfg, { ...p, tier: "premium" });
    }
    case "resolve": {
      const p = ResolveRequestSchema.parse(args);
      return {
        service: "resolve",
        query: p.query,
        matches: resolveQuery(p.query, p.chainId ?? "196"),
        generatedAt: new Date().toISOString(),
      };
    }
    case "token_scan": {
      const p = TokenScanRequestSchema.parse(args);
      return scanToken(p.address, p.chainId ?? "196", mv);
    }
    case "wallet_scan": {
      const p = WalletScanRequestSchema.parse(args);
      return scanWallet(p.address, p.chainId ?? "196", mv);
    }
    case "market_pulse": {
      const p = MarketPulseRequestSchema.parse(args);
      return marketPulse({ ...p, methodologyVersion: mv });
    }
    case "swap_quote": {
      const p = SwapQuoteRequestSchema.parse(args);
      return swapQuote({ ...p, methodologyVersion: mv });
    }
    case "preflight": {
      const p = PreflightRequestSchema.parse(args);
      const report = runPreflight(p, mv);
      saveReport(report);
      return report;
    }
    default:
      if (/^(spot|prediction|fused)_analysis_(standard|premium)$/.test(name) || name === "divergence_analysis" || name === "event_risk_preflight") {
        const route = name === "divergence_analysis" ? "/v1/analysis/divergence"
          : name === "event_risk_preflight" ? "/v1/preflight/event-risk"
            : `/v1/analysis/${name.replace("_analysis_", "/")}`;
        const response = await fetch(`${cfg.BASE_URL.replace(/\/$/, "")}${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(paymentSignature ? { "PAYMENT-SIGNATURE": paymentSignature } : {}) },
          body: JSON.stringify(args),
        });
        const result = await response.json() as unknown;
        if (!response.ok) throw new Error(`PULSE REST ${response.status}: ${JSON.stringify(result)}`);
        return result;
      }
      throw new Error(`Unknown tool: ${name}`);
  }
}
