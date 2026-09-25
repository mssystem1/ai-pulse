import test from "node:test";
import assert from "node:assert/strict";
import { autopilotExecutionFailure, pendingAutopilotTrade, verifiedAutopilotReceipt } from "./autopilotExecutionRecovery.js";
import { keccak256, toHex } from "viem";

test("executor-signed receipts require a factory-owned vault and its execution event", () => {
  const vault = "0x1234";
  const receipt = { status: "0x1", to: vault, logs: [{ address: vault, topics: [keccak256(toHex("Executed(bytes32,address,uint256,address,address,uint256,uint256,bytes32)"))] }] };
  assert.equal(verifiedAutopilotReceipt(receipt, vault, [vault]), true);
  assert.equal(verifiedAutopilotReceipt(receipt, vault, []), false);
  assert.equal(verifiedAutopilotReceipt({ ...receipt, to: "0xabcd" }, vault, [vault]), false);
  assert.equal(verifiedAutopilotReceipt({ ...receipt, status: "0x0" }, vault, [vault]), false);
  assert.equal(verifiedAutopilotReceipt({ ...receipt, logs: [] }, vault, [vault]), false);
  assert.equal(verifiedAutopilotReceipt({ ...receipt, logs: [{ ...receipt.logs[0], address: "0xabcd" }] }, vault, [vault]), false);
});

test("execution failures distinguish unknown receipts, confirmed fills and reverted transactions", () => {
  assert.equal(autopilotExecutionFailure("submitted", true).lastDecision, "hold_receipt_pending");
  assert.match(autopilotExecutionFailure("submitted", false).reason, /does not prove/);
  assert.equal(autopilotExecutionFailure("confirmed", true).lastDecision, "hold_execution_recovery");
  assert.match(autopilotExecutionFailure("confirmed", false).reason, /trade was confirmed/);
  assert.match(autopilotExecutionFailure("reverted", false).reason, /fees may still/);
  assert.equal(autopilotExecutionFailure("not_submitted", true).lastDecision, "hold_dependency_retry");
  assert.equal(autopilotExecutionFailure("not_submitted", false).lastDecision, "hold_failed_closed");
});

test("pending trade guard is scoped to the exact owner, network and vault", () => {
  const strategy = { owner: "0xAB", network: "robinhood", vault: "0xCD" };
  const pending = { owner: "0xab", network: "robinhood", account: "0xcd", source: "autopilot", status: "pending", kind: "buy_filled", txHash: `0x${"1".repeat(64)}` };
  assert.equal(pendingAutopilotTrade([pending], strategy), pending);
  for (const change of [{ owner: "0xef" }, { network: "base" }, { account: "0xef" }, { source: "wallet" }, { status: "confirmed" }, { status: "failed" }, { kind: "oracle_price_update" }, { txHash: undefined }])
    assert.equal(pendingAutopilotTrade([{ ...pending, ...change }], strategy), undefined);
  for (const kind of ["sell_filled", "sell_partial_filled"])
    assert.ok(pendingAutopilotTrade([{ ...pending, kind }], strategy));
});
