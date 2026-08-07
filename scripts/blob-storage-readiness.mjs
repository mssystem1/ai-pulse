import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { del } from "@vercel/blob";
import { loadConfig } from "../packages/config/dist/index.js";
import { VercelBlobReportStore } from "../apps/api/dist/jobs.js";

const cfg = loadConfig();
if (!cfg.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
if (cfg.BLOB_ACCESS !== "public" || !cfg.REPORT_ENCRYPTION_KEY) throw new Error("This token is a public store; configure BLOB_ACCESS=public and REPORT_ENCRYPTION_KEY");
const namespace = `pulse:readiness:${randomUUID()}`;
const redis = new Redis({ url: cfg.KV_REST_API_URL, token: cfg.KV_REST_API_TOKEN });
const store = new VercelBlobReportStore(cfg.BLOB_READ_WRITE_TOKEN, cfg.KV_REST_API_URL, cfg.KV_REST_API_TOKEN, 60, namespace, "public", cfg.REPORT_ENCRYPTION_KEY);
const payload = { kind: "pulse-private-storage-readiness", nonce: randomUUID() };
let record;
try {
  record = await store.save("payment:readiness", payload);
  const publicCiphertext = await (await fetch(record.blobPath)).text();
  if (publicCiphertext.includes(payload.nonce)) throw new Error("Public Blob exposed report plaintext");
  const received = await store.read(record);
  if (JSON.stringify(received) !== JSON.stringify(payload)) throw new Error("Encrypted report round-trip mismatch");
  console.log("Vercel Blob readiness passed: encrypted report-store write, public ciphertext check, authenticated read, and checksum verification.");
} finally {
  if (record) {
    await del(record.blobPath, { token: cfg.BLOB_READ_WRITE_TOKEN }).catch(() => undefined);
    await redis.del(`${namespace}:report:${record.id}`).catch(() => 0);
  }
}
