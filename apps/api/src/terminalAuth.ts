import { createHash, randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import type { TerminalStore } from "./terminalStore.js";
import { terminalOwner } from "./terminalStore.js";

type Challenge = { owner: string; message: string; expiresAt: number };
export type TerminalSession = { owner: string; expiresAt: number };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export class TerminalAuth {
  constructor(private store: TerminalStore, private origin: string) {}
  async challenge(wallet: string, now = Date.now()) {
    const owner = terminalOwner(wallet), challengeId = randomBytes(24).toString("base64url"), expiresAt = now + 5 * 60_000;
    const message = ["PULSE Trading Terminal access", "", `Origin: ${new URL(this.origin).origin}`, `Wallet: ${owner}`, `Nonce: ${challengeId}`, `Expires: ${new Date(expiresAt).toISOString()}`, "", "Sign in to your private Trading Terminal workspace across supported payment networks. This signature does not authorize a payment, order, transfer or automatic renewal."].join("\n");
    await this.store.storage.write(this.store.key("challenge", challengeId), { owner, message, expiresAt } satisfies Challenge, 300);
    return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
  }
  async verify(challengeId: string, signature: `0x${string}`, now = Date.now()) {
    const challenge = await this.store.storage.take<Challenge>(this.store.key("challenge", challengeId));
    if (!challenge || challenge.expiresAt <= now || !await verifyMessage({ address: challenge.owner as `0x${string}`, message: challenge.message, signature })) throw new Error("Wallet signature is invalid or expired. Sign in again.");
    const token = randomBytes(32).toString("base64url"), expiresAt = now + 60 * 60_000;
    await this.store.storage.write(this.store.key("session", digest(token)), { owner: challenge.owner, expiresAt } satisfies TerminalSession, 3600);
    return { token, owner: challenge.owner, expiresAt: new Date(expiresAt).toISOString() };
  }
  async authenticate(header: string | undefined, now = Date.now()) {
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!/^[A-Za-z\d_-]{43}$/.test(token)) return null;
    const session = await this.store.storage.read<TerminalSession>(this.store.key("session", digest(token)));
    return session && session.expiresAt > now ? session : null;
  }
}
