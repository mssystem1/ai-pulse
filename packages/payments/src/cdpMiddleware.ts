import type { RequestHandler } from "express";
import type { AppConfig, NetworkKey } from "@pulse/config";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createCdpAuthHeaders } from "./cdpAuth.js";
import { inlineSettlement } from "./inlineSettlement.js";

export function createCdpPaymentMiddleware(cfg: AppConfig): RequestHandler {
  const facilitator = new HTTPFacilitatorClient({
    url: cfg.CDP_FACILITATOR_URL,
    createAuthHeaders: createCdpAuthHeaders(cfg.CDP_FACILITATOR_URL, cfg.CDP_API_KEY_ID, cfg.CDP_API_KEY_SECRET),
  });
  const server = new x402ResourceServer(facilitator)
    .register("eip155:8453", new ExactEvmScheme())
    .register("eip155:42161", new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  const cache = new Map<string, RequestHandler>();
  return (req, res, next) => {
    const key = (req as typeof req & { pulseNetworkKey?: NetworkKey }).pulseNetworkKey;
    if (key !== "base" && key !== "arbitrum") return next();
    const route = cfg.routes[`${req.method.toUpperCase()} ${req.path}`];
    if (!route || route.free || route.priceUsd <= 0) return next();
    const network = key === "base" ? "eip155:8453" : "eip155:42161";
    const cacheKey = `${req.method}:${req.path}:${network}:${route.priceUsd}`;
    let middleware = cache.get(cacheKey);
    if (!middleware) {
      const prediction = req.path.includes("prediction") || req.path.includes("event-risk");
      const fused = req.path.includes("fused") || req.path.includes("divergence");
      const input = prediction
        ? { primaryMarketId: "pm:condition-id", additionalMarketIds: [], lang: "en" }
        : fused
          ? { instId: "BTC-USDT", timeframe: "1H", primaryMarketId: "pm:condition-id", additionalMarketIds: [], lang: "en" }
          : { instId: "BTC-USDT", timeframe: "1H", lang: "en" };
      const properties: Record<string, unknown> = {
        ...(fused || !prediction ? { instId: { type: "string", description: "OKX spot instrument, for example BTC-USDT" }, timeframe: { type: "string", description: "Analysis timeframe" } } : {}),
        ...(prediction || fused ? { primaryMarketId: { type: "string", description: "Canonical Polymarket market identifier selected by the caller" }, additionalMarketIds: { type: "array", items: { type: "string" }, maxItems: 6 } } : {}),
        lang: { type: "string", enum: ["en", "zh"] },
      };
      const required = ["instId", "primaryMarketId", "lang"].filter((key) => key in input);
      const extensions = cfg.BAZAAR_DISCOVERABLE ? declareDiscoveryExtension({
        input, inputSchema: { properties, required }, bodyType: "json",
        output: { example: { job: { id: "opaque-job-id", stage: "payment_settled" }, recoveryToken: "opaque-recovery-token", pollUrl: "/v1/jobs/opaque-job-id" } },
      }) : undefined;
      middleware = paymentMiddleware({
        [`${req.method.toUpperCase()} ${req.path}`]: {
          accepts: [{ scheme: "exact", price: `$${route.priceUsd.toFixed(2)}`, network, payTo: cfg.PAY_TO_ADDRESS }],
          description: route.description, mimeType: "application/json",
          ...(extensions ? { extensions } : {}),
        },
      }, server) as RequestHandler;
      cache.set(cacheKey, middleware);
    }
    return inlineSettlement(cfg, "cdp", facilitator, middleware)(req, res, next);
  };
}
