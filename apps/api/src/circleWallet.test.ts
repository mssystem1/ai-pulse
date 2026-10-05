import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { serializeTransaction } from "viem";
import { createCircleWalletRouter, validateArcTypedData, validateArcTransaction } from "./circleWallet.js";

test("Circle signing cannot reuse Arc testnet authorization on mainnet", () => {
  assert.doesNotThrow(() => validateArcTypedData(JSON.stringify({ domain: { chainId: "0x13b2" } })));
  for (const chainId of [5042002, 196, undefined]) assert.throws(() => validateArcTypedData(JSON.stringify({ domain: { chainId } })), /mainnet/);
  const tx = (chainId: number) => serializeTransaction({ type: "eip1559", chainId, nonce: 0, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, to: `0x${"1".repeat(40)}`, value: 0n });
  assert.doesNotThrow(() => validateArcTransaction(tx(5042)));
  assert.throws(() => validateArcTransaction(tx(5042002)), /mainnet/);
});

test("a test Circle key cannot advertise or initialize an Arc mainnet email wallet", async () => {
  const before = { CIRCLE_API_KEY: process.env.CIRCLE_API_KEY, CIRCLE_API_KEY_MAINNET: process.env.CIRCLE_API_KEY_MAINNET };
  process.env.CIRCLE_API_KEY = "TEST_API_KEY:fixture";
  delete process.env.CIRCLE_API_KEY_MAINNET;
  const app = express(); app.use(express.json()); app.use(createCircleWalletRouter());
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.listening ? resolve() : server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const status = await fetch(`${origin}/status`).then(res => res.json());
    assert.equal(status.enabled, false); assert.equal(status.blockchain, "ARC");
    const initialize = await fetch(`${origin}/wallets/initialize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blockchain: "ARC-TESTNET" }) });
    assert.equal(initialize.status, 503);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
