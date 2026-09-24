import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "@pulse/config";
import { isKvUnavailableError, kvConfigured, runKvCommand } from "./resilientKv.js";
import { asyncRoute } from "./httpResilience.js";

type TelegramUpdate = { update_id?: number; message?: { chat?: { id?: number; type?: string }; text?: string; from?: { id?: number } }; callback_query?: { id?: string; data?: string; message?: { chat?: { id?: number; type?: string } } } };

export function telegramMenu(miniAppUrl: string, capability: string, command = "") {
  const destinations = [
    { label: "Open PULSE", path: "/overview", command: "/start" },
    { label: "Global Market", path: "/global", command: "/global" },
    { label: "Prediction Market", path: "/prediction", command: "/prediction" },
    { label: "Risk Guard", path: "/safety", command: "/risk" },
    { label: "Spot Trading", path: "/spot", command: "/spot" },
    { label: "Autopilot", path: "/autopilot", command: "/autopilot" },
    { label: "My reports", path: "/overview", hash: "reports", command: "/reports" },
  ];
  const selected = command.split(/\s/)[0].split("@")[0];
  const ordered = [...destinations].sort((a, b) => Number(b.command === selected) - Number(a.command === selected));
  return { inline_keyboard: ordered.map(item => {
    const url = new URL(miniAppUrl);
    url.pathname = item.path;
    url.hash = item.hash || "";
    // A stale job/service in the configured URL must not override the chosen destination.
    for (const key of ["service", "job", "recoveryToken"]) url.searchParams.delete(key);
    url.searchParams.set("source", "telegram");
    url.searchParams.set("tg", capability);
    return [{ text: item.label, web_app: { url: url.toString() } }];
  }) };
}
type DeliveryTask = { id:string;delivery:string;text:string;reportUrl:string;attempts:number;nextAt:number;createdAt:string;lastError?:string };

export function telegramReportUrl(miniAppUrl: string, shareToken: string) {
  const url = new URL(miniAppUrl);
  if (url.protocol !== "https:") throw new Error("Telegram report viewer requires HTTPS");
  url.pathname = "/shared-report";
  url.search = "";
  // Keep the bearer capability out of frontend access logs and Referer headers.
  url.hash = new URLSearchParams({ share: shareToken }).toString();
  return url.toString();
}
const memoryDeliveries = new Map<string, DeliveryTask>();
const memoryUpdates = new Set<number>();
const memoryDeliveryLocks = new Set<string>();
const memoryDelivered = new Set<string>();

type TelegramEnvironment = Partial<Record<"TELEGRAM_BOT_TOKEN" | "TELEGRAM_BOT_USERNAME" | "TELEGRAM_WEBHOOK_SECRET" | "TELEGRAM_MINI_APP_URL", string | undefined>>;

export function inspectTelegramConfiguration(env: TelegramEnvironment = process.env) {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const botUsername = (env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  const miniAppUrl = env.TELEGRAM_MINI_APP_URL?.trim() || "";
  const missing = [
    !botToken && "TELEGRAM_BOT_TOKEN",
    !botUsername && "TELEGRAM_BOT_USERNAME",
    !webhookSecret && "TELEGRAM_WEBHOOK_SECRET",
    !miniAppUrl && "TELEGRAM_MINI_APP_URL",
  ].filter((value): value is string => Boolean(value));
  let miniAppUrlError: string | null = null;
  if (miniAppUrl) {
    try {
      const parsed = new URL(miniAppUrl);
      if (parsed.protocol !== "https:") miniAppUrlError = "TELEGRAM_MINI_APP_URL must use HTTPS";
    } catch {
      miniAppUrlError = "TELEGRAM_MINI_APP_URL is not a valid absolute URL";
    }
  }
  return { botToken, botUsername, webhookSecret, miniAppUrl, missing, miniAppUrlError, complete: missing.length === 0 && !miniAppUrlError };
}

async function kv(command: unknown[]) {
  return runKvCommand(command,"Telegram delivery");
}

async function telegram(token: string, method: string, payload: unknown) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
  if (!response.ok || !body.ok) throw new Error(`Telegram ${method} failed: ${body.description || response.status}`);
  return body;
}

