/**
 * OKX Payment SDK integration seam
 * --------------------------------
 * Production install (Node):
 *   npm install @okxweb3/x402-express @okxweb3/x402-core @okxweb3/x402-evm
 *
 * Then replace createX402Middleware with:
 *
 * import {
 *   paymentMiddleware,
 *   x402ResourceServer,
 * } from "@okxweb3/x402-express";
 * import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
 * import { OKXFacilitatorClient } from "@okxweb3/x402-core";
 *
 * const facilitatorClient = new OKXFacilitatorClient({
 *   apiKey: process.env.OKX_API_KEY!,
 *   secretKey: process.env.OKX_SECRET_KEY!,
 *   passphrase: process.env.OKX_PASSPHRASE!,
 * });
 * const resourceServer = new x402ResourceServer(facilitatorClient);
 * resourceServer.register("eip155:196", new ExactEvmScheme());
 *
 * app.use(paymentMiddleware({
 *   "POST /v1/token/scan": {
 *     accepts: [{ scheme: "exact", network: "eip155:196", payTo, price: "$0.01" }],
 *     description: "Token risk scan",
 *     mimeType: "application/json",
 *   },
 *   // ...
 * }, resourceServer));
 *
 * Our mock middleware mirrors the same 402 header contract so OKX.AI
 * registration self-checks pass in both modes.
 */

export const OKX_SEAM_DOCS =
  "https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk";
