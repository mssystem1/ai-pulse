import test from "node:test";
import assert from "node:assert/strict";
import { cashFlowAdjustedPnl } from "./autopilotStrategyStore.js";

test("a fully withdrawn vault does not report a synthetic -100 percent loss", () => {
  const result = cashFlowAdjustedPnl(0n, 500_000n, [
    { status: "confirmed", kind: "vault_withdraw", amount: "499956" },
  ]);
  assert.equal(result.pnlAtomic, -44n);
  assert.equal(result.pnlBasisAtomic, 500_000n);
  assert.equal(result.pnlPct, -0.0088);
});

test("later deposits increase the PnL denominator and are not profit", () => {
  const result = cashFlowAdjustedPnl(1_000_000n, 500_000n, [
    { status: "confirmed", kind: "vault_withdraw", amount: "499956" },
    { status: "confirmed", kind: "vault_fund", amount: "1000000" },
  ]);
  assert.equal(result.pnlAtomic, -44n);
  assert.equal(result.pnlBasisAtomic, 1_500_000n);
  assert.equal(result.pnlPct, -0.0029);
});
