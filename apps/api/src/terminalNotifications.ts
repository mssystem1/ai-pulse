import type { TerminalPriceObservation, TerminalRadarDefinition, TerminalRadarEvent, TerminalRadarState } from "@pulse/domain";
import type { TerminalActivity, TerminalRadar, TerminalWorkspace } from "./terminalStore.js";

export type TerminalNotificationIssue = { code: string; message: string };
export type TerminalNotificationContext = {
  version: "terminal-notification-v1"; category: "radar" | "watch" | "position";
  primary: string; execution: string; expiresAt?: string; next: string; status: string;
  detector?: TerminalRadarDefinition["detector"]; boundary?: number; side?: "above" | "below"; tolerance?: number; stage?: number;
  observation?: TerminalPriceObservation; issue?: TerminalNotificationIssue; affected?: Array<{ id: string; primary: string; execution: string }>;
};
export type TerminalNotificationActivity = TerminalActivity & { notification?: TerminalNotificationContext };
export const TERMINAL_APP_URL = "https://app.ai-pulse.tech/trading-terminal";
const frame = (value: string) => value.replace("utc", " (UTC)");
const price = (value: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 12 }).format(value);
const clock = (value: string | number) => { const at = new Date(value); return Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 19).replace("T", " ") + " UTC" : "unavailable"; };
const shortId = (value: string) => value.replace(/^tr_/, "").slice(0, 8);
const detectorNames = { sweep_reclaim: "Sweep & reclaim", breakout_acceptance: "Breakout acceptance", breakout_failure: "Breakout failure" } as const;
const cleanSource = (value: string) => /^[\w .:/-]{1,100}$/.test(value) && !/https?:|token|secret/i.test(value) ? value : "verified exchange observation";

/** Stable human-readable diagnoses. Provider exceptions may include URLs,
 * credentials or storage keys and are never copied into an alert. */
export function terminalDependencyIssue(error: unknown, dependency: "component" | "market"): TerminalNotificationIssue {
  const text = error instanceof Error ? error.message : "";
  if (dependency === "component") {
    if (/disagree|pin changed|chain mismatch/.test(text)) return { code: "tapeout_consensus_unavailable", message: "The X Layer verification sources did not agree at the pinned block. Radar is paused until they agree; the component is not bypassed." };
    if (/shape|semantics|truth|registration|code mismatch|changed|unverified|ABI|byte result|JSON/i.test(text)) return { code: "tapeout_verification_rejected", message: "The registered Tapeout circuit could not pass its identity and logic checks. Radar cannot evaluate with an unverified or changed component." };
    if (/timeout|timed out|abort|bound exceeded/i.test(text)) return { code: "tapeout_verification_timeout", message: "The public X Layer/Tapeout verification request timed out. Radar keeps its last verified stage and will retry automatically." };
    return { code: "tapeout_verification_unavailable", message: "The public X Layer/Tapeout verification service is temporarily unavailable. Radar keeps its last verified stage; new stages wait for verification to recover." };
  }
  if (/identity|instrument|currency|timeframe.*match/i.test(text)) return { code: "market_identity_mismatch", message: "The source did not match this Radar's exact market or execution timeframe. Progress stays at the last verified candle." };
  if (/timeout|timed out|abort/i.test(text)) return { code: "market_request_timeout", message: "The exchange candle request timed out. Radar will retry; missing intervals cannot confirm a stage." };
  return { code: "market_source_unavailable", message: "Current completed exchange candles are unavailable. Radar will retry and verify continuity before its sequence can advance." };
}

export function terminalRadarSourceIssue(snapshot: TerminalRadarState): TerminalNotificationIssue {
  const reason = snapshot.events.filter(event => event.kind === "data_needed").at(-1)?.reason ?? snapshot.next;
  if (/component|Tapeout/i.test(reason)) return terminalDependencyIssue(undefined, "component");
  if (/gap|continuity/i.test(reason)) return { code: "execution_candle_gap", message: "Completed execution candles contain a gap. The ordered sequence needs a new verified run; missing time cannot confirm it." };
  if (/valid|complete/i.test(reason)) return { code: "execution_candles_incomplete", message: "A current complete execution candle is missing or invalid. Radar will retry while preserving its last verified information." };
  return { code: "execution_source_unavailable", message: "Current verified execution candles are required before Radar can advance." };
}

function nextStep(d: TerminalRadarDefinition, stage: number, kind: TerminalRadarEvent["kind"]) {
  if (kind === "data_needed") return "WAIT for verified current sources. Any missing candle intervals must be checked before monitoring resumes.";
  if (kind === "completed") return "Review the completed pattern alongside location, participation and risk. Decide manually whether a separate trade setup is eligible.";
  if (kind === "failed") return "This pattern did not complete its required sequence. Review another Radar if conditions change; this is not a recorded trade loss.";
  if (kind === "expired") return "The monitoring deadline passed. A new Radar requires a separate rule and deadline.";
  const outside = `${d.side} ${price(d.boundary)} (beyond the ${price(d.tolerance)} tolerance)`;
  const inside = `${d.side === "above" ? "below" : "above"} ${price(d.boundary)} (back inside, beyond tolerance)`;
  if (stage === 0) return d.detector === "sweep_reclaim" ? `Wait for a new completed candle with a sweep ${outside}.` : `Wait for a new completed candle close ${outside}.`;
  if (stage === 1) return d.detector === "breakout_acceptance" ? `Wait for a later candle that retests the boundary and closes ${outside}.` : `Wait for a later completed candle close ${inside}.`;
  return d.detector === "breakout_acceptance" ? `Wait for a later completed candle that holds ${outside}.` : `Wait for a later completed candle that holds ${inside} without sweeping outside again.`;
}

