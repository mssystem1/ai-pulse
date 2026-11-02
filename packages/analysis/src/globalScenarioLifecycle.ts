import { createHash } from "node:crypto";
import {
  candleCloseTime, candleTimeframeMs, GlobalScenarioDefinitionSchema,
  type GlobalReport, type GlobalScenario, type GlobalScenarioDefinition, type GlobalScenarioEvent,
} from "@pulse/schemas";
import { globalEntryOpposition, globalRouteObstacles } from "./globalRouteObstacles.js";
import { evaluateGlobalStrategyMix } from "./globalStrategyMix.js";

type DefinitionInput = Omit<GlobalScenarioDefinition, "version" | "scenarioId" | "revisionId">;
type ScenarioCandle = { ts: number; open: number; high: number; low: number; close: number; confirmed: boolean };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const terminal = (s: GlobalScenario["state"]) => s === "invalidated" || s === "expired" || s === "completed";
export const isGlobalScenarioTerminal = (s: GlobalScenario) => terminal(s.state);

/** Identity is the source premise. Rendering time and moving EMA prices are not new trades. */
export function createGlobalScenarioDefinition(input: DefinitionInput): GlobalScenarioDefinition {
  const scenarioId = `gsc_${digest([input.market, input.timeframe, input.family, input.side, input.policyId, input.configurationKey, input.sourceKey])}`;
  const revisionId = `gsr_${digest([scenarioId, input.entryZone, input.hardStop, input.targets, input.sourceBoundary, input.sourceLower, input.sourceUpper, input.sourcePrice, input.stopBasis, input.mode, input.confirmationBars, input.fillWindowMs])}`;
  return GlobalScenarioDefinitionSchema.parse({ ...input, version: "scenario-definition-v1", scenarioId, revisionId });
}

export function newGlobalScenario(definition: GlobalScenarioDefinition): GlobalScenario {
  return {
    version: "scenario-lifecycle-v1", scenarioId: definition.scenarioId, revisionId: definition.revisionId,
    state: "awaiting_location", startedAt: definition.createdAt, updatedAt: definition.createdAt,
    expiresAt: definition.expiresAt, observationOnly: true, definition: structuredClone(definition),
    events: [], exits: [], remainingFraction: 1,
  };
}

function eventIdentity(e: GlobalScenarioEvent) { return [e.kind, e.at, e.candleTs ?? null, e.targetId ?? null].join(":"); }
function postPublication(e: GlobalScenarioEvent, state: GlobalScenario) {
  if (e.kind === "invalidation" || e.kind === "failed_retest") return e.at > state.startedAt;
  // A candle straddling publication cannot establish when its wick occurred.
  return e.candleTs === undefined ? e.at > state.startedAt : e.candleTs >= state.startedAt;
}

