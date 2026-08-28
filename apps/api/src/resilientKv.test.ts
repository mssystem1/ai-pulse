import test from "node:test";
import assert from "node:assert/strict";
import { kvCircuitStatus, resetKvCircuitForTests, runKvCommand } from "./resilientKv.js";

test("KV circuit fails fast during an outage and closes after a successful recovery probe", async () => {
  const original = {
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
    retries: process.env.KV_REQUEST_RETRIES,
    cooldown: process.env.KV_CIRCUIT_COOLDOWN_MS,
    fetch: globalThis.fetch,
  };
  process.env.KV_REST_API_URL = "https://kv.invalid";
  process.env.KV_REST_API_TOKEN = "test-token";
  process.env.KV_REQUEST_RETRIES = "0";
  process.env.KV_CIRCUIT_COOLDOWN_MS = "1000";
  resetKvCircuitForTests();
  let calls = 0;
  try {
    globalThis.fetch = (async () => { calls += 1; throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }); }) as typeof fetch;
    await assert.rejects(runKvCommand(["GET", "key"], "test"), (error: { code?: string }) => error.code === "KV_TEMPORARILY_UNAVAILABLE");
    await assert.rejects(runKvCommand(["GET", "key"], "test"), (error: { code?: string }) => error.code === "KV_TEMPORARILY_UNAVAILABLE");
    assert.equal(calls, 1, "open circuit must not start another network request");
    assert.equal(kvCircuitStatus().state, "degraded");

    await new Promise((resolve) => setTimeout(resolve, 1_050));
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: "restored" }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    assert.equal(await runKvCommand(["GET", "key"], "test"), "restored");
    assert.equal(kvCircuitStatus().state, "online");
  } finally {
    globalThis.fetch = original.fetch;
    for (const [name, value] of [["KV_REST_API_URL", original.url], ["KV_REST_API_TOKEN", original.token], ["KV_REQUEST_RETRIES", original.retries], ["KV_CIRCUIT_COOLDOWN_MS", original.cooldown]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    resetKvCircuitForTests();
  }
});
