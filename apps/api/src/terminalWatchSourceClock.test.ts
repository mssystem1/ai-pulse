import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig } from "@pulse/config";
import { prepareGlobalReport, advanceGlobalScenario } from "@pulse/analysis";
import { GlobalReportSchema, type GlobalReport } from "@pulse/schemas";
import { summarizeCandles, type SpotMarketContext } from "@pulse/market";
import type { TerminalMarketSnapshot } from "@pulse/domain";
import { TerminalRuntime, terminalImmutableSourceReport } from "./terminalRuntime.js";
import { recheckSavedGlobalReport } from "./globalAssessmentRoutes.js";
import { MemoryTerminalStorage, TerminalStore, grantTerminalPass } from "./terminalStore.js";

function fixture() {
  const raw = JSON.parse(readFileSync(new URL("../../../packages/analysis/src/globalTargets.oct18-fixture.json", import.meta.url), "utf8")) as { observedAt: string; frames: Record<string, number[][]> };
  const at = Date.parse(raw.observedAt);
  const markets = Object.entries(raw.frames).map(([bar, rows]): SpotMarketContext => {
    const candles = rows.map(([ts, open, high, low, close, volume]) => ({ ts, open, high, low, close, volume, volumeCcy: 0, confirmed: true }));
    return { source: "okx-public-spot", instId: "BTC-USDT", bar, candles, fetchedAt: raw.observedAt, summary: summarizeCandles(candles), ticker: { instId: "BTC-USDT", last: 82200, priceCurrency: "USDT", ts: String(at), open24h: 0, high24h: 0, low24h: 0, vol24h: 0, volCcy24h: 0, change24hPct: 0 } };
  });
  const report = prepareGlobalReport({ market: markets.find(m => m.bar === "1Wutc")!, contextMarket: markets.find(m => m.bar === "1Mutc"), hierarchyMarkets: markets, tier: "premium", decisionVersion: "decision-v5", targetPolicy: "active-zones-v1" });
  assert.equal(GlobalReportSchema.safeParse(report).success, true);
  return { at, markets, report };
}

test("weekly follow and immediate worker recheck keep source capture separate from later lifecycle progress", async () => {
  const { at, markets, report } = fixture(), owner = `0x${"11".repeat(20)}`; let now = at;
  const original = JSON.stringify(report), store = new TerminalStore(new MemoryTerminalStorage(), `source-clock-${Math.random()}`, 180);
  const source = { version: "terminal-market-v1", instId: "BTC-USDT", timeframe: "1Wutc", observedAt: at, report, tools: {}, sources: [], observations: [] } as unknown as TerminalMarketSnapshot;
  const runtime = new TerminalRuntime({ ...loadConfig(), NODE_ENV: "test", FEATURE_TELEGRAM: false, FEATURE_TRADING_TERMINAL: true, QUEUE_PROVIDER: "memory", TERMINAL_MONITOR_INTERVAL_MS: 15_000 }, { store, now: () => now, snapshot: async () => source, recheckMarket: async input => {
    const market = markets.find(m => m.bar === input.timeframe)!; assert.ok(market);
    return { ...market, fetchedAt: new Date(now).toISOString(), ticker: { ...market.ticker, ts: String(now) } };
  } });
  const bound = await runtime.bindOwnerSnapshot(owner, source);
  now += 3000; const initial = await runtime.assessOwner(owner, bound.report);
  assert.ok(!initial.blockers.includes("history")); assert.ok(!initial.blockers.includes("quote"));
  await store.mutate(owner, value => { grantTerminalPass(value, { requestId: "source_clock_pass", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "fixture-no-payment", purchasedAt: new Date(now).toISOString(), simulated: true }); });
  await store.storage.write(store.key("setup", `${owner}:${bound.report.scenario!.revisionId}`), bound, 3600);
  now += 3000; await runtime.createWatch(owner, { instId: "BTC-USDT", timeframe: "1Wutc", setupVersionId: bound.report.scenario!.revisionId, telegram: false });
  let watch = (await store.get(owner)).watches[0];
  assert.ok(watch.scenario.updatedAt > Date.parse(bound.report.snapshot.observedAt));
  const saved = await store.loadWatchReport(owner, watch);
  assert.equal(GlobalReportSchema.safeParse(saved).success, true, "New watches retain a valid immutable captured source");
  await runtime.cycleOwner(owner); watch = (await store.get(owner)).watches[0];
  assert.notEqual(watch.state, "data_needed"); assert.equal(watch.sourceIssue, undefined);
  now += 16_000; await runtime.cycleOwner(owner); watch = (await store.get(owner)).watches[0];
  assert.notEqual(watch.state, "data_needed"); assert.equal(watch.scenario.startedAt, bound.report.scenario!.startedAt); assert.equal(watch.scenario.expiresAt, bound.report.scenario!.expiresAt);
  assert.equal(JSON.stringify(report), original); assert.equal((await store.get(owner)).activity.some(event => event.kind === "source_interruption"), false);
});

test("legacy future-lifecycle repair changes only a validated source clone and cannot revive an ended ledger", async () => {
  const { at, markets, report } = fixture(), initial = report.scenario!, laterAt = at + 3000;
  const ended = advanceGlobalScenario(initial.definition, initial, [{ id: "later-stop", kind: "stop_touch", at: at + 1000, basis: "completed_candle", price: initial.definition.hardStop }], laterAt);
  assert.equal(ended.state, "invalidated");
  const legacy = structuredClone(report); legacy.scenario = ended;
  assert.equal(GlobalReportSchema.safeParse(legacy).success, false, "This is the exact pre-fix serialization defect");
  const bytes = JSON.stringify(legacy), repaired = terminalImmutableSourceReport(legacy);
  assert.equal(GlobalReportSchema.safeParse(repaired).success, true); assert.equal(JSON.stringify(legacy), bytes);
  assert.deepEqual(repaired.discretionaryPlan, legacy.discretionaryPlan); assert.deepEqual(repaired.scenario!.definition, ended.definition);
  const load = async (input: { timeframe: string }) => { const market = markets.find(m => m.bar === input.timeframe)!; return { ...market, fetchedAt: new Date(laterAt).toISOString(), ticker: { ...market.ticker, ts: String(laterAt) } }; };
  const assessment = await recheckSavedGlobalReport(repaired, load, { scenario: ended });
  assert.equal(assessment.state, "invalidated"); assert.equal(assessment.scenario!.startedAt, initial.startedAt); assert.equal(assessment.scenario!.expiresAt, initial.expiresAt);
  const changed = structuredClone(ended); changed.definition.hardStop -= 1;
  await assert.rejects(recheckSavedGlobalReport(repaired, load, { scenario: changed }), /match the saved priced scenario/);
  const endedSource = structuredClone(legacy); endedSource.snapshot.observedAt = new Date(laterAt).toISOString();
  for (const frame of endedSource.hierarchy ?? []) frame.observedAt = endedSource.snapshot.observedAt;
  if (endedSource.entryStudy) endedSource.entryStudy.observedAt = endedSource.snapshot.observedAt;
  const endedSourceValidation = GlobalReportSchema.safeParse(endedSource);
  assert.equal(endedSourceValidation.success, true, endedSourceValidation.success ? "" : JSON.stringify(endedSourceValidation.error.issues));
  await assert.rejects(recheckSavedGlobalReport(endedSource, load, { scenario: initial }), /rewind or revive/);
  const bad = structuredClone(legacy); bad.discretionaryPlan!.stop += 1;
  assert.throws(() => terminalImmutableSourceReport(bad), /invalid beyond/);
});
