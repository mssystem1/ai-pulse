import type { RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { priceLabel } from "@pulse/config";
import { paymentMiddleware, x402ResourceServer } from "@okxweb3/x402-express";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { buildX402PaymentRequiredBody } from "./inputContracts.js";

/**
 * Official OKX x402 seller middleware.
 * Docs: https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk
 */
export function createOkxPaymentMiddleware(cfg: AppConfig): RequestHandler {
  if (!cfg.OKX_API_KEY || !cfg.OKX_SECRET_KEY || !cfg.OKX_PASSPHRASE) {
    throw new Error(
      "OKX credentials required for live x402 (OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE or OKX_XLAYER_* aliases)",
    );
  }

  const facilitatorClient = new OKXFacilitatorClient({
    apiKey: cfg.OKX_API_KEY,
    secretKey: cfg.OKX_SECRET_KEY,
    passphrase: cfg.OKX_PASSPHRASE,
    baseUrl: cfg.OKX_BASE_URL || "https://web3.okx.com",
    syncSettle: true,
  });

  const network = cfg.X402_NETWORK as `${string}:${string}`;
  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(network, new ExactEvmScheme());

  // RoutesConfig shape from @okxweb3/x402-express (not fully exported as type)
  const routes: Record<
    string,
    {
      accepts: Array<{
        scheme: string;
        network: `${string}:${string}`;
        payTo: string;
        price: string;
      }>;
      description: string;
      mimeType: string;
      unpaidResponseBody: () => {
        contentType: string;
        body: unknown;
      };
    }
  > = {};

  for (const [routeKey, info] of Object.entries(cfg.routes)) {
    if (info.free || info.priceUsd <= 0) continue;
    routes[routeKey] = {
      accepts: [
        {
          scheme: "exact",
          network,
          payTo: cfg.PAY_TO_ADDRESS,
          price: priceLabel(info.priceUsd),
        },
      ],
      description: info.description,
      mimeType: "application/json",
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: buildX402PaymentRequiredBody(routeKey.split(" ")[1] || routeKey),
      }),
    };
  }

  return paymentMiddleware(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routes as any,
    resourceServer,
    {
      appName: cfg.productName,
      appLogo: cfg.logoUrl,
      currentUrl: cfg.BASE_URL,
      testnet: String(cfg.X402_NETWORK).includes("1952"),
    },
    undefined,
    true,
  );
}
