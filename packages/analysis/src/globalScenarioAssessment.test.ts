import assert from "node:assert/strict";
import test from "node:test";
import { candleCloseTime, type GlobalCandle, type GlobalReport, type GlobalScenarioEvent } from "@pulse/schemas";
import type { SpotMarketContext } from "@pulse/market";
import { assessGlobalEntryReport } from "./globalEntryAssessment.js";
import { assessGlobalReport } from "./globalAssessment.js";
import { advanceGlobalScenario, globalScenarioDefinitionForReport, newGlobalScenario } from "./globalScenarioLifecycle.js";

const MIN = 60_000, BORN = Date.UTC(2026, 9, 30, 12), AT = BORN + 20 * MIN;
const candle = (ts: number, close = 103, low = 102, high = 104): GlobalCandle => ({ ts, open: close, high, low, close, volume: 1, confirmed: true });
function fixture(mode: "passive_limit" | "confirmed_retest" = "passive_limit", side: "long" | "short" = "long") {
  const quote = side === "long" ? 100 : 102;
  const primary = Array.from({ length: 56 }, (_, i) => candle(BORN - (55 - i) * 15 * MIN));
  const eventBars = Array.from({ length: 59 }, (_, i) => candle(BORN - (55 - i) * 5 * MIN));
  const contextBars = Array.from({ length: 55 }, (_, i) => candle(BORN - (55 - i) * 60 * MIN));
  const market = (bar: string, candles: GlobalCandle[]) => ({ source: "okx-public-spot", instId: "BTC-USDT", bar, fetchedAt: new Date(AT).toISOString(), ticker: { last: quote, priceCurrency: "USDT", ts: String(AT - 1000) }, candles }) as unknown as SpotMarketContext;
  const report = {
    version: "pulse-global-v1", decisionVersion: "decision-v5", lang: "en", tier: "pro", levels: [],
    snapshot: { source: "okx-public-spot", instId: "BTC-USDT", timeframe: "15m", priceCurrency: "USDT", observedAt: new Date(BORN).toISOString(), lastCandleTs: BORN - 15 * MIN, price: 103, pricePrecision: 2 },
    candles: structuredClone(primary.filter(c => candleCloseTime(c.ts, "15m")! <= BORN)),
    entryStudy: { status: "available", timeframe: "5m", source: "okx-public-spot", observedAt: new Date(BORN).toISOString(), candles: structuredClone(eventBars.filter(c => candleCloseTime(c.ts, "5m")! <= BORN)), pivots: [], atr: [] },
    indicators: { atr: { period: 14, points: [] }, pivots: [] },
    context: { timeframe: "1H", status: "available", agreement: "neutral", candles: contextBars, sma55: [] },
    hierarchy: [],
    discretionaryPlan: {
      version: "discretionary-plan-v8", side, family: "level_retest", objectiveTimeframe: "15m", entry: side === "long" ? 101 : 103, stop: side === "long" ? 95 : 108,
      entryBasis: { kind: "structure_zone", price: side === "long" ? 101 : 103, timeframe: "15m", knownAt: BORN - 60 * MIN },
      stopBasis: { price: side === "long" ? 96 : 107, timeframe: "15m", anchorTs: BORN - 90 * MIN, knownAt: BORN - 60 * MIN },
      reference: { timeframe: "5m", candleTs: BORN - 5 * MIN, completedAt: BORN, price: 103 },
      targets: [{ price: side === "long" ? 110 : 90, timeframe: "15m", anchorTs: BORN - 90 * MIN, knownAt: BORN - 60 * MIN, basis: "confirmed_swing" }],
      barriers: [{ price: side === "long" ? 107 : 97, timeframe: "15m", anchorTs: BORN - 90 * MIN, knownAt: BORN - 60 * MIN, basis: "confirmed_swing" }],
      priceZones: { version: "price-zones-v1", entry: { lower: side === "long" ? 99 : 103, upper: side === "long" ? 101 : 105, sourceLower: side === "long" ? 99 : 103, sourceUpper: side === "long" ? 101 : 105, sourcePrice: side === "long" ? 101 : 103 }, stop: { lower: side === "long" ? 95 : 107, upper: side === "long" ? 96 : 108 }, targets: [{ lower: side === "long" ? 110 : 89, upper: side === "long" ? 111 : 90 }], payoffFloor: 1, payoffLimited: false },
      executionPolicy: { version: "execution-policy-v1", id: mode === "passive_limit" ? "structural-zone-passive-v1" : "accepted-breakout-retest-v1", configurationKey: "BTC-USDT:15m:level_retest:v1", family: "level_retest", mode, sourceBoundary: side === "long" ? 101 : 103, eventTimeframe: "5m", eventKnownAt: BORN - 60 * MIN, eventAfter: BORN - 60 * MIN, expiresAt: BORN + 90 * MIN, confirmationBars: 2, fillWindowBars: 3, stopManagement: "structural_fixed", targetAllocations: [1], entryRegion: mode === "passive_limit" ? "source_zone" : "defended_retest" },
    },
  } as unknown as GlobalReport;
  report.scenario = newGlobalScenario(globalScenarioDefinitionForReport(report)!);
  return { report, market: market("15m", primary), entry: market("5m", eventBars), context: market("1H", contextBars) };
}
const event = (kind: GlobalScenarioEvent["kind"], minute: number, targetId?: string): GlobalScenarioEvent => ({ id: `${kind}:${minute}`, kind, at: BORN + minute * MIN, candleTs: BORN + (minute - 5) * MIN, basis: "completed_candle", ...(targetId ? { targetId } : {}) });

