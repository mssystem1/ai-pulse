import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { usdToAtomic } from "@pulse/config";
import { createOkxPaymentMiddleware } from "./okxMiddleware.js";
import { buildX402PaymentRequiredBody, getX402OutputSchema } from "./inputContracts.js";

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
): PaymentChallenge {
  const url = `${cfg.BASE_URL.replace(/\/$/, "")}${path}`;
  return {
    x402Version: 2,
    outputSchema: getX402OutputSchema(path),
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

    const challenge = buildChallenge(cfg, path, route.priceUsd, route.description);
    const encoded = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
    res.setHeader("PAYMENT-REQUIRED", encoded);
    res.setHeader("Content-Type", "application/json");
    return res.status(402).json({
      error: "Payment Required",
      priceUsd: route.priceUsd,
      network: cfg.X402_NETWORK,
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
  if (cfg.paymentMode === "okx") {
    try {
      console.log("[payments] Using official OKX x402 Payment SDK (live facilitator)");
      return createOkxPaymentMiddleware(cfg);
    } catch (err) {
      console.error("[payments] Failed to init OKX middleware, falling back to mock:", err);
      return createX402Middleware({ ...cfg, paymentMode: "mock", X402_MOCK: true });
    }
  }
  console.log("[payments] Using mock x402 gate (set X402_MOCK=0 + OKX keys for live)");
  return createX402Middleware(cfg);
}

export { createMcpPaymentGate } from "./mcpGate.js";
export { createOkxPaymentMiddleware } from "./okxMiddleware.js";
export {
  buildX402InputRequired,
  buildX402PaymentRequiredBody,
  getX402InputDefinition,
  getX402OutputSchema,
} from "./inputContracts.js";
