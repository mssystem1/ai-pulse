import test from "node:test";
import assert from "node:assert/strict";
import { applyConfirmedPassPause, autopilotPassRemainingMs, consumePassSignal, extendAutopilotPass, transitionPassPause } from "./autopilotPassStore.js";

const input = { owner: "0xowner", network: "base" as const, vault: "0xvault", days: 1 as const, paused: false };
const start = Date.parse("2026-09-08T18:00:00Z");
const hour = 3_600_000;

test("cached AI confirmation is consumed once; new signals still enforce the limit", () => {
  let pass = extendAutopilotPass(null, input, start);
  pass = consumePassSignal(pass, input.owner, "signal-a", start + hour).pass!;
  assert.equal(pass.signalsUsed, 1);
  assert.deepEqual(consumePassSignal(pass, input.owner, "signal-a", start + hour).pass, pass);
  pass = consumePassSignal(pass, input.owner, "signal-b", start + hour).pass!;
  pass = consumePassSignal(pass, input.owner, "signal-c", start + hour).pass!;
  assert.equal(consumePassSignal(pass, input.owner, "signal-d", start + hour).reason, "signals_exhausted");
  assert.equal(consumePassSignal(pass, "other-owner", "signal-a", start + hour).reason, "pass_expired");
  assert.equal(consumePassSignal(pass, input.owner, "signal-a", start + 25 * hour).reason, "pass_expired");
  assert.equal(consumePassSignal(transitionPassPause(pass, true, start + hour), input.owner, "signal-a", start + 2 * hour).reason, "pass_expired");
});

test("24 hours means elapsed runtime, not midnight or signal quota", () => {
  const pass = extendAutopilotPass(null, input, start);
  assert.equal(autopilotPassRemainingMs({ ...pass, signalsUsed: 3 }, start + 16 * hour), 8 * hour);
});
test("manual pause holds remaining time across days, resume continues it", () => {
  const pass = extendAutopilotPass(null, input, start);
  const paused = transitionPassPause(pass, true, start + 4 * hour);
  assert.equal(autopilotPassRemainingMs(paused, start + 100 * hour), 20 * hour);
  const resumed = transitionPassPause(paused, false, start + 100 * hour);
  assert.equal(autopilotPassRemainingMs(resumed, start + 102 * hour), 18 * hour);
});
test("renewal adds remaining time and rejects stale pause observations", () => {
  const pass = extendAutopilotPass(null, input, start);
  const renewed = extendAutopilotPass(pass, input, start + 4 * hour);
  assert.equal(autopilotPassRemainingMs(renewed, start + 4 * hour), 44 * hour);
  assert.deepEqual(transitionPassPause(renewed, true, start + 2 * hour), renewed);
});
test("renewing an expired, paused pass grants a complete new day", () => {
  const old = transitionPassPause(extendAutopilotPass(null, input, start), true, start + 30 * hour);
  const renewed = extendAutopilotPass(old, { ...input, paused: true }, start + 100 * hour);
  assert.equal(autopilotPassRemainingMs(renewed, start + 200 * hour), 24 * hour);
});

test("delayed receipt indexing restores paused time and is replay-safe", () => {
  const initial = extendAutopilotPass(null, input, start);
  const observed = transitionPassPause(initial, true, start + 6 * hour);
  const pause = { txHash: "pause", paused: true, at: start + 4 * hour };
  const corrected = applyConfirmedPassPause(observed, pause);
  assert.equal(autopilotPassRemainingMs(corrected, start + 100 * hour), 20 * hour);
  const resume = { txHash: "resume", paused: false, at: start + 100 * hour };
  const resumed = applyConfirmedPassPause(corrected, resume);
  assert.equal(autopilotPassRemainingMs(resumed, start + 102 * hour), 18 * hour);
  assert.deepEqual(applyConfirmedPassPause(resumed, pause), resumed);
  assert.deepEqual(applyConfirmedPassPause(applyConfirmedPassPause(initial, resume), pause), resumed);
});

test("verified pre-renewal events cannot alter a new pass's baseline", () => {
  const pass = extendAutopilotPass(null, input, start + 10 * hour);
  assert.deepEqual(applyConfirmedPassPause(pass, { txHash: "old", paused: true, at: start }), pass);
});
