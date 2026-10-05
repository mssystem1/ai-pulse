import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeDeployData, keccak256 } from "viem";

test("Arc public env template matches all seven verified mainnet deployments", () => {
  const manifest = JSON.parse(readFileSync(new URL("../deployments/5042.json", import.meta.url), "utf8"));
  const template = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  assert.equal(manifest.chainId, 5042);
  const entries = {
    ARC_PULSE_REGISTRY_ADDRESS: "registry",
    ARC_ORACLE_ROUTER_ADDRESS: "oracleRouter",
    ARC_EXECUTION_ADAPTER_ADDRESS: "executionAdapter",
    ARC_SPOT_LIMIT_FACTORY_ADDRESS: "spotFactory",
    ARC_SPOT_ORDER_FACTORY_ADDRESS: "spotProtectionFactory",
    ARC_SPOT_BRACKET_FACTORY_ADDRESS: "spotBracketFactory",
    ARC_AUTOPILOT_VAULT_FACTORY_ADDRESS: "autopilotFactory",
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

test("rebuilt Arc core creation data reproduces all seven verified deployments", () => {
  const manifest = JSON.parse(readFileSync(new URL("../deployments/5042.json", import.meta.url), "utf8"));
  const compiler = readFileSync(new URL("../artifacts/compiler-version.txt", import.meta.url), "utf8").trim();
  assert.match(compiler, /^0\.8\.26\+/);
  for (const contract of Object.values(manifest.contracts)) {
    const artifact = JSON.parse(readFileSync(new URL(`../artifacts/${contract.contractName}.json`, import.meta.url), "utf8"));
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: contract.constructorArguments });
    assert.equal(keccak256(data), contract.creationDataHash, `${contract.contractName} must reproduce its verified deployment`);
  }
});
