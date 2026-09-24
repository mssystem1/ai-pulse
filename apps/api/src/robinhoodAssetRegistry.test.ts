import test from "node:test";
import assert from "node:assert/strict";
import { robinhoodStockEvidence } from "./robinhoodAssetRegistry.js";
const address = "0xd95B44124e475743a7589e68F3D74008A5536D44";
const asset = { id: "crm", tokenSymbol: "CRM", tokenName: "Salesforce token",
  deployments: [{ chainId: 4663, contractAddress: address }], currentMultiplier: "1.001148322800714293",
  pendingMultiplier: "", status: "ASSET_STATUS_ACTIVE",
  tradingCapabilities: { market: { whole: "TRADING_STATUS_TRADABLE" } } };
test("official stock evidence matches deployment identity and preserves multiplier precision", () => {
  const result = robinhoodStockEvidence({ assets: [asset] }, address.toLowerCase());
  assert.equal(result.listed, true);
  assert.equal(result.currentMultiplier, asset.currentMultiplier);
  assert.deepEqual(result.underlyingTradingCapabilities, asset.tradingCapabilities);
  assert.equal(result.pendingMultiplier, null);
  assert.match(result.limitations.join(" "), /must not be multiplied again/);
});
test("same ticker on another chain or address is not canonical evidence", () => {
  for (const deployment of [{ chainId: 1, contractAddress: address },
    { chainId: 4663, contractAddress: "0x1111111111111111111111111111111111111111" }]) {
    assert.equal(robinhoodStockEvidence({ assets: [{ ...asset, deployments: [deployment] }] }, address).listed, false);
  }
});
test("ambiguous or malformed registry evidence fails instead of conferring identity", () => {
  for (const body of [{}, { assets: [asset, asset] }, { assets: [{ ...asset, currentMultiplier: "0" }] },
    { assets: [{ ...asset, currentMultiplier: "NaN" }] }]) assert.throws(() => robinhoodStockEvidence(body, address));
});
test("inactive stock remains identified without claiming trade eligibility", () => {
  const result = robinhoodStockEvidence({ assets: [{ ...asset, status: "ASSET_STATUS_INACTIVE", tradingCapabilities: null }] }, address);
  assert.equal(result.listed, true);
  assert.equal(result.status, "ASSET_STATUS_INACTIVE");
  assert.equal(result.underlyingTradingCapabilities, null);
});
