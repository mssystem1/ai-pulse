import type { RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

export function createCircleGatewayPaymentMiddleware(cfg: AppConfig): RequestHandler {
  if (!cfg.CIRCLE_GATEWAY_ENABLED || !cfg.FEATURE_ARC_PAYMENTS) {
    throw new Error("Circle Gateway payments are disabled");
  }
  const networks = cfg.CIRCLE_GATEWAY_ACCEPTED_NETWORKS.split(",").map((item) => item.trim()).filter(Boolean);
  if (!networks.includes("eip155:5042002")) throw new Error("Circle Gateway must accept Arc Testnet eip155:5042002");
  const gateway = createGatewayMiddleware({
    sellerAddress: cfg.CIRCLE_GATEWAY_SELLER_ADDRESS,
    networks,
    facilitatorUrl: cfg.CIRCLE_GATEWAY_TESTNET_URL,
    description: "PULSE Arc Testnet analysis payment",
  });
  return (req, res, next) => {
    const route = cfg.routes[`${req.method.toUpperCase()} ${req.path}`];
    if (!route || route.free || route.priceUsd <= 0) return next();
    return void gateway.require(`$${route.priceUsd.toFixed(2)}`)(req, res, next);
  };
}
