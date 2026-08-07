import assert from "node:assert/strict";
import { it } from "node:test";
import { buildFusedAiContext, runPreparedV5Analysis } from "./v5.js";

it("sends only prepared V5 context and enforces a structured response", async () => {
  let requestBody = "";
  const analysis = await runPreparedV5Analysis({
    apiKey: "test", baseUrl: "https://x.ai/v1", model: "grok-test",
    fetchImpl: async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        headline: "Selected market weakened", summary: "The implied probability fell.", confidence: 61,
        stance: "NO_EDGE", marketProbabilityPct: 40, fairProbabilityRange: { low: 35, high: 45 },
        decision: { action: "WAIT", rationale: "The fair range overlaps the executable market." },
        evidenceDrivers: ["Probability weakened"], counterEvidence: ["Depth is thin"],
        entryConditions: ["Wait for a better executable price"], noTradeConditions: ["Avoid a wide spread"],
        catalystsForYes: ["Probability and evidence strengthen"], catalystsForNo: ["Probability breaks lower"], executionRisks: ["Check bid and ask before acting"],
        limitations: ["Thin depth"], invalidationConditions: ["Probability recovers"], disclaimer: "Decision support only",
      }) } }] }), { status: 200 });
    },
  }, { mode: "prediction", tier: "standard", lang: "en", context: { usedMarketIds: ["pm:one"] } });
  assert.equal(analysis.confidence, 61);
  assert.match(requestBody, /pm:one/);
  assert.match(requestBody, /never introduce another market/);
  assert.equal((JSON.parse(requestBody) as { reasoning_effort?: string }).reasoning_effort, "none");
  const structured = JSON.parse(requestBody) as { response_format?: { type?: string; json_schema?: { strict?: boolean } } };
  assert.equal(structured.response_format?.type, "json_schema");
  assert.equal(structured.response_format?.json_schema?.strict, true);
});

it("rejects prepared context beyond the input budget before calling xAI", async () => {
  let called = false;
  await assert.rejects(() => runPreparedV5Analysis({
    apiKey: "test", baseUrl: "https://x.ai/v1", model: "grok-test",
    fetchImpl: async () => { called = true; return new Response(); },
  }, {
    mode: "prediction", tier: "standard", lang: "en",
    context: { large: "x".repeat(10_000) }, maxInputTokens: 1000,
  }), /exceeds input budget/);
  assert.equal(called, false);
});

it("rejects mixed-type V5 arrays instead of silently dropping invalid fields", async () => {
  await assert.rejects(() => runPreparedV5Analysis({
    apiKey: "test", baseUrl: "https://x.ai/v1", model: "grok-test",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      headline: "Invalid", summary: "Invalid", confidence: 50,
      limitations: ["known", 7], invalidationConditions: ["condition"], disclaimer: "Decision support only",
    }) } }] }), { status: 200 }),
  }, { mode: "prediction", tier: "standard", lang: "en", context: {} }), /must include limitations/);
});

it("compacts fused AI evidence without discarding calculated features", () => {
  const candles = Array.from({ length: 80 }, (_, ts) => ({ ts, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, volumeCcy: 15 }));
  const context = buildFusedAiContext({
    market: { source: "okx-public-spot", instId: "BTC-USDT", bar: "1H", ticker: {}, candles, summary: {}, fetchedAt: "now" },
    predictionContext: {
      selectionMode: "user", primaryMarketId: "pm:1", requestedAdditionalMarketIds: [], usedMarketIds: ["pm:1"], rejectedMarkets: [], partial: false, missingSources: [], observedAt: "now",
      markets: [{ market: { id: "pm:1", conditionId: "0x1", question: "Fixture", restricted: true },
        outcomes: [{ name: "Yes", tokenId: "1", orderBook: { bids: [{ price: "0.4", size: "1" }], asks: [] }, history: [{ timestamp: 1, probability: 0.4 }], features: { bestBid: 0.4 } }], openInterest: 1, partial: false, missingSources: [] }],
    },
    fusion: { compatible: true },
  } as never);
  assert.equal(context.market.recentCandles.length, 32);
  assert.equal(context.predictionContext.markets[0]?.outcomes[0]?.features.bestBid, 0.4);
  assert.equal("orderBook" in (context.predictionContext.markets[0]?.outcomes[0] ?? {}), false);
  assert.equal("history" in (context.predictionContext.markets[0]?.outcomes[0] ?? {}), false);
});
