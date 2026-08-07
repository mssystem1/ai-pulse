import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { loadConfig } from "../packages/config/dist/index.js";
import { UpstashJobStore } from "../apps/api/dist/jobs.js";

const cfg = loadConfig();
if (!cfg.KV_REST_API_URL || !cfg.KV_REST_API_TOKEN) throw new Error("Upstash write credentials are not configured");
const namespace = `pulse:readiness:${randomUUID()}`;
const store = new UpstashJobStore(cfg.KV_REST_API_URL, cfg.KV_REST_API_TOKEN, 60, namespace);
const redis = new Redis({ url: cfg.KV_REST_API_URL, token: cfg.KV_REST_API_TOKEN });
let jobId = "";
const idempotencyKey = randomUUID();
try {
  const acquired = await store.acquire({
    idempotencyKey, requestHash: "readiness", resourceUrl: "/readiness",
    network: "eip155:196", mode: "spot", tier: "standard", payer: "payment:readiness",
    input: { instId: "BTC-USDT" }, networkKey: "xlayer", requesterIp: "127.0.0.1",
    maxRegenerationAttempts: 0,
  });
  jobId = acquired.job.id;
  await store.transition(jobId, "payment_verified");
  await store.transition(jobId, "payment_settled");
  await store.bindReceiptAndEnqueue(jobId, {
    id: randomUUID(), provider: "readiness", network: "eip155:196", chainId: 196,
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", amountAtomic: "1",
    payer: "payment:readiness", payee: "0x0000000000000000000000000000000000000001",
    authorizationId: "readiness", resourceUrl: "/readiness", requestHash: "readiness",
    verificationResult: "accepted_by_middleware", settlementResult: "settled",
    createdAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), settledAt: new Date().toISOString(),
  });
  const claimed = await store.claim("readiness-worker", 30);
  if (claimed?.id !== jobId || claimed.receipt?.settlementResult !== "settled") throw new Error("Atomic receipt/claim check failed");
  if (!await store.extendLease(jobId, "readiness-worker", 30)) throw new Error("Lease heartbeat check failed");
  const completed = await store.attachReport(jobId, "readiness-report");
  if (completed.stage !== "completed" || completed.receipt?.reportId !== "readiness-report") throw new Error("Atomic terminal linkage check failed");
  await store.ack(jobId, "readiness-worker");
  const stats = await store.queueStats();
  if (stats.ready !== 0 || stats.leased !== 0) throw new Error("Temporary queue did not drain");
  console.log("Upstash durable queue readiness passed: atomic enqueue, claim, heartbeat, completion, and acknowledgement.");
} finally {
  const keys = [
    `${namespace}:idem:${idempotencyKey}`, `${namespace}:jobs:ready`, `${namespace}:jobs:leased`,
    ...(jobId ? [`${namespace}:job:${jobId}`, `${namespace}:job-lease:${jobId}`] : []),
  ];
  await redis.del(...keys).catch(() => 0);
}
