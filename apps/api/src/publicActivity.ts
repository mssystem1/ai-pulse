import { createHash } from "node:crypto";
import { NETWORK_REGISTRY } from "@pulse/config";
import type { AnalysisJob, PaymentReceipt } from "./jobs.js";
import { StoreRedis } from "./storeRedis.js";

export type ResearchService = "global" | "prediction" | "risk";
export type ResearchDelivery = {
  identity: string;
  chain: string;
  environment: "mainnet" | "testnet";
  service: ResearchService;
  at: string;
  partial: boolean;
};
type Bucket = { count: number; partial: number; firstAt: string; lastAt: string };
export type VerifiedExecution = { chain: string; txHash: string; service: "spot" | "autopilot"; at: string; settlementAsset: string; settlementAtomic: string };
type ExecutionBucket = { count: number; firstAt: string; lastAt: string; amount: string; symbol: string; chain: string; label: string };
const services: ResearchService[] = ["global", "prediction", "risk"];
const chains = Object.values(NETWORK_REGISTRY);

/** Delivery identity follows the original chain/payment, not the current RPC or report filename. */
export function researchDelivery(receipt: PaymentReceipt | null, service: ResearchService, at: string, partial = false): ResearchDelivery | null {
  const chain = chains.find(chain => chain.caip2 === receipt?.network && chain.chainId === receipt.chainId);
  if (!receipt || !chain || receipt.settlementMode === "mock" || receipt.provider === "mock"
    || receipt.finality.status === "simulated" || receipt.settlementResult !== "settled"
    || receipt.verificationResult !== "accepted_by_middleware"
    || !receipt.authorizationId || !Number.isFinite(Date.parse(at))) return null;
  return {
    identity: createHash("sha256").update(JSON.stringify([receipt.network, service, receipt.authorizationId, receipt.requestHash])).digest("hex"),
    chain: chain.caip2, environment: chain.environment, service, at: new Date(at).toISOString(), partial,
  };
}

export function jobResearchDelivery(job: AnalysisJob): ResearchDelivery | null {
  if (!job.reportId || !["completed", "completed_partial"].includes(job.stage) || !["spot", "prediction", "risk"].includes(job.mode)) return null;
  return researchDelivery(job.receipt, job.mode === "spot" ? "global" : job.mode === "risk" ? "risk" : "prediction", job.receipt?.completedAt || job.updatedAt, job.stage === "completed_partial");
}

// One atomic dedupe + update. No expiry: job/report retention must not erase totals.
// Keys contain only hashes and aggregate fields, never wallets or report capabilities.
const RECORD = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return 0 end
local bucket = cjson.decode(redis.call('HGET', KEYS[2], ARGV[2]) or '{"count":0,"partial":0,"firstAt":"","lastAt":""}')
bucket.count = bucket.count + 1
bucket.partial = bucket.partial + tonumber(ARGV[4])
if bucket.firstAt == '' or ARGV[3] < bucket.firstAt then bucket.firstAt = ARGV[3] end
if bucket.lastAt == '' or ARGV[3] > bucket.lastAt then bucket.lastAt = ARGV[3] end
redis.call('HSET', KEYS[2], ARGV[2], cjson.encode(bucket))
redis.call('HSET', KEYS[1], ARGV[1], '1')
return 1`;
const RECORD_EXECUTION = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return 0 end
local bucket = cjson.decode(redis.call('HGET', KEYS[2], ARGV[2]) or '{"count":0,"firstAt":"","lastAt":""}')
redis.call('HINCRBY', KEYS[3], ARGV[2], ARGV[4])
bucket.count = bucket.count + 1
if bucket.firstAt == '' or ARGV[3] < bucket.firstAt then bucket.firstAt = ARGV[3] end
if bucket.lastAt == '' or ARGV[3] > bucket.lastAt then bucket.lastAt = ARGV[3] end
redis.call('HSET', KEYS[2], ARGV[2], cjson.encode(bucket))
redis.call('HSET', KEYS[1], ARGV[1], '1')
return 1`;

