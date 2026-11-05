import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "@pulse/config";
import { createTerminalMarketSnapshot, advanceTerminalRadar, newTerminalRadar, restoreGlobalScenarioBoundPlan, advanceGlobalScenario, newGlobalScenario } from "@pulse/analysis";
import { fetchTerminalTapeoutComponent, buildMarketContext, getTicker } from "@pulse/market";
import { terminalFrameProfile, type TerminalMarketSnapshot, type TerminalRadarDefinition, type TerminalRadarState, type TerminalTapeoutComponent } from "@pulse/domain";
import { GlobalReportSchema, GlobalScenarioSchema, type GlobalAssessment, type GlobalReport, type GlobalScenario } from "@pulse/schemas";
import { recheckSavedGlobalReport } from "./globalAssessmentRoutes.js";
import { TerminalAuth } from "./terminalAuth.js";
import { appendTerminalActivity, createTerminalStore, terminalAccess, type TerminalActivity, type TerminalPosition, type TerminalRadar, type TerminalSourceIssue, type TerminalStore, type TerminalWatch, type TerminalWorkspace } from "./terminalStore.js";
import { inspectTelegramConfiguration } from "./telegram.js";
import { StoreRedis } from "./storeRedis.js";
import { createGlobalScenarioStore, GlobalScenarioHistoryUnavailableError, reconcileGlobalScenarioAssessment, type GlobalScenarioStore } from "./globalScenarioStore.js";
import { terminalPricePathEvents } from "./terminalPricePath.js";

