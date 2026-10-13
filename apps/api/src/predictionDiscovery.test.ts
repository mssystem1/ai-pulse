import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { loadConfig } from "@pulse/config";
import type { PolymarketClient } from "@pulse/market";
import { createApp } from "./app.js";

test("Bazaar can discover Prediction inputs without bypassing signed or supplied-input validation", async t => {
  const cfg = { ...loadConfig(), NODE_ENV: "test" as const, X402_MOCK: true, BASE_URL: "https://pulse.example", QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const, FEATURE_TELEGRAM: false, FEATURE_POLYMARKET: true, FEATURE_BASE_PAYMENTS: true, FEATURE_ARBITRUM_PAYMENTS: true, CIRCLE_GATEWAY_ENABLED: true };
  let marketReads = 0;
  const polymarket = { getMarket: async () => { marketReads++; return { id: `pm:0x${"a".repeat(64)}`, active: true, closed: false, archived: false, enableOrderBook: true, outcomes: [{ tokenId: "1" }, { tokenId: "2" }] }; }, getOrderBook: async () => ({ bids: [], asks: [] }) } as unknown as PolymarketClient;
  const server = createServer(createApp(cfg, { startDurableWorker: false, polymarket }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body?: object, authorization?: string) => fetch(origin + path, { method: "POST", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(authorization ? { [authorization]: "test-payment-signature-ok" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const [network, chain] of [["base", 8453], ["arbitrum", 42161]] as const) for (const tier of ["standard", "premium"] as const) {
      await t.test(`${network} Prediction ${tier}`, async () => {
        const path = `/${network}/v1/analysis/prediction/${tier}`, readsBefore = marketReads;
        for (const body of [undefined, {}]) {
          const probe = await post(path, body);
          assert.equal(probe.status, 402); assert.ok(probe.headers.get("payment-required")); assert.equal(probe.headers.get("payment-response"), null);
          const challenge = JSON.parse(Buffer.from(probe.headers.get("payment-required")!, "base64").toString("utf8"));
          assert.equal(challenge.resource.url, cfg.BASE_URL + path); assert.equal(challenge.accepts[0].network, `eip155:${chain}`); assert.equal(challenge.accepts[0].amount, tier === "standard" ? "200000" : "300000");
        }
        for (const authorization of ["PAYMENT-SIGNATURE", "X-PAYMENT"]) {
          const rejected = await post(path, {}, authorization); assert.equal(rejected.status, 400); assert.equal(rejected.headers.get("payment-response"), null); assert.equal(rejected.headers.get("payment-required"), null);
        }
        for (const body of [{ lang: "en" }, { primaryMarketId: 42, lang: "en" }]) {
          const rejected = await post(path, body); assert.equal(rejected.status, 400); assert.equal(rejected.headers.get("payment-required"), null);
        }
        assert.equal(marketReads, readsBefore, "Discovery/invalid inputs must not select a market");
        const valid = await post(path, { primaryMarketId: `pm:0x${"a".repeat(64)}`, lang: "en" }); assert.equal(valid.status, 402); assert.equal(marketReads, readsBefore + 1, "A buyer selection must still pass live evidence checks");
      });
    }
    for (const network of ["xlayer", "arc"]) {
      const rejected = await post(`/${network}/v1/analysis/prediction/standard`, {}); assert.equal(rejected.status, 400); assert.equal(rejected.headers.get("payment-required"), null);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
