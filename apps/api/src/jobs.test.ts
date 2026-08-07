import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { MemoryJobStore, MemoryReportStore, createPersistence, decryptReport, encryptReport, paymentIdempotencyKey, requestHash, runReceiptBoundOperation, verifyRecoveryToken, type PaymentReceipt } from "./jobs.js";

const receipt = (id = "receipt-1"): PaymentReceipt => ({
  id, provider: "mock", network: "eip155:196", chainId: 196, asset: "0x3333333333333333333333333333333333333333",
  amountAtomic: "30000", payer: "payment:owner", payee: "0x2222222222222222222222222222222222222222",
  authorizationId: "authorization", resourceUrl: "/resource", requestHash: "hash",
  verificationResult: "accepted_by_middleware", settlementResult: "settled",
  settlementMode: "synchronous_onchain", finality: { status: "facilitator_confirmed", scope: "l1" },
  createdAt: new Date(0).toISOString(),
  verifiedAt: new Date(0).toISOString(), settledAt: new Date(0).toISOString(),
});

describe("paid jobs and private reports", () => {
  it("separates Base and Arbitrum idempotency namespaces", () => {
    const common = {
      provider: "cdp", authorizationId: "nonce", payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222", amount: "30000",
      asset: "0x3333333333333333333333333333333333333333", resourceUrl: "/v1/analysis/prediction/standard",
      requestHash: requestHash({ primaryMarketId: "pm:1" }), mode: "prediction", tier: "standard",
    };
    assert.notEqual(
      paymentIdempotencyKey({ ...common, network: "eip155:8453" }),
      paymentIdempotencyKey({ ...common, network: "eip155:42161" }),
    );
  });

  it("returns one job for repeated payment authorization", async () => {
    const store = new MemoryJobStore();
    const input = {
      idempotencyKey: "same", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:8453", mode: "prediction" as const, tier: "standard" as const,
      payer: "0x1111111111111111111111111111111111111111", maxRegenerationAttempts: 2,
    };
    const first = await store.acquire(input);
    const replay = await store.acquire(input);
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.job.id, first.job.id);
  });

  it("grants exactly two receipt-bound regenerations then requires reconciliation", async () => {
    const store = new MemoryJobStore();
    const { job } = await store.acquire({
      idempotencyKey: "regen", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:196", mode: "fused", tier: "premium",
      payer: "0x1111111111111111111111111111111111111111", maxRegenerationAttempts: 2,
    });
    await store.bindReceipt(job.id, receipt());
    assert.equal((await store.grantRegeneration(job.id)).regenerationAttempts, 1);
    assert.equal((await store.grantRegeneration(job.id)).regenerationAttempts, 2);
    assert.equal((await store.grantRegeneration(job.id)).stage, "manual_reconciliation");
  });

  it("protects job recovery with an opaque token and stores a normalized receipt", async () => {
    const store = new MemoryJobStore();
    const acquired = await store.acquire({
      idempotencyKey: "recovery", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:196", mode: "prediction", tier: "standard",
      payer: "payment:owner", maxRegenerationAttempts: 2,
    });
    assert.ok(acquired.recoveryToken);
    assert.equal(verifyRecoveryToken(acquired.job, acquired.recoveryToken!), true);
    assert.equal(verifyRecoveryToken(acquired.job, "wrong"), false);
    const bound = await store.bindReceipt(acquired.job.id, receipt());
    assert.equal(bound.receipt?.provider, "mock");
    assert.equal(bound.receipt?.amountAtomic, "30000");
  });

  it("atomically binds the settlement receipt before making a job claimable", async () => {
    const store = new MemoryJobStore();
    const acquired = await store.acquire({
      idempotencyKey: "atomic-queue", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:196", mode: "spot", tier: "standard", payer: "payment:owner",
      input: { instId: "BTC-USDT" }, networkKey: "xlayer", requesterIp: "127.0.0.1",
      maxRegenerationAttempts: 2,
    });
    assert.equal(await store.claim("worker", 30), null);
    await store.bindReceiptAndEnqueue(acquired.job.id, receipt());
    const claimed = await store.claim("worker", 30);
    assert.equal(claimed?.receipt?.settlementResult, "settled");
    assert.deepEqual(claimed?.input, { instId: "BTC-USDT" });
  });

  it("only the lease owner can extend active work", async () => {
    const store = new MemoryJobStore();
    const acquired = await store.acquire({
      idempotencyKey: "lease-owner", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:196", mode: "spot", tier: "standard", payer: "payment:owner",
      maxRegenerationAttempts: 2,
    });
    await store.bindReceiptAndEnqueue(acquired.job.id, receipt());
    await store.claim("owner", 1);
    assert.equal(await store.extendLease(acquired.job.id, "intruder", 30), false);
    assert.equal(await store.extendLease(acquired.job.id, "owner", 30), true);
  });

  it("adds report reconciliation metadata to the bound receipt", async () => {
    const store = new MemoryJobStore();
    const { job } = await store.acquire({
      idempotencyKey: "receipt-report", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:196", mode: "prediction", tier: "standard",
      payer: "0x1111111111111111111111111111111111111111", maxRegenerationAttempts: 2,
    });
    await store.bindReceipt(job.id, receipt());
    const completed = await store.attachReport(job.id, "report-1");
    assert.equal(completed.receipt?.reportId, "report-1");
    assert.ok(completed.receipt?.completedAt);
  });

  it("normalizes post-settlement deliverable failures into the receipt", async () => {
    const store = new MemoryJobStore();
    const { job } = await store.acquire({
      idempotencyKey: "receipt-failure", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:196", mode: "fused", tier: "premium",
      payer: "0x1111111111111111111111111111111111111111", maxRegenerationAttempts: 2,
    });
    await store.bindReceipt(job.id, receipt());
    const failed = await store.transition(job.id, "failed_retriable", "provider unavailable");
    assert.deepEqual(failed.receipt?.failureState, {
      stage: "failed_retriable", detail: "provider unavailable", at: failed.updatedAt,
    });
  });

  it("refuses regeneration without a settled receipt", async () => {
    const store = new MemoryJobStore();
    const { job } = await store.acquire({
      idempotencyKey: "unsettled", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:196", mode: "prediction", tier: "standard",
      payer: "payment:owner", maxRegenerationAttempts: 2,
    });
    await assert.rejects(() => store.grantRegeneration(job.id), /settled payment receipt/);
  });

  it("regenerates a failed deliverable twice without creating another payment", async () => {
    const store = new MemoryJobStore();
    const acquired = await store.acquire({
      idempotencyKey: "automatic-regen", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:8453", mode: "fused", tier: "standard",
      payer: "payment:owner", maxRegenerationAttempts: 2,
    });
    await store.bindReceipt(acquired.job.id, receipt("one-settlement"));
    let calls = 0;
    const result = await runReceiptBoundOperation(store, acquired.job.id, 2, async () => {
      calls += 1;
      if (calls < 3) throw new Error(`temporary-${calls}`);
      return "delivered";
    });
    assert.equal(result, "delivered");
    assert.equal(calls, 3);
    const job = await store.get(acquired.job.id);
    assert.equal(job?.receiptId, "one-settlement");
    assert.equal(job?.regenerationAttempts, 2);
    assert.equal(job?.events.filter((event) => event.stage === "failed_retriable").length, 2);
  });

  it("does not regenerate a failed deliverable before settlement", async () => {
    const store = new MemoryJobStore();
    const acquired = await store.acquire({
      idempotencyKey: "automatic-unsettled", requestHash: "hash", resourceUrl: "/resource",
      network: "eip155:42161", mode: "prediction", tier: "premium",
      payer: "payment:owner", maxRegenerationAttempts: 2,
    });
    let calls = 0;
    await assert.rejects(() => runReceiptBoundOperation(store, acquired.job.id, 2, async () => {
      calls += 1;
      throw new Error("generation failed");
    }), /settled payment receipt/);
    assert.equal(calls, 1);
  });

  it("stores reports privately with integrity metadata", async () => {
    const store = new MemoryReportStore();
    const record = await store.save("0xABC", { answer: 42 });
    assert.equal(record.visibility, "private");
    assert.equal(record.ownerWallet, "0xabc");
    assert.equal(record.checksum.length, 64);
    assert.deepEqual(await store.read(record), { answer: 42 });
    assert.deepEqual(await store.get(record.id), record);
  });

  it("encrypts public-store report payloads with authenticated AES-256-GCM", () => {
    const key = randomBytes(32).toString("base64url");
    const plaintext = JSON.stringify({ private: "report" });
    const encrypted = encryptReport(plaintext, key);
    assert.equal(encrypted.includes("report"), false);
    assert.equal(decryptReport(encrypted, key), plaintext);
    const envelope = JSON.parse(encrypted) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.startsWith("A") ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
    assert.throws(() => decryptReport(JSON.stringify(envelope), key));
  });

  it("creates opaque revocable report shares", async () => {
    const store = new MemoryReportStore();
    const record = await store.save("payment:owner", { answer: 42 });
    const share = await store.createShare(record.id);
    assert.ok(share.token.length > 60);
    assert.equal((await store.resolveShare(share.token))?.id, record.id);
    assert.equal(await store.revokeShare(share.token), true);
    assert.equal(await store.resolveShare(share.token), null);
  });

  it("selects explicit local persistence providers", () => {
    const persistence = createPersistence({
      QUEUE_PROVIDER: "memory", STORAGE_PROVIDER: "memory", KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "", BLOB_READ_WRITE_TOKEN: "", JOB_STAGE_RETENTION_DAYS: 30, REPORT_RETENTION_DAYS: 90,
    });
    assert.ok(persistence.jobs instanceof MemoryJobStore);
    assert.ok(persistence.reports instanceof MemoryReportStore);
  });
});
