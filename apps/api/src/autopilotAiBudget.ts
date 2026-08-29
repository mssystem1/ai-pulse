import { createHash } from "node:crypto";
import { kvConfigured, runKvCommand } from "./resilientKv.js";

export type AutopilotAiLimits = Readonly<{
  maxCallsPerVaultDay: number;
  maxCallsGlobalDay: number;
  maxUsdPerVaultDay: number;
  maxUsdGlobalDay: number;
}>;

export class AutopilotAiBudgetExceededError extends Error {
  constructor(readonly dimension: "vault_calls" | "global_calls" | "vault_cost" | "global_cost" | "pricing_unconfigured") {
    super(`Autopilot AI ${dimension.replaceAll("_", " ")} limit reached`);
    this.name = "AutopilotAiBudgetExceededError";
  }
}

const memory = new Map<string, number>();
const reservations = new Set<string>();
const digest = (value: string) => createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 32);
const dayBucket = (now = new Date()) => now.toISOString().slice(0, 10);

export function estimatedAutopilotSignalCostUsd(input: {
  maxInputTokens: number;
  maxOutputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}) {
  if (input.inputUsdPerMillion <= 0 || input.outputUsdPerMillion <= 0) throw new AutopilotAiBudgetExceededError("pricing_unconfigured");
  return (input.maxInputTokens * input.inputUsdPerMillion + input.maxOutputTokens * input.outputUsdPerMillion) / 1_000_000;
}

export function actualAutopilotSignalCostUsd(input: {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}) {
  const cached = Math.min(input.promptTokens, Math.max(0, input.cachedTokens || 0));
  return ((input.promptTokens - cached) * input.inputUsdPerMillion + cached * input.cachedInputUsdPerMillion + input.completionTokens * input.outputUsdPerMillion) / 1_000_000;
}

/** Atomically reserves the worst-case model cost before any xAI request. */
export async function reserveAutopilotAiBudget(input: {
  strategyId: string;
  reservationId: string;
  estimatedCostUsd: number;
  limits: AutopilotAiLimits;
  namespace?: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const day = dayBucket(now);
  const costMicrousd = Math.max(1, Math.ceil(input.estimatedCostUsd * 1_000_000));
  const vaultCostLimit = Math.floor(input.limits.maxUsdPerVaultDay * 1_000_000);
  const globalCostLimit = Math.floor(input.limits.maxUsdGlobalDay * 1_000_000);
  if (input.limits.maxCallsPerVaultDay <= 0 || input.limits.maxCallsGlobalDay <= 0) throw new AutopilotAiBudgetExceededError("vault_calls");
  if (vaultCostLimit <= 0 || globalCostLimit <= 0) throw new AutopilotAiBudgetExceededError("vault_cost");
  const scope = `${input.namespace || "pulse"}:autopilot-ai:${day}`;
  const vault = digest(input.strategyId);
  const reservation = digest(input.reservationId);
  if (kvConfigured()) {
    const result = String(await runKvCommand([
      "EVAL",
      "if redis.call('EXISTS',KEYS[5])==1 then return 'ok' end; local vc=tonumber(redis.call('GET',KEYS[1]) or '0')+1; local gc=tonumber(redis.call('GET',KEYS[2]) or '0')+1; local vu=tonumber(redis.call('GET',KEYS[3]) or '0')+tonumber(ARGV[1]); local gu=tonumber(redis.call('GET',KEYS[4]) or '0')+tonumber(ARGV[1]); if vc>tonumber(ARGV[2]) then return 'vault_calls' end; if gc>tonumber(ARGV[3]) then return 'global_calls' end; if vu>tonumber(ARGV[4]) then return 'vault_cost' end; if gu>tonumber(ARGV[5]) then return 'global_cost' end; redis.call('SET',KEYS[1],vc,'EX',172800); redis.call('SET',KEYS[2],gc,'EX',172800); redis.call('SET',KEYS[3],vu,'EX',172800); redis.call('SET',KEYS[4],gu,'EX',172800); redis.call('SET',KEYS[5],'1','EX',172800); return 'ok'",
      "5",
      `${scope}:vault:${vault}:calls`, `${scope}:global:calls`, `${scope}:vault:${vault}:cost`, `${scope}:global:cost`, `${scope}:reservation:${reservation}`,
      String(costMicrousd), String(input.limits.maxCallsPerVaultDay), String(input.limits.maxCallsGlobalDay), String(vaultCostLimit), String(globalCostLimit),
    ], "Autopilot AI budget"));
    if (result !== "ok") throw new AutopilotAiBudgetExceededError(result as AutopilotAiBudgetExceededError["dimension"]);
  } else {
    const reservationKey = `${scope}:reservation:${reservation}`;
    if (!reservations.has(reservationKey)) {
      const keys = [`${scope}:vault:${vault}:calls`, `${scope}:global:calls`, `${scope}:vault:${vault}:cost`, `${scope}:global:cost`];
      const next = [(memory.get(keys[0]) || 0) + 1, (memory.get(keys[1]) || 0) + 1, (memory.get(keys[2]) || 0) + costMicrousd, (memory.get(keys[3]) || 0) + costMicrousd];
      if (next[0] > input.limits.maxCallsPerVaultDay) throw new AutopilotAiBudgetExceededError("vault_calls");
      if (next[1] > input.limits.maxCallsGlobalDay) throw new AutopilotAiBudgetExceededError("global_calls");
      if (next[2] > vaultCostLimit) throw new AutopilotAiBudgetExceededError("vault_cost");
      if (next[3] > globalCostLimit) throw new AutopilotAiBudgetExceededError("global_cost");
      keys.forEach((key, index) => memory.set(key, next[index]));
      reservations.add(reservationKey);
    }
  }
  return { day, reservedCostUsd: costMicrousd / 1_000_000 };
}

export function resetAutopilotAiBudgetForTests() {
  memory.clear();
  reservations.clear();
}
