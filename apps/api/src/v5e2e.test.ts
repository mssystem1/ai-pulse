import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { loadConfig } from "@pulse/config";
import { PolymarketClient, type NormalizedPolymarketMarket } from "@pulse/market";
import { createApp } from "./app.js";
import { MemoryJobStore, MemoryReportStore } from "./jobs.js";
import { ArcBudgetExceededError } from "./arcBudget.js";
import { isArcMarket } from "./arcMarkets.js";

const market: NormalizedPolymarketMarket = Object.freeze({
  id: "pm:e2e-condition", gammaMarketId: "e2e-1", eventIds: Object.freeze(["event-1"]), conditionId: "e2e-condition",
  questionId: "question-1", question: "Will the fixture pass?", description: "Deterministic E2E market", resolutionSource: "Fixture rules",
  slug: "fixture-pass", outcomes: Object.freeze([
    Object.freeze({ name: "Yes", tokenId: "yes-token", referencePrice: .6 }),
    Object.freeze({ name: "No", tokenId: "no-token", referencePrice: .4 }),
  ]), active: true, closed: false, archived: false, restricted: false, enableOrderBook: true, negRisk: false,
  eligibility: "active", endDate: new Date(Date.now() + 86_400_000).toISOString(), updatedAt: new Date().toISOString(),
  liquidityUsd: 100_000, volumeUsd: 50_000, observedAt: new Date().toISOString(),
});

it("rejects a saturated Arc IP before issuing a payment challenge", async () => {
  const cfg = {
    ...loadConfig(), X402_MOCK: true, paymentMode: "mock" as const, ARC_AI_MODE: "live" as const,
    XAI_INPUT_COST_PER_MILLION_USD: 1, XAI_OUTPUT_COST_PER_MILLION_USD: 1,
    FEATURE_ARC_PAYMENTS: true, CIRCLE_GATEWAY_ENABLED: true, FEATURE_PREDICTION_ANALYSIS: true,
    enabledNetworks: ["xlayer", "arc"] as const,
  };
  const app = createApp(cfg, {
    polymarket: fakePolymarket,
    spotInstrumentExists: async () => true,
    persistence: { jobs: new MemoryJobStore(), reports: new MemoryReportStore() },
    arcBudget: { async checkIp() { throw new ArcBudgetExceededError("ip_hourly"); }, async reserve() {} },
  });
  const server = await new Promise<Server>((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/arc/v1/analysis/prediction/standard`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ primaryMarketId: market.id, additionalMarketIds: [], lang: "en" }),
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal((await response.json() as { code?: string }).code, "ip_hourly");
    const spot = await fetch(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/arc/v1/analysis/spot/standard`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instId: "BTC-USDT", timeframe: "1H", lang: "en" }),
    });
    assert.equal(spot.status, 429);
    assert.equal(spot.headers.get("payment-required"), null);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

const fakePolymarket = {
  async getMarket(id: string) { if (id !== market.id) throw new Error("not found"); return market; },
  async getOrderBook(tokenId: string) { return { market: market.conditionId, asset_id: tokenId, timestamp: String(Date.now()), hash: "fixture", bids: [{ price: tokenId === "yes-token" ? ".59" : ".39", size: "1000" }], asks: [{ price: tokenId === "yes-token" ? ".61" : ".41", size: "1000" }], min_order_size: "1", tick_size: ".01", neg_risk: false }; },
  async getHistory() { return [{ timestamp: 1, probability: .5 }, { timestamp: 2, probability: .6 }]; },
  async getOpenInterest() { return 25_000; },
} as unknown as PolymarketClient;

const fakeSpotContext = async (input: { instId: string; timeframe?: string }) => ({
  source: isArcMarket(input.instId) ? "arc-indexed-dex" as const : "okx-public-spot" as const, instId: input.instId, bar: input.timeframe || "1H",
  ticker: { instId: input.instId, ...(isArcMarket(input.instId) ? { priceCurrency: "USDC" } : {}), last: 100, open24h: 99, high24h: 101, low24h: 98, vol24h: 1000, volCcy24h: 100_000, change24hPct: 1.01, ts: String(Date.now()) },
  candles: [
    { ts: 1, open: 99, high: 100, low: 98, close: 99.5, volume: 10, volumeCcy: 995 },
    { ts: 2, open: 99.5, high: 101, low: 99, close: 100, volume: 12, volumeCcy: 1200 },
  ],
  summary: { count: 2, fromTs: 1, toTs: 2, open: 99, close: 100, rangeHigh: 101, rangeLow: 98, changePct: 1.01, lastVolume: 12 },
  fetchedAt: new Date().toISOString(),
});

