import assert from "node:assert/strict";
import test from "node:test";
import type { SpotMarketContext } from "@pulse/market";
import { runPreparedAutopilotSignal } from "./autopilotSignal.js";

const candles = Array.from({ length: 60 }, (_, index) => ({ ts: index + 1, open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1_000, volumeCcy: 100_000 }));
const market: SpotMarketContext = {
  source: "okx-public-spot", instId: "ETH-USDT", bar: "4H",
  ticker: { instId: "ETH-USDT", last: 160, open24h: 150, high24h: 162, low24h: 149, vol24h: 1_000, volCcy24h: 155_000, change24hPct: 6.67, ts: "60" },
  candles,
  summary: { count: 60, fromTs: 1, toTs: 60, open: 100, close: 160, rangeHigh: 161, rangeLow: 99, changePct: 60, lastVolume: 1_000 },
  fetchedAt: "2026-08-29T00:00:00.000Z",
};

test("Autopilot requests a bounded classifier instead of a full Premium report", async () => {
  let request: Record<string, unknown> = {};
  const result = await runPreparedAutopilotSignal({
    apiKey: "test", baseUrl: "https://example.invalid", model: "grok-4.3",
    fetchImpl: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ bias: "bullish", regime: "trend_up", confidence: 76, support: [150], resistance: [165], rationale: "Trend remains aligned." }) } }], usage: { prompt_tokens: 900, completion_tokens: 90, total_tokens: 990, cost_in_usd_ticks: "13500000" } }), { status: 200 });
    },
  }, { instId: "ETH-USDT", timeframe: "4H", strategyType: "trend_following", market });
  assert.equal(request.max_tokens, 320);
  assert.equal(request.reasoning_effort, "none");
  assert.equal(result.signal.bias, "bullish");
  const body = JSON.stringify(request);
  assert.equal(body.includes("elliottWave"), false);
  assert.equal(body.includes("executionPlan"), false);
  assert.equal(result.usage?.totalTokens, 990);
  assert.equal(result.usage?.costUsd, 0.00135);
});
