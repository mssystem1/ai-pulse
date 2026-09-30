import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AppConfig } from "@pulse/config";
import { createAutopilotAutomationRouter } from "./autopilotAutomation.js";

test("market selection reports ready or gapped history before any wallet setup", async () => {
  const original = globalThis.fetch;
  const address = "0x0bd7d308f8e1639fab988df18a8011f41eacad73", hour = 3_600_000;
  const cfg = { hasOkxCredentials: true, OKX_BASE_URL: "https://fixture.invalid", OKX_API_KEY: "fixture", OKX_SECRET_KEY: "fixture", OKX_PASSPHRASE: "fixture" } as AppConfig;
  const app = express(); app.use(createAutopilotAutomationRouter(cfg));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return original(input, init);
    if (url.hostname === "api.robinhood.com") return Response.json({ assets: [] });
    if (url.pathname.endsWith("all-tokens")) return Response.json({ code: "0", data: [{ tokenContractAddress: address, tokenSymbol: "WETH", decimals: 18 }] });
    assert.equal(url.pathname, "/api/v6/dex/market/candles");
    const interval = url.searchParams.get("bar") === "1H" ? hour : 4 * hour;
    const end = Math.floor(Date.now() / interval) * interval;
    const data = Array.from({ length: 60 }, (_, i) => [String(end - (60 - i) * interval), "10", "12", "9", "11", "1", "11", "1"]);
    if (interval !== hour) data.splice(25, 1);
    return Response.json({ code: "0", data });
  };
  try {
    const url = `http://127.0.0.1:${port}/v1/autopilot/market-readiness?network=robinhood&pair=WETH.0BD7D308F8E1639F-USDG`;
    const good = await (await fetch(`${url}&timeframe=1H`)).json() as { ready: boolean; walletTransactionsSent: boolean };
    assert.equal(good.ready, true); assert.equal(good.walletTransactionsSent, false);
    const gaps = await (await fetch(`${url}&timeframe=4H`)).json() as { ready: boolean; reason: string };
    assert.equal(gaps.ready, false); assert.match(gaps.reason, /gaps/);
    assert.equal((await fetch(`${url}&timeframe=unsupported`)).status, 400);
  } finally { globalThis.fetch = original; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
