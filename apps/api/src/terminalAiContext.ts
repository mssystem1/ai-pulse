import { globalDecision, globalEligibility, globalPriceZonePayoff, globalTargetReference, globalTradePlan, type TerminalMarketSnapshot } from "@pulse/domain";
import type { GlobalReport } from "@pulse/schemas";
import type { TerminalPosition, TerminalRadar, TerminalWatch } from "./terminalStore.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function pick(value: unknown, keys: readonly string[]) {
  const source = object(value);
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => { const current = source[key]; return [key, typeof current === "string" ? current.slice(0, 600) : current]; }));
}
const proofKeys = ["coverage", "id", "source", "status", "knownAt", "windowStart", "windowEnd", "units", "reason"];
const candleKeys = ["ts", "open", "high", "low", "close", "volume", "confirmed"];
const tail = (value: unknown, limit: number) => Array.isArray(value) ? value.slice(-limit) : [];
const priceRows = (value: unknown, limit = 8) => (Array.isArray(value) ? value.slice().sort((a, b) => Number(object(b).buy ?? 0) + Number(object(b).sell ?? 0) - Number(object(a).buy ?? 0) - Number(object(a).sell ?? 0)).slice(0, limit) : []).map(row => pick(row, ["low", "high", "buy", "sell", "trades"]));
export type TerminalToolInspection = { tool: "value" | "flow" | "footprint" | "derivatives" | "liquidity"; stream?: "spot" | "perpetual"; footprintStart?: number };
export type TerminalInspectionEvidence = Pick<TerminalMarketSnapshot, "instId" | "timeframe" | "observedAt" | "tools"> & { setupVersionId?: string };
export class TerminalInspectionUnavailableError extends Error {}

/** A question about the displayed tool must retain that source window, stream
 * and completed bucket even if a newer polling response arrives meanwhile. */
export function terminalSelectedInspection(evidence: TerminalInspectionEvidence, selection: TerminalToolInspection) {
  const tools = evidence.tools;
  const source = selection.tool === "flow"
    ? (selection.stream === "perpetual" ? tools.perpetualFlow : tools.flow)
    : selection.tool === "footprint" ? tools.value : tools[selection.tool];
  const proof = { ...pick(source ?? { source: "not-supplied", status: "unavailable", knownAt: 0, reason: "The selected source was not supplied." }, proofKeys), originalSourceId: source?.id, id: "selected-inspection" };
  const base = { selection, instId: evidence.instId, timeframe: evidence.timeframe, observedAt: evidence.observedAt, setupVersionId: evidence.setupVersionId, source: proof };
  if (!source) return { ...base, unavailable: true, reason: "The selected execution stream was not supplied in the displayed evidence. Another stream is not a substitute." };
  if (selection.tool === "flow") {
    const flow = selection.stream === "perpetual" ? tools.perpetualFlow : tools.flow;
    return { ...base, stream: selection.stream ?? "spot", values: { ...pick(flow, ["marketType", "buy", "sell", "delta"]), points: tail(flow?.points, 24) } };
  }
  if (selection.tool === "footprint") {
    const orderFlow = tools.value.orderFlow;
    const bar = selection.footprintStart === undefined ? tools.value.sessionProfile ?? orderFlow?.profile : (tools.value.sessionFootprints ?? orderFlow?.footprints)?.find(item => item.start === selection.footprintStart);
    if (selection.footprintStart !== undefined && !bar) throw new TerminalInspectionUnavailableError("The selected completed footprint is not retained in that evidence snapshot. Refresh and select a candle again; a newer bucket was not substituted.");
    return { ...base, windowKind: selection.footprintStart === undefined ? "captured-profile-sample" : "completed-footprint", values: bar ? {
      ...pick(bar, ["start", "end", "knownAt", "open", "high", "low", "close", "buy", "sell", "volume", "delta", "trades"]),
      totalPriceRows: bar.rows.length, suppliedPriceRows: Math.min(32, bar.rows.length), highestVolumeRows: priceRows(bar.rows, 32),
      rowCoverage: "Totals cover the selected window. Only its highest-volume price rows are included here; omitted cells are unknown to this explanation.",
    } : null };
  }
  if (selection.tool === "value") return { ...base, values: { ...pick(tools.value, ["tradeVwap", "sigma", "bands"]), profile: tools.value.sessionProfile || tools.value.orderFlow ? pick(tools.value.sessionProfile ?? tools.value.orderFlow!.profile, ["start", "end", "knownAt", "poc", "val", "vah", "buy", "sell", "volume", "delta"]) : null } };
  if (selection.tool === "derivatives") return { ...base, values: pick(tools.derivatives, ["instrumentId", "markPrice", "markPriceAt", "openInterest", "openInterestAt", "openInterestUsd", "fundingRate", "fundingTime", "fundingObservedAt", "fundingKind"]) };
  return { ...base, values: { ...pick(tools.liquidity, ["note"]), bids: tools.liquidity.bids?.slice(0, 12), asks: tools.liquidity.asks?.slice(0, 12) } };
}
function scenario(value: unknown) {
  const source = object(value);
  return { ...pick(source, ["scenarioId", "revisionId", "state", "reason", "startedAt", "updatedAt", "expiresAt", "confirmationAt", "entryObservedAt"]),
    definition: source.definition, events: tail(source.events, 12).map(event => pick(event, ["kind", "at", "candleTs", "price", "targetId", "basis"])) };
}
/** Use the same deterministic eligibility and payoff projections as the UI.
 * A lifecycle confirmation alone is not an admitted trading opportunity. */
