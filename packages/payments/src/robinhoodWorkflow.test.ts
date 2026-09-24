import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExactEvmScheme as Buyer } from "@x402/evm/exact/client";
import type { AppConfig } from "@pulse/config";
import { createRobinhoodSelfHostedFacilitator } from "./robinhoodSelfHosted.js";
import { createRobinhoodPaymentMiddleware } from "./robinhoodMiddleware.js";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";
import type { RobinhoodAttempt, RobinhoodJournal } from "./robinhoodSettlement.js";

test("localhost SDK challenge → buyer signature → private facilitator → proof → response/replay; no second charge", async () => {
  // Synthetic chain/RPC and public fixture key. No real funds or external calls.
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const payee = `0x${"2".repeat(40)}` as Hex;
  const transaction = `0x${"a".repeat(64)}` as Hex;
  let transfers = 0;
  let proofAvailable = false;
  const rows = new Map<string, RobinhoodAttempt>();
  const journal: RobinhoodJournal = {
    get: async id => structuredClone(rows.get(id) || null),
    claim: async row => { if (rows.has(row.id)) return false; rows.set(row.id, structuredClone(row)); return true; },
    replace: async (old, next) => { if (JSON.stringify(rows.get(old.id)) !== JSON.stringify(old)) return false; rows.set(next.id, structuredClone(next)); return true; },
  };
  const facilitator = createRobinhoodSelfHostedFacilitator({ payTo: payee, amounts: ["200000"], signer: {
    getAddresses: () => [account.address],
    getCode: async ({ address }) => address.toLowerCase() === CHAIN.asset.toLowerCase() ? "0x6001" : "0x",
    verifyTypedData: args => verifyTypedData(args as Parameters<typeof verifyTypedData>[0]),
    readContract: async () => undefined,
    writeContract: async () => { transfers++; return transaction; },
    sendTransaction: async () => { throw new Error("Unsupported"); },
    waitForTransactionReceipt: async () => { throw new Error("Simulated lost RPC response after broadcast"); },
  } });
  const cfg = { BASE_URL: "http://localhost", PAY_TO_ADDRESS: payee,
    routes: { "POST /v1/preflight": { priceUsd: 0.2, description: "Risk report fixture" } },
  } as unknown as AppConfig;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    Object.assign(req, { pulseNetworkKey: "robinhood" });
    if (!/^0x[\da-f]{40}$/i.test(req.body?.tokenAddress || "")) { res.status(400).json({ error: "Token required" }); return; }
    next();
  });
  app.use(createRobinhoodPaymentMiddleware(cfg, { facilitator, journal, provider: "self-hosted", observer: {
    currentBlock: async () => 100n,
    proof: async () => proofAvailable && transfers ? { transaction, blockNumber: "101", blockHash: `0x${"b".repeat(64)}` } : null,
  } }));
  app.post("/v1/preflight", (_req, res) => res.json({ fixture: true, report: "fulfilled" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/v1/preflight`;
  const body = JSON.stringify({ tokenAddress: CHAIN.asset, lang: "en" });
  const post = (signature?: string, requestBody = body) => fetch(url, { method: "POST", body: requestBody, headers: { "Content-Type": "application/json", ...(signature ? { "PAYMENT-SIGNATURE": signature } : {}) } });
  try {
    const invalid = await post(undefined, "{}"); assert.equal(invalid.status, 400); assert.equal(invalid.headers.get("PAYMENT-REQUIRED"), null);
    const challengeResponse = await post(); assert.equal(challengeResponse.status, 402);
    const challenge = JSON.parse(Buffer.from(challengeResponse.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
    assert.equal(challenge.accepts[0].network, CHAIN.network);
    assert.equal(challenge.accepts[0].extra.name, "Global Dollar");
    assert.equal(transfers, 0);
    const signed = await new Buyer(account).createPaymentPayload(2, challenge.accepts[0]);
    const header = Buffer.from(JSON.stringify({ ...signed, accepted: challenge.accepts[0], resource: challenge.resource })).toString("base64");
    const uncertain = await post(header);
    assert.equal(uncertain.status, 503);
    const pending = await uncertain.json() as { code: string; retrySamePayment: boolean };
    assert.equal(pending.code, "payment_reconciliation_pending"); assert.equal(pending.retrySamePayment, true);
    assert.equal(uncertain.headers.get("PAYMENT-REQUIRED"), null);
    assert.equal(transfers, 1);
    proofAvailable = true;
    const delivered = await post(header); assert.equal(delivered.status, 200);
    const receipt = JSON.parse(Buffer.from(delivered.headers.get("PAYMENT-RESPONSE")!, "base64").toString());
    assert.equal(receipt.transaction, transaction); assert.equal(receipt.finality.scope, "l2");
    assert.equal((await post(header)).status, 200);
    assert.equal((await post(header, JSON.stringify({ tokenAddress: payee, lang: "en" }))).status, 400);
    assert.equal(transfers, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
