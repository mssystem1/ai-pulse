import test from "node:test";
import assert from "node:assert/strict";
import { analysisSymbolForExecutionToken, executionAssetAliases, executionSymbolRepresentsAnalysis } from "./okxDex.js";

test("X Layer OKB resolves to its ERC-20 wrapper before the native sentinel", () => {
  assert.deepEqual(executionAssetAliases("OKB", "196").slice(0, 2), ["WOKB", "OKB"]);
  assert.equal(analysisSymbolForExecutionToken("WOKB", "196"), "OKB");
});

test("X Layer and Arbitrum resolve only category-3 xStocks to execution symbols", () => {
  assert.equal(executionAssetAliases("XAAPL", "196", "tokenized_stock")[0], "AAPLX");
  assert.equal(executionAssetAliases("XSPY", "42161", "tokenized_etf")[0], "SPYX");
  assert.deepEqual(executionAssetAliases("XLM", "196", "crypto"), ["XLM"]);
  assert.equal(analysisSymbolForExecutionToken("AAPLx", "196", "Apple xStock"), "XAAPL");
  assert.equal(analysisSymbolForExecutionToken("SPYx", "42161", "SPDR S&P 500 ETF xStock"), "XSPY");
  assert.equal(analysisSymbolForExecutionToken("SNX", "42161", "Synthetix"), "SNX");
  assert.equal(executionSymbolRepresentsAnalysis("AAPLx", "XAAPL", "196", "tokenized_stock", "Apple xStock"), true);
  assert.equal(executionSymbolRepresentsAnalysis("SNX", "XSN", "42161", "crypto", "Synthetix"), false);
});

test("Base wrapped assets and tokenized stocks resolve to their OKX analysis symbols", () => {
  assert.deepEqual(executionAssetAliases("ZEC", "8453").slice(0, 2), ["CBZEC", "ZEC"]);
  assert.deepEqual(executionAssetAliases("HYPE", "8453").slice(0, 2), ["CBHYPE", "HYPE"]);
  assert.equal(analysisSymbolForExecutionToken("cbZEC", "8453"), "ZEC");
  assert.equal(analysisSymbolForExecutionToken("cbHYPE", "8453"), "HYPE");
  assert.equal(analysisSymbolForExecutionToken("NVDAc", "8453"), "XNVDA");
  assert.equal(analysisSymbolForExecutionToken("METAc", "8453"), "XMETA");
  assert.equal(analysisSymbolForExecutionToken("AAPLc", "8453"), "XAAPL");
  assert.equal(analysisSymbolForExecutionToken("GOOGLc", "8453"), "XGOOGL");
});
