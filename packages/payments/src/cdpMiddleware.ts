import type { RequestHandler } from "express";
import { getNetwork, type AppConfig, type NetworkKey } from "@pulse/config";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createCdpAuthHeaders } from "./cdpAuth.js";
import { canonicalPaymentResource, inlineSettlement } from "./inlineSettlement.js";
import { isIndicatorPurchasePath } from "./inputContracts.js";

export function buildCdpDiscoveryContract(path: string, networkKey: "base" | "arbitrum" = "base") {
  if (isIndicatorPurchasePath(path)) return {
    input: { requestId: "owner-generated-indicator-quote-id" },
    inputSchema: { properties: { requestId: { type: "string", minLength: 16, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$", description: "Use the original requestId from this exact creator-service quote. Requires Terminal wallet authentication and reviewed network, token, creator recipient, amount and immutable indicator version." } }, required: ["requestId"] },
  };
  if (path.startsWith("/v1/terminal/pass/")) return {
    input: { requestId: "owner-generated-purchase-request-id" },
    inputSchema: { properties: { requestId: { type: "string", minLength: 16, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$", description: "Stable owner-scoped purchase ID retained for receipt recovery. A Terminal wallet-ownership bearer session is also required." } }, required: ["requestId"] },
  };
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
    const network = getNetwork(networkKey);
    return {
      input: {
        tokenAddress: network.paymentAsset.address,
        chainId: String(network.chainId),
        lang: "en",
        notes: "Review this on-chain action before signing",
      },
      inputSchema: {
        properties: {
          intent: { type: "string", enum: ["swap", "transfer", "approve", "hire_agent", "generic"], description: "Action being reviewed" },
          tokenAddress: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Primary token contract, when applicable" },
          chainId: { type: "string", description: "Must match the selected settlement network" },
          lang: { type: "string", enum: ["en", "zh"] },
          walletAddress: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Wallet initiating the action" },
          counterparty: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Router, spender or counterparty contract" },
          fromToken: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Input token contract" },
          toToken: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$", description: "Output token contract" },
          amount: { type: "string", description: "Human-readable amount under review" },
          notes: { type: "string", maxLength: 500, description: "Optional transaction context" },
        },
        required: ["tokenAddress", "lang"],
      },
    };
  }
  const exampleMarket = "pm:0x8717c39520cadcb8ad6f88af148c30acf7d044c92a9cf48416b9b9a5ed65d6d8";
  const input = prediction
    ? { primaryMarketId: exampleMarket, additionalMarketIds: [], lang: "en" }
    : fused
      ? { instId: "BTC-USDT", timeframe: "1H", primaryMarketId: exampleMarket, additionalMarketIds: [], lang: "en" }
      : { instId: "BTC-USDT", timeframe: "1H", lang: "en" };
  const properties: Record<string, unknown> = {
    ...(fused || !prediction ? { instId: { type: "string", description: "OKX spot instrument, for example BTC-USDT" }, timeframe: { type: "string", description: "Analysis timeframe" } } : {}),
    ...(prediction || fused ? { primaryMarketId: { type: "string", description: "Caller-selected active market from /v1/polymarket/markets; verify its detail before payment. Example is a historical snapshot, not guaranteed active." }, additionalMarketIds: { type: "array", items: { type: "string" }, maxItems: 6 } } : {}),
    lang: { type: "string", enum: ["en", "zh"] },
  };
  return {
    input,
    inputSchema: {
      properties,
      required: ["instId", "timeframe", "primaryMarketId", "lang"].filter((key) => key in input),
    },
  };
}

export function buildCdpDiscoveryOutput(path: string, networkKey: "base" | "arbitrum" = "base") {
  if (isIndicatorPurchasePath(path)) {
    const network = getNetwork(networkKey);
    return {
      entitled: true,
      purchase: {
        id: path.split("/").at(-1)!, listingId: "pmi_11111111111111111111111111111111", version: "1.0.0",
        sha256: "0".repeat(64), state: "granted", network: networkKey, asset: network.paymentAsset.address,
        assetSymbol: network.paymentAsset.symbol, amountAtomic: "1000", payee: "0x1111111111111111111111111111111111111111",
        settlementTx: `0x${"0".repeat(64)}`, grantedAt: "ISO-8601 timestamp", platformFeeAtomic: "0", creatorReceivesAtomic: "1000",
      },
      recovered: false,
    };
  }
  if (path.startsWith("/v1/terminal/pass/")) return { grant: { requestId: "owner-generated-purchase-request-id", duration: "24h", expiresAt: "ISO-8601 timestamp" }, access: { active: true, expiresAt: "ISO-8601 timestamp" }, recovered: false };
  if (path.startsWith("/v1/autopilot/pass/")) return { aiPass: { vault: "owner-controlled-vault", status: "active", expiresAt: "ISO-8601 timestamp" }, behavior: { newEntries: "AI-assisted while runtime is active" } };
  if (path === "/v1/preflight") return { reportMarkdown: "Full token due-diligence report", history: { jobId: "opaque-job-id", recoveryToken: "opaque-recovery-token" } };
  return { job: { id: "opaque-job-id", stage: "payment_settled" }, recoveryToken: "opaque-recovery-token", pollUrl: "/v1/jobs/opaque-job-id", reportUrl: "/v1/jobs/opaque-job-id/report", delivery: { status: "processing", authHeader: "PULSE-RECOVERY-TOKEN", paymentRequired: false } };
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
      const { input, inputSchema } = buildCdpDiscoveryContract(req.path, key);
      const extensions = cfg.BAZAAR_DISCOVERABLE ? declareDiscoveryExtension({
        input, inputSchema, bodyType: "json",
        output: { example: buildCdpDiscoveryOutput(req.path, key) },
      }) : undefined;
      middleware = paymentMiddleware({
        [`${req.method.toUpperCase()} ${req.path}`]: {
          resource: canonicalPaymentResource(cfg, key, req.path),
          accepts: [{ scheme: "exact", price: `$${req.path.startsWith("/v1/terminal/pass/") || req.path.startsWith("/v1/terminal/indicators/purchases/") ? route.priceUsd.toFixed(6) : route.priceUsd.toFixed(2)}`, network, payTo: cfg.PAY_TO_ADDRESS }],
          description: route.description, mimeType: "application/json",
          ...(extensions ? { extensions } : {}),
        },
      }, server) as RequestHandler;
      cache.set(cacheKey, middleware);
    }
    return inlineSettlement(cfg, "cdp", facilitator, middleware)(req, res, next);
  };
}