/** Capture event-time context before an asynchronous delivery can observe a
 * later Radar stage. No formatter reads the latest workspace definition. */
export function terminalRadarNotification(radar: TerminalRadar, event: TerminalRadarEvent, snapshot: TerminalRadarState, issue?: TerminalNotificationIssue): TerminalNotificationContext {
  const d = snapshot.definition, stage = event.kind === "first_stage" ? 1 : event.kind === "second_stage" ? 2 : event.kind === "completed" ? 3 : snapshot.stage;
  const observation = event.observationId ? snapshot.observations?.find(value => value.id === event.observationId) : undefined;
  return { version: "terminal-notification-v1", category: "radar", primary: radar.timeframe, execution: d.timeframe, expiresAt: new Date(d.expiresAt).toISOString(), next: nextStep(d, stage, event.kind), status: event.kind, detector: d.detector, boundary: d.boundary, side: d.side, tolerance: d.tolerance, stage, ...(observation ? { observation: structuredClone(observation) } : {}), ...(issue ? { issue: structuredClone(issue) } : {}), affected: [{ id: radar.id, primary: radar.timeframe, execution: d.timeframe }] };
}

export function terminalNotificationConsent(event: TerminalActivity, events: string[]) {
  return events.includes(event.kind) || event.kind === "source_recovered" && events.includes("source_interruption");
}

/** Retain individual activity while sending one incident per market/cause.
 * Only the still-queued incident is enriched in the same CAS transaction.
 * A later delivery never substitutes current market state into this event. */
export function coalesceTerminalIncident(workspace: TerminalWorkspace, event: TerminalNotificationActivity): boolean {
  const issue = event.notification?.issue;
  if (!issue || !["source_interruption", "source_recovered"].includes(event.kind)) return false;
  const relevant = (workspace.activity as TerminalNotificationActivity[]).filter(old => ["source_interruption", "source_recovered"].includes(old.kind));
  const same = (old: TerminalNotificationActivity) => old.instId === event.instId && old.notification?.issue?.code === issue.code;
  const matching = relevant.filter(same), previous = matching.at(-1);
  if (!previous || previous.kind !== event.kind) return false;
  let boundary = -1; for (let i = matching.length - 1; i >= 0; i--) if (matching[i].kind !== event.kind) { boundary = i; break; }
  const episode = matching.slice(boundary + 1);
  const activeOutbox = new Set(["queued", "sending", "acknowledged", "uncertain"]);
  if (!episode.some(old => workspace.deliveries.some(item => item.eventId === old.id && activeOutbox.has(item.state)))) return false;
  const queued = episode.find(old => workspace.deliveries.some(item => item.eventId === old.id && item.state === "queued"));
  if (queued?.notification && event.notification?.affected) queued.notification.affected = [...new Map([...(queued.notification.affected ?? []), ...event.notification.affected].map(item => [item.id, item])).values()];
  return true;
}

export function formatTerminalNotification(event: TerminalNotificationActivity): string {
  const context = event.notification, quote = event.instId?.split("-").at(-1) ?? "", link = new URL(TERMINAL_APP_URL);
  if (event.subjectId) link.searchParams.set("subject", event.subjectId);
  const heading = event.kind === "source_recovered" ? "Monitoring source recovered" : event.kind === "source_interruption" ? "Monitoring paused · source check" : context?.category === "radar" ? "Market Radar update" : "Trading Terminal update";
  const lines = ["PULSE Trading Terminal", heading, event.instId ? `${event.instId} · prices in ${quote}` : "Access status"];
  if (context?.category === "radar") {
    lines.push(`Radar #${shortId(event.subjectId)} · ${detectorNames[context.detector!]} · Stage ${context.stage ?? 0}/3`);
    lines.push(`Rule: ${context.side} ${price(context.boundary!)} ${quote}; tolerance ±${price(context.tolerance!)} ${quote}`);
    lines.push(`Primary ${frame(context.primary)} · evaluates completed ${frame(context.execution)} candles`);
    if ((context.affected?.length ?? 0) > 1) lines.push(`Affected Radars (${context.affected!.length}): ${context.affected!.map(item => `#${shortId(item.id)} [${frame(item.primary)} / ${frame(item.execution)}]`).join(", ")}`);
  } else if (context) lines.push(`Primary ${frame(context.primary)} · execution ${frame(context.execution)}`);
  lines.push(context?.issue?.message ?? event.message);
  const observation = context?.observation;
  if (observation) lines.push(`Event candle ${frame(observation.timeframe)}: O ${price(observation.open)} · H ${price(observation.high)} · L ${price(observation.low)} · C ${price(observation.close)} ${quote}`, `Candle closed: ${clock(observation.at)} · received: ${clock(observation.knownAt)}`, `Source: ${cleanSource(observation.source)}. Event close above is not a current quote.`);
  else lines.push(`${event.kind.startsWith("source_") ? "Detected" : "Event time"}: ${clock(event.sourceAt ?? event.at)}. No fresh event candle is implied.`);
  if (context?.next) lines.push(`Next: ${context.next}`);
  if (context?.expiresAt) lines.push(`Expires: ${clock(context.expiresAt)}`);
  lines.push(event.kind === "source_interruption" ? "WAIT · No entry or fill is confirmed while this source is unavailable." : "Observed conditions only · no order, position fill or automatic trade is confirmed.", link.href);
  return lines.join("\n").slice(0, 4000);
}
