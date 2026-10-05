import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "@pulse/config";
import { arcAutomationReadiness } from "./arcExecutionReadiness.js";
import { assertRobinhoodQuoteIdentity } from "./okxDex.js";
import { executionContracts } from "./executionContracts.js";

test("Arc execution uses its verified mainnet deployment and rejects an old testnet RPC", async t => {
  const names = ["ARC_PULSE_REGISTRY_ADDRESS", "ARC_ORACLE_ROUTER_ADDRESS", "ARC_EXECUTION_ADAPTER_ADDRESS", "ARC_SPOT_ORDER_FACTORY_ADDRESS", "ARC_SPOT_LIMIT_FACTORY_ADDRESS", "ARC_SPOT_BRACKET_FACTORY_ADDRESS", "ARC_AUTOPILOT_VAULT_FACTORY_ADDRESS", "ARC_OKX_ROUTER_ADDRESS", "ARC_OKX_APPROVAL_ADDRESS", "FEATURE_ARC_TRADING"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  for (const name of names) delete process.env[name];
  const cfg = { enabledNetworks: ["arc"], FEATURE_ARC_MAINNET: true, hasOkxCredentials: true, ARC_RPC_URL: "https://arc-fixture.test", AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${"1".repeat(64)}`, TEST_WALLET_PRIVATE_KEY: "" } as AppConfig;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ jsonrpc: "2.0", id: 1, result: "0x4cef52" }); });
  assert.equal((await arcAutomationReadiness(cfg)).ready, false);
  assert.equal(calls, 0);
  assert.equal(executionContracts("arc").registry.toLowerCase(), "0x67e14b9545b069afbd78e195ec37914466e1807f");
  process.env.FEATURE_ARC_TRADING = "1";
  assert.match((await arcAutomationReadiness(cfg)).reason!, /wrong network/);
  assert.equal(calls, 1);
});

test("Arc quotes cannot reuse testnet identity, another token or another amount", () => {
  const input = { chainId: "5042", fromTokenAddress: "0x3600000000000000000000000000000000000000", toTokenAddress: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB", amount: "100000" };
  const raw = { chainIndex: "5042", fromToken: { tokenContractAddress: input.fromTokenAddress }, toToken: { tokenContractAddress: input.toTokenAddress }, fromTokenAmount: "100000", toTokenAmount: "30000000000000" };
  assert.doesNotThrow(() => assertRobinhoodQuoteIdentity(raw, input));
  for (const update of [{ chainIndex: "5042002" }, { fromTokenAmount: "100001" }, { toTokenAmount: "0" }, { toToken: { tokenContractAddress: `0x${"3".repeat(40)}` } }]) assert.throws(() => assertRobinhoodQuoteIdentity({ ...raw, ...update }, input), /Arc mainnet quote/);
});
