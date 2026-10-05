import test from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import { getOnchainAccountSnapshot, normalizeExecutionRpcUrls, readSnapshot } from "./onchainDiscovery.js";
import { executionContractAddress } from "./executionContracts.js";

test("retired Base RPC is replaced even in explicit environment configuration", () => {
  assert.deepEqual(normalizeExecutionRpcUrls("base", [" https://1rpc.io/base/ ", "https://base-rpc.publicnode.com", ""]), ["https://base-rpc.publicnode.com"]);
  assert.deepEqual(normalizeExecutionRpcUrls("base", ["https://private.example/rpc", "https://mainnet.base.org"]), ["https://private.example/rpc", "https://mainnet.base.org"]);
  assert.deepEqual(normalizeExecutionRpcUrls("arbitrum", ["https://1rpc.io/arb"]), ["https://1rpc.io/arb"]);
});

const owner = `0x${"1".repeat(40)}`;
const token = `0x${"2".repeat(40)}`;
const address = (index: number) => `0x${index.toString(16).padStart(40, "0")}`;
const success = (result: unknown) => ({ status: "success", result });
function fixture(count: number, fail: string = "", options: {
  chainId?: number; failedFactory?: string; accountValue?: unknown; vaultValues?: unknown;
} = {}) {
  let calls = 0;
  const client = { getChainId: async () => options.chainId ?? 8453,
    multicall: async ({ contracts }: { contracts: Array<{ functionName: string; address: string }> }) => {
    calls++;
    return contracts.map(contract => {
      if (contract.functionName === fail || contract.address.toLowerCase() === options.failedFactory?.toLowerCase()) return { status: "failure", error: new Error("unavailable") };
      return success(contract.functionName === "vaultsOf" ? "vaultValues" in options ? options.vaultValues : Array.from({ length: count }, (_, i) => address(i + 1))
        : contract.functionName === "accountOf" ? "accountValue" in options ? options.accountValue : address(0)
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

test("Arc discovery rejects testnet and other-chain RPC before reading factories", async () => {
  for (const chainId of [5042002, 196, 8453]) {
    const f = fixture(1, "", { chainId });
    await assert.rejects(readSnapshot("arc", owner, f.client), /wrong network/);
    assert.equal(f.calls(), 0);
  }
});

test("each failed Arc Spot factory preserves unknown instead of returning no account", async () => {
  for (const [key, kind] of [["spotFactory", "protection"], ["spotLimitFactory", "limit"], ["spotBracketFactory", "bracket"]] as const) {
    const f = fixture(1, "", { chainId: 5042, failedFactory: executionContractAddress("arc", key) });
    await assert.rejects(readSnapshot("arc", owner, f.client), new RegExp(`Spot ${kind}.*must not be treated as absent`));
  }
});

test("only a confirmed zero factory address means no Spot account", async () => {
  const empty = await readSnapshot("arc", owner, fixture(0, "", { chainId: 5042 }).client);
  assert.deepEqual(empty.accounts, { protection: null, limit: null, bracket: null });
  const found = await readSnapshot("arc", owner, fixture(0, "", { chainId: 5042, accountValue: address(1234) }).client);
  assert.equal(found.accounts.limit, address(1234));
  for (const accountValue of [undefined, null, "", "0x1", 17, {}]) {
    await assert.rejects(readSnapshot("arc", owner, fixture(0, "", { chainId: 5042, accountValue }).client), /must not be treated as absent/);
  }
});

test("Arc vault discovery cannot silently drop invalid or duplicate accounts", async () => {
  for (const vaultValues of [undefined, "not-an-array", ["invalid"], [address(0)], [address(1), address(1)]]) {
    await assert.rejects(readSnapshot("arc", owner, fixture(0, "", { chainId: 5042, vaultValues }).client), /must not be treated as absent/);
  }
});

test("account display retains its last known snapshot during an outage but fresh confirmation fails", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const wallet = address(100001);
  let failed = false, calls = 0;
  const reader = async () => {
    calls++;
    return readSnapshot("arc", wallet, fixture(1, failed ? "accountOf" : "", { chainId: 5042, accountValue: address(5000) }).client);
  };
  const original = await getOnchainAccountSnapshot("arc", wallet, false, reader);
  failed = true;
  t.mock.timers.tick(30_001);
  const retained = await getOnchainAccountSnapshot("arc", wallet, false, reader);
  assert.equal(retained.stale, true);
  assert.equal(retained.accounts.protection, address(5000));
  assert.deepEqual(retained.vaults, original.vaults);
  assert.equal(retained.observedAt, original.observedAt);
  await assert.rejects(getOnchainAccountSnapshot("arc", wallet, true, reader), /must not be treated as absent/);
  failed = false;
  const restored = await getOnchainAccountSnapshot("arc", wallet, true, reader);
  assert.equal(restored.stale, false);
  assert.equal(calls, 4);
});

test("a shared failed read cannot give a fresh caller another caller's stale fallback", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const wallet = address(100002);
  const original = await getOnchainAccountSnapshot("arc", wallet, true,
    () => readSnapshot("arc", wallet, fixture(1, "", { chainId: 5042, accountValue: address(6000) }).client));
  t.mock.timers.tick(30_001);
  let rejectRead!: (error: Error) => void, calls = 0;
  const reader = () => { calls++; return new Promise<typeof original>((_resolve, reject) => { rejectRead = reject; }); };
  const display = getOnchainAccountSnapshot("arc", wallet, false, reader);
  const confirmation = assert.rejects(getOnchainAccountSnapshot("arc", wallet, true, reader), /RPC outage/);
  assert.equal(calls, 1);
  rejectRead(new Error("RPC outage"));
  const retained = await display;
  assert.equal(retained.stale, true);
  assert.deepEqual(retained.accounts, original.accounts);
  await confirmation;
});

test("discovery cache separates Arc and Base accounts for the same owner", async () => {
  const wallet = address(100003);
  const arc = await getOnchainAccountSnapshot("arc", wallet, false,
    () => readSnapshot("arc", wallet, fixture(0, "", { chainId: 5042, accountValue: address(7000) }).client));
  const base = await getOnchainAccountSnapshot("base", wallet, false,
    () => readSnapshot("base", wallet, fixture(0, "", { accountValue: address(8000) }).client));
  assert.equal(arc.accounts.limit, address(7000));
  assert.equal(base.accounts.limit, address(8000));
});