test("v8 dispatch keeps passive limit prices and never borrows canonical confirmation", () => {
  const { report, market, entry, context } = fixture(), before = structuredClone(report);
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.state, "waiting_retest"); assert.equal(a.confirmationTs, null); assert.equal(a.permittedEntry, null);
  assert.equal(a.strategyId, "structural-zone-passive-v1"); assert.equal(a.side, "long");
  assert.deepEqual(a.targets, [110]); assert.equal(a.grossRewardRisk, 1.5); assert.equal(a.firstObstacleRewardRisk, 1);
  assert.equal(a.scenario?.definition.hardStop, 95); assert.deepEqual(a.scenario?.definition.entryZone, [99, 101]);
  assert.match(a.lines.join("\n"), /does not borrow later confirmation/); assert.deepEqual(report, before);
  assert.deepEqual(assessGlobalReport(report, market, context, entry), a);
});

test("a causal confirmed retest can be reviewed only at the original bounded Entry", () => {
  const { report, market, entry, context } = fixture("confirmed_retest");
  Object.assign(entry.candles.find(c => c.ts === BORN + 5 * MIN)!, { low: 100, high: 103, open: 102, close: 102 });
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.state, "technical_valid"); assert.equal(a.confirmationTs, BORN + 10 * MIN);
  assert.equal(a.retestTs, BORN + 5 * MIN); assert.deepEqual(a.permittedEntry, [99, 101]); assert.equal(a.observedStop, 95);
  assert.equal(a.scenario?.state, "confirmed_awaiting_fill"); assert.match(a.lines.join("\n"), /close is not a fill/);
  market.ticker.last = 106;
  const outside = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(outside.state, "waiting_retest"); assert.equal(outside.permittedEntry, null); assert.equal(outside.side, "long");
  assert.deepEqual(outside.scenario?.definition, a.scenario?.definition);
});

test("a later observed entry is a price observation and cannot be advertised twice", () => {
  const { report, market, entry, context } = fixture();
  Object.assign(entry.candles.find(c => c.ts === BORN)!, { low: 100 });
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.scenario?.state, "entry_observed"); assert.equal(a.state, "no_trade");
  assert.ok(a.blockers.includes("entry_already_observed")); assert.equal(a.permittedEntry, null);
  assert.equal(a.scenario?.observationOnly, true); assert.match(a.lines.join("\n"), /not an exchange fill or realized PnL/);
});

for (const ending of ["target", "invalidated", "expired", "completed"] as const) test(`persisted ${ending} scenario cannot revive after a quote returns`, () => {
  const { report, market, entry, context } = fixture(), initial = report.scenario!;
  report.scenario = ending === "target" ? advanceGlobalScenario(initial.definition, initial, [event("target_touch", 5, "tp1")], BORN + 5 * MIN)
    : ending === "invalidated" ? advanceGlobalScenario(initial.definition, initial, [event("invalidation", 5)], BORN + 5 * MIN)
      : ending === "expired" ? advanceGlobalScenario(initial.definition, initial, [], BORN + 100 * MIN)
        : advanceGlobalScenario(initial.definition, initial, [event("entry_touch", 5), event("target_touch", 10, "tp1")], BORN + 10 * MIN);
  if (ending === "expired") { market.fetchedAt = new Date(BORN + 100 * MIN).toISOString(); market.ticker.ts = String(BORN + 100 * MIN - 1000); }
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.state, ending === "completed" ? "no_trade" : ending === "expired" ? "expired" : "invalidated");
  assert.equal(a.permittedEntry, null); assert.equal(a.side, "long");
  if (ending === "target") assert.equal(a.scenario?.reason, "target_before_entry");
});

