import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { loadConfig } from "@pulse/config";
import { createApp } from "./app.js";

let server: Server;
let port: number;

async function jfetch(path: string, init?: RequestInit & { pay?: boolean }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (init?.pay) headers["PAYMENT-SIGNATURE"] = "test-payment-signature-ok";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers });
  const json = await res.json().catch(() => null);
  return { res, json };
}

describe("PULSE API", () => {
  before(async () => {
    process.env.X402_MOCK = "1";
    const cfg = {
      ...loadConfig(),
      X402_MOCK: true,
      paymentMode: "mock" as const,
    };
    const app = createApp(cfg);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("healthz", async () => {
    const { res, json } = await jfetch("/healthz");
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
  });

  it("publishes the free X Layer catalog route", async () => {
    const { res, json } = await jfetch("/v1/meta");
    assert.equal(res.status, 200);
    const route = json.routes.find((item: { route: string }) => item.route === "GET /v1/xlayer/tokens");
    assert.ok(route);
    assert.equal(route.free, true);
    assert.equal(route.priceUsd, 0);
  });

  it("returns 402 without payment", async () => {
    const { res } = await jfetch("/v1/token/scan", {
      method: "POST",
      body: JSON.stringify({
        address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      }),
    });
    assert.equal(res.status, 402);
    assert.ok(res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED"));
  });

  it("serves paid preflight with mock signature", async () => {
    const { res, json } = await jfetch("/v1/preflight", {
      method: "POST",
      pay: true,
      body: JSON.stringify({
        intent: "hire_agent",
        counterparty: "0x1111111111111111111111111111111111111111",
        tokenAddress: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(json.service, "preflight");
    assert.ok(json.shareId);
  });

  it("free resolve works", async () => {
    const { res, json } = await jfetch("/v1/resolve", {
      method: "POST",
      body: JSON.stringify({ query: "USDT" }),
    });
    assert.equal(res.status, 200);
    assert.ok(json.matches.length >= 1);
  });

  it("validates free X Layer contract inspection before RPC", async () => {
    const { res, json } = await jfetch("/v1/contract/inspect", {
      method: "POST",
      body: JSON.stringify({ address: "not-an-address" }),
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Invalid EVM address/);
  });
});
