import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { receiptPauseState } from "./v6Store.js";

const owner = `0x${"1".repeat(40)}`;
const vault = `0x${"2".repeat(40)}`;
const receipt = { status: "0x1", from: owner, to: vault, logs: [{ address: vault, topics: [keccak256(toHex("Paused(bool)"))], data: toHex(1n, { size: 32 }) }] };
test("pass timing trusts the emitting vault and successful owner receipt, not browser labels", () => {
  assert.equal(receiptPauseState(receipt, owner, vault), true);
  assert.equal(receiptPauseState({ ...receipt, logs: [{ ...receipt.logs[0], data: toHex(0n, { size: 32 }) }] }, owner, vault), false);
  for (const overrides of [{ status: "0x0" }, { from: vault }, { to: owner }, { logs: [] }, { logs: [{ ...receipt.logs[0], address: owner }] }])
    assert.equal(receiptPauseState({ ...receipt, ...overrides }, owner, vault), null);
});
