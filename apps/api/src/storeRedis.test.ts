import test from "node:test";
import assert from "node:assert/strict";
import { StoreRedis } from "./storeRedis.js";
import { kvConnection, resetKvCircuitForTests, runKvCommand } from "./resilientKv.js";
import { validateRedisUrl } from "./nativeRedis.js";

test("store adapter preserves raw Redis encoding, JSON values and command argument order", async () => {
  const original = globalThis.fetch;
  const calls: unknown[][] = [];
  const replies: unknown[] = ["OK", '{"answer":42}', "OK", "plain", ["j2", "j1"], ["0", ["test:key"]], 1];
  globalThis.fetch = (async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ result: replies.shift() });
  }) as typeof fetch;
  resetKvCircuitForTests();
  try {
    const store = new StoreRedis("https://store.invalid", "test-token");
    await store.set("test:key", { answer: 42 }, { ex: 60 });
    assert.deepEqual(await store.get("test:key"), { answer: 42 });
    await store.set("test:plain", "plain");
    assert.equal(await store.get("test:plain"), "plain");
    assert.deepEqual(await store.zrange("test:jobs", 0, 1, { rev: true }), ["j2", "j1"]);
    assert.deepEqual(await store.scan("0", { match: "test:*", count: 200 }), ["0", ["test:key"]]);
    assert.equal(await store.eval("return 1", ["key"], ["arg"]), 1);
    assert.deepEqual(calls[0], ["SET", "test:key", '{"answer":42}', "EX", 60]);
    assert.deepEqual(calls[4], ["ZREVRANGE", "test:jobs", 0, 1]);
    assert.deepEqual(calls[6], ["EVAL", "return 1", 1, "key", "arg"]);
  } finally { globalThis.fetch = original; resetKvCircuitForTests(); }
});

test("ambiguous write failures are not retried", async () => {
  const original = globalThis.fetch;
  const retries = process.env.KV_REQUEST_RETRIES;
  process.env.KV_REQUEST_RETRIES = "2";
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("response lost after write"); }) as typeof fetch;
  resetKvCircuitForTests();
  try {
    await assert.rejects(runKvCommand(["INCR", "test:counter"], "test", { provider: "upstash_kv", url: "https://write.invalid", token: "test" }));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (retries === undefined) delete process.env.KV_REQUEST_RETRIES; else process.env.KV_REQUEST_RETRIES = retries;
    resetKvCircuitForTests();
  }
});

test("explicit Railway selection cannot fall back to remaining Upstash credentials", () => {
  const old = process.env.QUEUE_PROVIDER;
  try {
    process.env.QUEUE_PROVIDER = "redis";
    assert.equal(kvConnection()?.provider, "redis");
  } finally { if (old === undefined) delete process.env.QUEUE_PROVIDER; else process.env.QUEUE_PROVIDER = old; }
});

test("unresolved Railway references and HTTP endpoints are rejected without leaking credentials", () => {
  for (const value of ["${{Redis.REDIS_URL}}", "https://user:secret@example.com", "redis://default:${{PASSWORD}}@${{HOST}}:6379"]) {
    assert.throws(() => validateRedisUrl(value), error => error instanceof Error && !error.message.includes("secret"));
  }
  validateRedisUrl("redis://default:password@localhost:6379");
  validateRedisUrl("rediss://default:password@example.com:6379");
});
