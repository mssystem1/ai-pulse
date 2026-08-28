import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { kvClientResilienceOptions } from "./resilientKv.js";
import { verifyMessage } from "viem";
import type { AnalysisJob } from "./jobs.js";

type NetworkKey = AnalysisJob["networkKey"];
type Challenge = { wallet: string; networkKey: NetworkKey; nonce: string; message: string; expiresAt: number };
export type ReportHistorySession = { wallet: string; networkKey: NetworkKey; expiresAt: number };

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export class ReportHistoryAuth {
  private redis: Redis | null;
  private challenges = new Map<string, Challenge>();
  private sessions = new Map<string, ReportHistorySession>();
  constructor(url = "", token = "", private namespace = "pulse") {
    this.redis = url && token ? new Redis({ url, token, ...kvClientResilienceOptions() }) : null;
  }
  private challengeKey(nonce: string) { return `${this.namespace}:report-history-challenge:${digest(nonce)}`; }
  private sessionKey(token: string) { return `${this.namespace}:report-history-session:${digest(token)}`; }
  private async set(key: string, value: unknown, ttlSeconds: number) {
    if (this.redis) await this.redis.set(key, value, { ex: ttlSeconds });
    else if (key.includes("challenge")) this.challenges.set(key, value as Challenge);
    else this.sessions.set(key, value as ReportHistorySession);
  }
  private async get<T>(key: string) {
    return this.redis ? this.redis.get<T>(key) : (key.includes("challenge") ? this.challenges.get(key) : this.sessions.get(key)) as T | undefined;
  }
  private async del(key: string) { if (this.redis) await this.redis.del(key); else { this.challenges.delete(key); this.sessions.delete(key); } }

  async issue(wallet: string, networkKey: NetworkKey, now = Date.now()) {
    const nonce = randomBytes(24).toString("base64url");
    const expiresAt = now + 5 * 60_000;
    const message = [
      "PULSE report history access",
      "",
      `Wallet: ${wallet.toLowerCase()}`,
      `Network: ${networkKey}`,
      `Nonce: ${nonce}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
      "",
      "Read-only access. This does not authorize payment or trading.",
    ].join("\n");
    const challenge = { wallet: wallet.toLowerCase(), networkKey, nonce, message, expiresAt } satisfies Challenge;
    await this.set(this.challengeKey(nonce), challenge, 300);
    return challenge;
  }

  async authorize(wallet: string, networkKey: NetworkKey, nonce: string, signature: `0x${string}`, now = Date.now()) {
    const key = this.challengeKey(nonce);
    const challenge = await this.get<Challenge>(key);
    await this.del(key);
    if (!challenge || challenge.expiresAt < now || challenge.wallet !== wallet.toLowerCase() || challenge.networkKey !== networkKey) throw new Error("Report-history challenge is invalid or expired");
    const valid = await verifyMessage({ address: wallet as `0x${string}`, message: challenge.message, signature });
    if (!valid) throw new Error("Wallet signature does not match the requested report history");
    const sessionToken = randomBytes(32).toString("base64url");
    const session = { wallet: wallet.toLowerCase(), networkKey, expiresAt: now + 15 * 60_000 } satisfies ReportHistorySession;
    await this.set(this.sessionKey(sessionToken), session, 900);
    return { sessionToken, expiresAt: session.expiresAt };
  }

  async authenticate(token: string, now = Date.now()) {
    if (!token) return null;
    const session = await this.get<ReportHistorySession>(this.sessionKey(token));
    if (!session || session.expiresAt < now) return null;
    return session;
  }
}