/** Causal price-path tracking only. It never asserts an exchange order or a fill. */
export function advanceGlobalScenario(
  definition: GlobalScenarioDefinition, previous: GlobalScenario | null,
  events: readonly GlobalScenarioEvent[], asOf: number,
): GlobalScenario {
  if (!Number.isFinite(asOf) || asOf < definition.createdAt) throw new Error("Scenario observation precedes publication");
  if (previous && (previous.scenarioId !== definition.scenarioId || previous.revisionId !== definition.revisionId)) {
    throw new Error("An active scenario must retain its bound priced revision");
  }
  const state = structuredClone(previous ?? newGlobalScenario(definition));
  if (previous && asOf < previous.updatedAt) return state;
  if (terminal(state.state)) { state.updatedAt = asOf; return state; }
  const seen = new Set(state.events.map(eventIdentity));
  const admitted = events.filter(e => e.at >= definition.eventAfter && e.at >= (previous?.lastEventAt ?? 0) && e.at <= asOf && !seen.has(eventIdentity(e)))
    .sort((a, b) => a.at - b.at || eventIdentity(a).localeCompare(eventIdentity(b)));
  const record = (e: GlobalScenarioEvent) => {
    const key = eventIdentity(e); if (seen.has(key)) return;
    seen.add(key); state.events.push(structuredClone(e)); state.lastEventAt = Math.max(state.lastEventAt ?? 0, e.at);
    if (state.events.length > 256) state.events.splice(0, state.events.length - 256);
  };
  const expireBefore = (at: number) => {
    if (state.state === "entry_observed") return false;
    if (at > state.expiresAt) { state.state = "expired"; state.reason = "setup_deadline"; return true; }
    if (state.confirmationAt !== undefined && at > state.confirmationAt + definition.fillWindowMs) {
      state.state = "expired"; state.reason = "confirmation_fill_deadline"; return true;
    }
    return false;
  };
  for (let i = 0; i < admitted.length;) {
    const at = admitted[i].at, group: GlobalScenarioEvent[] = [];
    while (i < admitted.length && admitted[i].at === at) group.push(admitted[i++]);
    if (expireBefore(at) || terminal(state.state)) break;
    const priceEvents = group.filter(e => postPublication(e, state));
    const stopped = priceEvents.find(e => e.kind === "stop_touch");
    const targetEvents = priceEvents.filter(e => e.kind === "target_touch" && definition.targets.some(t => t.id === e.targetId));
    const entry = priceEvents.find(e => e.kind === "entry_touch");
    const hadEntry = state.state === "entry_observed";
    // Candle OHLC cannot establish entry/stop/target order within one bar.
    const couldEnter = entry && (definition.mode === "passive_limit" || state.confirmationAt !== undefined && at > state.confirmationAt);
    if ((hadEntry && stopped && targetEvents.length) || (!hadEntry && couldEnter && (stopped || targetEvents.length))) {
      group.forEach(record); state.state = "completed"; state.reason = "intrabar_sequence_unknown";
      if (!hadEntry) state.entryObservedAt = at;
      state.outcome = { kind: "ambiguous_bar", at }; break;
    }
    if (!hadEntry) {
      const invalidation = priceEvents.find(e => e.kind === "invalidation" || e.kind === "failed_retest") ?? stopped;
      if (invalidation) { record(invalidation); state.state = "invalidated"; state.reason = invalidation.kind === "failed_retest" ? "failed_retest" : "premise_failed_before_entry"; break; }
      if (targetEvents.length && !couldEnter) { targetEvents.forEach(record); state.state = "invalidated"; state.reason = "target_before_entry"; break; }
      for (const e of group) {
        if (e.kind === "location_test" || e.kind === "acceptance") { record(e); if (state.confirmationAt === undefined && definition.mode === "confirmed_retest") state.state = "awaiting_event"; }
        if (e.kind === "confirmation" && e.at >= definition.eventKnownAt && definition.mode === "confirmed_retest" && (e.at >= state.startedAt || state.startedAt - e.at <= definition.confirmationMaxAgeMs)) {
          record(e);
          if (state.confirmationAt === undefined) { state.confirmationAt = e.at; state.state = "confirmed_awaiting_fill"; }
        }
      }
      if (couldEnter) { record(entry!); state.state = "entry_observed"; state.entryObservedAt = at; state.reason = "price_touch_only_no_fill"; }
    } else {
      if (stopped) {
        record(stopped); state.state = "completed"; state.remainingFraction = 0;
        state.outcome = { kind: "stop_observed", at }; state.reason = "price_path_only_no_realized_pnl"; break;
      }
      for (const e of targetEvents) {
        if (state.exits.some(x => x.targetId === e.targetId)) continue;
        const target = definition.targets.find(t => t.id === e.targetId)!;
        record(e); state.exits.push({ targetId: target.id, at, allocation: target.allocation });
        state.remainingFraction = Math.max(0, 1 - state.exits.reduce((sum, x) => sum + x.allocation, 0));
        if (state.remainingFraction <= 1e-9) {
          state.remainingFraction = 0; state.state = "completed";
          state.outcome = { kind: "target_observed", at, targetId: target.id }; state.reason = "price_path_only_no_realized_pnl";
        }
      }
    }
  }
  if (!terminal(state.state)) expireBefore(asOf);
  state.updatedAt = asOf;
  return state;
}

