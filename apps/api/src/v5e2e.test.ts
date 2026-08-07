import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { loadConfig } from "@pulse/config";
import { PolymarketClient, type NormalizedPolymarketMarket } from "@pulse/market";
import { createApp } from "./app.js";
import { MemoryJobStore, MemoryReportStore } from "./jobs.js";
import { ArcBudgetExceededError } from "./arcBudget.js";

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
    enabledNetworks: ["xlayer", "arc-testnet"] as const,
  };
  const app = createApp(cfg, {
    polymarket: fakePolymarket,
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
  source: "okx-public-spot" as const, instId: input.instId, bar: input.timeframe || "1H",
  ticker: { instId: input.instId, last: 100, open24h: 99, high24h: 101, low24h: 98, vol24h: 1000, volCcy24h: 100_000, change24hPct: 1.01, ts: String(Date.now()) },
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
    const cfg = { ...loadConfig(), X402_MOCK: true, paymentMode: "mock" as const, ARC_AI_MODE: "fixture" as const, FEATURE_ARC_PAYMENTS: true, CIRCLE_GATEWAY_ENABLED: true, FEATURE_PREDICTION_ANALYSIS: true, enabledNetworks: ["xlayer", "base", "arbitrum", "arc-testnet"] as const };
    const app = createApp(cfg, { polymarket: fakePolymarket, spotContext: fakeSpotContext, persistence: { jobs: new MemoryJobStore(), reports: new MemoryReportStore() } });
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
    assert.equal(final.job?.receipt?.network, "eip155:5042002");
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
});
