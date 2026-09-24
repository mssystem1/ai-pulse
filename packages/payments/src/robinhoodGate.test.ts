import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import type { AppConfig } from "@pulse/config";
import { createPaymentGate } from "./index.js";
import { ROBINHOOD_PAYMENT } from "./robinhoodPayment.js";

// No environment loading, provider credentials, private keys or external calls.
async function fixture(mock: boolean, run: (base: string) => Promise<void>, overrides: Partial<AppConfig> = {}, robinhood?: RequestHandler) {
  const cfg = {
    X402_MOCK: mock, paymentMode: mock ? "mock" : "cdp", BASE_URL: "http://localhost",
    PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
    routes: { "POST /v1/preflight": { priceUsd: 0.2, description: "Token risk report" } },
    ...overrides,
  } as unknown as AppConfig;
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { pulseNetworkKey: "robinhood" }); next(); });
  app.use(createPaymentGate(cfg, { robinhood }));
  app.post("/v1/preflight", (_req, res) => res.json({ reached: true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("Robinhood real paid routes fail closed including trailing slash, without a foreign-chain challenge", async () => {
  await fixture(false, async (base) => {
    for (const path of ["/v1/preflight", "/v1/preflight/"]) {
      const res = await fetch(`${base}${path}`, { method: "POST" });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("payment-required"), null);
      const body = await res.json() as { code: string };
      assert.equal(body.code, "robinhood_payments_unavailable");
    }
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

test("Robinhood mock challenge stays on mainnet USDG with its own signing domain", async () => {
  await fixture(true, async (base) => {
    const res = await fetch(`${base}/v1/preflight`, { method: "POST" });
    assert.equal(res.status, 402);
    const header = res.headers.get("payment-required");
    assert.ok(header);
    const challenge = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    assert.equal(challenge.accepts[0].network, "eip155:4663");
    assert.equal(challenge.accepts[0].asset.toLowerCase(), ROBINHOOD_PAYMENT.asset.toLowerCase());
    assert.equal(challenge.accepts[0].amount, "200000");
    assert.deepEqual(challenge.accepts[0].extra, { name: "Global Dollar", version: "1" });
  });
});

test("missing OKX credentials never put real Robinhood into mock mode", async () => {
  await fixture(false, async base => {
    assert.equal((await fetch(`${base}/v1/preflight`, { method: "POST" })).status, 503);
  }, { paymentMode: "mock" });
});
test("explicit Robinhood feature routes to its injected adapter independently of OKX credentials", async () => {
  let calls = 0;
  await fixture(false, async base => {
    assert.equal((await fetch(`${base}/v1/preflight`, { method: "POST" })).status, 402);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal(calls, 1);
  }, { paymentMode: "mock", FEATURE_ROBINHOOD_PAYMENTS: true }, (_req, res) => { calls++; res.status(402).json({ dedicated: true }); });
});
