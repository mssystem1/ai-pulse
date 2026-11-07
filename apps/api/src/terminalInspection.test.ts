import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import { createGlobalScenarioDefinition, newGlobalScenario } from "@pulse/analysis";
import type { TerminalMarketSnapshot } from "@pulse/domain";
import { globalDesignFixture } from "../../../packages/domain/src/globalReport.fixtures.js";
import { createTerminalRoutes } from "./terminalRoutes.js";
import { grantTerminalPass, MemoryTerminalStorage, TerminalStore } from "./terminalStore.js";
import type { TerminalInspectionEvidence } from "./terminalAiContext.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`), other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const OWNER = account.address.toLowerCase(), OTHER = other.address.toLowerCase();
const BORN = Date.parse("2026-11-04T12:00:00Z"), MINUTE = 60_000;

/** Software fixtures only. No live source, payment or trading assertion. */
function marketFixture(now: number, generation: number): TerminalMarketSnapshot {
  const report = globalDesignFixture("pro");
  report.snapshot.instId = "BTC-USDT"; report.snapshot.observedAt = new Date(now).toISOString();
  report.scenario = newGlobalScenario(createGlobalScenarioDefinition({ market: "okx-public-spot:BTC-USDT", timeframe: "1H", family: "level_retest", side: "long", policyId: "structural-zone-passive-v1", configurationKey: "BTC:1H:inspection-test", sourceKey: "fixture-support", sourceKnownAt: BORN - MINUTE, sourceTimeframe: "1H", sourceLower: 99, sourceUpper: 101, sourcePrice: 101, stopBasis: { price: 96, timeframe: "1H", anchorTs: BORN - 2 * MINUTE, knownAt: BORN - MINUTE }, createdAt: BORN, mode: "passive_limit", entryZone: [99, 101], hardStop: 95, targets: [{ id: "tp1", lower: 110, upper: 111, allocation: 1 }], sourceBoundary: 101, eventTimeframe: "15m", eventAfter: BORN - MINUTE, eventKnownAt: BORN - MINUTE, expiresAt: BORN + 120 * MINUTE, confirmationMaxAgeMs: 20 * MINUTE, fillWindowMs: 15 * MINUTE, confirmationBars: 1 }));
  const windowStart = BORN - 90 * MINUTE + generation * 4 * MINUTE, windowEnd = windowStart + 4 * MINUTE;
  const proof = (id: string, source: string) => ({ id, label: id, source, knownAt: now, status: "partial" as const, windowStart, windowEnd, units: "BTC" });
  const row = { low: 100, high: 101, buy: 2, sell: 9, trades: 5 };
  const footprints = Array.from({ length: 4 }, (_, i) => ({ start: windowStart + i * MINUTE, end: windowStart + (i + 1) * MINUTE, knownAt: now, open: 100, high: 101, low: 99, close: 100, buy: 2 + i, sell: 9, volume: 11 + i, delta: i - 7 - generation * 100, rows: [row] }));
  return { version: "terminal-market-v1", instId: "BTC-USDT", timeframe: "1H", observedAt: now, report, observations: [], sources: [], tools: {
    value: { ...proof("value", "fixture-executed-spot"), tradeVwap: 100, sigma: 1, bands: [], orderFlow: { profile: { start: windowStart, end: windowEnd, knownAt: now, rowSize: 1, poc: 100, val: 99, vah: 101, buy: 2, sell: 9, volume: 11, delta: -7, trades: 5, rows: [row] }, footprints } },
    flow: { ...proof("spot-flow", "fixture-executed-spot"), marketType: "spot", buy: 80, sell: 9, delta: 71, points: [{ ts: windowEnd, buy: 80, sell: 9, delta: 71, cvd: 71 }] },
    perpetualFlow: { ...proof("perpetual-flow", "fixture-executed-perpetual"), marketType: "perpetual", buy: generation ? 1_009 : 9, sell: generation ? 10 : 40, delta: generation ? 999 : -31, points: [{ ts: windowEnd, buy: generation ? 1_009 : 9, sell: generation ? 10 : 40, delta: generation ? 999 : -31, cvd: generation ? 999 : -31 }] },
    derivatives: { ...proof("derivatives", "fixture-perpetual-mark"), instrumentId: "BTC-USDT-SWAP", markPrice: 100, markPriceAt: now },
    liquidity: { ...proof("liquidity", "fixture-current-depth"), bids: [], asks: [] },
  } } as unknown as TerminalMarketSnapshot;
}

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

