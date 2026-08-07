import assert from "node:assert/strict";
import test from "node:test";
import { ProviderCircuitBreaker, ProviderCircuitOpenError, retryDelayMs } from "./resilience.js";

test("provider circuit opens after bounded consecutive failures and fails fast", async () => {
  const circuit = new ProviderCircuitBreaker("fixture", 2, 60_000);
  let calls = 0;
  const fail = () => circuit.run(async () => { calls += 1; throw new Error("down"); });
  await assert.rejects(fail, /down/);
  await assert.rejects(fail, /down/);
  await assert.rejects(fail, (error) => error instanceof ProviderCircuitOpenError);
  assert.equal(calls, 2);
});

test("retry delay honors Retry-After but remains bounded", () => {
  assert.equal(retryDelayMs(new Response(null, { status: 429, headers: { "Retry-After": "1" } }), 0), 1_000);
  assert.equal(retryDelayMs(new Response(null, { status: 429, headers: { "Retry-After": "30" } }), 0), 2_000);
});