test("confirmation survives another recheck without restarting the setup or fill clocks", () => {
  const { report, market, entry, context } = fixture("confirmed_retest"), initial = report.scenario!;
  report.scenario = advanceGlobalScenario(initial.definition, initial, [event("confirmation", 5)], BORN + 6 * MIN);
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.confirmationTs, BORN + 5 * MIN); assert.equal(a.retestDeadline, BORN + 20 * MIN);
  assert.equal(a.expiresAt, BORN + 20 * MIN); assert.equal(a.scenario?.expiresAt, BORN + 90 * MIN); assert.equal(a.scenario?.startedAt, BORN);
  assert.match(a.lines.join("\n"), /Entry deadline: .*12:20:00.*overall setup expiry: .*13:30:00/);
  assert.equal(a.scenario?.events.filter(e => e.kind === "confirmation").length, 1);
});

test("unknown or revised source history cannot advance the persisted replay cursor", () => {
  for (const problem of ["gap", "revision", "entry_identity", "future_entry"] as const) {
    const { report, market, entry, context } = fixture("confirmed_retest");
    if (problem === "gap") entry.candles = entry.candles.filter(c => c.ts !== BORN + 5 * MIN);
    if (problem === "revision") entry.candles.find(c => c.ts === BORN - 5 * MIN)!.high += 1;
    if (problem === "entry_identity") entry.instId = "ETH-USDT";
    if (problem === "future_entry") entry.fetchedAt = new Date(AT + MIN).toISOString();
    const a = assessGlobalEntryReport(report, market, context, entry);
    assert.equal(a.state, "no_trade", problem); assert.equal(a.scenario, undefined, problem);
    assert.ok(a.blockers.includes(problem === "revision" ? "source_revised" : "history"), problem);
    assert.equal(report.scenario!.updatedAt, BORN);
  }
});

test("current quote freshness and context are checked without changing saved side or risk", () => {
  for (const problem of ["quote", "future_quote", "context"] as const) {
    const { report, market, entry, context } = fixture("confirmed_retest"), initial = report.scenario!;
    report.scenario = advanceGlobalScenario(initial.definition, initial, [event("confirmation", 10)], BORN + 11 * MIN);
    if (problem === "quote") market.ticker.ts = String(AT - 120 * MIN);
    if (problem === "future_quote") market.ticker.ts = String(AT + MIN);
    if (problem === "context") context.instId = "ETH-USDT";
    const a = assessGlobalEntryReport(report, market, context, entry);
    assert.equal(a.state, "no_trade"); assert.equal(a.permittedEntry, null); assert.equal(a.side, "long");
    assert.ok(a.blockers.includes(problem === "context" ? "context" : "quote"));
    assert.equal(a.scenario?.definition.hardStop, 95); assert.deepEqual(a.targets, [110]);
  }
});

test("bounded exchange-clock skew remains usable, while a future quote cannot authorize entry", () => {
  const { report, market, entry, context } = fixture("confirmed_retest"), initial = report.scenario!;
  report.scenario = advanceGlobalScenario(initial.definition, initial, [event("confirmation", 10)], BORN + 11 * MIN);
  for (const skew of [500, 5_000, 5_001]) {
    market.ticker.ts = String(AT + skew);
    const a = assessGlobalEntryReport(report, market, context, entry);
    assert.equal(a.state, skew <= 5_000 ? "technical_valid" : "no_trade");
    assert.equal(a.blockers.includes("quote"), skew > 5_000);
  }
});

test("a confirmed plan expires at its fill deadline even with a fresh quote and longer setup TTL", () => {
  const { report, market, entry, context } = fixture("confirmed_retest"), initial = report.scenario!;
  report.scenario = advanceGlobalScenario(initial.definition, initial, [event("confirmation", 1)], BORN + 2 * MIN);
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.expiresAt, BORN + 16 * MIN);
  assert.equal(a.scenario?.expiresAt, BORN + 90 * MIN);
  assert.equal(a.state, "expired"); assert.equal(a.permittedEntry, null);
  assert.ok(a.blockers.includes("confirmation_fill_deadline"));
});

