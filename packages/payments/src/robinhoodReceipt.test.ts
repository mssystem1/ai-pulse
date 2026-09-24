import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex, type TransactionReceipt } from "viem";
import { robinhoodReceiptProof } from "./robinhoodReceipt.js";
import type { RobinhoodAttempt } from "./robinhoodSettlement.js";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";
const payer = `0x${"1".repeat(40)}` as Hex, payee = `0x${"2".repeat(40)}` as Hex;
const transaction = `0x${"a".repeat(64)}` as Hex, blockHash = `0x${"b".repeat(64)}` as Hex, nonce = `0x${"c".repeat(64)}` as Hex;
const attempt = { payer, payee, nonce, amount: "200000", transaction, fromBlock: "100" } as RobinhoodAttempt;
const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)", "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)"]);
function receipt() {
  const base = { address: CHAIN.asset, transactionHash: transaction, blockHash, removed: false };
  return { transactionHash: transaction, blockHash, blockNumber: 101n, status: "success", logs: [
    { ...base, topics: encodeEventTopics({ abi, eventName: "AuthorizationUsed", args: { authorizer: payer, nonce } }), data: "0x" },
    { ...base, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from: payer, to: payee } }), data: encodeAbiParameters([{ type: "uint256" }], [200000n]) },
  ] } as unknown as TransactionReceipt;
}
test("a USDG receipt must contain the exact authorization and transfer in the same successful transaction", () => {
  assert.deepEqual(robinhoodReceiptProof(attempt, receipt()), { transaction, blockHash, blockNumber: "101" });
  for (const remove of [0, 1]) {
    const wrong = receipt(); wrong.logs.splice(remove, 1);
    assert.equal(robinhoodReceiptProof(attempt, wrong), null);
  }
});
test("wrong token, amount, payer, payee, nonce and removed/cross-transaction logs never qualify", () => {
  for (const change of ["token", "amount", "payer", "payee", "nonce", "removed", "transaction", "block"]) {
    const wrong = receipt();
    if (change === "token") wrong.logs[1].address = payee;
    if (change === "amount") wrong.logs[1].data = encodeAbiParameters([{ type: "uint256" }], [199999n]);
    if (change === "payer") wrong.logs[1].topics = encodeEventTopics({ abi, eventName: "Transfer", args: { from: payee, to: payee } }) as [Hex, ...Hex[]];
    if (change === "payee") wrong.logs[1].topics = encodeEventTopics({ abi, eventName: "Transfer", args: { from: payer, to: payer } }) as [Hex, ...Hex[]];
    if (change === "nonce") wrong.logs[0].topics = encodeEventTopics({ abi, eventName: "AuthorizationUsed", args: { authorizer: payer, nonce: blockHash } }) as [Hex, ...Hex[]];
    if (change === "removed") wrong.logs[0].removed = true;
    if (change === "transaction") wrong.logs[0].transactionHash = blockHash;
    if (change === "block") wrong.logs[0].blockHash = transaction;
    assert.equal(robinhoodReceiptProof(attempt, wrong), null, change);
  }
});
test("reverted, older and different transaction receipts cannot credit a payment", () => {
  assert.equal(robinhoodReceiptProof(attempt, { ...receipt(), status: "reverted" }), null);
  assert.equal(robinhoodReceiptProof(attempt, { ...receipt(), blockNumber: 99n }), null);
  assert.equal(robinhoodReceiptProof({ ...attempt, transaction: blockHash }, receipt()), null);
});
