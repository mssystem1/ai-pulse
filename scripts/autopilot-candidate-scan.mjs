/** Read-only technical prefilter for live Autopilot candidates. */
import { buildMarketContext } from "../packages/market/dist/index.js";
import { evaluateAutopilotPolicy } from "../apps/api/dist/autopilotPolicy.js";

const pairs = String(process.argv.find((value) => value.startsWith("--pairs="))?.slice(8)
  || "DOGE-USDT,PEPE-USDT,SHIB-USDT,BONK-USDT,WIF-USDT,FLOKI-USDT,TRUMP-USDT,TURBO-USDT,MOODENG-USDT,PNUT-USDT,ADA-USDT,XRP-USDT,LTC-USDT,ETH-USDT,BTC-USDT,SOL-USDT")
  .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
const timeframes = String(process.argv.find((value) => value.startsWith("--timeframes="))?.slice(13) || "15m,1H")
  .split(",").map((value) => value.trim()).filter(Boolean);
const requestedLimit = Number(process.argv.find((value) => value.startsWith("--limit="))?.slice(8) || 20);
const resultLimit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 20;
const candidates = [];
const unavailable = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const pair of pairs) {
  for (const timeframe of timeframes) {
    try {
      const market = await buildMarketContext({ instId: pair, timeframe, candleLimit: 120 });
      const baseReport = { executionPlan: { buy: {} } };
      const inputs = [
        ["trend_following", { analysis: { bias: "bullish", confidence: 100, regime: "trend_up", keyLevels: { support: [] } }, ...baseReport }],
        ["breakout", { analysis: { bias: "bullish", confidence: 100, regime: "trend_up", keyLevels: { support: [] } }, ...baseReport }],
        ["mean_reversion", { analysis: { bias: "bullish", confidence: 100, regime: "range", keyLevels: { support: [] } }, ...baseReport }],
      ];
      for (const [strategyType, report] of inputs) {
        const decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report, minConfidence: 60, hasPosition: false });
        const technicalRules = decision.rules.filter((rule) => !["bullish_bias", "confidence", "trend_regime", "breakout_regime", "range_regime"].includes(rule.id));
        const passed = technicalRules.filter((rule) => rule.passed).length;
        candidates.push({ pair, timeframe, strategy: strategyType, technicalReady: technicalRules.every((rule) => rule.passed), passed, total: technicalRules.length, change24hPct: market.ticker.change24hPct, mark: market.ticker.last, metrics: decision.metrics });
      }
    } catch (error) {
      unavailable.push({ pair, timeframe, error: error instanceof Error ? error.message : String(error) });
    }
    await wait(125);
  }
}

candidates.sort((a, b) => Number(b.technicalReady) - Number(a.technicalReady) || b.passed / b.total - a.passed / a.total || b.change24hPct - a.change24hPct);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), mode: "read-only technical prefilter", scanned: pairs.length * timeframes.length, candidates: candidates.slice(0, resultLimit), unavailable }, null, 2));