const overlaps = (c: ScenarioCandle, lower: number, upper: number) => c.low <= upper && c.high >= lower;
function observedEvent(kind: GlobalScenarioEvent["kind"], at: number, candleTs: number, price: number, targetId?: string): GlobalScenarioEvent {
  return { id: `gse_${digest([kind, at, candleTs, price, targetId])}`, kind, at, candleTs, price, basis: "completed_candle", ...(targetId ? { targetId } : {}) };
}

/** Family-specific event observer. OHLC supplies price events, never synthetic flow. */
export function observeGlobalScenarioCandles(definition: GlobalScenarioDefinition, bars: readonly ScenarioCandle[], asOf: number): GlobalScenarioEvent[] {
  const events: GlobalScenarioEvent[] = [], sign = definition.side === "long" ? 1 : -1;
  let acceptedAt: number | null = null;
  for (const c of [...bars].sort((a, b) => a.ts - b.ts)) {
    const at = candleCloseTime(c.ts, definition.eventTimeframe);
    if (!c.confirmed || at === null || at < definition.eventAfter || at > asOf || c.ts < definition.sourceKnownAt) continue;
    const location = overlaps(c, definition.entryZone[0], definition.entryZone[1]);
    const correctClose = sign * (c.close - definition.sourceBoundary) > 0;
    const boundaryTest = overlaps(c, definition.sourceBoundary, definition.sourceBoundary);
    if (definition.mode === "confirmed_retest") {
      if (acceptedAt === null && correctClose) {
        acceptedAt = at; events.push(observedEvent("acceptance", at, c.ts, c.close));
        if (definition.confirmationBars === 1 && at >= definition.eventKnownAt && boundaryTest && location) events.push(observedEvent("confirmation", at, c.ts, c.close));
      } else if (acceptedAt !== null && at > acceptedAt && boundaryTest) {
        events.push(observedEvent("location_test", at, c.ts, definition.sourceBoundary));
        if (correctClose && location && at >= definition.eventKnownAt) events.push(observedEvent("confirmation", at, c.ts, c.close));
        else if (!correctClose) events.push(observedEvent("failed_retest", at, c.ts, c.close));
      }
    } else if (location) events.push(observedEvent("location_test", at, c.ts, c.close));
    if (c.ts < definition.createdAt) continue;
    if (location) events.push(observedEvent("entry_touch", at, c.ts, definition.side === "long" ? definition.entryZone[1] : definition.entryZone[0]));
    if (definition.side === "long" ? c.low <= definition.hardStop : c.high >= definition.hardStop) events.push(observedEvent("stop_touch", at, c.ts, definition.hardStop));
    for (const target of definition.targets) if (definition.side === "long" ? c.high >= target.lower : c.low <= target.upper) {
      events.push(observedEvent("target_touch", at, c.ts, definition.side === "long" ? target.lower : target.upper, target.id));
    }
  }
  return events;
}

/** Build a source-stable identity without treating a report refresh as a new event. */
function sourceKeyForReport(report: GlobalReport): string | null {
  const p = report.discretionaryPlan;
  if (!p) return null;
  const anchor = p.evidence?.testTs ?? (p.entryBasis.kind === "range_edge" ? report.range?.startTs
    : p.entryBasis.kind === "vwap_band" ? report.indicators.vwap?.anchorTs : p.stopBasis.anchorTs);
  return `${p.entryBasis.kind}:${p.entryBasis.timeframe}:${anchor ?? p.stopBasis.anchorTs}`;
}

