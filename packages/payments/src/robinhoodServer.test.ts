import assert from "node:assert/strict";
import test from "node:test";
import type { FacilitatorClient } from "@x402/core/server";
import { createRobinhoodPaymentServer, robinhoodFacilitator } from "./robinhoodServer.js";
import { ROBINHOOD_PAYMENT } from "./robinhoodPayment.js";

function fixture(network = "eip155:4663", version = 2): FacilitatorClient {
  return {
    getSupported: async () => ({ kinds: [{ x402Version: version, scheme: "exact", network: network as `eip155:${number}` }], extensions: [], signers: {} }),
    verify: async () => { throw new Error("No signing or verification during challenge construction"); },
    settle: async () => { throw new Error("No settlement during challenge construction"); },
  };
}

test("seller builds all PULSE catalog amounts as Robinhood USDG requirements", async () => {
  const provider = await createRobinhoodPaymentServer(fixture());
  for (const [price, amount] of [["0.20", "200000"], ["0.30", "300000"], ["1.50", "1500000"], ["10.50", "10500000"], ["45.00", "45000000"]]) {
    const rows = await provider.requirements(price, "0x1111111111111111111111111111111111111111");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].network, ROBINHOOD_PAYMENT.network);
    assert.equal(rows[0].asset.toLowerCase(), ROBINHOOD_PAYMENT.asset.toLowerCase());
    assert.equal(rows[0].amount, amount);
    assert.equal(rows[0].extra.name, "Global Dollar");
    assert.equal(rows[0].extra.version, "1");
    const challenge = await provider.server.createPaymentRequiredResponse(rows, { url: "http://localhost:8356/check", mimeType: "application/json" });
    assert.equal(challenge.x402Version, 2);
    assert.deepEqual(challenge.accepts, rows);
  }
});

test("unsupported providers/networks cannot silently become Base or Robinhood testnet", async () => {
  for (const [network, version] of [["eip155:8453", 2], ["eip155:46630", 2], ["eip155:4663", 1]] as const) {
    await assert.rejects(createRobinhoodPaymentServer(fixture(network, version)), /does not advertise/);
  }
  for (const name of ["cdp", "okx", "__proto__", "https://example.org", "http://localhost"]) {
    assert.throws(() => robinhoodFacilitator(name), /Unrecognized/);
  }
});
