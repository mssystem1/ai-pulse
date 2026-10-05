import type { Request, Response } from "express";
import { priceLabel, type AppConfig } from "@pulse/config";
import { createMcpPaymentGate } from "@pulse/payments";
import { runGrokAnalysis } from "@pulse/analysis";
import { searchSpotInstruments } from "@pulse/market";
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
  FusedAnalysisRequestSchema,
  DivergenceAnalysisRequestSchema,
  EventRiskPreflightRequestSchema,
  PreflightRequestSchema,
  ResolveRequestSchema,
  SwapQuoteRequestSchema,
  TokenScanRequestSchema,
  WalletScanRequestSchema,
} from "@pulse/schemas";
import { z } from "zod";
import { saveReport } from "./store.js";
import { autopilotPassTargetExists } from "./autopilotAutomation.js";
import { executionTicker } from "./robinhoodMarkets.js";

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
      anyOf: [{ required: ["tokenAddress"] }, { required: ["fromToken"] }, { required: ["toToken"] }],
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
  ...(["24h", "7d", "30d"] as const).map((duration) => ({
    name: `start_autopilot_${duration}`,
    description: `Paid: start or extend an owner-controlled Autopilot for ${duration} after its Agentic Wallet setup is complete`,
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Agentic Wallet EVM address that owns the vault" },
        vault: { type: "string", description: "Owner-controlled vault already created, configured, funded and registered through Agentic Wallet contract calls" },
        telegramDelivery: { type: "string", description: "Optional chat-bound expiry-reminder capability; never wallet authority" },
      },
      required: ["owner", "vault"],
    },
  })),
  { name: "job_status", description: "Free authenticated status read for a previously paid durable job; never pay again to poll", inputSchema: { type: "object", properties: { jobId: { type: "string" }, recoveryToken: { type: "string" } }, required: ["jobId", "recoveryToken"] } },
  { name: "job_report", description: "Free authenticated final-report retrieval for a previously paid durable job; never pay again to retrieve", inputSchema: { type: "object", properties: { jobId: { type: "string" }, recoveryToken: { type: "string" } }, required: ["jobId", "recoveryToken"] } },
];

const marketIdArgs = z.string().min(3).max(64).regex(/^[A-Z0-9]+-[A-Z0-9]+$/, "Select a live OKX market");
const AnalysisArgs = z.object({
  instId: marketIdArgs,
  timeframe: z.enum(["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "1W", "1Dutc", "1Wutc"]).default("1H"),
  lang: z.enum(["en", "zh"]).optional(),
  userNote: z.string().max(500).optional(),
});

const passArgs = z.object({ owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/), vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/), telegramDelivery: z.string().max(160).optional() });
const argumentSchemas: Record<string, z.ZodType> = {
  analysis_base: AnalysisArgs, analysis_premium: AnalysisArgs,
  spot_analysis_standard: AnalysisArgs, spot_analysis_premium: AnalysisArgs,
  prediction_analysis_standard: PredictionAnalysisRequestSchema, prediction_analysis_premium: PredictionAnalysisRequestSchema,
  fused_analysis_standard: FusedAnalysisRequestSchema, fused_analysis_premium: FusedAnalysisRequestSchema,
  divergence_analysis: DivergenceAnalysisRequestSchema, event_risk_preflight: EventRiskPreflightRequestSchema,
  start_autopilot_24h: passArgs, start_autopilot_7d: passArgs, start_autopilot_30d: passArgs,
  preflight: PreflightRequestSchema.refine((value) => Boolean(value.tokenAddress || value.toToken || value.fromToken), { message: "Risk Guard requires the exact token contract address", path: ["tokenAddress"] }),
  token_scan: TokenScanRequestSchema, wallet_scan: WalletScanRequestSchema,
  market_pulse: MarketPulseRequestSchema, swap_quote: SwapQuoteRequestSchema,
  resolve: ResolveRequestSchema, spot_search: z.object({ query: z.string().min(1).max(80) }),
  spot_ticker: z.object({ instId: marketIdArgs }),
  job_status: z.object({ jobId: z.string().uuid(), recoveryToken: z.string().min(32).max(256) }),
  job_report: z.object({ jobId: z.string().uuid(), recoveryToken: z.string().min(32).max(256) }),
};