export function terminalSetupEligibility(report: GlobalReport) {
  const decision = globalDecision(report), tradePlan = globalTradePlan(report), plan = report.discretionaryPlan, payoff = globalPriceZonePayoff(report);
  const requiredNearestObstacleR = plan?.priceZones?.payoffFloor ?? null;
  const blockers: string[] = [...tradePlan.blockers];
  if (!decision.qualified) blockers.push(`eligibility_${globalEligibility(report)}`);
  if (payoff && requiredNearestObstacleR !== null && payoff.worstToObstacle < requiredNearestObstacleR) blockers.push("nearest_obstacle_reward_below_required_floor");
  return {
    assessedAt: report.snapshot.observedAt, setupVersionId: report.scenario?.revisionId,
    qualified: decision.qualified, currentAction: decision.currentAction, globalEligibility: globalEligibility(report),
    blockers: [...new Set(blockers)], risk: decision.risk,
    entryPolicyStatus: decision.entryPolicyStatus, entryDeadline: decision.entryDeadline,
    retestDeadline: decision.retestDeadline, overallSetupExpiry: decision.expiresAt,
    contextRelation: decision.contextRelation, nextCondition: decision.nextCondition,
    payoff: payoff && plan ? {
      basis: "least-favorable permitted entry to the first target-zone boundary or nearest opposing obstacle, against the fixed hard stop; gross R",
      leastFavorableEntry: plan.side === "long" ? plan.priceZones!.entry.upper : plan.priceZones!.entry.lower,
      hardStop: plan.stop, firstTargetBoundary: globalTargetReference(report, 0), nearestObstacle: plan.barriers[0]?.price ?? globalTargetReference(report, 0),
      requiredNearestObstacleR, ...payoff,
    } : null,
    interpretation: "Scenario confirmation describes event progress only. qualified=false or currentAction=WAIT is not an eligible entry, even when the scenario is confirmed_awaiting_fill. No field establishes a venue fill or order authorization.",
  };
}
/** Summarize before serialization: full candle arrays must not push the
 * selected private record or exact deterministic prices out of the prompt. */
