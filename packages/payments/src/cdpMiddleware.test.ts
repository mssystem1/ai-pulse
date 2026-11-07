import test from "node:test";
import assert from "node:assert/strict";
import { buildCdpDiscoveryContract, buildCdpDiscoveryOutput } from "./cdpMiddleware.js";
import { getNetwork } from "@pulse/config";
import { buildX402InputRequired, getX402OutputSchema, isIndicatorPurchasePath } from "./inputContracts.js";

test("creator service discovery describes the exact quoted indicator entitlement, not a report or pass", () => {
  const quoteId = "iqu_" + "a".repeat(32), path = `/v1/terminal/indicators/purchases/${quoteId}`;
  assert.equal(isIndicatorPurchasePath(path), true);
  for (const network of ["base", "arbitrum"] as const) {
    const contract = buildCdpDiscoveryContract(path, network);
    assert.deepEqual(contract.inputSchema.required, ["requestId"]);
    assert.deepEqual(Object.keys(contract.inputSchema.properties), ["requestId"]);
    assert.match((contract.inputSchema.properties.requestId as { description: string }).description, /quote/i);
    const example = buildCdpDiscoveryOutput(path, network);
    assert.ok("purchase" in example && example.purchase);
    assert.equal(example.entitled, true);
    assert.equal(example.purchase.id, quoteId);
    assert.equal(example.purchase.state, "granted");
    assert.equal(example.purchase.network, network);
    assert.equal(example.purchase.asset, getNetwork(network).paymentAsset.address);
    for (const foreignField of ["reportMarkdown", "job", "recoveryToken", "access", "grant"]) assert.equal(foreignField in example, false);
  }
  for (const prefix of ["", "/xlayer", "/base", "/arbitrum"]) {
    const schema = getX402OutputSchema(prefix + path);
    assert.deepEqual(Object.keys(schema!.input), ["requestId"]);
    assert.equal(schema?.output?.delivery, "wallet_indicator_version_service");
    assert.equal(schema?.output?.status, 201);
    assert.equal(schema?.output?.replayStatus, 200);
    assert.equal(schema?.output?.recoveryPath, "/v1/terminal/indicators/purchases/{quoteId}/recover");
    const required = buildX402InputRequired(prefix + path);
    assert.deepEqual(required.requiredArgs, ["requestId"]);
    assert.match(required.message, /indicator version/);
  }
  for (const unpaid of [path + "/recover", "/v1/terminal/indicators/purchases", "/v1/terminal/indicators/purchases/iqu_invalid"]) {
    assert.equal(isIndicatorPurchasePath(unpaid), false);
    assert.equal(getX402OutputSchema(unpaid), undefined);
  }
});

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
