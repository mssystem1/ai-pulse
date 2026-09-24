import assert from "node:assert/strict";
import test from "node:test";
import { paidReplayRecoveryToken, verifyPaidReplayRecoveryToken } from "./paidJobRecovery.js";
import type { AnalysisJob } from "./jobs.js";
const secret = Buffer.alloc(32, 7).toString("base64url");
const job = { id: "fixture", network: "eip155:4663", idempotencyKey: "request",
  receipt: { settlementResult: "settled", authorizationId: "signed-payment", payer: "buyer", payee: "merchant" },
} as AnalysisJob;
test("receipt-bound reissued tokens are stable and verify without replacing original recovery", () => {
  const token = paidReplayRecoveryToken(job, secret)!;
  assert.equal(paidReplayRecoveryToken(job, secret), token);
  assert.equal(verifyPaidReplayRecoveryToken(job, token, secret), true);
  assert.equal(verifyPaidReplayRecoveryToken({ ...job, id: "other-job" }, token, secret), false);
  assert.equal(verifyPaidReplayRecoveryToken({ ...job, network: "eip155:8453" }, token, secret), false);
  assert.equal(verifyPaidReplayRecoveryToken(job, token, Buffer.alloc(32, 8).toString("base64url")), false);
  assert.equal(verifyPaidReplayRecoveryToken(job, `${token}x`, secret), false);
});
test("unsettled jobs and absent server secret cannot issue paid replay recovery", () => {
  assert.equal(paidReplayRecoveryToken({ ...job, receipt: null }, secret), undefined);
  assert.equal(paidReplayRecoveryToken(job, ""), undefined);
  assert.equal(verifyPaidReplayRecoveryToken(job, "", secret), false);
});
