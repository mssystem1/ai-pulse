import test from "node:test";
import assert from "node:assert/strict";
import { switchWalletNetwork } from "./networks.js";

test("Robinhood switch verifies the wallet actually selected chain 4663", async () => {
  const methods: string[] = [];
  await switchWalletNetwork({ async request({ method, params }) {
    methods.push(method);
    if (method === "wallet_switchEthereumChain") assert.deepEqual(params, [{ chainId: "0x1237" }]);
    return method === "eth_chainId" ? "0x1237" : null;
  } }, "robinhood");
  assert.deepEqual(methods, ["wallet_switchEthereumChain", "eth_chainId"]);
});

test("an unknown Robinhood chain is added then explicitly selected", async () => {
  const methods: string[] = [];
  await switchWalletNetwork({ async request({ method, params }) {
    methods.push(method);
    if (methods.length === 1) throw { code: 4902 };
    if (method === "wallet_addEthereumChain") {
      const chain = params?.[0] as { chainId: string; nativeCurrency: { symbol: string }; rpcUrls: string[] };
      assert.equal(chain.chainId, "0x1237");
      assert.equal(chain.nativeCurrency.symbol, "ETH");
      assert.deepEqual(chain.rpcUrls, ["https://rpc.mainnet.chain.robinhood.com"]);
    }
    return method === "eth_chainId" ? "0x1237" : null;
  } }, "robinhood");
  assert.deepEqual(methods, ["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]);
});

test("rejected or ineffective switches cannot be presented as success", async () => {
  await assert.rejects(() => switchWalletNetwork({ async request() { throw new Error("User rejected"); } }, "robinhood"), /User rejected/);
  await assert.rejects(() => switchWalletNetwork({ async request({ method }) { return method === "eth_chainId" ? "0x2105" : null; } }, "robinhood"), /did not switch/);
});
