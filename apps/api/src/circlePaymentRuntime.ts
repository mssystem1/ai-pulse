import type { RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { createCircleGatewayPaymentMiddleware, type CirclePaymentAttempt, type CirclePaymentJournal } from "@pulse/payments";
import { StoreRedis } from "./storeRedis.js";

/** Permanent settlement records survive report expiry and process restarts. */
export class RedisCirclePaymentJournal implements CirclePaymentJournal {
  constructor(private readonly redis: StoreRedis) {}
  private key(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid Circle payment record ID");
    return `pulse:payments:arc:v1:${id}`;
  }
  get(id: string) { return this.redis.get<CirclePaymentAttempt>(this.key(id)); }
  async claim(attempt: CirclePaymentAttempt) { return await this.redis.set(this.key(attempt.id), attempt, { nx: true }) === "OK"; }
  async replace(previous: CirclePaymentAttempt, next: CirclePaymentAttempt) {
    if (next.id !== previous.id) throw new Error("Circle payment identity cannot change");
    return Number(await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 else return 0 end",
      [this.key(previous.id)], [JSON.stringify(previous), JSON.stringify(next)],
    )) === 1;
  }
}

export function createCirclePaymentRuntime(cfg: AppConfig): RequestHandler | undefined {
  if (cfg.X402_MOCK || !cfg.CIRCLE_GATEWAY_ENABLED || !cfg.FEATURE_ARC_PAYMENTS) return undefined;
  const redis = cfg.QUEUE_PROVIDER === "redis" && /^rediss?:\/\//.test(cfg.REDIS_URL) ? new StoreRedis(cfg.REDIS_URL)
    : cfg.QUEUE_PROVIDER === "upstash_kv" && cfg.KV_REST_API_URL && cfg.KV_REST_API_TOKEN ? new StoreRedis(cfg.KV_REST_API_URL, cfg.KV_REST_API_TOKEN) : null;
  const middleware = createCircleGatewayPaymentMiddleware(cfg, redis ? new RedisCirclePaymentJournal(redis) : undefined);
  return (req, res, next) => {
    if (!redis && (req.header("PAYMENT-SIGNATURE") || req.header("X-PAYMENT"))) return void res.status(503).json({
      error: "Arc payment requires durable storage; no payment was submitted", code: "arc_payment_storage_unavailable", retrySamePayment: true,
    });
    return middleware(req, res, next);
  };
}
