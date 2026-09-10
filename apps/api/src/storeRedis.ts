import { runKvCommand, type KvConnection } from "./resilientKv.js";

/** The small command surface used by jobs, report metadata and Arc budgets.
 * Raw trading/pass callers keep raw Redis strings; these stores use JSON values.
 * Keys and serialization stay compatible with the existing Upstash data. */
export class StoreRedis {
  private connection: KvConnection;
  constructor(url: string, token = "") {
    this.connection = /^rediss?:\/\//.test(url)
      ? { provider: "redis", url }
      : { provider: "upstash_kv", url, token };
  }
  private command(command: unknown[]) { return runKvCommand(command, "Durable store", this.connection); }
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.command(["GET", key]);
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "string") { try { return JSON.parse(raw) as T; } catch { /* plain Redis string */ } }
    return raw as T;
  }
  async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }) {
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    if (encoded === undefined) throw new Error("Cannot persist undefined");
    return this.command(["SET", key, encoded, ...(options?.ex ? ["EX", options.ex] : []), ...(options?.nx ? ["NX"] : [])]);
  }
  async del(...keys: string[]) { return Number(await this.command(["DEL", ...keys])); }
  async expire(key: string, seconds: number) { return Number(await this.command(["EXPIRE", key, seconds])); }
  async zadd(key: string, entry: { score: number; member: string }) { return Number(await this.command(["ZADD", key, entry.score, entry.member])); }
  async zcard(key: string) { return Number(await this.command(["ZCARD", key])); }
  async zrange<T>(key: string, start: number, stop: number, options?: { rev?: boolean }): Promise<T> {
    return await this.command([options?.rev ? "ZREVRANGE" : "ZRANGE", key, start, stop]) as T;
  }
  async scan(cursor: string, options: { match: string; count: number }): Promise<[string, string[]]> {
    return await this.command(["SCAN", cursor, "MATCH", options.match, "COUNT", options.count]) as [string, string[]];
  }
  async eval<TArgs extends unknown[], TResult>(script: string, keys: string[], args: TArgs): Promise<TResult> {
    return await this.command(["EVAL", script, keys.length, ...keys, ...args]) as TResult;
  }
}
