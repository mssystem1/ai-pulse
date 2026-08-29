import test from "node:test";
import assert from "node:assert/strict";
import { buildCdpDiscoveryContract } from "./cdpMiddleware.js";

test("publishes the actual Risk Guard body contract to Bazaar", () => {
  const contract = buildCdpDiscoveryContract("/v1/preflight");
  assert.ok("intent" in contract.input);
  assert.equal("intent" in contract.input ? contract.input.intent : undefined, "swap");
  assert.ok("tokenAddress" in contract.inputSchema.properties);
  assert.equal("instId" in contract.inputSchema.properties, false);
});

test("publishes market and prediction body contracts independently", () => {
  const market = buildCdpDiscoveryContract("/v1/analysis/spot/premium");
  const prediction = buildCdpDiscoveryContract("/v1/analysis/prediction/premium");
  assert.ok("instId" in market.inputSchema.properties);
  assert.equal("primaryMarketId" in market.inputSchema.properties, false);
  assert.ok("primaryMarketId" in prediction.inputSchema.properties);
  assert.equal("instId" in prediction.inputSchema.properties, false);
});
