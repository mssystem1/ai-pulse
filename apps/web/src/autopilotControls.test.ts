import test from "node:test";
import assert from "node:assert/strict";
import { autopilotControlState, autopilotFundingState, autopilotDependencyKind } from "./autopilotControls.js";

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

test("Arc setup separates wallet capital from the Gateway pass balance", () => {
  const input = { network: "arc", depositRequired: 1, walletBalance: 1.1, needsPass: true, passPrice: 1.5, gatewayBalance: 1.5 };
  assert.deepEqual(autopilotFundingState(input), { requiredWalletFunds: 1, passFundingUnavailable: false, passFundingInsufficient: false });
  assert.equal(autopilotFundingState({ ...input, walletBalance: 10, gatewayBalance: 0.1 }).passFundingInsufficient, true);
  assert.equal(autopilotFundingState({ ...input, gatewayBalance: null }).passFundingUnavailable, true);
  assert.equal(autopilotFundingState({ ...input, walletBalance: null }).passFundingUnavailable, true);
  assert.equal(autopilotFundingState({ ...input, depositRequired: 0, needsPass: false, gatewayBalance: null }).passFundingUnavailable, false);
});

test("Base and Arbitrum continue reserving the pass and deposit in the wallet balance", () => {
  for (const network of ["base", "arbitrum"]) {
    const input = { network, depositRequired: 1, walletBalance: 2.5, needsPass: true, passPrice: 1.5, gatewayBalance: 100 };
    assert.deepEqual(autopilotFundingState(input), { requiredWalletFunds: 2.5, passFundingUnavailable: false, passFundingInsufficient: false });
    assert.equal(autopilotFundingState({ ...input, walletBalance: 1.1 }).passFundingInsufficient, true);
  }
});
test("Arc RPC 403 evidence errors are distinct from AI billing failures", () => {
  assert.equal(autopilotDependencyKind("Arc mainnet execution evidence is temporarily unavailable. Primary: contract bytecode: RPC HTTP 403."), "arc_execution");
  assert.equal(autopilotDependencyKind("Arc mainnet execution evidence is temporarily unavailable"), "arc_execution");
  assert.equal(autopilotDependencyKind("Grok API 403: provider credits exhausted"), "ai_provider");
  assert.equal(autopilotDependencyKind("Market RPC timeout"), "other");
});
