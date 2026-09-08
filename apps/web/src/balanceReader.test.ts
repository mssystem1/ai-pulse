import assert from "node:assert/strict";
import test from "node:test";
import { createBalanceReader } from "./balanceReader.js";

test("header and funding reads coalesce, while authorization can request a fresh value", async () => {
  let calls = 0, time = 0;
  const read = createBalanceReader((async () => { calls++; return Response.json({ result: "0x175e4f" }); }) as typeof fetch, () => time);
  const args = ["https://example.test", "eth_call", [{ to: "0x1", data: "0x2" }, "latest"]] as const;
  const a = read(args[0], args[1], [...args[2]]), b = read(args[0], args[1], [...args[2]], true);
  assert.equal(a, b);
  assert.equal(await a, 1531471n);
  await read(args[0], args[1], [...args[2]]);
  assert.equal(calls, 1);
  await read(args[0], args[1], [...args[2]], true);
  assert.equal(calls, 2);
  time = 5001;
  await read(args[0], args[1], [...args[2]]);
  assert.equal(calls, 3);
});

test("missing values and provider errors never become zero; failed reads recover", async () => {
  let result: unknown = {}, time = 0, calls = 0;
  const read = createBalanceReader((async () => { calls++; return Response.json(result); }) as typeof fetch, () => time);
  await assert.rejects(read("rpc", "eth_getBalance", ["owner"]), /no valid value/);
  await assert.rejects(read("rpc", "eth_getBalance", ["owner"]));
  assert.equal(calls, 1);
  time = 3001;
  result = { result: "0x0" };
  assert.equal(await read("rpc", "eth_getBalance", ["owner"]), 0n);
  assert.equal(calls, 2);
});

test("balance cache is isolated by owner, token and network", async () => {
  let calls = 0;
  const read = createBalanceReader((async () => { calls++; return Response.json({ result: "0x1" }); }) as typeof fetch);
  await Promise.all([read("base", "eth_call", ["owner1", "token1"]), read("arb", "eth_call", ["owner1", "token1"]), read("base", "eth_call", ["owner2", "token1"]), read("base", "eth_call", ["owner1", "token2"])]);
  assert.equal(calls, 4);
});
