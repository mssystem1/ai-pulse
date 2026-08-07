import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { get as getBlob, put as putBlob } from "@vercel/blob";

export const JOB_STAGES = [
  "payment_authorized", "payment_verified", "payment_settled", "fetching_context",
  "calculating_features", "generating_analysis", "validating_report", "completed",
  "completed_partial", "failed_retriable", "failed_terminal", "manual_reconciliation",
] as const;

export type JobStage = (typeof JOB_STAGES)[number];

export type JobEvent = Readonly<{ stage: JobStage; at: string; detail?: string }>;

export type PaymentReceipt = Readonly<{
  id: string; provider: string; network: string; chainId: number; asset: string; amountAtomic: string;
  payer: string; payee: string; authorizationId: string; resourceUrl: string;
  requestHash: string; verificationResult: "accepted_by_middleware"; settlementResult: "settled";
  settlementMode: "synchronous_onchain" | "gateway_batch" | "mock";
  finality: Readonly<{
    status: "facilitator_confirmed" | "gateway_batch_accepted" | "simulated";
    scope: "l1" | "l2" | "gateway" | "mock";
    parentChainStatus?: "unknown";
  }>;
  settlementTx?: string; createdAt: string; verifiedAt: string; settledAt: string;
  reportId?: string; completedAt?: string;
  failureState?: Readonly<{ stage: "failed_retriable" | "failed_terminal" | "manual_reconciliation"; detail?: string; at: string }>;
}>;

export type AnalysisJob = Readonly<{
  id: string;
  idempotencyKey: string;
  requestHash: string;
  resourceUrl: string;
  network: string;
  mode: "spot" | "prediction" | "fused" | "divergence" | "event-risk";
  tier: "standard" | "premium" | null;
  payer: string;
  /** Validated request data required to resume work after a process restart. */
  input: unknown;
  networkKey: "xlayer" | "base" | "arbitrum" | "arc-testnet";
  requesterIp: string;
  stage: JobStage;
  events: readonly JobEvent[];
  reportId: string | null;
  receiptId: string | null;
  receipt: PaymentReceipt | null;
  recoveryTokenHash: string;
  regenerationAttempts: number;
  maxRegenerationAttempts: number;
  createdAt: string;
  updatedAt: string;
}>;

export type StoredReport = Readonly<{
  id: string;
  ownerWallet: string;
  visibility: "private" | "public";
  blobPath: string;
  checksum: string;
  createdAt: string;
}>;

