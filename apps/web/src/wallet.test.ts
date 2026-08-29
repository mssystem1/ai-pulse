import assert from "node:assert/strict";
import test from "node:test";
import { assertPaymentBalance, networkKeyForChainId, readPreferredNetwork, savePreferredNetwork, WEB_NETWORKS, switchWalletNetwork } from "./networks.js";
import { findOkxProvider, validatePaymentChallenge, walletProviderName, type InjectedProvider } from "./wallet.js";

test("persists the selected network across application starts", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  savePreferredNetwork(storage, "base");
  assert.equal(readPreferredNetwork(storage, ["xlayer", "base"]), "base");
});

test("validates the exact network, native-USDC asset, route, and approved price", () => {
  const network = WEB_NETWORKS.base;
  assert.doesNotThrow(() => validatePaymentChallenge({
    x402Version: 2,
    resource: { url: "http://localhost:4000/base/v1/analysis/fused/standard" },
    accepts: [{ scheme: "exact", network: network.caip2, asset: network.payment.address, amount: "250000", payTo: "0x0000000000000000000000000000000000000001" }],
  }, "http://localhost:4000/base/v1/analysis/fused/standard", "base", network));
});

test("rejects a substituted chain, token, price, or resource before wallet signing", () => {
  const network = WEB_NETWORKS.arbitrum;
  const base = { x402Version: 2, resource: { url: "/arbitrum/v1/token/scan" }, accepts: [{ scheme: "exact", network: network.caip2, asset: network.payment.address, amount: "200000" }] };
  for (const challenge of [
    { ...base, accepts: [{ ...base.accepts[0], network: "eip155:8453" }] },
    { ...base, accepts: [{ ...base.accepts[0], asset: WEB_NETWORKS.base.payment.address }] },
    { ...base, accepts: [{ ...base.accepts[0], amount: "1000000" }] },
    { ...base, resource: { url: "/arbitrum/v1/preflight" } },
  ]) assert.throws(() => validatePaymentChallenge(challenge, "/arbitrum/v1/token/scan", "arbitrum", network));
});

test("switches an existing chain without attempting to add it", async () => {
  const calls: string[] = [];
  await switchWalletNetwork({ request: async ({ method }) => { calls.push(method); return null; } }, "base");
  assert.deepEqual(calls, ["wallet_switchEthereumChain"]);
});

test("adds a missing chain after EIP-4902", async () => {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  await switchWalletNetwork({ request: async (request) => {
    calls.push(request);
    if (request.method === "wallet_switchEthereumChain") throw Object.assign(new Error("missing"), { code: 4902 });
    return null;
  } }, "arbitrum");
  assert.equal(calls[1]?.method, "wallet_addEthereumChain");
  assert.deepEqual((calls[1]?.params?.[0] as { chainId: string }).chainId, WEB_NETWORKS.arbitrum.chainHex);
});

test("does not hide wallet rejection or provider-specific failures", async () => {
  const provider = { request: async () => { throw Object.assign(new Error("rejected"), { code: 4001 }); } };
  await assert.rejects(() => switchWalletNetwork(provider, "arc-testnet"), /rejected/);
  assert.equal(walletProviderName({ isOkxWallet: true } as InjectedProvider), "OKX Wallet");
  assert.equal(walletProviderName({ isMetaMask: true } as InjectedProvider), "MetaMask");
  assert.equal(walletProviderName({ isRabby: true } as InjectedProvider), "Rabby");
  assert.equal(walletProviderName({ isCoinbaseWallet: true } as InjectedProvider), "Base Account / Coinbase Wallet");
});

test("finds OKX Wallet before another extension in a multiplexed injected provider", () => {
  const metamask = { request: async () => null, isMetaMask: true } as InjectedProvider;
  const okx = { request: async () => null, isOkxWallet: true } as InjectedProvider;
  const ethereum = { request: async () => null, providers: [metamask, okx] } as InjectedProvider;
  assert.equal(findOkxProvider({ ethereum }), okx);
});

test("finds OKX Wallet through EIP-6963 without relying on window.ethereum ownership", () => {
  const metamask = { request: async () => null, isMetaMask: true } as InjectedProvider;
  const okx = { request: async () => null } as InjectedProvider;
  assert.equal(findOkxProvider({ ethereum: metamask }, [
    { info: { name: "MetaMask", rdns: "io.metamask" }, provider: metamask },
    { info: { name: "OKX Wallet", rdns: "com.okex.wallet" }, provider: okx },
  ]), okx);
});

test("reconciles wallet chain events with every supported PULSE network", () => {
  assert.equal(networkKeyForChainId("0xc4"), "xlayer");
  assert.equal(networkKeyForChainId("0x2105"), "base");
  assert.equal(networkKeyForChainId("0xa4b1"), "arbitrum");
  assert.equal(networkKeyForChainId("0x4cef52"), "arc-testnet");
  assert.equal(networkKeyForChainId("0x1"), null);
});

test("fails closed on unavailable or insufficient fresh payment balance before signing", () => {
  assert.doesNotThrow(() => assertPaymentBalance(0.03, 0.03, "USDC", "Base"));
  assert.throws(() => assertPaymentBalance(undefined, 0.03, "USDC", "Base"), /Unable to verify/);
  assert.throws(() => assertPaymentBalance(0.029, 0.03, "USDC", "Base"), /Insufficient USDC/);
});
