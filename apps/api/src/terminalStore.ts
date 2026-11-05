import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "@pulse/config";
import type { GlobalReport, GlobalScenario } from "@pulse/schemas";
import { StoreRedis } from "./storeRedis.js";

export type TerminalDuration = "24h" | "7d" | "30d";
export const terminalDurationMs = { "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 } as const;
export type TerminalPassGrant = { id: string; requestId: string; duration: TerminalDuration; priceUsd: string; amountAtomic: string; network: string; asset: string; paymentId: string; purchasedAt: string; startsAt: string; expiresAt: string; simulated: boolean };
export type TerminalPurchase = { requestId: string; duration: TerminalDuration; priceUsd: string; amountAtomic: string; network: string; asset: string; payee: string; createdAt: string; state: "authorizing" | "settled" | "granted"; paymentId: string; nonce?: string; preparedBlock?: string; settlementTx?: string; settledAt?: string; simulated: boolean };
export type TerminalActivity = { id: string; at: string; sourceAt?: string; kind: string; subjectId: string; instId?: string; timeframe?: string; message: string };
export type TerminalDelivery = { id: string; eventId: string; subjectId: string; recipientId: number; state: "queued" | "sending" | "acknowledged" | "failed" | "uncertain" | "cancelled"; createdAt: string; attemptedAt?: string; messageId?: number; error?: string };
export type TerminalWatch = { id: string; instId: string; timeframe: string; setupVersionId: string; createdAt: string; expiresAt: string; paused: boolean; telegram: boolean; state: string; reason: string; nextEvent: string; reportRef?: string; report?: GlobalReport; scenario: GlobalScenario; lastObservedAt: string };
export type TerminalReportObject = { version: "terminal-report-object-v1"; owner: string; sha256: string; serializedReport: string };
export type TerminalRadar = { id: string; instId: string; timeframe: string; detector: string; boundary: number; createdAt: string; expiresAt: string; paused: boolean; telegram: boolean; state: string; reason: string; nextEvent: string; definition: unknown; snapshot: unknown; lastObservedAt: string };
export type TerminalPositionEvent = { id: string; requestId: string; kind: "open" | "add" | "close" | "protection"; quantity?: number; price?: number; executedAt: string; recordedAt: string; hardStop?: number | null; targets?: number[]; provenance: "user_reported" };
export type TerminalPositionMark = { price: number; at: string; source: string; kind: "spot-reference" | "perpetual-mark-reference"; venueMatches: boolean };
export type TerminalPosition = { id: string; instId: string; timeframe: string; side: "long" | "short"; venue: string; instrumentType: "spot" | "perpetual"; createdAt: string; paused: boolean; telegram: boolean; setupVersionId?: string; quantity: number; quantityUnit?: "base"; pnlCurrency?: string; averageEntry: number; realizedPnl: number; hardStop: number | null; targets: number[]; protectionStatus: "user_reported"; status: "open" | "closed"; events: TerminalPositionEvent[]; lastMark?: TerminalPositionMark; lastMarkObservation?: TerminalPositionMark; lastRiskState?: string };
export type TerminalWorkspace = { version: "terminal-workspace-v1"; revision: number; owner: string; grants: TerminalPassGrant[]; pendingPurchases?: TerminalPurchase[]; watches: TerminalWatch[]; radars: TerminalRadar[]; positions: TerminalPosition[]; activity: TerminalActivity[]; deliveries: TerminalDelivery[]; answers?: Array<{ id: string; at: string; instId: string; timeframe: string; question: string; answer: string; sources: unknown[] }>; telegram: { enabled: boolean; events: string[] }; aiUsage: { day: string; count: number }; lastMonitorAt?: number; monitoringLease?: { token: string; until: number } };

export interface TerminalStorage {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  take<T>(key: string): Promise<T | null>;
  compareAndSet(key: string, expectedRevision: number, value: TerminalWorkspace, ttlSeconds: number, ownerIndex: string): Promise<boolean>;
  owners(key: string, limit: number): Promise<string[]>;
}
export class MemoryTerminalStorage implements TerminalStorage {
  private values = new Map<string, { value: unknown; expiresAt: number }>();
  private indexes = new Map<string, Map<string, number>>();
  async read<T>(key: string): Promise<T | null> { const item = this.values.get(key); return item && item.expiresAt > Date.now() ? structuredClone(item.value) as T : null; }
  async write(key: string, value: unknown, ttl: number) { this.values.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttl * 1000 }); }
  async take<T>(key: string): Promise<T | null> { const item = this.values.get(key); this.values.delete(key); return item && item.expiresAt > Date.now() ? structuredClone(item.value) as T : null; }
  async compareAndSet(key: string, revision: number, value: TerminalWorkspace, ttl: number, index: string) {
    // No await between comparison and write: memory adapter is deterministic in tests.
    const current = this.values.get(key); const valid = current && current.expiresAt > Date.now() ? current.value as TerminalWorkspace : null;
    if ((valid?.revision ?? 0) !== revision) return false;
    this.values.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttl * 1000 });
    const owners = this.indexes.get(index) ?? new Map<string, number>(); owners.set(value.owner, value.lastMonitorAt ?? 0); this.indexes.set(index, owners); return true;
  }
  async owners(key: string, limit: number) { return [...(this.indexes.get(key) ?? [])].sort((a,b) => a[1] - b[1]).slice(0, limit).map(([owner]) => owner); }
}
const CAS = `local old=redis.call('GET',KEYS[1]);local rev=0;if old then rev=cjson.decode(old).revision end;if rev~=tonumber(ARGV[1]) then return 0 end;redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);redis.call('ZADD',KEYS[2],ARGV[4],ARGV[5]);return 1`;
export class RedisTerminalStorage implements TerminalStorage {
  constructor(private redis: StoreRedis) {}
  async read<T>(key: string) { return this.redis.get<T>(key); }
  async write(key: string, value: unknown, ttl: number) { await this.redis.set(key, value, { ex: ttl }); }
  async take<T>(key: string): Promise<T | null> { const raw = await this.redis.eval(`local v=redis.call('GET',KEYS[1]);if v then redis.call('DEL',KEYS[1]) end;return v`, [key], []); return typeof raw === "string" ? JSON.parse(raw) as T : null; }
  async compareAndSet(key: string, revision: number, value: TerminalWorkspace, ttl: number, index: string) { return Number(await this.redis.eval(CAS, [key, index], [revision, JSON.stringify(value), ttl, value.lastMonitorAt ?? 0, value.owner])) === 1; }
  async owners(key: string, limit: number) { return this.redis.zrange<string[]>(key, 0, limit - 1); }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function terminalOwner(value: string) { if (!/^0x[\da-f]{40}$/i.test(value)) throw new Error("Valid wallet owner required"); return value.toLowerCase(); }
export const terminalAccess = (workspace: TerminalWorkspace, now = Date.now()) => {
  const expiresAt = workspace.grants.reduce((max, grant) => Date.parse(grant.expiresAt) > Date.parse(max) ? grant.expiresAt : max, new Date(0).toISOString());
  return { active: Date.parse(expiresAt) > now, expiresAt: workspace.grants.length ? expiresAt : null, grants: workspace.grants };
};
export function emptyTerminalWorkspace(owner: string): TerminalWorkspace { return { version: "terminal-workspace-v1", revision: 0, owner: terminalOwner(owner), grants: [], watches: [], radars: [], positions: [], activity: [], deliveries: [], telegram: { enabled: false, events: [] }, aiUsage: { day: "", count: 0 } }; }
export class TerminalStore {
  constructor(readonly storage: TerminalStorage, private namespace: string, private retentionDays: number) {}
  key(kind: string, id: string) { return `${this.namespace}:terminal:${kind}:${hash(id)}`; }
  async get(owner: string) { return await this.storage.read<TerminalWorkspace>(this.key("owner", terminalOwner(owner))) ?? emptyTerminalWorkspace(owner); }
  /** Content-addressed source objects stay outside the frequently updated CAS
   * document. Their exact serialized bytes are checksummed and owner-scoped. */
  async saveWatchReport(owner: string, report: GlobalReport, expiresAt: string) {
    owner = terminalOwner(owner);
    const serializedReport = JSON.stringify(report), sha256 = hash(serializedReport), reference = `trp_${sha256}`;
    const until = Math.max(Date.now(), Date.parse(expiresAt)) + this.retentionDays * 86_400_000;
    if (!Number.isFinite(until)) throw new Error("Valid setup expiry is required before storing its source report");
    await this.storage.write(this.key("report", `${owner}:${reference}`), { version: "terminal-report-object-v1", owner, sha256, serializedReport } satisfies TerminalReportObject, Math.ceil((until - Date.now()) / 1000));
    return reference;
  }
  async loadWatchReport(owner: string, watch: TerminalWatch): Promise<GlobalReport> {
    owner = terminalOwner(owner);
    let report: GlobalReport;
    if (watch.reportRef) {
      if (!/^trp_[\da-f]{64}$/.test(watch.reportRef)) throw new Error("Saved setup report reference is invalid");
      const object = await this.storage.read<TerminalReportObject>(this.key("report", `${owner}:${watch.reportRef}`));
      if (!object || object.version !== "terminal-report-object-v1" || object.owner !== owner || typeof object.serializedReport !== "string" || object.sha256 !== watch.reportRef.slice(4) || hash(object.serializedReport) !== object.sha256) throw new Error("Saved setup source report is missing or its integrity could not be verified");
      report = JSON.parse(object.serializedReport) as GlobalReport;
    } else if (watch.report) report = structuredClone(watch.report); // Backward-compatible read until the next CAS migration.
    else throw new Error("Saved setup source report is unavailable");
    if (report.snapshot.instId !== watch.instId || report.snapshot.timeframe !== watch.timeframe || report.scenario?.revisionId !== watch.setupVersionId || report.scenario.scenarioId !== watch.scenario.scenarioId) throw new Error("Saved setup source identity does not match its immutable watch version");
    return report;
  }
  async mutate(owner: string, apply: (value: TerminalWorkspace) => void | boolean) {
    owner = terminalOwner(owner);
    for (let attempt = 0; attempt < 12; attempt++) {
      const value = await this.get(owner), previous = value.revision;
      let migrated = false;
      // Preserve existing lifecycle/expiry byte-for-byte while splitting legacy
      // inline source objects before any next owner-document mutation.
      for (const watch of value.watches) if (watch.report && !watch.reportRef) {
        watch.reportRef = await this.saveWatchReport(owner, watch.report, watch.expiresAt);
        delete watch.report; migrated = true;
      }
      const unchanged = apply(value) === false;
      if (unchanged && !migrated) return value;
      value.revision = previous + 1;
      // Paid periods always survive through their expiry plus the disclosed history retention.
      const until = Math.max(Date.now(), ...value.grants.map(grant => Date.parse(grant.expiresAt))) + this.retentionDays * 86_400_000;
      if (await this.storage.compareAndSet(this.key("owner", owner), previous, value, Math.ceil((until - Date.now()) / 1000), `${this.namespace}:terminal:owners`)) return value;
    }
    throw new Error("Terminal workspace changed concurrently. Refresh and retry.");
  }
  async owners(limit = 50) { return this.storage.owners(`${this.namespace}:terminal:owners`, limit); }
  async ready() { await this.storage.write(this.key("ready", "probe"), { ready: true }, 60); }
}
export function createTerminalStore(cfg: AppConfig) {
  if (cfg.QUEUE_PROVIDER === "memory") {
    if (cfg.NODE_ENV !== "test") throw new Error("Trading Terminal requires durable Redis/KV storage before purchases are enabled");
    return new TerminalStore(new MemoryTerminalStorage(), cfg.PERSISTENCE_NAMESPACE, cfg.TERMINAL_RETENTION_DAYS);
  }
  const url = cfg.QUEUE_PROVIDER === "redis" ? cfg.REDIS_URL : cfg.KV_REST_API_URL;
  if (!url || (cfg.QUEUE_PROVIDER === "upstash_kv" && !cfg.KV_REST_API_TOKEN)) throw new Error("Trading Terminal durable storage is not configured");
  return new TerminalStore(new RedisTerminalStorage(new StoreRedis(url, cfg.KV_REST_API_TOKEN)), cfg.PERSISTENCE_NAMESPACE, cfg.TERMINAL_RETENTION_DAYS);
}
export function appendTerminalActivity(workspace: TerminalWorkspace, event: Omit<TerminalActivity, "id"> & { id?: string }) {
  const id = event.id ?? `te_${randomUUID()}`;
  if (workspace.activity.some(item => item.id === id)) return;
  workspace.activity.push({ ...event, id }); workspace.activity = workspace.activity.slice(-1000);
}
export function grantTerminalPass(workspace: TerminalWorkspace, input: Omit<TerminalPassGrant, "id" | "startsAt" | "expiresAt">) {
  const old = workspace.grants.find(grant => grant.paymentId === input.paymentId || grant.requestId === input.requestId);
  if (old) { if (old.duration !== input.duration || old.requestId === input.requestId && old.paymentId !== input.paymentId) throw new Error("Purchase identity conflicts with an existing pass"); return old; }
  const startsAt = Math.max(Date.parse(input.purchasedAt), ...workspace.grants.map(grant => Date.parse(grant.expiresAt)));
  const grant = { ...input, id: `tp_${hash(`${workspace.owner}:${input.paymentId}`).slice(0, 32)}`, startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(startsAt + terminalDurationMs[input.duration]).toISOString() };
  workspace.grants.push(grant);
  appendTerminalActivity(workspace, { id: grant.id, at: input.purchasedAt, kind: "pass_activated", subjectId: grant.id, message: `Trading Terminal ${input.duration} access expires ${grant.expiresAt}. No automatic renewal.` });
  return grant;
}
export function applyTerminalPositionEvent(position: TerminalPosition, event: TerminalPositionEvent) {
  const previous = position.events.find(item => item.requestId === event.requestId);
  if (previous) {
    const identity = (e: TerminalPositionEvent) => JSON.stringify([e.kind, e.quantity, e.price, e.executedAt, e.hardStop, e.targets]);
    if (identity(previous) !== identity(event)) throw new Error("This journal request belongs to a different fill/protection event");
    return;
  }
  const last = position.events[position.events.length - 1];
  if (last && Date.parse(event.executedAt) < Date.parse(last.executedAt)) throw new Error("Record fills in execution-time order; a prior fill needs an explicit journal correction");
  if (event.kind === "add" || event.kind === "open") {
    if (!event.quantity || !event.price || position.status === "closed") throw new Error("An open position and positive actual fill are required");
    const quantity = position.quantity + event.quantity;
    position.averageEntry = (position.averageEntry * position.quantity + event.quantity * event.price) / quantity;
    position.quantity = quantity;
  } else if (event.kind === "close") {
    if (!event.quantity || !event.price || event.quantity > position.quantity + 1e-12) throw new Error("Close quantity exceeds the recorded position");
    position.realizedPnl += (event.price - position.averageEntry) * event.quantity * (position.side === "long" ? 1 : -1);
    position.quantity = Math.max(0, position.quantity - event.quantity);
    if (position.quantity <= 1e-12) { position.quantity = 0; position.status = "closed"; }
  }
  if (event.hardStop !== undefined) position.hardStop = event.hardStop;
  if (event.targets !== undefined) position.targets = [...event.targets];
  position.events.push(event);
}
