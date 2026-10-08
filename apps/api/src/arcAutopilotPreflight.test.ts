import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, multicall3Abi } from "viem";
import type { AppConfig } from "@pulse/config";
import { createAutopilotAutomationRouter } from "./autopilotAutomation.js";
import { ARC_OKX_MARKETS, ARC_USDC } from "./arcMarkets.js";

test("Arc history and unsigned preflight agree on the reviewed BTC/ETH signal before wallet setup", async t => {
  const original = globalThis.fetch;
  const cfg = { hasOkxCredentials: true, OKX_BASE_URL: "https://fixture.invalid", OKX_API_KEY: "fixture", OKX_SECRET_KEY: "fixture", OKX_PASSPHRASE: "fixture" } as AppConfig;
  const app = express(); app.use(express.json()); app.use(createAutopilotAutomationRouter(cfg));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let gapped = false, stale = false, routes = 0;
  const token = (address: string) => address.toLowerCase() === ARC_USDC
    ? { symbol: "USDC", name: "USD Coin", decimals: 6 }
    : ARC_OKX_MARKETS.find(market => market.address.toLowerCase() === address.toLowerCase())!;
  const rpc = (request: { id: number; method: string; params: Array<{ to: string; data: `0x${string}` }> }) => {
    let result: `0x${string}`;
    if (request.method === "eth_getCode") result = "0x6000";
    else {
      assert.equal(request.method, "eth_call", "preflight must never broadcast");
      const { args } = decodeFunctionData({ abi: multicall3Abi, data: request.params[0].data });
      const values = args![0].map(call => {
        const asset = token(call.target);
        assert.ok(asset, "only reviewed tokens may be inspected");
        const decoded = decodeFunctionData({ abi: erc20Abi, data: call.callData });
        const returnData = decoded.functionName === "symbol" ? encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: asset.symbol })
          : decoded.functionName === "name" ? encodeFunctionResult({ abi: erc20Abi, functionName: "name", result: asset.name })
          : encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: asset.decimals });
        return { success: true, returnData };
      });
      result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: values });
    }
    return { jsonrpc: "2.0", id: request.id, result };
  };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return original(input, init);
    if (url.pathname.endsWith("/ticker")) return Response.json({ code: "0", data: [{ instId: url.searchParams.get("instId"), last: "100", open24h: "99", high24h: "101", low24h: "98", vol24h: "10", volCcy24h: "1000", ts: String(Date.now() - (stale ? 200_000 : 0)) }] });
    if (url.pathname.endsWith("/candles")) {
      const interval = url.searchParams.get("bar") === "15m" ? 900_000 : 3_600_000;
      const end = Math.floor(Date.now() / interval) * interval;
      const rows = Array.from({ length: 60 }, (_, i) => [String(end - (60 - i) * interval), "99", "101", "98", "100", "1", "100", "100", "1"]);
      if (gapped) rows.splice(25, 1);
      return Response.json({ code: "0", data: rows.reverse() });
    }
    if (url.pathname.endsWith("/quote")) {
      routes++;
      const from = url.searchParams.get("fromTokenAddress")!, to = url.searchParams.get("toTokenAddress")!;
      const amount = BigInt(url.searchParams.get("amount")!);
      const fromAsset = token(from), toAsset = token(to);
      const output = from.toLowerCase() === ARC_USDC ? amount * 10n ** BigInt(toAsset.decimals) / 100_000_000n
        : amount * 100_000_000n / 10n ** BigInt(fromAsset.decimals);
      return Response.json({ code: "0", data: [{ chainIndex: "5042", fromTokenAmount: String(amount), toTokenAmount: String(output), fromToken: { tokenContractAddress: from, decimal: String(fromAsset.decimals) }, toToken: { tokenContractAddress: to, decimal: String(toAsset.decimals) } }] });
    }
    const request = JSON.parse(String(init?.body));
    assert.ok(Array.isArray(request) || typeof request.method === "string", "unexpected external request");
    return Response.json(Array.isArray(request) ? request.map(rpc) : rpc(request));
  });
  const body = (market = ARC_OKX_MARKETS[0]) => ({ network: "arc", pair: market.pair, timeframe: "15m", targetAsset: market.address, settlementAsset: ARC_USDC, amountAtomic: "1000000", maxTradeValueAtomic: "1000000", maxSlippageBps: 150 });
  const preflight = async (request: unknown) => {
    const response = await fetch(origin + "/v1/autopilot/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    return { status: response.status, body: await response.json() as { ready?: boolean; pair?: string; signalMarket?: string; error?: string; walletTransactionsSent?: boolean } };
  };
  try {
    for (const market of ARC_OKX_MARKETS) {
      const history = await (await fetch(origin + `/v1/autopilot/market-readiness?network=arc&pair=${market.pair}&timeframe=15m`)).json() as { ready: boolean; signalMarket: string };
      const result = await preflight(body(market));
      assert.equal(result.status, 200, result.body.error);
      assert.equal(result.body.ready, true);
      assert.equal(history.ready, true);
      assert.equal(result.body.signalMarket, market.pair);
      assert.equal(result.body.signalMarket, history.signalMarket);
    }
    assert.equal(routes, 4, "both entry and cap-compliant exit quotes are checked");
    for (const mode of ["gapped", "stale"] as const) {
      gapped = mode === "gapped"; stale = mode === "stale";
      const result = await preflight(body());
      assert.equal(result.status, 422); assert.equal(result.body.walletTransactionsSent, false);
      assert.match(result.body.error!, mode === "gapped" ? /completed OKX candles/ : /OKX market data/);
      assert.equal(routes, 4, "unusable history must stop before route preparation");
    }
    const wrongAsset = await preflight({ ...body(), targetAsset: `0x${"1".repeat(40)}` });
    assert.equal(wrongAsset.status, 422); assert.equal(routes, 4);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
