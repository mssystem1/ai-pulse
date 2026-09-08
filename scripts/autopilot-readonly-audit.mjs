/**
 * Non-spending Autopilot strategy qualification.
 *
 * Uses public OKX closed candles. No .env, AI calls, keys or transactions.
 * A technical candidate is NOT an AI-approved entry.
 */

const pair = String(process.argv.find((value) => value.startsWith("--pair="))?.split("=")[1] || "ETH-USDT").toUpperCase();
const requestedTimeframe = String(process.argv.find((value) => value.startsWith("--timeframe="))?.split("=")[1] || "4H");
const timeframe = requestedTimeframe.toLowerCase() === "15min" || requestedTimeframe.toLowerCase() === "15m"
  ? "15m"
  : requestedTimeframe.toUpperCase();
const minConfidence = Number(process.argv.find((value) => value.startsWith("--confidence="))?.split("=")[1] || 60);
const summaryOnly = process.argv.includes("--summary");
if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(pair)) throw new Error("Use an OKX Spot instrument such as ETH-USDT");
if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 100) throw new Error("Confidence must be between 0 and 100");
if (process.argv.includes("--ai") || process.argv.includes("--pay")) throw new Error("This audit never calls AI or pays. Use a separately authorized acceptance workflow.");

const [marketModule, policyModule] = await Promise.all([
  import("../packages/market/dist/index.js"),
  import("../apps/api/dist/autopilotPolicy.js"),
]);
const market = await marketModule.buildMarketContext({ instId: pair, timeframe, candleLimit: 120, completedOnly: true });
const evaluations = policyModule.AUTOPILOT_STRATEGY_CATALOG.map((strategy) => policyModule.evaluateAutopilotPolicy({
  strategyType: strategy.id,
  candles: market.candles,
  report: {},
  minConfidence,
  hasPosition: false,
  aiEvaluated: false,
})).map((evaluation) => ({ ...evaluation, confidence: null, technicalCandidate: evaluation.rules.every((rule) => rule.passed) }));

const result = {
  generatedAt: new Date().toISOString(),
  mode: "read-only-deterministic",
  aiEvaluated: false,
  aiProviderCalls: 0,
  transactionBroadcasts: 0,
  pair,
  timeframe,
  mark: market.ticker.last,
  closedCandleCount: market.candles.length,
  lastClosedCandle: market.candles.at(-1),
  note: "A technical candidate still needs runtime/pass/budget, compact AI, signed policy and route checks. This audit never authorizes an entry.",
  evaluations,
};
console.log(JSON.stringify(summaryOnly ? {
  generatedAt: result.generatedAt,
  mode: result.mode,
  pair: result.pair,
  timeframe: result.timeframe,
  mark: result.mark,
  aiEvaluated: result.aiEvaluated,
  aiProviderCalls: result.aiProviderCalls,
  closedCandleCount: result.closedCandleCount,
  lastClosedCandle: result.lastClosedCandle,
  note: result.note,
  decisions: result.evaluations.map((evaluation) => ({
    strategy: evaluation.strategyType,
    action: evaluation.action,
    reason: evaluation.reason,
    technicalCandidate: evaluation.technicalCandidate,
  })),
} : result, null, 2));
