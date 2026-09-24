import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import type { FacilitatorClient } from "@x402/core/server";
import { canonicalPaymentResource, type SettlementRequest } from "./inlineSettlement.js";
import { createRobinhoodPaymentServer } from "./robinhoodServer.js";
import { settleRobinhoodPayment, type RobinhoodJournal, type RobinhoodObserver } from "./robinhoodSettlement.js";
import { buildX402PaymentRequiredBody, getX402OutputSchema } from "./inputContracts.js";

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;

/** Called AFTER application input/evidence prechecks. Production use is gated
 * by explicit configuration and the runtime's signer/durability checks.
 * Uses the same interface for the private embedded facilitator and optional remote
 * providers; no public /settle endpoint or external facilitator credentials. */
export function createRobinhoodPaymentMiddleware(cfg: AppConfig, deps: {
  facilitator: FacilitatorClient; journal: RobinhoodJournal; observer: RobinhoodObserver; provider: string;
}): RequestHandler {
  let server: ReturnType<typeof createRobinhoodPaymentServer> | undefined;
  return (request, response, next) => {
    const req = request as SettlementRequest;
    if (req.pulseNetworkKey !== "robinhood") return next();
    const path = req.path.replace(/\/$/, "");
    const route = cfg.routes[`${req.method.toUpperCase()} ${path}`];
    if (!route || route.free || route.priceUsd <= 0) return next();
    void (async () => {
      server ||= createRobinhoodPaymentServer(deps.facilitator).catch(error => { server = undefined; throw error; });
      const ready = await server;
      const [requirements] = await ready.requirements(route.priceUsd.toFixed(6), cfg.PAY_TO_ADDRESS);
      if (!requirements) throw new Error("Payment requirements unavailable");
      const resourceUrl = canonicalPaymentResource(cfg, "robinhood", path);
      const signature = req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT");
      if (!signature) {
        const challenge = await ready.server.createPaymentRequiredResponse([requirements], { url: resourceUrl, description: route.description, mimeType: "application/json" });
        const described = { ...challenge, outputSchema: getX402OutputSchema(path) };
        response.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(described)).toString("base64"));
        response.status(402).json({ ...described, ...buildX402PaymentRequiredBody(path) });
        return;
      }
      const requestHash = createHash("sha256").update(JSON.stringify({ method: req.method.toUpperCase(), path, body: canonical(req.body ?? null) })).digest("hex");
      const result = await settleRobinhoodPayment({ header: signature, requirements, resourceUrl, requestHash, provider: deps.provider }, deps);
      if (result.status === "rejected") { response.status(400).json({ error: "Payment does not match this request or is no longer valid. No new payment was submitted.", code: result.code }); return; }
      if (result.status !== "settled") {
        response.setHeader("Retry-After", "5");
        response.status(503).json({ error: "Payment confirmation is incomplete. Retry the same signed request; do not pay again.",
          code: result.code, retrySamePayment: true, ...(result.status === "pending" ? { paymentId: result.paymentId } : {}) });
        return;
      }
      const { attempt } = result;
      const receipt = { success: true, transaction: attempt.transaction, network: "eip155:4663", payer: attempt.payer,
        amount: attempt.amount, finality: { scope: "l2", status: "receipt_verified", parentChainStatus: "unknown" } };
      req.pulseSettlement = Object.freeze({ provider: attempt.provider, verifiedAt: attempt.verifiedAt, settledAt: attempt.settledAt!, result: Object.freeze(receipt) });
      response.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify(receipt)).toString("base64"));
      next();
    })().catch(() => {
      if (!response.headersSent) response.status(503).json({ error: "Robinhood payment service unavailable. No new signature is required for an existing payment.", code: "robinhood_payment_unavailable", retrySamePayment: true });
    });
  };
}