function availableTools(cfg: AppConfig) {
  const published = new Set([
    "spot_analysis_standard",
    "spot_analysis_premium",
    "prediction_analysis_standard",
    "prediction_analysis_premium",
    "start_autopilot_24h",
    "start_autopilot_7d",
    "start_autopilot_30d",
    "preflight",
    "job_status",
    "job_report",
  ]);
  return TOOLS.filter((tool) => {
    if (!published.has(tool.name)) return false;
    if (tool.name.startsWith("prediction_analysis_")) return cfg.FEATURE_PREDICTION_ANALYSIS;
    if (tool.name.startsWith("fused_analysis_")) return cfg.FEATURE_FUSED_ANALYSIS;
    if (tool.name === "divergence_analysis") return cfg.FEATURE_DIVERGENCE_ANALYSIS;
    if (tool.name === "event_risk_preflight") return cfg.FEATURE_EVENT_RISK_ANALYSIS;
    return true;
  }).map((original) => {
    const tool = original.name.startsWith("spot_analysis_") ? {
      ...original,
      inputSchema: { ...original.inputSchema, required: ["instId", "timeframe", "lang"], properties: {
        ...original.inputSchema.properties,
        instId: { type: "string", pattern: "^[A-Z0-9]+-[A-Z0-9]+$", maxLength: 64, description: "Live OKX instrument ID, for example BTC-USDT. Arc execution maps BTC to cirBTC and ETH to WETH; indexed tokens are Risk Guard only." },
        timeframe: { type: "string", enum: ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "1W", "1Dutc", "1Wutc"] },
        userNote: { type: "string", maxLength: 500 },
      } },
    } : original.name === "preflight" || original.name.startsWith("prediction_analysis_") ? {
      ...original, inputSchema: { ...original.inputSchema, required: original.name === "preflight" ? ["tokenAddress", "lang"] : ["primaryMarketId", "lang"], properties: { ...original.inputSchema.properties, lang: { type: "string", enum: ["en", "zh"], description: "Collect report language together with the other required inputs." } } },
    } : original;
    if (tool.name === "spot_analysis_standard") return { ...tool, description: `Global Quick → Spot Market or Limit · ${priceLabel(cfg.PRICE_ANALYSIS_BASE)} · concise Buy-or-Wait plan using the selected market's data, followed by a separately reviewed, Agentic-Wallet-signed Spot order` };
    if (tool.name === "spot_analysis_premium") return { ...tool, description: `Global Pro → Spot Market or Limit · ${priceLabel(cfg.PRICE_ANALYSIS_PREMIUM)} · chart, Fibonacci, pivots and Elliott paths followed by a separately reviewed, Agentic-Wallet-signed Spot order` };
    if (tool.name === "prediction_analysis_standard") return { ...tool, description: `Prediction Quick · ${priceLabel(cfg.PRICE_ANALYSIS_PREDICTION_STANDARD)} · concise evidence, probability and invalidation` };
    if (tool.name === "prediction_analysis_premium") return { ...tool, description: `Prediction Pro · ${priceLabel(cfg.PRICE_ANALYSIS_PREDICTION_PREMIUM)} · detailed counter-case plus independent 4H underlying chart` };
    if (tool.name === "preflight") return { ...tool, description: `Token Risk Guard · ${priceLabel(cfg.PRICE_PREFLIGHT)} · Grok report from OKX or Blockscout on-chain evidence plus GeckoTerminal market and available project evidence; requires an exact token contract` };
    if (tool.name === "start_autopilot_24h") return { ...tool, description: `Start Autopilot · 24h · ${priceLabel(cfg.PRICE_AUTOPILOT_PASS_24H)} · final x402 runtime activation after the Agentic Wallet creates, configures, funds and registers the owner-controlled vault` };
    if (tool.name === "start_autopilot_7d") return { ...tool, description: `Start Autopilot · 7d · ${priceLabel(cfg.PRICE_AUTOPILOT_PASS_7D)} · final x402 runtime activation after the Agentic Wallet creates, configures, funds and registers the owner-controlled vault` };
    if (tool.name === "start_autopilot_30d") return { ...tool, description: `Start Autopilot · 30d · ${priceLabel(cfg.PRICE_AUTOPILOT_PASS_30D)} · final x402 runtime activation after the Agentic Wallet creates, configures, funds and registers the owner-controlled vault` };
    return tool;
  });
}