test("completed primary invalidation is replayed against the saved premise", () => {
  const { report, market, entry, context } = fixture();
  Object.assign(market.candles.find(c => c.ts === BORN)!, { open: 103, high: 104, low: 95, close: 95.5 });
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.state, "invalidated"); assert.equal(a.scenario?.reason, "premise_failed_before_entry");
  assert.equal(a.scenario?.definition.stopBasis.price, 96); assert.equal(a.scenario?.definition.hardStop, 95);
});

test("confirmed price events inside genuine primary opposition do not authorize entry", () => {
  const { report, market, entry, context } = fixture("confirmed_retest"), initial = report.scenario!;
  report.scenario = advanceGlobalScenario(initial.definition, initial, [event("confirmation", 10)], BORN + 11 * MIN);
  report.horizonContext = { version: "horizon-context-v1", timeframe: "15m", knownAt: BORN - 60 * MIN, reading: "session", zones: [{ id: "opposition", role: "resistance", lower: 100, upper: 102, startTs: BORN - 120 * MIN, knownAt: BORN - 60 * MIN, anchorIds: ["r"], basis: "confirmed_pivot_wicks" }], ranges: [] };
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.scenario?.state, "confirmed_awaiting_fill"); assert.equal(a.state, "no_trade");
  assert.equal(a.firstObstacleRewardRisk, 0); assert.equal(a.permittedEntry, null);
  assert.ok(a.blockers.includes("opposing_zone_overlap")); assert.match(a.lines.join("\n"), /does not prove acceptance/);
});

test("observed confirmation cannot authorize a setup below its saved nearest-obstacle floor", () => {
  const { report, market, entry, context } = fixture("confirmed_retest"), initial = report.scenario!;
  report.scenario = advanceGlobalScenario(initial.definition, initial, [event("confirmation", 10)], BORN + 11 * MIN);
  report.discretionaryPlan!.barriers.unshift({ ...report.discretionaryPlan!.barriers[0], price: 109 });
  report.discretionaryPlan!.barriers.push({...report.discretionaryPlan!.barriers[0],price:106});
  const before=structuredClone(report.discretionaryPlan);
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.state, "no_trade"); assert.equal(a.firstObstacleRewardRisk, 5 / 6);
  assert.equal(a.blockers.includes("reward"), true); assert.equal(a.grossRewardRisk, 1.5);
  assert.equal(a.permittedEntry,null);assert.equal(a.observedStop,null);assert.deepEqual(report.discretionaryPlan,before);
  assert.match(a.lines.join(" "),/saved policy requires 1\.00R/);
});

test("a new quote beyond the saved first target blocks re-entry instead of borrowing TP2",()=>{
 const {report,market,entry,context}=fixture("confirmed_retest"),initial=report.scenario!;
 report.scenario=advanceGlobalScenario(initial.definition,initial,[event("confirmation",10)],BORN+11*MIN);
 market.ticker.last=110.5;const before=structuredClone(report);
 const a=assessGlobalEntryReport(report,market,context,entry);
 assert.equal(a.state,"no_trade");assert.ok(a.blockers.includes("objective_already_reached"));assert.equal(a.permittedEntry,null);assert.deepEqual(a.targets,[110]);assert.deepEqual(report,before);
});

test("short rechecks use the facing target boundary and their own protection", () => {
  const { report, market, entry, context } = fixture("passive_limit", "short");
  for (const c of entry.candles) { c.high = 102.5; c.low = 100; c.open = c.close = 102; }
  report.entryStudy!.candles = entry.candles.filter(c => candleCloseTime(c.ts, "5m")! <= BORN).map(c => ({ ...c, confirmed: c.confirmed === true }));
  const a = assessGlobalEntryReport(report, market, context, entry);
  assert.equal(a.side, "short"); assert.equal(a.state, "waiting_retest"); assert.deepEqual(a.targets, [90]);
  assert.equal(a.grossRewardRisk, (103 - 90) / (108 - 103)); assert.equal(a.scenario?.definition.hardStop, 108);
});

test("v8 recheck rejects mismatched primary identity and an earlier observation time", () => {
  const { report, market, entry, context } = fixture();
  market.instId = "ETH-USDT"; assert.throws(() => assessGlobalEntryReport(report, market, context, entry), /identity/);
  market.instId = "BTC-USDT"; market.fetchedAt = new Date(BORN - MIN).toISOString();
  assert.throws(() => assessGlobalEntryReport(report, market, context, entry), /predates/);
});
