import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";
import { settleRobinhoodPayment, USDG_AUTHORIZATION_TYPES, USDG_DOMAIN, type RobinhoodAttempt, type RobinhoodJournal, type RobinhoodObserver } from "./robinhoodSettlement.js";

// Public deterministic fixture key; never loaded from an operator environment.
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const payee = `0x${"2".repeat(40)}` as const;
const transaction = `0x${"a".repeat(64)}` as const;
const blockHash = `0x${"b".repeat(64)}` as const;
const now = 1_800_000_000_000;
const requirements: PaymentRequirements = { scheme: "exact", network: CHAIN.network, asset: CHAIN.asset, amount: "200000", payTo: payee,
  maxTimeoutSeconds: 120, extra: { name: CHAIN.name, version: CHAIN.version } };
const resourceUrl = "http://localhost:4000/robinhood/v1/preflight";
async function input() {
  const authorization = { from: account.address, to: payee, value: "200000", validAfter: "0", validBefore: String(now / 1000 + 120), nonce: `0x${"c".repeat(64)}` as const };
  const signature = await account.signTypedData({ domain: USDG_DOMAIN, types: USDG_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: 0n, validBefore: BigInt(authorization.validBefore) } });
  const header = Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: resourceUrl }, accepted: requirements, payload: { authorization, signature } })).toString("base64");
  return { header, requirements, resourceUrl, requestHash: "d".repeat(64), provider: "primer" };
}
class MemoryJournal implements RobinhoodJournal {
  rows = new Map<string, RobinhoodAttempt>();
  async get(id: string) { return structuredClone(this.rows.get(id) || null); }
  async claim(attempt: RobinhoodAttempt) {
    if (this.rows.has(attempt.id)) return false;
    this.rows.set(attempt.id, structuredClone(attempt)); return true;
  }
  async replace(previous: RobinhoodAttempt, next: RobinhoodAttempt) {
    if (JSON.stringify(this.rows.get(previous.id)) !== JSON.stringify(previous)) return false;
    this.rows.set(next.id, structuredClone(next)); return true;
  }
}
function fixture() {
  const journal = new MemoryJournal();
  let submitted = 0, verified = 0, chainPaid = false;
  const observer: RobinhoodObserver = { currentBlock: async () => 100n,
    proof: async () => chainPaid ? { transaction, blockHash, blockNumber: "101" } : null };
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({ kinds: [], extensions: [], signers: {} }),
    verify: async () => { verified++; return { isValid: true }; },
    settle: async () => { submitted++; chainPaid = true; return { success: true, transaction, network: CHAIN.network }; },
  };
  return { journal, observer, facilitator, now: () => now, submitted: () => submitted, verified: () => verified,
    paid: () => { chainPaid = true; } };
}

test("concurrent replays submit once, persist no signature, and recover after authorization expiry", async () => {
  const deps = fixture(), request = await input();
  const results = await Promise.all(Array.from({ length: 8 }, () => settleRobinhoodPayment(request, deps)));
  assert.equal(deps.submitted(), 1);
  assert.ok(results.every(result => result.status === "settled" || result.status === "pending"));
  assert.equal((await settleRobinhoodPayment(request, { ...deps, now: () => now + 86400_000 })).status, "settled");
  assert.equal(deps.submitted(), 1);
  assert.doesNotMatch(JSON.stringify([...deps.journal.rows.values()]), /signature|authorization|accepted/);
});
test("a lost settlement response recovers by nonce without resubmission", async () => {
  const deps = fixture(); let calls = 0;
  deps.facilitator.settle = async () => { calls++; deps.paid(); throw new Error("Response lost after transfer"); };
  const request = await input();
  assert.equal((await settleRobinhoodPayment(request, deps)).status, "settled");
  assert.equal((await settleRobinhoodPayment(request, deps)).status, "settled");
  assert.equal(calls, 1);
});
test("unknown submission stays pending across provider changes and retry, never a fresh charge", async () => {
  const deps = fixture(); let calls = 0;
  deps.facilitator.settle = async () => { calls++; throw new Error("Timeout"); };
  const request = await input();
  assert.equal((await settleRobinhoodPayment(request, deps)).status, "pending");
  assert.equal((await settleRobinhoodPayment({ ...request, provider: "aeron" }, deps)).status, "pending");
  assert.equal(calls, 1);
  deps.paid();
  assert.equal((await settleRobinhoodPayment(request, deps)).status, "settled");
});
test("provider success without independent proof never delivers paid service", async () => {
  const deps = fixture();
  deps.facilitator.settle = async () => ({ success: true, transaction, network: CHAIN.network });
  assert.equal((await settleRobinhoodPayment(await input(), deps)).status, "pending");
});
test("request substitution and payload re-encoding cannot use the same authorization twice", async () => {
  const deps = fixture(), request = await input();
  await settleRobinhoodPayment(request, deps);
  assert.deepEqual(await settleRobinhoodPayment({ ...request, requestHash: "e".repeat(64) }, deps), { status: "rejected", code: "payment_conflict" });
  const pretty = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(request.header, "base64").toString()), null, 2)).toString("base64");
  assert.deepEqual(await settleRobinhoodPayment({ ...request, header: pretty }, deps), { status: "rejected", code: "payment_conflict" });
  assert.equal(deps.submitted(), 1);
});
test("forged authorizations cannot claim a nonce or reach the provider", async () => {
  const request = await input();
  for (const change of ["signature", "chain", "amount", "payee", "resource"]) {
    const deps = fixture(); const payload = JSON.parse(Buffer.from(request.header, "base64").toString());
    if (change === "signature") payload.payload.signature = `0x${"0".repeat(130)}`;
    if (change === "chain") payload.accepted.network = "eip155:8453";
    if (change === "amount") payload.payload.authorization.value = "1";
    if (change === "payee") payload.payload.authorization.to = account.address;
    if (change === "resource") payload.resource.url = "https://attacker.invalid";
    assert.equal((await settleRobinhoodPayment({ ...request, header: Buffer.from(JSON.stringify(payload)).toString("base64") }, deps)).status, "rejected");
    assert.equal(deps.verified(), 0); assert.equal(deps.submitted(), 0); assert.equal(deps.journal.rows.size, 0);
  }
});
test("durable store unavailable before submission cannot move funds", async () => {
  const deps = fixture(); deps.journal.claim = async () => { throw new Error("Store unavailable"); };
  assert.deepEqual(await settleRobinhoodPayment(await input(), deps), { status: "unavailable", code: "payment_state_unavailable" });
  assert.equal(deps.submitted(), 0);
});
test("store outage after a transfer recovers on retry without another submission", async () => {
  const deps = fixture(), request = await input();
  const replace = deps.journal.replace.bind(deps.journal);
  deps.journal.replace = async () => { throw new Error("Durability unavailable"); };
  assert.equal((await settleRobinhoodPayment(request, deps)).status, "unavailable");
  assert.equal(deps.submitted(), 1);
  deps.journal.replace = replace;
  assert.equal((await settleRobinhoodPayment(request, deps)).status, "settled");
  assert.equal(deps.submitted(), 1);
});
test("verification outage or an expired fresh authorization never settles", async () => {
  const request = await input(); const deps = fixture();
  deps.facilitator.verify = async () => { throw new Error("No provider"); };
  assert.equal((await settleRobinhoodPayment(request, deps)).status, "unavailable");
  assert.deepEqual(await settleRobinhoodPayment(request, { ...deps, now: () => now + 86400_000 }), { status: "rejected", code: "payment_expired" });
  assert.equal(deps.submitted(), 0);
});
