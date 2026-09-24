import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Robinhood public env template matches all seven verified mainnet deployments", () => {
  const manifest = JSON.parse(readFileSync(new URL("../deployments/4663.json", import.meta.url), "utf8"));
  const template = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  assert.equal(manifest.chainId, 4663);
  const entries = {
    ROBINHOOD_PULSE_REGISTRY_ADDRESS: "registry",
    ROBINHOOD_ORACLE_ROUTER_ADDRESS: "oracleRouter",
    ROBINHOOD_EXECUTION_ADAPTER_ADDRESS: "executionAdapter",
    ROBINHOOD_SPOT_LIMIT_FACTORY_ADDRESS: "spotFactory",
    ROBINHOOD_SPOT_ORDER_FACTORY_ADDRESS: "spotProtectionFactory",
    ROBINHOOD_SPOT_BRACKET_FACTORY_ADDRESS: "spotBracketFactory",
    ROBINHOOD_AUTOPILOT_VAULT_FACTORY_ADDRESS: "autopilotFactory",
  };
  for (const [key, contract] of Object.entries(entries)) {
    const matches = [...template.matchAll(new RegExp(`^${key}=(.*)$`, "gm"))];
    assert.equal(matches.length, 1, `${key} must appear exactly once`);
    assert.equal(matches[0][1].trim(), manifest.contracts[contract].address);
    assert.match(manifest.contracts[contract].address, /^0x[a-fA-F0-9]{40}$/);
    assert.equal(manifest.verification.results[contract].status, "verified");
  }
  assert.equal(manifest.contracts.spotFactory.contractName, "SpotOrderAccountFactoryV2");
  assert.equal(manifest.contracts.spotProtectionFactory.contractName, "SpotOrderAccountFactoryV1");
  assert.notEqual(manifest.contracts.spotProtectionFactory.address, manifest.contracts.spotFactory.address);
});
