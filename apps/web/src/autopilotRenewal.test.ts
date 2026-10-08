import test from "node:test";
import assert from "node:assert/strict";
import { PaidPassResumeError, renewAndResumeAutopilot, autopilotSetupFailureState } from "./autopilotRenewal";

test("successful pass purchase automatically requests resume only for a paused vault", async () => {
  const calls: string[] = [];
  const result = await renewAndResumeAutopilot({ pay: async () => { calls.push("pay"); return "expiry"; }, isPaused: async () => { calls.push("read"); return true; }, resume: async () => { calls.push("resume"); } });
  assert.deepEqual(calls, ["pay", "read", "resume"]);
  assert.equal(result.running, true);
  await renewAndResumeAutopilot({ pay: async () => "expiry", isPaused: async () => false, resume: async () => assert.fail("already running") });
});

test("setup preserves paid/resumed outcomes when later synchronization fails", () => {
  assert.match(autopilotSetupFailureState({resumed:true,paid:true,safelyPaused:true}), /Resume was confirmed on-chain/);
  assert.doesNotMatch(autopilotSetupFailureState({resumed:true,paid:true,safelyPaused:true}), /remains paused/);
  assert.match(autopilotSetupFailureState({resumed:false,paid:true,safelyPaused:true}), /do not purchase another pass/);
  assert.match(autopilotSetupFailureState({resumed:false,paid:false,safelyPaused:true}), /remains paused/);
});

test("a preflight failure does not invent an existing running or paused vault", () => {
  const message = autopilotSetupFailureState({ resumed: false, paid: false, safelyPaused: false, setupStarted: false });
  assert.match(message, /Setup stopped during checks/);
  assert.doesNotMatch(message, /Pause the existing|remains paused/);
  assert.match(autopilotSetupFailureState({ resumed: false, paid: false, safelyPaused: false, setupStarted: true }), /Pause the existing/);
});
test("an interrupted vault-creation prompt does not invent a paused vault or advise duplicate creation", () => {
  const message = autopilotSetupFailureState({ resumed: false, paid: false, safelyPaused: true, setupStarted: true, vaultAvailable: false });
  assert.match(message, /Refresh the wallet transactions and account list/);
  assert.match(message, /reuse any account that was created/);
  assert.doesNotMatch(message, /Pause the existing|remains paused/);
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
