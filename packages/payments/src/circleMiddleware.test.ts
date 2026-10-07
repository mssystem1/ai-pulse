import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { AppConfig } from "@pulse/config";
import { createCircleGatewayPaymentMiddleware, type CirclePaymentAttempt, type CirclePaymentJournal } from "./circleMiddleware.js";

test("Circle advertises the public Arc URL and preserves Express routing and verified payment", async t => {
  const realFetch = globalThis.fetch;
  const gateway = "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee";
  const payer = "0x1111111111111111111111111111111111111111";
  let verifyCalls = 0, settleCalls = 0;
  const records = new Map<string, CirclePaymentAttempt>();
  const journal: CirclePaymentJournal = {
    async get(id) { return records.get(id) || null; },
    async claim(attempt) { if (records.has(attempt.id)) return false; records.set(attempt.id, attempt); return true; },
    async replace(previous, next) { if (records.get(previous.id) !== previous) return false; records.set(next.id, next); return true; },
  };
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://gateway.example/")) return realFetch(input, init);
    if (url.endsWith("/supported")) return Response.json({ kinds: [{ scheme: "exact", network: "eip155:5042", x402Version: 2,
      extra: { verifyingContract: gateway, assets: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000" }] } }] });
    if (url.endsWith("/verify")) { verifyCalls++; return Response.json({ isValid: true, payer }); }
    if (url.endsWith("/settle")) { settleCalls++; return Response.json({ success: true, payer, network: "eip155:5042", transaction: "batch-accepted" }); }
    throw new Error("Unexpected Gateway operation");
  });
  const cfg = { BASE_URL: "https://pulse.example", CIRCLE_GATEWAY_ENABLED: true, FEATURE_ARC_PAYMENTS: true,
    CIRCLE_GATEWAY_ACCEPTED_NETWORKS: "eip155:5042", CIRCLE_GATEWAY_MAINNET_URL: "https://gateway.example",
    PAY_TO_ADDRESS: "0x2222222222222222222222222222222222222222",
    CIRCLE_GATEWAY_SELLER_ADDRESS: "0x3333333333333333333333333333333333333333",
    routes: { "POST /v1/preflight": { priceUsd: 0.2 } } } as unknown as AppConfig;
  const app = express();
  app.use(express.json());
  let middleware = createCircleGatewayPaymentMiddleware(cfg, journal);
  app.use("/arc", (req, _res, next) => { Object.assign(req, { pulseNetworkKey: "arc" }); next(); }, (req, res, next) => middleware(req, res, next), (req, res) => {
    res.json({ url: req.url, path: req.path, payment: (req as typeof req & { payment?: unknown }).payment });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/arc/v1/preflight?lang=en`;
  const challengeResponse = await realFetch(url, { method: "POST" });
  assert.equal(challengeResponse.status, 402);
  const challenge = JSON.parse(Buffer.from(challengeResponse.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
  assert.equal(challenge.resource.url, "https://pulse.example/arc/v1/preflight?lang=en");
  assert.equal(challenge.accepts[0].payTo.toLowerCase(), cfg.PAY_TO_ADDRESS.toLowerCase());
  const payment = { x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: {} };
  const paid = await realFetch(url, { method: "POST", headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payment)).toString("base64") } });
  assert.equal(paid.status, 200);
  const body = await paid.json() as { url: string; path: string; payment: { verified: boolean; payer: string } };
  assert.equal(body.url, "/v1/preflight?lang=en");
  assert.equal(body.path, "/v1/preflight");
  assert.equal(body.payment.verified, true);
  assert.equal(body.payment.payer, payer);
  assert.ok(paid.headers.get("PAYMENT-RESPONSE"));
  // A fresh middleware instance uses the durable record, including after restart.
  middleware = createCircleGatewayPaymentMiddleware(cfg, journal);
  const replay = await realFetch(url, { method: "POST", headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payment)).toString("base64") } });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("PAYMENT-RESPONSE"), paid.headers.get("PAYMENT-RESPONSE"));
  assert.equal(verifyCalls, 1);
  assert.equal(settleCalls, 1);
  const changed = await realFetch(url, { method: "POST", body: JSON.stringify({ changed: true }), headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payment)).toString("base64") } });
  assert.equal(changed.status, 409);
  assert.equal(settleCalls, 1);
});
