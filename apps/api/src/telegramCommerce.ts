import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { AppConfig } from "@pulse/config";
import { PredictionAnalysisRequestSchema, TokenScanRequestSchema } from "@pulse/schemas";
import { requestHash, type JobStore, type ReportStore, type PaymentReceipt } from "./jobs.js";
import { kvConfigured, runKvCommand } from "./resilientKv.js";
import { asyncRoute } from "./httpResilience.js";
import { TelegramWalletLink } from "./telegramWalletLink.js";
import { researchIdentity, researchRecord } from "@pulse/domain";
import { isArcMarket } from "./arcMarkets.js";

function researchContext(serviceId:string,input:unknown,networkKey:string,createdAt:number|string) {
  const source=researchRecord(input);
  const fields=serviceId.startsWith("global")?["instId","timeframe"]:serviceId.startsWith("prediction")?["primaryMarketId"]:["address"];
  return {serviceId,networkKey,createdAt,input:Object.fromEntries(fields.filter(key=>typeof source[key]==="string").map(key=>[key,source[key]]))};
}
function jobServiceId(job:{mode:string;tier:string|null}) { return job.mode==="risk"?"risk-guard":`${job.mode==="spot"?"global":"prediction"}-${job.tier==="premium"?"pro":"quick"}`; }

export const TELEGRAM_SERVICES = [
  { id: "global-quick", title: "Global Quick → Spot", mode: "spot", tier: "standard", priceEnv: "TELEGRAM_STARS_GLOBAL_QUICK" },
  { id: "risk-guard", title: "Risk Guard", mode: "risk", tier: null, priceEnv: "TELEGRAM_STARS_RISK_GUARD" },
  { id: "prediction-quick", title: "Prediction Quick", mode: "prediction", tier: "standard", priceEnv: "TELEGRAM_STARS_PREDICTION_QUICK" },
  { id: "global-pro", title: "Global Pro → Spot", mode: "spot", tier: "premium", priceEnv: "TELEGRAM_STARS_GLOBAL_PRO" },
  { id: "prediction-pro", title: "Prediction Pro", mode: "prediction", tier: "premium", priceEnv: "TELEGRAM_STARS_PREDICTION_PRO" },
] as const;
export type TelegramService = typeof TELEGRAM_SERVICES[number];
export type TelegramCommerceDependencies = { jobs: JobStore; reports: ReportStore; wakeWorker: () => void; validateGlobal: (input: unknown) => unknown };
type Identity = { id: number; first_name?: string };
export function validateTelegramInitData(raw: string, botToken: string, now = Date.now()): Identity {
  if (!raw || raw.length > 16384) throw new Error("Open PULSE from the Telegram bot to sign in.");
  const params = new URLSearchParams(raw);
  if ([...new Set(params.keys())].some(key => params.getAll(key).length !== 1)) throw new Error("Invalid Telegram session");
  const hash = params.get("hash") || "";
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid Telegram session");
  params.delete("hash");
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw new Error("Invalid Telegram session");
  const date = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(date) || date <= 0 || now / 1000 - date > 3600 || date > now / 1000 + 30) throw new Error("Telegram session expired. Reopen PULSE from the bot.");
  const user = JSON.parse(params.get("user") || "null") as Identity | null;
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new Error("Invalid Telegram user");
  return { id: user.id, first_name: typeof user.first_name === "string" ? user.first_name.slice(0, 80) : undefined };
}