// A capability may be attached to a 30-day Autopilot pass. Keep it valid for
// five additional days so the two-hour warning and expiry notice still arrive
// after a long pass. It remains chat-bound and cannot authorize wallet actions.
function deliveryToken(chatId: number, secret: string) { const id=String(chatId),expires=String(Date.now()+35*24*60*60_000),payload=`${id}.${expires}`;return `${payload}.${createHmac("sha256",secret).update(payload).digest("base64url")}`; }
function verifiedChatId(value: string, secret: string) { const match=/^(-?\d{1,20})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value);if(!match||Number(match[2])<Date.now())return null;const payload=`${match[1]}.${match[2]}`,expected=createHmac("sha256",secret).update(payload).digest(),actual=Buffer.from(match[3],"base64url");return actual.length===expected.length&&timingSafeEqual(actual,expected)?match[1]:null; }
export function isTelegramDeliveryCapability(value:string){const secret=process.env.TELEGRAM_WEBHOOK_SECRET?.trim()||"";return Boolean(secret&&verifiedChatId(value,secret));}
export async function deliverTelegramReport(delivery:string, text:string, reportUrl:string){const token=process.env.TELEGRAM_BOT_TOKEN?.trim()||"";const secret=process.env.TELEGRAM_WEBHOOK_SECRET?.trim()||"";const chatId=verifiedChatId(delivery,secret);if(!token||!chatId)throw new Error("Telegram delivery capability is invalid");return telegram(token,"sendMessage",{chat_id:chatId,text:`${text.slice(0,3000)}\n\nOpen full report: ${reportUrl}`,disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:"Open full PULSE report",url:reportUrl}]]}});}

async function saveDelivery(task:DeliveryTask){
  if(kvConfigured()){await kv(["SET",`pulse:v6:telegram:delivery:${task.id}`,JSON.stringify(task),"EX",604800]);await kv(["ZADD","pulse:v6:telegram:due",task.nextAt,task.id]);}
  else memoryDeliveries.set(task.id,task);
}
async function removeDelivery(id:string){if(kvConfigured()){await kv(["DEL",`pulse:v6:telegram:delivery:${id}`]);await kv(["ZREM","pulse:v6:telegram:due",id]);}else memoryDeliveries.delete(id);}
export async function deliverTelegramReportDurably(id:string,delivery:string,text:string,reportUrl:string){
  if (await wasDelivered(id)) return { delivered:true };
  const task:DeliveryTask={id,delivery,text,reportUrl,attempts:0,nextAt:Date.now(),createdAt:new Date().toISOString()};
  // Persist before attempting network delivery so a process restart can resume it.
  await saveDelivery(task);
  const delivered = await attemptDelivery(task);
  return { delivered, queued: !delivered };
}
async function dueDeliveries(){
  if(kvConfigured()){const ids=await kv(["ZRANGEBYSCORE","pulse:v6:telegram:due",0,Date.now(),"LIMIT",0,20]);const tasks=await Promise.all((Array.isArray(ids)?ids:[]).map(async id=>{const raw=await kv(["GET",`pulse:v6:telegram:delivery:${id}`]);return typeof raw==="string"?JSON.parse(raw) as DeliveryTask:null;}));return tasks.filter((task):task is DeliveryTask=>Boolean(task));}
  return [...memoryDeliveries.values()].filter(task=>task.nextAt<=Date.now()).slice(0,20);
}
async function wasDelivered(id:string){return kvConfigured() ? Boolean(await kv(["GET",`pulse:v6:telegram:sent:${id}`])) : memoryDelivered.has(id);}
async function lockDelivery(id:string){if(kvConfigured())return (await kv(["SET",`pulse:v6:telegram:lock:${id}`,"1","NX","EX",60]))==="OK";if(memoryDeliveryLocks.has(id))return false;memoryDeliveryLocks.add(id);return true;}
async function attemptDelivery(task:DeliveryTask){
  if(!(await lockDelivery(task.id)))return false;
  try {
    if (!(await wasDelivered(task.id))) {
      await deliverTelegramReport(task.delivery,task.text,task.reportUrl);
      if(kvConfigured())await kv(["SET",`pulse:v6:telegram:sent:${task.id}`,"1","EX",604800]);
      else { memoryDelivered.add(task.id); if(memoryDelivered.size>1000)memoryDelivered.delete(memoryDelivered.values().next().value!); }
    }
    await removeDelivery(task.id);return true;
  } catch(error) {
    task.attempts+=1;task.lastError=(error instanceof Error?error.message:String(error)).slice(0,300);
    task.nextAt=Date.now()+Math.min(3_600_000,30_000*2**Math.min(task.attempts,7));await saveDelivery(task);return false;
  } finally {
    if(kvConfigured())await kv(["DEL",`pulse:v6:telegram:lock:${task.id}`]);else memoryDeliveryLocks.delete(task.id);
  }
}
export async function runTelegramDeliveryCycle(){for(const task of await dueDeliveries())await attemptDelivery(task);}
export function startTelegramDeliveryWorker(){if(!["1","true"].includes(process.env.FEATURE_TELEGRAM||""))return()=>{};const run=()=>void runTelegramDeliveryCycle().catch(error=>{if(!isKvUnavailableError(error))console.error("Telegram delivery retry failed",error);});const timer=setInterval(run,30_000);timer.unref();run();return()=>clearInterval(timer);}
async function firstTelegramUpdate(updateId:number|undefined){if(updateId===undefined)return true;if(kvConfigured())return (await kv(["SET",`pulse:v6:telegram:update:${updateId}`,"1","NX","EX",604800]))==="OK";if(memoryUpdates.has(updateId))return false;memoryUpdates.add(updateId);return true;}
async function releaseTelegramUpdate(updateId:number|undefined){if(updateId===undefined)return;if(kvConfigured())await kv(["DEL",`pulse:v6:telegram:update:${updateId}`]);else memoryUpdates.delete(updateId);}

