import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { loadConfig } from "@pulse/config";
import { createAutomationTickRouter } from "./automationTick.js";

async function serve(app: express.Express) {
  const server: Server = await new Promise((resolve) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
  };
}

test("automation tick fails closed and runs each enabled worker only with the cron secret", async () => {
  const previous = process.env.AUTOMATION_WORKER_ENABLED;
  const previousKvUrl = process.env.KV_REST_API_URL;
  const previousKvToken = process.env.KV_REST_API_TOKEN;
  process.env.AUTOMATION_WORKER_ENABLED = "1";
  const calls: string[] = [];
  const cfg = { ...loadConfig(), CRON_SECRET: "test-cron-secret", FEATURE_TELEGRAM: true };
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const app = express();
  app.use(createAutomationTickRouter(cfg, {
    trade: async () => { calls.push("spot"); },
    autopilot: async () => { calls.push("autopilot"); },
    telegram: async () => { calls.push("telegram"); },
  }));
  const { server, origin } = await serve(app);
  try {
    const unauthorized = await fetch(`${origin}/v1/internal/automation/tick`);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(calls, []);

    const response = await fetch(`${origin}/v1/internal/automation/tick`, {
      headers: { Authorization: "Bearer test-cron-secret" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.sort(), ["autopilot", "spot", "telegram"]);
    const body = await response.json() as { ok?: boolean; results?: unknown[] };
    assert.equal(body.ok, true);
    assert.equal(body.results?.length, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.AUTOMATION_WORKER_ENABLED;
    else process.env.AUTOMATION_WORKER_ENABLED = previous;
    if (previousKvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = previousKvUrl;
    if (previousKvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = previousKvToken;
  }
});

test("automation tick reports a disabled worker without invoking it", async () => {
  const previous = process.env.AUTOMATION_WORKER_ENABLED;
  const previousKvUrl = process.env.KV_REST_API_URL;
  const previousKvToken = process.env.KV_REST_API_TOKEN;
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  let called = false;
  const cfg = { ...loadConfig(), CRON_SECRET: "test-cron-secret", FEATURE_TELEGRAM: false };
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const app = express();
  app.use(createAutomationTickRouter(cfg, {
    trade: async () => { called = true; },
    autopilot: async () => { called = true; },
  }));
  const { server, origin } = await serve(app);
  try {
    const response = await fetch(`${origin}/v1/internal/automation/tick`, {
      headers: { Authorization: "Bearer test-cron-secret" },
    });
    assert.equal(response.status, 503);
    assert.equal(called, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.AUTOMATION_WORKER_ENABLED;
    else process.env.AUTOMATION_WORKER_ENABLED = previous;
    if (previousKvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = previousKvUrl;
    if (previousKvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = previousKvToken;
  }
});
