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

  it("publishes the token scan POST body contract in ASP metadata", async () => {
    const { res, json } = await jfetch("/v1/metadata");
    assert.equal(res.status, 200);
    const service = json.asp.services.find(
      (item: { path: string }) => item.path === "/v1/token/scan",
    );
    assert.ok(service);
    assert.equal(service.outputSchema.method, "POST");
    assert.equal(service.outputSchema.input.address.carrier, "body");
    assert.equal(service.outputSchema.input.address.required, true);
  });

  it("returns 402 without payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      body: JSON.stringify({
        address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      }),
    });
    assert.equal(res.status, 402);
    assert.ok(res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED"));
    assert.equal(json.status, "payment_required");
    assert.equal(json.outputSchema.method, "POST");
    assert.equal(json.outputSchema.input.address.carrier, "body");
    assert.equal(json.outputSchema.input.address.required, true);
  });

  it("self-describes token scan input before payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan");
    assert.equal(res.status, 400);
    assert.equal(json.status, "input_required");
    assert.ok(json.requiredAnyOf.includes("address"));
    assert.equal(json.fields.find((field: { name: string }) => field.name === "address").required, true);
  });

  it("rejects an invalid token scan before payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      body: JSON.stringify({ address: "not-an-address", chainId: "196" }),
    });
    assert.equal(res.status, 400);
    assert.equal(json.status, "input_required");
    assert.ok(json.validationErrors.length > 0);
    assert.equal(res.headers.get("payment-required"), null);
  });

  it("rejects a non-X-Layer token scan before payment", async () => {
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      body: JSON.stringify({
        address: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        chainId: "1",
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(json.status, "input_required");
    assert.match(json.validationErrors[0].message, /X Layer chain 196 only/);
    assert.equal(res.headers.get("payment-required"), null);
  });

  it("returns the token risk JSON inline on paid replay", async () => {
    const address = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
    const { res, json } = await jfetch("/v1/token/scan", {
      method: "POST",
      pay: true,
      body: JSON.stringify({ address, chainId: "196" }),
    });
    assert.equal(res.status, 200);
    assert.equal(json.service, "token_scan");
    assert.equal(json.address.toLowerCase(), address);
    assert.equal(json.chainId, "196");
    assert.equal(typeof json.riskScore, "number");
    assert.ok(Array.isArray(json.components));
    assert.ok(res.headers.get("payment-response"));
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