export function createTelegramRouter(cfg: AppConfig) {
  const router = Router();
  const telegramConfig = inspectTelegramConfiguration();
  const { botToken: token, botUsername, webhookSecret, miniAppUrl } = telegramConfig;

  const enabled = cfg.FEATURE_TELEGRAM;
  router.get("/v1/telegram/status", (_req, res) => {
    res.json({ enabled, configured: Boolean(enabled && telegramConfig.complete), missing: telegramConfig.missing, miniAppUrlError: telegramConfig.miniAppUrlError, botUsername: botUsername || null, botUrl: botUsername ? `https://t.me/${botUsername}` : null, webhookPath: "/v1/telegram/webhook", miniAppUrl: miniAppUrl || null, custody: false, durableDelivery: Boolean(enabled && telegramConfig.complete && cfg.REPORT_SHARE_LINK_ENABLED && kvConfigured()) });
  });
  router.post("/v1/telegram/webhook", asyncRoute(async (req, res) => {
    if (!enabled) return res.status(404).json({ error: "Telegram bot is disabled" });
    if (!telegramConfig.complete) return res.status(503).json({ error: "Telegram bot is not configured", missing: telegramConfig.missing, miniAppUrlError: telegramConfig.miniAppUrlError });
    if (req.header("x-telegram-bot-api-secret-token") !== webhookSecret) return res.status(401).json({ error: "Invalid Telegram webhook secret" });
    const update = req.body as TelegramUpdate;
    if (!(await firstTelegramUpdate(update.update_id))) return res.status(200).json({ ok: true, duplicate: true });
    const chat = update.message?.chat || update.callback_query?.message?.chat;
    const chatId = chat?.id;
    // Never publish a report-delivery capability to a group. Web App buttons are private-chat only.
    if (!chatId || chat?.type !== "private") return res.status(200).json({ ok: true, ignored: true });
    const text = (update.message?.text || update.callback_query?.data || "").trim().toLowerCase();
    const keyboard = telegramMenu(miniAppUrl, deliveryToken(chatId, webhookSecret), text);
    const reply = text.startsWith("/reports") ? "Open My reports for reports saved on this device. For another device, open Global, Prediction Market or Risk Guard and use Paid report history → Sync with wallet. Recovery does not charge you again."
      : text.startsWith("/wallet") ? "Open PULSE and use Wallet & funding in the header to connect your wallet. Never send a private key or seed phrase here. A report-history signature proves ownership; it does not authorize a payment or trade."
      : "Welcome to PULSE. Tap a button to open the app—no commands needed.\n\nChoose markets and review prices in the app. Global, Prediction and Risk Guard reports purchased through these chat buttons can be delivered here.\n\nSpot orders need your wallet approval. Autopilot trades autonomously within your signed limits. Nothing trades merely by opening the app.";
    try {
      if (update.callback_query?.id) await telegram(token, "answerCallbackQuery", { callback_query_id: update.callback_query.id });
      await telegram(token, "sendMessage", { chat_id: chatId, text: reply, reply_markup: keyboard, disable_web_page_preview: true }); res.json({ ok: true, updateId: update.update_id }); }
    catch (error) { await releaseTelegramUpdate(update.update_id);res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));
  return router;
}
