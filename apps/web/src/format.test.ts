import test from "node:test";
import assert from "node:assert/strict";
import { formatTokenBalance } from "./format";
test("human token balances preserve small positive values without raw-unit displays", () => {
  assert.equal(formatTokenBalance(0.001128, "en"), "0.001128");
  assert.equal(formatTokenBalance(1e-18, "en"), "<0.000001");
  assert.equal(formatTokenBalance(0, "en"), "0");
  assert.equal(formatTokenBalance(NaN, "en"), "—");
});
