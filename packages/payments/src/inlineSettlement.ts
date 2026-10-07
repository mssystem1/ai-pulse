import type { Request, Response, NextFunction } from "express";
import type { AppConfig, NetworkKey } from "@pulse/config";
import { getNetwork, usdToAtomic } from "@pulse/config";

type PaymentRequirements = {
  scheme?: unknown; network?: unknown; asset?: unknown; amount?: unknown; payTo?: unknown;
  extra?: { name?: unknown; version?: unknown; verifyingContract?: unknown };
};
type PaymentPayload = {
  x402Version?: unknown;
  resource?: { url?: unknown };
  accepted?: PaymentRequirements;
};
type Facilitator = {
  verify(payload: never, requirements: never): Promise<{ isValid?: boolean; invalidReason?: string; invalidMessage?: string }>;
  settle(payload: never, requirements: never): Promise<{ success?: boolean; transaction?: string; network?: string; payer?: string; amount?: string; errorReason?: string; errorMessage?: string }>;
};

export type PulseSettlement = Readonly<{
  provider: string;
  result: Record<string, unknown>;
  verifiedAt: string;
  settledAt: string;
}>;

export type SettlementRequest = Request & { pulseNetworkKey?: NetworkKey; pulseSettlement?: PulseSettlement };

export function canonicalPaymentResource(cfg: Pick<AppConfig, "BASE_URL">, network: NetworkKey, path: string) {
  const prefix = network === "arc" ? "arc" : network;
  return new URL(`/${prefix}${path}`, cfg.BASE_URL).href;
}

function decodePayment(header: string): PaymentPayload {
  const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
  if (!parsed || typeof parsed !== "object" || parsed.x402Version !== 2 || !parsed.accepted) {
    throw new Error("Malformed x402 v2 payment payload");
  }
  return parsed;
}

function sameAddress(left: unknown, right: string) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

export function validateSignedPayment(cfg: AppConfig, req: SettlementRequest, payload: PaymentPayload) {
  const key = req.pulseNetworkKey || "xlayer";
  const network = getNetwork(key);
  const route = cfg.routes[`${req.method.toUpperCase()} ${req.path}`];
  if (!route || route.free || route.priceUsd <= 0) throw new Error("No paid route configuration");
  const accepted = payload.accepted!;
  const expectedPayee = cfg.PAY_TO_ADDRESS;
  const expectedAsset = network.paymentAsset.address || cfg.X402_ASSET;
  if (accepted.scheme !== "exact") throw new Error("Payment scheme mismatch");
  if (accepted.network !== network.caip2) throw new Error("Payment network mismatch");
  if (!sameAddress(accepted.asset, expectedAsset)) throw new Error("Payment asset mismatch");
  if (String(accepted.amount) !== usdToAtomic(route.priceUsd)) throw new Error("Payment amount mismatch");
  if (!sameAddress(accepted.payTo, expectedPayee)) throw new Error("Payment payee mismatch");
  if (key === "arc" && (accepted.extra?.name !== "GatewayWalletBatched" || accepted.extra?.version !== "1"
    || !sameAddress(accepted.extra?.verifyingContract, "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE"))) {
    throw new Error("Arc mainnet Gateway signing domain mismatch");
  }
  if (typeof payload.resource?.url !== "string") throw new Error("Payment resource URL missing");
  const resource = new URL(payload.resource.url, cfg.BASE_URL);
  const allowedPaths = new Set([req.path, req.originalUrl.split("?")[0], new URL(canonicalPaymentResource(cfg, key, req.path)).pathname]);
  if (resource.origin !== new URL(cfg.BASE_URL).origin || !allowedPaths.has(resource.pathname)) {
    throw new Error("Payment resource mismatch");
  }
  return accepted;
}

export function inlineSettlement(
  cfg: AppConfig,
  provider: string,
  facilitator: Facilitator,
  fallback: (req: Request, res: Response, next: NextFunction) => unknown,
) {
  return async (req: SettlementRequest, res: Response, next: NextFunction) => {
    const signature = req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT");
    if (!signature) return fallback(req, res, next);
    try {
      const payload = decodePayment(signature);
      const requirements = validateSignedPayment(cfg, req, payload);
      const verifiedAt = new Date().toISOString();
      const verification = await facilitator.verify(payload as never, requirements as never);
      if (!verification.isValid) {
        return res.status(402).json({ error: verification.invalidMessage || verification.invalidReason || "Payment verification failed" });
      }
      const settlement = await facilitator.settle(payload as never, requirements as never);
      if (!settlement.success) {
        return res.status(402).json({ error: settlement.errorMessage || settlement.errorReason || "Payment settlement failed" });
      }
      const settledAt = new Date().toISOString();
      req.pulseSettlement = Object.freeze({ provider, result: Object.freeze({ ...settlement }), verifiedAt, settledAt });
      res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify(settlement), "utf8").toString("base64"));
      return next();
    } catch (error) {
      return res.status(402).json({ error: error instanceof Error ? error.message : "Payment processing failed" });
    }
  };
}
