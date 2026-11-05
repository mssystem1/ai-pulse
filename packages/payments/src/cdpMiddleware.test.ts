import test from "node:test";
import assert from "node:assert/strict";
import { buildCdpDiscoveryContract } from "./cdpMiddleware.js";
import { getNetwork } from "@pulse/config";
import { getX402OutputSchema } from "./inputContracts.js";

test("Terminal pass discovery describes owner-authenticated access, not a report or vault", () => {
  const contract = buildCdpDiscoveryContract("/v1/terminal/pass/24h");
  assert.deepEqual(contract.inputSchema.required, ["requestId"]);
  assert.equal("vault" in contract.inputSchema.properties, false); assert.equal("instId" in contract.inputSchema.properties, false);
  const schema = getX402OutputSchema("/base/v1/terminal/pass/24h"); assert.equal(schema?.output?.delivery, "wallet_terminal_pass"); assert.equal(schema?.output?.status, 201);
});

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
