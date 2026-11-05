import test from "node:test";
import assert from "node:assert/strict";
import { terminalUsdAtomic, parseTerminalPlans } from "./terminalPricing.js";

test("Terminal amounts retain precision for independently configurable pass prices", () => {
  assert.equal(terminalUsdAtomic("1.5"), "1500000");
  assert.equal(terminalUsdAtomic("10.500001"), "10500001");
  assert.equal(terminalUsdAtomic("0.000001"), "1");
  for (const price of ["0", "-1", "1e2", "1.0000001", "NaN", " 1.5", "01.5", "Infinity"]) assert.throws(() => terminalUsdAtomic(price));
});
test("published durations cannot be silently duplicated or replaced", () => {
  const plan = { duration:"7d", priceUsd:"12.25", durationMs:604800000 };
  assert.deepEqual(parseTerminalPlans([plan]),[plan]);
  assert.deepEqual(parseTerminalPlans([plan,plan]),[]);
  assert.deepEqual(parseTerminalPlans([{...plan,durationMs:1}]),[]);
  assert.deepEqual(parseTerminalPlans([{...plan,duration:"lifetime"}]),[]);
  assert.deepEqual(parseTerminalPlans([{...plan,priceUsd:10.5}]),[]);
});
