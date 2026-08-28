import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { loadConfig } from "@pulse/config";
import { createApp } from "./app.js";
import { resetKvCircuitForTests } from "./resilientKv.js";

const OWNER = "0xda64eefe238283717d8ef0e2b8876b3a7643142f";

test("a KV connection loss degrades V6 endpoints without terminating the API", async () => {
  const previous = {
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
    retries: process.env.KV_REQUEST_RETRIES,
    timeout: process.env.KV_REQUEST_TIMEOUT_MS,
    cooldown: process.env.KV_CIRCUIT_COOLDOWN_MS,
  };
  process.env.KV_REST_API_URL = "http://127.0.0.1:9";
  process.env.KV_REST_API_TOKEN = "unreachable-test-token";
  process.env.KV_REQUEST_RETRIES = "0";
  process.env.KV_REQUEST_TIMEOUT_MS = "250";
  process.env.KV_CIRCUIT_COOLDOWN_MS = "1000";
  resetKvCircuitForTests();

  const config = { ...loadConfig(), NODE_ENV: "test" as const, QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const };
  const server: Server = await new Promise((resolve) => {
    const candidate = createApp(config).listen(0, "127.0.0.1", () => resolve(candidate));
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const automation = await fetch(`${origin}/v1/automation/orders?owner=${OWNER}&network=base`);
    const automationBody = await automation.json() as { recoverable?: boolean; code?: string };
    assert.equal(automation.status, 503);
    assert.equal(automationBody.recoverable, true);
    assert.equal(automationBody.code, "KV_TEMPORARILY_UNAVAILABLE");

    const activity = await fetch(`${origin}/v1/trading/activity?address=${OWNER}&network=base`);
    const activityBody = await activity.json() as { activity?: unknown[]; persistence?: { state?: string } };
    assert.equal(activity.status, 200);
    assert.deepEqual(activityBody.activity, []);
    assert.ok(activityBody.persistence?.state === "degraded" || activityBody.persistence?.state === "recovering");

    const health = await fetch(`${origin}/healthz`);
    const healthBody = await health.json() as { ok?: boolean; dependencies?: { kv?: { state?: string } } };
    assert.equal(health.status, 200);
    assert.equal(healthBody.ok, true);
    assert.ok(healthBody.dependencies?.kv?.state === "degraded" || healthBody.dependencies?.kv?.state === "recovering");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const [name, value] of [["KV_REST_API_URL", previous.url], ["KV_REST_API_TOKEN", previous.token], ["KV_REQUEST_RETRIES", previous.retries], ["KV_REQUEST_TIMEOUT_MS", previous.timeout], ["KV_CIRCUIT_COOLDOWN_MS", previous.cooldown]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    resetKvCircuitForTests();
  }
});
