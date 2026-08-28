import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import { createApp } from "./app.js";
import { MemoryJobStore, MemoryReportStore, type PaymentReceipt } from "./jobs.js";

const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

test("wallet history retries a terminal settled report without another payment", async () => {
  const jobs = new MemoryJobStore();
  const reports = new MemoryReportStore();
  const acquired = await jobs.acquire({
    idempotencyKey: "history-retry", requestHash: "request-hash", resourceUrl: "/v1/analysis/spot/standard",
    network: "eip155:196", networkKey: "xlayer", mode: "spot", tier: "standard",
    payer: account.address.toLowerCase(), input: { instId: "BTC-USDT", timeframe: "4H", lang: "en" },
    requesterIp: "127.0.0.1", maxRegenerationAttempts: 2,
  });
  const receipt: PaymentReceipt = {
    id: "settled-history-receipt", provider: "mock", network: "eip155:196", chainId: 196,
    asset: "0x3333333333333333333333333333333333333333", amountAtomic: "100000",
    payer: account.address.toLowerCase(), payee: "0x2222222222222222222222222222222222222222",
    authorizationId: "authorization", resourceUrl: "/v1/analysis/spot/standard", requestHash: "request-hash",
    verificationResult: "accepted_by_middleware", settlementResult: "settled", settlementMode: "mock",
    finality: { status: "simulated", scope: "mock" }, createdAt: new Date(0).toISOString(),
    verifiedAt: new Date(0).toISOString(), settledAt: new Date(0).toISOString(),
  };
  await jobs.bindReceipt(acquired.job.id, receipt);
  await jobs.transition(acquired.job.id, "failed_terminal", "provider output was truncated");

  const cfg = {
    ...loadConfig(), X402_MOCK: true, paymentMode: "mock" as const,
    QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const,
  };
  const app = createApp(cfg, { persistence: { jobs, reports }, startDurableWorker: false });
  const server = await new Promise<Server>((resolve) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
  });
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const challengeResponse = await fetch(`${origin}/v1/report-history/challenge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: account.address, networkKey: "xlayer" }),
    });
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json() as { nonce: string; message: string };
    const signature = await account.signMessage({ message: challenge.message });
    const sessionResponse = await fetch(`${origin}/v1/report-history/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: account.address, networkKey: "xlayer", nonce: challenge.nonce, signature }),
    });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json() as { sessionToken: string };

    const historyResponse = await fetch(`${origin}/v1/report-history`, {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
    });
    const history = await historyResponse.json() as { reports: Array<{ id: string; stage: string; ready: boolean }> };
    assert.deepEqual(history.reports.map(({ id, stage, ready }) => ({ id, stage, ready })), [
      { id: acquired.job.id, stage: "failed_terminal", ready: false },
    ]);

    const retryResponse = await fetch(`${origin}/v1/report-history/${acquired.job.id}/retry`, {
      method: "POST", headers: { Authorization: `Bearer ${session.sessionToken}` },
    });
    assert.equal(retryResponse.status, 202);
    const retried = await retryResponse.json() as { retriedWithoutPayment?: boolean; job?: { stage?: string; receipt?: { id?: string } } };
    assert.equal(retried.retriedWithoutPayment, true);
    assert.equal(retried.job?.stage, "fetching_context");
    assert.equal(retried.job?.receipt?.id, receipt.id);
    assert.equal((await jobs.get(acquired.job.id))?.receiptId, receipt.id);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
