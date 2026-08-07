import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NETWORK_KEYS, getNetwork, parseEnabledNetworks, type NetworkKey } from "./networks.js";

export * from "./networks.js";

function loadDotenv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../../../.env"),
  ];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, "../../../.env"));
  } catch {
    /* ignore */
  }
  for (const p of candidates) {
    if (existsSync(p)) loadEnv({ path: p, override: false });
  }
  loadEnv();
}

loadDotenv();

function pick(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

export function normalizeHost(value: string): string {
  const host = value.trim();
  // URL notation uses brackets around IPv6 literals, but Node's listen()
  // expects the raw address. Railway should bind on all interfaces.
  if (host === "[::]" || host === "::") return "0.0.0.0";
  return host || "0.0.0.0";
}

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0").transform(normalizeHost),
  BASE_URL: z.string().default("http://localhost:4000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  X402_NETWORK: z.string().default("eip155:196"),
  X402_ASSET: z.string().default("0x779ded0c9e1022225f8e0630b35a9b54be713736"),
  PAY_TO_ADDRESS: z.string().default("0x0000000000000000000000000000000000000000"),
  X402_MOCK: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  OKX_API_KEY: z.string().optional().default(""),
  OKX_SECRET_KEY: z.string().optional().default(""),
  OKX_PASSPHRASE: z.string().optional().default(""),
  OKX_BASE_URL: z.string().optional().default("https://web3.okx.com"),
  OKX_FACILITATOR_URL: z.string().url().default("https://web3.okx.com"),
  XAI_API_KEY: z.string().optional().default(""),
  XAI_BASE_URL: z.string().optional().default("https://api.x.ai/v1"),
  GROK_MODEL: z.string().optional().default("grok-4.3"),
  GROK_REASONING_STANDARD: z.enum(["none", "low"]).default("none"),
  GROK_REASONING_PREMIUM: z.enum(["none", "low"]).default("low"),
  GROK_MAX_INPUT_STANDARD: z.coerce.number().int().min(1000).max(100000).default(12000),
  GROK_MAX_INPUT_FUSED_STANDARD: z.coerce.number().int().min(1000).max(100000).default(13000),
  GROK_MAX_INPUT_PREMIUM: z.coerce.number().int().min(1000).max(200000).default(24000),
  GROK_MAX_OUTPUT_STANDARD: z.coerce.number().int().min(128).max(8192).default(700),
  GROK_MAX_OUTPUT_PREMIUM: z.coerce.number().int().min(128).max(16384).default(1200),
  GROK_MAX_INPUT_PREDICTION_STANDARD: z.coerce.number().int().min(1000).max(100000).default(16000),
  GROK_MAX_INPUT_PREDICTION_PREMIUM: z.coerce.number().int().min(1000).max(200000).default(32000),
  GROK_MAX_OUTPUT_PREDICTION_STANDARD: z.coerce.number().int().min(512).max(8192).default(1400),
  GROK_MAX_OUTPUT_PREDICTION_PREMIUM: z.coerce.number().int().min(1024).max(16384).default(3200),
  XAI_INPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(0),
  XAI_CACHED_INPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(0),
  XAI_OUTPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(0),
  ARC_AI_MODE: z.enum(["fixture", "live"]).default("fixture"),
  ARC_LIVE_WALLET_HOURLY_LIMIT: z.coerce.number().int().positive().default(10),
  ARC_LIVE_IP_HOURLY_LIMIT: z.coerce.number().int().positive().default(20),
  ARC_LIVE_WALLET_DAILY_LIMIT: z.coerce.number().int().positive().default(25),
  ARC_LIVE_DAILY_COST_LIMIT_USD: z.coerce.number().positive().default(5),
  X_LAYER_RPC: z.string().default("https://rpc.xlayer.tech"),
  X_LAYER_RPC_FALLBACK: z.string().default("https://xlayerrpc.okx.com"),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  BASE_RPC_FALLBACK_URL: z.union([z.string().url(), z.literal("")]).default(""),
  ARBITRUM_RPC_URL: z.string().url().default("https://arb1.arbitrum.io/rpc"),
  ARBITRUM_RPC_FALLBACK_URL: z.union([z.string().url(), z.literal("")]).default(""),
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  ARC_RPC_FALLBACK_URL: z.union([z.string().url(), z.literal("")]).default(""),
  PRICE_TOKEN_SCAN: z.coerce.number().default(0.10),
  PRICE_WALLET_SCAN: z.coerce.number().default(0.01),
  PRICE_MARKET_PULSE: z.coerce.number().default(0.01),
  PRICE_SWAP_QUOTE: z.coerce.number().default(0.02),
  PRICE_PREFLIGHT: z.coerce.number().default(0.20),
  PRICE_ANALYSIS_BASE: z.coerce.number().default(0.10),
  PRICE_ANALYSIS_PREMIUM: z.coerce.number().default(0.20),
  PRODUCT_LOGO_URL: z.string().optional().default(""),
  PRODUCT_CATEGORY: z.string().optional().default("Trading"),
  PRODUCT_NAME: z.string().optional().default("PULSE"),
  TEST_WALLET_PRIVATE_KEY: z.string().optional().default(""),
  TEST_WALLET_ADDRESS: z.string().optional().default(""),
  ENABLE_SERVER_PAY: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  ENABLED_NETWORKS: z.string().default("xlayer"),
  DEFAULT_NETWORK: z.enum(NETWORK_KEYS).default("xlayer"),
  FEATURE_POLYMARKET: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_WALLET_APPKIT: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_BASE_PAYMENTS: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_ARBITRUM_PAYMENTS: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_ARC_PAYMENTS: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_JOBS: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_LIVE_SAFETY: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_PREDICTION_ANALYSIS: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_FUSED_ANALYSIS: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_DIVERGENCE_ANALYSIS: z.string().optional().transform((v) => v === "1" || v === "true"),
  FEATURE_EVENT_RISK_ANALYSIS: z.string().optional().transform((v) => v === "1" || v === "true"),
  BAZAAR_DISCOVERABLE: z.string().optional().transform((v) => v === "1" || v === "true"),
  PRICE_ANALYSIS_PREDICTION_STANDARD: z.coerce.number().positive().default(0.10),
  PRICE_ANALYSIS_PREDICTION_PREMIUM: z.coerce.number().positive().default(0.20),
  PRICE_ANALYSIS_FUSED_STANDARD: z.coerce.number().positive().default(0.15),
  PRICE_ANALYSIS_FUSED_PREMIUM: z.coerce.number().positive().default(0.30),
  PRICE_ANALYSIS_DIVERGENCE: z.coerce.number().positive().default(0.10),
  PRICE_PREFLIGHT_EVENT_RISK: z.coerce.number().positive().default(0.20),
  REPORT_DEFAULT_VISIBILITY: z.enum(["private", "public"]).default("private"),
  REPORT_SHARE_LINK_ENABLED: z.string().optional().transform((v) => v === "1" || v === "true"),
  PAID_REGENERATION_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(2),
  POLYMARKET_GAMMA_URL: z.string().url().default("https://gamma-api.polymarket.com"),
  POLYMARKET_CLOB_URL: z.string().url().default("https://clob.polymarket.com"),
  POLYMARKET_DATA_URL: z.string().url().default("https://data-api.polymarket.com"),
  POLYMARKET_MAX_SELECTED: z.coerce.number().int().min(1).max(20).default(8),
  POLYMARKET_STANDARD_MAX_SELECTED: z.coerce.number().int().min(1).max(20).default(3),
  POLYMARKET_PREMIUM_MAX_SELECTED: z.coerce.number().int().min(1).max(20).default(6),
  STORAGE_PROVIDER: z.enum(["memory", "vercel_blob"]).default("memory"),
  BLOB_ACCESS: z.enum(["private", "public"]).default("private"),
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(""),
  REPORT_ENCRYPTION_KEY: z.string().optional().default(""),
  QUEUE_PROVIDER: z.enum(["memory", "upstash_kv"]).default("memory"),
  PERSISTENCE_NAMESPACE: z.string().regex(/^[a-zA-Z0-9:_-]{1,64}$/).default("pulse"),
  KV_REST_API_URL: z.string().optional().default(""),
  KV_REST_API_TOKEN: z.string().optional().default(""),
  JOB_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  REPORT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  JOB_STAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  CIRCLE_GATEWAY_ENABLED: z.string().optional().transform((v) => v === "1" || v === "true"),
  CIRCLE_GATEWAY_TESTNET_URL: z.string().url().default("https://gateway-api-testnet.circle.com"),
  CIRCLE_GATEWAY_ACCEPTED_NETWORKS: z.string().default("eip155:5042002"),
  CIRCLE_GATEWAY_SELLER_ADDRESS: z.string().optional().default(""),
  CDP_FACILITATOR_URL: z.string().url().default("https://api.cdp.coinbase.com/platform/v2/x402"),
  CDP_API_KEY_ID: z.string().optional().default(""),
  CDP_API_KEY_SECRET: z.string().optional().default(""),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  enabledNetworks: readonly NetworkKey[];
  methodologyVersion: string;
  productName: string;
  productTagline: string;
  productTaglineZh: string;
  productDescription: string;
  productShortDescription: string;
  logoPath: string;
  logoUrl: string;
  hasOkxCredentials: boolean;
  hasXaiKey: boolean;
  hasServerPay: boolean;
  paymentMode: "mock" | "okx";
  routes: RoutePriceMap;
};

export type RoutePriceMap = Record<
  string,
  { priceUsd: number; description: string; free?: boolean; name: string }
>;

export function loadConfig(): AppConfig {
  if (!process.env.OKX_API_KEY) {
    process.env.OKX_API_KEY = pick("OKX_XLAYER_API_KEY", "OKX_API_KEY");
  }
  if (!process.env.OKX_SECRET_KEY) {
    process.env.OKX_SECRET_KEY = pick(
      "OKX_XLAYER_API_SECRET",
      "OKX_API_SECRET",
      "OKX_SECRET_KEY",
    );
  }
  if (!process.env.OKX_PASSPHRASE) {
    process.env.OKX_PASSPHRASE = pick(
      "OKX_XLAYER_API_PASSPHRASE",
      "OKX_API_PASSPHRASE",
      "OKX_PASSPHRASE",
    );
  }
  if (!process.env.BASE_URL || process.env.BASE_URL.includes("localhost")) {
    const vercel =
      process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "";
    if (vercel) {
      const host = vercel.startsWith("http") ? vercel : `https://${vercel}`;
      process.env.BASE_URL = host.replace(/\/$/, "");
    }
  }

  const parsed = EnvSchema.parse(process.env);
  if (parsed.ARC_AI_MODE === "live" && (parsed.XAI_INPUT_COST_PER_MILLION_USD <= 0 || parsed.XAI_OUTPUT_COST_PER_MILLION_USD <= 0)) {
    throw new Error("ARC_AI_MODE=live requires positive XAI_INPUT_COST_PER_MILLION_USD and XAI_OUTPUT_COST_PER_MILLION_USD for fail-closed cost control");
  }
  if (parsed.QUEUE_PROVIDER === "upstash_kv" && (!parsed.KV_REST_API_URL || !parsed.KV_REST_API_TOKEN)) {
    throw new Error("QUEUE_PROVIDER=upstash_kv requires KV_REST_API_URL and KV_REST_API_TOKEN");
  }
  if (parsed.STORAGE_PROVIDER === "vercel_blob" && (!parsed.BLOB_READ_WRITE_TOKEN || !parsed.KV_REST_API_URL || !parsed.KV_REST_API_TOKEN)) {
    throw new Error("STORAGE_PROVIDER=vercel_blob requires BLOB_READ_WRITE_TOKEN plus Upstash KV URL and write token for private report metadata");
  }
  if (parsed.STORAGE_PROVIDER === "vercel_blob" && parsed.BLOB_ACCESS === "public" && !/^[A-Za-z0-9_-]{43}=$|^[A-Za-z0-9_-]{43}$/.test(parsed.REPORT_ENCRYPTION_KEY)) {
    throw new Error("BLOB_ACCESS=public requires REPORT_ENCRYPTION_KEY containing a base64url-encoded 32-byte key");
  }
  if (parsed.FEATURE_ARC_PAYMENTS && parsed.CIRCLE_GATEWAY_ENABLED && !/^0x[a-fA-F0-9]{40}$/.test(parsed.CIRCLE_GATEWAY_SELLER_ADDRESS)) {
    throw new Error("Arc payments require a valid CIRCLE_GATEWAY_SELLER_ADDRESS");
  }
  if ((parsed.FEATURE_BASE_PAYMENTS || parsed.FEATURE_ARBITRUM_PAYMENTS) && (!parsed.CDP_API_KEY_ID || !parsed.CDP_API_KEY_SECRET)) {
    throw new Error("Base/Arbitrum payments require CDP_API_KEY_ID and CDP_API_KEY_SECRET");
  }
  const name = parsed.PRODUCT_NAME || "PULSE";

  const routes: RoutePriceMap = {
    "GET /v1/market/instruments": {
      name: "Spot Instruments",
      priceUsd: 0,
      free: true,
      description: "Free: list OKX spot instruments (searchable).",
    },
    "GET /v1/xlayer/tokens": {
      name: "X Layer Token Catalog",
      priceUsd: 0,
      free: true,
      description: "Searchable X Layer token catalog from OKX Onchain OS with DexScreener enrichment when available.",
    },
    "GET /v1/market/ticker": {
      name: "Spot Ticker",
      priceUsd: 0,
      free: true,
      description: "Free teaser: live OKX spot ticker.",
    },
    "GET /v1/market/candles": {
      name: "Spot Candles",
      priceUsd: 0,
      free: true,
      description: "Free teaser: OKX spot OHLCV candles for chart.",
    },
    "GET /v1/dex/quote": {
      name: "OKX DEX Funding Quote",
      priceUsd: 0,
      free: true,
      description: "Free: live Exchange OS quote for native OKB to USDT0 on X Layer.",
    },
    "POST /v1/contract/inspect": {
      name: "Multichain Contract Evidence",
      priceUsd: 0,
      free: true,
      description: "Live network-scoped RPC evidence for any EVM address: code, bytecode size, nonce, balance, and common proxy patterns.",
    },
    "POST /v1/safety/evidence": {
      name: "Live Contract and Token Evidence",
      priceUsd: 0,
      free: true,
      description: "Live RPC contract and ERC-20 interface observations with explicit unknown fields and no fabricated safety score.",
    },
    "POST /v1/safety/simulate": {
      name: "Live Transaction Simulation",
      priceUsd: 0,
      free: true,
      description: "Non-broadcast eth_estimateGas and eth_call evidence for an exact transaction on the selected network.",
    },
    "POST /v1/dex/swap": {
      name: "OKX DEX Funding Transaction",
      priceUsd: 0,
      free: true,
      description: "Free: prepare an OKB to USDT0 transaction for the connected wallet.",
    },
    "POST /v1/dex/cdp/native-usdc": {
      name: "Base and Arbitrum Native-USDC Swap",
      priceUsd: 0,
      free: true,
      description: "Prepare an executable native ETH to native USDC swap transaction for the connected Base or Arbitrum wallet.",
    },
    "POST /v1/resolve": {
      name: "Token Resolve",
      priceUsd: 0,
      free: true,
      description: "Free: resolve symbol/name/address metadata.",
    },
    "POST /v1/analysis/base": {
      name: "Market Analysis Base",
      priceUsd: parsed.PRICE_ANALYSIS_BASE,
      description:
        "Grok-powered OKX spot analysis (base): trend, levels, targets, and invalidation from live OHLCV.",
    },
    "POST /v1/analysis/premium": {
      name: "Market Analysis Premium",
      priceUsd: parsed.PRICE_ANALYSIS_PREMIUM,
      description:
        "Grok-powered deep OKX spot analysis: multi-scenario targets, risk plan, and agent checklist from live OHLCV.",
    },
    "POST /v1/analysis/spot/standard": {
      name: "Spot Analysis Standard",
      priceUsd: parsed.PRICE_ANALYSIS_BASE,
      description: "Standard Grok analysis from a server-fetched OKX spot snapshot.",
    },
    "POST /v1/analysis/spot/premium": {
      name: "Spot Analysis Premium",
      priceUsd: parsed.PRICE_ANALYSIS_PREMIUM,
      description: "Premium Grok analysis from a server-fetched OKX spot snapshot.",
    },
    "POST /v1/analysis/prediction/standard": {
      name: "Prediction Analysis Standard",
      priceUsd: parsed.PRICE_ANALYSIS_PREDICTION_STANDARD,
      description: "Readable standard analysis of one explicitly selected crypto Polymarket market, including probability, evidence quality, invalidation, limitations, and provenance.",
    },
    "POST /v1/analysis/prediction/premium": {
      name: "Prediction Analysis Premium",
      priceUsd: parsed.PRICE_ANALYSIS_PREDICTION_PREMIUM,
      description: "Detailed readable analysis of one explicitly selected crypto Polymarket market, including probability, counter-case, evidence quality, invalidation, limitations, and provenance.",
    },
    "POST /v1/analysis/fused/standard": {
      name: "Fused Analysis Standard",
      priceUsd: parsed.PRICE_ANALYSIS_FUSED_STANDARD,
      description: "Standard fused OKX spot and selected Polymarket analysis.",
    },
    "POST /v1/analysis/fused/premium": {
      name: "Fused Analysis Premium",
      priceUsd: parsed.PRICE_ANALYSIS_FUSED_PREMIUM,
      description: "Premium fused OKX spot and selected Polymarket analysis.",
    },
    "POST /v1/analysis/divergence": {
      name: "Divergence Analysis",
      priceUsd: parsed.PRICE_ANALYSIS_DIVERGENCE,
      description: "Deterministic spot-versus-prediction divergence analysis.",
    },
    "POST /v1/preflight/event-risk": {
      name: "Event-risk Preflight",
      priceUsd: parsed.PRICE_PREFLIGHT_EVENT_RISK,
      description: "Preflight enriched with explicitly selected prediction-market event risk.",
    },
    "POST /v1/token/scan": {
      name: "Token Risk Scan",
      priceUsd: parsed.PRICE_TOKEN_SCAN,
      description: "Safety: token risk score before you touch an asset.",
    },
    "POST /v1/preflight": {
      name: "Pre-trade Safety Check",
      priceUsd: parsed.PRICE_PREFLIGHT,
      description: "Safety: composite pre-trade PASS/WARN/FAIL checklist.",
    },
    "POST /v1/wallet/scan": {
      name: "Wallet Risk Scan",
      priceUsd: parsed.PRICE_WALLET_SCAN,
      description: "Advanced: counterparty wallet risk heuristics.",
    },
    "POST /v1/market/pulse": {
      name: "Legacy Market Pulse",
      priceUsd: parsed.PRICE_MARKET_PULSE,
      description: "Advanced: lightweight pulse score (prefer Grok analysis).",
    },
    "POST /v1/swap/quote": {
      name: "Legacy Swap Quote",
      priceUsd: parsed.PRICE_SWAP_QUOTE,
      description: "Advanced: heuristic swap impact estimate.",
    },
  };

  if (!parsed.FEATURE_PREDICTION_ANALYSIS) {
    delete routes["POST /v1/analysis/prediction/standard"];
    delete routes["POST /v1/analysis/prediction/premium"];
  }
  if (!parsed.FEATURE_FUSED_ANALYSIS) {
    delete routes["POST /v1/analysis/fused/standard"];
    delete routes["POST /v1/analysis/fused/premium"];
  }
  if (!parsed.FEATURE_DIVERGENCE_ANALYSIS) delete routes["POST /v1/analysis/divergence"];
  if (!parsed.FEATURE_EVENT_RISK_ANALYSIS) delete routes["POST /v1/preflight/event-risk"];
  if (!parsed.FEATURE_LIVE_SAFETY) {
    delete routes["POST /v1/safety/evidence"];
    delete routes["POST /v1/safety/simulate"];
  }

  const hasOkxCredentials = Boolean(
    parsed.OKX_API_KEY && parsed.OKX_SECRET_KEY && parsed.OKX_PASSPHRASE,
  );
  const hasXaiKey = Boolean(parsed.XAI_API_KEY);
  const hasServerPay = Boolean(
    parsed.NODE_ENV !== "production" &&
      parsed.ENABLE_SERVER_PAY &&
      parsed.TEST_WALLET_PRIVATE_KEY,
  );
  const paymentMode: "mock" | "okx" =
    !parsed.X402_MOCK && hasOkxCredentials ? "okx" : "mock";

  // The marketplace avatar is a true square PNG with square outer corners.
  // Keep SVG available for the web UI and repository documentation.
  const logoPath = "/brand/logo.png";
  const logoUrl =
    parsed.PRODUCT_LOGO_URL ||
    `${parsed.BASE_URL.replace(/\/$/, "")}${logoPath}`;

  return {
    ...parsed,
    enabledNetworks: parseEnabledNetworks(parsed.ENABLED_NETWORKS),
    methodologyVersion: "pulse-v3.0.0",
    productName: name,
    productTagline: "Multichain spot and prediction-market intelligence. Pay per report on your selected network.",
    productTaglineZh: "多链现货与预测市场智能。按所选网络按次付费。",
    productShortDescription:
      "PULSE combines live OKX Crypto Market evidence with one explicitly selected crypto Polymarket question and delivers readable, recoverable reports on X Layer, Base, Arbitrum One, and Arc Testnet.",
    productDescription:
      "PULSE is independent market intelligence for humans and AI agents. One responsive workspace contains Crypto Market, Prediction Market, and Safety. Prediction Market filters Polymarket to active crypto price and direction questions, displays the selected market's live public evidence, and offers Base or Premium analysis in a readable report with probabilities, quality, invalidation, limitations, and provenance. Polymarket is read-only; PULSE never places orders. Browser wallets pay through network-aware x402 on X Layer, Base, Arbitrum One, or Circle Gateway on Arc Testnet.",
    logoPath,
    logoUrl,
    hasOkxCredentials,
    hasXaiKey,
    hasServerPay,
    paymentMode,
    routes,
  };
}

export function usdToAtomic(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}

export function priceLabel(usd: number): string {
  if (usd <= 0) return "Free";
  return `$${usd.toFixed(2)}`;
}

export function buildAspMetadata(cfg: AppConfig) {
  const base = cfg.BASE_URL.replace(/\/$/, "");
  const isPublicProductRoute = (route: string) => {
    const path = route.split(" ")[1] || "";
    if (path === "/v1/wallet/scan" || path === "/v1/market/pulse" || path === "/v1/swap/quote") return false;
    if (path.includes("/analysis/prediction/") && !cfg.FEATURE_PREDICTION_ANALYSIS) return false;
    if (path.includes("/analysis/fused/") && !cfg.FEATURE_FUSED_ANALYSIS) return false;
    if (path === "/v1/analysis/divergence" && !cfg.FEATURE_DIVERGENCE_ANALYSIS) return false;
    if (path === "/v1/preflight/event-risk" && !cfg.FEATURE_EVENT_RISK_ANALYSIS) return false;
    return true;
  };
  const publicRoutes = Object.entries(cfg.routes).filter(([route]) => isPublicProductRoute(route));
  const services = publicRoutes
    .map(([route, info]) => {
      const [method, path] = route.split(" ");
      return {
        name: info.name,
        method,
        path,
        endpoint: `${base}${path}`,
        priceUsd: info.priceUsd,
        price: priceLabel(info.priceUsd),
        free: Boolean(info.free),
        description: info.description,
        mimeType: "application/json",
        network: cfg.X402_NETWORK,
        asset: cfg.X402_ASSET,
        payTo: cfg.PAY_TO_ADDRESS,
        scheme: info.free ? null : "exact",
      };
    });

  // Always include hero analysis + free market + safety
  const hero = publicRoutes.map(([route, info]) => {
    const [method, path] = route.split(" ");
    return {
      name: info.name,
      method,
      path,
      endpoint: `${base}${path}`,
      priceUsd: info.priceUsd,
      price: priceLabel(info.priceUsd),
      free: Boolean(info.free),
      description: info.description,
    };
  });
  const publicAlias = (key: NetworkKey) => key === "arc-testnet" ? "arc" : key;
  const paymentNetworkEnabled = (key: NetworkKey) => key === "xlayer"
    || (key === "base" && cfg.FEATURE_BASE_PAYMENTS)
    || (key === "arbitrum" && cfg.FEATURE_ARBITRUM_PAYMENTS)
    || (key === "arc-testnet" && cfg.FEATURE_ARC_PAYMENTS && cfg.CIRCLE_GATEWAY_ENABLED);
  const multichainPaidPaths = new Set([
    "/v1/analysis/spot/standard",
    "/v1/analysis/spot/premium",
    "/v1/analysis/prediction/standard",
    "/v1/analysis/prediction/premium",
    "/v1/analysis/fused/standard",
    "/v1/analysis/fused/premium",
    "/v1/analysis/divergence",
    "/v1/preflight/event-risk",
  ]);
  const networkServices = cfg.enabledNetworks.filter(paymentNetworkEnabled).flatMap((key) => {
    const network = getNetwork(key);
    return publicRoutes.filter(([route, info]) => {
      if (info.free) return false;
      const [, path] = route.split(" ");
      return key === "xlayer" || multichainPaidPaths.has(path);
    }).map(([route, info]) => {
      const [method, path] = route.split(" ");
      const aliasPath = `/${publicAlias(key)}${path}`;
      return {
        name: info.name, method, path: aliasPath, endpoint: `${base}${aliasPath}`,
        priceUsd: info.priceUsd, price: priceLabel(info.priceUsd), free: false,
        description: info.description, networkKey: key, network: network.caip2,
        asset: network.paymentAsset.address, assetSymbol: network.paymentAsset.symbol,
        payTo: key === "arc-testnet" ? cfg.CIRCLE_GATEWAY_SELLER_ADDRESS : cfg.PAY_TO_ADDRESS,
        paymentProvider: network.paymentProvider, scheme: "exact",
      };
    });
  });

  return {
    asp: {
      name: cfg.productName,
      version: "2.0.0",
      type: "A2MCP",
      category: cfg.PRODUCT_CATEGORY,
      tagline: cfg.productTagline,
      taglineZh: cfg.productTaglineZh,
      shortDescription: cfg.productShortDescription,
      description: cfg.productDescription,
      logo: cfg.logoUrl,
      logoPath: cfg.logoPath,
      methodology_version: cfg.methodologyVersion,
      grokModel: cfg.GROK_MODEL,
      network: cfg.X402_NETWORK,
      settlementAsset: cfg.X402_ASSET,
      settlementAssetSymbol: "USD₮0",
      payTo: cfg.PAY_TO_ADDRESS,
      paymentProtocol: "x402",
      paymentSdk: "@okxweb3/x402-express",
      paymentMode: cfg.paymentMode,
      wallet: "OKX Agentic Wallet",
      mcpEndpoint: `${base}/mcp`,
      healthEndpoint: `${base}/healthz`,
      metadataEndpoint: `${base}/v1/metadata`,
      languages: ["en", "zh"],
      tags: [
        "x402",
        "a2mcp",
        "xlayer",
        "base",
        "arbitrum",
        "arc-testnet",
        "multichain",
        "okx",
        "spot",
        "polymarket",
        "prediction-markets",
        "structured-reports",
        "persistent-network-selection",
        "grok",
        "chart-analysis",
        "financial-assistant",
      ],
      services: hero,
      featuredServices: services,
      networkServices,
    },
    registration: {
      prompts: [
        "Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS",
        "Help me list my ASP on OKX.AI using Onchain OS",
      ],
      fields: {
        name: cfg.productName,
        description: cfg.productDescription,
        priceHint: "Free discovery · reports from $0.10 · multichain x402 settlement",
        endpoint: `${base}/mcp`,
        logo: cfg.logoUrl,
      },
    },
  };
}
