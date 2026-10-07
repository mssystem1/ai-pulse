import test from "node:test";
import assert from "node:assert/strict";
import { walletErrorMessage } from "./walletErrors";
test("mobile wallet object errors disclose the message instead of object Object", () => {
  assert.equal(walletErrorMessage({ message: { message: "Insufficient funds for gas" } }), "Insufficient funds for gas");
  assert.equal(walletErrorMessage({ message: "[object Object]", data: { originalError: { message: "Unsupported chain" } } }), "Unsupported chain");
  assert.match(walletErrorMessage({ code: 4001 }), /declined/);
  assert.match(walletErrorMessage({ code: -32601 }), /does not support/);
  const circular: Record<string, unknown> = {}; circular.message = circular;
  assert.equal(walletErrorMessage(circular, "Reconnect wallet"), "Reconnect wallet");
});
