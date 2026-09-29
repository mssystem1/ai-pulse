import type { RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { createRobinhoodGasSigner, createRobinhoodPaymentMiddleware, createRobinhoodSelfHostedFacilitator, robinhoodPaymentObserver } from "@pulse/payments";
import { createPublicClient, http, isAddress, parseAbi, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StoreRedis } from "./storeRedis.js";
import { RedisRobinhoodGasJournal } from "./robinhoodGasJournal.js";
import { RobinhoodPaymentJournal } from "./robinhoodPaymentJournal.js";

/** Only enabled explicitly. No memory journal, remote provider fallback or
 * general-purpose signer. Never expose configuration/SDK errors to a client. */
export function createRobinhoodPaymentRuntime(cfg: AppConfig): RequestHandler | undefined {
  if (!cfg.FEATURE_ROBINHOOD_PAYMENTS || cfg.X402_MOCK) return undefined;
  let readinessReason = "initialization_failed";
  const unavailable: RequestHandler = (_req, res) => { res.status(503).json({
    error: "Robinhood payment service is unavailable. No new payment was requested. If you already signed a payment, preserve it and retry the same request after service recovery.",
    code: "robinhood_payments_unavailable", retrySamePayment: true, reason: readinessReason,
  }); };
  try {
    if (cfg.ROBINHOOD_FACILITATOR !== "self-hosted") { readinessReason = "self_hosted_provider_required"; return unavailable; }
    if (cfg.QUEUE_PROVIDER !== "redis" || !/^rediss?:\/\//.test(cfg.REDIS_URL)) { readinessReason = "durable_redis_required"; return unavailable; }
    if (!/^0x[\da-f]{64}$/i.test(cfg.ROBINHOOD_FACILITATOR_PRIVATE_KEY)) { readinessReason = "facilitator_key_missing_or_invalid"; return unavailable; }
    if (!isAddress(cfg.PAY_TO_ADDRESS) || cfg.PAY_TO_ADDRESS.toLowerCase() === zeroAddress || !isAddress(cfg.ROBINHOOD_PULSE_REGISTRY_ADDRESS)) { readinessReason = "payment_contract_configuration_invalid"; return unavailable; }
    const account = privateKeyToAccount(cfg.ROBINHOOD_FACILITATOR_PRIVATE_KEY as Hex);
    const reserved = [cfg.PAY_TO_ADDRESS, cfg.TEST_WALLET_ADDRESS];
    for (const key of [cfg.TEST_WALLET_PRIVATE_KEY, cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY]) {
      if (key) reserved.push(privateKeyToAccount(key as Hex).address);
    }
    if (reserved.some(address => address?.toLowerCase() === account.address.toLowerCase())) { readinessReason = "dedicated_facilitator_signer_required"; return unavailable; }
    const redis = new StoreRedis(cfg.REDIS_URL);
    const amounts = [...new Set(Object.values(cfg.routes).filter(route => !route.free && route.priceUsd > 0)
      .map(route => parseUnits(route.priceUsd.toFixed(6), 6).toString()))];
    const signer = createRobinhoodGasSigner({ privateKey: cfg.ROBINHOOD_FACILITATOR_PRIVATE_KEY as Hex,
      rpcUrl: cfg.ROBINHOOD_RPC_URL, payTo: cfg.PAY_TO_ADDRESS as Address, amounts,
      maxGasCostEth: cfg.ROBINHOOD_FACILITATOR_MAX_GAS_ETH, journal: new RedisRobinhoodGasJournal(redis) });
    const payment = createRobinhoodPaymentMiddleware(cfg, {
      facilitator: createRobinhoodSelfHostedFacilitator({ signer, payTo: cfg.PAY_TO_ADDRESS as Address, amounts }),
      journal: new RobinhoodPaymentJournal(redis), observer: robinhoodPaymentObserver(cfg.ROBINHOOD_RPC_URL), provider: "robinhood-self-hosted",
    });
    const reader = createPublicClient({ transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: 8_000, retryCount: 0 }) });
    const abi = parseAbi(["function admin() view returns (address)", "function guardian() view returns (address)"]);
    let checkedUntil = 0;
    let checking: Promise<void> | undefined;
    const readiness = async () => {
      if (Date.now() < checkedUntil) return;
      checking ||= (async () => {
        readinessReason = "rpc_readiness_unavailable";
        if (await reader.getChainId() !== 4663) { readinessReason = "rpc_wrong_chain"; throw new Error("Wrong network"); }
        const [admin, guardian, code] = await Promise.all([
          reader.readContract({ address: cfg.ROBINHOOD_PULSE_REGISTRY_ADDRESS as Address, abi, functionName: "admin" }),
          reader.readContract({ address: cfg.ROBINHOOD_PULSE_REGISTRY_ADDRESS as Address, abi, functionName: "guardian" }),
          reader.getCode({ address: account.address }),
        ]);
        if ([admin, guardian].some(address => address.toLowerCase() === account.address.toLowerCase()) || (code && code !== "0x")) { readinessReason = "dedicated_facilitator_signer_required"; throw new Error("Signer is not isolated"); }
        checkedUntil = Date.now() + 60_000;
      })().finally(() => { checking = undefined; });
      await checking;
    };
    const supported = new Set(["/v1/analysis/spot/standard", "/v1/analysis/spot/premium",
      "/v1/analysis/prediction/standard", "/v1/analysis/prediction/premium", "/v1/preflight"]);
    if (process.env.FEATURE_ROBINHOOD_TRADING === "1") {
      for (const duration of ["24h", "7d", "30d"]) supported.add(`/v1/autopilot/pass/${duration}`);
    }
    return (req, res, next) => {
      if (!supported.has(req.path.replace(/\/$/, ""))) {
        res.status(422).json({ error: "This service is not yet qualified for Robinhood payments. No payment requested.", code: "robinhood_service_unavailable" });
        return;
      }
      void readiness().then(() => payment(req, res, next)).catch(() => unavailable(req, res, next));
    };
  } catch { return unavailable; }
}