type EncryptedReportEnvelope = { v: 1; alg: "A256GCM"; iv: string; tag: string; ciphertext: string };
export function encryptReport(plaintext: string, base64urlKey: string): string {
  const key = Buffer.from(base64urlKey, "base64url");
  if (key.length !== 32) throw new Error("Report encryption key must be exactly 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, alg: "A256GCM", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") } satisfies EncryptedReportEnvelope);
}
export function decryptReport(envelopeJson: string, base64urlKey: string): string {
  const key = Buffer.from(base64urlKey, "base64url");
  const envelope = JSON.parse(envelopeJson) as EncryptedReportEnvelope;
  if (key.length !== 32 || envelope.v !== 1 || envelope.alg !== "A256GCM") throw new Error("Unsupported encrypted report envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

type JobCreateRequired = Omit<AnalysisJob, "id" | "stage" | "events" | "reportId" | "receiptId" | "receipt" | "recoveryTokenHash" | "regenerationAttempts" | "createdAt" | "updatedAt" | "input" | "networkKey" | "requesterIp">;
export type JobCreateInput = JobCreateRequired & Partial<Pick<AnalysisJob, "input" | "networkKey" | "requesterIp">>;

export interface JobStore {
  acquire(input: JobCreateInput): Promise<{ job: AnalysisJob; created: boolean; recoveryToken?: string }>;
  get(jobId: string): Promise<AnalysisJob | null>;
  transition(jobId: string, stage: JobStage, detail?: string): Promise<AnalysisJob>;
  bindReceipt(jobId: string, receipt: PaymentReceipt): Promise<AnalysisJob>;
  bindReceiptAndEnqueue(jobId: string, receipt: PaymentReceipt): Promise<AnalysisJob>;
  attachReport(jobId: string, reportId: string, partial?: boolean): Promise<AnalysisJob>;
  grantRegeneration(jobId: string): Promise<AnalysisJob>;
  enqueue(jobId: string): Promise<void>;
  claim(workerId: string, leaseSeconds: number): Promise<AnalysisJob | null>;
  ack(jobId: string, workerId: string): Promise<void>;
  extendLease(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean>;
  requeue(jobId: string, workerId: string, delaySeconds?: number): Promise<void>;
  recoverExpired(): Promise<number>;
  queueStats(): Promise<{ ready: number; leased: number }>;
}

/**
 * Retry only the deliverable generation step against the already-settled job.
 * Every retry is persisted and requires a bound receipt; payment is never run
 * again. The caller owns the final terminal transition and response policy.
 */
export async function runReceiptBoundOperation<T>(
  store: JobStore,
  jobId: string,
  maxRegenerationAttempts: number,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRegenerationAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRegenerationAttempts) break;
      await store.transition(jobId, "failed_retriable", error instanceof Error ? error.message : String(error));
      const regenerated = await store.grantRegeneration(jobId);
      if (regenerated.stage === "manual_reconciliation") throw error;
      await store.transition(jobId, "generating_analysis", `automatic regeneration ${attempt + 1}`);
    }
  }
  throw lastError;
}

function nowIso(): string { return new Date().toISOString(); }

