import type { TerminalDuration, TerminalWorkspace } from "./terminalClient";

type AccessWorkspace = Pick<TerminalWorkspace, "owner" | "revision" | "serverNow" | "access">;
export type TerminalClockAnchor = { owner: string; revision: number; serverNow: number; monotonicAt: number; source: "server" | "browser"; valid: boolean };
export type TerminalPassTime = { active: boolean; remainingMs: number | null; seconds: number | null; text: string; now: number | null; runningDuration?: TerminalDuration; queuedRenewals: number };

/** Anchor once per accepted response. Browser wall-clock adjustments cannot
 * extend purchased access. Legacy servers without serverNow retain a fallback. */
export function terminalClockAnchor(previous: TerminalClockAnchor | null, workspace: AccessWorkspace, monotonicAt: number, browserNow: number): TerminalClockAnchor {
  const owner = workspace.owner.toLowerCase();
  if (previous?.owner === owner && workspace.revision < previous.revision) return previous;
  const retained = workspace.serverNow === undefined && previous?.valid && previous.owner === owner && previous.source === "server" && monotonicAt >= previous.monotonicAt;
  const source = workspace.serverNow === undefined && !retained ? "browser" : "server";
  let serverNow = retained ? previous.serverNow + monotonicAt - previous.monotonicAt : source === "server" ? workspace.serverNow! : browserNow;
  const valid = Number.isFinite(serverNow) && serverNow > 0 && (workspace.serverNow === undefined || Number.isSafeInteger(workspace.serverNow)) && Number.isFinite(monotonicAt) && monotonicAt >= 0;
  if (valid && previous?.valid && previous.owner === owner && previous.source === source && monotonicAt >= previous.monotonicAt) {
    // A delayed same-revision poll cannot rewind an already running clock.
    serverNow = Math.max(serverNow, previous.serverNow + monotonicAt - previous.monotonicAt);
  }
  return { owner, revision: workspace.revision, serverNow, monotonicAt, source, valid };
}

/** The recorded continuous-access expiry is authoritative, including stacked
 * renewals; catalog durations and prices never reconstruct its remaining time. */
export function terminalPassTime(workspace: AccessWorkspace | null, anchor: TerminalClockAnchor | null, monotonicNow: number): TerminalPassTime {
  const unknown: TerminalPassTime = { active: false, remainingMs: null, seconds: null, text: "Time unavailable", now: null, queuedRenewals: 0 };
  if (!workspace || !anchor?.valid || anchor.owner !== workspace.owner.toLowerCase() || !Number.isFinite(monotonicNow) || monotonicNow < anchor.monotonicAt) return unknown;
  const expiresAt = Date.parse(workspace.access.expiresAt ?? ""), now = anchor.serverNow + monotonicNow - anchor.monotonicAt;
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return unknown;
  const remainingMs = Math.max(0, expiresAt - now), seconds = Math.ceil(remainingMs / 1000);
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  let runningDuration: TerminalDuration | undefined, queuedRenewals = 0;
  for (const candidate of workspace.access.grants ?? []) {
    if (!candidate || typeof candidate !== "object") continue;
    const grant = candidate as { duration?: unknown; startsAt?: unknown; expiresAt?: unknown };
    const start = typeof grant.startsAt === "string" ? Date.parse(grant.startsAt) : NaN, end = typeof grant.expiresAt === "string" ? Date.parse(grant.expiresAt) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) continue;
    if (start > now && end <= expiresAt) queuedRenewals++;
    if (start <= now && now < end && ["24h", "7d", "30d"].includes(String(grant.duration))) runningDuration = grant.duration as TerminalDuration;
  }
  return { active: workspace.access.active && remainingMs > 0, remainingMs, seconds, text: `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`, now, runningDuration, queuedRenewals };
}