export type McpPaidForward = (req: Request, res: Response, route: string, args: Record<string, unknown>, id: string | number | null, tool: string, method?: "GET" | "POST") => void;

function paidRestRoute(name: string): string | undefined {
  const legacy: Record<string, string> = {
    analysis_base: "/v1/analysis/base", analysis_premium: "/v1/analysis/premium",
    token_scan: "/v1/token/scan", wallet_scan: "/v1/wallet/scan", market_pulse: "/v1/market/pulse",
    swap_quote: "/v1/swap/quote", preflight: "/v1/preflight",
    divergence_analysis: "/v1/analysis/divergence", event_risk_preflight: "/v1/preflight/event-risk",
  };
  if (legacy[name]) return legacy[name];
  if (/^(spot|prediction|fused)_analysis_(standard|premium)$/.test(name)) return `/v1/analysis/${name.replace("_analysis_", "/")}`;
  if (/^start_autopilot_(24h|7d|30d)$/.test(name)) return `/v1/autopilot/pass/${name.replace("start_autopilot_", "")}`;
  return undefined;
}

export function createMcpHandler(cfg: AppConfig, forwardPaid?: McpPaidForward) {
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
      const schema = argumentSchemas[name];
      if (!schema) return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
      const parsed = schema.safeParse(params.arguments ?? {});
      if (!parsed.success) return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments; no payment requested", data: parsed.error.issues } });
      const args = parsed.data as Record<string, unknown>;
      if (forwardPaid && (name === "job_status" || name === "job_report")) {
        req.headers["pulse-recovery-token"] = String(args.recoveryToken);
        return forwardPaid(req, res, `/v1/jobs/${encodeURIComponent(String(args.jobId))}${name === "job_report" ? "/report" : ""}`, {}, id, name, "GET");
      }
      const route = paidRestRoute(name);
      // Production application reuses its REST validation, network gate and settlement path.
      // No loopback/public HTTP call and no second independently configured payment challenge.
      if (route && forwardPaid) return forwardPaid(req, res, route, args, id, name);
      if (name.startsWith("start_autopilot_")) {
        const network = (req as Request & { pulseNetworkKey?: string }).pulseNetworkKey || "xlayer";
        if (network !== "xlayer" && network !== "base" && network !== "arbitrum") return res.status(422).json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Autopilot is unavailable on this network" } });
        try {
          if (!(await autopilotPassTargetExists({ owner: String(args.owner), vault: String(args.vault), network }))) return res.status(404).json({ jsonrpc: "2.0", id, error: { code: -32602, message: "No registered Autopilot owned by this wallet on the selected network" } });
        } catch { return res.status(503).json({ jsonrpc: "2.0", id, error: { code: -32000, message: "Vault ownership could not be verified; no payment requested" } }); }
      }
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
      return { ticker: await executionTicker(cfg, instId) };
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
      if (/^(spot|prediction|fused)_analysis_(standard|premium)$/.test(name) || /^start_autopilot_(24h|7d|30d)$/.test(name) || name === "divergence_analysis" || name === "event_risk_preflight") {
        const route = name.startsWith("start_autopilot_") ? `/v1/autopilot/pass/${name.replace("start_autopilot_", "")}`
          : name === "divergence_analysis" ? "/v1/analysis/divergence"
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
