import test from "node:test";
import assert from "node:assert/strict";
import { assertArcUsdcGasReserve, fetchArcGatewayBalance, parseGatewayDepositAmount, parseEnabledWebNetworks, readPreferredNetwork } from "./networks";

test("Gateway deposits retain six-decimal precision and never round extra digits", () => {
  assert.equal(parseGatewayDepositAmount("0.000001"), 1n);
  assert.equal(parseGatewayDepositAmount("12.345678"), 12345678n);
  for (const invalid of ["0", "-1", "0.0000009", "1e3", "NaN"]) assert.throws(() => parseGatewayDepositAmount(invalid));
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
