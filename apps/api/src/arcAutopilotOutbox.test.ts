import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ArcAutopilotOutbox } from "./arcAutopilotOutbox.js";

const executorKey = `0x${"4".repeat(64)}` as Hex;
const signer = privateKeyToAccount(executorKey);
const owner = `0x${"1".repeat(40)}`;
const vault = `0x${"2".repeat(40)}`;
const evidenceHash = `0x${"3".repeat(64)}` as Hex;
const abi = parseAbi(["function execute(bytes32,uint64,uint64,address,address,address,uint256,uint256,bytes,bytes32)"]);
const data = encodeFunctionData({ abi, functionName: "execute", args: [evidenceHash, 1n, 0n,
  `0x${"5".repeat(40)}`, "0x3600000000000000000000000000000000000000", `0x${"6".repeat(40)}`, 100000n, 1n, "0x01", evidenceHash] });

function storage() {
  const values = new Map<string, string>();
  let available = true;
  const dependencies = { configured: () => true, command: async ([op, key, ...args]: unknown[]) => {
    if (!available) throw new Error("Private storage unavailable");
    if (op === "GET") return values.get(String(key)) ?? null;
    if (op === "SET") {
      if (args.includes("NX") && values.has(String(key))) return null;
      values.set(String(key), String(args[0])); return "OK";
    }
    if (op === "EVAL") {
      const [, recordKey, expected] = args;
      if (values.get(String(recordKey)) !== expected) return 0;
      values.delete(String(recordKey)); return 1;
    }
    throw new Error("Unexpected storage operation");
  } };
  return { values, dependencies, offline: () => { available = false; } };
}
async function input(overrides: Record<string, unknown> = {}, account = signer) {
  const serializedTransaction = await account.signTransaction({ type: "eip1559", chainId: 5042, nonce: 0,
    to: vault as Hex, data, value: 0n, gas: 125000n, maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 1n, ...overrides });
  return { owner, vault, pair: "ETH-USDT", kind: "buy_filled" as const, amount: "100000", policyVersion: "1", actionNonce: "0",
    evidenceHash, evidenceUrl: "kv:fixture-proof", expiresAt: Date.now() + 600000, data, serializedTransaction };
}

test("Arc signed trade survives a new outbox instance without exposing its payload in storage", async () => {
  const state = storage();
  const original = new ArcAutopilotOutbox(executorKey, state.dependencies);
  const pending = await original.stage(await input());
  const stored = [...state.values.values()][0];
  assert.equal(stored.includes(pending.serializedTransaction), false);
  assert.equal(stored.includes(owner), false);
  assert.equal(stored.includes("serializedTransaction"), false);
  const restarted = new ArcAutopilotOutbox(executorKey, state.dependencies);
  assert.deepEqual(await restarted.read(owner.toUpperCase(), vault.toUpperCase()), pending);
  await assert.rejects(restarted.stage(await input({ nonce: 1 })), /unresolved transaction/);
  assert.deepEqual(await restarted.read(owner, vault), pending, "a new signing attempt cannot overwrite the unresolved transaction");
  await restarted.clear(pending);
  assert.equal(await restarted.read(owner, vault), null);
  await restarted.clear(pending);
});

test("Arc outbox rejects wrong chain, sender, destination, value, gas and execution identity before persistence", async () => {
  const state = storage();
  const outbox = new ArcAutopilotOutbox(executorKey, state.dependencies);
  for (const overrides of [{ chainId: 5042002 }, { to: owner }, { value: 1n }, { gas: 2_000_000n }, { data: "0x12345678" }])
    await assert.rejects(outbox.stage(await input(overrides)), /invalid/);
  await assert.rejects(outbox.stage(await input({}, privateKeyToAccount(`0x${"7".repeat(64)}`))), /invalid/);
  for (const overrides of [{ amount: "200000" }, { actionNonce: "1" }, { policyVersion: "2" }, { evidenceHash: `0x${"8".repeat(64)}` }])
    await assert.rejects(outbox.stage({ ...await input(), ...overrides }), /invalid/);
  assert.equal(state.values.size, 0);
  assert.ok(parseEther("0.10") > 125000n * 100000000000n);
});

test("Arc outbox keeps a failed storage operation separate from permission to broadcast", async () => {
  const state = storage();
  state.offline();
  const outbox = new ArcAutopilotOutbox(executorKey, state.dependencies);
  await assert.rejects(outbox.stage(await input()), /storage unavailable/i);
  await assert.rejects(outbox.read(owner, vault), /storage unavailable/i);
  assert.equal(state.values.size, 0);
  await assert.rejects(new ArcAutopilotOutbox(executorKey, { ...state.dependencies, configured: () => false }).stage(await input()), /durable/);
});

test("tampered storage and executor-key rotation preserve the pending record and fail closed", async () => {
  const state = storage();
  const outbox = new ArcAutopilotOutbox(executorKey, state.dependencies);
  const pending = await outbox.stage(await input());
  const key = [...state.values.keys()][0];
  const envelope = JSON.parse(state.values.get(key)!);
  const bytes = Buffer.from(envelope.ciphertext, "base64url");
  bytes[0] ^= 1;
  state.values.set(key, JSON.stringify({ ...envelope, ciphertext: bytes.toString("base64url") }));
  await assert.rejects(outbox.read(owner, vault), /cannot be verified/);
  await assert.rejects(outbox.clear(pending), /cannot be verified/);
  await assert.rejects(new ArcAutopilotOutbox(`0x${"7".repeat(64)}`, state.dependencies).read(owner, vault), /cannot be verified/);
  assert.equal(state.values.size, 1);
});

test("settlement cannot remove a different pending Arc transaction", async () => {
  const state = storage();
  const outbox = new ArcAutopilotOutbox(executorKey, state.dependencies);
  const first = await outbox.stage(await input());
  await outbox.clear(first);
  const second = await outbox.stage(await input({ nonce: 1 }));
  await assert.rejects(outbox.clear(first), /changed before settlement/);
  assert.deepEqual(await outbox.read(owner, vault), second);
});
