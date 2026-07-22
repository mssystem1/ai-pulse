/**
 * Direct Grok analysis smoke (bypasses x402) using env keys.
 * Usage: node scripts/test-grok.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}
loadEnv();

const { runGrokAnalysis } = await import("../packages/analysis/dist/index.js");

const result = await runGrokAnalysis(
  {
    apiKey: process.env.XAI_API_KEY,
    baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    model: process.env.GROK_MODEL || "grok-4.3",
  },
  { instId: "BTC-USDT", timeframe: "1H", tier: "base", lang: "en" },
);

console.log(JSON.stringify({
  service: result.service,
  model: result.model,
  instId: result.instId,
  headline: result.analysis.headline,
  bias: result.analysis.bias,
  confidence: result.analysis.confidence,
  targets: result.analysis.targets,
  ticker: result.market.ticker,
}, null, 2));
