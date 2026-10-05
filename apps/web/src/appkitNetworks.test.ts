import test from "node:test";
import assert from "node:assert/strict";
import { buildAppKitNetworks, appKitNetworks } from "./appkitNetworks";
import { ENABLED_WEB_NETWORKS, WEB_NETWORKS, type WebNetworkKey } from "./networks";

test("AppKit and the PULSE selector share every configured network", () => {
  const keys = Object.keys(WEB_NETWORKS) as WebNetworkKey[];
  const networks = buildAppKitNetworks(keys);
  assert.equal(networks.length, keys.length);
  for (const [index, key] of keys.entries()) {
    const source = WEB_NETWORKS[key];
    assert.equal(networks[index].id, source.chainId);
    assert.equal(networks[index].caipNetworkId, source.caip2);
    assert.equal(networks[index].name, source.label);
    assert.deepEqual(networks[index].nativeCurrency, source.native);
    assert.deepEqual(networks[index].rpcUrls.default.http, [source.rpc]);
  }
  assert.deepEqual(appKitNetworks, buildAppKitNetworks(ENABLED_WEB_NETWORKS));
});

test("Robinhood is mainnet 4663 with ETH gas, not USDG gas", () => {
  const [chain] = buildAppKitNetworks(["robinhood"]);
  assert.equal(chain.id, 4663);
  assert.equal(chain.caipNetworkId, "eip155:4663");
  assert.equal(chain.nativeCurrency.symbol, "ETH");
  assert.notEqual(chain.testnet, true);
  assert.equal(chain.blockExplorers?.default.url, "https://robinhoodchain.blockscout.com");
});

test("Arc wallet-kit metadata uses mainnet 5042 and 18-decimal USDC gas", () => {
  const [chain] = buildAppKitNetworks(["arc"]);
  assert.equal(chain.id, 5042);
  assert.equal(chain.caipNetworkId, "eip155:5042");
  assert.equal(chain.name, "Arc Mainnet");
  assert.deepEqual(chain.nativeCurrency, { name: "USD Coin", symbol: "USDC", decimals: 18 });
  assert.deepEqual(chain.rpcUrls.default.http, ["https://rpc.mainnet.arc.io"]);
  assert.equal(chain.blockExplorers?.default.url, "https://explorer.arc.io");
  assert.notEqual(chain.testnet, true);
  assert.equal(WEB_NETWORKS.arc.payment.decimals, 6);
});

test("AppKit respects disabled networks, order, duplicates and empty configuration", () => {
  assert.deepEqual(buildAppKitNetworks(["base", "xlayer", "base"]).map(chain => chain.id), [8453, 196]);
  assert.deepEqual(buildAppKitNetworks([]).map(chain => chain.id), [196]);
  assert.notEqual(buildAppKitNetworks(["arc"])[0].testnet, true);
});
