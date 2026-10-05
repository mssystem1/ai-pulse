import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import { verifyMessage } from "viem";
import { z } from "zod";
import type { AppConfig } from "@pulse/config";
import { kvConfigured, runKvCommand } from "./resilientKv.js";
import { asyncRoute } from "./httpResilience.js";
import type { JobStore, AnalysisJob } from "./jobs.js";

type LinkAttempt = { id: string; userId: number; tokenHash: string; expiresAt: number; status: "issued" | "signed" | "confirmed"; wallet?: string; message?: string; previousWallet?: string };
export type WalletAssociation = { wallet: string; linkedAt: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const walletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export class TelegramWalletLink {
  private memory = new Map<string, unknown>();
  constructor(private cfg: AppConfig, private jobs: JobStore) {}
  private key(suffix: string) { return `${this.cfg.PERSISTENCE_NAMESPACE || "pulse"}:telegram:wallet:${suffix}`; }
  private async get<T>(suffix: string): Promise<T | null> {
    if(this.cfg.NODE_ENV === "production" && !kvConfigured()) throw new Error("Persistent Telegram wallet storage is unavailable. Your account wallet has not been disconnected.");
    if (!kvConfigured()) return this.memory.get(suffix) as T || null;
    const raw = await runKvCommand(["GET", this.key(suffix)], "Telegram wallet link");
    return typeof raw === "string" ? JSON.parse(raw) as T : null;
  }
  private async set(suffix: string, value: unknown, ttl?: number) {
    if(this.cfg.NODE_ENV === "production" && !kvConfigured()) throw new Error("Persistent Telegram wallet storage is unavailable");
    if (kvConfigured()) await runKvCommand(["SET", this.key(suffix), JSON.stringify(value), ...(ttl ? ["EX", ttl] : [])], "Telegram wallet link");
    else this.memory.set(suffix, structuredClone(value));
  }
  async association(userId: number) { return this.get<WalletAssociation>(`account:${userId}`); }
  async start(userId: number, replace = false) {
    const existing = await this.association(userId);
    if (existing && !replace) throw new Error("A wallet is already linked. Use Change wallet in Telegram to replace it.");
    const token = randomBytes(32).toString("base64url");
    const attempt: LinkAttempt = { id: randomUUID(), userId, tokenHash: hash(token), expiresAt: Date.now()+10*60_000, status: "issued", ...(existing ? { previousWallet:existing.wallet } : {}) };
    await this.set(`attempt:${attempt.id}`, attempt, 600);
    await this.set(`token:${attempt.tokenHash}`, attempt.id, 600);
    await this.set(`current:${userId}`, attempt.id, 600);
    return { id: attempt.id, token, expiresAt: attempt.expiresAt };
  }
  async status(userId: number, id: string) {
    const attempt = await this.get<LinkAttempt>(`attempt:${id}`);
    if (!attempt || attempt.userId !== userId || attempt.expiresAt < Date.now() || await this.get(`current:${userId}`) !== id) return null;
    return { id, wallet: attempt.wallet || null, status: attempt.status, expiresAt: attempt.expiresAt };
  }
  private async fromToken(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Wallet link is invalid or expired. Start again in Telegram.");
    const id = await this.get<string>(`token:${hash(token)}`);
    const attempt = id ? await this.get<LinkAttempt>(`attempt:${id}`) : null;
    if (!attempt || attempt.tokenHash !== hash(token) || attempt.expiresAt < Date.now() || await this.get(`current:${attempt.userId}`) !== attempt.id || attempt.status === "confirmed") throw new Error("Wallet link is invalid or expired. Start again in Telegram.");
    return attempt;
  }
  async challenge(token: string, wallet: string) {
    walletSchema.parse(wallet);
    const attempt = await this.fromToken(token);
    if (attempt.status !== "issued") throw new Error("This wallet has already signed. Return to Telegram to confirm.");
    const nonce = randomBytes(24).toString("base64url");
    const origin = new URL(process.env.TELEGRAM_MINI_APP_URL || "https://www.ai-pulse.tech").origin;
    attempt.wallet = wallet.toLowerCase();
    attempt.message = ["PULSE — link wallet to Telegram", "", `Origin: ${origin}`, `Telegram account ID: ${attempt.userId}`, `Wallet: ${attempt.wallet}`, `Link request: ${attempt.id}`, `Nonce: ${nonce}`, `Expires: ${new Date(attempt.expiresAt).toISOString()}`, "", "I allow this Telegram account to read my PULSE report history across supported networks until I unlink this wallet. This signature does not authorize a payment, transfer or trade. Confirm the wallet inside Telegram to finish."].join("\n");
    await this.set(`attempt:${attempt.id}`, attempt, Math.max(1,Math.ceil((attempt.expiresAt-Date.now())/1000)));
    return { message: attempt.message, expiresAt: attempt.expiresAt, telegramUserId: attempt.userId };
  }
  async signed(token: string, wallet: string, signature: `0x${string}`) {
    const attempt = await this.fromToken(token);
    if (attempt.status !== "issued" || !attempt.message || attempt.wallet !== wallet.toLowerCase()) throw new Error("Wallet link challenge is invalid. Start again.");
    if (!await verifyMessage({ address: wallet as `0x${string}`, message: attempt.message, signature })) throw new Error("Wallet ownership signature is invalid");
    // Signing alone cannot link an attacker's wallet to the Telegram account.
    attempt.status = "signed";
    await this.set(`attempt:${attempt.id}`, attempt, Math.max(1,Math.ceil((attempt.expiresAt-Date.now())/1000)));
    return { status: "signed", wallet: attempt.wallet, confirmInTelegram: true };
  }
  async confirm(userId: number, id: string) {
    const status = await this.status(userId, id);
    if (!status || status.status !== "signed" || !status.wallet) throw new Error("Sign with your wallet in the browser before confirming in Telegram.");
    const association = { wallet: status.wallet, linkedAt: new Date().toISOString() };
    const attempt = (await this.get<LinkAttempt>(`attempt:${id}`))!;
    if (kvConfigured()) {
      const result = await runKvCommand(["EVAL", "if redis.call('GET',KEYS[3])~=ARGV[3] then return 'expired' end;local current=redis.call('GET',KEYS[1]);if current then if cjson.decode(current).wallet~=ARGV[4] then return 'changed' end elseif ARGV[4]~='' then return 'changed' end;local owner=redis.call('GET',KEYS[2]);if owner and owner~=ARGV[1] then return 'owned' end;if ARGV[4]~='' and redis.call('GET',KEYS[4])==ARGV[1] then redis.call('DEL',KEYS[4]) end;redis.call('SET',KEYS[1],ARGV[2]);redis.call('SET',KEYS[2],ARGV[1]);redis.call('DEL',KEYS[3]);return 'OK'", 4, this.key(`account:${userId}`), this.key(`owner:${status.wallet}`), this.key(`current:${userId}`), this.key(`owner:${attempt.previousWallet || "none"}`), JSON.stringify(userId), JSON.stringify(association), JSON.stringify(id), attempt.previousWallet || ""], "Telegram wallet link");
      if (result !== "OK") throw new Error(result === "owned" ? "This wallet is linked to another Telegram account. Unlink it there first." : "Wallet link changed or expired. Start again.");
    } else {
      const current = await this.association(userId);
      if (current?.wallet !== attempt.previousWallet) throw new Error("Wallet link changed. Start again.");
      const owner = await this.get<number>(`owner:${status.wallet}`);
      if (owner && owner !== userId) throw new Error("This wallet is linked to another Telegram account");
      if(attempt.previousWallet) this.memory.delete(`owner:${attempt.previousWallet}`);
      await this.set(`account:${userId}`, association); await this.set(`owner:${status.wallet}`, userId); this.memory.delete(`current:${userId}`);
    }
    return association;
  }
  async unlink(userId: number) {
    const current = await this.association(userId);
    if (current) {
      if (kvConfigured()) await runKvCommand(["EVAL", "if redis.call('GET',KEYS[2])==ARGV[1] then redis.call('DEL',KEYS[2]) end;redis.call('DEL',KEYS[1]);redis.call('DEL',KEYS[3]);return 1", 3, this.key(`account:${userId}`), this.key(`owner:${current.wallet}`), this.key(`current:${userId}`), JSON.stringify(userId)], "Telegram wallet link");
      else { this.memory.delete(`account:${userId}`); this.memory.delete(`owner:${current.wallet}`); this.memory.delete(`current:${userId}`); }
    } else if(kvConfigured()) await runKvCommand(["DEL",this.key(`current:${userId}`)],"Telegram wallet link"); else this.memory.delete(`current:${userId}`);
  }
  async history(userId: number) {
    const association = await this.association(userId);
    if (!association) return [];
    const networks: AnalysisJob["networkKey"][] = ["xlayer", "base", "arbitrum", "arc", "robinhood", "arc-testnet"];
    const rows = await Promise.all(networks.map(network => this.jobs.listByPayer(association.wallet, network, 30)));
    return rows.flat().filter(job => ["spot","prediction","risk"].includes(job.mode) && job.receipt?.settlementResult === "settled").sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,30);
  }
  async ownedJob(userId: number, id: string) {
    const association = await this.association(userId);
    const job = await this.jobs.get(id);
    return association && job && job.payer.toLowerCase() === association.wallet && job.receipt?.settlementResult === "settled" && ["spot","prediction","risk"].includes(job.mode) ? job : null;
  }
  router() {
    const router = Router();
    // /wallet/* is authenticated by the parent Mini App router; /wallet-link/* uses a short-lived browser capability.
    router.get("/v1/telegram/wallet", asyncRoute(async (_req,res) => {
      const userId = res.locals.telegramUser.id as number;
      const current = await this.get<string>(`current:${userId}`);
      return res.json({ association: await this.association(userId), pending: current ? await this.status(userId,current) : null });
    }));
    router.post("/v1/telegram/wallet/link", asyncRoute(async (req,res) => {
      if (this.cfg.NODE_ENV !== "test" && !kvConfigured()) return res.status(503).json({ error: "Persistent wallet linking is unavailable" });
      const link = await this.start(res.locals.telegramUser.id, req.body?.replaceWallet === true); return res.status(201).json(link);
    }));
    router.get("/v1/telegram/wallet/link/:id", asyncRoute(async (req,res) => { const status = await this.status(res.locals.telegramUser.id, String(req.params.id)); return status ? res.json(status) : res.status(404).json({ error: "Wallet link expired. Start again." }); }));
    router.post("/v1/telegram/wallet/link/:id/confirm", asyncRoute(async (req,res) => { try { return res.json({ association: await this.confirm(res.locals.telegramUser.id, String(req.params.id)) }); } catch(error) { return res.status(409).json({ error: error instanceof Error ? error.message : "Wallet confirmation failed" }); } }));
    router.post("/v1/telegram/wallet/unlink", asyncRoute(async (_req,res) => { await this.unlink(res.locals.telegramUser.id); res.json({ unlinked:true }); }));
    router.use("/v1/telegram/wallet-link", (_req,res,next) => { res.setHeader("Cache-Control","no-store"); if (!this.cfg.FEATURE_TELEGRAM) return res.status(404).json({error:"Telegram is unavailable"}); next(); });
    router.post("/v1/telegram/wallet-link/challenge", asyncRoute(async (req,res) => { try { return res.json(await this.challenge(String(req.body.token || ""), walletSchema.parse(req.body.wallet))); } catch(error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid wallet link" }); } }));
    router.post("/v1/telegram/wallet-link/signature", asyncRoute(async (req,res) => { try { const signature = z.string().regex(/^0x[a-fA-F0-9]{130}$/).parse(req.body.signature); return res.json(await this.signed(String(req.body.token || ""),walletSchema.parse(req.body.wallet),signature as `0x${string}`)); } catch(error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Wallet signature failed" }); } }));
    return router;
  }
}
