import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "@pulse/config";
import { inlineSettlement, validateSignedPayment, type SettlementRequest } from "./inlineSettlement.js";

const cfg = {
  BASE_URL: "https://pulse.example",
  X402_ASSET: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  CIRCLE_GATEWAY_SELLER_ADDRESS: "0x2222222222222222222222222222222222222222",
  routes: { "POST /v1/analysis/prediction/standard": { name: "Prediction", description: "", priceUsd: 0.03 } },
} as unknown as AppConfig;

function payment(overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 2,
    resource: { url: "https://pulse.example/base/v1/analysis/prediction/standard" },
    accepted: {
      scheme: "exact", network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "30000", payTo: cfg.PAY_TO_ADDRESS,
      ...overrides,
    },
  };
}

function request(payload = payment()) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return {
    method: "POST", path: "/v1/analysis/prediction/standard",
    originalUrl: "/base/v1/analysis/prediction/standard", pulseNetworkKey: "base",
    header: (name: string) => name === "PAYMENT-SIGNATURE" ? encoded : undefined,
  } as unknown as SettlementRequest;
}

describe("inline x402 settlement", () => {
  it("rejects chain, asset, amount, payee, and resource substitution before facilitator calls", () => {
    assert.throws(() => validateSignedPayment(cfg, request(payment({ network: "eip155:42161" })), payment({ network: "eip155:42161" })), /network mismatch/);
    assert.throws(() => validateSignedPayment(cfg, request(payment({ asset: "0x0000000000000000000000000000000000000000" })), payment({ asset: "0x0000000000000000000000000000000000000000" })), /asset mismatch/);
    assert.throws(() => validateSignedPayment(cfg, request(payment({ amount: "1" })), payment({ amount: "1" })), /amount mismatch/);
    assert.throws(() => validateSignedPayment(cfg, request(payment({ payTo: "0x0000000000000000000000000000000000000000" })), payment({ payTo: "0x0000000000000000000000000000000000000000" })), /payee mismatch/);
    assert.throws(() => validateSignedPayment(cfg, request({ ...payment(), resource: { url: "https://attacker.example/base/v1/analysis/prediction/standard" } }), { ...payment(), resource: { url: "https://attacker.example/base/v1/analysis/prediction/standard" } }), /resource mismatch/);
  });

  it("verifies and settles before continuing to protected work", async () => {
    const order: string[] = [];
    const facilitator = {
      async verify() { order.push("verify"); return { isValid: true }; },
      async settle() { order.push("settle"); return { success: true, transaction: `0x${"a".repeat(64)}`, network: "eip155:8453" }; },
    };
    const req = request();
    const headers = new Map<string, string>();
    const res = {
      setHeader(name: string, value: string) { headers.set(name, value); },
      status() { throw new Error("unexpected failure response"); },
    } as unknown as Parameters<ReturnType<typeof inlineSettlement>>[1];
    await inlineSettlement(cfg, "cdp", facilitator, () => undefined)(req, res, () => { order.push("handler"); });
    assert.deepEqual(order, ["verify", "settle", "handler"]);
    assert.equal(req.pulseSettlement?.result.transaction, `0x${"a".repeat(64)}`);
    assert.ok(headers.get("PAYMENT-RESPONSE"));
  });
});
