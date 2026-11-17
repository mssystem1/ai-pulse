import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, encryptReport } from "./jobs.js";
import { RecoveredReportArchive, readArchivedReport, type ArchivedReport } from "./recoveredReportArchive.js";

const owner = "0xa7d827622c4f9c884ca8f751b2060dd767f18683";
const otherOwner = "0x1111111111111111111111111111111111111111";
const key = Buffer.alloc(32, 7).toString("base64url");
const blobPath = "https://abc123.public.blob.vercel-storage.com/reports/example.json";

function row(overrides: Partial<ArchivedReport> = {}): ArchivedReport {
  const reportId = randomUUID(), createdAt = "2026-10-12T19:50:39.770Z";
  return {
    version: "recovered-report-v1", id: `archive:${reportId}`, reportId, owner,
    networkKey: "base", mode: "spot", tier: "premium", label: "BTC-USDT · Global Pro",
    createdAt, metadata: { id: reportId, ownerWallet: owner, visibility: "private", blobPath, checksum: "a".repeat(64), createdAt },
    originalJobId: randomUUID(), originalExpiresAt: 1_800_000_000_000, sourceNamespace: "pulse:production", evidenceKind: "redis-report",
    ...overrides,
  };
}

function responseFetch(body: string): typeof fetch {
  return (async () => new Response(body, { status: 200 })) as typeof fetch;
}

function withChecksum(body: string): ArchivedReport {
  const value = row();
  return { ...value, metadata: { ...value.metadata, checksum: createHash("sha256").update(body).digest("hex") } };
}

describe("recovered report archive", () => {
  it("isolates owners and includes unknown-network records only in the owner's history", async () => {
    const archive = new RecoveredReportArchive();
    const known = row(), unknown = row({ networkKey: null });
    await archive.insertMissing(known);
    await archive.insertMissing(unknown);
    assert.equal((await archive.list(owner, "base")).length, 2);
    assert.equal((await archive.list(owner, "arc")).length, 1);
    assert.equal((await archive.list(otherOwner, "base")).length, 0);
    assert.equal(await archive.get(otherOwner, known.id), null);
    assert.equal((await archive.get(owner, known.id))?.reportId, known.reportId);
  });

  it("rejects owner/id mismatches and untrusted blob URLs", async () => {
    const archive = new RecoveredReportArchive();
    const wrongOwner = row({ owner: otherOwner });
    await assert.rejects(archive.insertMissing(wrongOwner), /metadata does not match/);
    const base = row();
    await assert.rejects(archive.insertMissing({ ...base, id: `archive:${randomUUID()}` }), /Invalid recovered report identity/);
    const wrongId = { ...base, metadata: { ...base.metadata, id: randomUUID() } };
    await assert.rejects(archive.insertMissing(wrongId), /metadata does not match/);
    const badUrl = { ...base, metadata: { ...base.metadata, blobPath: "https://127.0.0.1/private" } };
    await assert.rejects(archive.insertMissing(badUrl), /approved Vercel Blob URL/);
    const redirectingUrl = { ...base, metadata: { ...base.metadata, blobPath: "https://public.blob.vercel-storage.com/report.json" } };
    await assert.rejects(archive.insertMissing(redirectingUrl), /approved Vercel Blob URL/);
  });

  it("keeps the first archived value for an existing archive id", async () => {
    const archive = new RecoveredReportArchive(), original = row();
    assert.equal(await archive.insertMissing(original), true);
    assert.equal(await archive.insertMissing({ ...original, label: "changed" }), false);
    assert.equal((await archive.get(owner, original.id))?.label, original.label);
  });

  it("reads plaintext historical JSON only after checksum verification", async () => {
    const report = { service: "global", analysis: "saved", nested: { ok: true } };
    const body = canonicalJson(report), archived = withChecksum(body);
    assert.deepEqual(await readArchivedReport(archived, key, responseFetch(body)), report);
    await assert.rejects(readArchivedReport(archived, key, responseFetch("{}")), /checksum mismatch/);
  });

  it("decrypts and verifies historical encrypted reports", async () => {
    const report = { service: "prediction", result: "original" }, body = canonicalJson(report);
    const encrypted = encryptReport(body, key);
    const archived = withChecksum(body);
    assert.deepEqual(await readArchivedReport(archived, key, responseFetch(encrypted)), report);
    await assert.rejects(readArchivedReport(archived, Buffer.alloc(32, 8).toString("base64url"), responseFetch(encrypted)));
  });
});