function tokenHash(token: string): string { return createHash("sha256").update(`pulse-job-recovery-v1\0${token}`).digest("hex"); }
export function verifyRecoveryToken(job: AnalysisJob, token: string): boolean {
  if (!token) return false;
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(job.recoveryTokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function newJob(input: JobCreateInput): { job: AnalysisJob; recoveryToken: string } {
  const now = nowIso();
  const recoveryToken = randomBytes(32).toString("base64url");
  const job = Object.freeze({
    ...input,
    input: input.input ?? null,
    networkKey: input.networkKey ?? "xlayer",
    requesterIp: input.requesterIp ?? "unknown",
    id: randomUUID(),
    stage: "payment_authorized" as const,
    events: Object.freeze([{ stage: "payment_authorized" as const, at: now }]),
    reportId: null,
    receiptId: null,
    receipt: null,
    recoveryTokenHash: tokenHash(recoveryToken),
    regenerationAttempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  return { job, recoveryToken };
}

function decodedJob(value: string | AnalysisJob): AnalysisJob {
  return Object.freeze(typeof value === "string" ? JSON.parse(value) as AnalysisJob : value);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function paymentIdempotencyKey(input: {
  network: string; provider: string; authorizationId: string; payer: string; payee: string;
  amount: string; asset: string; resourceUrl: string; requestHash: string;
  mode: string; tier: string | null;
}): string {
  return createHash("sha256").update([
    "pulse-payment-v1", input.network, input.provider, input.authorizationId,
    input.payer.toLowerCase(), input.payee.toLowerCase(), input.amount,
    input.asset.toLowerCase(), input.resourceUrl, input.requestHash, input.mode, input.tier || "none",
  ].join("\0")).digest("hex");
}

export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, AnalysisJob>();
  private idempotency = new Map<string, string>();
  private ready = new Map<string, number>();
  private leased = new Map<string, { workerId: string; expiresAt: number }>();

  async acquire(input: JobCreateInput) {
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) return { job: this.jobs.get(existingId)!, created: false };
    const { job, recoveryToken } = newJob(input);
    this.jobs.set(job.id, job);
    this.idempotency.set(job.idempotencyKey, job.id);
    return { job, created: true, recoveryToken };
  }

  async get(jobId: string) { return this.jobs.get(jobId) || null; }

  async transition(jobId: string, stage: JobStage, detail?: string) {
    const current = this.jobs.get(jobId);
    if (!current) throw new Error("Job not found");
    const at = nowIso();
    const failureStage = stage === "failed_retriable" || stage === "failed_terminal" || stage === "manual_reconciliation";
    const receipt = current.receipt && failureStage
      ? Object.freeze({ ...current.receipt, failureState: Object.freeze({ stage, ...(detail ? { detail } : {}), at }) })
      : current.receipt;
    const next = Object.freeze({
      ...current, stage, receipt, updatedAt: at,
      events: Object.freeze([...current.events, Object.freeze({ stage, at, ...(detail ? { detail } : {}) })]),
    });
    this.jobs.set(jobId, next);
    return next;
  }

  async attachReport(jobId: string, reportId: string, partial = false) {
    const current = this.jobs.get(jobId);
    if (!current) throw new Error("Job not found");
    const completedAt = nowIso();
    const stage = partial ? "completed_partial" as const : "completed" as const;
    const receipt = current.receipt ? Object.freeze({ ...current.receipt, reportId, completedAt }) : null;
    const next = Object.freeze({
      ...current, reportId, receipt, stage, updatedAt: completedAt,
      events: Object.freeze([...current.events, Object.freeze({ stage, at: completedAt })]),
    });
    this.jobs.set(jobId, next);
    return next;
  }

  async bindReceipt(jobId: string, receipt: PaymentReceipt) {
    const current = this.jobs.get(jobId);
    if (!current) throw new Error("Job not found");
    if (!receipt.id.trim()) throw new Error("Settlement receipt ID required");
    const next = Object.freeze({ ...current, receiptId: receipt.id, receipt });
    this.jobs.set(jobId, next);
    return next;
  }

  async bindReceiptAndEnqueue(jobId: string, receipt: PaymentReceipt) {
    const job = await this.bindReceipt(jobId, receipt);
    this.ready.set(jobId, Date.now());
    return job;
  }

  async grantRegeneration(jobId: string) {
    const current = this.jobs.get(jobId);
    if (!current) throw new Error("Job not found");
    if (!current.receiptId) throw new Error("A settled payment receipt must be bound before regeneration");
    if (current.regenerationAttempts >= current.maxRegenerationAttempts) {
      return this.transition(jobId, "manual_reconciliation", "regeneration attempts exhausted");
    }
    const next = Object.freeze({ ...current, regenerationAttempts: current.regenerationAttempts + 1 });
    this.jobs.set(jobId, next);
    return this.transition(jobId, "fetching_context", "receipt-bound regeneration");
  }

  async enqueue(jobId: string) {
    if (!this.jobs.has(jobId)) throw new Error("Job not found");
    this.ready.set(jobId, Date.now());
  }

  async claim(workerId: string, leaseSeconds: number) {
    await this.recoverExpired();
    const candidate = [...this.ready.entries()].filter(([, at]) => at <= Date.now()).sort((a, b) => a[1] - b[1])[0];
    if (!candidate) return null;
    this.ready.delete(candidate[0]);
    this.leased.set(candidate[0], { workerId, expiresAt: Date.now() + leaseSeconds * 1000 });
    return this.jobs.get(candidate[0]) || null;
  }

  async ack(jobId: string, workerId: string) {
    if (this.leased.get(jobId)?.workerId === workerId) this.leased.delete(jobId);
  }

  async extendLease(jobId: string, workerId: string, leaseSeconds: number) {
    const lease = this.leased.get(jobId);
    if (!lease || lease.workerId !== workerId) return false;
    this.leased.set(jobId, { workerId, expiresAt: Date.now() + leaseSeconds * 1000 });
    return true;
  }

  async requeue(jobId: string, workerId: string, delaySeconds = 0) {
    if (this.leased.get(jobId)?.workerId !== workerId) return;
    this.leased.delete(jobId);
    this.ready.set(jobId, Date.now() + delaySeconds * 1000);
  }

  async recoverExpired() {
    let recovered = 0;
    for (const [jobId, lease] of this.leased) {
      if (lease.expiresAt <= Date.now()) {
        this.leased.delete(jobId); this.ready.set(jobId, Date.now()); recovered += 1;
      }
    }
    return recovered;
  }

  async queueStats() { return { ready: this.ready.size, leased: this.leased.size }; }
}

export class UpstashJobStore implements JobStore {
  private redis: Redis;
  constructor(url: string, token: string, private retentionSeconds = 15_552_000, private namespace = "pulse") {
    this.redis = new Redis({ url, token });
  }
  private jobKey(id: string) { return `${this.namespace}:job:${id}`; }
  private idemKey(id: string) { return `${this.namespace}:idem:${id}`; }
  private get readyKey() { return `${this.namespace}:jobs:ready`; }
  private get leasedKey() { return `${this.namespace}:jobs:leased`; }
  private leaseOwnerKey(id: string) { return `${this.namespace}:job-lease:${id}`; }

  async acquire(input: JobCreateInput) {
    const { job, recoveryToken } = newJob(input);
    const result = await this.redis.eval<[string, string, string], string>(
      "local e=redis.call('GET',KEYS[1]); if e then return e end; redis.call('SET',KEYS[2],ARGV[1],'EX',ARGV[2]); redis.call('SET',KEYS[1],ARGV[3],'EX',ARGV[2]); return ARGV[3]",
      [this.idemKey(input.idempotencyKey), this.jobKey(job.id)],
      [JSON.stringify(job), String(this.retentionSeconds), job.id],
    );
    if (result !== job.id) {
      const existing = await this.get(result);
      if (!existing) throw new Error("Idempotency record references a missing job");
      return { job: existing, created: false };
    }
    return { job, created: true, recoveryToken };
  }

  async get(jobId: string) {
    return await this.redis.get<AnalysisJob>(this.jobKey(jobId));
  }

  private async save(job: AnalysisJob) {
    await this.redis.set(this.jobKey(job.id), job, { ex: this.retentionSeconds });
    return job;
  }

  async transition(jobId: string, stage: JobStage, detail?: string) {
    const current = await this.get(jobId);
    if (!current) throw new Error("Job not found");
    const at = nowIso();
    const failureStage = stage === "failed_retriable" || stage === "failed_terminal" || stage === "manual_reconciliation";
    const receipt = current.receipt && failureStage
      ? Object.freeze({ ...current.receipt, failureState: Object.freeze({ stage, ...(detail ? { detail } : {}), at }) })
      : current.receipt;
    return this.save(Object.freeze({
      ...current, stage, receipt, updatedAt: at,
      events: Object.freeze([...current.events, Object.freeze({ stage, at, ...(detail ? { detail } : {}) })]),
    }));
  }

  async attachReport(jobId: string, reportId: string, partial = false) {
    const completedAt = nowIso();
    const stage = partial ? "completed_partial" : "completed";
    const encoded = await this.redis.eval<[string, string, string, string], string | AnalysisJob>(
      "local raw=redis.call('GET',KEYS[1]); if not raw then return redis.error_reply('Job not found') end; local j=cjson.decode(raw); j.reportId=ARGV[1]; j.stage=ARGV[2]; j.updatedAt=ARGV[3]; if j.receipt and j.receipt~=cjson.null then j.receipt.reportId=ARGV[1]; j.receipt.completedAt=ARGV[3] end; table.insert(j.events,{stage=ARGV[2],at=ARGV[3]}); local out=cjson.encode(j); redis.call('SET',KEYS[1],out,'EX',ARGV[4]); return out",
      [this.jobKey(jobId)], [reportId, stage, completedAt, String(this.retentionSeconds)],
    );
    return decodedJob(encoded);
  }

  async bindReceipt(jobId: string, receipt: PaymentReceipt) {
    const current = await this.get(jobId);
    if (!current) throw new Error("Job not found");
    if (!receipt.id.trim()) throw new Error("Settlement receipt ID required");
    return this.save(Object.freeze({ ...current, receiptId: receipt.id, receipt }));
  }

  async bindReceiptAndEnqueue(jobId: string, receipt: PaymentReceipt) {
    if (!receipt.id.trim()) throw new Error("Settlement receipt ID required");
    const at = Date.now();
    const encoded = await this.redis.eval<[string, string, string, string], string | AnalysisJob>(
      "local raw=redis.call('GET',KEYS[1]); if not raw then return redis.error_reply('Job not found') end; local j=cjson.decode(raw); local r=cjson.decode(ARGV[1]); j.receiptId=r.id; j.receipt=r; local out=cjson.encode(j); redis.call('SET',KEYS[1],out,'EX',ARGV[2]); redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4]); return out",
      [this.jobKey(jobId), this.readyKey],
      [JSON.stringify(receipt), String(this.retentionSeconds), String(at), jobId],
    );
    return decodedJob(encoded);
  }

  async grantRegeneration(jobId: string) {
    const at = nowIso();
    const encoded = await this.redis.eval<[string, string], string | AnalysisJob>(
      "local raw=redis.call('GET',KEYS[1]); if not raw then return redis.error_reply('Job not found') end; local j=cjson.decode(raw); if not j.receiptId or j.receiptId==cjson.null then return redis.error_reply('A settled payment receipt must be bound before regeneration') end; local detail; if j.regenerationAttempts>=j.maxRegenerationAttempts then j.stage='manual_reconciliation'; detail='regeneration attempts exhausted'; if j.receipt and j.receipt~=cjson.null then j.receipt.failureState={stage=j.stage,detail=detail,at=ARGV[1]} end else j.regenerationAttempts=j.regenerationAttempts+1; j.stage='fetching_context'; detail='receipt-bound regeneration' end; j.updatedAt=ARGV[1]; table.insert(j.events,{stage=j.stage,at=ARGV[1],detail=detail}); local out=cjson.encode(j); redis.call('SET',KEYS[1],out,'EX',ARGV[2]); return out",
      [this.jobKey(jobId)], [at, String(this.retentionSeconds)],
    );
    return decodedJob(encoded);
  }

  async enqueue(jobId: string) {
    if (!await this.get(jobId)) throw new Error("Job not found");
    await this.redis.zadd(this.readyKey, { score: Date.now(), member: jobId });
  }

  async claim(workerId: string, leaseSeconds: number) {
    const encoded = await this.redis.eval<[string, string, string, string, string, string], string | AnalysisJob | null>(
      "local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[1],'LIMIT',0,1); if #ids==0 then return nil end; local id=ids[1]; if redis.call('ZREM',KEYS[1],id)==0 then return nil end; local raw=redis.call('GET',ARGV[4]..id); if not raw then return nil end; redis.call('ZADD',KEYS[2],ARGV[2],id); redis.call('SET',ARGV[5]..id,ARGV[3],'EX',ARGV[6]); return raw",
      [this.readyKey, this.leasedKey],
      [String(Date.now()), String(Date.now() + leaseSeconds * 1000), workerId, `${this.namespace}:job:`, `${this.namespace}:job-lease:`, String(leaseSeconds)],
    );
    return encoded ? decodedJob(encoded) : null;
  }

  async ack(jobId: string, workerId: string) {
    await this.redis.eval<[string, string], number>(
      "local o=redis.call('GET',KEYS[2]); if o~=ARGV[1] then return 0 end; redis.call('DEL',KEYS[2]); return redis.call('ZREM',KEYS[1],ARGV[2])",
      [this.leasedKey, this.leaseOwnerKey(jobId)], [workerId, jobId],
    );
  }

  async extendLease(jobId: string, workerId: string, leaseSeconds: number) {
    const result = await this.redis.eval<[string, string, string, string], number>(
      "local o=redis.call('GET',KEYS[2]); if o~=ARGV[1] then return 0 end; redis.call('EXPIRE',KEYS[2],ARGV[2]); redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]); return 1",
      [this.leasedKey, this.leaseOwnerKey(jobId)],
      [workerId, String(leaseSeconds), String(Date.now() + leaseSeconds * 1000), jobId],
    );
    return Number(result) === 1;
  }

  async requeue(jobId: string, workerId: string, delaySeconds = 0) {
    await this.redis.eval<[string, string, string], number>(
      "local o=redis.call('GET',KEYS[3]); if o~=ARGV[1] then return 0 end; redis.call('DEL',KEYS[3]); redis.call('ZREM',KEYS[2],ARGV[2]); redis.call('ZADD',KEYS[1],ARGV[3],ARGV[2]); return 1",
      [this.readyKey, this.leasedKey, this.leaseOwnerKey(jobId)],
      [workerId, jobId, String(Date.now() + delaySeconds * 1000)],
    );
  }

  async recoverExpired() {
    const result = await this.redis.eval<[string, string], number>(
      "local ids=redis.call('ZRANGEBYSCORE',KEYS[2],'-inf',ARGV[1]); local n=0; for _,id in ipairs(ids) do if redis.call('ZREM',KEYS[2],id)==1 then redis.call('DEL',ARGV[2]..id); redis.call('ZADD',KEYS[1],ARGV[1],id); n=n+1 end end; return n",
      [this.readyKey, this.leasedKey], [String(Date.now()), `${this.namespace}:job-lease:`],
    );
    return Number(result);
  }

  async queueStats() {
    const [ready, leased] = await Promise.all([this.redis.zcard(this.readyKey), this.redis.zcard(this.leasedKey)]);
    return { ready: Number(ready), leased: Number(leased) };
  }
}

export interface ReportStore {
  save(ownerWallet: string, report: unknown): Promise<StoredReport>;
  get(reportId: string): Promise<StoredReport | null>;
  read(record: StoredReport): Promise<unknown>;
  createShare(reportId: string): Promise<{ token: string; reportId: string }>;
  resolveShare(token: string): Promise<StoredReport | null>;
  revokeShare(token: string): Promise<boolean>;
}

function shareKey(token: string): string {
  return createHash("sha256").update(`pulse-share-v1\0${token}`).digest("hex");
}

export class MemoryReportStore implements ReportStore {
  private payloads = new Map<string, unknown>();
  private records = new Map<string, StoredReport>();
  private shares = new Map<string, string>();
  async save(ownerWallet: string, report: unknown) {
    const body = canonicalJson(report);
    const id = randomUUID();
    this.payloads.set(id, report);
    const record = Object.freeze({
      id, ownerWallet: ownerWallet.toLowerCase(), visibility: "private" as const,
      blobPath: `memory:${id}`, checksum: createHash("sha256").update(body).digest("hex"), createdAt: nowIso(),
    });
    this.records.set(id, record);
    return record;
  }
  async get(reportId: string) { return this.records.get(reportId) || null; }
  async read(record: StoredReport) { return this.payloads.get(record.id) ?? null; }
  async createShare(reportId: string) {
    if (!this.records.has(reportId)) throw new Error("Report not found");
    const token = `${randomUUID()}${randomUUID().replaceAll("-", "")}`;
    this.shares.set(shareKey(token), reportId);
    return Object.freeze({ token, reportId });
  }
  async resolveShare(token: string) {
    const reportId = this.shares.get(shareKey(token));
    return reportId ? this.get(reportId) : null;
  }
  async revokeShare(token: string) { return this.shares.delete(shareKey(token)); }
}

export class VercelBlobReportStore implements ReportStore {
  private redis: Redis;
  constructor(
    private token: string,
    redisUrl: string,
    redisToken: string,
    private retentionSeconds = 7_776_000,
    private namespace = "pulse",
    private access: "private" | "public" = "private",
    private encryptionKey = "",
  ) { this.redis = new Redis({ url: redisUrl, token: redisToken }); }
  private recordKey(id: string) { return `${this.namespace}:report:${id}`; }
  private shareRecordKey(token: string) { return `${this.namespace}:report-share:${shareKey(token)}`; }
  async save(ownerWallet: string, report: unknown) {
    const body = canonicalJson(report);
    const checksum = createHash("sha256").update(body).digest("hex");
    const id = randomUUID();
    const blobPath = `reports/${this.namespace.replace(/[^a-zA-Z0-9_-]/g, "-")}/${id}.json`;
    const storedBody = this.access === "public" ? encryptReport(body, this.encryptionKey) : body;
    const created = await putBlob(blobPath, storedBody, {
      access: this.access, token: this.token, addRandomSuffix: false, allowOverwrite: false,
      contentType: "application/json",
    });
    const record = Object.freeze({
      id, ownerWallet: ownerWallet.toLowerCase(), visibility: "private" as const,
      blobPath: this.access === "public" ? created.url : blobPath, checksum, createdAt: nowIso(),
    });
    await this.redis.set(this.recordKey(id), record, { ex: this.retentionSeconds });
    return record;
  }
  async get(reportId: string) { return this.redis.get<StoredReport>(this.recordKey(reportId)); }
  async read(record: StoredReport) {
    const payload = this.access === "public"
      ? decryptReport(await (await fetch(record.blobPath)).text(), this.encryptionKey)
      : await (async () => {
          const result = await getBlob(record.blobPath, { access: "private", token: this.token, useCache: false });
          if (!result?.stream) return "";
          return new Response(result.stream).text();
        })();
    if (!payload) return null;
    const checksum = createHash("sha256").update(payload).digest("hex");
    if (checksum !== record.checksum) throw new Error("Stored report checksum mismatch");
    return JSON.parse(payload) as unknown;
  }
  async createShare(reportId: string) {
    if (!await this.get(reportId)) throw new Error("Report not found");
    const token = `${randomUUID()}${randomUUID().replaceAll("-", "")}`;
    await this.redis.set(this.shareRecordKey(token), reportId, { ex: this.retentionSeconds });
    return Object.freeze({ token, reportId });
  }
  async resolveShare(token: string) {
    const reportId = await this.redis.get<string>(this.shareRecordKey(token));
    return reportId ? this.get(reportId) : null;
  }
  async revokeShare(token: string) { return (await this.redis.del(this.shareRecordKey(token))) > 0; }
}

export type PersistenceConfig = Readonly<{
  QUEUE_PROVIDER: "memory" | "upstash_kv";
  STORAGE_PROVIDER: "memory" | "vercel_blob";
  KV_REST_API_URL: string;
  KV_REST_API_TOKEN: string;
  BLOB_READ_WRITE_TOKEN: string;
  JOB_STAGE_RETENTION_DAYS: number;
  REPORT_RETENTION_DAYS: number;
  PERSISTENCE_NAMESPACE?: string;
  BLOB_ACCESS?: "private" | "public";
  REPORT_ENCRYPTION_KEY?: string;
}>;

export function createPersistence(config: PersistenceConfig): {
  jobs: JobStore;
  reports: ReportStore;
} {
  const jobs = config.QUEUE_PROVIDER === "upstash_kv"
    ? new UpstashJobStore(
        config.KV_REST_API_URL,
        config.KV_REST_API_TOKEN,
        config.JOB_STAGE_RETENTION_DAYS * 86_400,
        config.PERSISTENCE_NAMESPACE || "pulse",
      )
    : new MemoryJobStore();
  const reports = config.STORAGE_PROVIDER === "vercel_blob"
    ? new VercelBlobReportStore(
        config.BLOB_READ_WRITE_TOKEN, config.KV_REST_API_URL, config.KV_REST_API_TOKEN,
        config.REPORT_RETENTION_DAYS * 86_400,
        config.PERSISTENCE_NAMESPACE || "pulse",
        config.BLOB_ACCESS || "private",
        config.REPORT_ENCRYPTION_KEY || "",
      )
    : new MemoryReportStore();
  return Object.freeze({ jobs, reports });
}
