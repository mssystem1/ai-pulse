import assert from "node:assert/strict";
import test from "node:test";
import { parseEther } from "viem";
import { arcExecutionFees } from "./arcExecutionFees.js";

test("Arc keeper gas is bounded in 18-decimal USDC and retains a wallet reserve", async () => {
  let balance = parseEther("0.1"), gas = 100000n;
  const client = { estimateFeesPerGas: async () => ({ maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => gas, getBalance: async () => balance };
  const tx = { account: `0x${"1".repeat(40)}` as const, to: `0x${"2".repeat(40)}` as const, data: "0x1234" as const };
  const prepared = await arcExecutionFees(client, tx);
  assert.equal(prepared.gas * prepared.maxFeePerGas, parseEther("0.0125"));
  balance = parseEther("0.06");
  await assert.rejects(() => arcExecutionFees(client, tx), /reserve/);
  balance = parseEther("5"); gas = 2000000n;
  await assert.rejects(() => arcExecutionFees(client, tx), /gas limit/);
});
