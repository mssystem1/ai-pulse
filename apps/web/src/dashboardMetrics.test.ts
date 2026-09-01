import test from "node:test";
import assert from "node:assert/strict";
import { aggregateAutopilotMetrics, assessBalanceAmount, averageKnownPnl, confirmedAutopilotExecutionCounts, countExecutedAutopilotFills, hasProtectedAutopilotPosition, selectedAutopilotStrategy } from "./dashboardMetrics.js";

const protectedStrategy = {
  status: "active",
  paused: false,
  targetBalance: "1035205",
  activeTakeProfit: 103.16,
  activeStopLoss: 93.26,
  lastTxHash: "0xbuy",
};

test("a protected Autopilot buy is active, not executed", () => {
  assert.equal(hasProtectedAutopilotPosition(protectedStrategy), true);
  assert.equal(countExecutedAutopilotFills([
    { status: "confirmed", kind: "buy_filled", txHash: "0xbuy" },
  ], [protectedStrategy]), 0);
});

test("closed Autopilot fills move into executed history", () => {
  const closed = { ...protectedStrategy, targetBalance: "0", activeTakeProfit: undefined, activeStopLoss: undefined, lastTxHash: "0xsell" };
  assert.equal(countExecutedAutopilotFills([
    { status: "confirmed", kind: "buy_filled", txHash: "0xbuy" },
    { status: "confirmed", kind: "sell_filled", txHash: "0xsell" },
  ], [closed]), 2);
});

test("a partial exit does not relabel the still-protected entry as executed", () => {
  const partiallyExited = {
    ...protectedStrategy,
    targetBalance: "517602",
    lastTxHash: "0xpartial-sell",
    evaluations: [
      { action: "buy" as const, status: "filled" as const, txHash: "0xbuy" },
      { action: "sell" as const, status: "filled" as const, txHash: "0xpartial-sell" },
    ],
  };
  assert.equal(countExecutedAutopilotFills([
    { status: "confirmed", kind: "buy_filled", txHash: "0xbuy" },
    { status: "confirmed", kind: "sell_partial_filled", txHash: "0xpartial-sell" },
  ], [partiallyExited]), 0);
});

test("confirmed vault activity repairs stale Autopilot Buy and Sell counters in the UI", () => {
  const vault = "0x1111111111111111111111111111111111111111";
  const counts = confirmedAutopilotExecutionCounts([
    { id: "buy", source: "autopilot", account: vault, status: "confirmed", kind: "buy_filled", txHash: "0xbuy", createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "buy-copy", source: "autopilot", account: vault, status: "confirmed", kind: "buy_filled", txHash: "0xbuy", createdAt: "2026-08-01T00:00:01.000Z" },
    { id: "partial", source: "autopilot", account: vault, status: "confirmed", kind: "sell_partial_filled", txHash: "0xpartial", createdAt: "2026-08-01T00:01:00.000Z" },
    { id: "sell", source: "autopilot", account: vault, status: "confirmed", kind: "sell_filled", txHash: "0xsell", createdAt: "2026-08-01T00:02:00.000Z" },
    { id: "other", source: "autopilot", account: "0x2222222222222222222222222222222222222222", status: "confirmed", kind: "buy_filled", txHash: "0xother", createdAt: "2026-08-01T00:03:00.000Z" },
  ], vault);
  assert.equal(counts.buyCount, 1);
  assert.equal(counts.sellCount, 2);
  assert.deepEqual(counts.executions.map((item) => item.txHash), ["0xsell", "0xpartial", "0xbuy"]);
});

test("dashboard PnL includes every known Spot and Autopilot value", () => {
  assert.equal(averageKnownPnl([null, 1, -0.5]), 0.25);
  assert.equal(averageKnownPnl([null, undefined]), null);
});

test("multi-agent Autopilot totals aggregate capital and cash-flow-adjusted PnL", () => {
  assert.deepEqual(aggregateAutopilotMetrics([
    { status: "active", portfolioValueAtomic: "500000", baselineValueAtomic: "500000", pnlAtomic: "0" },
    { status: "active", portfolioValueAtomic: "499000", baselineValueAtomic: "500000", pnlAtomic: "-1000" },
    { status: "active", portfolioValueAtomic: "501500", baselineValueAtomic: "500000", pnlAtomic: "1500" },
  ]), {
    portfolioValueAtomic: "1500500",
    pnlAtomic: "500",
    pnlPct: 0.0333,
  });
});

test("aggregate PnL uses gross contributed capital, not the post-withdrawal remainder", () => {
  assert.deepEqual(aggregateAutopilotMetrics([
    { status: "active", portfolioValueAtomic: "0", baselineValueAtomic: "500000", pnlBasisAtomic: "500000", pnlAtomic: "-44" },
    { status: "active", portfolioValueAtomic: "500000", baselineValueAtomic: "1000000", pnlBasisAtomic: "1000000", pnlAtomic: "-93542" },
  ]), {
    portfolioValueAtomic: "500000",
    pnlAtomic: "-93586",
    pnlPct: -6.239,
  });
});

test("malformed strategy telemetry does not stale the multi-agent dashboard", () => {
  assert.deepEqual(aggregateAutopilotMetrics([
    { status: "active", portfolioValueAtomic: "not-a-number", baselineValueAtomic: "500000", pnlAtomic: null },
    { status: "active", portfolioValueAtomic: "500000", baselineValueAtomic: "500000", pnlAtomic: "0" },
  ]), {
    portfolioValueAtomic: "500000",
    pnlAtomic: "0",
    pnlPct: 0,
  });
});

test("capital actions fail closed until the correct source balance is known", () => {
  assert.equal(assessBalanceAmount("0", "500000"), "empty");
  assert.equal(assessBalanceAmount("100000", null), "balance_unavailable");
  assert.equal(assessBalanceAmount("600000", "500000"), "insufficient");
  assert.equal(assessBalanceAmount("500000", "500000"), "ready");
});

test("a stale runtime strategy cannot masquerade as the currently selected Autopilot", () => {
  const strategies = [{ vault: "0xAAA", status: "active" }];
  assert.equal(selectedAutopilotStrategy(strategies, ""), undefined);
  assert.equal(selectedAutopilotStrategy(strategies, "0xBBB"), undefined);
  assert.equal(selectedAutopilotStrategy(strategies, "0xaaa"), strategies[0]);
});
