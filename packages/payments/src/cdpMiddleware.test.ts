import test from "node:test";
import assert from "node:assert/strict";
import { buildCdpDiscoveryContract } from "./cdpMiddleware.js";
import { getNetwork } from "@pulse/config";

test("publishes the actual Risk Guard body contract to Bazaar", () => {
  const contract = buildCdpDiscoveryContract("/v1/preflight");
  for(const key of ["base", "arbitrum"] as const){const network=getNetwork(key),example=buildCdpDiscoveryContract("/v1/preflight",key).input;assert.ok("tokenAddress" in example&&example.tokenAddress===network.paymentAsset.address);assert.ok("chainId" in example&&example.chainId===String(network.chainId));}
  assert.ok("tokenAddress" in contract.inputSchema.properties);
  assert.equal("instId" in contract.inputSchema.properties, false);
  assert.deepEqual(contract.inputSchema.required, ["tokenAddress", "lang"]);
});

test("publishes market and prediction body contracts independently", () => {
  const market = buildCdpDiscoveryContract("/v1/analysis/spot/premium");
  const prediction = buildCdpDiscoveryContract("/v1/analysis/prediction/premium");
  assert.ok("instId" in market.inputSchema.properties);
  assert.equal("primaryMarketId" in market.inputSchema.properties, false);
  assert.ok("primaryMarketId" in prediction.inputSchema.properties);
  assert.equal("instId" in prediction.inputSchema.properties, false);
  assert.deepEqual(market.inputSchema.required, ["instId", "timeframe", "lang"]);
  assert.deepEqual(prediction.inputSchema.required, ["primaryMarketId", "lang"]);
});

test("publishes owner-controlled Autopilot start inputs without report fields", () => {
  const contract = buildCdpDiscoveryContract("/v1/autopilot/pass/24h");
  assert.ok("owner" in contract.inputSchema.properties);
  assert.ok("vault" in contract.inputSchema.properties);
  assert.equal("instId" in contract.inputSchema.properties, false);
  assert.deepEqual(contract.inputSchema.required, ["owner", "vault"]);
});
