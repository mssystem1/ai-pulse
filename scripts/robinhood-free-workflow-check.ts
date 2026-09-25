/** Free GET-only application smoke check against live providers. No signing,
 * payment requests, account changes or background workers. */
import { config } from "dotenv";
import assert from "node:assert/strict";

async function main() {
  config({ quiet: true });
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { createApp } = await import("../apps/api/src/app.js");
  const base = loadConfig();
  assert.ok(base.enabledNetworks.includes("robinhood"), "Local API allowlist must include Robinhood");
  const cfg = { ...base, NODE_ENV: "development" as const, QUEUE_PROVIDER: "memory" as const,
    FEATURE_ROBINHOOD_PAYMENTS: false, KV_REST_API_URL: "", KV_REST_API_TOKEN: "", REDIS_URL: "" };
  const app = createApp(cfg, { startDurableWorker: false,
    robinhoodPayment: (_req, res) => { res.status(503).json({ error: "Payments excluded from free workflow check" }); } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const get = async (path: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { signal: AbortSignal.timeout(60_000) });
    assert.equal(response.status, 200, `Free endpoint ${path.split("?")[0]} status ${response.status}`);
    return response.json() as Promise<any>;
  };
  try {
    const catalog = await get("/v1/trading/pairs?network=robinhood&custody=erc20&limit=1000");
    assert.equal(catalog.settlementSymbol, "USDG");
    assert.ok(catalog.pairs.length > 0);
    assert.equal(new Set(catalog.pairs.map((item: any) => item.pair)).size, catalog.pairs.length);
    console.log(JSON.stringify({ check: "catalog", assets: catalog.pairs.length, settlement: catalog.settlementSymbol }));
    const targets = [catalog.pairs.find((item: any) => item.token.address.toLowerCase() === "0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
      catalog.pairs.find((item: any) => item.token.symbol === "AAPL")];
    for (const target of targets) {
      assert.ok(target, "Expected qualification token is present");
      const mapping = await get(`/v1/trading/resolve-pair?network=robinhood&custody=erc20&pair=${encodeURIComponent(target.pair)}`);
      assert.equal(mapping.available, true, "Live roundtrip route unavailable");
      assert.equal(mapping.base.address.toLowerCase(), target.token.address.toLowerCase());
      const ticker = await get(`/v1/market/ticker?instId=${encodeURIComponent(target.pair)}`);
      const candles = await get(`/v1/market/candles?instId=${encodeURIComponent(target.pair)}&bar=1H&limit=100`);
      assert.ok(Number(ticker.ticker?.last) > 0, "Positive live chart price required");
      assert.ok(candles.candles?.length > 0, "Live chart history required");
      console.log(JSON.stringify({ check: "selected-market", pair: target.pair, exactMapping: true, candles: candles.candles.length, priceCurrency: ticker.ticker.priceCurrency }));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : "Free workflow check failed; no signing or payment was attempted.");
  process.exit(1);
});
