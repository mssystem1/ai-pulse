import test from "node:test";
import assert from "node:assert/strict";
import { validatePaymentChallenge } from "./wallet.js";
import { WEB_NETWORKS } from "./networks.js";
test("creator checkout pins recipient, six-decimal amount, network, and one exact resource", () => {
  const path = "/v1/terminal/indicators/purchases/iqu_" + "a".repeat(32), recipient = "0x" + "11".repeat(20), n = WEB_NETWORKS.base;
  const accepted = { scheme: "exact", network: n.caip2, asset: n.payment.address, amount: "123456", payTo: recipient };
  const body = { x402Version: 2, resource: { url: "/base" + path }, accepts: [accepted] };
  assert.doesNotThrow(() => validatePaymentChallenge(body, "/base" + path, "base", n, "123456", recipient));
  for (const bad of [{ ...accepted, payTo: "0x" + "22".repeat(20) }, { ...accepted, amount: "120000" }, { ...accepted, network: "eip155:196" }]) assert.throws(() => validatePaymentChallenge({ ...body, accepts: [bad] }, path, "base", n, "123456", recipient));
  assert.throws(() => validatePaymentChallenge({ ...body, accepts: [accepted, accepted] }, path, "base", n, "123456", recipient));
  assert.throws(() => validatePaymentChallenge(body, "/v1/terminal/pass/24h", "base", n, "123456", recipient));
});
