import { API_BASE } from "./api";
import type { GlobalReport, TerminalMarketSnapshot, TerminalRadarState, TerminalSourceStatus } from "@pulse/domain";
import { globalSetupAdmission } from "@pulse/domain";
import { terminalUsdAtomic } from "./terminalPricing";

export type TerminalDuration = "24h" | "7d" | "30d";
export type TerminalTimeframe = "15m" | "1H" | "4H" | "1Dutc" | "1Wutc";
export const TERMINAL_FRAMES: readonly TerminalTimeframe[] = ["15m", "1H", "4H", "1Dutc", "1Wutc"];
export const terminalFrameRoles: Record<TerminalTimeframe, { entry: string; context: string; window: string }> = {
  "15m": { entry: "5m", context: "1H", window: "Session / day" },
  "1H": { entry: "15m", context: "4H", window: "Day / week" },
  "4H": { entry: "1H", context: "1D", window: "Swing / week" },
  "1Dutc": { entry: "4H", context: "1W", window: "Swing / month" },
  "1Wutc": { entry: "1D", context: "1M", window: "Cycle / quarter" },
};
export type TerminalPlan = { duration: TerminalDuration; priceUsd: string; durationMs: number };
export type TerminalCatalog = {
  enabled: boolean; available: boolean; reason?: string; aiModel?: string; plans: TerminalPlan[];
  limits?: Record<string, number | string>; features?: Record<string, boolean | string>;
  paymentNetworks?: Array<{ key: string; network: string; asset: string }>;
};
export type TerminalEvent = { id: string; kind: string; at?: string | number; createdAt?: string; sourceAt?: number | string; message?: string; reason?: string; instId?: string; timeframe?: string; subjectId?: string; watchId?: string; radarId?: string; positionId?: string; delivery?: string };
export type TerminalWatch = { id: string; instId: string; timeframe: string; setupVersionId: string; state: string; paused?: boolean; expiresAt: string; createdAt: string; lastEvent?: string; nextEvent?: string; reason?: string; telegram?: boolean; events?: TerminalEvent[]; [key: string]: unknown };
export type TerminalRadar = { id: string; instId: string; timeframe: string; detector: string; boundary: number; state: string; paused?: boolean; expiresAt: string; createdAt: string; stage?: number; nextEvent?: string; reason?: string; telegram?: boolean; events?: TerminalEvent[]; provenance?: Record<string, unknown>; snapshot?: TerminalRadarState; [key: string]: unknown };
export type TerminalPositionEvent = { id: string; kind: string; quantity?: number; price?: number; executedAt: string; hardStop?: number; targets?: number[] };
export type TerminalPosition = { id: string; instId: string; timeframe: string; side: "long" | "short"; quantity: number; quantityUnit?: "base"; price?: number; averageEntry?: number; remainingQuantity?: number; realizedPnl?: number; pnlCurrency?: string; lastMark?: { price: number; at: string; source: string; kind: string; venueMatches: boolean }; status?: string; executedAt?: string; createdAt: string; venue?: string; instrumentType?: "spot" | "perpetual"; hardStop?: number | null; targets?: number[]; provenance?: string; verified?: boolean; paused?: boolean; telegram?: boolean; events?: TerminalPositionEvent[]; [key: string]: unknown };
export type TerminalWorkspace = {
  owner: string; revision: number; serverNow?: number; access: { active: boolean; expiresAt?: string | null; grants?: unknown[] };
  watches: TerminalWatch[]; radars: TerminalRadar[]; positions: TerminalPosition[]; activity: TerminalEvent[];
  telegram: { linked: boolean; enabled: boolean; events: string[]; configured?: boolean; botUsername?: string | null; botUrl?: string | null; linkUrl?: string | null; linkState?: "linked" | "not_linked" | "unavailable"; linkedWallet?: string | null; nextStep?: string }; limits?: Record<string, number | string>;
  deliveries?: Array<{ id: string; eventId: string; subjectId: string; state: string; createdAt: string; attemptedAt?: string; error?: string }>;
  answers?: Array<{ id: string; instId: string; timeframe: string; question: string; answer: string; sources: unknown[]; at: string; model?: string }>;
  pendingPurchases?: Array<{ requestId: string; duration: TerminalDuration; priceUsd: string; amountAtomic: string; network: string; asset: string; createdAt: string; state: "authorizing" | "settled" | "granted"; paymentId: string; settlementTx?: string; settledAt?: string }>;
};
export type TerminalToolStatus = TerminalSourceStatus;
export type TerminalMarket = TerminalMarketSnapshot & { setupVersionId?: string; evidenceSnapshotId?: string };
export type TerminalInspection = { tool: "value" | "flow" | "footprint" | "derivatives" | "liquidity"; stream?: "spot" | "perpetual"; footprintStart?: number };
export type TerminalAskContext = { positionId?: string; watchId?: string; radarId?: string; instId?: string; timeframe?: string; setupVersionId?: string; evidenceSnapshotId?: string; inspection?: TerminalInspection };
export type TerminalFollowReview = { owner: string; instId: string; timeframe: string; setupVersionId: string; observedAt: number; report: GlobalReport };
/** Review the source that opened the dialog; a later poll is a different
 * candidate, never implicit consent to follow its changed prices/version. */