export function terminalAiContext(input: { snapshot: TerminalMarketSnapshot; report: GlobalReport; setupVersionId?: string; inspection?: TerminalToolInspection; inspectionEvidence?: TerminalInspectionEvidence; selected: { watch?: TerminalWatch; radar?: TerminalRadar; position?: TerminalPosition }; exposure: TerminalPosition[] }) {
  const { snapshot, report, selected } = input, plan = report.discretionaryPlan, value = snapshot.tools.value, profile = value.orderFlow?.profile;
  const selectedSetupEligibility = terminalSetupEligibility(report), currentEligibility = report === snapshot.report ? selectedSetupEligibility : terminalSetupEligibility(snapshot.report);
  const flow = (source: unknown) => ({ ...pick(source, [...proofKeys, "marketType", "buy", "sell", "delta"]), points: tail(object(source).points, 12).map(point => pick(point, ["ts", "buy", "sell", "delta", "cvd"])) });
  const position = (source: TerminalPosition | undefined) => source ? { ...pick(source, ["id", "instId", "timeframe", "side", "instrumentType", "venue", "quantity", "quantityUnit", "pnlCurrency", "averageEntry", "realizedPnl", "hardStop", "targets", "status", "protectionStatus", "lastMark"]), events: source.events.slice(-8).map(event => pick(event, ["kind", "quantity", "price", "executedAt", "hardStop", "targets", "provenance"])) } : undefined;
  const context = {
    observedAt: snapshot.observedAt, setupObservedAt: report.snapshot.observedAt, setupVersionId: input.setupVersionId ?? report.scenario?.revisionId,
    market: pick(report.snapshot, ["source", "instId", "timeframe", "priceCurrency", "price", "lastCandleTs"]), currentQuote: snapshot.report.currentMarket?.quote,
    setup: plan ? pick(plan, ["family", "side", "entry", "stop", "priceZones", "executionPolicy", "evidence", "entryBasis", "stopBasis", "targets", "barriers", "reference"]) : null,
    selectedSetupEligibility, currentEligibility,
    selectedInspection: input.inspection ? terminalSelectedInspection(input.inspectionEvidence ?? snapshot, input.inspection) : undefined,
    selectedSetupMatchesCurrentSnapshot: report.snapshot.observedAt === snapshot.report.snapshot.observedAt && report.scenario?.revisionId === snapshot.report.scenario?.revisionId,
    scenario: report.scenario ? scenario(report.scenario) : null, currentScenario: snapshot.report.scenario ? scenario(snapshot.report.scenario) : null,
    selected: {
      watch: selected.watch ? { ...pick(selected.watch, ["id", "instId", "timeframe", "setupVersionId", "state", "reason", "nextEvent", "createdAt", "expiresAt"]), scenario: scenario(selected.watch.scenario) } : undefined,
      radar: selected.radar ? { ...pick(selected.radar, ["id", "instId", "timeframe", "detector", "boundary", "state", "reason", "nextEvent", "createdAt", "expiresAt"]), definition: selected.radar.definition, sequence: { ...pick(selected.radar.snapshot, ["status", "stage", "next", "updatedAt"]), events: tail(object(selected.radar.snapshot).events, 12).map(event => pick(event, ["kind", "at", "price", "reason", "source"])) } } : undefined,
      position: position(selected.position),
    },
    exposure: input.exposure.slice(0, 12).map(source => pick(source, ["id", "instId", "side", "quantity", "averageEntry", "hardStop", "instrumentType", "protectionStatus"])),
    exposureCoverage: { recordedOpenPositions: input.exposure.length, suppliedRecords: Math.min(12, input.exposure.length), selectedRecordSuppliedSeparately: Boolean(selected.position) },
    sources: snapshot.sources.map(source => pick(source, proofKeys)),
    tools: {
      value: { ...pick(value, [...proofKeys, "tradeVwap", "sigma", "bands"]), profile: profile ? { ...pick(profile, ["start", "end", "knownAt", "rowSize", "poc", "val", "vah", "buy", "sell", "volume", "delta", "trades"]), highestVolumeRows: priceRows(profile.rows) } : null,
        footprints: (value.orderFlow?.footprints ?? []).slice(-2).map(bar => ({ ...pick(bar, ["start", "end", "knownAt", "open", "high", "low", "close", "buy", "sell", "volume", "delta"]), highestVolumeRows: priceRows(bar.rows) })) },
      flow: flow(snapshot.tools.flow), perpetualFlow: flow(snapshot.tools.perpetualFlow),
      derivatives: pick(snapshot.tools.derivatives, [...proofKeys, "instrumentId", "markPrice", "markPriceAt", "openInterest", "openInterestAt", "openInterestUsd", "fundingRate", "fundingTime", "fundingObservedAt", "fundingKind"]),
      liquidity: { ...pick(snapshot.tools.liquidity, [...proofKeys, "note"]), bids: snapshot.tools.liquidity.bids?.slice(0, 8), asks: snapshot.tools.liquidity.asks?.slice(0, 8) },
    },
    higherContext: { ...pick(report.context, ["timeframe", "status", "source", "agreement"]), sma55: tail(report.context.sma55, 16).map(point => pick(point, ["ts", "value"])), candles: report.context.candles.slice(-16).map(candle => pick(candle, candleKeys)) },
    evidenceLimits: "Summarized source windows only. Missing depth/flow/history and user-reported protection do not prove executions. Prices and policy remain deterministic.",
  };
  if (JSON.stringify(context).length > 55_000) throw new Error("Terminal evidence exceeds the bounded AI context; refresh the selected evidence before asking again");
  return context;
}
