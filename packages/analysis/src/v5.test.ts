import assert from "node:assert/strict";
import { it } from "node:test";
import { buildFusedAiContext, runPreparedV5Analysis } from "./v5.js";

it("returns Chinese fixture reports when Chinese is selected", async () => {
  const analysis = await runPreparedV5Analysis({
    apiKey: "", baseUrl: "https://x.ai/v1", model: "fixture",
  }, { mode: "prediction", tier: "standard", lang: "zh", context: {}, fixture: true });
  assert.match(analysis.headline, /[\u4e00-\u9fff]/);
  assert.match(analysis.summary, /[\u4e00-\u9fff]/);
  assert.match(analysis.decision.rationale, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(analysis.summary, /Deterministic fixture output/);
});

it("gives xAI an explicit whole-report Chinese instruction", async () => {
  let requestBody = "";
  await runPreparedV5Analysis({
    apiKey: "test", baseUrl: "https://x.ai/v1", model: "grok-test",
    fetchImpl: async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        headline: "证据不足", summary: "当前证据不足。", confidence: 40,
        stance: "NO_EDGE", marketProbabilityPct: 50, fairProbabilityRange: { low: 35, high: 65 },
        decision: { action: "WAIT", rationale: "等待更多证据。" },
        evidenceDrivers: ["已有证据"], counterEvidence: ["反方证据"],
        entryConditions: ["等待价格改善"], noTradeConditions: ["流动性不足"],
        catalystsForYes: ["支持证据增强"], catalystsForNo: ["反方证据增强"], executionRisks: ["检查点差"],
        limitations: ["证据有限"], invalidationConditions: ["条件变化"], disclaimer: "非财务建议",
      }) } }] }), { status: 200 });
    },
  }, { mode: "prediction", tier: "standard", lang: "zh", context: { usedMarketIds: ["pm:one"] } });
  const messages = (JSON.parse(requestBody) as { messages: Array<{ content: string }> }).messages;
  assert.match(messages[0].content, /entirely in Simplified Chinese/);
});

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
