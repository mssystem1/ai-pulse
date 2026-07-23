import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  XAI_API_KEY: z.string().optional().default(""),
  XAI_BASE_URL: z.string().optional().default("https://api.x.ai/v1"),
  GROK_MODEL: z.string().optional().default("grok-4.3"),
  X_LAYER_RPC: z.string().default("https://rpc.xlayer.tech"),
  X_LAYER_RPC_FALLBACK: z.string().default("https://xlayerrpc.okx.com"),
  PRICE_TOKEN_SCAN: z.coerce.number().default(0.01),
  PRICE_WALLET_SCAN: z.coerce.number().default(0.01),
  PRICE_MARKET_PULSE: z.coerce.number().default(0.01),
  PRICE_SWAP_QUOTE: z.coerce.number().default(0.02),
  PRICE_PREFLIGHT: z.coerce.number().default(0.05),
  PRICE_ANALYSIS_BASE: z.coerce.number().default(0.03),
  PRICE_ANALYSIS_PREMIUM: z.coerce.number().default(0.06),
  PRODUCT_LOGO_URL: z.string().optional().default(""),
  PRODUCT_CATEGORY: z.string().optional().default("Financial Assistant"),
  PRODUCT_NAME: z.string().optional().default("PULSE"),
  TEST_WALLET_PRIVATE_KEY: z.string().optional().default(""),
  TEST_WALLET_ADDRESS: z.string().optional().default(""),
  ENABLE_SERVER_PAY: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
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
      name: "X Layer Contract Evidence",
      priceUsd: 0,
      free: true,
      description: "Live X Layer RPC evidence for any address: code, bytecode size, nonce, balance, and common proxy patterns.",
    },
    "POST /v1/dex/swap": {
      name: "OKX DEX Funding Transaction",
      priceUsd: 0,
      free: true,
      description: "Free: prepare an OKB to USDT0 transaction for the connected wallet.",
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
    methodologyVersion: "pulse-v2.0.0",
    productName: name,
    productTagline: "OKX spot intelligence. Pay per signal on X Layer.",
    productTaglineZh: "欧易现货智能研报 · X Layer 按次付费",
    productShortDescription:
      "PULSE is an A2MCP service: free OKX spot teasers plus Grok-powered chart & market analysis (base/premium), settled in USD₮0 via x402 on X Layer. Humans and agents get the same intelligence.",
    productDescription:
      "PULSE delivers OKX spot market intelligence for humans and AI agents. Free teaser: live tickers and candles for any OKX spot pair (chart data from OKX API only). Paid: Grok analyzes that OHLCV series — base ($0.03) and premium ($0.06) USD₮0 on X Layer via x402. Safety tools cover token risk and pre-trade checks. Built for OKX.AI marketplace, EN/CN UI, official OKX Payment SDK; marketplace callers pay with Agentic Wallet automatically.",
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
  const services = Object.entries(cfg.routes)
    .filter(([k]) => !k.includes("Legacy") && !k.includes("wallet") && !k.includes("pulse") && !k.includes("swap"))
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
  const hero = Object.entries(cfg.routes).map(([route, info]) => {
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

  return {
    asp: {
      name: cfg.productName,
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
        "okx",
        "spot",
        "grok",
        "chart-analysis",
        "financial-assistant",
      ],
      services: hero,
      featuredServices: services,
    },
    registration: {
      prompts: [
        "Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS",
        "Help me list my ASP on OKX.AI using Onchain OS",
      ],
      fields: {
        name: cfg.productName,
        description: cfg.productDescription,
        priceHint: "Free teaser · Base $0.03 · Premium $0.06",
        endpoint: `${base}/mcp`,
        logo: cfg.logoUrl,
      },
    },
  };
}