export function terminalFollowReview(market: TerminalMarket, owner: string): TerminalFollowReview {
  if (!market.setupVersionId || !owner) throw new Error("Open the owner workspace and review a saved setup first.");
  return { owner: owner.toLowerCase(), instId: market.instId, timeframe: market.timeframe, setupVersionId: market.setupVersionId, observedAt: market.observedAt, report: structuredClone(market.report) };
}
export function terminalFollowReviewMatches(review: TerminalFollowReview, owner: string | null, instId: string, timeframe: string): boolean {
  return Boolean(owner && review.owner === owner.toLowerCase() && review.instId === instId && review.timeframe === timeframe);
}
/** Bind a question to the chart/tool evidence visible when it was opened. */
export function terminalAskBinding(market: TerminalMarket | null, context: TerminalAskContext = {}): TerminalAskContext {
  // Retained-session tools carry a different evidence ID from the assessment.
  // Explicit source bindings win over a newer parent chart capture.
  return { ...(!context.positionId && market ? { instId: market.instId, timeframe: market.timeframe, ...(market.setupVersionId ? { setupVersionId: market.setupVersionId } : {}), ...(market.evidenceSnapshotId ? { evidenceSnapshotId: market.evidenceSnapshotId } : {}) } : {}), ...context, ...(context.inspection ? { inspection: { ...context.inspection } } : {}) };
}
/** Match the exact catalog precision instead of rounding a micro-USDC price
 * to zero. Validation is shared with checkout's atomic amount conversion. */
