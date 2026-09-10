// Explicit isolated writes against REDIS_URL. No API/worker startup, AI calls,
// payment signing or on-chain actions. Production records are never selected.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { runNativeRedisCommand, closeNativeRedisConnections, validateRedisUrl } from "../apps/api/dist/nativeRedis.js";
import { RedisJobStore, VercelBlobReportStore } from "../apps/api/dist/jobs.js";
import { RedisArcBudgetStore } from "../apps/api/dist/arcBudget.js";
import { reserveAutopilotAiBudget } from "../apps/api/dist/autopilotAiBudget.js";
import { extendAutopilotPass, mutateAutopilotPass, getAutopilotPass, synchronizeAutopilotPassPause, autopilotPassRemainingMs } from "../apps/api/dist/autopilotPassStore.js";

if (!process.argv.includes("--run")) {
  console.log("Use --run for isolated Redis integration writes; add --blob to test one encrypted Blob report. No trades/payments are made.");
  process.exit(0);
}
const url = (process.argv.includes("--public") ? process.env.REDIS_PUBLIC_URL : process.env.REDIS_URL) || "";
process.env.REDIS_URL = url;
process.env.QUEUE_PROVIDER = "redis";
const namespace = `pulse:readiness:${randomUUID()}`;
const vault = `0x${randomBytes(20).toString("hex")}`;
const passKey = `pulse:v6:autopilot:pass:base:${vault}`;
const owner = `0x${"1".repeat(40)}`;
const blobUrls = [];
const command = (...args) => runNativeRedisCommand(url, args);
async function ownedKeys() {
  let cursor = "0";
  const keys = new Set();
  do {
    const page = await command("SCAN", cursor, "MATCH", `${namespace}:*`, "COUNT", 200);
    cursor = String(page[0]);
    for (const key of page[1]) if (key.startsWith(`${namespace}:`)) keys.add(key);
  } while (cursor !== "0");
  return [...keys];
}
let connected = false;
try {
  validateRedisUrl(url);
  assert.equal(await command("PING"), "PONG"); connected = true;
  const jobs = new RedisJobStore(url, "", 60, namespace);
  const input = { idempotencyKey: "fixture-authorization", requestHash: "fixture", resourceUrl: "/fixture", network: "eip155:8453", networkKey: "base", mode: "spot", tier: "standard", payer: owner, maxRegenerationAttempts: 2 };
  const acquired = await Promise.all(Array.from({ length: 4 }, () => jobs.acquire(input)));
  assert.equal(acquired.filter(item => item.created).length, 1);
  assert.equal(new Set(acquired.map(item => item.job.id)).size, 1);
  const job = acquired[0].job;
  const now = new Date().toISOString();
  const receipt = { id: "fixture-receipt", provider: "mock", network: "eip155:8453", chainId: 8453, asset: owner, amountAtomic: "0", payer: owner, payee: owner, authorizationId: "fixture", resourceUrl: "/fixture", requestHash: "fixture", verificationResult: "accepted_by_middleware", settlementResult: "settled", settlementMode: "mock", finality: { status: "simulated", scope: "mock" }, createdAt: now, verifiedAt: now, settledAt: now };
  await jobs.bindReceiptAndEnqueue(job.id, receipt);
  const claims = await Promise.all([jobs.claim("worker-a", 30), jobs.claim("worker-b", 30)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const worker = claims[0] ? "worker-a" : "worker-b";
  assert.equal(await jobs.extendLease(job.id, "wrong-owner", 30), false);
  assert.equal(await jobs.extendLease(job.id, worker, 30), true);
  await jobs.requeue(job.id, worker);
  assert.equal((await jobs.claim(worker, 30))?.id, job.id);
  await jobs.attachReport(job.id, "fixture-report");
  await jobs.ack(job.id, worker);
  assert.deepEqual(await jobs.queueStats(), { ready: 0, leased: 0 });
  assert.equal((await jobs.listByPayer(owner, "base"))[0]?.receipt?.reportId, "fixture-report");
  closeNativeRedisConnections();
  assert.equal((await new RedisJobStore(url, "", 60, namespace).get(job.id))?.stage, "completed");
  console.log("PASS: payment deduplication, atomic receipt+enqueue, exclusive claims, lease ownership, requeue, report attachment, reconnect recovery");

  const limits = { walletHourly: 1, ipHourly: 2, walletDaily: 2, dailyCostMicrousd: 100 };
  const arc = new RedisArcBudgetStore(url, "", limits, namespace);
  await arc.reserve({ wallet: owner, ip: "fixture", estimatedCostMicrousd: 1, reservationId: "same" });
  await arc.reserve({ wallet: owner, ip: "fixture", estimatedCostMicrousd: 1, reservationId: "same" });
  await assert.rejects(arc.reserve({ wallet: owner, ip: "fixture", estimatedCostMicrousd: 1, reservationId: "other" }), /wallet hourly/);
  const budget = { strategyId: vault, estimatedCostUsd: 0.01, namespace, limits: { maxCallsPerVaultDay: 1, maxCallsGlobalDay: 2, maxUsdPerVaultDay: 0.1, maxUsdGlobalDay: 0.2 } };
  const reservations = await Promise.allSettled(["a", "b"].map(reservationId => reserveAutopilotAiBudget({ ...budget, reservationId })));
  assert.equal(reservations.filter(result => result.status === "fulfilled").length, 1);
  console.log("PASS: Arc and Autopilot budget reservations remain atomic and deduplicated");

  const start = Date.now();
  const passInput = { owner, network: "base", vault, days: 1, paused: false };
  await mutateAutopilotPass("base", vault, current => extendAutopilotPass(current, passInput, start));
  await command("EXPIRE", passKey, 60);
  await Promise.all(Array.from({ length: 3 }, () => mutateAutopilotPass("base", vault, current => ({ ...current, signalsUsed: current.signalsUsed + 1 }))));
  let pass = await getAutopilotPass("base", vault);
  assert.equal(pass.signalsUsed, 3);
  pass = await synchronizeAutopilotPassPause(pass, true, start + 3_600_000);
  assert.equal(autopilotPassRemainingMs(pass, start + 5 * 86_400_000), 23 * 3_600_000);
  pass = await synchronizeAutopilotPassPause(pass, false, start + 5 * 86_400_000);
  assert.equal(autopilotPassRemainingMs(pass, start + 5 * 86_400_000), 23 * 3_600_000);
  console.log("PASS: concurrent pass updates, frozen paused time and resumed remaining time");

  if (process.argv.includes("--blob")) {
    const store = new VercelBlobReportStore(process.env.BLOB_READ_WRITE_TOKEN || "", url, "", 60, namespace, "public", process.env.REPORT_ENCRYPTION_KEY || "", {
      putBlob: async (...args) => { const result = await put(...args); blobUrls.push(result.url); return result; },
    });
    const record = await store.save(owner, { fixture: "PULSE Redis migration", paid: false });
    assert.ok(blobUrls.includes(record.blobPath), "Blob must succeed, not silently use the Redis fallback");
    assert.deepEqual(await store.read(record), { fixture: "PULSE Redis migration", paid: false });
    const share = await store.createShare(record.id);
    assert.equal((await store.resolveShare(share.token))?.id, record.id);
    assert.equal(await store.revokeShare(share.token), true);
    assert.equal(await store.resolveShare(share.token), null);
    console.log("PASS: encrypted Blob report with Railway metadata, integrity verification and share revocation");
  }
} catch (error) {
  // Test payloads contain no real payment/wallet data. Avoid printing stack or URLs.
  console.error("Integration check failed:", String(error?.message || "unknown error").replace(/rediss?:\/\/\S+/g, "[redacted connection]"));
  process.exitCode = 1;
} finally {
  if (connected) {
    try {
      const keys = [...await ownedKeys(), passKey];
      for (const key of keys) await command("DEL", key);
      console.log("Removed isolated Redis test records; production records untouched.");
    } catch { console.error("Test cleanup incomplete; inspect the test namespace:", namespace, "and exact fixture pass:", passKey); process.exitCode = 1; }
  }
  for (const url of blobUrls) {
    try { await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN }); }
    catch { console.error("Isolated Blob cleanup failed; inspect report folder for test namespace:", namespace); process.exitCode = 1; }
  }
  closeNativeRedisConnections();
}
