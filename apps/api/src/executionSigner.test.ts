import test from "node:test";
import assert from "node:assert/strict";
import { executionSignerKey, hasExecutionSigner } from "./executionSigner.js";

const arc = `0x${"1".repeat(64)}`, shared = `0x${"2".repeat(64)}`, qualification = `0x${"3".repeat(64)}`;
test("Arc's dedicated execution key cannot replace another network's signer", () => {
  const cfg = { ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: arc, AUTOMATION_EXECUTOR_PRIVATE_KEY: shared, TEST_WALLET_PRIVATE_KEY: qualification };
  assert.equal(executionSignerKey(cfg, "arc"), arc);
  for (const network of ["xlayer", "base", "arbitrum", "robinhood"] as const) assert.equal(executionSignerKey(cfg, network), shared);
  assert.equal(hasExecutionSigner({ ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: arc }), true);
  assert.equal(executionSignerKey({ ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: arc }, "base"), "");
});
test("empty Arc settings preserve existing shared and qualification configuration", () => {
  assert.equal(executionSignerKey({ ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: "", AUTOMATION_EXECUTOR_PRIVATE_KEY: shared }, "arc"), shared);
  assert.equal(executionSignerKey({ TEST_WALLET_PRIVATE_KEY: qualification }, "arc"), qualification);
  assert.equal(executionSignerKey({}, "arc"), "");
  assert.equal(hasExecutionSigner({}), false);
});
test("an invalid explicitly configured Arc key is never replaced by another signer", () => {
  const cfg = { ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: "invalid", AUTOMATION_EXECUTOR_PRIVATE_KEY: shared };
  assert.equal(executionSignerKey(cfg, "arc"), "invalid");
  assert.equal(executionSignerKey(cfg, "base"), shared);
  assert.equal(hasExecutionSigner({ ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: "invalid" }), false);
});
