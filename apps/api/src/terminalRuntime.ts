import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "@pulse/config";
import { createTerminalMarketSnapshot, advanceTerminalRadar, newTerminalRadar, restoreGlobalScenarioBoundPlan } from "@pulse/analysis";
import { fetchTerminalTapeoutComponent, buildMarketContext } from "@pulse/market";
import { terminalFrameProfile, type TerminalMarketSnapshot, type TerminalRadarDefinition, type TerminalRadarState, type TerminalTapeoutComponent } from "@pulse/domain";
import type { GlobalAssessment, GlobalReport } from "@pulse/schemas";
import { recheckSavedGlobalReport } from "./globalAssessmentRoutes.js";
import { TerminalAuth } from "./terminalAuth.js";
import { appendTerminalActivity, createTerminalStore, terminalAccess, type TerminalActivity, type TerminalPosition, type TerminalRadar, type TerminalStore, type TerminalWatch, type TerminalWorkspace } from "./terminalStore.js";
import { StoreRedis } from "./storeRedis.js";
import { createGlobalScenarioStore, GlobalScenarioHistoryUnavailableError, reconcileGlobalScenarioAssessment, type GlobalScenarioStore } from "./globalScenarioStore.js";
import { terminalPricePathEvents } from "./terminalPricePath.js";

