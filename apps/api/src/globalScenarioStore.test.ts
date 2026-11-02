import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGlobalScenarioDefinition } from "@pulse/analysis";
import { globalContextTimeframe, prepareGlobalReport } from "@pulse/analysis";
import { GlobalAssessmentSchema, GlobalReportSchema, type GlobalReport, type GlobalScenarioEvent } from "@pulse/schemas";
import { createGlobalScenarioStore, globalScenarioStorageKey, globalScenarioStore, MemoryGlobalScenarioStorage, RedisGlobalScenarioStorage, reconcileGlobalScenarioAssessment, type GlobalScenarioRecord } from "./globalScenarioStore.js";

const MIN = 60_000, BORN = 60 * MIN;
const scope = { ownerWallet: "0x1111111111111111111111111111111111111111", networkKey: "arbitrum" };
const definition = () => createGlobalScenarioDefinition({
  market: "okx:BTC-USDT", timeframe: "1H", family: "level_retest", side: "long", policyId: "structural-zone-passive-v1", configurationKey: "BTC:1H:v1",
  sourceKey: "support:1H:0", sourceKnownAt: 2 * MIN, sourceTimeframe: "1H", sourceLower: 99, sourceUpper: 101, sourcePrice: 101,
  stopBasis: { price: 96, timeframe: "1H", anchorTs: 0, knownAt: 2 * MIN }, createdAt: BORN,
  mode: "passive_limit", entryZone: [99, 101], hardStop: 95, targets: [{ id: "tp1", lower: 110, upper: 111, allocation: 1 }],
  sourceBoundary: 101, eventTimeframe: "5m", eventAfter: 2 * MIN, eventKnownAt: 2 * MIN, expiresAt: BORN + 60 * MIN,
  confirmationMaxAgeMs: 20 * MIN, fillWindowMs: 15 * MIN, confirmationBars: 1,
});
const event = (kind: GlobalScenarioEvent["kind"], minute: number, targetId?: string): GlobalScenarioEvent => ({
  id: `${kind}:${minute}`, kind, at: BORN + minute * MIN, candleTs: BORN + (minute - 5) * MIN, basis: "completed_candle", ...(targetId ? { targetId } : {}),
});
const report = (minute = 0) => ({
  snapshot: { instId: "BTC-USDT", source: "okx", timeframe: "1H", observedAt: new Date(BORN + minute * MIN).toISOString() },
  candles: [{ ts: 0, open: 100, high: 105, low: 96, close: 103, volume: 1, confirmed: true }],
  indicators: { pivots: [] },
  entryStudy: { status: "available", timeframe: "5m", pivots: [], candles: minute ? [{ ts: BORN + (minute - 5) * MIN, open: 102, high: 104, low: 100, close: 102, volume: 1, confirmed: true }] : [] },
  discretionaryPlan: {
    version: "discretionary-plan-v8", family: "level_retest", objectiveTimeframe: "1H", side: "long", entry: 101, stop: 95,
    reference: { timeframe: "5m", candleTs: BORN - 5 * MIN, completedAt: BORN, price: 103 },
    entryBasis: { kind: "structure_zone", timeframe: "1H", knownAt: 2 * MIN, price: 101 },
    stopBasis: { price: 96, timeframe: "1H", anchorTs: 0, knownAt: 2 * MIN },
    targets: [{ price: 110, timeframe: "1H", anchorTs: 0, knownAt: 2 * MIN, basis: "structure_zone" }], barriers: [],
    priceZones: { version: "price-zones-v1", entry: { lower: 99, upper: 101, sourceLower: 99, sourceUpper: 101, sourcePrice: 101 }, stop: { lower: 95, upper: 96 }, targets: [{ lower: 110, upper: 111 }], payoffFloor: 1, payoffLimited: false },
    executionPolicy: { version: "execution-policy-v1", id: "structural-zone-passive-v1", configurationKey: "BTC:1H:v1", family: "level_retest", mode: "passive_limit", sourceBoundary: 101, eventTimeframe: "5m", eventKnownAt: 2 * MIN, eventAfter: 2 * MIN, expiresAt: BORN + (minute + 60) * MIN, confirmationBars: 1, fillWindowBars: 3, stopManagement: "structural_fixed", targetAllocations: [1], entryRegion: "source_zone" },
  },
} as unknown as GlobalReport);

