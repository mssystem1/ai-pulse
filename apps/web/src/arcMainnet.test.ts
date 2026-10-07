import test from "node:test";
import assert from "node:assert/strict";
import { assertArcUsdcGasReserve, depositArcGateway, fetchArcGatewayBalance, parseGatewayDepositAmount, parseEnabledWebNetworks, readPreferredNetwork } from "./networks";

test("Gateway deposits retain six-decimal precision and never round extra digits", () => {
  assert.equal(parseGatewayDepositAmount("0.000001"), 1n);
  assert.equal(parseGatewayDepositAmount("12.345678"), 12345678n);
  for (const invalid of ["0", "-1", "0.0000009", "1e3", "NaN"]) assert.throws(() => parseGatewayDepositAmount(invalid));
});

test("Gateway deposit rechecks wallet gas after approval and cannot spend after the balance changes", async t => {
  const owner = `0x${"1".repeat(40)}`;
  const hash = `0x${"2".repeat(64)}`;
  let balanceReads = 0, sends = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    const result = req.method === "eth_chainId" ? "0x13b2"
      : req.method === "eth_getBalance" ? (++balanceReads === 1 ? "0x1bc16d674ec80000" : "0x0")
      : req.method === "eth_gasPrice" ? "0x4a817c800"
      : req.method === "eth_getTransactionReceipt" ? { transactionHash: hash, transactionIndex: "0x0", blockHash: `0x${"3".repeat(64)}`, blockNumber: "0x64", from: owner, to: "0x3600000000000000000000000000000000000000", cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", logs: [], logsBloom: `0x${"0".repeat(512)}`, status: "0x1", type: "0x2" } : "0x64";
    return Response.json({ jsonrpc: "2.0", id: req.id, result });
  });
  const provider = { async request({ method }: { method: string }) {
    if (method === "eth_chainId") return "0x13b2";
    if (method === "eth_accounts") return [owner];
    if (method === "eth_sendTransaction") { sends++; return hash; }
    throw new Error(`Unexpected wallet request ${method}`);
  } };
  await assert.rejects(() => depositArcGateway(provider, owner, "1"), /no deposit was submitted/);
  assert.equal(sends, 1, "only the simulated approval was sent");
  assert.equal(balanceReads, 2);
});

test("retired Arc preference selects mainnet without relabeling recovery storage", () => {
  assert.equal(readPreferredNetwork({ getItem: () => "arc-testnet" }, ["base", "arc"]), "arc");
});

test("legacy browser rollout settings keep Arc visible as mainnet in the selector and wallet kit", () => {
  assert.deepEqual(parseEnabledWebNetworks("xlayer,base,arbitrum,arc-testnet,robinhood,arc"), ["xlayer", "base", "arbitrum", "arc", "robinhood"]);
  assert.deepEqual(parseEnabledWebNetworks("base,base"), ["base"]);
  assert.deepEqual(parseEnabledWebNetworks("unsupported"), ["xlayer"]);
});

test("Arc ERC-20 spending reserves native USDC gas using the 6-to-18 decimal conversion", async () => {
  let balance = 100_000_000_000_000_000n;
  const provider = { async request({ method }: { method: string }) { return `0x${(method === "eth_getBalance" ? balance : 1n).toString(16)}`; } };
  await assert.rejects(() => assertArcUsdcGasReserve(provider, `0x${"1".repeat(40)}`, 100_000n, 21_000n), /transaction gas/);
  balance += 42_000n;
  await assert.doesNotReject(() => assertArcUsdcGasReserve(provider, `0x${"1".repeat(40)}`, 100_000n, 21_000n));
});

test("Arc Gateway uses the production API and rejects missing or foreign balance evidence", async t => {
  const address = `0x${"1".repeat(40)}`;
  let body: unknown = { balances: [{ domain: 26, balance: "0.200001" }] };
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://gateway-api.circle.com/v1/balances");
    assert.deepEqual(JSON.parse(String(init.body)).sources, [{ domain: 26, depositor: address }]);
    return Response.json(body);
  });
  assert.equal(await fetchArcGatewayBalance(address), 0.200001);
  for (const invalid of [{}, { balances: [{ domain: 26 }] }, { balances: [{ domain: 0, balance: "3" }] }]) {
    body = invalid; await assert.rejects(() => fetchArcGatewayBalance(address), /balance evidence/);
  }
});
