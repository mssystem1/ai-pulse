import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "@pulse/config";
import { isKvUnavailableError, runKvCommand } from "./resilientKv.js";
import { asyncRoute } from "./httpResilience.js";

type TelegramUpdate = { update_id?: number; message?: { chat?: { id?: number }; text?: string; from?: { id?: number } }; callback_query?: { id?: string; data?: string; message?: { chat?: { id?: number } } } };
type DeliveryTask = { id:string;delivery:string;text:string;reportUrl:string;attempts:number;nextAt:number;createdAt:string;lastError?:string };
const memoryDeliveries = new Map<string, DeliveryTask>();
const memoryUpdates = new Set<number>();

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
  if(process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN){await kv(["SET",`pulse:v6:telegram:delivery:${task.id}`,JSON.stringify(task),"EX",604800]);await kv(["ZADD","pulse:v6:telegram:due",task.nextAt,task.id]);}
  else memoryDeliveries.set(task.id,task);
}
async function removeDelivery(id:string){if(process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN){await kv(["DEL",`pulse:v6:telegram:delivery:${id}`]);await kv(["ZREM","pulse:v6:telegram:due",id]);}else memoryDeliveries.delete(id);}
export async function deliverTelegramReportDurably(id:string,delivery:string,text:string,reportUrl:string){
  try{await deliverTelegramReport(delivery,text,reportUrl);await removeDelivery(id);return {delivered:true};}
  catch(error){const task:DeliveryTask={id,delivery,text,reportUrl,attempts:0,nextAt:Date.now()+30_000,createdAt:new Date().toISOString(),lastError:(error instanceof Error?error.message:String(error)).slice(0,300)};await saveDelivery(task);return {delivered:false,queued:true};}
}
async function dueDeliveries(){
  if(process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN){const ids=await kv(["ZRANGEBYSCORE","pulse:v6:telegram:due",0,Date.now(),"LIMIT",0,20]);const tasks=await Promise.all((Array.isArray(ids)?ids:[]).map(async id=>{const raw=await kv(["GET",`pulse:v6:telegram:delivery:${id}`]);return typeof raw==="string"?JSON.parse(raw) as DeliveryTask:null;}));return tasks.filter((task):task is DeliveryTask=>Boolean(task));}
  return [...memoryDeliveries.values()].filter(task=>task.nextAt<=Date.now()).slice(0,20);
}
async function lockDelivery(id:string){if(process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN)return (await kv(["SET",`pulse:v6:telegram:lock:${id}`,"1","NX","EX",60]))==="OK";return true;}
export async function runTelegramDeliveryCycle(){for(const task of await dueDeliveries()){if(!(await lockDelivery(task.id)))continue;try{await deliverTelegramReport(task.delivery,task.text,task.reportUrl);await removeDelivery(task.id);}catch(error){task.attempts+=1;task.lastError=(error instanceof Error?error.message:String(error)).slice(0,300);task.nextAt=Date.now()+Math.min(3_600_000,30_000*2**Math.min(task.attempts,7));await saveDelivery(task);}}}
export function startTelegramDeliveryWorker(){if(process.env.FEATURE_TELEGRAM!=="1")return()=>{};const run=()=>void runTelegramDeliveryCycle().catch(error=>{if(!isKvUnavailableError(error))console.error("Telegram delivery retry failed",error);});const timer=setInterval(run,30_000);timer.unref();run();return()=>clearInterval(timer);}
async function firstTelegramUpdate(updateId:number|undefined){if(updateId===undefined)return true;if(process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN)return (await kv(["SET",`pulse:v6:telegram:update:${updateId}`,"1","NX","EX",604800]))==="OK";if(memoryUpdates.has(updateId))return false;memoryUpdates.add(updateId);return true;}
async function releaseTelegramUpdate(updateId:number|undefined){if(updateId===undefined)return;if(process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN)await kv(["DEL",`pulse:v6:telegram:update:${updateId}`]);else memoryUpdates.delete(updateId);}

export function createTelegramRouter(cfg: AppConfig) {
  const router = Router();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
  const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL?.trim() || process.env.BASE_URL || "";

  const enabled = cfg.FEATURE_TELEGRAM;
  router.get("/v1/telegram/status", (_req, res) => {
    const botUsername = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();
    res.json({ enabled, configured: Boolean(enabled && token && webhookSecret && miniAppUrl), botUsername: botUsername || null, botUrl: botUsername ? `https://t.me/${botUsername}` : null, webhookPath: "/v1/telegram/webhook", miniAppUrl: miniAppUrl || null, custody: false, durableDelivery: Boolean(enabled && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) });
  });
  router.post("/v1/telegram/webhook", asyncRoute(async (req, res) => {
    if (!enabled) return res.status(404).json({ error: "Telegram bot is disabled" });
    if (!token || !webhookSecret) return res.status(503).json({ error: "Telegram bot is not configured" });
    if (req.header("x-telegram-bot-api-secret-token") !== webhookSecret) return res.status(401).json({ error: "Invalid Telegram webhook secret" });
    const update = req.body as TelegramUpdate;
    if (!(await firstTelegramUpdate(update.update_id))) return res.status(200).json({ ok: true, duplicate: true });
    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    if (!chatId) return res.status(200).json({ ok: true, ignored: true });
    const text = (update.message?.text || update.callback_query?.data || "").trim().toLowerCase();
    const capability=deliveryToken(chatId,webhookSecret);const separator=miniAppUrl.includes("?")?"&":"?";
    const keyboard = { inline_keyboard: [[{ text: "Global Market report", web_app: { url: `${miniAppUrl}${separator}source=telegram&service=global&tg=${encodeURIComponent(capability)}` } }], [{ text: "Prediction report", web_app: { url: `${miniAppUrl}${separator}source=telegram&service=prediction&tg=${encodeURIComponent(capability)}` } }], [{ text: "My reports", web_app: { url: `${miniAppUrl}${separator}source=telegram&service=reports&tg=${encodeURIComponent(capability)}` } }]] };
    const reply = text.startsWith("/help") ? "PULSE uses your own wallet in the secure Mini App. The bot never asks for a seed phrase or private key. Choose a service, review the x402 price, sign payment, and receive the result here."
      : text.startsWith("/wallet") ? "Open the Mini App to link or unlink a wallet using a one-time signed nonce. Telegram receives no wallet secret."
      : "Choose a PULSE service. Payment and wallet signatures happen only in the Mini App; the durable report result is delivered back to this chat.";
    try { await telegram(token, "sendMessage", { chat_id: chatId, text: reply, reply_markup: keyboard, disable_web_page_preview: true }); res.json({ ok: true, updateId: update.update_id }); }
    catch (error) { await releaseTelegramUpdate(update.update_id);res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));
  return router;
}
