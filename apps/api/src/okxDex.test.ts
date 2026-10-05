import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createOkxDexHeaders, createOkxSignature, matchesUnderlyingToken, getOkxTradeTokens, executionAssetAliases, getGenericOkxSwap, betterGenericOkxExitSwap } from "./okxDex.js";
import type { AppConfig } from "@pulse/config";

test("Arc prepared swaps reject substituted input amounts before returning transaction data", async t => {
  const from = "0x3600000000000000000000000000000000000000", to = "0x128cc466b61f542da60c70e3aa11c10e19b84edb";
  const cfg = { hasOkxCredentials: true, OKX_BASE_URL: "https://fixture.invalid", OKX_API_KEY: "fixture", OKX_SECRET_KEY: "fixture", OKX_PASSPHRASE: "fixture" } as AppConfig;
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "0", data: [{ tx: { to, data: "0x", value: "0" }, routerResult: { chainIndex: "5042", fromToken: { tokenContractAddress: from }, toToken: { tokenContractAddress: to }, fromTokenAmount: "100001", toTokenAmount: "30000000000000" } }] }));
  await assert.rejects(getGenericOkxSwap(cfg, { chainId: "5042", fromTokenAddress: from, toTokenAddress: to, amount: "100000", userWalletAddress: to }), /Arc mainnet quote must match the exact input/);
});

test("a better exit route discovers venue IDs and preserves exact amount, recipient and slippage", async () => {
  const originalFetch = globalThis.fetch;
  const from = `0x${"1".repeat(40)}`, to = `0x${"2".repeat(40)}`, wallet = `0x${"3".repeat(40)}`;
  const cfg = { hasOkxCredentials: true, OKX_BASE_URL: "https://fixture.invalid", OKX_API_KEY: "fixture", OKX_SECRET_KEY: "fixture", OKX_PASSPHRASE: "fixture" } as AppConfig;
  const input = { chainId: "4663", fromTokenAddress: from, toTokenAddress: to, amount: "1000", userWalletAddress: wallet, slippagePercent: "1" };
  let alternativeAmount = "70", substituted = false;
  globalThis.fetch = async value => {
    const url = new URL(String(value));
    if (url.pathname.endsWith("get-liquidity")) return Response.json({ code: "0", data: [
      { id: "53", name: "Default" }, { id: "53&unsafe=true", name: "Default" }, { id: "438", name: "Alternative" },
    ] });
    assert.ok(url.pathname.endsWith("/swap"));
    const alternative = url.searchParams.has("excludeDexIds");
    if (alternative) assert.equal(url.searchParams.get("excludeDexIds"), "53");
    for (const [key, expected] of Object.entries({ amount: "1000", userWalletAddress: wallet, slippagePercent: "1", fromTokenAddress: from, toTokenAddress: to, chainIndex: "4663" }))
      assert.equal(url.searchParams.get(key), expected);
    return Response.json({ code: "0", data: [{ tx: { to: wallet, data: "0x", value: "0" }, routerResult: {
      fromToken: { tokenContractAddress: from, decimal: "18" }, toToken: { tokenContractAddress: substituted ? wallet : to, decimal: "6" },
      fromTokenAmount: "1000", toTokenAmount: alternative ? alternativeAmount : "50",
      dexRouterList: [{ dexProtocol: { dexName: alternative ? "Alternative" : "Default" } }],
    } }] });
  };
  try {
    const original = await getGenericOkxSwap(cfg, input);
    assert.equal((await betterGenericOkxExitSwap(cfg, input, original)).quote?.toTokenAmount, "70");
    alternativeAmount = "40";
    assert.equal(await betterGenericOkxExitSwap(cfg, input, original), original, "never select a worse alternative");
    substituted = true;
    await assert.rejects(betterGenericOkxExitSwap(cfg, input, original), /assets or chain/);
  } finally { globalThis.fetch = originalFetch; }
});

test("OKX signing includes the exact path and query in the prehash", () => {
  const timestamp = "2026-08-03T12:34:56.789Z";
  const requestPath = "/api/v6/dex/aggregator/quote?chainIndex=196&amount=1";
  const expected = createHmac("sha256", "secret")
    .update(`${timestamp}GET${requestPath}`)
    .digest("base64");

  assert.equal(createOkxSignature("secret", timestamp, "GET", requestPath), expected);
});

test("OKX DEX headers use documented authentication and trim environment values", () => {
  const timestamp = "2026-08-03T12:34:56.789Z";
  const requestPath = "/api/v6/dex/aggregator/quote?chainIndex=196&amount=1";
  const headers = createOkxDexHeaders({
    OKX_API_KEY: " key ",
    OKX_SECRET_KEY: " secret ",
    OKX_PASSPHRASE: " passphrase ",
  }, timestamp, "GET", requestPath);

  assert.equal(headers["OK-ACCESS-KEY"], "key");
  assert.equal(headers["OK-ACCESS-PASSPHRASE"], "passphrase");
  assert.equal(headers["OK-ACCESS-PROJECT"], undefined);
  assert.equal(headers["OK-ACCESS-SIGN"], createOkxSignature("secret", timestamp, "GET", requestPath));
});

test("OKX DEX headers do not require a separate project ID", () => {
  assert.doesNotThrow(() => createOkxDexHeaders({
    OKX_API_KEY: "key",
    OKX_SECRET_KEY: "secret",
    OKX_PASSPHRASE: "passphrase",
  }, new Date().toISOString(), "GET", "/api/v6/dex/aggregator/quote"));
});

test("DeFi products must contain the exact selected-chain execution token", () => {
  const baseCbBtc = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
  const underlying = { tokenSymbol: "BTC", tokenAddress: baseCbBtc.toUpperCase() };

  assert.equal(matchesUnderlyingToken(underlying, "cbBTC", baseCbBtc), true);
  assert.equal(matchesUnderlyingToken(underlying, "BTC", "0x0000000000000000000000000000000000000001"), false);
  assert.equal(matchesUnderlyingToken(underlying, "BTC"), true);
});

test("trade catalogs coalesce concurrent requests and retain tokens beyond the old 1000-row cut", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ code: "0", data: Array.from({ length: 1100 }, (_, index) => ({ tokenContractAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`, tokenSymbol: `T${index}`, decimals: 18 })) });
  };
  try {
    const cfg = { hasOkxCredentials: true, OKX_BASE_URL: "https://example.test", OKX_API_KEY: "test", OKX_SECRET_KEY: "test", OKX_PASSPHRASE: "test" } as AppConfig;
    const [all, search] = await Promise.all([getOkxTradeTokens(cfg, "8453", "", 5000), getOkxTradeTokens(cfg, "8453", "LINK", 40)]);
    assert.equal(calls, 1);
    assert.ok(all.some(item => item.symbol === "T1099"));
    assert.equal(search[0].address, "0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196");
    assert.ok(!executionAssetAliases("ETH", "8453").includes("CBETH"));
  } finally { globalThis.fetch = original; }
});
