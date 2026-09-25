import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import { recordV6Activity, reconcileV6Activity } from "./v6Store.js";
import { executionContracts } from "./executionContracts.js";

test("activity reconciliation verifies executor trades against factory ownership and receipts", async (t) => {
  // Isolated in-memory store and RPC fixtures: no wallet, Redis or live chain writes.
  const keys = ["QUEUE_PROVIDER", "REDIS_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN"];
  const previous = keys.map(key => process.env[key]);
  keys.forEach(key => delete process.env[key]);
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  const vault = `0x${"a".repeat(40)}` as const;
  const executor = `0x${"b".repeat(40)}`;
  const event = keccak256(toHex("Executed(bytes32,address,uint256,address,address,uint256,uint256,bytes32)"));
  let mode = "confirmed";
  let ownershipCalls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const reply = (request: { id: number; method: string; params: any[] }) => {
      if (request.method === "eth_getTransactionReceipt") return {
        jsonrpc: "2.0", id: request.id, result: mode === "missing" ? null : {
          status: mode === "reverted" ? "0x0" : "0x1", from: executor, to: vault,
          logs: mode === "no_event" ? [] : [{ address: vault, topics: [event], data: "0x" }],
        },
      };
      assert.equal(request.method, "eth_call", "unexpected external RPC method");
      assert.equal(request.params[0].to.toLowerCase(), executionContracts("robinhood").autopilotFactory.toLowerCase());
      ownershipCalls++;
      if (mode === "unavailable") return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Ownership RPC unavailable" } };
      return { jsonrpc: "2.0", id: request.id,
        result: encodeAbiParameters([{ type: "address[]" }], [mode === "not_owned" ? [] : [vault]]) };
    };
    return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
  });
  for (const [index, scenario] of ["confirmed", "reverted", "missing", "unavailable", "not_owned", "no_event"].entries()) {
    mode = scenario;
    ownershipCalls = 0;
    const owner = `0x${(index + 1).toString(16).padStart(40, "0")}`;
    // Multiple pending fills must share one ownership query, not burst per row.
    for (let n = 1; n <= 2; n++) await recordV6Activity({ owner, network: "robinhood", source: "autopilot",
      account: vault, kind: n === 1 ? "buy_filled" : "sell_filled", status: "pending",
      txHash: `0x${(index * 2 + n).toString(16).padStart(64, "0")}` });
    const rows = await reconcileV6Activity(owner, "robinhood", "https://rpc.invalid");
    assert.equal(rows.length, 2);
    const expected = scenario === "confirmed" ? "confirmed" : ["missing", "unavailable"].includes(scenario) ? "pending" : "failed";
    assert.ok(rows.every(row => row.status === expected), `${scenario}: expected ${expected}`);
    if (scenario === "confirmed") assert.equal(ownershipCalls, 1);
    if (["reverted", "missing"].includes(scenario)) assert.equal(ownershipCalls, 0);
    if (["missing", "unavailable"].includes(scenario)) {
      mode = "confirmed";
      const recovered = await reconcileV6Activity(owner, "robinhood", "https://rpc.invalid");
      assert.ok(recovered.every(row => row.status === "confirmed"));
      assert.deepEqual(recovered.map(row => row.id).sort(), rows.map(row => row.id).sort(), "recovery updates the original records");
    }
  }
});
