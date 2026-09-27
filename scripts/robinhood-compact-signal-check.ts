/** One bounded live classifier call. No pass, Redis mutation, wallet or trade. */
import { config } from "dotenv";
import assert from "node:assert/strict";

let phase = "configuration";
async function main() {
  assert.ok(process.argv.includes("--run"), "Pass --run to authorize one live compact classifier request");
  config({ quiet: true });
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionMarketContext, assertRobinhoodAutomationHistory } = await import("../apps/api/src/robinhoodMarkets.js");
  const { runPreparedAutopilotSignal } = await import("../packages/analysis/src/autopilotSignal.js");
  const { evaluateAutopilotEntryCandidate } = await import("../apps/api/src/autopilotPolicy.js");
  const cfg = loadConfig();
  assert.ok(cfg.hasXaiKey, "Compact signal provider is not configured");
  const pair = "WETH.0BD7D308F8E1639F-USDG";
  phase = "market-history";
  const market = await executionMarketContext(cfg, { instId: pair, timeframe: "1H", candleLimit: 120, completedOnly: true });
  assertRobinhoodAutomationHistory(market.candles, "1H");
  const candidate = evaluateAutopilotEntryCandidate({ strategyType: "trend_following", candles: market.candles });
  console.log(JSON.stringify({ phase, pair, candles: market.candles.length, candidateReady: candidate.candidate,
    note: "Classifier diagnostic only; this does not authorize or submit an entry" }));
  phase = "compact-signal";
  let calls = 0;
  const result = await runPreparedAutopilotSignal({ apiKey: cfg.XAI_API_KEY, baseUrl: cfg.XAI_BASE_URL,
    model: cfg.GROK_AUTOPILOT_MODEL, fetchImpl: async (url, init) => {
      assert.equal(++calls, 1, "Diagnostic must not repeat a billed request");
      return fetch(url, init);
    } }, { instId: pair, timeframe: "1H", strategyType: "trend_following", market,
    maxInputTokens: cfg.GROK_MAX_INPUT_AUTOPILOT, maxOutputTokens: cfg.GROK_MAX_OUTPUT_AUTOPILOT });
  assert.equal(result.candleTs, market.candles.at(-1)?.ts);
  console.log(JSON.stringify({ phase, status: "passed", pair, model: result.model,
    generatedAt: result.generatedAt, candleTs: result.candleTs, signal: result.signal, usage: result.usage,
    calls, tradeSubmitted: false, passConsumed: false }));
}
main().catch(error => {
  // Provider bodies/headers and environment values must never enter a diagnostic log.
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ phase, status: "failed", httpStatus: message.match(/HTTP\s+(\d{3})/)?.[1],
    reason: error instanceof assert.AssertionError ? error.message : /input budget|output limit/.test(message) ? message : "Provider or market validation failed; no trade submitted" }));
  process.exitCode = 1;
});
