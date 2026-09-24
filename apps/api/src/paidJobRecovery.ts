import { createHmac, timingSafeEqual } from "node:crypto";
import type { AnalysisJob } from "./jobs.js";

/** Reissue a capability ONLY after the paid route has verified the original
 * authorization. Domain-separated HMAC avoids persisting another secret or
 * rotating the original token out from under an already-open browser tab. */
export function paidReplayRecoveryToken(job: AnalysisJob, serverKey: string): string | undefined {
  if (!serverKey || Buffer.from(serverKey, "base64url").length !== 32 || job.receipt?.settlementResult !== "settled") return undefined;
  const binding = JSON.stringify(["pulse-paid-job-replay-v1", job.id, job.network, job.idempotencyKey,
    job.receipt.authorizationId, job.receipt.payer, job.receipt.payee]);
  return `ppr1_${createHmac("sha256", Buffer.from(serverKey, "base64url")).update(binding).digest("base64url")}`;
}
export function verifyPaidReplayRecoveryToken(job: AnalysisJob, token: string, serverKey: string): boolean {
  if (!/^ppr1_[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expected = paidReplayRecoveryToken(job, serverKey);
  return !!expected && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