export function globalScenarioDefinitionForReport(report: GlobalReport, createdAt = Date.parse(report.snapshot.observedAt)): GlobalScenarioDefinition | null {
  const p = report.discretionaryPlan, policy = p?.executionPolicy;
  if (!p || p.version !== "discretionary-plan-v8" || !policy) return null;
  const source = p.priceZones?.entry;
  const ms = candleTimeframeMs(policy.eventTimeframe);
  if (!ms) return null;
  const born = createdAt;
  return createGlobalScenarioDefinition({
    market: `${report.snapshot.source}:${report.snapshot.instId}`, timeframe: report.snapshot.timeframe,
    family: p.family, side: p.side, policyId: policy.id, configurationKey: policy.configurationKey,
    sourceKey: sourceKeyForReport(report)!,
    sourceKnownAt: p.entryBasis.knownAt, sourceTimeframe: p.entryBasis.timeframe,
    sourceLower: source?.sourceLower ?? p.entry, sourceUpper: source?.sourceUpper ?? p.entry, sourcePrice: source?.sourcePrice ?? p.entryBasis.price,
    stopBasis: structuredClone(p.stopBasis), createdAt: born, mode: policy.mode,
    entryZone: [source?.lower ?? p.entry, source?.upper ?? p.entry], hardStop: p.stop,
    targets: p.targets.map((t, i) => ({ id: `tp${i + 1}`, lower: p.priceZones?.targets[i]?.lower ?? t.price, upper: p.priceZones?.targets[i]?.upper ?? t.price, allocation: policy.targetAllocations[i] ?? 1 / p.targets.length })),
    sourceBoundary: policy.sourceBoundary, eventTimeframe: policy.eventTimeframe, eventAfter: policy.eventAfter, eventKnownAt: policy.eventKnownAt,
    expiresAt: policy.expiresAt, confirmationMaxAgeMs: Math.max(ms, policy.expiresAt - born),
    fillWindowMs: policy.fillWindowBars * ms, confirmationBars: policy.confirmationBars,
  });
}

/** A complementary method's completed event is its own confirmation policy.
 * In particular, a sweep's later held candle need not touch the swept level a
 * second time. Re-evaluate the real source/candles/participation before mapping
 * that event, then retain its original timestamp without inventing a fill. */
function selectedMixConfirmation(report: GlobalReport, definition: GlobalScenarioDefinition, bars: readonly ScenarioCandle[], asOf: number): GlobalScenarioEvent | null {
  const selected = report.strategyMix?.candidates.find(c => c.id === report.strategyMix?.selectedVariant);
  const p = report.discretionaryPlan, evidence = p?.evidence;
  if (definition.mode !== "confirmed_retest" || selected?.status !== "eligible" || !selected.source || !selected.event || !p || !evidence) return null;
  // Reproduce admission at this opportunity's original clock. A later free
  // recheck must retain that still-live event even after the mix's new-event
  // search window moves forward; the lifecycle below observes later failures.
  const current = evaluateGlobalStrategyMix(report, { cutoff: Math.min(asOf, definition.createdAt) }).candidates.find(c => c.id === selected.id);
  if (current?.status !== "eligible" || !current.source || !current.event ||
      current.side !== definition.side || current.family !== definition.family ||
      current.source.price !== definition.sourcePrice || current.source.price !== definition.sourceBoundary ||
      current.source.timeframe !== definition.sourceTimeframe || current.source.knownAt !== definition.sourceKnownAt ||
      current.event.timeframe !== definition.eventTimeframe || current.event.testTs !== evidence.testTs ||
      current.event.completedAt !== definition.eventKnownAt || current.event.completedAt !== evidence.completedAt ||
      current.event.kind !== selected.event.kind || current.event.testTs !== selected.event.testTs ||
      current.event.completedAt !== selected.event.completedAt || current.source.price !== selected.source.price ||
      current.source.knownAt !== selected.source.knownAt || current.source.timeframe !== selected.source.timeframe) return null;
  const held = bars.find(c => c.confirmed && candleCloseTime(c.ts, definition.eventTimeframe) === current.event!.completedAt);
  return held ? observedEvent("confirmation", current.event.completedAt, held.ts, held.close) : null;
}