describe("V5 paid job E2E", () => {
  let server: Server;
  let origin = "";
  before(async () => {
    const cfg = { ...loadConfig(), X402_MOCK: true, paymentMode: "mock" as const, ARC_AI_MODE: "fixture" as const, FEATURE_ARC_PAYMENTS: true, CIRCLE_GATEWAY_ENABLED: true, FEATURE_PREDICTION_ANALYSIS: true, enabledNetworks: ["xlayer", "base", "arbitrum", "arc"] as const };
    const app = createApp(cfg, { polymarket: fakePolymarket, spotContext: fakeSpotContext, spotInstrumentExists: async () => true, persistence: { jobs: new MemoryJobStore(), reports: new MemoryReportStore() } });
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });
  after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  it("settles once, returns 202 immediately, recovers the fixture report, and replays one job", async () => {
    const request = { method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": "mock-e2e-settlement" }, body: JSON.stringify({ primaryMarketId: market.id, additionalMarketIds: [], lang: "en" }) };
    const accepted = await fetch(`${origin}/arc/v1/analysis/prediction/standard`, request);
    assert.equal(accepted.status, 202);
    const body = await accepted.json() as { job: { id: string; stage: string }; recoveryToken: string };
    assert.ok(body.recoveryToken);
    assert.equal(body.job.stage, "payment_settled");

    let final: { job?: { stage?: string; events?: unknown[]; receipt?: { network?: string }; regenerationAttempts?: number } } = {};
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await fetch(`${origin}/v1/jobs/${body.job.id}`, { headers: { "PULSE-RECOVERY-TOKEN": body.recoveryToken } });
      assert.equal(response.status, 200);
      final = await response.json() as typeof final;
      if (["completed", "completed_partial", "failed_terminal"].includes(final.job?.stage || "")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(final.job?.stage, "completed", JSON.stringify(final.job?.events));
    assert.equal(final.job?.receipt?.network, "eip155:5042");
    assert.equal(final.job?.regenerationAttempts, 0);

    const reportResponse = await fetch(`${origin}/v1/jobs/${body.job.id}/report`, { headers: { "PULSE-RECOVERY-TOKEN": body.recoveryToken } });
    assert.equal(reportResponse.status, 200);
    const report = await reportResponse.json() as { report?: { service?: string; analysis?: { fixture?: boolean }; analysisProfile?: { mode?: string; reasoningEffort?: string } } };
    assert.equal(report.report?.service, "prediction_analysis_standard");
    assert.equal(report.report?.analysis?.fixture, true);
    assert.deepEqual(report.report?.analysisProfile, { mode: "fixture", model: "fixture", reasoningEffort: "none" });

    const replay = await fetch(`${origin}/arc/v1/analysis/prediction/standard`, request);
    assert.equal(replay.status, 202);
    const replayBody = await replay.json() as { replay?: boolean; job?: { id?: string } };
    assert.equal(replayBody.replay, true);
    assert.equal(replayBody.job?.id, body.job.id);
  });

  it("delivers canonical spot analysis through the recoverable fixture job without xAI", async () => {
    const accepted = await fetch(`${origin}/arc/v1/analysis/spot/standard`, {
      method: "POST", headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": "mock-spot-settlement" },
      body: JSON.stringify({ instId: "BTC-USDT", timeframe: "1H", lang: "en" }),
    });
    assert.equal(accepted.status, 202);
    const body = await accepted.json() as { job: { id: string; stage: string }; recoveryToken: string };
    assert.equal(body.job.stage, "payment_settled");
    let stage = "";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await fetch(`${origin}/v1/jobs/${body.job.id}`, { headers: { "PULSE-RECOVERY-TOKEN": body.recoveryToken } });
      const status = await response.json() as { job?: { stage?: string } };
      stage = status.job?.stage || "";
      if (stage === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(stage, "completed");
    const response = await fetch(`${origin}/v1/jobs/${body.job.id}/report`, { headers: { "PULSE-RECOVERY-TOKEN": body.recoveryToken } });
    const result = await response.json() as { report?: { service?: string; fixture?: boolean; model?: string } };
    assert.equal(result.report?.service, "spot_analysis_standard");
    assert.equal(result.report?.fixture, true);
    assert.equal(result.report?.model, "fixture");
  });

  it("settles MCP through the canonical route and recovers its local job without a public loopback", async () => {
    const call = (name: string, args: Record<string, unknown>, pay = false) => fetch(`${origin}/arc/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(pay ? { "PAYMENT-SIGNATURE": "mock-mcp-local-job" } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 71, method: "tools/call", params: { name, arguments: args } }),
    });
    const accepted = await call("spot_analysis_standard", { instId: "ETH-USDT", timeframe: "4H", lang: "zh" }, true);
    assert.equal(accepted.status, 202);
    assert.ok(accepted.headers.get("PAYMENT-RESPONSE"));
    const body = await accepted.json() as any;
    const { job, recoveryToken } = body.result.structuredContent;
    assert.ok(job.id);
    let stage = "";
    for (let i = 0; i < 50; i++) {
      const response = await call("job_status", { jobId: job.id, recoveryToken });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("PAYMENT-REQUIRED"), null);
      stage = (await response.json() as any).result.structuredContent.job.stage;
      if (stage === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(stage, "completed");
    const response = await call("job_report", { jobId: job.id, recoveryToken });
    assert.equal(response.status, 200);
    const report = (await response.json() as any).result.structuredContent.report;
    assert.equal(report.service, "spot_analysis_standard");
    assert.equal(report.instId, "ETH-USDT");
    const forbidden = await call("job_report", { jobId: job.id, recoveryToken: "x".repeat(64) });
    assert.equal(forbidden.status, 403);
  });

  it("MCP advertises full-address Arc markets and forwards native research through chain 5042 jobs", async t => {
    const nativeId = "MEME_SYMBOL_1234.EB64987643DB71C76B2A2BE7E723DECC995E5B37-USDC";
    const realFetch = globalThis.fetch;
    t.mock.method(globalThis, "fetch", (async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === "https://www.arcodex.fun" && url.pathname === "/api/radar/tokens") return Response.json({ tokens: [{ address: "0xeb64987643db71c76b2a2be7e723decc995e5b37", symbol: "MEME_SYMBOL_1234", name: "Isolated Arc fixture", decimals: 18, chainId: "5042" }] });
      assert.equal(url.origin, origin, "Native MCP regression must not contact external providers");
      return realFetch(input, init);
    }) as typeof fetch);
    const call = (prefix: string, name: string, args: Record<string, unknown>, pay = false) => fetch(`${origin}/${prefix}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(pay ? { "PAYMENT-SIGNATURE": "mock-native-mcp-job" } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 72, method: "tools/call", params: { name, arguments: args } }),
    });
    const list = await fetch(`${origin}/arc/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 73, method: "tools/list" }) });
    const tools = (await list.json() as any).result.tools;
    for (const name of ["spot_analysis_standard", "spot_analysis_premium"]) {
      const idSchema = tools.find((tool: any) => tool.name === name).inputSchema.properties.instId;
      assert.equal(idSchema.maxLength, 64);
      assert.ok(new RegExp(idSchema.pattern).test(nativeId));
      const malformed = await call("arc", name, { instId: nativeId.replace("-USDC", "-USDT"), timeframe: "1H", lang: "en" });
      assert.equal(malformed.status, 400);
      assert.equal(malformed.headers.get("PAYMENT-REQUIRED"), null);
    }
    const args = { instId: nativeId, timeframe: "1H", lang: "en" };
    const wrongChain = await call("xlayer", "spot_analysis_standard", args, true);
    assert.equal(wrongChain.status, 422);
    assert.equal(wrongChain.headers.get("PAYMENT-RESPONSE"), null);
    const unpaid = await call("arc", "spot_analysis_standard", args);
    assert.equal(unpaid.status, 402);
    const challenge = JSON.parse(Buffer.from(unpaid.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
    assert.equal(challenge.accepts[0].network, "eip155:5042");
    const accepted = await call("arc", "spot_analysis_standard", args, true);
    assert.equal(accepted.status, 202);
    const delivery = (await accepted.json() as any).result.structuredContent;
    let stage = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await call("arc", "job_status", { jobId: delivery.job.id, recoveryToken: delivery.recoveryToken });
      stage = (await response.json() as any).result.structuredContent.job.stage;
      if (["completed", "failed_terminal"].includes(stage)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(stage, "completed");
    const retrieved = await call("arc", "job_report", { jobId: delivery.job.id, recoveryToken: delivery.recoveryToken });
    assert.equal(retrieved.headers.get("PAYMENT-REQUIRED"), null);
    const report = (await retrieved.json() as any).result.structuredContent.report;
    assert.equal(report.instId, nativeId);
    assert.equal(report.market.source, "arc-indexed-dex");
    assert.equal(report.market.ticker.priceCurrency, "USDC");
    const replay = await call("arc", "spot_analysis_standard", args, true);
    assert.equal((await replay.json() as any).result.structuredContent.job.id, delivery.job.id);
  });
});
