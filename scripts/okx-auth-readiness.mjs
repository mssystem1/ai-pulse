import { loadConfig } from "../packages/config/dist/index.js";
import { getOkbUsdt0Quote, getXLayerOkxTokens } from "../apps/api/dist/okxDex.js";

const cfg = loadConfig();
if (!cfg.hasOkxCredentials) {
  throw new Error("OKX readiness requires the API key, secret, and passphrase");
}

const checks = [];
async function check(name, action) {
  try {
    const value = await action();
    checks.push({ name, ok: true, ...value });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await check("xlayer-token-catalog", async () => {
  const tokens = await getXLayerOkxTokens(cfg, "USDT", 3);
  return { resultCount: tokens.length };
});

await check("okb-usdt0-quote", async () => {
  const quote = await getOkbUsdt0Quote(cfg, "1000000000000000");
  return {
    chainId: quote.chainId,
    pair: `${quote.fromSymbol}-${quote.toSymbol}`,
    hasOutputAmount: /^\d+$/.test(quote.toTokenAmount),
  };
});

console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks }, null, 2));
if (checks.some((item) => !item.ok)) process.exitCode = 1;