/** Report refreshes reuse the scenario's own clock; no live order is implied. */
export function applyGlobalScenario(report: GlobalReport, previous?: GlobalScenario | null, suppliedEvents: readonly GlobalScenarioEvent[] = []): GlobalScenario | null {
  const p = report.discretionaryPlan, prior = previous?.definition;
  const matching = prior && p?.executionPolicy && prior.market === `${report.snapshot.source}:${report.snapshot.instId}` && prior.timeframe === report.snapshot.timeframe && prior.family === p.family && prior.side === p.side && prior.policyId === p.executionPolicy.id && prior.configurationKey === p.executionPolicy.configurationKey && prior.sourceKey === sourceKeyForReport(report) ? previous : null;
  const candidate = globalScenarioDefinitionForReport(report, matching?.startedAt);
  if (!candidate) return null;
  const definition = matching?.definition ?? candidate;
  const bars = report.entryStudy?.status === "available" && report.entryStudy.timeframe === definition.eventTimeframe ? report.entryStudy.candles
    : report.snapshot.timeframe === definition.eventTimeframe ? report.candles
    : report.currentMarket?.frames.find(f => f.timeframe === definition.eventTimeframe)?.candles ?? [];
  const asOf = Date.parse(report.snapshot.observedAt);
  const observed = observeGlobalScenarioCandles(definition, bars, asOf);
  const mixConfirmation = selectedMixConfirmation(report, definition, bars, asOf);
  if (mixConfirmation) observed.push(mixConfirmation);
  for (const c of report.candles) {
    const at = candleCloseTime(c.ts, report.snapshot.timeframe);
    if (c.confirmed && at !== null && at > definition.createdAt && at <= asOf && (definition.side === "long" ? c.close < definition.stopBasis.price : c.close > definition.stopBasis.price)) {
      observed.push(observedEvent("invalidation", at, c.ts, c.close));
    }
  }
  const snapshot = advanceGlobalScenario(definition, matching ?? null, [...observed, ...suppliedEvents], asOf);
  report.scenario = snapshot;
  return snapshot;
}

/** Keep active risk immutable while refreshing the quote reference and nearer route. */
export function restoreGlobalScenarioBoundPlan(report: GlobalReport, boundPlan: NonNullable<GlobalReport["discretionaryPlan"]>): void {
  const current = report.discretionaryPlan;
  if (!current) return;
  const restored = structuredClone(boundPlan), sign = restored.side === "long" ? 1 : -1;
  restored.reference = structuredClone(current.reference);
  const objective = restored.priceZones?.targets[0];
  const target = objective ? restored.side === "long" ? objective.lower : objective.upper : restored.targets[0].price;
  restored.barriers = globalRouteObstacles(report, restored.side)
    .filter(a => sign * (a.price - restored.entry) > 0 && sign * (target - a.price) > 0)
    .sort((a, b) => sign * (a.price - b.price)).slice(0, 5);
  if (restored.priceZones) {
    const near = restored.barriers[0]?.price ?? target;
    const payoff = globalEntryOpposition(report, restored.side, restored.priceZones.entry).length ? 0 : sign * (near - restored.entry) / Math.abs(restored.entry - restored.stop);
    restored.priceZones.payoffLimited = payoff < 1 - 1e-9;
  }
  report.discretionaryPlan = restored;
  if (report.strategyMix) {
    const mix = report.strategyMix, selected = mix.candidates.find(c => c.id === mix.selectedVariant);
    if (selected && (selected.family !== restored.family || selected.side !== restored.side || selected.source?.price !== restored.entryBasis.price || selected.event?.testTs !== restored.evidence?.testTs)) delete mix.selectedVariant;
    mix.primary = { family: restored.family, side: restored.side, variant: "core", reason: "The saved scenario retains its original priced contract; current alternatives are assessed separately." };
  }
}
