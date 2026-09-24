import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "@pulse/config";
import { privateKeyToAccount } from "viem/accounts";
import { createRobinhoodPaymentRuntime } from "./robinhoodPaymentRuntime.js";

// Public fixture keys only. No .env loading, RPC or Redis traffic.
const key = `0x${"1".repeat(64)}` as const;
const address = privateKeyToAccount(key).address;
const cfg = { FEATURE_ROBINHOOD_PAYMENTS: true, paymentMode: "cdp", X402_MOCK: false,
  ROBINHOOD_FACILITATOR: "self-hosted", QUEUE_PROVIDER: "redis", REDIS_URL: "redis://localhost:1",
  ROBINHOOD_FACILITATOR_PRIVATE_KEY: key, TEST_WALLET_ADDRESS: address,
  PAY_TO_ADDRESS: "0x2222222222222222222222222222222222222222",
  ROBINHOOD_PULSE_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333",
} as unknown as AppConfig;
test("disabled and mock paths never instantiate a facilitator", () => {
  assert.equal(createRobinhoodPaymentRuntime({ ...cfg, FEATURE_ROBINHOOD_PAYMENTS: false }), undefined);
  assert.equal(createRobinhoodPaymentRuntime({ ...cfg, X402_MOCK: true }), undefined);
});
test("unsafe signer, missing durable Redis and external providers fail closed without challenges or leaked configuration", () => {
  for (const variant of [cfg, { ...cfg, QUEUE_PROVIDER: "memory" }, { ...cfg, ROBINHOOD_FACILITATOR: "primer" },
    { ...cfg, ROBINHOOD_FACILITATOR_PRIVATE_KEY: "" }, { ...cfg, TEST_WALLET_ADDRESS: "", TEST_WALLET_PRIVATE_KEY: key },
    { ...cfg, TEST_WALLET_ADDRESS: "", AUTOMATION_EXECUTOR_PRIVATE_KEY: key }, { ...cfg, TEST_WALLET_ADDRESS: "", PAY_TO_ADDRESS: address }]) {
    const middleware = createRobinhoodPaymentRuntime(variant as AppConfig)!;
    let status = 0; let body: unknown;
    middleware({} as never, { status: (value: number) => { status = value; return { json: (value: unknown) => { body = value; } }; } } as never,
      () => assert.fail("must not continue"));
    assert.equal(status, 503);
    assert.equal((body as { retrySamePayment: boolean }).retrySamePayment, true);
    assert.ok(!JSON.stringify(body).includes(key));
  }
});
