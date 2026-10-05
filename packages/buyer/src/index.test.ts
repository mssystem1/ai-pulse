import assert from "node:assert/strict";
import test from "node:test";
import { createPaidFetch } from "./index.js";
const privateKey = `0x${"1".repeat(64)}`;

test("agent buyer refuses retired Arc testnet before fetching or signing", () => {
  assert.throws(() => createPaidFetch({ privateKey, network: "eip155:5042002" }), /retired/);
});

test("agent buyer rejects a testnet Gateway domain on an Arc mainnet service", async () => {
  let calls = 0;
  const paid = createPaidFetch({ privateKey, network: "eip155:5042", fetchImpl: (async () => {
    calls++;
    const required = { x402Version: 2, resource: { url: "https://pulse.example/arc/v1/preflight", description: "Risk Guard", mimeType: "application/json" }, accepts: [{ scheme: "exact", network: "eip155:5042", asset: "0x3600000000000000000000000000000000000000", amount: "200000", payTo: `0x${"2".repeat(40)}`, maxTimeoutSeconds: 300, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } }] };
    return Response.json(required, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString("base64") } });
  }) as typeof fetch });
  await assert.rejects(() => paid("https://pulse.example/arc/v1/preflight", { method: "POST", body: "{}" }), /Gateway signing domain/);
  assert.equal(calls, 1);
});
