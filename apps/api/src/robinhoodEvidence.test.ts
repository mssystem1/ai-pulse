import test from "node:test";
import assert from "node:assert/strict";
import { parseRobinhoodVerification, robinhoodAssetContext } from "./robinhoodEvidence.js";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
test("Robinhood asset classes are contract-and-chain scoped, never symbol based", () => {
  assert.equal(robinhoodAssetContext(4663, usdg).assetClass, "issuer_stablecoin");
  assert.equal(robinhoodAssetContext(4663, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73").assetClass, "wrapped_native");
  assert.equal(robinhoodAssetContext(4663, "0x1111111111111111111111111111111111111111").assetClass, "unclassified_erc20");
  assert.throws(() => robinhoodAssetContext(46630, usdg));
  assert.throws(() => robinhoodAssetContext(4663, "USDG"));
});
test("Sourcify evidence requires exact chain/address identity and a runtime match", () => {
  const verified = { chainId: "4663", address: usdg, runtimeMatch: "exact_match", creationMatch: "exact_match" };
  assert.equal(parseRobinhoodVerification(verified, usdg).sourceVerified, true);
  assert.match(parseRobinhoodVerification(verified, usdg).scope, /does not certify/);
  for (const data of [null, {}, { ...verified, chainId: "46630" }, { ...verified, address: "0x1111111111111111111111111111111111111111" }, { ...verified, runtimeMatch: null }]) {
    assert.throws(() => parseRobinhoodVerification(data, usdg));
  }
});
