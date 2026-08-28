/**
 * Read-only Autopilot strategy qualification.
 *
 * Loads live OKX candles and one fresh Premium analysis, then evaluates all
 * deterministic strategies without reading a private key or broadcasting.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match || process.env[match[1].trim()]) continue;
    const raw = match[2].trim();
    process.env[match[1].trim()] = ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
      ? raw.slice(1, -1)
      : raw;
  }
}

loadEnv();

const pair = String(process.argv.find((value) => value.startsWith("--pair="))?.split("=")[1] || "ETH-USDT").toUpperCase();
const requestedTimeframe = String(process.argv.find((value) => value.startsWith("--timeframe="))?.split("=")[1] || "4H");
const timeframe = requestedTimeframe.toLowerCase() === "15min" || requestedTimeframe.toLowerCase() === "15m"
  ? "15m"
  : requestedTimeframe.toUpperCase();
const minConfidence = Number(process.argv.find((value) => value.startsWith("--confidence="))?.split("=")[1] || 60);
const summaryOnly = process.argv.includes("--summary");

const [{ loadConfig }, marketModule, analysisModule, policyModule] = await Promise.all([
  import("../packages/config/dist/index.js"),
  import("../packages/market/dist/index.js"),
  import("../packages/analysis/dist/index.js"),
  import("../apps/api/dist/autopilotPolicy.js"),
]);
const cfg = loadConfig();
if (!cfg.hasXaiKey) throw new Error("XAI_API_KEY is required for a live Premium qualification");

const market = await marketModule.buildMarketContext({ instId: pair, timeframe, candleLimit: 120 });
const report = await analysisModule.runPreparedSpotAnalysis(
  { apiKey: cfg.XAI_API_KEY, baseUrl: cfg.XAI_BASE_URL, model: cfg.GROK_MODEL },
  {
    instId: pair,
    timeframe,
    tier: "premium",
    lang: "en",
    userNote: "Read-only Autopilot qualification. Apply evidence-first spot analysis; do not force a trade.",
    maxInputTokens: cfg.GROK_MAX_INPUT_PREMIUM,
    maxOutputTokens: cfg.GROK_MAX_OUTPUT_PREMIUM,
    reasoningEffort: cfg.GROK_REASONING_PREMIUM,
  },
  market,
);
const technical = analysisModule.buildTechnicalStructure(market.candles);
const executionPlan = analysisModule.buildSpotExecutionPlan({ instId: pair, timeframe, tier: "premium", lastPrice: market.ticker.last, analysis: report.analysis, technical });
const enrichedReport = { ...report, technical, executionPlan };
const evaluations = policyModule.AUTOPILOT_STRATEGY_CATALOG.map((strategy) => policyModule.evaluateAutopilotPolicy({
  strategyType: strategy.id,
  candles: market.candles,
  report: enrichedReport,
  minConfidence,
  hasPosition: false,
}));

const result = {
  generatedAt: new Date().toISOString(),
  mode: "read-only",
  pair,
  timeframe,
  mark: market.ticker.last,
  premium: {
    bias: report.analysis.bias,
    confidence: report.analysis.confidence,
    regime: report.analysis.regime,
    headline: report.analysis.headline,
  },
  evaluations,
};
console.log(JSON.stringify(summaryOnly ? {
  generatedAt: result.generatedAt,
  mode: result.mode,
  pair: result.pair,
  timeframe: result.timeframe,
  mark: result.mark,
  premium: result.premium,
  decisions: result.evaluations.map((evaluation) => ({
    strategy: evaluation.strategyType,
    action: evaluation.action,
    reason: evaluation.reason,
  })),
} : result, null, 2));