function preparedDowntrend(primaryBar: number) {
  // Deterministic software fixture, with a stable protective pivot followed by
  // a declining tail. This is not a market report or a performance backtest.
  const epoch = Date.parse("2026-08-01T00:00:00Z"), interval = 4 * 60 * MIN, at = epoch + primaryBar * interval + 12 * MIN;
  const value = (i: number): number => i < 500 ? 400 - i * .1 + Math.sin(i / 9) * 5 : value(499) - (i - 499) * .5;
  const markets = [["5m", 5 * MIN], ["15m", 15 * MIN], ["1H", 60 * MIN], ["4H", interval], ["1Dutc", 24 * 60 * MIN]].map(([bar, duration]) => {
    const ms = Number(duration), lastOpen = Math.floor(at / ms) * ms - ms;
    return { bar: String(bar), instId: "BTC-USDT", source: "okx-public-spot", fetchedAt: new Date(at).toISOString(),
      ticker: { priceCurrency: "USDT", last: value((at - epoch) / interval), ts: String(at - 500) },
      candles: Array.from({ length: 520 }, (_, i) => {
        const ts = lastOpen - (519 - i) * ms, close = value((ts - epoch) / interval);
        return { ts, open: close + .1, high: close + .5, low: close - .5, close, volume: 100, confirmed: true };
      }),
    };
  });
  return prepareGlobalReport({ market: markets.find(m => m.bar === "4H")!, contextMarket: markets.find(m => m.bar === globalContextTimeframe("4H")), hierarchyMarkets: markets, tier: "premium" });
}

