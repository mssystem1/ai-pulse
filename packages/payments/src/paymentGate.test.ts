import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import type { AppConfig, NetworkKey } from "@pulse/config";
import { createPaymentGate } from "./index.js";

const recipient = "0x1111111111111111111111111111111111111111";
async function fixture(network: NetworkKey, overrides: Partial<AppConfig>, run: (base: string) => Promise<void>, cdp?: RequestHandler) {
  const cfg = {
    X402_MOCK: false, paymentMode: "mock", BASE_URL: "http://localhost", PAY_TO_ADDRESS: recipient,
    FEATURE_BASE_PAYMENTS: false, FEATURE_ARBITRUM_PAYMENTS: false,
    routes: { "POST /v1/terminal/indicators/purchases/iqu_test": { priceUsd: 0.001, description: "Exact creator service version" } },
    ...overrides,
  } as unknown as AppConfig;
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { pulseNetworkKey: network }); next(); });
  app.use(createPaymentGate(cfg, { cdp }));
  app.post("/v1/terminal/indicators/purchases/iqu_test", (_req, res) => res.json({ reached: true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("Base and Arbitrum use CDP independently of unrelated missing OKX credentials", async () => {
  for (const network of ["base", "arbitrum"] as const) {
    let calls = 0;
    await fixture(network, {
      FEATURE_BASE_PAYMENTS: network === "base", FEATURE_ARBITRUM_PAYMENTS: network === "arbitrum",
      CDP_API_KEY_ID: "fixture-only", CDP_API_KEY_SECRET: "fixture-only",
    }, async base => {
      const response = await fetch(`${base}/v1/terminal/indicators/purchases/iqu_test`, { method: "POST", headers: { "PAYMENT-SIGNATURE": "unverified-signature" } });
      assert.equal(response.status, 402);
      assert.deepEqual(await response.json(), { dedicatedCdp: true });
      assert.equal(calls, 1);
      assert.equal((await fetch(`${base}/health`)).status, 200);
    }, (_req, res) => { calls++; res.status(402).json({ dedicatedCdp: true }); });
  }
});

test("disabled CDP routes fail closed even when another CDP network is enabled", async () => {
  for (const network of ["base", "arbitrum"] as const) {
    await fixture(network, {
      FEATURE_BASE_PAYMENTS: network !== "base", FEATURE_ARBITRUM_PAYMENTS: network !== "arbitrum",
      CDP_API_KEY_ID: "fixture-only", CDP_API_KEY_SECRET: "fixture-only",
    }, async base => {
      const response = await fetch(`${base}/v1/terminal/indicators/purchases/iqu_test`, { method: "POST", headers: { "PAYMENT-SIGNATURE": "unverified-signature" } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("PAYMENT-RESPONSE"), null);
    }, (_req, res) => res.status(500).json({ unexpected: true }));
  }
});

test("unavailable live X Layer adapters fail closed instead of accepting a mock payment", async () => {
  // An inconsistent readiness flag also exercises the synchronous SDK init
  // failure; no facilitator is constructed without the required credentials.
  for (const paymentMode of ["mock", "okx"] as const) {
    await fixture("xlayer", { paymentMode }, async base => {
      const response = await fetch(`${base}/v1/terminal/indicators/purchases/iqu_test`, { method: "POST", headers: { "PAYMENT-SIGNATURE": "unverified-signature-long-enough" } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("PAYMENT-REQUIRED"), null);
      assert.equal(response.headers.get("PAYMENT-RESPONSE"), null);
      assert.equal((await response.json() as { code: string }).code, "xlayer_payments_unavailable");
    });
  }
});

test("only explicit X402_MOCK opts in to simulated creator settlement", async () => {
  await fixture("base", { X402_MOCK: true }, async base => {
    const response = await fetch(`${base}/v1/terminal/indicators/purchases/iqu_test`, { method: "POST", headers: { "PAYMENT-SIGNATURE": "explicit-qa-only" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reached: true });
    assert.ok(response.headers.get("PAYMENT-RESPONSE"));
  });
});