test("tool questions retain the displayed owner-scoped evidence and reject substituted or unavailable windows before quota", async t => {
  let now = BORN, generation = 0, snapshotReads = 0;
  const prompts: Array<{ context: Record<string, any>; question: string }> = [];
  const aiApp = express(); aiApp.use(express.json());
  aiApp.post("/v1/chat/completions", (req, res) => { assert.equal(req.body.model, cfg.GROK_COPILOT_MODEL); assert.equal(req.body.reasoning_effort, cfg.GROK_REASONING_COPILOT); prompts.push(JSON.parse(req.body.messages[1].content)); res.json({ model: req.body.model, choices: [{ message: { content: "Fixture evidence explanation; no trade authorization." } }] }); });
  const ai = await listen(aiApp), storage = new MemoryTerminalStorage(), state = new TerminalStore(storage, `terminal-inspection-${Math.random()}`, 180);
  for (const owner of [OWNER, OTHER]) await state.mutate(owner, value => { grantTerminalPass(value, { requestId: "fixture_pass_request", duration: "24h", priceUsd: "1.5", amountAtomic: "1500000", network: "base", asset: `0x${"33".repeat(20)}`, paymentId: "fixture-pass", purchasedAt: new Date(BORN).toISOString(), simulated: true }); });
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, FEATURE_TRADING_TERMINAL: true, FEATURE_TELEGRAM: false, X402_MOCK: true, QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const, XAI_API_KEY: "local-ai-fixture", XAI_BASE_URL: `${ai.origin}/v1`, PERSISTENCE_NAMESPACE: `inspection-${Math.random()}` };
  const routes = createTerminalRoutes(cfg, { store: state, now: () => now, snapshot: async () => { snapshotReads++; return marketFixture(now, generation); }, telegramRecipient: async () => null });
  const apiApp = express(); apiApp.use(express.json()); apiApp.use(routes.publicRouter); apiApp.use(routes.beforePayment);
  apiApp.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
  const api = await listen(apiApp), base = `${api.origin}/v1/terminal`;
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const signIn = async (signer: typeof account) => {
    const challenge = await (await post("auth/challenge", { wallet: signer.address })).json() as { challengeId: string; message: string };
    const response = await post("auth/verify", { challengeId: challenge.challengeId, signature: await signer.signMessage({ message: challenge.message }) });
    assert.equal(response.status, 200); return (await response.json() as { token: string }).token;
  };
  const market = async (token: string) => {
    const response = await fetch(`${base}/market?instId=BTC-USDT&timeframe=1H`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); return await response.json() as TerminalMarketSnapshot & { evidenceSnapshotId: string; setupVersionId: string };
  };
  try {
    const token = await signIn(account), otherToken = await signIn(other), first = await market(token);
    assert.match(first.evidenceSnapshotId, /^tes_[\da-f]{32}$/); assert.match(first.setupVersionId, /^gsr_[\da-f]{32}$/);
    const evidenceKey = state.key("evidence", `${OWNER}:${first.evidenceSnapshotId}`), retained = await storage.read<TerminalInspectionEvidence>(evidenceKey);
    assert.ok(retained); assert.equal("report" in retained, false, "Retained tool evidence does not duplicate a full priced report");
    assert.equal(retained.setupVersionId, first.setupVersionId); assert.equal(retained.tools.perpetualFlow?.delta, -31);
    now += 20_000; generation = 1;
    const current = await market(token);
    assert.equal(current.setupVersionId, first.setupVersionId, "Polling source data does not mint a new priced setup");
    assert.notEqual(current.evidenceSnapshotId, first.evidenceSnapshotId, "A changed displayed source window gets a distinct immutable identity");
    assert.deepEqual(await storage.read(evidenceKey), retained, "A new poll cannot overwrite the old tool evidence");
    const common = { instId: "BTC-USDT", timeframe: "1H", question: "Explain the selected source evidence", setupVersionId: first.setupVersionId };
    await t.test("a perpetual-flow question uses the originally displayed stream and values after another poll", async () => {
      const response = await post("ask", { ...common, evidenceSnapshotId: first.evidenceSnapshotId, inspection: { tool: "flow", stream: "perpetual" } }, token);
      assert.equal(response.status, 200); const context = prompts.at(-1)!.context, selected = context.selectedInspection;
      assert.equal(selected.stream, "perpetual"); assert.equal(selected.values.marketType, "perpetual"); assert.equal(selected.values.delta, -31);
      assert.equal(selected.values.points[0].delta, -31); assert.equal(selected.observedAt, first.observedAt); assert.equal(selected.source.originalSourceId, "perpetual-flow");
      assert.equal(context.tools.perpetualFlow.delta, 999, "Newer market data remains separately named rather than replacing the selected evidence");
      assert.equal(context.tools.flow.delta, 71); assert.notEqual(selected.values.delta, context.tools.flow.delta);
      const answer = await response.json() as { sources: Array<{ id: string; knownAt: number }> };
      assert.equal(answer.sources.find(source => source.id === "selected-inspection")?.knownAt, first.observedAt);
    });
    await t.test("an older selected completed footprint survives outside the newest two buckets and latest poll", async () => {
      const bucket = first.tools.value.orderFlow!.footprints[0];
      assert.equal(current.tools.value.orderFlow!.footprints.some(item => item.start === bucket.start), false);
      const response = await post("ask", { ...common, evidenceSnapshotId: first.evidenceSnapshotId, inspection: { tool: "footprint", footprintStart: bucket.start } }, token);
      assert.equal(response.status, 200); const selected = prompts.at(-1)!.context.selectedInspection;
      assert.equal(selected.windowKind, "completed-footprint"); assert.equal(selected.values.start, bucket.start); assert.equal(selected.values.delta, bucket.delta);
      assert.equal(selected.source.knownAt, first.observedAt); assert.equal(selected.observedAt, first.observedAt);
    });
    const rejected = async (body: unknown, expectedCode: string, ownerToken = token) => {
      const before = await state.get(ownerToken === token ? OWNER : OTHER), calls = prompts.length, reads = snapshotReads;
      const response = await post("ask", body, ownerToken), error = await response.json() as { code: string };
      assert.equal(response.status, 409); assert.equal(error.code, expectedCode); assert.equal(prompts.length, calls, "Rejected selection cannot call AI");
      assert.deepEqual((await state.get(ownerToken === token ? OWNER : OTHER)).aiUsage, before.aiUsage, "Rejected selection cannot consume AI quota");
      return { readsBefore: reads, readsAfter: snapshotReads };
    };
    await t.test("missing, absent and another owner's evidence IDs fail before source reads or quota", async () => {
      for (const body of [{ ...common, inspection: { tool: "flow", stream: "perpetual" } }, { ...common, evidenceSnapshotId: `tes_${"0".repeat(32)}`, inspection: { tool: "flow", stream: "perpetual" } }]) {
        const counters = await rejected(body, "evidenceSnapshotId" in body ? "terminal_inspection_evidence_unavailable" : "terminal_inspection_evidence_required"); assert.equal(counters.readsAfter, counters.readsBefore);
      }
      const counters = await rejected({ ...common, evidenceSnapshotId: first.evidenceSnapshotId, inspection: { tool: "flow", stream: "perpetual" } }, "terminal_inspection_evidence_unavailable", otherToken); assert.equal(counters.readsAfter, counters.readsBefore);
    });
    await t.test("market, timeframe and priced-version mismatches cannot substitute current evidence", async () => {
      for (const change of [{ instId: "ETH-USDT" }, { timeframe: "4H" }, { setupVersionId: `gsr_${"f".repeat(32)}` }]) {
        const counters = await rejected({ ...common, ...change, evidenceSnapshotId: first.evidenceSnapshotId, inspection: { tool: "value" } }, "terminal_inspection_evidence_unavailable"); assert.equal(counters.readsAfter, counters.readsBefore);
      }
    });
    await t.test("an unavailable exact footprint fails instead of explaining a newer bucket", async () => {
      await rejected({ ...common, evidenceSnapshotId: first.evidenceSnapshotId, inspection: { tool: "footprint", footprintStart: BORN - 24 * 60 * MINUTE } }, "terminal_inspection_bucket_unavailable");
    });
    await t.test("tampered and expired retained evidence fails without consuming AI quota", async () => {
      const tampered = structuredClone(retained); tampered.tools.perpetualFlow!.delta = 123_456;
      await storage.write(evidenceKey, tampered, 3600);
      await rejected({ ...common, evidenceSnapshotId: first.evidenceSnapshotId, inspection: { tool: "flow", stream: "perpetual" } }, "terminal_inspection_evidence_unavailable");
      await storage.write(evidenceKey, retained, 0);
      await rejected({ ...common, evidenceSnapshotId: first.evidenceSnapshotId, inspection: { tool: "flow", stream: "perpetual" } }, "terminal_inspection_evidence_unavailable");
    });
    await t.test("ordinary setup questions remain compatible without a tool inspection token", async () => {
      const response = await post("ask", common, token); assert.equal(response.status, 200);
      assert.equal(prompts.at(-1)!.context.selectedInspection, undefined); assert.equal(prompts.at(-1)!.context.setupVersionId, first.setupVersionId);
    });
  } finally { await close(api.server); await close(ai.server); }
});
