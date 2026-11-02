import { createHash } from "node:crypto";
import {
  advanceGlobalScenario, applyGlobalScenario, globalScenarioDefinitionForReport,
  newGlobalScenario, restoreGlobalScenarioBoundPlan,
} from "@pulse/analysis";
import { GlobalScenarioSchema, type GlobalAssessment, type GlobalReport, type GlobalScenario, type GlobalScenarioDefinition, type GlobalScenarioEvent } from "@pulse/schemas";
import type { PersistenceConfig } from "./jobs.js";
import { StoreRedis } from "./storeRedis.js";

export type GlobalScenarioScope = Readonly<{ ownerWallet: string; networkKey: string }>;
export type GlobalScenarioRecord = {
  version: "scenario-record-v1"; revision: number; snapshot: GlobalScenario;
  boundPlan?: NonNullable<GlobalReport["discretionaryPlan"]>;
};

/** Merge owner observations without letting a slow concurrent request authorize
 * an entry from a snapshot older than the ledger it just encountered. */
export function reconcileGlobalScenarioAssessment(saved: GlobalReport, assessment: GlobalAssessment, record: GlobalScenarioRecord): GlobalAssessment {
  const asOf = Date.parse(assessment.assessedAt), zh = saved.lang === "zh";
  if (record.snapshot.updatedAt > asOf) return {
    ...assessment, state: "no_trade", permittedEntry: null, observedStop: null, expiresAt: asOf,
    blockers: [...new Set([...assessment.blockers, "newer_scenario_observation"])],
    lines: [zh ? "已有更新的情景观察。请重新复核，不能使用较早的入场授权。" : "A newer scenario observation exists. Recheck again before considering entry; this earlier assessment cannot authorize it.", ...assessment.lines],
  };
  const s = record.snapshot, state = s.state;
  const blocked = state === "invalidated" || state === "expired" || state === "completed" || state === "entry_observed";
  const retestDeadline = s.confirmationAt === undefined ? null : s.confirmationAt + s.definition.fillWindowMs;
  const expiresAt = Math.min(s.expiresAt, retestDeadline ?? s.expiresAt);
  const lines = assessment.lines.filter(line => !line.startsWith("Entry deadline:") && !line.startsWith("入场截止："));
  lines.unshift(zh ? `入场截止：${new Date(expiresAt).toISOString()}；整体计划截止：${new Date(s.expiresAt).toISOString()}。` : `Entry deadline: ${new Date(expiresAt).toISOString()}; overall setup expiry: ${new Date(s.expiresAt).toISOString()}.`);
  return {
    ...assessment, scenario: s, confirmationTs: s.confirmationAt ?? null,
    retestTs: s.events.find(e => e.kind === "confirmation" && e.at === s.confirmationAt)?.candleTs ?? null,
    retestDeadline, expiresAt, lines,
    ...(blocked ? {
      state: state === "expired" ? "expired" as const : state === "invalidated" ? "invalidated" as const : "no_trade" as const,
      permittedEntry: null, observedStop: null,
      blockers: [...new Set([...assessment.blockers, "scenario_already_resolved_or_observed"])],
      lines: [zh ? "该机会已结束或已观察到入场价，不提供新入场。" : "The scenario ledger has ended this opportunity or already observed its entry price; no new entry is supplied.", ...lines.filter(line => !/eligib|signal confirmed|entry may be reviewed/i.test(line))],
    } : {}),
  };
}
export interface GlobalScenarioStorage {
  read(key: string): Promise<GlobalScenarioRecord | null>;
  compareAndSet(key: string, expectedRevision: number, value: GlobalScenarioRecord, ttlSeconds: number): Promise<boolean>;
}
export interface GlobalScenarioStore {
  get(scope: GlobalScenarioScope, scenarioId: string): Promise<GlobalScenarioRecord | null>;
  advance(scope: GlobalScenarioScope, definition: GlobalScenarioDefinition, events: readonly GlobalScenarioEvent[], asOf: number, boundPlan?: NonNullable<GlobalReport["discretionaryPlan"]>): Promise<GlobalScenarioRecord>;
  applyToReport(scope: GlobalScenarioScope, report: GlobalReport): Promise<void>;
}

/** Scoped opaque keys do not expose wallet addresses or permit archive scans. */
export function globalScenarioStorageKey(namespace: string, scope: GlobalScenarioScope, scenarioId: string): string {
  if (!scope.ownerWallet.trim() || !scope.networkKey.trim() || !/^gsc_[0-9a-f]{32}$/.test(scenarioId)) throw new Error("Invalid scoped scenario identity");
  const scopeHash = createHash("sha256").update(`${scope.networkKey}\0${scope.ownerWallet.toLowerCase()}`).digest("hex");
  return `${namespace}:global-scenario:${scopeHash}:${scenarioId}`;
}

export class MemoryGlobalScenarioStorage implements GlobalScenarioStorage {
  private records = new Map<string, GlobalScenarioRecord>();
  async read(key: string) { const record = this.records.get(key); return record ? structuredClone(record) : null; }
  async compareAndSet(key: string, expectedRevision: number, value: GlobalScenarioRecord) {
    if ((this.records.get(key)?.revision ?? 0) !== expectedRevision) return false;
    this.records.set(key, structuredClone(value)); return true;
  }
}

