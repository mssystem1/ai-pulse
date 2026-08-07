import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { getNetwork, usdToAtomic, type NetworkKey } from "@pulse/config";
import { createOkxPaymentMiddleware } from "./okxMiddleware.js";
import { buildX402PaymentRequiredBody, getX402OutputSchema } from "./inputContracts.js";
import { createCircleGatewayPaymentMiddleware } from "./circleMiddleware.js";
import { createCdpPaymentMiddleware } from "./cdpMiddleware.js";

export type PaymentChallenge = {
  x402Version: number;
  outputSchema?: ReturnType<typeof getX402OutputSchema>;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: { name: string; version: string };
  }>;
};

export function buildChallenge(
  cfg: AppConfig,
  path: string,
  priceUsd: number,
  description: string,
  contractPath = path,
): PaymentChallenge {
  const url = `${cfg.BASE_URL.replace(/\/$/, "")}${path}`;
  return {
    x402Version: 2,
    outputSchema: getX402OutputSchema(contractPath),
    resource: {
      url,
      description,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: cfg.X402_NETWORK,
        asset: cfg.X402_ASSET,
        amount: usdToAtomic(priceUsd),
        payTo: cfg.PAY_TO_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: { name: "USD₮0", version: "1" },
      },
    ],
  };
}

/**
 * Mock / fallback middleware (no OKX facilitator).
 * Used when X402_MOCK=1 or credentials missing.
 */
export function createX402Middleware(cfg: AppConfig): RequestHandler {
  return function x402Middleware(req: Request, res: Response, next: NextFunction) {
    const method = req.method.toUpperCase();
    const path = normalizePath(req.path);
    const key = `${method} ${path}`;
    const route = cfg.routes[key];

    if (!route || route.free || route.priceUsd <= 0) {
      return next();
    }

    const sig =
      (req.header("PAYMENT-SIGNATURE") ||
        req.header("payment-signature") ||
        req.header("X-PAYMENT") ||
        "") as string;

    if (sig && verifyPaymentHeader(sig, cfg)) {
      res.setHeader("PAYMENT-RESPONSE", mockReceipt(sig));
      return next();
    }

    const networkKey = (req as Request & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey || "xlayer";
    const network = getNetwork(networkKey);
    const effectiveCfg = {
      ...cfg, X402_NETWORK: network.caip2,
      X402_ASSET: network.paymentAsset.address || cfg.X402_ASSET,
      PAY_TO_ADDRESS: networkKey === "arc-testnet" ? cfg.CIRCLE_GATEWAY_SELLER_ADDRESS : cfg.PAY_TO_ADDRESS,
    };
    const publicPath = req.originalUrl.split("?")[0] || path;
    const challenge = buildChallenge(effectiveCfg, publicPath, route.priceUsd, route.description, path);
    const encoded = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
    res.setHeader("PAYMENT-REQUIRED", encoded);
    res.setHeader("Content-Type", "application/json");
    return res.status(402).json({
      error: "Payment Required",
      priceUsd: route.priceUsd,
      network: network.caip2,
      x402Version: 2,
      accepts: challenge.accepts,
      paymentMode: cfg.paymentMode,
      ...buildX402PaymentRequiredBody(path),
    });
  };
}

export function verifyPaymentHeader(sig: string, cfg: AppConfig): boolean {
  if (!sig || !sig.trim()) return false;
  if (cfg.X402_MOCK || cfg.paymentMode === "mock") return true;
  if (!cfg.OKX_API_KEY || !cfg.OKX_SECRET_KEY || !cfg.OKX_PASSPHRASE) {
    return false;
  }
  return sig.length > 16;
}

function mockReceipt(sig: string): string {
  return Buffer.from(
    JSON.stringify({
      success: true,
      mock: true,
      sigHash: sig.slice(0, 16),
      settledAt: new Date().toISOString(),
    }),
    "utf8",
  ).toString("base64");
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * Official OKX x402 middleware when paymentMode=okx, else mock gate.
 */
export function createPaymentGate(cfg: AppConfig): RequestHandler {
  const mock = createX402Middleware(cfg);
  const circle = cfg.CIRCLE_GATEWAY_ENABLED && cfg.FEATURE_ARC_PAYMENTS && cfg.CIRCLE_GATEWAY_SELLER_ADDRESS
    ? createCircleGatewayPaymentMiddleware(cfg) : null;
  const cdp = (cfg.FEATURE_BASE_PAYMENTS || cfg.FEATURE_ARBITRUM_PAYMENTS) && cfg.CDP_API_KEY_ID && cfg.CDP_API_KEY_SECRET
    ? createCdpPaymentMiddleware(cfg) : null;
  const xlayer = cfg.paymentMode === "okx" ? (() => {
    try { return createOkxPaymentMiddleware(cfg); }
    catch (err) { console.error("[payments] Failed to init OKX middleware, falling back to mock:", err); return mock; }
  })() : mock;
  return (req, res, next) => {
    const networkKey = (req as Request & { pulseNetworkKey?: string }).pulseNetworkKey || "xlayer";
    if (cfg.X402_MOCK || cfg.paymentMode === "mock") return mock(req, res, next);
    if (networkKey === "arc-testnet") {
      if (!circle) return res.status(503).json({ error: "Circle Gateway payment adapter is disabled" });
      return circle(req, res, next);
    }
    if (networkKey === "base" || networkKey === "arbitrum") {
      if (!cdp) return res.status(503).json({ error: "CDP payment adapter is not initialized" });
      return cdp(req, res, next);
    }
    return xlayer(req, res, next);
  };
}

export { createMcpPaymentGate } from "./mcpGate.js";
export { createOkxPaymentMiddleware } from "./okxMiddleware.js";
export { createCircleGatewayPaymentMiddleware } from "./circleMiddleware.js";
export { createCdpPaymentMiddleware } from "./cdpMiddleware.js";
export { createCdpJwt } from "./cdpAuth.js";
export { inlineSettlement, validateSignedPayment, type PulseSettlement, type SettlementRequest } from "./inlineSettlement.js";
export {
  buildX402InputRequired,
  buildX402PaymentRequiredBody,
  getX402InputDefinition,
  getX402OutputSchema,
} from "./inputContracts.js";
