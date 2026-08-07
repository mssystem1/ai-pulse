import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpotMarketContext } from "@pulse/market";
import { runPreparedSpotAnalysis } from "./grok.js";

const market: SpotMarketContext = {
  source: "okx-public-spot",
  instId: "BTC-USDT",
  bar: "1H",
  ticker: {
    instId: "BTC-USDT", last: 100, open24h: 98, high24h: 102, low24h: 97,
    vol24h: 10, volCcy24h: 1_000, change24hPct: 2.04, ts: "1",
  },
  candles: [
    { ts: 1, open: 98, high: 101, low: 97, close: 100, volume: 10, volumeCcy: 1_000 },
  ],
  summary: {
    count: 1, fromTs: 1, toTs: 1, open: 98, close: 100,
    rangeHigh: 101, rangeLow: 97, changePct: 2.04, lastVolume: 10,
  },
  fetchedAt: "2026-08-03T00:00:00.000Z",
};

const validAnalysis = {
  headline: "Prepared context used", regime: "trend_up", bias: "bullish", confidence: 72,
  summary: "Price is trending higher within the supplied observations.",
  keyLevels: { support: [98], resistance: [102] },
  targets: [{ label: "continuation", price: 102, rationale: "Observed range high" }],
  invalidation: { price: 97, condition: "Break below the supplied range low" },
  scenarios: [
    { name: "bull", thesis: "Continuation", target: 102, invalidation: 98 },
    { name: "base", thesis: "Consolidation", target: 100, invalidation: 97 },
    { name: "bear", thesis: "Range failure", target: 97, invalidation: 102 },
  ],
  chartNotes: "Based only on supplied OHLCV.", agentAction: "Wait for confirmation.",
  agentChecklist: ["Check spread"], riskNotes: ["Single-candle fixture"],
  limitations: ["Limited history"], disclaimer: "Decision support only; not financial advice.",
};

describe("context-first Grok analysis", () => {
  it("does not fetch OKX and preserves the legacy response schema", async () => {
    let calls = 0;
    const result = await runPreparedSpotAnalysis(
      {
        apiKey: "test",
        baseUrl: "https://xai.invalid/v1",
        model: "grok-4.3",
        fetchImpl: async (_input, init) => {
          calls += 1;
          const request = JSON.parse(String(init?.body)) as { max_tokens?: number; reasoning_effort?: string; response_format?: { type?: string; json_schema?: { strict?: boolean } }; messages: Array<{ content: string }> };
          assert.match(request.messages[1].content, /BTC-USDT/);
          assert.equal(request.max_tokens, 700);
          assert.equal(request.reasoning_effort, "none");
          assert.equal(request.response_format?.type, "json_schema");
          assert.equal(request.response_format?.json_schema?.strict, true);
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validAnalysis) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        },
      },
      { instId: "BTC-USDT", timeframe: "1H", tier: "base", lang: "en", maxInputTokens: 12000, maxOutputTokens: 700 },
      market,
    );

    assert.equal(calls, 1);
    assert.equal(result.service, "analysis_base");
    assert.equal(result.tier, "base");
    assert.equal(result.market.source, "okx-public-spot");
    assert.equal(result.analysis.headline, "Prepared context used");
    assert.equal(result.usage?.totalTokens, 120);
    assert.deepEqual(result.analysisProfile, { mode: "live", model: "grok-4.3", reasoningEffort: "none" });
  });

  it("rejects an oversized spot prompt before calling xAI", async () => {
    let called = false;
    await assert.rejects(() => runPreparedSpotAnalysis({
      apiKey: "test", baseUrl: "https://xai.invalid/v1", model: "grok-4.3",
      fetchImpl: async () => { called = true; return new Response(); },
    }, { instId: "BTC-USDT", tier: "base", userNote: "x".repeat(500), maxInputTokens: 100 }, market), /exceeds input budget/);
    assert.equal(called, false);
  });

  it("rejects incomplete or extra provider output after the xAI response", async () => {
    await assert.rejects(() => runPreparedSpotAnalysis({
      apiKey: "test", baseUrl: "https://xai.invalid/v1", model: "grok-4.3",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ headline: "Incomplete", invented: true }) } }],
      }), { status: 200 }),
    }, { instId: "BTC-USDT", tier: "base" }, market), /structured output failed validation/);
  });
});
