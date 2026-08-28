import assert from "node:assert/strict";
import test from "node:test";
import {
  executionContractAddress,
  executionContracts,
  PUBLISHED_EXECUTION_CONTRACTS,
} from "./executionContracts.js";

test("published mainnet contract catalog keeps every execution network operable without duplicated host variables", () => {
  for (const network of ["xlayer", "base", "arbitrum"] as const) {
    const contracts = executionContracts(network);
    for (const value of Object.values(contracts)) {
      assert.match(value, /^0x[a-fA-F0-9]{40}$/);
    }
    assert.equal(
      contracts.spotBracketFactory.toLowerCase(),
      PUBLISHED_EXECUTION_CONTRACTS[network].spotBracketFactory.toLowerCase(),
    );
  }
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