export function terminalPassPrice(priceUsd: string): string {
  terminalUsdAtomic(priceUsd);
  return Number(priceUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}
export class TerminalApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: { code?: string; doNotPayAgain?: boolean; transactionHash?: string }) { super(message); this.name = "TerminalApiError"; }
}
export type TerminalSession = { token: string; owner: string; expiresAt: string };
let currentSession: TerminalSession | null = null;
export function terminalSession(wallet: string | null, now = Date.now()): TerminalSession | null {
  if (!wallet || currentSession?.owner.toLowerCase() !== wallet.toLowerCase() || !Number.isFinite(Date.parse(currentSession.expiresAt)) || Date.parse(currentSession.expiresAt) <= now) return null;
  return currentSession;
}
export function clearTerminalSession() { currentSession = null; }
/** A late poll must not erase a journal/watch mutation acknowledged at a newer revision. */
export function terminalWorkspaceUpdate(current: TerminalWorkspace | null, incoming: TerminalWorkspace, owner: string | null): TerminalWorkspace | null {
  if (!owner || incoming.owner.toLowerCase() !== owner.toLowerCase()) return current;
  if (!Number.isSafeInteger(incoming.revision) || incoming.revision < 0) throw new Error("The Terminal workspace response is incomplete. Retry opening your workspace.");
  if (current?.owner.toLowerCase() === owner.toLowerCase() && incoming.revision < current.revision) return current;
  return incoming;
}
export function setTerminalSession(session: TerminalSession, wallet: string) {
  if (!session.token || session.owner.toLowerCase() !== wallet.toLowerCase() || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error("Terminal authorization did not match this wallet.");
  currentSession = session;
}
/** Credentials stay in memory; never place them in a URL, report or local storage. */
export async function terminalRequest<T>(path: string, options: { token?: string; method?: string; body?: unknown; signal?: AbortSignal; fetcher?: typeof fetch; networkRoute?: string; timeoutMs?: number } = {}): Promise<T> {
  const { token, body, method = "GET", signal, fetcher = fetch, networkRoute } = options;
  if(options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1000||options.timeoutMs>240000))throw new Error("Unsupported Terminal request timeout.");
  if (networkRoute && !["xlayer", "base", "arbitrum", "arc", "robinhood"].includes(networkRoute)) throw new Error("Unsupported Terminal payment network.");
  if (!/^[a-z\d/_?=&%.\-]+$/i.test(path) || path.includes("..")) throw new Error("Invalid Terminal request path.");
  const controller = new AbortController(), cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
  const deadline = setTimeout(() => controller.abort(new DOMException("Terminal request timed out. Retry this request.", "TimeoutError")), options.timeoutMs??(networkRoute ? 180_000 : 90_000));
  let response: Response, data: { error?: string; code?: string; doNotPayAgain?: boolean; transactionHash?: string };
  try { response = await fetcher(`${API_BASE}${networkRoute ? `/${networkRoute}` : ""}/v1/terminal/${path.replace(/^\//, "")}`, {
    method, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
  });
    data = await response.json().catch(() => ({}));
    if (signal?.aborted) throw new DOMException("Terminal request canceled", "AbortError");
  } finally { clearTimeout(deadline); signal?.removeEventListener("abort", cancel); }
  if (!response.ok) {
    if (response.status === 401 && token === currentSession?.token) clearTerminalSession();
    throw new TerminalApiError(data.error || `Terminal request failed (${response.status}). Retry without paying again if your payment was already approved.`, response.status, { code: data.code, doNotPayAgain: data.doNotPayAgain, transactionHash: data.transactionHash });
  }
  return data as T;
}
export async function authorizeTerminal(wallet: string, sign: (message: string) => Promise<string>, signal?: AbortSignal): Promise<TerminalSession> {
  const existing = terminalSession(wallet); if (existing) return existing;
  const challenge = await terminalRequest<{ challengeId: string; message: string; expiresAt: string }>("auth/challenge", { method: "POST", body: { wallet }, signal });
  const signature = await sign(challenge.message);
  if (signal?.aborted) throw new DOMException("Authorization canceled", "AbortError");
  const session = await terminalRequest<TerminalSession>("auth/verify", { method: "POST", body: { challengeId: challenge.challengeId, signature }, signal });
  if (signal?.aborted) throw new DOMException("Authorization canceled", "AbortError");
  setTerminalSession(session, wallet); return session;
}
export function terminalPrice(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—";
}
export function terminalUtc(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = typeof value === "number" ? value : /^\d{13}$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 19).replace("T", " ") + " UTC" : "—";
}
export function terminalLabel(value: string): string { return value === "conditions_satisfied" ? "Price policy confirmed" : value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }
/** Keep ended priced scenarios readable without offering a new watch on their old opportunity. */
export function terminalFollowRestriction(report: Pick<GlobalReport, "scenario"> & Partial<GlobalReport>): string | null {
  const state = report.scenario?.state;
  if (state === "entry_observed") return "This setup's entry was already observed; review a separate new setup.";
  if(state === "invalidated" || state === "expired" || state === "completed")return "This opportunity ended; review a separate new setup.";
  if(report.discretionaryPlan&&report.snapshot){const admission=globalSetupAdmission(report as GlobalReport);if(!admission.geometryEligible)return "WAIT: "+admission.reasons.join(" ");}
  return null;
}
/** Use the priced scenario's immutable protection, independently of current entry eligibility. */
export function terminalSetupReferences(report: Pick<GlobalReport, "scenario" | "discretionaryPlan" | "snapshot" | "setupSelection">) {
  const plan = report.discretionaryPlan, definition = report.scenario?.definition;
  const hardStop = definition?.hardStop ?? plan?.stop ?? null;
  const lines: string[] = [];
  if (plan) {
    lines.push(`${terminalLabel(plan.family)} · ${plan.side.toUpperCase()} uses ${terminalLabel(plan.entryBasis.kind)} at ${terminalPrice(plan.entryBasis.price, report.snapshot.pricePrecision)} on ${plan.entryBasis.timeframe.replace("utc", "")}, known at ${terminalUtc(plan.entryBasis.knownAt)}.`);
    if (plan.evidence) lines.push(`${terminalLabel(plan.evidence.kind)}: ${plan.evidence.timeframe.replace("utc", "")} test at ${terminalPrice(plan.evidence.level, report.snapshot.pricePrecision)}, started ${terminalUtc(plan.evidence.testTs)} and completed ${terminalUtc(plan.evidence.completedAt)}.`);
    if (report.setupSelection && report.setupSelection.assessment !== "sideways" && report.setupSelection.assessment !== plan.side) lines.push(`The primary ${report.snapshot.timeframe.replace("utc", "")} bias is ${report.setupSelection.assessment}; this ${plan.side} setup is a response against that bias, with its own entry and invalidation rules.`);
    lines.push(`Protection basis: ${plan.stopBasis.timeframe.replace("utc", "")} ${terminalPrice(plan.stopBasis.price, report.snapshot.pricePrecision)}, anchored ${terminalUtc(plan.stopBasis.anchorTs)}. Fixed hard SL ${terminalPrice(hardStop, report.snapshot.pricePrecision)}.`);
  }
  return { hardStop, lines };
}
/** A UTC-labelled form must not silently apply the browser's local timezone. */
export function terminalExecutionTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) throw new Error("Enter a valid execution time in UTC.");
  const date = new Date(`${value}Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, value.length) !== value) throw new Error("Enter a valid execution time in UTC.");
  return date.toISOString();
}
const pendingReceipts = new Map<string, string>();
export function terminalReceiptRequestId(owner: string, network: string, plan: TerminalDuration, storage?: Pick<Storage, "getItem" | "setItem">): string {
  const key = `pulse:terminal:checkout:${owner.toLowerCase()}:${network}:${plan}`;
  try { const saved = storage?.getItem(key); if (saved && /^[a-zA-Z0-9_-]{12,100}$/.test(saved)) { pendingReceipts.set(key, saved); return saved; } } catch { /* in-memory recovery still works */ }
  const pending = pendingReceipts.get(key); if (pending) return pending;
  const requestId = crypto.randomUUID();
  pendingReceipts.set(key, requestId);
  try { storage?.setItem(key, requestId); } catch { /* storage is optional */ }
  return requestId;
}
export function terminalReceiptComplete(owner: string, network: string, plan: TerminalDuration, storage?: Pick<Storage, "removeItem">) {
  const key = `pulse:terminal:checkout:${owner.toLowerCase()}:${network}:${plan}`;
  pendingReceipts.delete(key);
  try { storage?.removeItem(key); } catch { /* storage is optional */ }
}
