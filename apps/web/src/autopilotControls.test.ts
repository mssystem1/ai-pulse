import test from "node:test";
import assert from "node:assert/strict";
import { autopilotControlState } from "./autopilotControls.js";

const ready = { registered: true, storageReady: true, paused: true, funded: true, passRemainingMs: 3600000, signalsRemaining: 3, hasPosition: false };
test("only funded, registered, paused vaults with an entry pass can resume entries", () => {
  assert.equal(autopilotControlState(ready).resumeAllowed, true);
  for (const overrides of [{ registered: false }, { storageReady: false }, { funded: false }, { paused: false }, { paused: null }, { passRemainingMs: 0 }, { signalsRemaining: 0 }])
    assert.equal(autopilotControlState({ ...ready, ...overrides }).resumeAllowed, false);
});
test("incomplete setup and unavailable storage block payment; expired funded vaults can renew", () => {
  assert.equal(autopilotControlState({ ...ready, registered: false }).purchaseAllowed, false);
  assert.equal(autopilotControlState({ ...ready, storageReady: false }).purchaseAllowed, false);
  assert.equal(autopilotControlState({ ...ready, passRemainingMs: 0 }).purchaseAllowed, true);
});
test("an existing position can resume exit protection without buying another entry pass", () => {
  assert.equal(autopilotControlState({ ...ready, hasPosition: true, passRemainingMs: 0, signalsRemaining: 0 }).resumeAllowed, true);
});
