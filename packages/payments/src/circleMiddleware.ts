import type { RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { canonicalPaymentResource, validateSignedPayment, type SettlementRequest } from "./inlineSettlement.js";
import { createHash } from "node:crypto";

export type CirclePaymentAttempt = {
  id: string; requestHash: string; state: "claimed" | "settled";
  responseHeader?: string; payment?: { verified: boolean; payer: string; amount: string; network: string; transaction?: string };
};
export type CirclePaymentJournal = {
  get(id: string): Promise<CirclePaymentAttempt | null>;
  claim(attempt: CirclePaymentAttempt): Promise<boolean>;
  replace(previous: CirclePaymentAttempt, next: CirclePaymentAttempt): Promise<boolean>;
};

export function createCircleGatewayPaymentMiddleware(cfg: AppConfig, journal?: CirclePaymentJournal): RequestHandler {
  if (!cfg.CIRCLE_GATEWAY_ENABLED || !cfg.FEATURE_ARC_PAYMENTS) {
    throw new Error("Circle Gateway payments are disabled");
  }
  const networks = cfg.CIRCLE_GATEWAY_ACCEPTED_NETWORKS.split(",").map((item) => item.trim()).filter(Boolean);
  if (networks.length !== 1 || networks[0] !== "eip155:5042") throw new Error("Circle Gateway must accept only Arc mainnet eip155:5042");
  const gateway = createGatewayMiddleware({
    sellerAddress: cfg.PAY_TO_ADDRESS,
    networks,
    facilitatorUrl: cfg.CIRCLE_GATEWAY_MAINNET_URL,
    arcPrivateMainnet: false,
    description: "PULSE Arc Mainnet analysis payment",
  });
  return (req, res, next) => {
    const route = cfg.routes[`${req.method.toUpperCase()} ${req.path}`];
    if (!route || route.free || route.priceUsd <= 0) return next();
    const signed = req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT");
    if (signed) {
      try {
        const payload = JSON.parse(Buffer.from(signed, "base64").toString("utf8"));
        if (payload?.x402Version !== 2 || !payload.accepted) throw new Error("Malformed x402 v2 payment");
        validateSignedPayment(cfg, req as SettlementRequest, payload);
      } catch {
        return void res.status(402).json({ error: "Payment does not match the Arc mainnet service, amount, recipient or Gateway signing domain" });
      }
    }
    // Circle reads req.url directly; Express has removed the mounted /arc prefix.
    // Supply the public URL without changing Express routing or losing req.payment.
    const resource = new URL(canonicalPaymentResource(cfg, "arc", req.path));
    resource.search = new URL(req.originalUrl, cfg.BASE_URL).search;
    const gatewayRequest = new Proxy(req, {
      get(target, property) {
        return property === "url" ? resource.href : Reflect.get(target, property, target);
      },
    });
    const run = async () => {
      let claim: CirclePaymentAttempt | undefined;
      if (signed && journal) {
        const id = createHash("sha256").update(signed).digest("hex");
        const requestHash = createHash("sha256").update(JSON.stringify({ method: req.method, resource: resource.href, body: req.body })).digest("hex");
        const existing = await journal.get(id);
        if (existing) {
          if (existing.requestHash !== requestHash) return void res.status(409).json({ error: "This payment belongs to a different request", code: "payment_request_mismatch" });
          if (existing.state === "settled" && existing.responseHeader && existing.payment) {
            Object.assign(req, { payment: existing.payment });
            res.setHeader("PAYMENT-RESPONSE", existing.responseHeader);
            return void next();
          }
          return void res.status(503).json({ error: "Payment is processing or requires reconciliation. Preserve this authorization; no new payment is requested.", code: "arc_payment_reconciliation_required", retrySamePayment: true });
        }
        claim = { id, requestHash, state: "claimed" };
        if (!await journal.claim(claim)) return void res.status(503).json({ error: "This payment is already being processed. Retry the same authorization.", code: "arc_payment_processing", retrySamePayment: true });
      }
      await gateway.require(`$${route.priceUsd.toFixed(2)}`)(gatewayRequest, res, async () => {
        if (claim && journal) {
          const responseHeader = res.getHeader("PAYMENT-RESPONSE");
          const payment = (req as typeof req & { payment?: CirclePaymentAttempt["payment"] }).payment;
          if (typeof responseHeader !== "string" || !payment?.verified || payment.network !== "eip155:5042") throw new Error("Arc payment receipt unavailable; reconciliation required");
          try {
            if (!await journal.replace(claim, { ...claim, state: "settled", responseHeader, payment })) throw new Error();
          } catch { throw new Error("Arc payment was accepted; durable receipt reconciliation required. Preserve the authorization"); }
        }
        return next();
      });
    };
    void run().catch(() => {
      if (!res.headersSent) res.status(503).json({ error: "Arc payment storage is unavailable. Preserve this authorization and retry; no new payment is requested.", code: "arc_payment_storage_unavailable", retrySamePayment: true });
    });
  };
}
