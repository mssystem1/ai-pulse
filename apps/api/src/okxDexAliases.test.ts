import test from "node:test";
import assert from "node:assert/strict";
import { analysisSymbolForExecutionToken, executionAssetAliases } from "./okxDex.js";

test("X Layer OKB resolves to its ERC-20 wrapper before the native sentinel", () => {
  assert.deepEqual(executionAssetAliases("OKB", "196").slice(0, 2), ["WOKB", "OKB"]);
  assert.equal(analysisSymbolForExecutionToken("WOKB", "196"), "OKB");
});
