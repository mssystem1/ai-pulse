import test from "node:test";
import assert from "node:assert/strict";
import { kvCircuitStatus, resetKvCircuitForTests, runKvCommand } from "./resilientKv.js";
import { StoreRedis } from "./storeRedis.js";
import { RedisTerminalStorage } from "./terminalStore.js";

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

test("an explicit store exposes its own passive connection circuit without making a probe", async t => {
  resetKvCircuitForTests(); let calls = 0;
  const transport = t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: "max requests limit exceeded" }, { status: 429 }); });
  const connection = { provider: "upstash_kv" as const, url: "https://separate-store.invalid", token: "test-token" };
  try {
    await assert.rejects(runKvCommand(["GET", "key"], "test", connection));
    const store = new StoreRedis(connection.url, connection.token);
    const terminal = new RedisTerminalStorage(store);
    assert.equal(store.status().state, "degraded"); assert(store.status().retryAfterSeconds > 0);
    assert.equal(terminal.availability().available, false);
    assert.equal(kvCircuitStatus(Date.now(), { ...connection, url: "https://other-store.invalid" }).state, "online");
    assert.equal(calls, 1, "Status reads never spend another Redis request");
    const future = Date.now() + 301000; t.mock.method(Date, "now", () => future);
    assert.equal(store.status().state, "recovering"); assert.equal(terminal.availability().available, false);
    transport.mock.mockImplementation(async () => { calls++; return Response.json({ result: "restored" }); });
    assert.equal(await store.get("key"), "restored");
    assert.equal(terminal.availability().available, true); assert.equal(calls, 2);
  } finally { resetKvCircuitForTests(); }
});
