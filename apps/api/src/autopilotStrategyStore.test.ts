import test from "node:test";
import assert from "node:assert/strict";
import { decodeStrategyHash, mergeStrategyRuntime, reconcileStrategyExecution } from "./autopilotStrategyStore.js";

test("decodes both Upstash HGETALL response shapes", () => {
  const one = JSON.stringify({ id: "xlayer:one", pair: "SOL-USDT" });
  const two = JSON.stringify({ id: "base:two", pair: "ETH-USDT" });
  assert.deepEqual(decodeStrategyHash(["xlayer:one", one, "base:two", two]).map((item) => item.id), ["xlayer:one", "base:two"]);
  assert.deepEqual(decodeStrategyHash({ "xlayer:one": one }).map((item) => item.id), ["xlayer:one"]);
});

test("a stale worker result cannot roll back signed strategy configuration", () => {
  const current = {
    id: "xlayer:vault",
    pair: "SOL-USDT",
    timeframe: "15m",
    policy: { strategy: "breakout" },
    lastDecision: "hold_breakout",
  };
  const staleWorker = {
    id: "xlayer:vault",
    pair: "SOL-USDT",
    timeframe: "1D",
    policy: { strategy: "trend_following" },
    lastDecision: "buy_filled",
    evidenceHash: "0xproof",
  };
  assert.deepEqual(mergeStrategyRuntime(current, staleWorker), {
    ...current,
    lastDecision: "buy_filled",
    evidenceHash: "0xproof",
  });
});

test("runtime from a superseded signed configuration cannot latch an old exit", () => {
  const current = {
    id: "xlayer:vault",
    configurationHash: "0xnew",
    pair: "ETH-USDT",
    exitPending: false,
  };
  const staleWorker = {
    id: "xlayer:vault",
    configurationHash: "0xold",
    pair: "SOL-USDT",
    exitPending: true,
    lastDecision: "sell_partial_filled",
  };

  assert.deepEqual(mergeStrategyRuntime(current, staleWorker), current);
});

test("a current worker persists the independent fast-risk timestamp", () => {
  const current = { id: "xlayer:vault", configurationHash: "0xsame", lastRunAt: "analysis" };
  const incoming = { ...current, lastRiskCheckAt: "risk" };
  assert.deepEqual(mergeStrategyRuntime(current, incoming), incoming);
});

test("provider attempt and backoff state survive runtime merges", () => {
  const current = { id: "xlayer:vault", configurationHash: "0xsame" };
  const incoming = {
    ...current,
    lastAiAttemptAt: "2026-08-31T10:00:00.000Z",
    aiFailureStreak: 1,
    aiRetryAt: "2026-08-31T16:00:00.000Z",
    aiBudgetStatus: "provider_billing_blocked",
  };
  assert.deepEqual(mergeStrategyRuntime(current, incoming), incoming);
});

test("a slower concurrent cycle cannot overwrite newer runtime telemetry", () => {
  const current = {
    id: "xlayer:vault",
    configurationHash: "0xconfig",
    updatedAt: "2026-08-27T08:10:00.000Z",
    lastDecision: "sell_partial_filled",
    lastTxHash: "0xnew",
    exitPending: true,
  };
  const stale = {
    ...current,
    updatedAt: "2026-08-27T08:09:00.000Z",
    lastDecision: "hold_trend_following",
    lastTxHash: "0xold",
    exitPending: false,
  };
  assert.deepEqual(mergeStrategyRuntime(current, stale), current);
});

test("confirmed final sell heals stale partial-exit runtime after the vault closes", () => {
  const strategy = {
    id: "xlayer:vault",
    vault: "0x0000000000000000000000000000000000000001",
    lastRunAt: "2026-08-27T08:15:39.245Z",
    lastDecision: "hold_exit_cooldown",
    lastTxHash: "0xpartial",
    exitPending: false,
    activeTakeProfit: 103.16,
    activeStopLoss: 93.26,
  };
  const reconciled = reconcileStrategyExecution(strategy, [{
    status: "confirmed",
    source: "autopilot",
    kind: "sell_filled",
    account: strategy.vault,
    txHash: "0xfinal",
    createdAt: "2026-08-27T08:19:38.566Z",
  }], 0n);
  assert.equal(reconciled.lastDecision, "sell_filled");
  assert.equal(reconciled.lastTxHash, "0xfinal");
  assert.equal(reconciled.exitPending, false);
  assert.equal("activeTakeProfit" in reconciled, false);
  assert.equal("activeStopLoss" in reconciled, false);
});

test("partial sell remains latched while target capital is still on-chain", () => {
  const strategy = { id: "xlayer:vault", vault: "0x0000000000000000000000000000000000000001" };
  const reconciled = reconcileStrategyExecution(strategy, [{
    status: "confirmed", source: "autopilot", kind: "sell_partial_filled",
    account: strategy.vault, txHash: "0xpartial", createdAt: "2026-08-27T08:15:39.245Z",
  }], 10n);
  assert.equal(reconciled.lastDecision, "sell_partial_filled");
  assert.equal(reconciled.exitPending, true);
});

test("receipt-backed fills expose active entry and realized Autopilot prices", () => {
  const strategy = { id: "xlayer:vault", vault: "0x0000000000000000000000000000000000000001" };
  const buy = {
    status: "confirmed", source: "autopilot", kind: "buy_filled",
    account: strategy.vault, txHash: "0xbuy", createdAt: "2026-08-27T08:00:00.000Z", fillPrice: 2424.25,
  };
  const active = reconcileStrategyExecution(strategy, [buy], 10n);
  assert.equal(active.positionEntryPrice, 2424.25);
  assert.equal(active.lastEntryPrice, 2424.25);

  const closed = reconcileStrategyExecution(active, [buy, {
    status: "confirmed", source: "autopilot", kind: "sell_filled",
    account: strategy.vault, txHash: "0xsell", createdAt: "2026-08-27T09:00:00.000Z", fillPrice: 2448.5,
  }], 0n);
  assert.equal("positionEntryPrice" in closed, false);
  assert.equal(closed.lastExitPrice, 2448.5);
  assert.ok(Math.abs(Number(closed.realizedPositionPnlPct) - 1.0003) < 0.001);
});

test("concurrent runtime saves merge evaluation history instead of deleting a fill", () => {
  const current = {
    id: "xlayer:vault",
    updatedAt: "2026-08-27T08:19:38.566Z",
    evaluations: [{ id: "final", evaluatedAt: "2026-08-27T08:19:16.098Z", action: "sell" }],
  };
  const incoming = {
    id: "xlayer:vault",
    updatedAt: "2026-08-27T08:20:16.213Z",
    evaluations: [{ id: "partial", evaluatedAt: "2026-08-27T08:15:15.408Z", action: "sell" }],
  };
  assert.deepEqual(mergeStrategyRuntime(current, incoming).evaluations?.map((item) => item.id), ["partial", "final"]);
});
