import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { kvClientResilienceOptions } from "./resilientKv.js";

export type ArcBudgetLimits = Readonly<{
  walletHourly: number;
  ipHourly: number;
  walletDaily: number;
  dailyCostMicrousd: number;
}>;

export class ArcBudgetExceededError extends Error {
  readonly status = 429;
  constructor(readonly dimension: "ip_hourly" | "wallet_hourly" | "wallet_daily" | "daily_cost") {
    super(`Arc live AI ${dimension.replaceAll("_", " ")} limit reached`);
    this.name = "ArcBudgetExceededError";
  }
}

export interface ArcBudgetStore {
  checkIp(ip: string, now?: Date): Promise<void>;
  reserve(input: { wallet: string; ip: string; estimatedCostMicrousd: number; reservationId?: string; now?: Date }): Promise<void>;
}

function digest(value: string) { return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32); }
function buckets(now = new Date()) {
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  return { hour, day };
}

export function paymentPayer(header: string | undefined): string | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      payload?: { authorization?: { from?: unknown } };
      authorization?: { from?: unknown };
    };
    const from = decoded.payload?.authorization?.from ?? decoded.authorization?.from;
    return typeof from === "string" && /^0x[a-fA-F0-9]{40}$/.test(from) ? from.toLowerCase() : null;
  } catch { return null; }
}

export class MemoryArcBudgetStore implements ArcBudgetStore {
  private counts = new Map<string, number>();
  private reservations = new Set<string>();
  constructor(private limits: ArcBudgetLimits) {}
  private value(key: string) { return this.counts.get(key) || 0; }
  async checkIp(ip: string, now = new Date()) {
    const { hour } = buckets(now);
    if (this.value(`ih:${hour}:${digest(ip)}`) >= this.limits.ipHourly) throw new ArcBudgetExceededError("ip_hourly");
  }
  async reserve({ wallet, ip, estimatedCostMicrousd, reservationId = randomUUID(), now = new Date() }: { wallet: string; ip: string; estimatedCostMicrousd: number; reservationId?: string; now?: Date }) {
    if (this.reservations.has(reservationId)) return;
    const { hour, day } = buckets(now); const w = digest(wallet); const i = digest(ip);
    const keys = [`ih:${hour}:${i}`, `wh:${hour}:${w}`, `wd:${day}:${w}`, `cost:${day}`];
    const next = [this.value(keys[0]) + 1, this.value(keys[1]) + 1, this.value(keys[2]) + 1, this.value(keys[3]) + estimatedCostMicrousd];
    if (next[0] > this.limits.ipHourly) throw new ArcBudgetExceededError("ip_hourly");
    if (next[1] > this.limits.walletHourly) throw new ArcBudgetExceededError("wallet_hourly");
    if (next[2] > this.limits.walletDaily) throw new ArcBudgetExceededError("wallet_daily");
    if (next[3] > this.limits.dailyCostMicrousd) throw new ArcBudgetExceededError("daily_cost");
    keys.forEach((key, index) => this.counts.set(key, next[index])); this.reservations.add(reservationId);
  }
}

export class UpstashArcBudgetStore implements ArcBudgetStore {
  private redis: Redis;
  constructor(url: string, token: string, private limits: ArcBudgetLimits, private namespace = "pulse") { this.redis = new Redis({ url, token, ...kvClientResilienceOptions() }); }
  async checkIp(ip: string, now = new Date()) {
    const { hour } = buckets(now);
    const count = Number(await this.redis.get<number>(`${this.namespace}:arc:ih:${hour}:${digest(ip)}`) || 0);
    if (count >= this.limits.ipHourly) throw new ArcBudgetExceededError("ip_hourly");
  }
  async reserve({ wallet, ip, estimatedCostMicrousd, reservationId = randomUUID(), now = new Date() }: { wallet: string; ip: string; estimatedCostMicrousd: number; reservationId?: string; now?: Date }) {
    const { hour, day } = buckets(now); const w = digest(wallet); const i = digest(ip);
    const result = await this.redis.eval<string[], string>(
      "if redis.call('EXISTS',KEYS[5])==1 then return 'ok' end; local a=tonumber(redis.call('GET',KEYS[1]) or '0')+1; local b=tonumber(redis.call('GET',KEYS[2]) or '0')+1; local c=tonumber(redis.call('GET',KEYS[3]) or '0')+1; local d=tonumber(redis.call('GET',KEYS[4]) or '0')+tonumber(ARGV[1]); if a>tonumber(ARGV[2]) then return 'ip_hourly' end; if b>tonumber(ARGV[3]) then return 'wallet_hourly' end; if c>tonumber(ARGV[4]) then return 'wallet_daily' end; if d>tonumber(ARGV[5]) then return 'daily_cost' end; redis.call('SET',KEYS[1],a,'EX',7200); redis.call('SET',KEYS[2],b,'EX',7200); redis.call('SET',KEYS[3],c,'EX',172800); redis.call('SET',KEYS[4],d,'EX',172800); redis.call('SET',KEYS[5],'1','EX',172800); return 'ok'",
      [`${this.namespace}:arc:ih:${hour}:${i}`, `${this.namespace}:arc:wh:${hour}:${w}`, `${this.namespace}:arc:wd:${day}:${w}`, `${this.namespace}:arc:cost:${day}`, `${this.namespace}:arc:reservation:${digest(reservationId)}`],
      [String(estimatedCostMicrousd), String(this.limits.ipHourly), String(this.limits.walletHourly), String(this.limits.walletDaily), String(this.limits.dailyCostMicrousd)],
    );
    if (result !== "ok") throw new ArcBudgetExceededError(result as ArcBudgetExceededError["dimension"]);
  }
}

export function createArcBudgetStore(config: { QUEUE_PROVIDER: "memory" | "upstash_kv"; KV_REST_API_URL: string; KV_REST_API_TOKEN: string; PERSISTENCE_NAMESPACE?: string } & ArcBudgetLimits) {
  const limits: ArcBudgetLimits = { walletHourly: config.walletHourly, ipHourly: config.ipHourly, walletDaily: config.walletDaily, dailyCostMicrousd: config.dailyCostMicrousd };
  return config.QUEUE_PROVIDER === "upstash_kv" ? new UpstashArcBudgetStore(config.KV_REST_API_URL, config.KV_REST_API_TOKEN, limits, config.PERSISTENCE_NAMESPACE || "pulse") : new MemoryArcBudgetStore(limits);
}
