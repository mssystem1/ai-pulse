import assert from "node:assert/strict";
import test from "node:test";
import { verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExactEvmScheme as Buyer } from "@x402/evm/exact/client";
import type { PaymentPayload } from "@x402/core/types";
import { createRobinhoodSelfHostedFacilitator, type RobinhoodGasSigner } from "./robinhoodSelfHosted.js";
import { createRobinhoodPaymentServer } from "./robinhoodServer.js";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const payTo = `0x${"2".repeat(40)}` as Hex;
const transaction = `0x${"a".repeat(64)}` as Hex;
function fixture() {
  let writes = 0, simulations = 0;
  const signer: RobinhoodGasSigner = {
    getAddresses: () => [account.address],
    readContract: async args => { assert.equal(args.address.toLowerCase(), CHAIN.asset.toLowerCase());
      if (args.functionName === "transferWithAuthorization") { simulations++; return undefined; }
      throw new Error("Unexpected fixture read"); },
    verifyTypedData: args => verifyTypedData(args as Parameters<typeof verifyTypedData>[0]),
    getCode: async ({ address }) => address.toLowerCase() === CHAIN.asset.toLowerCase() ? "0x6001" : "0x",
    writeContract: async args => { assert.equal(args.functionName, "transferWithAuthorization"); assert.equal(args.address.toLowerCase(), CHAIN.asset.toLowerCase()); writes++; return transaction; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
    sendTransaction: async () => { throw new Error("No arbitrary transactions"); },
  };
  const facilitator = createRobinhoodSelfHostedFacilitator({ signer, payTo, amounts: ["200000", "300000"] });
  return { signer, facilitator, writes: () => writes, simulations: () => simulations };
}
async function request(facilitator: ReturnType<typeof fixture>["facilitator"]) {
  const seller = await createRobinhoodPaymentServer(facilitator);
  const [requirements] = await seller.requirements("0.20", payTo);
  const buyer = await new Buyer(account).createPaymentPayload(2, requirements);
  const payload: PaymentPayload = { ...buyer, accepted: requirements, resource: { url: "http://localhost/robinhood/v1/preflight" } };
  return { requirements, payload };
}
test("self-hosted SDK advertises only exact v2 Robinhood mainnet USDG", async () => {
  const deps = fixture(); const supported = await deps.facilitator.getSupported();
  assert.equal(supported.kinds.length, 1);
  assert.equal(supported.kinds[0].network, CHAIN.network);
  assert.equal(supported.kinds[0].x402Version, 2);
  assert.equal(supported.kinds[0].extra?.asset, CHAIN.asset);
  assert.equal(deps.writes(), 0);
});
test("official buyer SDK authorization verifies and settles through the embedded facilitator", async () => {
  const deps = fixture(); const { payload, requirements } = await request(deps.facilitator);
  const verified = await deps.facilitator.verify(payload, requirements);
  assert.equal(verified.isValid, true);
  assert.equal(deps.writes(), 0);
  const settled = await deps.facilitator.settle(payload, requirements);
  assert.equal(settled.success, true);
  assert.equal(settled.transaction, transaction);
  assert.equal(deps.writes(), 1);
  assert.ok(deps.simulations() >= 2, "Simulate again immediately before settlement");
});
test("merchant policy rejects other chains/tokens/recipients/amounts and Permit2 before touching the signer", async () => {
  const deps = fixture(); const requestData = await request(deps.facilitator);
  for (const change of ["chain", "asset", "payee", "amount", "permit2", "malformed"]) {
    const { payload, requirements } = structuredClone(requestData);
    if (change === "chain") requirements.network = "eip155:8453";
    if (change === "asset") requirements.asset = payTo;
    if (change === "payee") requirements.payTo = account.address;
    if (change === "amount") requirements.amount = "1";
    if (change === "permit2") payload.payload.permit2Authorization = {};
    if (change === "malformed") (requirements as unknown as { asset: number }).asset = 1;
    assert.equal((await deps.facilitator.verify(payload, requirements)).isValid, false, change);
    assert.equal((await deps.facilitator.settle(payload, requirements)).success, false, change);
  }
  assert.equal(deps.writes(), 0); assert.equal(deps.simulations(), 0);
});
