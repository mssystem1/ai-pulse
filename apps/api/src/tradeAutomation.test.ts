import test from "node:test";
import assert from "node:assert/strict";
import { bracketOrderStatus, normaliseRouteSymbol, normaliseSymbol, onchainOrderStatus, reconcileOrderLifecycle } from "./tradeAutomation.js";
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

test("vault-capable aliases prioritize ERC-20 custody forms on every execution chain", () => {
  assert.deepEqual(executionAssetAliases("OKB", "196").slice(0, 2), ["WOKB", "OKB"]);
  assert.equal(executionAssetAliases("ETH", "196")[0], "WETH");
  assert.equal(executionAssetAliases("ETH", "8453")[0], "WETH");
  assert.equal(executionAssetAliases("ETH", "42161")[0], "WETH");
  assert.equal(executionAssetAliases("BTC", "196")[0], "XBTC");
  assert.equal(executionAssetAliases("BTC", "8453")[0], "CBBTC");
  assert.equal(executionAssetAliases("BTC", "42161")[0], "WBTC");
  // Every other OKX catalog token remains dynamically addressable by its own
  // symbol; it is not limited to this wrapped-asset alias table.
  assert.deepEqual(executionAssetAliases("PEPE", "8453"), ["PEPE"]);
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

test("reconciles every contract lifecycle without regressing final or protected orders", () => {
  assert.deepEqual(reconcileOrderLifecycle("bracket-v1", 1), { status: "active", phase: "entry", onchainState: 1 });
  assert.deepEqual(reconcileOrderLifecycle("bracket-v1", 3), { status: "active", phase: "protected", onchainState: 3 });
  assert.deepEqual(reconcileOrderLifecycle("bracket-v1", 5), { status: "filled", phase: "complete", onchainState: 5 });
  assert.deepEqual(reconcileOrderLifecycle("bracket-v1", 6), { status: "cancelled", phase: "complete", onchainState: 6 });
  assert.deepEqual(
    reconcileOrderLifecycle("bracket-v1", 1, { status: "filled", phase: "entry", onchainState: 1 }),
    { status: "filled", phase: "complete", onchainState: 5 },
  );
  assert.deepEqual(
    reconcileOrderLifecycle("bracket-v1", 1, { status: "active", phase: "protected", onchainState: 3 }),
    { status: "active", phase: "protected", onchainState: 3 },
  );
  assert.deepEqual(reconcileOrderLifecycle("oco-v1", 4), { status: "cancelled", phase: "complete", onchainState: 4 });
  assert.deepEqual(reconcileOrderLifecycle("limit-v2", 3), { status: "filled", phase: "complete", onchainState: 3 });
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
