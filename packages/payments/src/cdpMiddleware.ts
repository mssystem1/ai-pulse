import type { RequestHandler } from "express";
import type { AppConfig, NetworkKey } from "@pulse/config";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createCdpAuthHeaders } from "./cdpAuth.js";
import { inlineSettlement } from "./inlineSettlement.js";

export function buildCdpDiscoveryContract(path: string) {
  const riskGuard = path === "/v1/preflight";
  const autopilotStart = path.startsWith("/v1/autopilot/pass/");
  const prediction = path.includes("prediction") || path.includes("event-risk");
  const fused = path.includes("fused") || path.includes("divergence");
  if (autopilotStart) {
    return {
      input: {
        owner: "0x1111111111111111111111111111111111111111",
        vault: "0x2222222222222222222222222222222222222222",
      },
      inputSchema: {
        properties: {
          owner: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Paying Agentic Wallet address and vault owner" },
          vault: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Owner-controlled vault already configured, funded and registered through Agentic Wallet calls" },
          telegramDelivery: { type: "string", maxLength: 160, description: "Optional chat-bound reminder capability; never wallet authority" },
        },
        required: ["owner", "vault"],
      },
    };
  }
  if (riskGuard) {
    return {
      input: {
        intent: "swap",
        tokenAddress: "0x0000000000000000000000000000000000000001",
        amount: "1",
        notes: "Review this on-chain action before signing",
      },
      inputSchema: {
        properties: {
          intent: { type: "string", enum: ["swap", "transfer", "approve", "hire_agent", "generic"], description: "Action being reviewed" },
          tokenAddress: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Primary token contract, when applicable" },
          walletAddress: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Wallet initiating the action" },
          counterparty: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Router, spender or counterparty contract" },
          fromToken: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Input token contract" },
          toToken: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Output token contract" },
          amount: { type: "string", description: "Human-readable amount under review" },
          notes: { type: "string", maxLength: 500, description: "Optional transaction context" },
        },
        required: [],
      },
    };
  }
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
  return {
    input,
    inputSchema: {
      properties,
      required: ["instId", "primaryMarketId", "lang"].filter((key) => key in input),
    },
  };
}

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
      const { input, inputSchema } = buildCdpDiscoveryContract(req.path);
      const autopilotStart = req.path.startsWith("/v1/autopilot/pass/");
      const extensions = cfg.BAZAAR_DISCOVERABLE ? declareDiscoveryExtension({
        input, inputSchema, bodyType: "json",
        output: { example: autopilotStart
          ? { aiPass: { vault: "owner-controlled-vault", status: "active", expiresAt: "ISO-8601 timestamp" }, behavior: { newEntries: "AI-assisted while runtime is active" } }
          : { job: { id: "opaque-job-id", stage: "payment_settled" }, recoveryToken: "opaque-recovery-token", pollUrl: "/v1/jobs/opaque-job-id" } },
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