export function telegramServiceCatalog(cfg: AppConfig) {
  return TELEGRAM_SERVICES.map(service => {
    const stars = Number(process.env[service.priceEnv]);
    const enabled = process.env.TELEGRAM_STARS_ENABLED === "1" && Number.isSafeInteger(stars) && stars > 0 && stars <= 100000 && (service.mode !== "prediction" || cfg.FEATURE_PREDICTION_ANALYSIS);
    return { ...service, stars: enabled ? stars : null, enabled };
  });
}
type Order = { id: string; userId: number; serviceId: string; stars: number; input: unknown; networkKey: "xlayer" | "base" | "arbitrum" | "robinhood" | "arc"; surface?: "ton"; createdAt: number; chargeId?: string; paidAt?: string; jobId?: string; refunded?: boolean };
export type TelegramCommerceProfile = { apiPrefix?: string; webhookSecret?: string; appUrl?: string; allowEvm?: boolean; botOnly?: boolean };
export type StarsUpdate = { pre_checkout_query?: { id: string; from: { id: number }; currency: string; total_amount: number; invoice_payload: string }; message?: { chat?: { id?: number; type?: string }; from?: { id?: number }; successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string } } };
export class TelegramCommerce {
  private memory = new Map<string, Order>();
  private checkoutLocks = new Map<string, string>();
  private processingLocks = new Set<string>();
  readonly walletLinks: TelegramWalletLink | null;
  constructor(private cfg: AppConfig, private dependencies: TelegramCommerceDependencies | undefined, private token: string, private api: (method: string, payload: unknown) => Promise<{ result?: unknown }>, private delivery: (id: number, surface?: "ton") => string, private profile: TelegramCommerceProfile = {}) { this.walletLinks = dependencies && profile.allowEvm !== false ? new TelegramWalletLink(cfg, dependencies.jobs) : null; }
  tonMiniApp(appUrl: string, enabled: boolean) {
    const view = new TelegramCommerce(this.cfg,this.dependencies,enabled?this.token:"",this.api,this.delivery,{apiPrefix:"/v1/telegram/ton",appUrl,allowEvm:false,webhookSecret:this.profile.webhookSecret});
    view.memory=this.memory;view.checkoutLocks=this.checkoutLocks;view.processingLocks=this.processingLocks;
    return view;
  }
  private visible(order: Order) { return this.profile.allowEvm !== false || order.surface === "ton"; }
  private libraryKey(userId: number) { return `${this.userKey(userId)}${this.profile.allowEvm === false ? ":ton" : ""}`; }
  private account(userId: number) { return `telegram:${userId}`; }
  private userKey(userId: number) { return `${this.cfg.PERSISTENCE_NAMESPACE || "pulse"}:telegram:stars:user:${userId}`; }
  private catalog(){return telegramServiceCatalog(this.cfg).map(service=>this.profile.allowEvm===false?{...service,title:service.title.replace(" → Spot",""),enabled:service.enabled&&service.mode==="spot",stars:service.enabled&&service.mode==="spot"?service.stars:null}:service);}
  private key(id: string) { return `${this.cfg.PERSISTENCE_NAMESPACE || "pulse"}:telegram:stars:order:${id}`; }
  async walletAssociation(userId: number) { return this.walletLinks?.association(userId) || null; }
  private async locked<T>(id: string, operation: () => Promise<T>) {
    const key = `${this.key(id)}:processing`;
    const nonce = randomUUID();
    if (kvConfigured()) {
      if (await runKvCommand(["SET",key,nonce,"NX","EX",60],"Telegram Stars") !== "OK") throw new Error("This order is processing. Retry its existing status shortly.");
    } else { if(this.processingLocks.has(id)) throw new Error("This order is processing"); this.processingLocks.add(id); }
    try { return await operation(); }
    finally {
      if(kvConfigured()) await runKvCommand(["EVAL","if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,key,nonce],"Telegram Stars");
      else this.processingLocks.delete(id);
    }
  }
  private async save(order: Order) {
    if (kvConfigured()) await runKvCommand(["SET", this.key(order.id), JSON.stringify(order)], "Telegram Stars");
    else this.memory.set(order.id, structuredClone(order));
  }
  private async get(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    if (!kvConfigured()) return this.memory.get(id) || null;
    const raw = await runKvCommand(["GET", this.key(id)], "Telegram Stars");
    return typeof raw === "string" ? JSON.parse(raw) as Order : null;
  }
  private ready() { return Boolean(this.cfg.FEATURE_TELEGRAM && this.dependencies && this.token && (this.profile.webhookSecret ?? process.env.TELEGRAM_WEBHOOK_SECRET) && (this.profile.appUrl ?? process.env.TELEGRAM_MINI_APP_URL)?.startsWith("https://") && process.env.TELEGRAM_STARS_ENABLED === "1" && (this.cfg.NODE_ENV === "test" || (kvConfigured() && this.cfg.QUEUE_PROVIDER !== "memory" && this.cfg.STORAGE_PROVIDER !== "memory"))); }
  private async enqueue(order: Order) {
    const deps = this.dependencies!;
    const service = TELEGRAM_SERVICES.find(item => item.id === order.serviceId)!;
    const hash = requestHash(order.input);
    const acquired = await deps.jobs.acquire({ idempotencyKey: `telegram-stars:${order.id}`, requestHash: hash, resourceUrl: `/v1/telegram/${order.surface === "ton" ? "ton/" : ""}orders/${order.id}`, network: "telegram:stars", networkKey: order.networkKey, mode: service.mode, tier: service.tier, payer: this.account(order.userId), input: { ...(order.input as object), _telegramDelivery: this.delivery(order.userId,order.surface) }, requesterIp: "telegram", maxRegenerationAttempts: this.cfg.PAID_REGENERATION_MAX_ATTEMPTS });
    const at = order.paidAt!;
    const receipt: PaymentReceipt = { id: `telegram:${order.chargeId}`, provider: "telegram_stars", network: "telegram:stars", chainId: 0, asset: "XTR", amountAtomic: String(order.stars), payer: this.account(order.userId), payee: "pulse", authorizationId: order.chargeId!, resourceUrl: acquired.job.resourceUrl, requestHash: hash, verificationResult: "accepted_by_middleware", settlementResult: "settled", settlementMode: "telegram_stars", finality: { status: "telegram_confirmed", scope: "telegram" }, createdAt: at, verifiedAt: at, settledAt: at };
    // Replaying after a crash reuses the order's job and can repair a missing receipt.
    if (!acquired.job.receiptId) await deps.jobs.bindReceiptAndEnqueue(acquired.job.id, receipt);
    order.jobId = acquired.job.id;
    await this.save(order);
    deps.wakeWorker();
  }
  private async validateCheckout(query: NonNullable<StarsUpdate["pre_checkout_query"]>) {
      const order = await this.get(query.invoice_payload);
      const serviceEnabled = this.catalog().find(service => service.id === order?.serviceId)?.enabled;
      let ok = this.ready() && Boolean(serviceEnabled) && Boolean(order && !order.chargeId && !order.refunded && order.userId === query.from.id && query.currency === "XTR" && query.total_amount === order.stars && Date.now() - order.createdAt < 15 * 60_000);
      if (ok && order) {
        const lock = `${this.key(order.id)}:checkout`;
        if (kvConfigured()) {
          const acquired = await runKvCommand(["SET", lock, query.id, "NX", "EX", 900], "Telegram Stars");
          ok = acquired === "OK" || await runKvCommand(["GET", lock], "Telegram Stars") === query.id;
        } else {
          const previous = this.checkoutLocks.get(order.id);
          ok = !previous || previous === query.id;
          if (ok) this.checkoutLocks.set(order.id, query.id);
        }
      }
      return ok;
  }
  async handleUpdate(update: StarsUpdate) {
    const query = update.pre_checkout_query;
    if (query) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ok = await Promise.race([this.validateCheckout(query).catch(() => false), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false),3500); })]).finally(() => clearTimeout(timer));
      await this.api("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok, ...(!ok ? { error_message: "This checkout is unavailable or expired. Reopen PULSE and create a new invoice." } : {}) });
      return true;
    }
    const payment = update.message?.successful_payment;
    if (!payment) return false;
    return this.locked(payment.invoice_payload, async () => {
    const order = await this.get(payment.invoice_payload);
    if (!order || order.userId !== update.message?.from?.id || update.message?.chat?.type !== "private" || update.message.chat.id !== order.userId || payment.currency !== "XTR" || payment.total_amount !== order.stars || (order.chargeId && order.chargeId !== payment.telegram_payment_charge_id)) throw new Error("Stars payment does not match its order");
    if (order.refunded) return true;
    if (order.chargeId && order.jobId) return true;
    // Fulfillment remains enabled for paid orders even when new sales are paused.
    if (!this.dependencies) throw new Error("Stars fulfillment unavailable");
    order.chargeId = payment.telegram_payment_charge_id;
    order.paidAt ||= new Date().toISOString();
    await this.save(order);
    await this.enqueue(order);
    await this.api("sendMessage", { chat_id: order.userId, text: "Payment received ★ Your PULSE report is being prepared. Find it in My reports; you do not need to pay again." });
    return true;
    });
  }
  async createInvoice(userId: number, serviceId: string, rawInput: unknown, networkKey = "xlayer", orderId = randomUUID()) {
    if (!this.ready()) throw new Error("Stars checkout is unavailable. No payment was taken.");
    const service = this.catalog().find(item => item.id === serviceId);
    if (!service?.enabled || !service.stars) throw new Error("Service unavailable");
    if(this.profile.allowEvm===false&&((rawInput as {instId?:string})?.instId!=="TON-USDT"||networkKey!=="xlayer"))throw new Error("This Mini App supports TON-USDT research only. EVM token inputs and execution are unavailable.");
    let input = service.mode === "spot" ? this.dependencies!.validateGlobal(rawInput) : service.mode === "prediction" ? PredictionAnalysisRequestSchema.parse(rawInput) : TokenScanRequestSchema.parse(rawInput);
    if (!["xlayer", "base", "arbitrum", "robinhood", "arc"].includes(networkKey)) throw new Error("Unsupported network");
    if (service.mode === "spot" && isArcMarket(String((input as { instId?: string }).instId || "")) && networkKey !== "arc") throw new Error("Arc contract markets require Arc Mainnet; no checkout created");
    if (service.mode === "risk") input = { ...(input as object), chainId: ({ xlayer: "196", base: "8453", arbitrum: "42161", robinhood: "4663", arc: "5042" } as Record<string,string>)[networkKey] };
    const existing = await this.get(orderId);
    if (existing && (existing.userId !== userId || existing.serviceId !== serviceId || requestHash(existing.input) !== requestHash(input) || existing.networkKey !== networkKey)) throw new Error("Order does not match this purchase");
    if (existing?.chargeId || existing?.refunded) throw new Error("This order is already paid. Open My reports.");
    if (existing && Date.now()-existing.createdAt >= 15*60_000) throw new Error("This invoice expired. Select the service again.");
    if(existing&&!this.visible(existing))throw new Error("Order not found");
    const order: Order = existing || { id: orderId, userId, serviceId, stars: service.stars, input, networkKey: networkKey as Order["networkKey"], ...(this.profile.allowEvm===false?{surface:"ton" as const}:{}), createdAt: Date.now() };
    await this.save(order);
    if (kvConfigured()) {
      await runKvCommand(["ZADD",this.userKey(userId),order.createdAt,order.id],"Telegram Stars");
      if(order.surface==="ton")await runKvCommand(["ZADD",`${this.userKey(userId)}:ton`,order.createdAt,order.id],"Telegram Stars");
    }
    const title = this.profile.allowEvm === false ? service.title.replace(" → Spot", "") : service.title;
    const invoice = await this.api("createInvoiceLink", { title, description: "One PULSE research report. This purchase does not authorize transactions or fund trading.", payload: order.id, provider_token: "", currency: "XTR", prices: [{ label: title, amount: order.stars }] });
    if (typeof invoice.result !== "string" || !invoice.result.startsWith("https://t.me/")) throw new Error("Telegram did not return an invoice link");
    return { orderId: order.id, invoiceUrl: invoice.result, stars: order.stars };
  }
  async library(userId: number) {
    const ids = kvConfigured() ? await runKvCommand(["ZREVRANGE",this.libraryKey(userId),0,29],"Telegram Stars") : [...this.memory.values()].filter(order=>order.userId===userId&&this.visible(order)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30).map(order=>order.id);
    const orders = await Promise.all((Array.isArray(ids)?ids:[]).map(async id=>{const order=await this.get(String(id));if(!order||order.userId!==userId||!this.visible(order))return null;const job=order.jobId?await this.dependencies!.jobs.get(order.jobId):null;return {id:order.id,...researchIdentity(researchContext(order.serviceId,order.input,order.networkKey,order.createdAt)),stars:order.stars,createdAt:order.createdAt,status:order.refunded?"refunded":job?.stage||(order.chargeId?"payment_received":"awaiting_payment"),hasReport:Boolean(job?.reportId)};}));
    const history = await this.walletLinks?.history(userId) || [];
    return [...orders.filter((order):order is NonNullable<typeof order>=>Boolean(order)), ...history.map(job=>({id:`wallet:${job.id}`,...researchIdentity(researchContext(jobServiceId(job),job.input,job.networkKey,job.createdAt)),stars:null,source:"wallet",networkKey:job.networkKey,createdAt:Date.parse(job.createdAt),status:job.stage,hasReport:Boolean(job.reportId)}))].sort((a,b)=>b.createdAt-a.createdAt).slice(0,60);
  }
  async readOwned(userId: number, id: string) {
    if (id.startsWith("wallet:")) {
      const job = await this.walletLinks?.ownedJob(userId,id.slice(7));
      if (!job) throw new Error("Wallet report not found");
      const record = job.reportId ? await this.dependencies!.reports.get(job.reportId) : null;
      return { orderId:id,serviceId:jobServiceId(job),context:researchContext(jobServiceId(job),job.input,job.networkKey,job.createdAt),status:job.stage,source:"wallet",report:record?.ownerWallet===job.payer.toLowerCase()?await this.dependencies!.reports.read(record):null };
    }
    const order = await this.get(id);
    if (!order || order.userId !== userId || !this.visible(order)) throw new Error("Order not found");
    if(order.chargeId&&!order.jobId&&!order.refunded) await this.locked(id,async()=>{const current=await this.get(id);if(current?.chargeId&&!current.jobId&&!current.refunded)await this.enqueue(current);order.jobId=current?.jobId;});
    const job=order.jobId?await this.dependencies!.jobs.get(order.jobId):null;
    const record=job?.reportId?await this.dependencies!.reports.get(job.reportId):null;
    return {orderId:id,serviceId:order.serviceId,context:researchContext(order.serviceId,order.input,order.networkKey,order.createdAt),stars:order.stars,status:order.refunded?"refunded":job?.stage||(order.chargeId?"payment_received":"awaiting_payment"),report:record?.ownerWallet===this.account(userId)?await this.dependencies!.reports.read(record):null};
  }
  async refundOwned(userId: number, id: string) {
    const order=await this.get(id);if(!order||order.userId!==userId||!this.visible(order))throw new Error("Order not found");if(order.refunded)return {refunded:true};
    return this.locked(id,async()=>{const current=await this.get(id);if(current?.refunded)return {refunded:true};const job=current?.jobId?await this.dependencies!.jobs.get(current.jobId):null;if(!current?.chargeId||!job||!["failed_terminal","manual_reconciliation"].includes(job.stage)||job.reportId)throw new Error("Only failed reports without a delivered result can be automatically refunded. Use /paysupport.");await this.api("refundStarPayment",{user_id:userId,telegram_payment_charge_id:current.chargeId});current.refunded=true;await this.save(current);return {refunded:true};});
  }
  router() {
    const prefix=this.profile.apiPrefix || "/v1/telegram";
    const router = Router();
    router.get(`${prefix}/services`, (_req, res) => res.json({ services: this.catalog(), checkoutReady: this.ready(), currency: "XTR",mode:this.profile.allowEvm===false?"ton_miniapp":"pulse" }));
    router.use([`${prefix}/session`, `${prefix}/orders`, `${prefix}/wallet`], (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      if(this.profile.botOnly) return res.status(403).json({error:"Use PULSE chat for these services, or the signed TON Mini App API for its research."});
      if (!this.cfg.FEATURE_TELEGRAM || !this.token || !this.dependencies) return res.status(503).json({ error: "Telegram is unavailable" });
      try { res.locals.telegramUser = validateTelegramInitData(String(req.header("PULSE-TELEGRAM-INIT-DATA") || ""), this.token); next(); }
      catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "Telegram sign-in failed" }); }
    });
    if (this.walletLinks) router.use(this.walletLinks.router());
    router.get(`${prefix}/session`, asyncRoute(async (_req, res) => res.json({ user: res.locals.telegramUser, walletRequired: false, association: await this.walletAssociation(res.locals.telegramUser.id) })));
    router.post(`${prefix}/orders`, asyncRoute(async (req,res) => { try { return res.status(201).json(await this.createInvoice(res.locals.telegramUser.id,String(req.body?.serviceId || ""),req.body?.input,req.body?.networkKey)); } catch(error) { return res.status(this.ready()?400:503).json({error:error instanceof Error?error.message:"Invalid purchase"}); } }));
    router.get(`${prefix}/orders`, asyncRoute(async (_req,res) => res.json({orders:await this.library(res.locals.telegramUser.id)})));
    router.get(`${prefix}/orders/:id`, asyncRoute(async (req,res) => { try { return res.json(await this.readOwned(res.locals.telegramUser.id,String(req.params.id))); } catch(error) { return res.status(error instanceof Error&&error.message.includes("not found")?404:503).json({error:error instanceof Error?error.message:"Report unavailable"}); } }));
    router.post(`${prefix}/orders/:id/refund`, asyncRoute(async (req,res) => { try { return res.json(await this.refundOwned(res.locals.telegramUser.id,String(req.params.id))); } catch(error) { return res.status(error instanceof Error&&error.message.includes("not found")?404:409).json({error:error instanceof Error?error.message:"Refund unavailable"}); } }));
    router.post(`${prefix}/orders/:id/handoff`, asyncRoute(async (req, res) => {
      if(this.profile.allowEvm === false) return res.status(404).json({error:"Execution handoffs are unavailable in this Mini App."});
      if (String(req.params.id).startsWith("wallet:")) {
        const job = await this.walletLinks!.ownedJob(res.locals.telegramUser.id, String(req.params.id).slice(7));
        if (!job || job.mode !== "spot" || !job.reportId || !["completed", "completed_partial"].includes(job.stage)) return res.status(404).json({ error: "Completed wallet-owned Global report not found" });
        const record = await this.dependencies!.reports.get(job.reportId);
        if (!record || record.ownerWallet !== job.payer.toLowerCase()) return res.status(404).json({ error: "Report unavailable" });
        const share = await this.dependencies!.reports.createShare(record.id);
        return res.json({ shareToken: share.token });
      }
      const order = await this.get(String(req.params.id));
      if (!order || order.userId !== res.locals.telegramUser.id) return res.status(404).json({ error: "Order not found" });
      if (!order.serviceId.startsWith("global") || !order.jobId || order.refunded) return res.status(409).json({ error: "A completed Global report is required" });
      const job = await this.dependencies!.jobs.get(order.jobId);
      if (!job?.reportId || !["completed", "completed_partial"].includes(job.stage)) return res.status(409).json({ error: "Report is still processing" });
      const record = await this.dependencies!.reports.get(job.reportId);
      if (!record || record.ownerWallet !== this.account(order.userId)) return res.status(404).json({ error: "Report unavailable" });
      const share = await this.dependencies!.reports.createShare(record.id);
      return res.json({ shareToken: share.token });
    }));
    return router;
  }
}
