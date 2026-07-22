import type { AppConfig } from "@pulse/config";
import { buildChallenge, verifyPaymentHeader } from "./index.js";

const PAID_TOOLS: Record<string, { routePath: string; priceKey: string }> = {
  analysis_base: { routePath: "/v1/analysis/base", priceKey: "POST /v1/analysis/base" },
  analysis_premium: {
    routePath: "/v1/analysis/premium",
    priceKey: "POST /v1/analysis/premium",
  },
  token_scan: { routePath: "/v1/token/scan", priceKey: "POST /v1/token/scan" },
  wallet_scan: { routePath: "/v1/wallet/scan", priceKey: "POST /v1/wallet/scan" },
  market_pulse: { routePath: "/v1/market/pulse", priceKey: "POST /v1/market/pulse" },
  swap_quote: { routePath: "/v1/swap/quote", priceKey: "POST /v1/swap/quote" },
  preflight: { routePath: "/v1/preflight", priceKey: "POST /v1/preflight" },
};

export type McpGateResult =
  | { ok: true }
  | { ok: false; status: 402; headers: Record<string, string>; body: unknown };

/**
 * Gate paid MCP tool calls. Free tools (resolve) and handshake methods skip.
 */
export function createMcpPaymentGate(cfg: AppConfig) {
  return function gateToolCall(
    toolName: string,
    paymentSignature: string | undefined,
  ): McpGateResult {
    const paid = PAID_TOOLS[toolName];
    if (!paid) return { ok: true };

    const route = cfg.routes[paid.priceKey];
    if (!route || route.free || route.priceUsd <= 0) return { ok: true };

    if (paymentSignature && verifyPaymentHeader(paymentSignature, cfg)) {
      return { ok: true };
    }

    const challenge = buildChallenge(
      cfg,
      paid.routePath,
      route.priceUsd,
      route.description,
    );
    const encoded = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
    return {
      ok: false,
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encoded,
        "Content-Type": "application/json",
      },
      body: {
        error: "Payment Required",
        tool: toolName,
        priceUsd: route.priceUsd,
        network: cfg.X402_NETWORK,
        x402Version: 2,
        accepts: challenge.accepts,
      },
    };
  };
}
