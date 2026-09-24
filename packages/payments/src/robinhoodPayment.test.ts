import assert from "node:assert/strict";
import test from "node:test";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { advertisesRobinhoodExactV2, robinhoodExactAccepts, ROBINHOOD_PAYMENT } from "./robinhoodPayment.js";

const payTo = "0x1111111111111111111111111111111111111111";
const kind = { x402Version: 2, scheme: "exact", network: "eip155:4663" };

test("Robinhood requires exact v2 on mainnet, not testnet, legacy or custom Permit2", () => {
  assert.equal(advertisesRobinhoodExactV2({ kinds: [kind] }), true);
  assert.equal(advertisesRobinhoodExactV2({ kinds: [{ ...kind, extra: { assetTransferMethod: "eip3009", asset: ROBINHOOD_PAYMENT.asset.toLowerCase() } }] }), true);
  for (const bad of [null, {}, { kinds: [null, "exact"] }, { kinds: [{ ...kind, x402Version: 1 }] },
    { kinds: [{ ...kind, network: "eip155:46630" }] }, { kinds: [{ ...kind, network: "eip155:8453" }] },
    { kinds: [{ ...kind, scheme: "exact-permit2-v2" }] },
    { kinds: [{ ...kind, extra: { assetTransferMethod: "permit2" } }] },
    { kinds: [{ ...kind, extra: { asset: payTo } }] }, { kinds: [{ ...kind, extra: null }] }]) {
    assert.equal(advertisesRobinhoodExactV2(bad), false);
  }
});

test("USDG catalog prices use explicit asset and checked domain, never USDC defaults", () => {
  for (const [price, atomic] of [["0.20", "200000"], ["0.30", "300000"], ["1.50", "1500000"], ["10.50", "10500000"], ["45.00", "45000000"]]) {
    const result = robinhoodExactAccepts(price, payTo);
    assert.equal(result.price.amount, atomic);
    assert.equal(result.price.asset, ROBINHOOD_PAYMENT.asset);
    assert.equal(result.network, "eip155:4663");
    assert.deepEqual(result.price.extra, { name: "Global Dollar", version: "1", assetTransferMethod: "eip3009" });
  }
});

test("invalid prices and recipients fail before a challenge can be built", () => {
  for (const price of ["0", "-1", "NaN", "Infinity", "1e3", "0.0000001", "1.0000001", " 1", "1 ", "$0.20", "9".repeat(80)]) {
    assert.throws(() => robinhoodExactAccepts(price, payTo));
  }
  for (const recipient of ["", "0x1234", "0x0000000000000000000000000000000000000000"]) {
    assert.throws(() => robinhoodExactAccepts("0.20", recipient));
  }
});

test("installed x402 SDK accepts USDG without a default stablecoin mapping", async () => {
  const accepts = robinhoodExactAccepts("0.20", payTo);
  const scheme = new ExactEvmScheme();
  const price = await scheme.parsePrice(accepts.price, accepts.network);
  assert.deepEqual(price, accepts.price);
  const requirements = await scheme.enhancePaymentRequirements({
    scheme: accepts.scheme, network: accepts.network, payTo: accepts.payTo,
    amount: price.amount, asset: price.asset, extra: price.extra, maxTimeoutSeconds: 60,
  }, { ...kind, network: accepts.network }, []);
  assert.equal(requirements.asset.toLowerCase(), ROBINHOOD_PAYMENT.asset.toLowerCase());
  assert.equal(requirements.amount, "200000");
  assert.equal(requirements.extra?.name, "Global Dollar");
  assert.equal(requirements.extra?.assetTransferMethod, "eip3009");
});
