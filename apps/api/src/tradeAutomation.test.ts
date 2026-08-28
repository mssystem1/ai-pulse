import test from "node:test";
import assert from "node:assert/strict";
import { bracketOrderStatus, normaliseRouteSymbol, normaliseSymbol, onchainOrderStatus } from "./tradeAutomation.js";
import { analysisSymbolForExecutionToken, executionAssetAliases } from "./okxDex.js";

test("normalises only explicit wrapped and bridged spot aliases", () => {
  assert.equal(normaliseSymbol("WETH"), "ETH");
  assert.equal(normaliseSymbol("wbtc"), "BTC");
  assert.equal(normaliseSymbol("USDC.e"), "USDC");
  assert.equal(normaliseSymbol("USDbC"), "USDC");
  assert.equal(normaliseSymbol("USD₮0"), "USDT0");
  assert.equal(normaliseSymbol("XTSLA"), "XTSLA");
});

test("route validation treats each chain's configured stable settlement as the report dollar quote", () => {
  assert.equal(normaliseRouteSymbol("USDT"), "USD_STABLE");
  assert.equal(normaliseRouteSymbol("USDC"), "USD_STABLE");
  assert.equal(normaliseRouteSymbol("USDT0"), "USD_STABLE");
  assert.equal(normaliseRouteSymbol("cbBTC"), "BTC");
});

test("keeps paused orders resumable instead of marking them cancelled", () => {
  assert.equal(onchainOrderStatus(1), "active");
  assert.equal(onchainOrderStatus(2), "paused");
  assert.equal(onchainOrderStatus(3), "filled");
  assert.equal(onchainOrderStatus(4), "cancelled");
});

test("maps OTOCO entry and protection phases without conflating them with receipts", () => {
  assert.equal(bracketOrderStatus(1), "active");
  assert.equal(bracketOrderStatus(2), "paused");
  assert.equal(bracketOrderStatus(3), "active");
  assert.equal(bracketOrderStatus(4), "paused");
  assert.equal(bracketOrderStatus(5), "filled");
  assert.equal(bracketOrderStatus(6), "cancelled");
});

test("maps analysis assets only to identity-safe chain representations", () => {
  assert.deepEqual(executionAssetAliases("BTC", "8453").slice(0, 2), ["CBBTC", "WBTC"]);
  assert.ok(executionAssetAliases("DOGE", "8453").includes("CBDOGE"));
  assert.deepEqual(executionAssetAliases("DOGE", "42161"), ["DOGE"]);
  assert.deepEqual(executionAssetAliases("DOGE", "196"), ["DOGE"]);
  assert.deepEqual(executionAssetAliases("SOL", "8453"), ["SOL"]);
  assert.deepEqual(executionAssetAliases("SOL", "196"), ["SOL", "XSOL"]);
  assert.deepEqual(executionAssetAliases("LINK", "42161"), ["LINK"]);
  assert.equal(analysisSymbolForExecutionToken("cbDOGE", "8453"), "DOGE");
  assert.equal(analysisSymbolForExecutionToken("WETH", "42161"), "ETH");
  assert.equal(analysisSymbolForExecutionToken("USD₮0", "196"), "USDT0");
  assert.equal(analysisSymbolForExecutionToken("xSOL", "196"), "SOL");
  assert.equal(analysisSymbolForExecutionToken("xBTC", "196"), "BTC");
  assert.equal(analysisSymbolForExecutionToken("xOKSOL", "196"), "XOKSOL");
});
