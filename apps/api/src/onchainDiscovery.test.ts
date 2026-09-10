import test from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import { readSnapshot } from "./onchainDiscovery.js";

const owner = `0x${"1".repeat(40)}`;
const token = `0x${"2".repeat(40)}`;
const address = (index: number) => `0x${index.toString(16).padStart(40, "0")}`;
const success = (result: unknown) => ({ status: "success", result });
function fixture(count: number, fail: string = "") {
  let calls = 0;
  const client = { multicall: async ({ contracts }: { contracts: Array<{ functionName: string; address: string }> }) => {
    calls++;
    return contracts.map(contract => {
      if (contract.functionName === fail) return { status: "failure", error: new Error("unavailable") };
      return success(contract.functionName === "vaultsOf" ? Array.from({ length: count }, (_, i) => address(i + 1))
        : contract.functionName === "accountOf" ? address(0)
        : contract.functionName === "settlementAsset" ? token
        : contract.functionName === "paused" ? true
        : contract.functionName === "balanceOf" ? 200000n
        : contract.functionName === "decimals" ? 6 : "USDC");
    });
  }} as unknown as PublicClient;
  return { client, calls: () => calls };
}
test("five accounts use three batches, preserving factory numbering", async () => {
  const f = fixture(5);
  const result = await readSnapshot("base", owner, f.client);
  assert.equal(f.calls(), 3);
  assert.deepEqual(result.vaults.map(v => v.address), [1,2,3,4,5].map(address));
  assert.equal(result.vaults[4].balanceAtomic, "200000");
});
test("more than 25 accounts remain visible in bounded batches", async () => {
  const f = fixture(41);
  const result = await readSnapshot("base", owner, f.client);
  assert.equal(result.vaults.length, 41);
  assert.equal(result.vaults[0].address, address(1));
  assert.equal(f.calls(), 7);
});
test("metadata failure cannot erase known balance or pause state", async () => {
  const f = fixture(5, "symbol");
  const result = await readSnapshot("base", owner, f.client);
  assert.equal(result.vaults[4].balanceAtomic, "200000");
  assert.equal(result.vaults[4].paused, true);
  assert.equal(result.vaults[4].settlementSymbol, null);
});
test("failed factory discovery is not reported as an empty wallet", async () => {
  await assert.rejects(readSnapshot("base", owner, fixture(5, "vaultsOf").client), /must not be treated as absent/);
});
