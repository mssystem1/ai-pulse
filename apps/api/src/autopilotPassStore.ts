import { kvConfigured, runKvCommand } from "./resilientKv.js";

export type AutopilotPass = {
  owner: string; network: import("./executionContracts.js").ExecutionNetwork; vault: string;
  purchasedAt: string; expiresAt: string; signalLimit: number; signalsUsed: number;
  consumedSignalIds?: string[];
  creditedPaymentIds?: string[];
  pausedAt?: string; stateObservedAt?: number; telegramDelivery?: string;
  expiryWarningSentAt?: string; expiredNoticeSentAt?: string;
  timerBaseExpiresAt?: string; timerInitiallyPaused?: boolean;
  confirmedPauseEvents?: Array<{ txHash: string; at: number; paused: boolean; order?: number }>;
};
const memory = new Map<string, AutopilotPass>();
const keyFor = (network: string, vault: string) => `pulse:v6:autopilot:pass:${network}:${vault.toLowerCase()}`;
export function autopilotPassRemainingMs(pass: AutopilotPass, now = Date.now()) {
  return Date.parse(pass.expiresAt) - (pass.pausedAt ? Date.parse(pass.pausedAt) : now);
}
/** Reusing the same cached AI result must not consume another confirmation. */
export function consumePassSignal(current: AutopilotPass | null, owner: string, signalId: string, now: number) {
  const unavailable = !current || current.owner.toLowerCase() !== owner.toLowerCase() || current.pausedAt || autopilotPassRemainingMs(current, now) <= 0;
  if (unavailable || !current) return { pass: current, reason: "pass_expired" };
  if (current.consumedSignalIds?.includes(signalId)) return { pass: current, reason: "" };
  if (current.signalsUsed >= current.signalLimit) return { pass: current, reason: "signals_exhausted" };
  return { pass: { ...current, signalsUsed: current.signalsUsed + 1, consumedSignalIds: [...(current.consumedSignalIds || []), signalId] }, reason: "" };
}
export async function getAutopilotPass(network: AutopilotPass["network"], vault: string): Promise<AutopilotPass | null> {
  const key = keyFor(network, vault);
  // A stale/missing process cache is not evidence that paid time expired.
  const raw = kvConfigured() ? await runKvCommand(["GET", key]) : null;
  if (kvConfigured()) return typeof raw === "string" ? JSON.parse(raw) : null;
  return structuredClone(memory.get(key) || null);
}
export async function assertAutopilotStorageReady() {
  if (!kvConfigured()) return;
  await runKvCommand(["SET", "pulse:autopilot:storage-ready", "1", "EX", 60]);
}

const CAS = `local old = redis.call('GET', KEYS[1]) or ''
if old ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;
/** Compare-and-swap: an old dashboard/worker snapshot can never erase a renewal. */
export async function mutateAutopilotPass(network: AutopilotPass["network"], vault: string,
  change: (current: AutopilotPass | null) => AutopilotPass | null) {
  const key = keyFor(network, vault);
  if (!kvConfigured()) {
    const next = change(structuredClone(memory.get(key) || null));
    if (next) memory.set(key, structuredClone(next));
    return next;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await runKvCommand(["GET", key]);
    const before = typeof raw === "string" ? raw : "";
    const next = change(before ? JSON.parse(before) : null);
    if (!next || JSON.stringify(next) === before) return next;
    if (Number(await runKvCommand(["EVAL", CAS, 1, key, before, JSON.stringify(next)])) === 1) return next;
  }
  throw new Error("Pass update is busy; refresh before retrying. Paid time was not overwritten.");
}
export function transitionPassPause(value: AutopilotPass, paused: boolean, now: number): AutopilotPass {
  if (now < (value.stateObservedAt || 0) || now < Date.parse(value.purchasedAt)) return value;
  if (paused === Boolean(value.pausedAt)) return value;
  if (paused) return { ...value, pausedAt: new Date(now).toISOString(), stateObservedAt: now };
  const duration = Math.max(0, now - Date.parse(value.pausedAt!));
  return { ...value, expiresAt: new Date(Date.parse(value.expiresAt) + duration).toISOString(),
    pausedAt: undefined, stateObservedAt: now, expiryWarningSentAt: undefined, expiredNoticeSentAt: undefined };
}
export async function synchronizeAutopilotPassPause(value: AutopilotPass, paused: boolean, now: number) {
  // Unchanged state is read-only; don't spend Redis writes every dashboard poll.
  if (paused === Boolean(value.pausedAt)) return value;
  return await mutateAutopilotPass(value.network, value.vault, current => current ? transitionPassPause(current, paused, now) : null) || value;
}
/** Replay receipt-verified transitions in block-time order, including delayed indexing.
 * Polling is only an interim observation: it cannot permanently charge paused time.
 */
export function applyConfirmedPassPause(value: AutopilotPass, event: { txHash: string; at: number; paused: boolean; order?: number }): AutopilotPass {
  if (!Number.isFinite(event.at) || event.at < Date.parse(value.purchasedAt)) return value;
  if (value.confirmedPauseEvents?.some(item => item.txHash === event.txHash)) return value;
  // Legacy passes lack a replay baseline; preserve their existing entitlement.
  if (!value.timerBaseExpiresAt) return transitionPassPause(value, event.paused, event.at);
  const events = [...(value.confirmedPauseEvents || []), event].sort((a, b) => a.at - b.at || (a.order || 0) - (b.order || 0) || a.txHash.localeCompare(b.txHash));
  let next: AutopilotPass = { ...value, expiresAt: value.timerBaseExpiresAt,
    pausedAt: value.timerInitiallyPaused ? value.purchasedAt : undefined,
    stateObservedAt: Date.parse(value.purchasedAt), confirmedPauseEvents: events };
  for (const item of events) next = transitionPassPause(next, item.paused, item.at);
  if ((value.stateObservedAt || 0) > (next.stateObservedAt || 0))
    next = transitionPassPause(next, Boolean(value.pausedAt), value.stateObservedAt!);
  return next;
}
export function extendAutopilotPass(existing: AutopilotPass | null,
  input: { owner: string; network: AutopilotPass["network"]; vault: string; days: 1 | 7 | 30; paused: boolean; telegramDelivery?: string; paymentId?: string }, now: number): AutopilotPass {
  if (existing && input.paymentId && existing.creditedPaymentIds?.includes(input.paymentId)) return existing;
  const current = existing ? transitionPassPause(existing, input.paused, now) : null;
  const remaining = current ? Math.max(0, autopilotPassRemainingMs(current, now)) : 0;
  // Rebase to now even when an expired pass was paused in the past.
  return { owner: input.owner.toLowerCase(), network: input.network, vault: input.vault.toLowerCase(),
    purchasedAt: new Date(now).toISOString(), expiresAt: new Date(now + remaining + input.days * 86_400_000).toISOString(),
    ...(input.paused ? { pausedAt: new Date(now).toISOString() } : {}), stateObservedAt: now,
    timerBaseExpiresAt: new Date(now + remaining + input.days * 86_400_000).toISOString(), timerInitiallyPaused: input.paused,
    signalLimit: (remaining > 0 && current ? Math.max(0, current.signalLimit - current.signalsUsed) : 0) + input.days * 3,
    signalsUsed: 0, telegramDelivery: input.telegramDelivery || current?.telegramDelivery,
    creditedPaymentIds: [...(existing?.creditedPaymentIds || []), ...(input.paymentId ? [input.paymentId] : [])] };
}