describe("owner-scoped Global scenario storage", () => {
  const assessment = () => GlobalAssessmentSchema.parse({version:"pulse-global-assessment-v1",sourceRef:"saved",sourceObservedAt:new Date(BORN).toISOString(),assessedAt:new Date(BORN+10*MIN).toISOString(),instId:"BTC-USDT",timeframe:"1H",priceCurrency:"USDT",state:"technical_valid",side:"long",pathId:null,lastCompletedClose:100,lastCompletedAt:BORN+10*MIN,confirmationTs:BORN+5*MIN,retestTs:BORN,retestDeadline:BORN+20*MIN,expiresAt:BORN+60*MIN,permittedEntry:[99,101],observedStop:95,targets:[110],grossRewardRisk:1.5,stopDistancePercent:6,stopDistanceAtr:1,context:"neutral",blockers:[],lines:[]});
  it("caps owner assessment expiry at the retained confirmation fill deadline", async () => {
    const store=globalScenarioStore(new MemoryGlobalScenarioStorage()),d=createGlobalScenarioDefinition({...definition(),mode:"confirmed_retest"});
    const record=await store.advance(scope,d,[event("confirmation",5)],BORN+10*MIN);
    const incoming=assessment(),before=structuredClone(incoming),merged=reconcileGlobalScenarioAssessment(report(),incoming,record);
    assert.equal(merged.state,"technical_valid");assert.equal(merged.expiresAt,BORN+20*MIN);assert.equal(merged.scenario?.expiresAt,BORN+60*MIN);
    assert.match(merged.lines.join("\n"),/Entry deadline: .*01:20:00.*overall setup expiry: .*02:00:00/);
    assert.deepEqual(incoming,before);GlobalAssessmentSchema.parse(merged);
  });
  it("blocks stale concurrent authorization without importing the newer ledger's events", async () => {
    const store=globalScenarioStore(new MemoryGlobalScenarioStorage()),d=definition();
    const record=await store.advance(scope,d,[event("invalidation",15)],BORN+15*MIN);
    const incoming=assessment(),merged=reconcileGlobalScenarioAssessment(report(),incoming,record);
    assert.equal(merged.state,"no_trade");assert.equal(merged.permittedEntry,null);assert.equal(merged.observedStop,null);
    assert.equal(merged.scenario,undefined);assert.equal(merged.assessedAt,incoming.assessedAt);assert.equal(merged.expiresAt,BORN+10*MIN);
    assert.ok(merged.blockers.includes("newer_scenario_observation"));assert.match(merged.lines[0],/newer scenario observation/);
    GlobalAssessmentSchema.parse(merged);
  });
  it("isolates wallet, network and deployment namespace with opaque keys", async () => {
    const id = definition().scenarioId;
    const key = globalScenarioStorageKey("pulse:production", scope, id);
    assert.ok(!key.includes(scope.ownerWallet));
    assert.notEqual(key, globalScenarioStorageKey("pulse:production", { ...scope, networkKey: "base" }, id));
    assert.notEqual(key, globalScenarioStorageKey("pulse:local", scope, id));
    assert.notEqual(key, globalScenarioStorageKey("pulse:production", { ...scope, ownerWallet: "someone-else" }, id));
    assert.equal(key, globalScenarioStorageKey("pulse:production", { ...scope, ownerWallet: scope.ownerWallet.toUpperCase() }, id));
    assert.throws(() => globalScenarioStorageKey("pulse", scope, "*:global-scenario:*"));
    const store = globalScenarioStore(new MemoryGlobalScenarioStorage());
    await store.advance(scope, definition(), [], BORN);
    assert.equal(await store.get({ ...scope, networkKey: "base" }, id), null);
  });
  it("atomically merges concurrent complete observations without duplicate exits", async () => {
    const store = globalScenarioStore(new MemoryGlobalScenarioStorage()), d = definition();
    await Promise.all([
      store.advance(scope, d, [event("entry_touch", 5)], BORN + 5 * MIN),
      store.advance(scope, d, [event("entry_touch", 5), event("target_touch", 10, "tp1")], BORN + 10 * MIN),
    ]);
    const record = await store.get(scope, d.scenarioId);
    assert.equal(record?.snapshot.outcome?.kind, "target_observed"); assert.equal(record?.snapshot.exits.length, 1);
    assert.equal(record?.snapshot.updatedAt, BORN + 10 * MIN);
  });
  it("keeps the first priced contract and event clock when report prices drift", async () => {
    const store = globalScenarioStore(new MemoryGlobalScenarioStorage()), original = report();
    await store.applyToReport(scope, original);
    const first = original.scenario!, next = report(10);
    next.discretionaryPlan!.entry = 100.5; next.discretionaryPlan!.stop = 94;
    next.discretionaryPlan!.priceZones!.entry.upper = 100.5;
    await store.applyToReport(scope, next);
    assert.equal(next.discretionaryPlan!.entry, 101); assert.equal(next.discretionaryPlan!.stop, 95);
    assert.equal(next.scenario?.scenarioId, first.scenarioId); assert.equal(next.scenario?.revisionId, first.revisionId);
    assert.equal(next.scenario?.startedAt, BORN); assert.equal(next.scenario?.expiresAt, BORN + 60 * MIN);
    assert.equal(next.scenario?.state, "entry_observed");
  });
  it("does not import future persisted events into an earlier concurrent report", async () => {
    const store = globalScenarioStore(new MemoryGlobalScenarioStorage()), original = report();
    await store.applyToReport(scope, original);
    const later = report(10); await store.applyToReport(scope, later);
    const earlier = report(5); await store.applyToReport(scope, earlier);
    assert.ok(earlier.scenario!.events.every(e => e.at <= BORN + 5 * MIN));
    assert.equal(earlier.scenario!.updatedAt, BORN + 5 * MIN);
    assert.equal((await store.get(scope, original.scenario!.scenarioId))!.snapshot.updatedAt, BORN + 10 * MIN);
  });
  it("restores terminal state instead of creating a fresh trade from a repeated request", async () => {
    const store = globalScenarioStore(new MemoryGlobalScenarioStorage()), first = report();
    await store.applyToReport(scope, first);
    const expired = report(65); await store.applyToReport(scope, expired);
    assert.equal(expired.scenario!.state, "expired");
    const again = report(70); await store.applyToReport(scope, again);
    assert.equal(again.scenario!.state, "expired"); assert.equal(again.scenario!.expiresAt, BORN + 60 * MIN);
  });
  it("fails closed on corrupted history and refuses silent price-rule replacement", async () => {
    const storage = new MemoryGlobalScenarioStorage(), store = globalScenarioStore(storage), d = definition();
    await store.advance(scope, d, [], BORN);
    const changed = createGlobalScenarioDefinition({ ...d, hardStop: 94 });
    await assert.rejects(store.advance(scope, changed, [], BORN + MIN), /stored priced revision/);
    const corrupted = globalScenarioStore({ read: async () => ({ version: "bad" } as unknown as GlobalScenarioRecord), compareAndSet: async () => true });
    await assert.rejects(corrupted.get(scope, d.scenarioId), /refusing to reset/);
  });
  it("uses Redis CAS without rewriting JSON through Lua cjson", async () => {
    const calls: unknown[][] = [];
    const storage = new RedisGlobalScenarioStorage({ get: async () => null, eval: async (...args: unknown[]) => { calls.push(args); return 1 as never; } });
    const store = globalScenarioStore(storage, { namespace: "pulse:local", retentionSeconds: 600 });
    await store.advance(scope, definition(), [], BORN);
    const [script, keys, args] = calls[0] as [string, string[], string[]];
    assert.match(script, /revision ~= tonumber/); assert.doesNotMatch(script, /cjson.encode/);
    assert.equal(keys.length, 1); assert.equal(args[0], "0");
    assert.equal(JSON.parse(args[1]).snapshot.observationOnly, true); assert.ok(Number(args[2]) >= 600);
  });
  it("supports deterministic memory operation without external credentials", async () => {
    const store = createGlobalScenarioStore({ QUEUE_PROVIDER: "memory", KV_REST_API_URL: "", KV_REST_API_TOKEN: "", REPORT_RETENTION_DAYS: 180, PERSISTENCE_NAMESPACE: "pulse:test" });
    assert.equal((await store.advance(scope, definition(), [], BORN)).snapshot.observationOnly, true);
  });
  it("keeps a real prepared report schema-valid across a completed 4H source refresh", async () => {
    const store = globalScenarioStore(new MemoryGlobalScenarioStorage());
    const before = preparedDowntrend(520);
    const after = preparedDowntrend(521);
    await store.applyToReport(scope, before);
    const original = structuredClone(before.discretionaryPlan!);
    await store.applyToReport(scope, after);
    assert.equal(after.scenario!.scenarioId, before.scenario!.scenarioId, JSON.stringify([before.scenario!.definition, after.scenario!.definition]));
    assert.notDeepEqual(after.indicators.ema, before.indicators.ema, "The newly completed 4H candle changes the live indicator source");
    assert.equal(after.discretionaryPlan!.entry, original.entry); assert.equal(after.discretionaryPlan!.stop, original.stop);
    const parsed = GlobalReportSchema.safeParse(after);
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    const expired = preparedDowntrend(523);
    await store.applyToReport(scope, expired);
    assert.equal(expired.scenario!.state, "expired");
    assert.equal(expired.scenario!.expiresAt, before.scenario!.expiresAt);
    const expiredParsed = GlobalReportSchema.safeParse(expired);
    assert.equal(expiredParsed.success, true, expiredParsed.success ? "" : JSON.stringify(expiredParsed.error.issues));
  });
});