export type TerminalDependencies = {
  store?: TerminalStore;
  snapshot?: typeof createTerminalMarketSnapshot;
  assess?: (report: GlobalReport) => Promise<GlobalAssessment>;
  tapeout?: () => Promise<TerminalTapeoutComponent>;
  now?: () => number;
  telegramRecipient?: (owner: string) => Promise<number | null>;
  telegramSend?: (recipient: number, text: string) => Promise<number>;
  scenarios?: GlobalScenarioStore;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
export function terminalLimits(cfg: AppConfig) { return { activeWatches: cfg.TERMINAL_MAX_WATCHES, activeRadars: cfg.TERMINAL_MAX_RADARS, openPositions: cfg.TERMINAL_MAX_POSITIONS, aiQuestionsPerDay: cfg.TERMINAL_AI_QUESTIONS_PER_DAY, historyRetentionDays: cfg.TERMINAL_RETENTION_DAYS, monitorIntervalMs: cfg.TERMINAL_MONITOR_INTERVAL_MS }; }
export const terminalScenarioNext = (state: string) => ({ awaiting_location: "Wait for a new eligible location test.", awaiting_event: "Wait for the saved execution policy's later confirmation.", confirmed_awaiting_fill: "Review a return inside the saved entry region before its deadline.", entry_observed: "Price path reached the entry; record an actual fill separately.", invalidated: "This setup ended. Review a separate new setup version.", expired: "This setup expired. Review a separate new setup version.", completed: "This opportunity has finished; it cannot be restarted." }[state] ?? "Inspect the saved setup's next required event.");
/** A scenario event proves price-policy progress, never full trade admission. */
export function terminalConfirmationMessage(assessment: GlobalAssessment, scenarioState: string) {
  const blockers = assessment.blockers.length ? ` Blockers: ${assessment.blockers.join(", ")}.` : "";
  const payoff = Number.isFinite(assessment.firstObstacleRewardRisk) ? ` Nearest-obstacle reward: ${assessment.firstObstacleRewardRisk!.toFixed(2)}R.` : "";
  const action = assessment.state === "technical_valid" && !assessment.blockers.length ? "Review entry eligibility" : "WAIT";
  return `Price policy confirmation observed; this event alone does not qualify an entry. Current assessment: ${action} (${assessment.state}).${blockers}${payoff} ${terminalScenarioNext(scenarioState)} A fresh quote, payoff and every remaining entry rule still require review; no venue fill or order authorization is established.`;
}
export class TerminalRuntime {
  readonly store: TerminalStore;
  readonly auth: TerminalAuth;
  readonly now: () => number;
  readonly scenarios: GlobalScenarioStore;
  private market = new Map<string, { at: number; value: Promise<TerminalMarketSnapshot> }>();
  private component?: { at: number; value: Promise<TerminalTapeoutComponent> };
  private redis: StoreRedis | null;
  constructor(readonly cfg: AppConfig, readonly deps: TerminalDependencies = {}) {
    this.store = deps.store ?? createTerminalStore(cfg); this.auth = new TerminalAuth(this.store, cfg.BASE_URL); this.now = deps.now ?? Date.now;
    this.scenarios = deps.scenarios ?? createGlobalScenarioStore({ ...cfg, PERSISTENCE_NAMESPACE: `${cfg.PERSISTENCE_NAMESPACE}:terminal`, REPORT_RETENTION_DAYS: cfg.TERMINAL_RETENTION_DAYS }, { replayLatePriceEvents: true });
    const url = cfg.QUEUE_PROVIDER === "redis" ? cfg.REDIS_URL : cfg.QUEUE_PROVIDER === "upstash_kv" ? cfg.KV_REST_API_URL : "";
    this.redis = url ? new StoreRedis(url, cfg.KV_REST_API_TOKEN) : null;
  }
  async snapshot(instId: string, timeframe: string) {
    const frame = terminalFrameProfile(timeframe).timeframe, key = `${instId}:${frame}`, now = this.now(), old = this.market.get(key);
    if (old && now - old.at < 15_000) return old.value;
    if (this.market.size >= 100) this.market.delete(this.market.keys().next().value!);
    const value = this.deps.snapshot ? this.deps.snapshot({ instId, timeframe: frame, now }) : createTerminalMarketSnapshot({ instId, timeframe: frame });
    this.market.set(key, { at: now, value });
    value.catch(() => { if (this.market.get(key)?.value === value) this.market.delete(key); });
    return value;
  }
  private scenarioScope(owner: string) { return { ownerWallet: owner.toLowerCase(), networkKey: "terminal" }; }
  /** Before first publication after the ledger upgrade, an existing owner's
   * followed source is authoritative. Refreshing cannot mint a later birth. */
  private async seedWatchedScenario(owner: string, snapshot: TerminalMarketSnapshot) {
    const scenarioId = snapshot.report.scenario?.scenarioId;
    if (!scenarioId || await this.scenarios.get(this.scenarioScope(owner), scenarioId)) return;
    const value = await this.store.get(owner), oldest = value.watches.filter(w => w.instId === snapshot.instId && w.timeframe === snapshot.timeframe && w.scenario.scenarioId === scenarioId).sort((a, b) => a.scenario.startedAt - b.scenario.startedAt)[0];
    if (!oldest) return;
    const report = await this.store.loadWatchReport(owner, oldest);
    await this.scenarios.advance(this.scenarioScope(owner), oldest.scenario.definition, oldest.scenario.events, oldest.scenario.updatedAt, report.discretionaryPlan);
  }
  /** Raw exchange caches remain shared and unbound. Only an owner-isolated
   * clone may receive durable opportunity prices, clocks and terminal state. */
  async bindOwnerSnapshot(owner: string, raw: TerminalMarketSnapshot) {
    const snapshot = structuredClone(raw);
    await this.seedWatchedScenario(owner, snapshot);
    await this.scenarios.applyToReport(this.scenarioScope(owner), snapshot.report, (report, definition) =>
      terminalPricePathEvents(report, definition, Date.parse(report.snapshot.observedAt), report.snapshot.priceCurrency));
    return snapshot;
  }
  async ownerSnapshot(owner: string, instId: string, timeframe: string) { return this.bindOwnerSnapshot(owner, await this.snapshot(instId, timeframe)); }
  async tapeout() {
    const now = this.now();
    if (!this.component || now - this.component.at > 300_000) {
      const value = (this.deps.tapeout ?? (() => fetchTerminalTapeoutComponent({ now })))();
      this.component = { at: now, value }; value.catch(() => { if (this.component?.value === value) this.component = undefined; });
    }
    return this.component.value;
  }
  async assess(report: GlobalReport) { return (this.deps.assess ?? (saved => recheckSavedGlobalReport(saved, buildMarketContext)))(report); }
  async assessOwner(owner: string, original: GlobalReport) {
    const report = structuredClone(original), originalScenario = report.scenario;
    if (!originalScenario) return this.assess(report);
    const scope = this.scenarioScope(owner);
    let record = await this.scenarios.get(scope, originalScenario.scenarioId);
    if (!record) record = await this.scenarios.advance(scope, originalScenario.definition, originalScenario.events, originalScenario.updatedAt, report.discretionaryPlan);
    if (record.snapshot.revisionId !== originalScenario.revisionId) throw new Error("This source opportunity already has a different bound priced revision; a refresh cannot replace it");
    if (record.boundPlan) restoreGlobalScenarioBoundPlan(report, record.boundPlan);
    report.scenario = structuredClone(record.snapshot);
    const [assessment, current] = await Promise.all([this.assess(report), this.deps.snapshot || !this.deps.assess ? this.snapshot(report.snapshot.instId, report.snapshot.timeframe).catch(() => null) : Promise.resolve(null)]);
    if (assessment.scenario && !assessment.blockers.some(blocker => blocker === "history" || blocker === "source_revised")) {
      const asOf = Date.parse(assessment.assessedAt), prices = current ? terminalPricePathEvents(current.report, record.snapshot.definition, asOf, report.snapshot.priceCurrency) : [];
      try { record = await this.scenarios.advance(scope, record.snapshot.definition, [...assessment.scenario.events, ...prices], asOf, report.discretionaryPlan); }
      catch (error) {
        if (!(error instanceof GlobalScenarioHistoryUnavailableError)) throw error;
        return reconcileGlobalScenarioAssessment(report, { ...assessment, state: "no_trade", permittedEntry: null, observedStop: null, blockers: [...new Set([...assessment.blockers, "history"])], lines: [error.message, ...assessment.lines] }, record);
      }
    }
    return reconcileGlobalScenarioAssessment(report, assessment, record);
  }
  async recipient(owner: string): Promise<number | null> {
    if (!this.cfg.FEATURE_TELEGRAM) return null;
    if (this.deps.telegramRecipient) return this.deps.telegramRecipient(owner);
    if (!this.redis) return null;
    const prefix = `${this.cfg.PERSISTENCE_NAMESPACE}:telegram:wallet`, id = await this.redis.get<number>(`${prefix}:owner:${owner}`);
    if (!Number.isSafeInteger(id) || !id) return null;
    const linked = await this.redis.get<{ wallet: string }>(`${prefix}:account:${id}`);
    return linked?.wallet === owner ? id : null;
  }
  async workspace(owner: string) {
    const value = await this.store.get(owner), linked = await this.recipient(owner);
    const watches = value.watches.map(({ report: _legacyReport, ...watch }) => watch);
    const serverNow = this.now();
    return { ...value, watches, serverNow, access: terminalAccess(value, serverNow), telegram: { ...value.telegram, linked: Boolean(linked) }, limits: terminalLimits(this.cfg), execution: "journal-and-monitoring-only" };
  }
  private publish(value: TerminalWorkspace, event: TerminalActivity, telegram: boolean, recipient: number | null) {
    if (value.activity.some(item => item.id === event.id)) return;
    appendTerminalActivity(value, event);
    if (!telegram || !recipient || !value.telegram.enabled || !value.telegram.events.includes(event.kind)) return;
    const id = `td_${hash(`${event.id}:${recipient}`)}`;
    if (!value.deliveries.some(item => item.id === id)) value.deliveries.push({ id, eventId: event.id, subjectId: event.subjectId, recipientId: recipient, state: "queued", createdAt: event.at });
    value.deliveries = value.deliveries.slice(-1000);
  }
  private ownsMonitoringLease(value: TerminalWorkspace, token: string) {
    return value.monitoringLease?.token === token && value.monitoringLease.until > this.now();
  }
  async createWatch(owner: string, input: { instId: string; timeframe: string; setupVersionId: string; telegram: boolean }) {
    const source = await this.store.storage.read<TerminalMarketSnapshot>(this.store.key("setup", `${owner}:${input.setupVersionId}`));
    if (!source || source.instId !== input.instId || source.timeframe !== terminalFrameProfile(input.timeframe).timeframe || this.now() - source.observedAt > 300_000) throw new Error("Refresh the market and review its setup before following.");
    const assessment = await this.assessOwner(owner, source.report), scenario = assessment.scenario;
    if (!scenario || scenario.revisionId !== input.setupVersionId || ["invalidated", "expired", "completed", "entry_observed"].includes(scenario.state)) throw new Error("This opportunity has ended or its entry was already observed. A new watch cannot revive it.");
    if (assessment.blockers.some(b => ["history", "source_revised", "quote"].includes(b))) throw new Error("Current eligibility cannot be assessed from complete fresh sources. Refresh after data recovers.");
    const now = this.now(), id = `tw_${hash(`${scenario.scenarioId}:${scenario.revisionId}:${owner}`)}`;
    const report = structuredClone(source.report); report.scenario = scenario;
    const reportRef = await this.store.saveWatchReport(owner, report, new Date(scenario.expiresAt).toISOString());
    return this.store.mutate(owner, value => {
      if (!terminalAccess(value, now).active) throw new Error("An active Terminal pass is required");
      if (value.watches.some(watch => watch.id === id)) return false;
      if (value.watches.filter(w => !w.paused && Date.parse(w.expiresAt) > now && !["invalidated", "expired", "completed", "entry_observed"].includes(w.state)).length >= this.cfg.TERMINAL_MAX_WATCHES) throw new Error("Active setup-watch limit reached");
      value.watches.push({ ...input, timeframe: source.timeframe, id, createdAt: new Date(now).toISOString(), expiresAt: new Date(scenario.expiresAt).toISOString(), paused: false, state: scenario.state, reason: scenario.reason ?? assessment.lines[0] ?? "The original setup policy is preserved.", nextEvent: terminalScenarioNext(scenario.state), reportRef, scenario, lastObservedAt: assessment.assessedAt });
      appendTerminalActivity(value, { at: new Date(now).toISOString(), kind: "watch_started", subjectId: id, instId: input.instId, timeframe: source.timeframe, message: "Following the reviewed setup version. Historical observations remain historical; no trade was placed." });
    });
  }
  async createRadar(owner: string, input: { instId: string; timeframe: string; detector: TerminalRadarDefinition["detector"]; boundary: number; side: "above" | "below"; tolerance: number; expiresAt: string; telegram: boolean }) {
    const now = this.now(), frame = terminalFrameProfile(input.timeframe), id = `tr_${randomUUID()}`, expiresAt = Date.parse(input.expiresAt);
    if (expiresAt <= now || expiresAt > now + 90 * 86_400_000) throw new Error("Radar expiry must be within the next 90 days");
    // Fail before creating a live detector if the registered component is unavailable.
    const component = await this.tapeout();
    const definition: TerminalRadarDefinition = { version: "terminal-radar-v1", id, instId: input.instId, timeframe: frame.execution, detector: input.detector, boundary: input.boundary, side: input.side, tolerance: input.tolerance, createdAt: now, expiresAt };
    const snapshot = advanceTerminalRadar(definition, newTerminalRadar(definition), [], component, now);
    return this.store.mutate(owner, value => {
      if (!terminalAccess(value, now).active) throw new Error("An active Terminal pass is required");
      if (value.radars.filter(r => !r.paused && Date.parse(r.expiresAt) > now && !["completed", "failed", "expired"].includes(r.state)).length >= this.cfg.TERMINAL_MAX_RADARS) throw new Error("Active Market Radar limit reached");
      value.radars.push({ ...input, timeframe: frame.timeframe, id, createdAt: new Date(now).toISOString(), paused: false, state: snapshot.status, definition, snapshot, reason: snapshot.events.at(-1)?.reason ?? "Waiting for a new ordered event.", nextEvent: snapshot.next, lastObservedAt: new Date(now).toISOString() });
      appendTerminalActivity(value, { at: new Date(now).toISOString(), kind: "radar_started", subjectId: id, instId: input.instId, timeframe: frame.timeframe, message: `Market Radar started on ${frame.execution} completed observations. Tapeout circuit ${component.circuitId}, block ${component.blockNumber}.` });
    });
  }
  async cycleOwner(owner: string) {
    const now = this.now(), token = randomUUID();
    const claimed = await this.store.mutate(owner, value => {
      if (value.monitoringLease && value.monitoringLease.until > now || now - (value.lastMonitorAt ?? 0) < this.cfg.TERMINAL_MONITOR_INTERVAL_MS) return false;
      value.monitoringLease = { token, until: now + 120_000 }; value.lastMonitorAt = now;
    });
    if (claimed.monitoringLease?.token !== token) return { skipped: true };
    try {
      const access = terminalAccess(claimed, now), recipient = await this.recipient(owner);
      if (!access.active) {
        await this.store.mutate(owner, value => {
          if (!this.ownsMonitoringLease(value, token)) return false;
          // Checkout can renew access while recipient/source reads are pending.
          // The claimed copy cannot end a pass that is active in this CAS.
          if (terminalAccess(value, this.now()).active) return false;
          if (!value.grants.length) return false;
          const last = value.grants.at(-1)!;
          this.publish(value, { id: `expired:${last.id}`, at: new Date(now).toISOString(), kind: "pass_expired", subjectId: last.id, message: "Terminal access expired. Monitoring and AI are paused; recorded positions and exchange protection are unchanged." }, true, recipient);
          for (const item of value.deliveries) if (item.state === "queued" && value.activity.find(e => e.id === item.eventId)?.kind !== "pass_expired") item.state = "cancelled";
        });
      } else {
        const watches = await Promise.all(claimed.watches.filter(w => !w.paused && !["invalidated", "expired", "completed", "entry_observed"].includes(w.state)).map(async watch => {
          let report: GlobalReport;
          try { report = await this.store.loadWatchReport(owner, watch); }
          catch { return { watch, assessment: null, sourceReportUnavailable: true }; }
          try { report.scenario = watch.scenario; return { watch, assessment: await this.assessOwner(owner, report), sourceReportUnavailable: false }; }
          catch { return { watch, assessment: null, sourceReportUnavailable: false }; }
        }));
        const radars = await Promise.all(claimed.radars.filter(r => !r.paused && !["completed", "failed", "expired"].includes(r.state)).map(async radar => {
          const [market, component] = await Promise.all([this.snapshot(radar.instId, radar.timeframe).catch(() => null), this.tapeout().catch(() => null)]);
          return { radar, snapshot: advanceTerminalRadar(radar.definition as TerminalRadarDefinition, radar.snapshot as TerminalRadarState, market?.observations ?? [], component, Math.max(this.now(), market?.observedAt ?? now)) };
        }));
        const positions = await Promise.all(claimed.positions.filter(p => !p.paused && p.status === "open").map(async position => ({ position, market: await this.snapshot(position.instId, position.timeframe).catch(() => null) })));
        await this.store.mutate(owner, value => {
          if (!this.ownsMonitoringLease(value, token)) return false;
          if (!terminalAccess(value, this.now()).active) return false;
          for (const { watch, assessment, sourceReportUnavailable } of watches) {
            const current = value.watches.find(w => w.id === watch.id); if (!current || current.paused || current.lastObservedAt !== watch.lastObservedAt) continue;
            const bad = !assessment || assessment.blockers.some(b => ["history", "source_revised", "quote"].includes(b));
            const scenario = bad ? current.scenario : assessment.scenario ?? current.scenario;
            const state = bad ? "data_needed" : scenario.state;
            const reason = bad ? sourceReportUnavailable ? "The saved setup source report is missing or its integrity could not be verified. Progress is preserved; no replacement plan is inferred." : "Fresh complete observations are unavailable; saved setup progress has not advanced." : scenario.reason ?? assessment!.lines[0] ?? terminalScenarioNext(state);
            for (const event of scenario.events.filter(e => !current.scenario.events.some(old => old.id === e.id))) this.publish(value, { id: `watch:${current.id}:${event.id}`, at: new Date(now).toISOString(), sourceAt: new Date(event.at).toISOString(), kind: event.kind === "confirmation" ? "conditions_satisfied" : `watch_${event.kind}`, subjectId: current.id, instId: current.instId, timeframe: current.timeframe, message: event.kind === "confirmation" ? terminalConfirmationMessage(assessment!, scenario.state) : `${event.kind}: ${terminalScenarioNext(scenario.state)} Price observations do not establish a venue fill.` }, current.telegram, recipient);
            if (state !== current.state) this.publish(value, { id: `watch-state:${current.id}:${state}:${scenario.updatedAt}`, at: new Date(now).toISOString(), kind: state === "data_needed" ? "source_interruption" : `watch_${state}`, subjectId: current.id, instId: current.instId, timeframe: current.timeframe, message: reason }, current.telegram, recipient);
            current.scenario = scenario; current.state = state; current.reason = reason; current.nextEvent = bad ? "Wait for source recovery; skipped intervals must be verified." : terminalScenarioNext(state); current.lastObservedAt = new Date(now).toISOString();
          }
          for (const { radar, snapshot } of radars) {
            const current = value.radars.find(r => r.id === radar.id); if (!current || current.paused || current.lastObservedAt !== radar.lastObservedAt) continue;
            const before = current.snapshot as TerminalRadarState;
            for (const event of snapshot.events.filter(e => !before.events.some(old => old.id === e.id))) this.publish(value, { id: `radar:${current.id}:${event.id}`, at: new Date(now).toISOString(), sourceAt: new Date(event.at).toISOString(), kind: event.kind === "data_needed" ? "source_interruption" : `radar_${event.kind}`, subjectId: current.id, instId: current.instId, timeframe: current.timeframe, message: event.reason }, current.telegram, recipient);
            current.snapshot = snapshot; current.state = snapshot.status; current.reason = snapshot.events.at(-1)?.reason ?? snapshot.next; current.nextEvent = snapshot.next; current.lastObservedAt = new Date(now).toISOString();
          }
          for (const { position, market } of positions) {
            const current = value.positions.find(p => p.id === position.id); if (!current || current.paused || current.status !== "open") continue;
            const derivatives = market?.tools.derivatives;
            const q = current.instrumentType === "perpetual" ? derivatives?.markPrice !== undefined ? { price: derivatives.markPrice, ts: derivatives.markPriceAt ?? 0 } : undefined : market?.report.currentMarket?.quote;
            const source = current.instrumentType === "perpetual" ? `${derivatives?.source}:${derivatives?.instrumentId ?? "unknown-contract"}` : `${market?.report.snapshot.source}:${current.instId}`;
            const kind = current.instrumentType === "perpetual" ? "perpetual-mark-reference" as const : "spot-reference" as const;
            // Keep the accepted source cursor independently of the displayed
            // fresh mark. Outages must not erase chronology and permit a later
            // stale/revised provider response to create current risk events.
            const cursor = current.lastMarkObservation ?? current.lastMark;
            if (cursor && !current.lastMarkObservation) current.lastMarkObservation = { ...cursor };
            const cursorAt = cursor ? Date.parse(cursor.at) : null;
            const chronological = q && (!cursor || cursor.source === source && cursor.kind === kind && (q.ts > cursorAt! || q.ts === cursorAt && q.price === cursor.price));
            // A recent cached quote may still predate a newly recorded fill or
            // stop/target amendment. Evaluate the effective journal timeline,
            // rather than assigning that earlier price to later protection.
            const effectiveAt = current.events.reduce((latest, event) => Math.max(latest, Date.parse(event.executedAt)), current.events.length ? 0 : Date.parse(current.createdAt));
            const assessedAt = this.now(), fresh = q && Number.isFinite(q.price) && q.price > 0 && Number.isSafeInteger(q.ts) && q.ts <= assessedAt + 5000 && assessedAt - q.ts <= 60_000 && q.ts >= effectiveAt && chronological;
            const state = !fresh ? "source_interruption" : current.hardStop !== null && (current.side === "long" ? q.price <= current.hardStop : q.price >= current.hardStop) ? "protection_touched" : current.targets.some(target => current.side === "long" ? q.price >= target : q.price <= target) ? "target_touched" : "monitoring";
            if (state !== current.lastRiskState && state !== "monitoring") this.publish(value, { id: `position:${current.id}:${state}:${q?.ts ?? now}`, at: new Date(now).toISOString(), ...(fresh ? { sourceAt: new Date(q.ts).toISOString() } : {}), kind: state, subjectId: current.id, instId: current.instId, timeframe: current.timeframe, message: state === "source_interruption" ? "A fresh monotonic position mark at or after the latest effective journal event is required; older or revised source instants cannot establish current risk." : `${state.replaceAll("_", " ")}. This is a price observation; no protective order or exit fill is verified.` }, current.telegram, recipient);
            if (fresh) { current.lastMark = { price: q.price, at: new Date(q.ts).toISOString(), source, kind, venueMatches: current.venue.trim().toLowerCase() === "okx" }; current.lastMarkObservation = { ...current.lastMark }; } else delete current.lastMark;
            current.lastRiskState = state;
          }
        });
      }
      await this.deliver(owner, token);
      return { skipped: false };
    } finally { await this.store.mutate(owner, value => { if (value.monitoringLease?.token !== token) return false; delete value.monitoringLease; }); }
  }
  async deliver(owner: string, monitoringToken?: string) {
    const now = this.now(), recipient = await this.recipient(owner);
    let selectedId: string | undefined;
    const prepared = await this.store.mutate(owner, value => {
      selectedId = undefined;
      if (monitoringToken && !this.ownsMonitoringLease(value, monitoringToken)) return false;
      for (const item of value.deliveries) {
        if (item.state === "sending") { item.state = "uncertain"; item.error = "Delivery acknowledgement was interrupted; automatic resend is suppressed."; }
        const event = value.activity.find(e => e.id === item.eventId), subject = [...value.watches, ...value.radars, ...value.positions].find(s => s.id === item.subjectId);
        const active = terminalAccess(value, this.now()).active;
        if (item.state === "queued" && (!recipient || item.recipientId !== recipient || !value.telegram.enabled || !value.telegram.events.includes(event?.kind ?? "") || (event?.kind === "pass_expired" ? active : !active || !subject || subject.paused || !subject.telegram))) item.state = "cancelled";
      }
      const item = value.deliveries.find(d => d.state === "queued");
      if (item) { item.state = "sending"; item.attemptedAt = new Date(now).toISOString(); selectedId = item.id; }
    });
    const item = prepared.deliveries.find(d => d.id === selectedId && d.state === "sending"); if (!item) return;
    const event = prepared.activity.find(e => e.id === item.eventId);
    let messageId: number | undefined, failure: string | undefined;
    try {
      if (!event || !recipient) throw new Error("Notification event or recipient is unavailable");
      const text = `PULSE Trading Terminal\n${event.instId ?? "Access"}${event.timeframe ? ` · ${event.timeframe}` : ""}\n${event.message}\nObserved: ${event.sourceAt ?? event.at}\n${new URL("/trading-terminal", process.env.TELEGRAM_MINI_APP_URL || "https://app.ai-pulse.tech").href}`;
      if (this.deps.telegramSend) messageId = await this.deps.telegramSend(recipient, text);
      else {
        const token = process.env.TELEGRAM_BOT_TOKEN; if (!token) throw new Error("Telegram bot delivery is not configured");
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: recipient, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(15_000) });
        const body = await response.json() as { ok?: boolean; result?: { message_id?: number } };
        if (!response.ok || !body.ok || !Number.isSafeInteger(body.result?.message_id)) throw new Error("Telegram did not acknowledge this notification");
        messageId = body.result!.message_id;
      }
    } catch (error) { failure = error instanceof Error ? error.message : "Notification delivery is uncertain"; }
    await this.store.mutate(owner, value => { const saved = value.deliveries.find(d => d.id === item.id); if (!saved || saved.state !== "sending") return false; saved.state = messageId !== undefined ? "acknowledged" : "uncertain"; if (messageId !== undefined) saved.messageId = messageId; if (failure) saved.error = failure; });
  }
}
const runtimes = new Map<string, TerminalRuntime>();
export function registerTerminalRuntime(runtime: TerminalRuntime) { runtimes.set(runtime.cfg.PERSISTENCE_NAMESPACE, runtime); }
export async function runTerminalCycle(cfg: AppConfig) {
  if (!cfg.FEATURE_TRADING_TERMINAL) return { skipped: true };
  const runtime = runtimes.get(cfg.PERSISTENCE_NAMESPACE); if (!runtime) return { skipped: true, reason: "terminal_storage_unavailable" };
  const owners = await runtime.store.owners();
  const results = [], deadline = Date.now() + 45_000;
  for (const owner of owners) { if (Date.now() >= deadline) break; results.push(await runtime.cycleOwner(owner).catch(() => ({ failed: true }))); }
  return { owners: owners.length, failures: results.filter(result => "failed" in result).length };
}
export function startTerminalMonitorWorker(cfg: AppConfig) {
  if (!cfg.FEATURE_TRADING_TERMINAL || cfg.NODE_ENV === "test" || process.env.AUTOMATION_WORKER_ENABLED !== "1") return () => {};
  const timer = setInterval(() => void runTerminalCycle(cfg).catch(() => console.warn("[terminal] Monitoring cycle unavailable; durable progress is preserved")), cfg.TERMINAL_MONITOR_INTERVAL_MS);
  timer.unref(); return () => clearInterval(timer);
}
