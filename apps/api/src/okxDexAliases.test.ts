import test from "node:test";
import assert from "node:assert/strict";
import { analysisSymbolForExecutionToken, executionAssetAliases } from "./okxDex.js";

test("X Layer OKB resolves to its ERC-20 wrapper before the native sentinel", () => {
  assert.deepEqual(executionAssetAliases("OKB", "196").slice(0, 2), ["WOKB", "OKB"]);
  assert.equal(analysisSymbolForExecutionToken("WOKB", "196"), "OKB");
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