export type TerminalDependencies = {
  store?: TerminalStore;
  snapshot?: typeof createTerminalMarketSnapshot;
  assess?: (report: GlobalReport) => Promise<GlobalAssessment>;
  recheckMarket?: typeof buildMarketContext;
  quote?: typeof getTicker;
  tapeout?: () => Promise<TerminalTapeoutComponent>;
  now?: () => number;
  telegramRecipient?: (owner: string) => Promise<number | null>;
  telegramSend?: (recipient: number, text: string) => Promise<number>;
  scenarios?: GlobalScenarioStore;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
export class TerminalRadarRequestConflictError extends Error { readonly code = "terminal_radar_request_conflict"; }
export type TerminalQuote = { instId: string; price: number; ts: number; source: "okx-public-spot"; observedAt: number };
export function terminalLimits(cfg: AppConfig) { return { activeWatches: cfg.TERMINAL_MAX_WATCHES, activeRadars: cfg.TERMINAL_MAX_RADARS, openPositions: cfg.TERMINAL_MAX_POSITIONS, aiQuestionsPerDay: cfg.TERMINAL_AI_QUESTIONS_PER_DAY, historyRetentionDays: cfg.TERMINAL_RETENTION_DAYS, monitorIntervalMs: cfg.TERMINAL_MONITOR_INTERVAL_MS }; }
export const terminalScenarioNext = (state: string) => ({ awaiting_location: "Wait for a new eligible location test.", awaiting_event: "Wait for the saved execution policy's later confirmation.", confirmed_awaiting_fill: "Review a return inside the saved entry region before its deadline.", entry_observed: "Price path reached the entry; record an actual fill separately.", invalidated: "This setup ended. Review a separate new setup version.", expired: "This setup expired. Review a separate new setup version.", completed: "This opportunity has finished; it cannot be restarted." }[state] ?? "Inspect the saved setup's next required event.");
/** A scenario event proves price-policy progress, never full trade admission. */
export function terminalConfirmationMessage(assessment: GlobalAssessment, scenarioState: string) {
  const blockers = assessment.blockers.length ? ` Blockers: ${assessment.blockers.join(", ")}.` : "";
  const payoff = Number.isFinite(assessment.firstObstacleRewardRisk) ? ` Nearest-obstacle reward: ${assessment.firstObstacleRewardRisk!.toFixed(2)}R.` : "";
  const action = assessment.state === "technical_valid" && !assessment.blockers.length ? "Review entry eligibility" : "WAIT";
  return `Price policy confirmation observed; this event alone does not qualify an entry. Current assessment: ${action} (${assessment.state}).${blockers}${payoff} ${terminalScenarioNext(scenarioState)} A fresh quote, payoff and every remaining entry rule still require review; no venue fill or order authorization is established.`;
}
/** Do not expose provider exception text: it can contain credentials, request
 * URLs or private storage keys. Keep a useful, stable diagnosis instead. */
export function terminalWatchSourceIssue(input: { assessment?: GlobalAssessment | null; error?: unknown; sourceReportUnavailable?: boolean }, at: number): TerminalSourceIssue {
  const blockers = (input.assessment?.blockers ?? []).filter(b => ["history", "source_revised", "quote"].includes(b));
  const text = input.error instanceof Error ? input.error.message : "";
  const [code, message] = input.sourceReportUnavailable || /saved setup source report is invalid/i.test(text) ? ["saved_source_unavailable", "The saved setup source report is missing or its integrity could not be verified. Restore its original source; a different plan cannot replace it."]
    : blockers.includes("source_revised") ? ["candles_revised", "The exchange revised candles used by this setup. Its saved prices and progress are preserved; review a new setup rather than treating revised history as confirmation."]
    : blockers.includes("history") ? ["candle_history_incomplete", "Completed candles are missing, stale or contain a gap on the setup or execution timeframe. Monitoring will retry; progress stays at the last verified observation."]
    : blockers.includes("quote") ? ["quote_unavailable", "The same-market quote is missing or older than 60 seconds. Completed-candle progress is preserved while a fresh quote is requested."]
    : /predates the saved report/i.test(text) ? ["source_clock_behind", "The recheck returned evidence older than the saved report. Monitoring will retry without rewinding the setup clock."]
    : /identity|instrument|currency|timeframe.*match/i.test(text) ? ["source_identity_mismatch", "The returned source does not match this setup's market, venue, currency or timeframe. Progress is preserved until a matching source is available."]
    : /retained scenario history|history.*reconcil/i.test(text) ? ["scenario_history_unavailable", "Complete retained scenario history is required before delayed observations can be reconciled. The original opportunity has not restarted."]
    : /revision|priced.*contract/i.test(text) ? ["setup_revision_mismatch", "The saved priced setup revision could not be matched. Refreshing cannot replace its original entry, stop or targets."]
    : /timeout|timed out|abort/i.test(text) ? ["source_timeout", "The market-source request timed out. Monitoring will retry and keep the last verified setup progress."]
    : ["source_unavailable", "The market source could not be rechecked. Monitoring will retry; no entry, stop or target is inferred from unavailable data."];
  return { code, message, detectedAt: new Date(at).toISOString(), blockers };
}
/** Repair only the known pre-fix serialization defect: an otherwise valid
 * saved source included later watch progress. Original source bytes, priced
 * rules and the live ledger stay intact; only a read-time source clone gets
 * its publication-time lifecycle before strict report validation. */
export function terminalImmutableSourceReport(original: GlobalReport): GlobalReport {
  const report = structuredClone(original);
  if (GlobalReportSchema.safeParse(report).success) return report;
  const lifecycle = GlobalScenarioSchema.safeParse(report.scenario), cutoff = Date.parse(report.snapshot?.observedAt);
  if (!lifecycle.success || !Number.isFinite(cutoff) || lifecycle.data.startedAt > cutoff || lifecycle.data.updatedAt <= cutoff) throw new Error("The saved setup source report is invalid; its original priced evidence must be restored");
  report.scenario = advanceGlobalScenario(lifecycle.data.definition, newGlobalScenario(lifecycle.data.definition), lifecycle.data.events.filter(event => event.at <= cutoff), cutoff);
  if (!GlobalReportSchema.safeParse(report).success) throw new Error("The saved setup source report is invalid beyond its lifecycle clock; no replacement plan is inferred");
  return report;
}
export class TerminalRuntime {
  readonly store: TerminalStore;
  readonly auth: TerminalAuth;
  readonly now: () => number;
  readonly scenarios: GlobalScenarioStore;
  private market = new Map<string, { at: number; value: Promise<TerminalMarketSnapshot> }>();
  // Shared by all owners/timeframes handled by this runtime. Quote requests
  // neither regenerate reports nor write lifecycle/journal state.
  private quotes = new Map<string, { at: number; value: Promise<TerminalQuote> }>();
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
  async quote(instId: string): Promise<TerminalQuote> {
    if (!/^[A-Z0-9]{2,20}-(USDT|USDC|USD)$/.test(instId)) throw new Error("A supported Spot asset is required");
    const now = this.now(), old = this.quotes.get(instId);
    const validate = (quote: TerminalQuote) => {
      const at = this.now();
      if (quote.instId !== instId || !Number.isFinite(quote.price) || quote.price <= 0 || !Number.isSafeInteger(quote.ts) || quote.ts < 0 || quote.ts > at + 5000 || at - quote.ts > 15_000) throw new Error("A fresh matching OKX Spot quote is unavailable");
      return quote;
    };
    if (old && now - old.at < 1000) return old.value.then(validate);
    if (this.quotes.size >= 100) this.quotes.delete(this.quotes.keys().next().value!);
    const value = (this.deps.quote ?? getTicker)(instId).then(ticker => {
      if (ticker.instId !== instId || ticker.priceCurrency !== undefined && ticker.priceCurrency !== instId.split("-").at(-1)) throw new Error("The Spot quote does not match the requested asset and currency");
      return validate({ instId, price: ticker.last, ts: Number(ticker.ts), source: "okx-public-spot", observedAt: this.now() });
    });
    this.quotes.set(instId, { at: now, value });
    value.catch(() => { if (this.quotes.get(instId)?.value === value) this.quotes.delete(instId); });
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
  async assess(report: GlobalReport, scenario?: GlobalScenario) {
    if (this.deps.assess) return this.deps.assess(scenario ? { ...report, scenario: structuredClone(scenario) } : report);
    return recheckSavedGlobalReport(terminalImmutableSourceReport(report), this.deps.recheckMarket ?? buildMarketContext, { scenario });
  }
  async assessOwner(owner: string, original: GlobalReport, retainedScenario?: GlobalScenario) {
    const report = structuredClone(original), originalScenario = retainedScenario ?? report.scenario;
    if (!originalScenario) return this.assess(report);
    if (retainedScenario && (!report.scenario || retainedScenario.revisionId !== report.scenario.revisionId || JSON.stringify(retainedScenario.definition) !== JSON.stringify(report.scenario.definition))) throw new Error("The retained lifecycle must match the saved priced scenario revision");
    const scope = this.scenarioScope(owner);
    let record = await this.scenarios.get(scope, originalScenario.scenarioId);
    if (!record) record = await this.scenarios.advance(scope, originalScenario.definition, originalScenario.events, originalScenario.updatedAt, report.discretionaryPlan);
    if (record.snapshot.revisionId !== originalScenario.revisionId) throw new Error("This source opportunity already has a different bound priced revision; a refresh cannot replace it");
    if (record.boundPlan) restoreGlobalScenarioBoundPlan(report, record.boundPlan);
    const [assessment, current] = await Promise.all([this.assess(report, record.snapshot), this.deps.snapshot || !this.deps.assess ? this.snapshot(report.snapshot.instId, report.snapshot.timeframe).catch(() => null) : Promise.resolve(null)]);
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
    const configuration = inspectTelegramConfiguration();
    if (!configuration.complete || !/^[A-Za-z\d_]{5,32}$/.test(configuration.botUsername)) return null;
    if (!this.redis) return null;
    const prefix = `${this.cfg.PERSISTENCE_NAMESPACE}:telegram:wallet`, id = await this.redis.get<number>(`${prefix}:owner:${owner}`);
    if (!Number.isSafeInteger(id) || !id) return null;
    const linked = await this.redis.get<{ wallet: string }>(`${prefix}:account:${id}`);
    return linked?.wallet === owner ? id : null;
  }
  async workspace(owner: string) {
    const value = await this.store.get(owner), configuration = inspectTelegramConfiguration();
    let linkUnavailable = false;
    const linked = await this.recipient(owner).catch(() => { linkUnavailable = true; return null; });
    const botUsername = /^[A-Za-z\d_]{5,32}$/.test(configuration.botUsername) ? configuration.botUsername : null;
    const configured = this.cfg.FEATURE_TELEGRAM && configuration.complete && Boolean(botUsername);
    const botUrl = botUsername ? `https://t.me/${botUsername}` : null;
    const linkState = linkUnavailable || !configured && !this.deps.telegramRecipient ? "unavailable" as const : linked ? "linked" as const : "not_linked" as const;
    const watches = value.watches.map(({ report: _legacyReport, ...watch }) => watch);
    const serverNow = this.now();
    return { ...value, watches, serverNow, access: terminalAccess(value, serverNow), telegram: { ...value.telegram, linked: Boolean(linked), configured, botUsername, botUrl, linkUrl: botUrl ? `${botUrl}?start=terminal_alerts` : null, linkState, linkedWallet: linked ? owner.toLowerCase() : null, nextStep: linkState === "unavailable" ? "Telegram delivery or wallet-link lookup is unavailable. Existing notification preferences are preserved." : linked ? "Choose alert types and enable Telegram notifications here. Also select Telegram on each setup, Radar or position you want to follow." : "Open the PULSE bot, link this exact wallet, sign the ownership message and confirm the address in Telegram. Return here and refresh the connection." }, limits: terminalLimits(this.cfg), execution: "journal-and-monitoring-only" };
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
    const report = structuredClone(source.report);
    const reportRef = await this.store.saveWatchReport(owner, report, new Date(scenario.expiresAt).toISOString());
    return this.store.mutate(owner, value => {
      if (!terminalAccess(value, now).active) throw new Error("An active Terminal pass is required");
      if (value.watches.some(watch => watch.id === id)) return false;
      if (value.watches.filter(w => !w.paused && Date.parse(w.expiresAt) > now && !["invalidated", "expired", "completed", "entry_observed"].includes(w.state)).length >= this.cfg.TERMINAL_MAX_WATCHES) throw new Error("Active setup-watch limit reached");
      value.watches.push({ ...input, timeframe: source.timeframe, id, createdAt: new Date(now).toISOString(), expiresAt: new Date(scenario.expiresAt).toISOString(), paused: false, state: scenario.state, reason: scenario.reason ?? assessment.lines[0] ?? "The original setup policy is preserved.", nextEvent: terminalScenarioNext(scenario.state), reportRef, scenario, lastObservedAt: assessment.assessedAt });
      appendTerminalActivity(value, { at: new Date(now).toISOString(), kind: "watch_started", subjectId: id, instId: input.instId, timeframe: source.timeframe, message: "Following the reviewed setup version. Historical observations remain historical; no trade was placed." });
    });
  }
  async createRadar(owner: string, input: { requestId?: string; instId: string; timeframe: string; detector: TerminalRadarDefinition["detector"]; boundary: number; side: "above" | "below"; tolerance: number; expiresAt: string; telegram: boolean }) {
    const now = this.now(), frame = terminalFrameProfile(input.timeframe), id = `tr_${randomUUID()}`, expiresAt = Date.parse(input.expiresAt);
    const creationHash = hash(JSON.stringify([input.instId, frame.timeframe, input.detector, input.boundary, input.side, input.tolerance, expiresAt, input.telegram]));
    const retry = (value: TerminalWorkspace) => {
      const previous = input.requestId ? value.radars.find(radar => radar.requestId === input.requestId) : undefined;
      if (!previous) return false;
      if (previous.creationHash !== creationHash) throw new TerminalRadarRequestConflictError("This Radar request belongs to a different accepted rule. Use a new request ID for a new detector.");
      return true;
    };
    const before = await this.store.get(owner);
    if (retry(before)) return before;
    if (expiresAt <= now || expiresAt > now + 90 * 86_400_000) throw new Error("Radar expiry must be within the next 90 days");
    // Fail before creating a live detector if the registered component is unavailable.
    const component = await this.tapeout();
    const definition: TerminalRadarDefinition = { version: "terminal-radar-v1", id, instId: input.instId, timeframe: frame.execution, detector: input.detector, boundary: input.boundary, side: input.side, tolerance: input.tolerance, createdAt: now, expiresAt };
    const snapshot = advanceTerminalRadar(definition, newTerminalRadar(definition), [], component, now);
    return this.store.mutate(owner, value => {
      if (retry(value)) return false;
      if (!terminalAccess(value, this.now()).active) throw new Error("An active Terminal pass is required");
      if (expiresAt <= this.now()) throw new Error("This Radar deadline passed before creation was accepted");
      if (value.radars.filter(r => !r.paused && Date.parse(r.expiresAt) > now && !["completed", "failed", "expired"].includes(r.state)).length >= this.cfg.TERMINAL_MAX_RADARS) throw new Error("Active Market Radar limit reached");
      value.radars.push({ ...input, ...(input.requestId ? { creationHash } : {}), timeframe: frame.timeframe, id, createdAt: new Date(now).toISOString(), paused: false, state: snapshot.status, definition, snapshot, reason: snapshot.events.at(-1)?.reason ?? "Waiting for a new ordered event.", nextEvent: snapshot.next, lastObservedAt: new Date(now).toISOString() });
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
          catch (error) { return { watch, assessment: null, sourceReportUnavailable: true, error }; }
          try { return { watch, assessment: await this.assessOwner(owner, report, watch.scenario), sourceReportUnavailable: false, error: undefined }; }
          catch (error) { return { watch, assessment: null, sourceReportUnavailable: false, error }; }
        }));
        const radars = await Promise.all(claimed.radars.filter(r => !r.paused && !["completed", "failed", "expired"].includes(r.state)).map(async radar => {
          const [market, component] = await Promise.all([this.snapshot(radar.instId, radar.timeframe).catch(() => null), this.tapeout().catch(() => null)]);
          return { radar, snapshot: advanceTerminalRadar(radar.definition as TerminalRadarDefinition, radar.snapshot as TerminalRadarState, market?.observations ?? [], component, Math.max(this.now(), market?.observedAt ?? now)) };
        }));
        const positions = await Promise.all(claimed.positions.filter(p => !p.paused && p.status === "open").map(async position => ({ position, market: await this.snapshot(position.instId, position.timeframe).catch(() => null) })));
        await this.store.mutate(owner, value => {
          if (!this.ownsMonitoringLease(value, token)) return false;
          if (!terminalAccess(value, this.now()).active) return false;
          for (const { watch, assessment, sourceReportUnavailable, error } of watches) {
            const current = value.watches.find(w => w.id === watch.id); if (!current || current.paused || current.lastObservedAt !== watch.lastObservedAt) continue;
            const bad = !assessment || assessment.blockers.some(b => ["history", "source_revised", "quote"].includes(b));
            const scenario = bad ? current.scenario : assessment.scenario ?? current.scenario;
            const state = bad ? "data_needed" : scenario.state;
            const sourceIssue = bad ? terminalWatchSourceIssue({ assessment, sourceReportUnavailable, error }, now) : undefined;
            const reason = sourceIssue?.message ?? scenario.reason ?? assessment!.lines[0] ?? terminalScenarioNext(state);
            for (const event of scenario.events.filter(e => !current.scenario.events.some(old => old.id === e.id))) this.publish(value, { id: `watch:${current.id}:${event.id}`, at: new Date(now).toISOString(), sourceAt: new Date(event.at).toISOString(), kind: event.kind === "confirmation" ? "conditions_satisfied" : `watch_${event.kind}`, subjectId: current.id, instId: current.instId, timeframe: current.timeframe, message: event.kind === "confirmation" ? terminalConfirmationMessage(assessment!, scenario.state) : `${event.kind}: ${terminalScenarioNext(scenario.state)} Price observations do not establish a venue fill.` }, current.telegram, recipient);
            if (state !== current.state || sourceIssue && sourceIssue.code !== current.sourceIssue?.code) this.publish(value, { id: `watch-state:${current.id}:${state}:${sourceIssue?.code ?? "verified"}:${now}`, at: new Date(now).toISOString(), kind: state === "data_needed" ? "source_interruption" : `watch_${state}`, subjectId: current.id, instId: current.instId, timeframe: current.timeframe, message: reason }, current.telegram, recipient);
            current.scenario = scenario; current.state = state; current.reason = reason; current.nextEvent = bad ? "Monitoring retries automatically. Refresh conditions to retry now; incomplete intervals must be verified before progress resumes." : terminalScenarioNext(state); current.lastObservedAt = new Date(now).toISOString();
            if (sourceIssue) current.sourceIssue = sourceIssue; else delete current.sourceIssue;
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
