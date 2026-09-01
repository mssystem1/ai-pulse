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
  GROK_COPILOT_MODEL: z.string().optional().default("grok-4.5"),
  GROK_AUTOPILOT_MODEL: z.string().optional().default("grok-4.3"),
  GROK_REASONING_STANDARD: z.enum(["none", "low"]).default("none"),
  GROK_REASONING_PREMIUM: z.enum(["none", "low"]).default("low"),
  GROK_MAX_INPUT_STANDARD: z.coerce.number().int().min(1000).max(100000).default(12000),
  GROK_MAX_INPUT_FUSED_STANDARD: z.coerce.number().int().min(1000).max(100000).default(13000),
  GROK_MAX_INPUT_PREMIUM: z.coerce.number().int().min(1000).max(200000).default(24000),
  GROK_MAX_OUTPUT_STANDARD: z.coerce.number().int().min(128).max(8192).default(1800),
  GROK_MAX_OUTPUT_PREMIUM: z.coerce.number().int().min(128).max(16384).default(3200),
  GROK_MAX_INPUT_PREDICTION_STANDARD: z.coerce.number().int().min(1000).max(100000).default(16000),
  GROK_MAX_INPUT_PREDICTION_PREMIUM: z.coerce.number().int().min(1000).max(200000).default(32000),
  GROK_MAX_OUTPUT_PREDICTION_STANDARD: z.coerce.number().int().min(512).max(8192).default(1400),
  GROK_MAX_OUTPUT_PREDICTION_PREMIUM: z.coerce.number().int().min(1024).max(16384).default(3200),
  GROK_MAX_INPUT_COPILOT: z.coerce.number().int().min(4000).max(100000).default(32000),
  GROK_MAX_OUTPUT_COPILOT: z.coerce.number().int().min(256).max(8192).default(2000),
  GROK_MAX_INPUT_AUTOPILOT: z.coerce.number().int().min(1000).max(16000).default(4000),
  GROK_MAX_OUTPUT_AUTOPILOT: z.coerce.number().int().min(256).max(512).default(320),
  AUTOPILOT_AI_MIN_INTERVAL_MS: z.coerce.number().int().min(900000).max(604800000).default(14400000),
  AUTOPILOT_AI_SIGNAL_TTL_MS: z.coerce.number().int().min(900000).max(86400000).default(14400000),
  AUTOPILOT_AI_MAX_CALLS_PER_VAULT_DAY: z.coerce.number().int().min(0).max(24).default(3),
  AUTOPILOT_AI_MAX_CALLS_GLOBAL_DAY: z.coerce.number().int().min(0).max(10000).default(50),
  AUTOPILOT_AI_MAX_USD_PER_VAULT_DAY: z.coerce.number().min(0).max(1000).default(0.15),
  AUTOPILOT_AI_MAX_USD_GLOBAL_DAY: z.coerce.number().min(0).max(100000).default(2),
  GROK_MAX_INPUT_PORTFOLIO_RISK: z.coerce.number().int().min(4000).max(128000).default(48000),
  GROK_MAX_OUTPUT_PORTFOLIO_RISK: z.coerce.number().int().min(256).max(8192).default(2400),
  GROK_MAX_INPUT_STRATEGY: z.coerce.number().int().min(4000).max(160000).default(64000),
  GROK_MAX_OUTPUT_STRATEGY: z.coerce.number().int().min(256).max(16384).default(3200),
  XAI_INPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(1.25),
  XAI_CACHED_INPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(0.20),
  XAI_OUTPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).default(2.50),
  ARC_AI_MODE: z.enum(["fixture", "live"]).default("fixture"),
  ARC_LIVE_WALLET_HOURLY_LIMIT: z.coerce.number().int().positive().default(10),
  ARC_LIVE_IP_HOURLY_LIMIT: z.coerce.number().int().positive().default(20),
  ARC_LIVE_WALLET_DAILY_LIMIT: z.coerce.number().int().positive().default(25),
  ARC_LIVE_DAILY_COST_LIMIT_USD: z.coerce.number().positive().default(5),
  X_LAYER_RPC: z.string().default("https://rpc.xlayer.tech"),
  X_LAYER_RPC_FALLBACK: z.string().default("https://xlayerrpc.okx.com"),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  BASE_RPC_FALLBACK_URL: z.union([z.string().url(), z.literal("")]).default("https://base-rpc.publicnode.com"),
  ARBITRUM_RPC_URL: z.string().url().default("https://arb1.arbitrum.io/rpc"),
  ARBITRUM_RPC_FALLBACK_URL: z.union([z.string().url(), z.literal("")]).default("https://arbitrum-one-rpc.publicnode.com"),
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  ARC_RPC_FALLBACK_URL: z.union([z.string().url(), z.literal("")]).default(""),
  PRICE_TOKEN_SCAN: z.coerce.number().default(0.20),
  PRICE_WALLET_SCAN: z.coerce.number().default(0.11),
  PRICE_MARKET_PULSE: z.coerce.number().default(0.11),
  PRICE_SWAP_QUOTE: z.coerce.number().default(0.12),
  PRICE_PREFLIGHT: z.coerce.number().default(0.15),
  PRICE_ANALYSIS_BASE: z.coerce.number().default(0.20),
  PRICE_ANALYSIS_PREMIUM: z.coerce.number().default(0.30),
  PRICE_AUTOPILOT_PASS_24H: z.coerce.number().positive().default(1.50),
  PRICE_AUTOPILOT_PASS_7D: z.coerce.number().positive().default(10.50),
  PRICE_AUTOPILOT_PASS_30D: z.coerce.number().positive().default(45.00),
  PRODUCT_LOGO_URL: z.string().optional().default(""),
  PRODUCT_CATEGORY: z.string().optional().default("Trading"),
  PRODUCT_NAME: z.string().optional().default("PULSE"),
  TEST_WALLET_PRIVATE_KEY: z.string().optional().default(""),
  TEST_WALLET_ADDRESS: z.string().optional().default(""),
  AUTOMATION_EXECUTOR_PRIVATE_KEY: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
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
  FEATURE_TRADING: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_TERMINAL_TRADING: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_COPILOT: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_AUTOPILOT: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  AUTOPILOT_KILL_SWITCH: z.string().optional().default("0").transform((v) => v === "1" || v === "true"),
  FEATURE_HYPERLIQUID: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_HIP3_GLOBAL_MARKETS: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_POLYMARKET_EXECUTION: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_HYPERLIQUID_OUTCOMES: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_ONCHAIN_SPOT_EXECUTION: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_TRADE_ZONE_DATA: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_TELEGRAM: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  FEATURE_ARC_MAINNET: z.string().optional().default("1").transform((v) => v === "1" || v === "true"),
  ARC_MAINNET_CHAIN_ID: z.coerce.number().int().nonnegative().default(0),
  ARC_MAINNET_RPC_URL: z.union([z.string().url(), z.literal("")]).default(""),
  ARC_MAINNET_EXPLORER_URL: z.union([z.string().url(), z.literal("")]).default(""),
  ARC_MAINNET_USDC_ADDRESS: z.string().optional().default(""),
  BAZAAR_DISCOVERABLE: z.string().optional().transform((v) => v === "1" || v === "true"),
  PRICE_ANALYSIS_PREDICTION_STANDARD: z.coerce.number().positive().default(0.20),
  PRICE_ANALYSIS_PREDICTION_PREMIUM: z.coerce.number().positive().default(0.30),
  PRICE_ANALYSIS_FUSED_STANDARD: z.coerce.number().positive().default(0.25),
  PRICE_ANALYSIS_FUSED_PREMIUM: z.coerce.number().positive().default(0.40),
  PRICE_ANALYSIS_DIVERGENCE: z.coerce.number().positive().default(0.20),
  PRICE_PREFLIGHT_EVENT_RISK: z.coerce.number().positive().default(0.30),
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
  BLOB_ACCESS: z.literal("public").default("public"),
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
    "GET /v1/trading/capabilities": {
      name: "Trading Capabilities",
      priceUsd: 0,
      free: true,
      description: "Free: discover live providers, networks, products, and execution gates.",
    },
    "GET /v1/xlayer/tokens": {
      name: "X Layer Token Catalog",
      priceUsd: 0,
      free: true,
      description: "Searchable X Layer token catalog from OKX Onchain OS with DexScreener enrichment when available.",
    },
    "GET /v1/tokens": {
      name: "Selected-network Token Catalog",
      priceUsd: 0,
      free: true,
      description: "Searchable token contracts for X Layer, Base, Arbitrum and Arc Testnet; manual contract entry remains available.",
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
      name: "Global Quick → Spot Market or Limit",
      priceUsd: parsed.PRICE_ANALYSIS_BASE,
      description: "A concise Global Base analysis with live OKX evidence, actionable levels, an Elliott candidate count, invalidation and a Buy-or-Wait conclusion, followed by a prefilled wallet-signed Spot Market or Limit order on a supported execution mainnet.",
    },
    "POST /v1/autopilot/pass/24h": {
      name: "Start Autopilot · 24h",
      priceUsd: parsed.PRICE_AUTOPILOT_PASS_24H,
      description: "Guided start or extension of one owner-controlled Autopilot for 24 active-runtime hours. The caller's Agentic Wallet signs vault selection/creation, policy configuration, capital deposit, registration and start; this x402 endpoint activates AI runtime only after the vault exists. Pausing freezes paid time.",
    },
    "POST /v1/autopilot/pass/7d": {
      name: "Start Autopilot · 7d",
      priceUsd: parsed.PRICE_AUTOPILOT_PASS_7D,
      description: "Guided start or extension of one owner-controlled Autopilot for seven active-runtime days. The caller's Agentic Wallet retains custody and signs every vault, policy, funding and start action; pausing freezes paid time.",
    },
    "POST /v1/autopilot/pass/30d": {
      name: "Start Autopilot · 30d",
      priceUsd: parsed.PRICE_AUTOPILOT_PASS_30D,
      description: "Guided start or extension of one owner-controlled Autopilot for 30 active-runtime days. The caller's Agentic Wallet retains custody and signs every vault, policy, funding and start action; pausing freezes paid time.",
    },
    "POST /v1/analysis/spot/premium": {
      name: "Global Pro → Spot Market or Limit",
      priceUsd: parsed.PRICE_ANALYSIS_PREMIUM,
      description: "A Premium Global analysis with chart, Fibonacci and pivot levels, global Elliott wave paths and DeFi opportunities, followed by a prefilled wallet-signed Spot Market or Limit order on a supported execution mainnet.",
    },
    "POST /v1/analysis/prediction/standard": {
      name: "Prediction Quick",
      priceUsd: parsed.PRICE_ANALYSIS_PREDICTION_STANDARD,
      description: "A concise evidence-based view of one selected Polymarket question with probability, market quality, invalidation, limitations and provenance.",
    },
    "POST /v1/analysis/prediction/premium": {
      name: "Prediction Pro",
      priceUsd: parsed.PRICE_ANALYSIS_PREDICTION_PREMIUM,
      description: "A detailed selected-question analysis with counter-case, execution risk and an independent 4H underlying-asset chart with Fibonacci, pivots and Elliott paths.",
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
      name: "Onchain Pre-Trade Risk Guard",
      priceUsd: parsed.PRICE_PREFLIGHT,
      description: "A deeper PASS/WARN/FAIL token, route, amount and counterparty risk review before an on-chain action. Basic in-product signature checks remain free.",
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
    methodologyVersion: "pulse",
    productName: name,
    productTagline: "Global & Prediction intelligence. Spot execution. Independent guarded Autopilot.",
    productTaglineZh: "全球与预测市场情报。现货执行。独立的受保护自动驾驶。",
    productShortDescription:
      "PULSE turns live Global and selected Prediction Market evidence into readable, recoverable plans, connects Global plans to Agentic-Wallet-signed Spot execution, and offers separate cost-controlled Autopilot start services.",
    productDescription:
      "PULSE provides first-class Global Market and Prediction Market intelligence, connected-wallet Spot execution, Onchain Pre-Trade Risk Guard, and a separate guarded Autopilot workflow for humans and AI agents. Global Market includes live OKX crypto, xStocks and listed RWA instruments while separating broad analysis coverage from identity-safe on-chain execution. Prediction Market analyzes one explicitly selected Polymarket question read-only. The execution-mainnet catalog has eight paid services: two Global tiers leading to Agentic-Wallet-signed Spot Market or Limit orders, two Prediction tiers, Onchain Pre-Trade Risk Guard and three Agentic Wallet Autopilot start services for 24h, 7d or 30d. Autopilot starts directly from its own pair, strategy, capital, risk and duration; it uses deterministic candidate gates, compact prepaid AI entry confirmation and one owner-control dashboard without requiring or reusing a Global report. Arc Testnet exposes only the five analysis/risk services because execution is unavailable there. Reports are durable and wallet-recoverable across X Layer, Base, Arbitrum One and Arc Testnet payment routes.",
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
  const publicServicePaths = new Set([
    "/v1/analysis/spot/standard",
    "/v1/analysis/spot/premium",
    "/v1/analysis/prediction/standard",
    "/v1/analysis/prediction/premium",
    "/v1/preflight",
    "/v1/autopilot/pass/24h",
    "/v1/autopilot/pass/7d",
    "/v1/autopilot/pass/30d",
  ]);
  const isPublicProductRoute = (route: string) => {
    const path = route.split(" ")[1] || "";
    if (!publicServicePaths.has(path)) return false;
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

  // The public catalog contains five analysis/risk services plus three
  // Agentic Wallet Autopilot start services. Spot execution remains a
  // wallet-signed next action rather than a separate paid SKU.
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
    "/v1/preflight",
    "/v1/autopilot/pass/24h",
    "/v1/autopilot/pass/7d",
    "/v1/autopilot/pass/30d",
  ]);
  const networkServices = cfg.enabledNetworks.filter(paymentNetworkEnabled).flatMap((key) => {
    const network = getNetwork(key);
    return publicRoutes.filter(([route, info]) => {
      if (info.free) return false;
      const [, path] = route.split(" ");
      if (!multichainPaidPaths.has(path)) return false;
      return key !== "arc-testnet" || !path.startsWith("/v1/autopilot/pass/");
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
      product: cfg.productName,
      name: cfg.productName,
      type: "A2MCP",
      category: cfg.PRODUCT_CATEGORY,
      tagline: cfg.productTagline,
      taglineZh: cfg.productTaglineZh,
      shortDescription: cfg.productShortDescription,
      description: cfg.productDescription,
      logo: cfg.logoUrl,
      logoPath: cfg.logoPath,
      website: "https://www.ai-pulse.tech",
      repository: "https://github.com/mssystem1/Pulse",
      documentation: "https://github.com/mssystem1/Pulse/blob/main/docs/CIRCLE_AGENT_MARKETPLACE_LISTING.md",
      openApiSpec: "https://raw.githubusercontent.com/mssystem1/ai-pulse/main/docs/circle-marketplace-openapi.yaml",
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
      mcpTransport: "JSON-RPC 2.0 over HTTP",
      mcpProtocolVersion: "2024-11-05",
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
        "recoverable-reports",
        "risk-guard",
        "guarded-autopilot",
        "ai-entry-pass",
        "cost-controlled-automation",
        "xstocks",
        "rwa",
        "persistent-network-selection",
        "grok",
        "chart-analysis",
        "financial-assistant",
      ],
      services: hero,
      featuredServices: services,
      networkServices,
      discovery: {
        okxAi: {
          agentId: 8355,
          publicUrl: "https://www.okx.ai/agents/8355",
          identityNetwork: "eip155:196",
          servicePrefix: "/xlayer",
          settlementAsset: "USDT0",
        },
        cdpBazaar: {
          networks: ["eip155:8453", "eip155:42161"],
          servicePrefixes: ["/base", "/arbitrum"],
          settlementAsset: "native USDC",
          catalog: "Eight services on each execution mainnet: five analysis/risk services plus three Agentic Wallet Autopilot start services. No duplicate ERC-8004 identity is required.",
        },
        circleAgentMarketplace: {
          network: "eip155:5042002",
          servicePrefix: "/arc",
          settlementAsset: "test USDC",
          execution: "analysis and Risk Guard only",
        },
      },
      autopilotAiPass: {
        scope: "one owner-controlled vault",
        plans: [
          { duration: "24h", priceUsd: cfg.PRICE_AUTOPILOT_PASS_24H },
          { duration: "7d", priceUsd: cfg.PRICE_AUTOPILOT_PASS_7D },
          { duration: "30d", priceUsd: cfg.PRICE_AUTOPILOT_PASS_30D },
        ],
        catalogPolicy: "Three public Agentic Wallet Autopilot start services on X Layer, Base and Arbitrum; excluded from Arc Testnet because execution is unavailable there.",
        activation: "Selected during the six-step Autopilot setup and paid through x402 only after the new vault is created and registered. An existing active pass is reused without another charge.",
        renewal: "Manual only. Buying another period appends it to unused paid time; there is no automatic renewal.",
        timer: "Only active Autopilot runtime consumes paid time. Pausing freezes the timer and resuming preserves the unused duration.",
        expiry: "Pausing freezes remaining paid time and reminders. After active paid time expires, new AI-confirmed entries hold while deterministic monitoring and protective exits continue.",
        providerFailure: "Every AI attempt is timestamped before the request. Billing, permission and quota failures open a six-hour circuit breaker instead of retrying on each worker tick.",
        audit: "The unified Autopilot dashboard separates strategy decisions from on-chain activity and exports both streams as CSV.",
      },
      agenticWalletWorkflows: {
        custody: "The caller's Agentic Wallet owns the account or vault and confirms every state-changing contract call. PULSE never receives or uses its private key.",
        globalSpot: {
          services: ["Global Quick → Spot Market or Limit", "Global Pro → Spot Market or Limit"],
          flow: ["Buy and recover the selected Global report", "Choose Market or Limit", "Verify wallet balance, identity-safe token, live route, slippage and optional TP/SL", "Review and sign the prepared transaction in Agentic Wallet"],
        },
        autopilotStart: {
          services: ["Start Autopilot · 24h", "Start Autopilot · 7d", "Start Autopilot · 30d"],
          flow: ["Choose create-new or an existing vault", "Choose pair/timeframe and verify token/route", "Choose strategy", "Choose capital and signed risk profile", "Review Agentic Wallet vault/configuration/funding/registration calls", "Pay the selected x402 runtime and resume/start the registered vault"],
          renewal: "An existing vault skips creation and appends active-runtime time after payment.",
        },
        networks: {
          xlayer: "OKX Agentic Wallet on chain 196; X Layer gas is zero.",
          base: "Agentic Wallet on Base mainnet; keep native ETH for gas.",
          arbitrum: "Agentic Wallet on Arbitrum One; keep native ETH for gas.",
          arcTestnet: "Analysis and Risk Guard only; Spot and Autopilot workflows are unavailable.",
        },
      },
    },
    registration: {
      prompts: [
        "Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS",
        "Help me list my ASP on OKX.AI using Onchain OS",
      ],
      fields: {
        name: cfg.productName,
        description: cfg.productDescription,
        priceHint: "Risk Guard $0.15 · Quick reports $0.20 · Pro reports $0.30 · multichain x402 settlement",
        endpoint: `${base}/mcp`,
        logo: cfg.logoUrl,
      },
    },
  };
}
