import { createHash } from "node:crypto";
import type { AnalysisJob, StoredReport } from "./jobs.js";
import { decryptReport, parseStoredReport } from "./jobs.js";
import type { StoreRedis } from "./storeRedis.js";

export type ArchivedReport = Readonly<{
  version: "recovered-report-v1";
  id: `archive:${string}`;
  reportId: string;
  owner: string;
  networkKey: AnalysisJob["networkKey"] | null;
  mode: "spot" | "prediction" | "risk";
  tier: string | null;
  label: string;
  createdAt: string;
  metadata: StoredReport;
  originalJobId: string | null;
  originalExpiresAt: number | null;
  sourceNamespace: string | null;
  evidenceKind: "redis-report" | "saved-delivery" | "authenticated-history";
}>;

const NETWORK_KEYS = new Set<AnalysisJob["networkKey"]>(["xlayer", "base", "arbitrum", "arc", "robinhood", "arc-testnet"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER = /^0x[0-9a-f]{40}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const BLOB_HOST = /^(?:[a-z0-9-]+\.)+public\.blob\.vercel-storage\.com$/i;

function archiveId(value: string) {
  if (typeof value !== "string" || !value.startsWith("archive:") || !UUID.test(value.slice(8))) throw new Error("Invalid recovered report archive id");
}

function validBlobUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Recovered report URL is invalid"); }
  if (url.protocol !== "https:" || !BLOB_HOST.test(url.hostname) || url.username || url.password || url.port || url.hash) {
    throw new Error("Recovered report URL is not an approved Vercel Blob URL");
  }
}

export function validateArchivedReport(row: ArchivedReport): ArchivedReport {
  if (!row || row.version !== "recovered-report-v1") throw new Error("Invalid recovered report archive record");
  archiveId(row.id);
  if (!UUID.test(row.reportId) || row.id !== `archive:${row.reportId}` || !OWNER.test(row.owner) || row.owner !== row.owner.toLowerCase()) throw new Error("Invalid recovered report identity");
  if (row.networkKey !== null && !NETWORK_KEYS.has(row.networkKey)) throw new Error("Invalid recovered report network");
  if (!["spot", "prediction", "risk"].includes(row.mode)) throw new Error("Invalid recovered report mode");
  if (row.tier !== null && (typeof row.tier !== "string" || row.tier.length > 80)) throw new Error("Invalid recovered report tier");
  if (typeof row.label !== "string" || !row.label.trim() || row.label.length > 200) throw new Error("Invalid recovered report label");
  if (!Number.isFinite(Date.parse(row.createdAt)) || new Date(row.createdAt).toISOString() !== row.createdAt) throw new Error("Invalid recovered report timestamp");
  if (row.originalJobId !== null && !UUID.test(row.originalJobId)) throw new Error("Invalid original job id");
  if (row.originalExpiresAt !== null && (!Number.isSafeInteger(row.originalExpiresAt) || row.originalExpiresAt < 0)) throw new Error("Invalid original expiry");
  if (row.sourceNamespace !== null && (typeof row.sourceNamespace !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(row.sourceNamespace))) throw new Error("Invalid source namespace");
  if (!["redis-report", "saved-delivery", "authenticated-history"].includes(row.evidenceKind)) throw new Error("Invalid recovered report evidence kind");
  const metadata = row.metadata;
  if (!metadata || metadata.id !== row.reportId || metadata.ownerWallet !== row.owner || !["private", "public"].includes(metadata.visibility) || !HASH.test(metadata.checksum)
    || !Number.isFinite(Date.parse(metadata.createdAt)) || new Date(metadata.createdAt).toISOString() !== metadata.createdAt) throw new Error("Recovered report metadata does not match its owner or report id");
  validBlobUrl(metadata.blobPath);
  return row;
}

function ownerKey(owner: string) {
  if (!OWNER.test(owner)) throw new Error("Valid wallet owner required");
  return createHash("sha256").update(owner.toLowerCase()).digest("hex");
}

const READ_ALL = "return redis.call('HGETALL', KEYS[1])";
const READ_ONE = "return redis.call('HGET', KEYS[1], ARGV[1])";
const INSERT_MISSING = "return redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2])";

/** Read-only report archive index. It never creates or upgrades a live job. */
export class RecoveredReportArchive {
  private memory = new Map<string, Map<string, ArchivedReport>>();
  constructor(private redis?: Pick<StoreRedis, "eval">, private namespace = "pulse") {}

  private key(owner: string) { return `${this.namespace}:recovered-report-archive:${ownerKey(owner)}`; }

  async list(owner: string, networkKey: AnalysisJob["networkKey"]): Promise<ArchivedReport[]> {
    const normalized = owner.toLowerCase(), key = this.key(normalized);
    let rows: ArchivedReport[];
    if (this.redis) {
      const raw = await this.redis.eval<[], string[]>(READ_ALL, [key], []);
      if (!Array.isArray(raw) || raw.length % 2 !== 0) throw new Error("Invalid recovered report archive index");
      rows = [];
      for (let i = 0; i < raw.length; i += 2) {
        const value = validateArchivedReport(JSON.parse(raw[i + 1]) as ArchivedReport);
        if (value.id !== raw[i]) throw new Error("Recovered report archive index id mismatch");
        rows.push(value);
      }
    } else rows = [...(this.memory.get(key)?.values() ?? [])];
    return rows.filter(row => row.owner === normalized && (row.networkKey === null || row.networkKey === networkKey))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(owner: string, id: string): Promise<ArchivedReport | null> {
    if (typeof id !== "string" || !id.startsWith("archive:") || !UUID.test(id.slice(8))) return null;
    const key = this.key(owner);
    if (this.redis) {
      const raw = await this.redis.eval<[string], string | null>(READ_ONE, [key], [id]);
      if (raw === null) return null;
      const row = validateArchivedReport(JSON.parse(raw) as ArchivedReport);
      if (row.id !== id || row.owner !== owner.toLowerCase()) return null;
      return row;
    }
    const row = this.memory.get(key)?.get(id);
    return row ? validateArchivedReport(row) : null;
  }

  /** Operator-only import primitive; existing archive ids are never overwritten. */
  async insertMissing(input: ArchivedReport): Promise<boolean> {
    const row = validateArchivedReport(input), key = this.key(row.owner), encoded = JSON.stringify(row);
    if (this.redis) return Number(await this.redis.eval<[string, string], number>(INSERT_MISSING, [key], [row.id, encoded])) === 1;
    const rows = this.memory.get(key) ?? new Map<string, ArchivedReport>();
    if (rows.has(row.id)) return false;
    rows.set(row.id, structuredClone(row));
    this.memory.set(key, rows);
    return true;
  }
}

export async function readArchivedReport(rowInput: ArchivedReport, encryptionKey: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const row = validateArchivedReport(rowInput);
  const url = new URL(row.metadata.blobPath);
  const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Recovered report fetch failed with HTTP ${response.status}`);
  const payload = new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
  let plaintext = payload;
  let envelope: { v?: unknown; alg?: unknown } | undefined;
  try { envelope = JSON.parse(payload) as { v?: unknown; alg?: unknown }; } catch { /* Plain historical JSON. */ }
  if (envelope?.v === 1 && envelope.alg === "A256GCM") plaintext = decryptReport(payload, encryptionKey);
  if (createHash("sha256").update(plaintext, "utf8").digest("hex") !== row.metadata.checksum.toLowerCase()) throw new Error("Recovered report checksum mismatch");
  return parseStoredReport(plaintext);
}