function humanUnits(amount: string, decimals: number) {
  const padded = amount.padStart(decimals + 1, "0");
  return decimals ? `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}` : padded;
}

export class PublicActivityStore {
  private seen = new Set<string>();
  private buckets = new Map<string, Bucket>();
  private trades = new Map<string, { count: number; firstAt: string; lastAt: string }>();
  private volumes = new Map<string, string>();
  constructor(private redis?: StoreRedis, private namespace = "pulse") {}
  /** Call only after server-side receipt/route/net-transfer verification, not client-announced activity. */
  async recordExecution(execution: VerifiedExecution): Promise<boolean> {
    const chain = chains.find(chain => chain.caip2 === execution.chain && chain.environment === "mainnet");
    if (!chain || !["spot", "autopilot"].includes(execution.service) || chain.paymentAsset.address?.toLowerCase() !== execution.settlementAsset.toLowerCase()
      || !/^0x[a-f0-9]{64}$/i.test(execution.txHash) || !/^[1-9][0-9]{0,17}$/.test(execution.settlementAtomic) || !Number.isFinite(Date.parse(execution.at))) return false;
    // One net swap per transaction; aliases from multiple product journals cannot count twice.
    const identity = createHash("sha256").update(`${execution.chain}:${execution.txHash.toLowerCase()}`).digest("hex");
    const key = `${chain.caip2}:${execution.service}`;
    const at = new Date(execution.at).toISOString();
    if (this.redis) return Boolean(await this.redis.eval(RECORD_EXECUTION,
      [`${this.namespace}:public-activity:executions-seen:v1`, `${this.namespace}:public-activity:executions:v1`, `${this.namespace}:public-activity:volume:v1`],
      [identity, key, at, execution.settlementAtomic]));
    if (this.seen.has(identity)) return false;
    this.seen.add(identity);
    const previous = this.trades.get(key);
    this.trades.set(key, { count: (previous?.count || 0) + 1, firstAt: previous && previous.firstAt < at ? previous.firstAt : at, lastAt: previous && previous.lastAt > at ? previous.lastAt : at });
    this.volumes.set(key, (BigInt(this.volumes.get(key) || "0") + BigInt(execution.settlementAtomic)).toString());
    return true;
  }
  async record(delivery: ResearchDelivery | null): Promise<boolean> {
    if (!delivery) return false;
    const chain = chains.find(chain => chain.caip2 === delivery.chain && chain.environment === delivery.environment);
    if (!chain || !services.includes(delivery.service) || !/^[a-f0-9]{64}$/.test(delivery.identity) || !Number.isFinite(Date.parse(delivery.at))) return false;
    const key = `${delivery.chain}:${delivery.environment}:${delivery.service}`;
    if (this.redis) return Boolean(await this.redis.eval(RECORD,
      [`${this.namespace}:public-activity:seen:v1`, `${this.namespace}:public-activity:research:v1`],
      [delivery.identity, key, delivery.at, delivery.partial ? "1" : "0"]));
    if (this.seen.has(delivery.identity)) return false;
    this.seen.add(delivery.identity);
    const old = this.buckets.get(key);
    this.buckets.set(key, { count: (old?.count || 0) + 1, partial: (old?.partial || 0) + Number(delivery.partial), firstAt: old && old.firstAt < delivery.at ? old.firstAt : delivery.at, lastAt: old && old.lastAt > delivery.at ? old.lastAt : delivery.at });
    return true;
  }
  async snapshot() {
    let buckets = this.buckets;
    if (this.redis) {
      const raw = await this.redis.eval<[], string[]>("return redis.call('HGETALL', KEYS[1])", [`${this.namespace}:public-activity:research:v1`], []);
      buckets = new Map();
      for (let i = 0; i < raw.length; i += 2) {
        const value = JSON.parse(raw[i + 1]) as Bucket;
        if (!Number.isSafeInteger(value.count) || value.count < 0 || !Number.isSafeInteger(value.partial) || value.partial < 0 || value.partial > value.count
          || !Number.isFinite(Date.parse(value.firstAt)) || !Number.isFinite(Date.parse(value.lastAt))) throw new Error("Invalid public activity snapshot");
        buckets.set(raw[i], value);
      }
    }
    let trades = this.trades, volumes = this.volumes;
    if (this.redis) {
      const [counts, amounts] = await this.redis.eval<[], [string[], string[]]>("return {redis.call('HGETALL',KEYS[1]),redis.call('HGETALL',KEYS[2])}", [`${this.namespace}:public-activity:executions:v1`, `${this.namespace}:public-activity:volume:v1`], []);
      trades = new Map(); volumes = new Map();
      for (let i = 0; i < counts.length; i += 2) trades.set(counts[i], JSON.parse(counts[i + 1]));
      for (let i = 0; i < amounts.length; i += 2) volumes.set(amounts[i], amounts[i + 1]);
    }
    const execution = Object.fromEntries((["spot", "autopilot"] as const).map(service => {
      const byChain = chains.flatMap(chain => {
        const key = `${chain.caip2}:${service}`, count = trades.get(key), amount = volumes.get(key);
        if (chain.environment !== "mainnet" || !count || !amount) return [];
        if (!Number.isSafeInteger(count.count) || count.count <= 0 || !/^\d+$/.test(amount) || !Number.isFinite(Date.parse(count.firstAt)) || !Number.isFinite(Date.parse(count.lastAt))) throw new Error("Invalid execution projection");
        return [{ ...count, amount: humanUnits(amount, chain.paymentAsset.decimals), symbol: chain.paymentAsset.symbol, chain: chain.caip2, label: chain.label } satisfies ExecutionBucket];
      });
      return [service, byChain.length ? { count: byChain.reduce((sum, bucket) => sum + bucket.count, 0), byChain } : null];
    })) as Record<"spot" | "autopilot", {count:number;byChain:ExecutionBucket[]} | null>;
    const networks = chains.map(chain => ({
      chain: chain.caip2, label: chain.label, environment: chain.environment,
      research: Object.fromEntries(services.map(service => {
        const bucket = buckets.get(`${chain.caip2}:${chain.environment}:${service}`);
        // No observations is unknown historical coverage, not proof of zero lifetime use.
        return [service, bucket || null];
      })) as Record<ResearchService, Bucket | null>,
    }));
    const research = Object.fromEntries(services.map(service => {
      const observed = networks.flatMap(network => network.research[service] ? [network.research[service]!] : []);
      return [service, observed.length ? {
        count: observed.reduce((sum, bucket) => sum + bucket.count, 0),
        partial: observed.reduce((sum, bucket) => sum + bucket.partial, 0),
        firstAt: observed.map(bucket => bucket.firstAt).sort()[0], lastAt: observed.map(bucket => bucket.lastAt).sort().at(-1)!,
      } : null];
    })) as Record<ResearchService, Bucket | null>;
    return { version: 1, asOf: new Date().toISOString(), scope: "platform" as const, persistence: this.redis ? "durable" : "memory",
      coverage: "observed-deliveries" as const, historicalCoverageComplete: false, networks, research,
      execution: { ...execution, activeAutopilots: null },
      disclosure: "Includes genuine developer testing and Arc Testnet analyses. Observed deliveries only; historical coverage is incomplete. Partial reports are included and identified. Execution figures require separately verified mainnet evidence.",
    };
  }
}

export function createPublicActivityStore(config: { QUEUE_PROVIDER: string; REDIS_URL?: string; KV_REST_API_URL: string; KV_REST_API_TOKEN: string; PERSISTENCE_NAMESPACE?: string }) {
  const redis = config.QUEUE_PROVIDER === "memory" ? undefined : new StoreRedis(config.QUEUE_PROVIDER === "redis" ? config.REDIS_URL || "" : config.KV_REST_API_URL, config.KV_REST_API_TOKEN);
  return new PublicActivityStore(redis, config.PERSISTENCE_NAMESPACE || "pulse");
}