const CAS = `
local current = redis.call('GET', KEYS[1])
local revision = 0
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or type(decoded) ~= 'table' or type(decoded.revision) ~= 'number' then return -1 end
  revision = decoded.revision
end
if revision ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1`;

export class RedisGlobalScenarioStorage implements GlobalScenarioStorage {
  constructor(private redis: Pick<StoreRedis, "get" | "eval">) {}
  async read(key: string) { return this.redis.get<GlobalScenarioRecord>(key); }
  async compareAndSet(key: string, expectedRevision: number, value: GlobalScenarioRecord, ttlSeconds: number) {
    const result = Number(await this.redis.eval(CAS, [key], [String(expectedRevision), JSON.stringify(value), String(ttlSeconds)]));
    if (result < 0) throw new Error("Stored scenario revision is invalid");
    return result === 1;
  }
}

export function globalScenarioStore(storage: GlobalScenarioStorage, options: { namespace?: string; retentionSeconds?: number } = {}): GlobalScenarioStore {
  const namespace = options.namespace ?? "pulse", retention = options.retentionSeconds ?? 180 * 86_400;
  const key = (scope: GlobalScenarioScope, scenarioId: string) => globalScenarioStorageKey(namespace, scope, scenarioId);
  async function read(scope: GlobalScenarioScope, scenarioId: string) {
    const record = await storage.read(key(scope, scenarioId));
    if (record && (record.version !== "scenario-record-v1" || !Number.isInteger(record.revision) || record.revision < 1 || !GlobalScenarioSchema.safeParse(record.snapshot).success)) {
      throw new Error("Stored scenario is invalid; refusing to reset its history");
    }
    return record;
  }
  async function write(scope: GlobalScenarioScope, snapshot: GlobalScenario, previous: GlobalScenarioRecord | null, boundPlan?: NonNullable<GlobalReport["discretionaryPlan"]>) {
    GlobalScenarioSchema.parse(snapshot);
    const record: GlobalScenarioRecord = {
      version: "scenario-record-v1", revision: (previous?.revision ?? 0) + 1, snapshot,
      ...(previous?.boundPlan ?? boundPlan ? { boundPlan: structuredClone(previous?.boundPlan ?? boundPlan!) } : {}),
    };
    const ttl = Math.max(retention, Math.ceil((snapshot.expiresAt + snapshot.definition.fillWindowMs - snapshot.updatedAt) / 1_000));
    return await storage.compareAndSet(key(scope, snapshot.scenarioId), previous?.revision ?? 0, record, ttl) ? record : null;
  }
  return {
    get: read,
    async advance(scope, definition, events, asOf, boundPlan) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const previous = await read(scope, definition.scenarioId);
        if (previous && asOf < previous.snapshot.updatedAt) return previous;
        if (previous && previous.snapshot.revisionId !== definition.revisionId) throw new Error("Scenario events must use the stored priced revision");
        const snapshot = advanceGlobalScenario(previous?.snapshot.definition ?? definition, previous?.snapshot ?? null, events, asOf);
        const saved = await write(scope, snapshot, previous, boundPlan); if (saved) return saved;
      }
      throw new Error("Scenario history changed concurrently; retry the report");
    },
    async applyToReport(scope, report) {
      const candidate = globalScenarioDefinitionForReport(report);
      if (!candidate) return;
      const asOf = Date.parse(report.snapshot.observedAt), proposedPlan = structuredClone(report.discretionaryPlan!);
      for (let attempt = 0; attempt < 12; attempt++) {
        const previous = await read(scope, candidate.scenarioId);
        // A concurrently newer report must never leak future events into this snapshot.
        if (previous && previous.snapshot.startedAt > asOf) return;
        if (previous?.boundPlan) restoreGlobalScenarioBoundPlan(report, previous.boundPlan);
        else report.discretionaryPlan = structuredClone(proposedPlan);
        if (previous && previous.snapshot.updatedAt > asOf) {
          applyGlobalScenario(report, newGlobalScenario(previous.snapshot.definition), previous.snapshot.events.filter(e => e.at <= asOf));
          return;
        }
        const snapshot = applyGlobalScenario(report, previous?.snapshot);
        if (!snapshot) return;
        const saved = await write(scope, snapshot, previous, proposedPlan);
        if (saved) return;
      }
      throw new Error("Scenario history changed concurrently; retry the report");
    },
  };
}

type ScenarioPersistenceConfig = Pick<PersistenceConfig, "QUEUE_PROVIDER" | "REDIS_URL" | "KV_REST_API_URL" | "KV_REST_API_TOKEN" | "REPORT_RETENTION_DAYS" | "PERSISTENCE_NAMESPACE">;
export function createGlobalScenarioStore(config: ScenarioPersistenceConfig): GlobalScenarioStore {
  const storage = config.QUEUE_PROVIDER === "memory" ? new MemoryGlobalScenarioStorage()
    : new RedisGlobalScenarioStorage(new StoreRedis(config.QUEUE_PROVIDER === "redis" ? config.REDIS_URL || "" : config.KV_REST_API_URL, config.KV_REST_API_TOKEN));
  if (config.QUEUE_PROVIDER === "redis" && !/^rediss?:\/\//.test(config.REDIS_URL || "")) throw new Error("QUEUE_PROVIDER=redis requires REDIS_URL");
  return globalScenarioStore(storage, { namespace: config.PERSISTENCE_NAMESPACE || "pulse", retentionSeconds: config.REPORT_RETENTION_DAYS * 86_400 });
}
