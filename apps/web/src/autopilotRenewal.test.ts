import test from "node:test";
import assert from "node:assert/strict";
import { PaidPassResumeError, renewAndResumeAutopilot } from "./autopilotRenewal";

test("successful pass purchase automatically requests resume only for a paused vault", async () => {
  const calls: string[] = [];
  const result = await renewAndResumeAutopilot({ pay: async () => { calls.push("pay"); return "expiry"; }, isPaused: async () => { calls.push("read"); return true; }, resume: async () => { calls.push("resume"); } });
  assert.deepEqual(calls, ["pay", "read", "resume"]);
  assert.equal(result.running, true);
  await renewAndResumeAutopilot({ pay: async () => "expiry", isPaused: async () => false, resume: async () => assert.fail("already running") });
});
test("failed payment never resumes, failed resume never repeats payment", async () => {
  await assert.rejects(renewAndResumeAutopilot({ pay: async () => { throw new Error("declined"); }, isPaused: async () => assert.fail("must not read"), resume: async () => assert.fail("must not resume") }), /declined/);
  let paid = 0;
  await assert.rejects(renewAndResumeAutopilot({ pay: async () => { paid++; return "retained expiry"; }, isPaused: async () => true, resume: async () => { throw new Error("wallet rejected"); } }), error => error instanceof PaidPassResumeError && error.expiresAt === "retained expiry");
  assert.equal(paid, 1);
});

test("unverifiable or changed checkout state retains the purchase without a resume attempt", async () => {
  let paid = 0;
  await assert.rejects(renewAndResumeAutopilot({
    pay: async () => { paid++; return "retained expiry"; },
    isPaused: async () => { throw new Error("selected wallet or vault changed"); },
    resume: async () => assert.fail("must not resume a changed context"),
  }), error => error instanceof PaidPassResumeError && /use Resume, not another payment/.test(error.message));
  assert.equal(paid, 1);
});
