import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AppConfig } from "@pulse/config";
import { createAutopilotAutomationRouter } from "./autopilotAutomation.js";
import { robinhoodAutopilotContext } from "./robinhoodMarkets.js";

test("market selection reports ready or gapped history before any wallet setup", async () => {
  const original = globalThis.fetch;
  const address = "0x0bd7d308f8e1639fab988df18a8011f41eacad73", hour = 3_600_000;
  const cfg = { hasOkxCredentials: true, OKX_BASE_URL: "https://fixture.invalid", OKX_API_KEY: "fixture", OKX_SECRET_KEY: "fixture", OKX_PASSPHRASE: "fixture" } as AppConfig;
  const app = express(); app.use(createAutopilotAutomationRouter(cfg));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  let staleReference = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return original(input, init);
    if (url.hostname === "api.robinhood.com") return Response.json({ assets: [] });
    if (url.pathname.endsWith("all-tokens")) return Response.json({ code: "0", data: [
      { tokenContractAddress: address, tokenSymbol: "WETH", decimals: 18 },
      { tokenContractAddress: "0x1111111111111111111111111111111111111111", tokenSymbol: "WETH", decimals: 18 },
    ] });
    if (url.pathname.endsWith("/price")) return Response.json({ code: "0", data: JSON.parse(String(init?.body)).map((item: { tokenContractAddress: string }) => ({ ...item, price: item.tokenContractAddress === address ? "11" : "1", time: String(Date.now()) })) });
    if (url.pathname.endsWith("/ticker")) return Response.json({ code: "0", data: [{ instId: "ETH-USDT", last: "22", open24h: "20", high24h: "24", low24h: "19", vol24h: "100", volCcy24h: "2200", ts: String(Date.now() - (staleReference ? 200_000 : 0)) }] });
    assert.ok(url.pathname.endsWith("/candles"));
    const reference = url.pathname.startsWith("/api/v5");
    const interval = url.searchParams.get("bar") === "1H" ? hour : 4 * hour;
    const end = Math.floor(Date.now() / interval) * interval;
    const data = Array.from({ length: 60 }, (_, i) => [String(end - (60 - i) * interval), "10", "12", "9", "11", "1", "11", "1"]);
    if (reference) return Response.json({ code: "0", data: data.map(row => [...row.slice(0, 7), "11", "1"]).reverse() });
    data.push([String(end), "10", "12", "9", "11", "1", "11", "0"]);
    if (interval !== hour) data.splice(25, 1);
    return Response.json({ code: "0", data });
  };
  try {
    const url = `http://127.0.0.1:${port}/v1/autopilot/market-readiness?network=robinhood&pair=WETH.0BD7D308F8E1639F-USDG`;
    const good = await (await fetch(`${url}&timeframe=1H`)).json() as { ready: boolean; walletTransactionsSent: boolean; signalSource: string };
    assert.equal(good.ready, true); assert.equal(good.walletTransactionsSent, false);
    assert.equal(good.signalSource, "token-dex");
    const gaps = await (await fetch(`${url}&timeframe=4H`)).json() as { ready: boolean; reason: string; signalMarket: string };
    assert.equal(gaps.ready, true); assert.equal(gaps.signalMarket, "ETH-USDT"); assert.match(gaps.reason, /verified/);
    const pair = "WETH.0BD7D308F8E1639F-USDG";
    const context = await robinhoodAutopilotContext(cfg, { instId: pair, timeframe: "4H", signalMarket: "ETH-USDT" });
    assert.equal(context.analysisToSettlement, 0.5);
    assert.equal(context.market.instId, "ETH-USDT");
    assert.equal(context.market.candles.length, 60);
    await assert.rejects(robinhoodAutopilotContext(cfg, { instId: pair, timeframe: "4H", signalMarket: pair }), /gaps/);
    await assert.rejects(robinhoodAutopilotContext(cfg, { instId: pair, timeframe: "4H", signalMarket: "BTC-USDT" }), /not verified/);
    await assert.rejects(robinhoodAutopilotContext(cfg, { instId: "WETH.1111111111111111-USDG", timeframe: "4H", signalMarket: "ETH-USDT" }), /not verified/);
    staleReference = true;
    await assert.rejects(robinhoodAutopilotContext(cfg, { instId: pair, timeframe: "4H", signalMarket: "ETH-USDT" }), /fresh/);
    assert.equal((await fetch(`${url}&timeframe=unsupported`)).status, 400);
  } finally { globalThis.fetch = original; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
