import assert from "node:assert/strict";
import test from "node:test";
import {
  executionContractAddress,
  executionContracts,
  PUBLISHED_EXECUTION_CONTRACTS,
} from "./executionContracts.js";

test("published mainnet contract catalog keeps every execution network operable without duplicated host variables", () => {
  for (const network of ["xlayer", "base", "arbitrum", "robinhood"] as const) {
    const contracts = executionContracts(network);
    for (const value of Object.values(contracts)) {
      assert.match(value || "", /^0x[a-fA-F0-9]{40}$/);
    }
    assert.equal(
      contracts.spotBracketFactory.toLowerCase(),
      PUBLISHED_EXECUTION_CONTRACTS[network].spotBracketFactory.toLowerCase(),
    );
  }
});

test("Robinhood market protection and limit orders use separate deployed factory versions", () => {
  const contracts = executionContracts("robinhood");
  assert.equal(contracts.spotFactory, "0x1e1f08e79f866df4819cf691c43b6efd9dec513c");
  assert.notEqual(contracts.spotFactory, contracts.spotLimitFactory);
  assert.equal(contracts.spotLimitFactory, "0xe54dc99228463dad2c4f2762c9e1baf2d6f2ee07");
  assert.equal(contracts.autopilotFactory, "0xc2cf8dd0ba67142c539053c51fc1da9cc52e1af3");
});

test("a valid environment address intentionally overrides the published release", () => {
  const previous = process.env.BASE_SPOT_BRACKET_FACTORY_ADDRESS;
  const override = "0x1111111111111111111111111111111111111111";
  process.env.BASE_SPOT_BRACKET_FACTORY_ADDRESS = override;
  try {
    assert.equal(executionContractAddress("base", "spotBracketFactory"), override);
  } finally {
    if (previous === undefined)
      delete process.env.BASE_SPOT_BRACKET_FACTORY_ADDRESS;
    else process.env.BASE_SPOT_BRACKET_FACTORY_ADDRESS = previous;
  }
});

test("an invalid environment value cannot erase a published contract", () => {
  const previous = process.env.XLAYER_AUTOPILOT_VAULT_FACTORY_ADDRESS;
  process.env.XLAYER_AUTOPILOT_VAULT_FACTORY_ADDRESS = "missing";
  try {
    assert.equal(
      executionContractAddress("xlayer", "autopilotFactory").toLowerCase(),
      PUBLISHED_EXECUTION_CONTRACTS.xlayer.autopilotFactory.toLowerCase(),
    );
  } finally {
    if (previous === undefined)
      delete process.env.XLAYER_AUTOPILOT_VAULT_FACTORY_ADDRESS;
    else process.env.XLAYER_AUTOPILOT_VAULT_FACTORY_ADDRESS = previous;
  }
});
