/** Recover the initial acceptance receipt created before the Arc payment journal. */
import { config } from "dotenv";
import { createDecipheriv, createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.QUEUE_PROVIDER = "redis";
  process.env.PERSISTENCE_NAMESPACE = "pulse-arc-mainnet-qualification";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { StoreRedis } = await import("../apps/api/src/storeRedis.js");
  const { createPersistence, requestHash } = await import("../apps/api/src/jobs.js");
  const { RedisCirclePaymentJournal } = await import("../apps/api/src/circlePaymentRuntime.js");
  const { PreflightRequestSchema } = await import("../packages/schemas/src/index.js");
  const cfg = loadConfig(), buyer = privateKeyToAccount(cfg.TEST_WALLET_PRIVATE_KEY as Hex);
  if (buyer.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase()) throw new Error();
  const redis = new StoreRedis(cfg.REDIS_URL);
  const envelope = await redis.get<{ iv: string; tag: string; ciphertext: string }>(`pulse:payments:arc:qualification:risk-v1:${buyer.address.toLowerCase()}`);
  if (!envelope) throw new Error();
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(`pulse-arc-mainnet-qualification:${cfg.TEST_WALLET_PRIVATE_KEY}`).digest(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString());
  if (saved.url !== "http://127.0.0.1:8789/arc/v1/preflight" || saved.payTo.toLowerCase() !== cfg.CIRCLE_GATEWAY_SELLER_ADDRESS.toLowerCase()) throw new Error();
  const jobs = await createPersistence(cfg).jobs.listByPayer(buyer.address, "arc");
  const normalizedBody = PreflightRequestSchema.parse(JSON.parse(saved.body));
  const matches = jobs.filter(job => job.mode === "risk" && job.receipt?.authorizationId === requestHash(saved.header)
    && job.receipt.requestHash === requestHash(normalizedBody) && job.receipt.amountAtomic === "200000"
    && job.receipt.payee.toLowerCase() === saved.payTo.toLowerCase() && job.receipt.network === "eip155:5042"
    && job.receipt.settlementMode === "gateway_batch" && job.receipt.settlementResult === "settled" && job.receipt.finality.status === "gateway_batch_accepted");
  if (matches.length !== 1 || !matches[0].reportId) throw new Error();
  const journal = new RedisCirclePaymentJournal(redis), id = createHash("sha256").update(saved.header).digest("hex");
  const digest = (body: unknown) => createHash("sha256").update(JSON.stringify({ method: "POST", resource: saved.url, body })).digest("hex");
  const normalizedDigest = digest(normalizedBody);
  const previous = await journal.get(id);
  if (previous) {
    if (previous.state !== "settled") throw new Error();
    if (previous.requestHash !== normalizedDigest) {
      if (!process.argv.includes("--reconcile") || previous.requestHash !== digest(JSON.parse(saved.body)) || !await journal.replace(previous, { ...previous, requestHash: normalizedDigest })) throw new Error();
    }
    console.log("Initial Arc payment is reconciled against its schema-normalized request."); return;
  }
  if (!process.argv.includes("--reconcile")) { console.log(JSON.stringify({ ready: true, reportJobId: matches[0].id, alreadySettledUSDC: "0.20", noNewPayment: true })); return; }
  const payment = { verified: true, payer: buyer.address.toLowerCase(), amount: "200000", network: "eip155:5042" };
  const responseHeader = Buffer.from(JSON.stringify({ success: true, payer: payment.payer, network: payment.network })).toString("base64");
  if (!await journal.claim({ id, requestHash: normalizedDigest, state: "settled", payment, responseHeader })) throw new Error();
  console.log(JSON.stringify({ reconciled: true, reportJobId: matches[0].id, proof: "Existing server receipt matches the original authorization, request, recipient, amount and Gateway finality", newPayment: false }));
}
main().then(() => process.exit(0)).catch(() => { console.error("Arc receipt reconciliation stopped; no new payment was signed or submitted."); process.exit(1); });
