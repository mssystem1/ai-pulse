import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "@pulse/config";
import { createApp } from "./app.js";
import { canonicalJson, MemoryJobStore, MemoryReportStore } from "./jobs.js";
import { RecoveredReportArchive, type ArchivedReport } from "./recoveredReportArchive.js";

const owner = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const other = privateKeyToAccount("0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const blobPath = "https://recovered.public.blob.vercel-storage.com/archive/report.json";

function archiveRow(wallet: string, networkKey: ArchivedReport["networkKey"], mode = "spot" as const): ArchivedReport {
  const reportId = randomUUID(), createdAt = "2026-10-12T19:50:39.770Z";
  const report = { service: "global", original: true };
  return {
    version: "recovered-report-v1", id: `archive:${reportId}`, reportId, owner: wallet.toLowerCase(),
    networkKey, mode, tier: "premium", label: "Recovered original report", createdAt,
    metadata: { id: reportId, ownerWallet: wallet.toLowerCase(), visibility: "private", blobPath, checksum: createHash("sha256").update(canonicalJson(report)).digest("hex"), createdAt },
    originalJobId: null, originalExpiresAt: null, sourceNamespace: "pulse:legacy", evidenceKind: "saved-delivery",
  };
}

async function issueSession(origin: string, wallet: typeof owner, networkKey: "base" | "arc") {
  const challengeResponse = await fetch(`${origin}/v1/report-history/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: wallet.address, networkKey }),
  });
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json() as { nonce: string; message: string };
  const signature = await wallet.signMessage({ message: challenge.message });
  const sessionResponse = await fetch(`${origin}/v1/report-history/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: wallet.address, networkKey, nonce: challenge.nonce, signature }),
  });
  assert.equal(sessionResponse.status, 200);
  return (await sessionResponse.json() as { sessionToken: string }).sessionToken;
}

test("recovered report routes enforce wallet/network scope and keep archived reports read only", async () => {
  const envKeys = ["QUEUE_PROVIDER", "STORAGE_PROVIDER", "KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
  const previousEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  process.env.QUEUE_PROVIDER = "memory";
  process.env.STORAGE_PROVIDER = "memory";
  process.env.KV_REST_API_URL = "";
  process.env.KV_REST_API_TOKEN = "";

  const jobs = new MemoryJobStore(), archive = new RecoveredReportArchive();
  const baseRow = archiveRow(owner.address, "base"), unknownRow = archiveRow(owner.address, null, "risk");
  const arcRow = archiveRow(owner.address, "arc"), otherRow = archiveRow(other.address, "base");
  for (const row of [baseRow, unknownRow, arcRow, otherRow]) await archive.insertMissing(row);
  const cfg = { ...loadConfig(), QUEUE_PROVIDER: "memory" as const, STORAGE_PROVIDER: "memory" as const, X402_MOCK: true, paymentMode: "mock" as const };
  const app = createApp(cfg, { persistence: { jobs, reports: new MemoryReportStore() }, recoveredReports: archive, startDurableWorker: false });
  const server = await new Promise<Server>(resolve => { const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate)); });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    return new Response(canonicalJson({ service: "global", original: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const unauthenticated = await fetch(`${origin}/v1/report-history`);
    assert.equal(unauthenticated.status, 401);

    const baseSession = await issueSession(origin, owner, "base");
    const arcSession = await issueSession(origin, owner, "arc");
    const otherSession = await issueSession(origin, other, "base");
    const headers = { Authorization: `Bearer ${baseSession}` };

    const historyResponse = await fetch(`${origin}/v1/report-history?scope=spot`, { headers });
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.headers.get("cache-control"), "private, no-store, no-cache, max-age=0, must-revalidate");
    const history = await historyResponse.json() as { reports: Array<{ id: string; archived?: boolean; networkUnknown?: boolean; mode: string }> };
    assert.deepEqual(history.reports.map(row => row.id), [baseRow.id]);
    assert(history.reports.every(row => row.archived && row.mode === "spot"));

    const unknownHistory = await fetch(`${origin}/v1/report-history?scope=risk`, { headers });
    const unknown = await unknownHistory.json() as { reports: Array<{ id: string; networkUnknown?: boolean }> };
    assert.equal(unknown.reports[0]?.id, unknownRow.id);
    assert.equal(unknown.reports[0]?.networkUnknown, true);

    const opened = await fetch(`${origin}/v1/report-history/${encodeURIComponent(unknownRow.id)}/report`, { headers });
    assert.equal(opened.status, 200);
    const openedBody = await opened.json() as { report: { original?: boolean }; recoveredArchive?: { readOnly?: boolean; networkUnknown?: boolean } };
    assert.equal(openedBody.report.original, true);
    assert.equal(openedBody.recoveredArchive?.readOnly, true);
    assert.equal(openedBody.recoveredArchive?.networkUnknown, true);

    const wrongNetwork = await fetch(`${origin}/v1/report-history/${encodeURIComponent(arcRow.id)}/report`, { headers });
    assert.equal(wrongNetwork.status, 403);
    const rightNetwork = await fetch(`${origin}/v1/report-history/${encodeURIComponent(arcRow.id)}/report`, { headers: { Authorization: `Bearer ${arcSession}` } });
    assert.equal(rightNetwork.status, 200);
    const wrongOwner = await fetch(`${origin}/v1/report-history/${encodeURIComponent(baseRow.id)}/report`, { headers: { Authorization: `Bearer ${otherSession}` } });
    assert.equal(wrongOwner.status, 404);

    const retry = await fetch(`${origin}/v1/report-history/${encodeURIComponent(baseRow.id)}/retry`, { method: "POST", headers });
    assert.equal(retry.status, 409);
    assert.match(String((await retry.json() as { error: string }).error), /read only/i);
    assert.equal((await jobs.listByPayer(owner.address, "base")).length, 0);

    const wrongOwnerRetry = await fetch(`${origin}/v1/report-history/${encodeURIComponent(baseRow.id)}/retry`, { method: "POST", headers: { Authorization: `Bearer ${otherSession}` } });
    assert.equal(wrongOwnerRetry.status, 404);
    const wrongNetworkRetry = await fetch(`${origin}/v1/report-history/${encodeURIComponent(arcRow.id)}/retry`, { method: "POST", headers });
    assert.equal(wrongNetworkRetry.status, 403);
    const invalidArchive = await fetch(`${origin}/v1/report-history/archive%3Ainvalid/report`, { headers });
    assert.equal(invalidArchive.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
