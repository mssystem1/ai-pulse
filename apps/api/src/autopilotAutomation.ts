import { Router } from "express";
import { z } from "zod";
import {
  createWalletClient,
  encodeFunctionData,
  fallback,
  http,
  keccak256,
  parseUnits,
  toHex,
  verifyMessage,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { put } from "@vercel/blob";
import { buildMarketContext, getTicker } from "@pulse/market";
import { buildSpotExecutionPlan, buildTechnicalStructure, runPreparedAutopilotSignal, type AutopilotSignalResult } from "@pulse/analysis";
import type { AppConfig } from "@pulse/config";
import { isKvUnavailableError, kvCircuitStatus, kvConfigured, runKvCommand } from "./resilientKv.js";
import { asyncRoute } from "./httpResilience.js";
import { analysisSymbolForExecutionToken, getGenericOkxQuote, getGenericOkxSwap } from "./okxDex.js";
import { listV6Activity, recordV6Activity } from "./v6Store.js";
import { normaliseRouteSymbol } from "./tradeAutomation.js";
import { executionPublicClient } from "./onchainDiscovery.js";
import { executionContractAddress } from "./executionContracts.js";
import { AUTOPILOT_STRATEGY_CATALOG, boundedTargetSellAmount, evaluateAutopilotEntryCandidate, evaluateAutopilotPolicy, evaluateAutopilotRiskExit, identifyAutopilotStrategy, minimumOracleOutput, type AutopilotRuleResult, type AutopilotStrategyType } from "./autopilotPolicy.js";
import { AUTOPILOT_STRATEGY_HASH_KEY, cashFlowAdjustedPnl, decodeStrategyHash, deriveAutopilotRuntimeState, mergeStrategyRuntime, reconcileAutopilotLifetimeStats, reconcileStrategyExecution } from "./autopilotStrategyStore.js";
import { AutopilotAiBudgetExceededError, actualAutopilotSignalCostUsd, estimatedAutopilotSignalCostUsd, reserveAutopilotAiBudget } from "./autopilotAiBudget.js";
import { observeProvider, recordAiUsage } from "./telemetry.js";
import { deliverTelegramReportDurably } from "./telegram.js";

type StrategyEvaluation = {
  id: string;
  evaluatedAt: string;
  strategyType: AutopilotStrategyType;
  action: "buy" | "sell" | "hold";
  status: "held" | "filled" | "failed";
  reason: string;
  bias: string;
  confidence: number;
  metrics: Record<string, number | null>;
  rules: AutopilotRuleResult[];
  evidenceHash?: string;
  txHash?: string;
  error?: string;
};

type Network = "xlayer" | "base" | "arbitrum";
type Strategy = {
  id: string;
  owner: string;
  network: Network;
  vault: string;
  settlementAsset: string;
  targetAsset: string;
  pair: string;
  timeframe: string;
  strategyType: AutopilotStrategyType;
  buyAmountAtomic: string;
  sellAmountAtomic: string;
  minConfidence: number;
  policy: {
    pair: string;
    timeframe: string;
    maxTradePct: number;
    dailyLossPct: number;
    strategy: string;
  };
  status: "active" | "paused" | "failed";
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRiskCheckAt?: string;
  lastDecision?: string;
  lastError?: string;
  lastTxHash?: string;
  evidenceUrl?: string;
  evidenceHash?: string;
  baselineValueAtomic?: string;
  configurationHash?: string;
  exitPending?: boolean;
  activeTakeProfit?: number;
  activeStopLoss?: number;
  positionEntryPrice?: number;
  lastEntryPrice?: number;
  lastExitPrice?: number;
  realizedPositionPnlPct?: number;
  lastEvaluatedCandleTs?: number;
  lastAiSignalAt?: string;
  lastAiAttemptAt?: string;
  lastAiSignalCandleTs?: number;
  aiFailureStreak?: number;
  aiRetryAt?: string;
  aiSignalSource?: "live" | "cache" | "deterministic";
  aiBudgetDay?: string;
  aiCallsToday?: number;
  aiActualCostTodayUsd?: number;
  aiReservedCostTodayUsd?: number;
  aiBudgetStatus?: string;
  aiNextEligibleAt?: string;
  evaluations?: StrategyEvaluation[];
  evaluationCount?: number;
  holdCount?: number;
  filledBuyCount?: number;
  filledSellCount?: number;
  failureCount?: number;
  evaluationJournalInitialized?: boolean;
};
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const NATIVE_TOKEN = /^0x[eE]{40}$/;
const Erc20AddressSchema = z.string().regex(ADDRESS).refine((value) => !NATIVE_TOKEN.test(value), "Autopilot assets must be ERC-20 contracts; use the wrapped native asset");
const configs = {
  xlayer: {
    id: 196,
    rpc: () => process.env.X_LAYER_RPC || "https://rpc.xlayer.tech",
    rpcFallback: () => process.env.X_LAYER_RPC_FALLBACK || "https://xlayerrpc.okx.com",
    oracle: () => executionContractAddress("xlayer", "oracleRouter"),
    adapter: () => executionContractAddress("xlayer", "executionAdapter"),
    router: () => executionContractAddress("xlayer", "okxRouter"),
    spender: () => executionContractAddress("xlayer", "okxApproval"),
    factory: () => executionContractAddress("xlayer", "autopilotFactory"),
  },
  base: {
    id: 8453,
    rpc: () => process.env.BASE_RPC_URL || "https://mainnet.base.org",
    rpcFallback: () => process.env.BASE_RPC_FALLBACK_URL || "https://1rpc.io/base",
    oracle: () => executionContractAddress("base", "oracleRouter"),
    adapter: () => executionContractAddress("base", "executionAdapter"),
    router: () => executionContractAddress("base", "okxRouter"),
    spender: () => executionContractAddress("base", "okxApproval"),
    factory: () => executionContractAddress("base", "autopilotFactory"),
  },
  arbitrum: {
    id: 42161,
    rpc: () => process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    rpcFallback: () => process.env.ARBITRUM_RPC_FALLBACK_URL || "https://arbitrum-one-rpc.publicnode.com",
    oracle: () => executionContractAddress("arbitrum", "oracleRouter"),
    adapter: () => executionContractAddress("arbitrum", "executionAdapter"),
    router: () => executionContractAddress("arbitrum", "okxRouter"),
    spender: () => executionContractAddress("arbitrum", "okxApproval"),
    factory: () => executionContractAddress("arbitrum", "autopilotFactory"),
  },
} as const;
const StrategySchema = z.object({
  owner: z.string().regex(ADDRESS),
  network: z.enum(["xlayer", "base", "arbitrum"]),
  vault: z.string().regex(ADDRESS),
  settlementAsset: Erc20AddressSchema,
  targetAsset: Erc20AddressSchema,
  pair: z.string().regex(/^[A-Z0-9._-]{3,40}$/),
  timeframe: z.enum(["15m", "1H", "4H", "1D"]),
  strategyType: z.enum(["trend_following", "breakout", "mean_reversion"]).optional(),
  buyAmountAtomic: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => BigInt(v) > 0n),
  sellAmountAtomic: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => BigInt(v) > 0n),
  minConfidence: z.number().min(50).max(100),
  policy: z.object({
    pair: z.string(),
    timeframe: z.string(),
    maxTradePct: z.number(),
    dailyLossPct: z.number(),
    strategy: z.string(),
  }),
  authorization: z.object({
    expiresAt: z.number().int().positive(),
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  }),
});
const StrategyPreflightSchema = z.object({
  network: z.enum(["xlayer", "base", "arbitrum"]),
  settlementAsset: Erc20AddressSchema,
  targetAsset: Erc20AddressSchema,
  pair: z.string().regex(/^[A-Z0-9._-]{3,40}$/),
  amountAtomic: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
});
async function kv(command: unknown[]) {
  return runKvCommand(command, "Autopilot");
}
const localStrategyLeases = new Map<string, string>();
async function acquireStrategyLease(strategyId: string, scope: "analysis" | "execution") {
  const key = `pulse:v6:autopilot:lease:${scope}:${strategyId}`;
  const token = crypto.randomUUID();
  if (!kvConfigured()) {
    if (localStrategyLeases.has(key)) return null;
    localStrategyLeases.set(key, token);
    return token;
  }
  const result = await kv(["SET", key, token, "NX", "EX", 180]);
  return result === "OK" ? token : null;
}
async function releaseStrategyLease(strategyId: string, scope: "analysis" | "execution", token: string) {
  const key = `pulse:v6:autopilot:lease:${scope}:${strategyId}`;
  if (!kvConfigured()) {
    if (localStrategyLeases.get(key) === token) localStrategyLeases.delete(key);
    return;
  }
  await kv(["EVAL", "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", "1", key, token]);
}
const localSignalCache = new Map<string, { expiresAt: number; value: AutopilotSignalResult }>();
const signalCacheKey = (pair: string, timeframe: string) => `pulse:v6:autopilot:signal:${pair}:${timeframe}`;
async function cachedAutopilotSignal(pair: string, timeframe: string) {
  const key = signalCacheKey(pair, timeframe);
  const local = localSignalCache.get(key);
  if (local && local.expiresAt > Date.now()) return local.value;
  if (!kvConfigured()) return null;
  const raw = await kv(["GET", key]).catch(() => null);
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as { expiresAt?: number; value?: AutopilotSignalResult };
    if (!parsed.value || !parsed.expiresAt || parsed.expiresAt <= Date.now()) return null;
    localSignalCache.set(key, { expiresAt: parsed.expiresAt, value: parsed.value });
    return parsed.value;
  } catch {
    return null;
  }
}
async function cacheAutopilotSignal(pair: string, timeframe: string, value: AutopilotSignalResult, ttlMs: number) {
  const key = signalCacheKey(pair, timeframe);
  const entry = { expiresAt: Date.now() + ttlMs, value };
  localSignalCache.set(key, entry);
  if (kvConfigured()) await kv(["SET", key, JSON.stringify(entry), "EX", Math.max(1, Math.ceil(ttlMs / 1000))]);
}
let memory: Strategy[] = [];
export type AutopilotPass = {
  owner: string;
  network: Network;
  vault: string;
  purchasedAt: string;
  expiresAt: string;
  signalLimit: number;
  signalsUsed: number;
  /** Wall-clock expiry is frozen while the owner pauses the vault. */
  pausedAt?: string;
  telegramDelivery?: string;
  expiryWarningSentAt?: string;
  expiredNoticeSentAt?: string;
};
export const AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS = 15 * 60_000;
export const AUTOPILOT_PROVIDER_BLOCK_BACKOFF_MS = 6 * 60 * 60_000;

export function autopilotPassRemainingMs(value: AutopilotPass, now = Date.now()) {
  const reference = value.pausedAt ? Date.parse(value.pausedAt) : now;
  return Date.parse(value.expiresAt) - reference;
}

export function nextAutopilotAiRetryAt(input: {
  now: number;
  minimumIntervalMs: number;
  failureStreak: number;
  error?: string;
}) {
  const providerBlocked = /\b401\b|\b402\b|\b403\b|permission[- ]denied|credits|spending limit|billing|quota/i.test(input.error || "");
  const transientBackoff = Math.min(
    AUTOPILOT_PROVIDER_BLOCK_BACKOFF_MS,
    AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS * 2 ** Math.max(0, Math.min(5, input.failureStreak - 1)),
  );
  return input.now + Math.max(
    AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS,
    input.minimumIntervalMs,
    providerBlocked ? AUTOPILOT_PROVIDER_BLOCK_BACKOFF_MS : transientBackoff,
  );
}
const localPasses = new Map<string, AutopilotPass>();
const passKey = (network: Network, vault: string) => `pulse:v6:autopilot:pass:${network}:${vault.toLowerCase()}`;
export async function getAutopilotPass(network: Network, vault: string): Promise<AutopilotPass | null> {
  const key = passKey(network, vault);
  if (!kvConfigured()) return localPasses.get(key) || null;
  const raw = await kv(["GET", key]).catch(() => null);
  if (typeof raw !== "string") return localPasses.get(key) || null;
  try {
    const parsed = JSON.parse(raw) as AutopilotPass;
    localPasses.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}
export async function autopilotPassTargetExists(input: { owner: string; network: Network; vault: string }) {
  return (await list()).some((item) =>
    item.network === input.network
    && item.vault.toLowerCase() === input.vault.toLowerCase()
    && item.owner.toLowerCase() === input.owner.toLowerCase(),
  );
}
async function saveAutopilotPass(value: AutopilotPass) {
  const key = passKey(value.network, value.vault);
  localPasses.set(key, value);
  if (kvConfigured()) {
    // A paused pass has no moving wall-clock expiry, so its KV record must not
    // disappear while the owner intentionally leaves a vault paused.
    if (value.pausedAt) await kv(["SET", key, JSON.stringify(value)]);
    else await kv(["SET", key, JSON.stringify(value), "EX", Math.max(172800, Math.ceil((Date.parse(value.expiresAt) - Date.now()) / 1000) + 2_592_000)]);
  }
}
async function synchronizeAutopilotPassPause(value: AutopilotPass, paused: boolean, now: number) {
  if (paused && !value.pausedAt) {
    value.pausedAt = new Date(now).toISOString();
    await saveAutopilotPass(value);
  } else if (!paused && value.pausedAt) {
    const pausedAt = Date.parse(value.pausedAt);
    const pausedFor = Number.isFinite(pausedAt) ? Math.max(0, now - pausedAt) : 0;
    value.expiresAt = new Date(Date.parse(value.expiresAt) + pausedFor).toISOString();
    value.pausedAt = undefined;
    value.expiryWarningSentAt = undefined;
    value.expiredNoticeSentAt = undefined;
    await saveAutopilotPass(value);
  }
  return value;
}
export async function grantAutopilotPass(input: { owner: string; network: Network; vault: string; days: 1 | 7 | 30; telegramDelivery?: string }) {
  const strategy = (await list()).find((item) => item.network === input.network && item.vault.toLowerCase() === input.vault.toLowerCase() && item.owner.toLowerCase() === input.owner.toLowerCase());
  if (!strategy) throw new Error("The selected vault is not a registered Autopilot owned by this wallet on the selected network");
  const existing = await getAutopilotPass(input.network, input.vault);
  const now = Date.now();
  const extendsActive = existing && autopilotPassRemainingMs(existing, now) > 0;
  const startsAt = extendsActive ? Date.parse(existing!.expiresAt) : now;
  const value: AutopilotPass = {
    owner: input.owner.toLowerCase(), network: input.network, vault: input.vault.toLowerCase(),
    purchasedAt: new Date(now).toISOString(),
    expiresAt: new Date(startsAt + input.days * 86_400_000).toISOString(),
    signalLimit: (extendsActive ? existing!.signalLimit - existing!.signalsUsed : 0) + input.days * 3,
    signalsUsed: 0,
    ...(existing?.pausedAt ? { pausedAt: existing.pausedAt } : {}),
    ...(input.telegramDelivery ? { telegramDelivery: input.telegramDelivery } : existing?.telegramDelivery ? { telegramDelivery: existing.telegramDelivery } : {}),
  };
  await saveAutopilotPass(value);
  strategy.lastEvaluatedCandleTs = undefined;
  strategy.lastRunAt = undefined;
  strategy.aiBudgetStatus = "ready";
  strategy.updatedAt = new Date().toISOString();
  await save((await list()).map((item) => item.id === strategy.id ? strategy : item), "runtime");
  return value;
}
async function consumeAutopilotPassSignal(strategy: Strategy) {
  const value = await getAutopilotPass(strategy.network, strategy.vault);
  const now = Date.now();
  if (!value || value.owner !== strategy.owner.toLowerCase() || autopilotPassRemainingMs(value, now) <= 0) return { ok: false as const, reason: "pass_expired", pass: value };
  if (value.signalsUsed >= value.signalLimit) return { ok: false as const, reason: "signals_exhausted", pass: value };
  value.signalsUsed += 1;
  await saveAutopilotPass(value);
  return { ok: true as const, pass: value };
}
const POTENTIAL_GAINER_PAIRS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "DOGE-USDT", "XRP-USDT", "ADA-USDT", "LTC-USDT", "PEPE-USDT", "SHIB-USDT", "WIF-USDT", "TURBO-USDT", "MOODENG-USDT"];
const potentialGainerCache = new Map<string, { expiresAt: number; value: unknown[] }>();
const potentialGainerInflight = new Map<string, Promise<unknown[]>>();

async function scanPotentialGainers(timeframe: "15m" | "1H" | "4H" | "1D") {
  const cached = potentialGainerCache.get(timeframe);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (kvConfigured()) {
    const persisted = await kv(["GET", `pulse:v6:autopilot:potential-gainers:${timeframe}`]).catch(() => null);
    if (typeof persisted === "string") {
      try {
        const value = JSON.parse(persisted) as unknown[];
        potentialGainerCache.set(timeframe, { value, expiresAt: Date.now() + 60_000 });
        return value;
      } catch {
        // Rebuild an invalid cache entry from authoritative OKX candles.
      }
    }
  }
  const pending = potentialGainerInflight.get(timeframe);
  if (pending) return pending;
  const request = (async () => {
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < POTENTIAL_GAINER_PAIRS.length; offset += 3) {
      const batch = POTENTIAL_GAINER_PAIRS.slice(offset, offset + 3);
      const results = await Promise.all(batch.map(async (pair) => {
        try {
          const market = await buildMarketContext({ instId: pair, timeframe, candleLimit: 120 });
          const trend = evaluateAutopilotPolicy({ strategyType: "trend_following", candles: market.candles, report: { analysis: { bias: "bullish", confidence: 100, regime: "trend_up", keyLevels: { support: [] } } }, minConfidence: 60, hasPosition: false });
          const breakout = evaluateAutopilotPolicy({ strategyType: "breakout", candles: market.candles, report: { analysis: { bias: "bullish", confidence: 100, regime: "trend_up", keyLevels: { support: [] } } }, minConfidence: 60, hasPosition: false });
          const mean = evaluateAutopilotPolicy({ strategyType: "mean_reversion", candles: market.candles, report: { analysis: { bias: "bullish", confidence: 100, regime: "range", keyLevels: { support: [] } } }, minConfidence: 60, hasPosition: false });
          const metrics = trend.metrics;
          const trendScore = 35 + (metrics.close! > metrics.sma20! ? 20 : 0) + (metrics.sma20! > metrics.sma50! ? 20 : 0) + (market.ticker.change24hPct > 0 ? 15 : 0) + (metrics.rsi14! >= 50 && metrics.rsi14! <= 70 ? 10 : 0);
          const breakoutScore = 30 + (metrics.close! > metrics.previous20High! ? 30 : 0) + (metrics.volumeRatio! >= 1.15 ? 25 : 0) + (market.ticker.change24hPct > 0 ? 15 : 0);
          const meanScore = 25
            + (metrics.rsi14! <= 42 ? 25 : 0)
            + (metrics.close! < metrics.sma20! ? 10 : 0)
            + (metrics.sma20! >= metrics.sma50! * .98 ? 20 : 0)
            + (market.ticker.change24hPct > 0 ? 15 : market.ticker.change24hPct > -2 ? 5 : 0)
            - (market.ticker.change24hPct < -3 ? 20 : 0);
          const ranked = [
            { id: "trend_following", score: trendScore, ready: trend.action === "buy", reason: `Close ${metrics.close! > metrics.sma20! ? "above" : "below"} SMA20; SMA20 ${metrics.sma20! > metrics.sma50! ? "above" : "below"} SMA50` },
            { id: "breakout", score: breakoutScore, ready: breakout.action === "buy", reason: `20-bar break ${metrics.close! > metrics.previous20High! ? "confirmed" : "not yet"}; volume ${metrics.volumeRatio!.toFixed(2)}x` },
            { id: "mean_reversion", score: meanScore, ready: mean.action === "buy", reason: `RSI14 ${metrics.rsi14!.toFixed(1)}; price ${metrics.close! < metrics.sma20! ? "below" : "above"} SMA20` },
          ].sort((a, b) => b.score - a.score);
          const best = ranked[0];
          return { pair, timeframe, score: Math.min(99, best.score), strategyType: best.id, technicalReady: best.ready, reason: best.reason, mark: market.ticker.last, change24hPct: market.ticker.change24hPct, rsi14: metrics.rsi14, volumeRatio: metrics.volumeRatio, fetchedAt: market.fetchedAt };
        } catch {
          return null;
        }
      }));
      rows.push(...results.filter((row): row is NonNullable<typeof row> => row !== null));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const value = rows.sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 8);
    potentialGainerCache.set(timeframe, { value, expiresAt: Date.now() + 5 * 60_000 });
    if (kvConfigured()) await kv(["SET", `pulse:v6:autopilot:potential-gainers:${timeframe}`, JSON.stringify(value), "EX", 300]).catch(() => undefined);
    return value;
  })().finally(() => potentialGainerInflight.delete(timeframe));
  potentialGainerInflight.set(timeframe, request);
  return request;
}
async function list() {
  if (!kvConfigured()) return memory;
  try {
    const hashEntries = decodeStrategyHash(await kv(["HGETALL", AUTOPILOT_STRATEGY_HASH_KEY])) as Strategy[];
    if (hashEntries.length) {
      memory = hashEntries;
      return hashEntries;
    }

    // One-time migration from the former shared JSON snapshot. An empty legacy
    // value is deliberately not written: a stale empty cycle must never erase a
    // strategy registered by another request/process.
    const legacy = await kv(["GET", "pulse:v6:autopilot:strategies"]);
    if (typeof legacy !== "string") return memory;
    const parsed = JSON.parse(legacy) as Strategy[];
    if (parsed.length) {
      await writeStrategyEntries(parsed);
      memory = parsed;
    }
    return parsed.length ? parsed : memory;
  } catch (error) {
    // A last-known strategy view keeps the dashboard useful during a short KV
    // interruption. Execution still fails closed because acquiring the
    // distributed lease requires a live KV connection.
    if (isKvUnavailableError(error) && memory.length) return memory;
    throw error;
  }
}
async function writeStrategyEntries(items: Strategy[]) {
  if (!items.length) return;
  await kv(["HSET", AUTOPILOT_STRATEGY_HASH_KEY, ...items.flatMap((item) => [item.id, JSON.stringify(item)])]);
}
async function save(items: Strategy[], mode: "full" | "runtime" = "full") {
  const bounded = items.slice(-500);
  if (!kvConfigured()) {
    memory = mode === "runtime"
      ? bounded.map((item) => {
        const current = memory.find((candidate) => candidate.id === item.id);
        return current ? mergeStrategyRuntime(current, item) : item;
      })
      : bounded;
    return;
  }
  if (mode === "full") {
    await writeStrategyEntries(bounded);
    const byId = new Map(memory.map((item) => [item.id, item]));
    for (const item of bounded) byId.set(item.id, item);
    memory = [...byId.values()].slice(-500);
    return;
  }
  const current = await list();
  const currentById = new Map(current.map((item) => [item.id, item]));
  const merged = bounded.map((item) => {
    const latest = currentById.get(item.id);
    return latest ? mergeStrategyRuntime(latest, item) : item;
  });
  await writeStrategyEntries(merged);
  memory = merged;
}
function clients(network: Network, key?: `0x${string}`) {
  const c = configs[network];
  const urls = [...new Set([c.rpc(), c.rpcFallback()].filter(Boolean))];
  const chain = {
    id: c.id,
    name: network,
    nativeCurrency: {
      name: "Native",
      symbol: network === "xlayer" ? "OKB" : "ETH",
      decimals: 18,
    },
    rpcUrls: { default: { http: urls } },
  };
  const publicClient = executionPublicClient(network);
  return {
    publicClient,
    walletClient: key
      ? createWalletClient({
          account: privateKeyToAccount(key),
          chain,
          transport: fallback(urls.map((url) => http(url, { retryCount: 2, retryDelay: 500 })), { retryCount: 1 }),
        })
      : null,
  };
}
const vaultReadAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "settlementAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "policyHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowedAssets",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "policyVersion",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "actionNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "maxSlippageBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "maxTradeValue",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "cooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "lastActionAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "decisionId", type: "bytes32" },
      { name: "expectedVersion", type: "uint64" },
      { name: "expectedNonce", type: "uint64" },
      { name: "adapter", type: "address" },
      { name: "sellToken", type: "address" },
      { name: "buyToken", type: "address" },
      { name: "sellAmount", type: "uint256" },
      { name: "minOut", type: "uint256" },
      { name: "adapterData", type: "bytes" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;
const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;
const oracleAbi = [
  {
    type: "function",
    name: "setPrice",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "address" },
      { type: "uint192" },
      { type: "uint64" },
    ],
    outputs: [],
  },
] as const;
const adapterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
const vaultFactoryAbi = [{
  type: "function", name: "vaultsOf", stateMutability: "view",
  inputs: [{ type: "address" }], outputs: [{ type: "address[]" }],
}] as const;

function authorizationMessage(input: z.infer<typeof StrategySchema>) {
  const payload = {
    owner: input.owner,
    network: input.network,
    vault: input.vault,
    settlementAsset: input.settlementAsset,
    targetAsset: input.targetAsset,
    pair: input.pair,
    timeframe: input.timeframe,
    ...(input.strategyType ? { strategyType: input.strategyType } : {}),
    buyAmountAtomic: input.buyAmountAtomic,
    sellAmountAtomic: input.sellAmountAtomic,
    minConfidence: input.minConfidence,
    policy: input.policy,
  };
  return `PULSE Autopilot strategy\n${keccak256(toHex(JSON.stringify(payload)))}\nExpires:${input.authorization.expiresAt}`;
}
async function verifyStrategy(input: z.infer<typeof StrategySchema>) {
  const { publicClient } = clients(input.network);
  const address = input.vault as `0x${string}`;
  const factory = configs[input.network].factory();
  if (!factory || !ADDRESS.test(factory)) throw new Error("Autopilot factory is not configured");
  if (input.authorization.expiresAt < Date.now() || input.authorization.expiresAt > Date.now() + 10 * 60_000)
    throw new Error("Wallet authorization is expired or too far in the future");
  const signatureValid = await verifyMessage({
    address: input.owner as `0x${string}`,
    message: authorizationMessage(input),
    signature: input.authorization.signature as `0x${string}`,
  });
  if (!signatureValid) throw new Error("Invalid connected-wallet authorization");
  const [owner, settlement, policyHash, allowed, factoryVaults, targetSymbol, settlementSymbol] = await publicClient.multicall({ contracts: [
    { address, abi: vaultReadAbi, functionName: "owner" },
    { address, abi: vaultReadAbi, functionName: "settlementAsset" },
    { address, abi: vaultReadAbi, functionName: "policyHash" },
    { address, abi: vaultReadAbi, functionName: "allowedAssets", args: [input.targetAsset as `0x${string}`] },
    { address: factory as `0x${string}`, abi: vaultFactoryAbi, functionName: "vaultsOf", args: [input.owner as `0x${string}`] },
    { address: input.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
    { address: input.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
  ], allowFailure: false });
  if (
    owner.toLowerCase() !== input.owner.toLowerCase() ||
    settlement.toLowerCase() !== input.settlementAsset.toLowerCase() ||
    !allowed
  )
    throw new Error(
      "Vault owner, settlement asset or on-chain allowlist mismatch",
    );
  if (!factoryVaults.some((vault) => vault.toLowerCase() === input.vault.toLowerCase()))
    throw new Error("Vault was not created by the configured Autopilot factory");
  const [base, quote, extra] = input.pair.toUpperCase().split("-");
  const normalizeForChain = (symbol: string) => normaliseRouteSymbol(analysisSymbolForExecutionToken(symbol, String(configs[input.network].id)));
  if (!base || !quote || extra || normalizeForChain(targetSymbol) !== normaliseRouteSymbol(base) || normalizeForChain(settlementSymbol) !== normaliseRouteSymbol(quote))
    throw new Error(`On-chain tokens ${targetSymbol}/${settlementSymbol} do not match ${input.pair}`);
  if (keccak256(toHex(JSON.stringify(input.policy))) !== policyHash)
    throw new Error(
      "Strategy policy does not match the owner-committed on-chain policy hash",
    );
}
export function createAutopilotAutomationRouter(cfg: AppConfig) {
  const router = Router();
  const potentialGainersHandler = asyncRoute(async (req, res) => {
    const parsed = z.enum(["15m", "1H", "4H", "1D"]).safeParse(String(req.query.timeframe || "1H"));
    if (!parsed.success) return res.status(400).json({ error: "timeframe must be 15m, 1H, 4H or 1D" });
    const candidates = await scanPotentialGainers(parsed.data);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
    res.json({ candidates, methodology: "Read-only OKX candle prefilter. Score is not a forecast and does not replace Premium analysis or selected-network route validation.", premiumRequired: true, routeCheckedAfterSelection: true });
  });
  // Product-level discovery endpoint. Keep the former path as a compatibility
  // alias for open clients and external integrations.
  router.get("/v1/opportunities", potentialGainersHandler);
  router.get("/v1/autopilot/potential-gainers", potentialGainersHandler);
  router.post("/v1/autopilot/preflight", asyncRoute(async (req, res) => {
    const parsed = StrategyPreflightSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const { network, settlementAsset, targetAsset, pair, amountAtomic } = parsed.data;
      const { publicClient } = clients(network);
      const [settlementCode, targetCode, metadata] = await Promise.all([
        publicClient.getCode({ address: settlementAsset as `0x${string}` }),
        publicClient.getCode({ address: targetAsset as `0x${string}` }),
        publicClient.multicall({ allowFailure: false, contracts: [
          { address: targetAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
          { address: settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
        ] }),
      ]);
      if (!settlementCode || settlementCode === "0x" || !targetCode || targetCode === "0x")
        throw new Error("The selected Autopilot route contains a non-contract token representation");
      const [targetSymbol, settlementSymbol] = metadata.map(String);
      const [base, quote, extra] = pair.toUpperCase().split("-");
      const normalizeForChain = (symbol: string) => normaliseRouteSymbol(analysisSymbolForExecutionToken(symbol, String(configs[network].id)));
      if (!base || !quote || extra || normalizeForChain(targetSymbol) !== normaliseRouteSymbol(base) || normalizeForChain(settlementSymbol) !== normaliseRouteSymbol(quote))
        throw new Error(`Contract route ${targetSymbol}/${settlementSymbol} does not represent ${pair}`);
      await getGenericOkxQuote(cfg, { chainId: String(configs[network].id), fromTokenAddress: settlementAsset, toTokenAddress: targetAsset, amount: amountAtomic, slippagePercent: "1.5" });
      res.json({ ready: true, pair, executionPair: `${targetSymbol}/${settlementSymbol}`, targetAsset, settlementAsset });
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : String(error), walletTransactionsSent: false });
    }
  }));
  router.get("/v1/autopilot/strategies", asyncRoute(async (req, res) => {
    const owner = String(req.query.owner || "");
    const requestedNetwork = String(req.query.network || "");
    if (!ADDRESS.test(owner))
      return res.status(400).json({ error: "Valid owner required" });
    if (requestedNetwork && !(requestedNetwork in configs))
      return res.status(400).json({ error: "Unsupported network" });
    const strategies = (await list()).filter((s) => s.owner.toLowerCase() === owner.toLowerCase() && (!requestedNetwork || s.network === requestedNetwork));
    const activityByNetwork = new Map<string, Awaited<ReturnType<typeof listV6Activity>>>();
    await Promise.all([...new Set(strategies.map((strategy) => strategy.network))].map(async (network) => {
      activityByNetwork.set(network, await listV6Activity(owner, network));
    }));
    const views = await Promise.all(strategies.map(async (strategy) => {
      const aiPass = await getAutopilotPass(strategy.network, strategy.vault);
      try {
        const { publicClient } = clients(strategy.network);
        const [chainState, ticker] = await Promise.all([
          publicClient.multicall({
            allowFailure: false,
            contracts: [
              { address: strategy.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [strategy.vault as `0x${string}`] },
              { address: strategy.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [strategy.vault as `0x${string}`] },
              { address: strategy.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
              { address: strategy.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
              { address: strategy.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
              { address: strategy.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
              { address: strategy.vault as `0x${string}`, abi: vaultReadAbi, functionName: "paused" },
            ],
          }),
          getTicker(strategy.pair),
        ]);
        const [settlementBalance, targetBalance, settlementDecimals, targetDecimals, settlementSymbol, targetSymbol, paused] = chainState;
        if (aiPass) await synchronizeAutopilotPassPause(aiPass, Boolean(paused), Date.now());
        const price = parseUnits(ticker.last.toFixed(18), 18);
        const portfolioValueAtomic = settlementBalance + targetBalance * price * (10n ** BigInt(settlementDecimals)) / (10n ** BigInt(targetDecimals)) / 10n ** 18n;
        const baseline = BigInt(strategy.baselineValueAtomic || "0");
        const strategyCashFlows = (activityByNetwork.get(strategy.network) || [])
          .filter((item) => item.status === "confirmed" && item.account?.toLowerCase() === strategy.vault.toLowerCase() && item.createdAt >= strategy.createdAt && (item.kind === "vault_fund" || item.kind === "vault_withdraw"))
        const networkActivity = activityByNetwork.get(strategy.network) || [];
        const pnl = cashFlowAdjustedPnl(portfolioValueAtomic, baseline, strategyCashFlows);
        const evaluations = await listEvaluationHistory(strategy);
        const lifetime = reconcileAutopilotLifetimeStats(strategy, networkActivity, evaluations);
        const reconciled = { ...reconcileStrategyExecution(strategy, networkActivity, targetBalance), ...lifetime, evaluations };
        const runtimeState = deriveAutopilotRuntimeState({ configuredStatus: reconciled.status, paused: Boolean(paused), targetBalance, pass: aiPass });
        return { ...reconciled, registrationStatus: reconciled.status, runtimeState, aiPass, paused, settlementBalance: String(settlementBalance), targetBalance: String(targetBalance), settlementDecimals: Number(settlementDecimals), targetDecimals: Number(targetDecimals), settlementSymbol, targetSymbol, portfolioValueAtomic: String(portfolioValueAtomic), markPrice: ticker.last, contributionsAtomic: String(pnl.contributionsAtomic), withdrawalsAtomic: String(pnl.withdrawalsAtomic), netCashFlowAtomic: String(pnl.netCashFlowAtomic), pnlBasisAtomic: String(pnl.pnlBasisAtomic), pnlAtomic: pnl.pnlAtomic == null ? null : String(pnl.pnlAtomic), pnlPct: pnl.pnlPct };
      } catch (error) {
        return { ...strategy, registrationStatus: strategy.status, runtimeState: "telemetry_unavailable" as const, aiPass, telemetryError: error instanceof Error ? error.message : String(error) };
      }
    }));
    res.json({
      strategies: views,
      strategyCatalog: AUTOPILOT_STRATEGY_CATALOG,
      persistence: kvCircuitStatus(),
      aiPolicy: {
        mode: "event_driven_compact_signal",
        fullPremiumReportsPerCycle: false,
        deterministicRiskMonitoring: true,
        minSignalIntervalMs: cfg.AUTOPILOT_AI_MIN_INTERVAL_MS,
        sharedSignalTtlMs: cfg.AUTOPILOT_AI_SIGNAL_TTL_MS,
        maxCallsPerVaultDay: cfg.AUTOPILOT_AI_MAX_CALLS_PER_VAULT_DAY,
        maxCallsGlobalDay: cfg.AUTOPILOT_AI_MAX_CALLS_GLOBAL_DAY,
        maxUsdPerVaultDay: cfg.AUTOPILOT_AI_MAX_USD_PER_VAULT_DAY,
        maxUsdGlobalDay: cfg.AUTOPILOT_AI_MAX_USD_GLOBAL_DAY,
        commercialPass: { enabled: true, renewal: "prepaid_manual", price24hUsd: cfg.PRICE_AUTOPILOT_PASS_24H, price7dUsd: cfg.PRICE_AUTOPILOT_PASS_7D, price30dUsd: cfg.PRICE_AUTOPILOT_PASS_30D, signalsPerDay: 3, expiryBehavior: "pause_freezes_timer; expiry_holds_new_entries_and_keeps_risk_exits" },
      },
    });
  }));
  router.post("/v1/autopilot/strategies", asyncRoute(async (req, res) => {
    const parsed = StrategySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    try {
      await verifyStrategy(parsed.data);
      const items = await list();
      const id = `${parsed.data.network}:${parsed.data.vault.toLowerCase()}`;
      const previous = items.find((s) => s.id === id);
      const now = new Date().toISOString();
      const { authorization: _authorization, ...authorizedStrategy } = parsed.data;
      const configurationHash = keccak256(toHex(JSON.stringify(authorizedStrategy)));
      const { publicClient } = clients(parsed.data.network);
      const [settlementBalance, targetBalance, settlementDecimals, targetDecimals, ticker] = await Promise.all([
        publicClient.readContract({ address: parsed.data.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [parsed.data.vault as `0x${string}`] }),
        publicClient.readContract({ address: parsed.data.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [parsed.data.vault as `0x${string}`] }),
        publicClient.readContract({ address: parsed.data.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
        publicClient.readContract({ address: parsed.data.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
        getTicker(parsed.data.pair),
      ]);
      const baselinePrice = parseUnits(ticker.last.toFixed(18), 18);
      const baselineValue = settlementBalance + targetBalance * baselinePrice * (10n ** BigInt(settlementDecimals)) / (10n ** BigInt(targetDecimals)) / 10n ** 18n;
      const strategy: Strategy = {
        ...previous,
        ...authorizedStrategy,
        id,
        configurationHash,
        exitPending:
          previous?.configurationHash === configurationHash
            ? previous.exitPending
            : false,
        strategyType: parsed.data.strategyType || previous?.strategyType || identifyAutopilotStrategy(parsed.data.policy.strategy),
        status: "active",
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        baselineValueAtomic: previous?.baselineValueAtomic || String(baselineValue),
      };
      await save([...items.filter((s) => s.id !== id), strategy]);
      res.status(201).json({ strategy });
    } catch (error) {
      if (isKvUnavailableError(error)) throw error;
      const transient = /rate limit|429|timeout|timed out|fetch failed|network|rpc request failed|temporarily unavailable/i.test(error instanceof Error ? error.message : String(error));
      res
        .status(transient ? 503 : 422)
        .json({
          error: error instanceof Error ? error.message : String(error),
          retryable: transient,
        });
    }
  }));
  return router;
}
async function evidence(strategy: Strategy, payload: unknown) {
  const body = JSON.stringify(payload);
  const hash = keccak256(toHex(body));
  const key = `pulse:v6:autopilot:evidence:${strategy.network}:${strategy.vault.toLowerCase()}:${hash}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const result = await put(
        `autopilot/${strategy.network}/${strategy.vault}/${Date.now()}-${hash.slice(2, 14)}.json`,
        body,
        {
          access: "private",
          token: process.env.BLOB_READ_WRITE_TOKEN,
          addRandomSuffix: false,
        },
      );
      return { hash, url: result.url };
    } catch {
      // A public Blob store cannot accept private objects. Evidence must still
      // be persisted before execution, so use the configured private KV store.
    }
  }
  await kv(["SET", key, body, "EX", 31_536_000]);
  return { hash, url: `kv:${key}` };
}
function evaluationHistoryKey(strategyId: string) {
  return `pulse:autopilot:evaluations:${strategyId}`;
}

function decodeEvaluationHistory(raw: unknown): StrategyEvaluation[] {
  const values = Array.isArray(raw)
    ? raw.filter((_value, index) => index % 2 === 1)
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [];
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value) as StrategyEvaluation;
      return parsed && typeof parsed.id === "string" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

async function listEvaluationHistory(strategy: Strategy) {
  const embedded = strategy.evaluations || [];
  if (!kvConfigured()) return embedded;
  try {
    const persisted = decodeEvaluationHistory(await kv(["HGETALL", evaluationHistoryKey(strategy.id)]));
    const byId = new Map<string, StrategyEvaluation>();
    for (const evaluation of [...persisted, ...embedded]) byId.set(evaluation.id, evaluation);
    return [...byId.values()].sort((left, right) => Date.parse(left.evaluatedAt) - Date.parse(right.evaluatedAt));
  } catch {
    return embedded;
  }
}

async function appendEvaluation(strategy: Strategy, evaluation: StrategyEvaluation) {
  const previous = strategy.evaluations || [];
  strategy.evaluationCount = (strategy.evaluationCount ?? previous.length) + 1;
  strategy.holdCount = (strategy.holdCount ?? previous.filter((entry) => entry.action === "hold" && entry.status === "held").length)
    + (evaluation.action === "hold" && evaluation.status === "held" ? 1 : 0);
  strategy.filledBuyCount = (strategy.filledBuyCount ?? previous.filter((entry) => entry.action === "buy" && entry.status === "filled").length)
    + (evaluation.action === "buy" && evaluation.status === "filled" ? 1 : 0);
  strategy.filledSellCount = (strategy.filledSellCount ?? previous.filter((entry) => entry.action === "sell" && entry.status === "filled").length)
    + (evaluation.action === "sell" && evaluation.status === "filled" ? 1 : 0);
  strategy.failureCount = (strategy.failureCount ?? previous.filter((entry) => entry.status === "failed").length)
    + (evaluation.status === "failed" ? 1 : 0);
  // The embedded window is a resilient fallback for short KV outages. The
  // append-only hash is the complete journal used by the API and CSV export.
  strategy.evaluations = [...previous, evaluation].slice(-100);
  if (kvConfigured()) {
    try {
      const journalRows = strategy.evaluationJournalInitialized ? [evaluation] : [...previous, evaluation];
      await kv(["HSET", evaluationHistoryKey(strategy.id), ...journalRows.flatMap((item) => [item.id, JSON.stringify(item)])]);
      strategy.evaluationJournalInitialized = true;
    } catch {
      // The strategy snapshot still retains this row and execution remains
      // fail-closed. A journal transport outage must never reclassify a mined
      // transaction as a failed trade.
    }
  }
}
export async function runAutopilotCycle(cfg: AppConfig) {
  {
    const key = (cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY) as `0x${string}`;
    if (
      !/^0x[a-fA-F0-9]{64}$/.test(key || "") ||
      cfg.AUTOPILOT_KILL_SWITCH
    )
      return;
    const items = await list();
    const analysisInterval = Math.max(
      AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS,
      Number(process.env.AUTOPILOT_ANALYSIS_INTERVAL_MS || AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS) || AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS,
    );
    const riskInterval = Math.max(
      30_000,
      Number(process.env.AUTOPILOT_RISK_INTERVAL_MS || 60000) || 60000,
    );
    const activeItems = items.filter((x) => x.status === "active");
    const scheduled = [
      ...activeItems.map((strategy) => ({ strategy, mode: "risk" as const })),
      ...activeItems.map((strategy) => ({ strategy, mode: "analysis" as const })),
    ];
    for (const { strategy: s, mode } of scheduled) {
      const leaseScope = mode === "risk" ? "execution" as const : "analysis" as const;
      const lease = await acquireStrategyLease(s.id, leaseScope);
      if (!lease) continue;
      let analysisAttempted = false;
      let aiAttemptedThisCycle = false;
      try {
        const now = Date.now();
        const lastAnalysis = Date.parse(s.lastRunAt || "");
        const lastRiskCheck = Date.parse(s.lastRiskCheckAt || "");
        const analysisDue = !Number.isFinite(lastAnalysis) || now - lastAnalysis >= analysisInterval;
        const riskDue = !Number.isFinite(lastRiskCheck) || now - lastRiskCheck >= riskInterval;
        if ((mode === "risk" && !riskDue) || (mode === "analysis" && !analysisDue)) continue;
        const c = configs[s.network];
        const oracle = c.oracle(),
          adapter = c.adapter(),
          router = c.router(),
          spender = c.spender();
        if (
          !ADDRESS.test(oracle || "") ||
          !ADDRESS.test(adapter || "") ||
          !ADDRESS.test(router || "") ||
          !ADDRESS.test(spender || "")
        )
          throw new Error("Autopilot execution configuration missing");
        const { publicClient, walletClient } = clients(s.network, key);
        if (!walletClient) throw new Error("Executor unavailable");
        const vault = s.vault as `0x${string}`;
        const readRuntime = () => publicClient.multicall({
          allowFailure: false,
          contracts: [
            { address: vault, abi: vaultReadAbi, functionName: "paused" },
            { address: vault, abi: vaultReadAbi, functionName: "policyVersion" },
            { address: vault, abi: vaultReadAbi, functionName: "actionNonce" },
            { address: vault, abi: vaultReadAbi, functionName: "maxSlippageBps" },
            { address: vault, abi: vaultReadAbi, functionName: "maxTradeValue" },
            { address: vault, abi: vaultReadAbi, functionName: "cooldown" },
            { address: vault, abi: vaultReadAbi, functionName: "lastActionAt" },
            { address: s.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
            { address: s.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
            { address: s.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
            { address: s.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
          ],
        });
        let [
          paused,
          version,
          nonce,
          slippage,
          maxTradeValue,
          cooldown,
          lastActionAt,
          targetBalance,
          targetDecimals,
          settlementDecimals,
          settlementBalance,
        ] = await readRuntime();
        const aiPass = await getAutopilotPass(s.network, s.vault);
        if (aiPass) await synchronizeAutopilotPassPause(aiPass, Boolean(paused), now);
        if (mode === "analysis") {
          if (aiPass?.telegramDelivery) {
            const remainingMs = autopilotPassRemainingMs(aiPass, now);
            if (!aiPass.pausedAt && remainingMs > 0 && remainingMs <= 2 * 60 * 60_000 && !aiPass.expiryWarningSentAt) {
              await deliverTelegramReportDurably(`autopilot-pass-warning:${s.network}:${s.vault}:${aiPass.expiresAt}`, aiPass.telegramDelivery, `PULSE Autopilot pass for ${s.pair} expires in ${Math.max(1, Math.ceil(remainingMs / 60_000))} minutes. Renew to keep AI-assisted new entries available. TP/SL and exits continue even without a pass.`, `${cfg.BASE_URL.replace(/\/$/, "")}/autopilot`);
              aiPass.expiryWarningSentAt = new Date().toISOString();
              await saveAutopilotPass(aiPass);
            } else if (!aiPass.pausedAt && remainingMs <= 0 && !aiPass.expiredNoticeSentAt) {
              await deliverTelegramReportDurably(`autopilot-pass-expired:${s.network}:${s.vault}:${aiPass.expiresAt}`, aiPass.telegramDelivery, `PULSE Autopilot pass for ${s.pair} has expired. New entries now Hold. Deterministic TP/SL, exits, pause and withdrawal remain active.`, `${cfg.BASE_URL.replace(/\/$/, "")}/autopilot`);
              aiPass.expiredNoticeSentAt = new Date().toISOString();
              await saveAutopilotPass(aiPass);
            }
          }
        }
        if (paused) {
          s.lastDecision = "hold_paused";
          if (mode === "analysis") s.lastRunAt = new Date().toISOString();
          if (mode === "risk") s.lastRiskCheckAt = new Date().toISOString();
          s.lastError = undefined;
          continue;
        }
        const strategyType = s.strategyType || identifyAutopilotStrategy(s.policy.strategy);
        s.strategyType = strategyType;
        if (targetBalance === 0n && s.lastTxHash && s.lastDecision !== "sell_filled") {
          Object.assign(s, reconcileStrategyExecution(s, await listV6Activity(s.owner, s.network), targetBalance));
        }
        if (targetBalance === 0n) {
          s.exitPending = false;
          s.activeTakeProfit = undefined;
          s.activeStopLoss = undefined;
        }

        const chainNow = BigInt(Math.floor(now / 1000));
        const readyAt = lastActionAt + cooldown;
        let cooldownRemaining = readyAt > chainNow ? Number(readyAt - chainNow) : 0;
        let cooldownReady = cooldownRemaining === 0;
        let decision: ReturnType<typeof evaluateAutopilotPolicy> | ReturnType<typeof evaluateAutopilotRiskExit> | undefined;
        let executionPrice = 0;
        let evidenceContext: unknown;
        let executionPlan: ReturnType<typeof buildSpotExecutionPlan> | undefined;

        // Protection is intentionally independent of Premium analysis. A live
        // TP/SL touch is latched, so a cooldown or dependency outage cannot
        // make the strategy forget an exit that the owner already authorized.
        if (mode === "risk" && targetBalance > 0n) {
          const ticker = await getTicker(s.pair);
          const checkedAt = new Date().toISOString();
          s.lastRiskCheckAt = checkedAt;
          const riskDecision = evaluateAutopilotRiskExit({
            strategyType,
            mark: ticker.last,
            hasPosition: true,
            exitPending: s.exitPending,
            activeTakeProfit: s.activeTakeProfit,
            activeStopLoss: s.activeStopLoss,
            cooldownReady,
            cooldownRemainingSeconds: cooldownRemaining,
          });
          const exitTriggered = riskDecision.rules.slice(0, 3).some((rule) => rule.passed);
          if (exitTriggered) s.exitPending = true;
          if (riskDecision.action === "sell") {
            decision = riskDecision;
            executionPrice = ticker.last;
            evidenceContext = {
              mode: "live_risk_monitor",
              checkedAt,
              ticker,
              activeTakeProfit: s.activeTakeProfit ?? null,
              activeStopLoss: s.activeStopLoss ?? null,
              exitPending: s.exitPending === true,
              cooldown: Number(cooldown),
              lastActionAt: Number(lastActionAt),
            };
          } else if (exitTriggered && !cooldownReady) {
            s.lastDecision = "hold_exit_cooldown";
            s.lastError = undefined;
            continue;
          } else {
            s.lastError = undefined;
            continue;
          }
        } else if (mode === "risk") {
          s.lastRiskCheckAt = new Date().toISOString();
          s.lastError = undefined;
          continue;
        }

        if (!decision) {
          analysisAttempted = true;
          const market = await buildMarketContext({
            instId: s.pair,
            timeframe: s.timeframe,
            candleLimit: 120,
          });
          const candleTs = market.candles.at(-1)?.ts || 0;
          if (s.lastEvaluatedCandleTs === candleTs) {
            s.lastDecision = "hold_same_candle";
            s.lastRunAt = new Date().toISOString();
            s.lastError = undefined;
            continue;
          }
          s.lastEvaluatedCandleTs = candleTs;
          const technical = buildTechnicalStructure(market.candles);
          executionPrice = market.ticker.last;
          const neutralAnalysis = { bias: "neutral", confidence: 0, regime: "transition", keyLevels: { support: [] as number[], resistance: [] as number[] } };

          // An open position never needs a new AI call to remain protected or
          // to react to deterministic structure failure.
          if (targetBalance > 0n) {
            const report = { analysis: neutralAnalysis };
            decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report, minConfidence: s.minConfidence, hasPosition: true, exitPending: s.exitPending, activeTakeProfit: s.activeTakeProfit, activeStopLoss: s.activeStopLoss });
            s.aiSignalSource = "deterministic";
            s.aiBudgetStatus = "not_required_for_open_position";
            evidenceContext = { mode: "deterministic_position_monitor", technical };
          } else {
            const candidate = evaluateAutopilotEntryCandidate({ strategyType, candles: market.candles });
            if (!candidate.candidate) {
              decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report: { analysis: neutralAnalysis }, minConfidence: s.minConfidence, hasPosition: false });
              s.aiSignalSource = "deterministic";
              s.aiBudgetStatus = "candidate_not_ready";
              evidenceContext = { mode: "deterministic_entry_prefilter", candidate, technical };
            } else {
              const pass = await getAutopilotPass(s.network, s.vault);
              const passReady = Boolean(pass && autopilotPassRemainingMs(pass) > 0 && pass.signalsUsed < pass.signalLimit);
              let signal = passReady ? await cachedAutopilotSignal(s.pair, s.timeframe) : null;
              if (!passReady) {
                s.aiSignalSource = "deterministic";
                s.aiBudgetStatus = pass && autopilotPassRemainingMs(pass) > 0 ? "signals_exhausted" : "pass_expired";
              } else if (signal) {
                s.aiSignalSource = "cache";
                s.aiBudgetStatus = "ready";
              } else {
                const lastSignalAt = Math.max(
                  Date.parse(s.lastAiSignalAt || "") || 0,
                  Date.parse(s.lastAiAttemptAt || "") || 0,
                );
                const configuredNext = lastSignalAt ? lastSignalAt + Math.max(AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS, cfg.AUTOPILOT_AI_MIN_INTERVAL_MS) : 0;
                const retryAt = Date.parse(s.aiRetryAt || "") || 0;
                const nextEligible = Math.max(configuredNext, retryAt);
                s.aiNextEligibleAt = nextEligible > Date.now() ? new Date(nextEligible).toISOString() : undefined;
                if (nextEligible > Date.now()) {
                  s.aiBudgetStatus = "cooldown";
                } else if (!cfg.hasXaiKey) {
                  s.aiBudgetStatus = "provider_not_configured";
                } else {
                  const signalLeaseId = `signal:${s.pair}:${s.timeframe}`;
                  const signalLease = await acquireStrategyLease(signalLeaseId, "analysis");
                  if (!signalLease) {
                    signal = await cachedAutopilotSignal(s.pair, s.timeframe);
                    s.aiBudgetStatus = signal ? "ready" : "signal_generation_in_progress";
                    s.aiSignalSource = signal ? "cache" : "deterministic";
                  } else {
                    try {
                      signal = await cachedAutopilotSignal(s.pair, s.timeframe);
                      if (!signal) {
                        // Record the attempt before any network call. A rejected
                        // request must throttle the next cycle exactly like a
                        // successful request.
                        s.lastAiAttemptAt = new Date().toISOString();
                        aiAttemptedThisCycle = true;
                        const estimatedCost = estimatedAutopilotSignalCostUsd({
                          maxInputTokens: cfg.GROK_MAX_INPUT_AUTOPILOT,
                          maxOutputTokens: cfg.GROK_MAX_OUTPUT_AUTOPILOT,
                          inputUsdPerMillion: cfg.XAI_INPUT_COST_PER_MILLION_USD,
                          outputUsdPerMillion: cfg.XAI_OUTPUT_COST_PER_MILLION_USD,
                        });
                        const reservation = await reserveAutopilotAiBudget({
                          strategyId: s.id,
                          reservationId: `${s.pair}:${s.timeframe}:${candleTs}`,
                          estimatedCostUsd: estimatedCost,
                          limits: {
                            maxCallsPerVaultDay: cfg.AUTOPILOT_AI_MAX_CALLS_PER_VAULT_DAY,
                            maxCallsGlobalDay: cfg.AUTOPILOT_AI_MAX_CALLS_GLOBAL_DAY,
                            maxUsdPerVaultDay: cfg.AUTOPILOT_AI_MAX_USD_PER_VAULT_DAY,
                            maxUsdGlobalDay: cfg.AUTOPILOT_AI_MAX_USD_GLOBAL_DAY,
                          },
                        });
                        if (s.aiBudgetDay !== reservation.day) {
                          s.aiBudgetDay = reservation.day;
                          s.aiCallsToday = 0;
                          s.aiActualCostTodayUsd = 0;
                          s.aiReservedCostTodayUsd = 0;
                        }
                        s.aiCallsToday = (s.aiCallsToday || 0) + 1;
                        s.aiReservedCostTodayUsd = (s.aiReservedCostTodayUsd || 0) + reservation.reservedCostUsd;
                        signal = await observeProvider("xai", "autopilot_compact_signal", () => runPreparedAutopilotSignal(
                          { apiKey: cfg.XAI_API_KEY, baseUrl: cfg.XAI_BASE_URL, model: cfg.GROK_AUTOPILOT_MODEL },
                          { instId: s.pair, timeframe: s.timeframe, strategyType, market, maxInputTokens: cfg.GROK_MAX_INPUT_AUTOPILOT, maxOutputTokens: cfg.GROK_MAX_OUTPUT_AUTOPILOT },
                        ));
                        const usage = signal.usage;
                        if (usage) {
                          const actualCost = usage.costUsd ?? actualAutopilotSignalCostUsd({ promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cachedTokens: usage.cachedTokens, inputUsdPerMillion: cfg.XAI_INPUT_COST_PER_MILLION_USD, cachedInputUsdPerMillion: cfg.XAI_CACHED_INPUT_COST_PER_MILLION_USD, outputUsdPerMillion: cfg.XAI_OUTPUT_COST_PER_MILLION_USD });
                          s.aiActualCostTodayUsd = (s.aiActualCostTodayUsd || 0) + actualCost;
                          recordAiUsage(usage.promptTokens, usage.completionTokens, actualCost, usage.cachedTokens, usage.reasoningTokens);
                        }
                        s.lastAiSignalAt = signal.generatedAt;
                        s.aiFailureStreak = 0;
                        s.aiRetryAt = undefined;
                        s.lastAiSignalCandleTs = signal.candleTs;
                        await cacheAutopilotSignal(s.pair, s.timeframe, signal, cfg.AUTOPILOT_AI_SIGNAL_TTL_MS);
                        s.aiSignalSource = "live";
                      } else {
                        s.aiSignalSource = "cache";
                      }
                      s.aiBudgetStatus = "ready";
                    } catch (error) {
                      if (error instanceof AutopilotAiBudgetExceededError) s.aiBudgetStatus = error.dimension;
                      else throw error;
                    } finally {
                      await releaseStrategyLease(signalLeaseId, "analysis", signalLease).catch(() => undefined);
                    }
                  }
                }
              }

              if (signal) {
                const entitlement = await consumeAutopilotPassSignal(s);
                if (!entitlement.ok) {
                  signal = null;
                  s.aiSignalSource = "deterministic";
                  s.aiBudgetStatus = entitlement.reason;
                }
              }
              if (signal) {
                const analysis = { bias: signal.signal.bias, confidence: signal.signal.confidence, regime: signal.signal.regime, keyLevels: { support: [...signal.signal.support], resistance: [...signal.signal.resistance] } };
                executionPlan = buildSpotExecutionPlan({ instId: s.pair, timeframe: s.timeframe, tier: "premium", lastPrice: market.ticker.last, analysis, technical });
                const compactReport = { analysis, executionPlan };
                decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report: compactReport, minConfidence: s.minConfidence, hasPosition: false });
                evidenceContext = { mode: "event_driven_compact_signal", signal, candidate, technical, executionPlan };
              } else {
                decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report: { analysis: neutralAnalysis }, minConfidence: s.minConfidence, hasPosition: false });
                decision = { ...decision, reason: `Hold: AI confirmation unavailable (${s.aiBudgetStatus || "unknown"}); deterministic protection remains active.` };
                evidenceContext = { mode: "cost_guard_hold", status: s.aiBudgetStatus, candidate, technical };
              }
            }
          }
        }

        const evaluationBase = { id: crypto.randomUUID(), evaluatedAt: new Date().toISOString(), strategyType, action: decision.action, reason: decision.reason, bias: decision.bias, confidence: decision.confidence, metrics: decision.metrics, rules: decision.rules };
        if (decision.action === "hold") {
          const proof = await evidence(s, {
            decision: "hold",
            evaluation: decision,
            report: evidenceContext,
          });
          s.lastDecision = `hold_${strategyType}`;
          s.lastRunAt = new Date().toISOString();
          s.evidenceUrl = proof.url;
          s.evidenceHash = proof.hash;
          s.lastError = undefined;
          await appendEvaluation(s, { ...evaluationBase, status: "held", evidenceHash: proof.hash });
          continue;
        }
        const actionLease = mode === "analysis"
          ? await acquireStrategyLease(s.id, "execution")
          : null;
        if (mode === "analysis" && !actionLease) {
          s.lastDecision = "hold_execution_in_progress";
          s.lastError = undefined;
          continue;
        }
        try {
          if (mode === "analysis") {
            [
              paused,
              version,
              nonce,
              slippage,
              maxTradeValue,
              cooldown,
              lastActionAt,
              targetBalance,
              targetDecimals,
              settlementDecimals,
              settlementBalance,
            ] = await readRuntime();
            const freshChainNow = BigInt(Math.floor(Date.now() / 1000));
            const freshReadyAt = lastActionAt + cooldown;
            cooldownRemaining = freshReadyAt > freshChainNow ? Number(freshReadyAt - freshChainNow) : 0;
            cooldownReady = cooldownRemaining === 0;
            if (paused) {
              s.lastDecision = "hold_paused";
              s.lastRunAt = new Date().toISOString();
              s.lastError = undefined;
              continue;
            }
            if (decision.action === "sell" && targetBalance === 0n) {
              s.exitPending = false;
              s.activeTakeProfit = undefined;
              s.activeStopLoss = undefined;
              s.lastDecision = "hold_position_closed";
              s.lastRunAt = new Date().toISOString();
              s.lastError = undefined;
              continue;
            }
            if (decision.action === "buy" && targetBalance > 0n) {
              s.lastDecision = "hold_position_already_open";
              s.lastRunAt = new Date().toISOString();
              s.lastError = undefined;
              continue;
            }
          }
          if (!cooldownReady) {
            if (decision.action === "sell") s.exitPending = true;
            s.lastDecision = "hold_action_cooldown";
            if (mode === "analysis") s.lastRunAt = new Date().toISOString();
            s.lastError = undefined;
            await appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: `A policy action is active; waiting ${cooldownRemaining}s for the on-chain cooldown.` });
            continue;
          }
        const price = parseUnits(executionPrice.toFixed(18), 18);
        const sellToken = decision.action === "buy" ? s.settlementAsset : s.targetAsset;
        const buyToken = decision.action === "buy" ? s.targetAsset : s.settlementAsset;
        const amount = decision.action === "buy"
          ? BigInt(s.buyAmountAtomic)
          : boundedTargetSellAmount({ targetBalance, maxTradeValue, priceE18: price, targetDecimals: Number(targetDecimals), settlementDecimals: Number(settlementDecimals) });
        if (amount <= 0n) {
          s.lastDecision = "hold_no_executable_amount";
          s.lastRunAt = new Date().toISOString();
          s.lastError = undefined;
          await appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: "The strategy exit is valid, but no target amount fits the signed per-trade cap." });
          continue;
        }
        const balance = decision.action === "buy" ? settlementBalance : targetBalance;
        if (balance < amount) {
          s.lastDecision = "hold_insufficient_vault_balance";
          s.lastRunAt = new Date().toISOString();
          s.lastError = undefined;
          await appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: `The vault balance is below the configured ${decision.action} size.` });
          continue;
        }
        const prepared = await getGenericOkxSwap(cfg, {
          chainId: String(c.id),
          fromTokenAddress: sellToken,
          toTokenAddress: buyToken,
          amount: String(amount),
          userWalletAddress: adapter!,
          slippagePercent: String(Number(slippage) / 100),
        });
        if (
          prepared.tx.to.toLowerCase() !== router!.toLowerCase() ||
          BigInt(prepared.tx.value) !== 0n
        )
          throw new Error(
            "Autopilot prepared route failed router/value policy",
          );
        const quoted = BigInt(String(prepared.quote?.toTokenAmount || "0"));
        const quoteMinimum = (quoted * (10000n - BigInt(slippage))) / 10000n;
        const oracleMinimum = minimumOracleOutput({
          action: decision.action,
          sellAmount: amount,
          priceE18: price,
          targetDecimals: Number(targetDecimals),
          settlementDecimals: Number(settlementDecimals),
          slippageBps: BigInt(slippage),
        });
        if (quoted < oracleMinimum) throw new Error("The live route is below the vault oracle minimum; the latched action will retry with a fresh quote");
        const minOut = quoteMinimum > oracleMinimum ? quoteMinimum : oracleMinimum;
        const proof = await evidence(s, {
          decision: decision.action,
          evaluation: decision,
          report: evidenceContext,
          quote: prepared.quote,
          quoteMinimum: String(quoteMinimum),
          oracleMinimum: String(oracleMinimum),
          enforcedMinimum: String(minOut),
          policyHash: keccak256(toHex(JSON.stringify(s.policy))),
        });
        const priceTx = await walletClient.writeContract({
          address: oracle as `0x${string}`,
          abi: oracleAbi,
          functionName: "setPrice",
          args: [
            s.targetAsset as `0x${string}`,
            s.settlementAsset as `0x${string}`,
            price,
            300n,
          ],
        });
        const priceReceipt = await publicClient.waitForTransactionReceipt({ hash: priceTx });
        if (priceReceipt.status !== "success") throw new Error("Autopilot oracle price update reverted");
        await recordV6Activity({
          owner: s.owner,
          network: s.network,
          source: "autopilot",
          kind: "oracle_price_update",
          status: "confirmed",
          txHash: priceTx,
          account: oracle,
          pair: s.pair,
          amount: String(price),
        });
        const decisionId = keccak256(
          toHex(`${s.id}:${version}:${nonce}:${Date.now()}`),
        );
        const adapterData = encodeFunctionData({
          abi: adapterAbi,
          functionName: "execute",
          args: [
            router as `0x${string}`,
            spender as `0x${string}`,
            sellToken as `0x${string}`,
            buyToken as `0x${string}`,
            amount,
            minOut,
            prepared.tx.data as `0x${string}`,
          ],
        });
        const simulation = await publicClient.simulateContract({
          address: vault,
          abi: vaultReadAbi,
          functionName: "execute",
          args: [
            decisionId,
            version,
            nonce,
            adapter as `0x${string}`,
            sellToken as `0x${string}`,
            buyToken as `0x${string}`,
            amount,
            minOut,
            adapterData,
            proof.hash,
          ],
          account: walletClient.account,
        });
        const txHash = await walletClient.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        if (receipt.status !== "success")
          throw new Error("Autopilot execution reverted");
        const partialExit = decision.action === "sell" && amount < targetBalance;
        s.lastDecision = partialExit ? "sell_partial_filled" : `${decision.action}_filled`;
        s.lastRunAt = new Date().toISOString();
        s.lastRiskCheckAt = new Date().toISOString();
        s.lastTxHash = txHash;
        s.evidenceUrl = proof.url;
        s.evidenceHash = proof.hash;
        s.lastError = undefined;
        if (decision.action === "buy") {
          s.exitPending = false;
          s.activeTakeProfit = Number(executionPlan!.buy.takeProfit) || undefined;
          s.activeStopLoss = Number(executionPlan!.buy.stopLoss) || undefined;
        } else {
          s.exitPending = partialExit;
          if (!partialExit) {
            s.activeTakeProfit = undefined;
            s.activeStopLoss = undefined;
          }
        }
        await appendEvaluation(s, { ...evaluationBase, status: "filled", evidenceHash: proof.hash, txHash });
        await recordV6Activity({
          owner: s.owner,
          network: s.network,
          source: "autopilot",
          kind: s.lastDecision,
          status: "confirmed",
          txHash,
          account: s.vault,
          pair: s.pair,
          amount: String(amount),
        });
        } finally {
          if (actionLease) await releaseStrategyLease(s.id, "execution", actionLease).catch(() => undefined);
        }
      } catch (error) {
        const detail = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 500);
        const transient = /rate limit|429|timeout|timed out|aborted|fetch failed|network|rpc request failed|temporarily unavailable/i.test(detail);
        if (aiAttemptedThisCycle) {
          s.aiFailureStreak = (s.aiFailureStreak || 0) + 1;
          s.aiRetryAt = new Date(nextAutopilotAiRetryAt({
            now: Date.now(),
            minimumIntervalMs: cfg.AUTOPILOT_AI_MIN_INTERVAL_MS,
            failureStreak: s.aiFailureStreak,
            error: detail,
          })).toISOString();
          s.aiNextEligibleAt = s.aiRetryAt;
          s.aiBudgetStatus = /\b401\b|\b402\b|\b403\b|permission[- ]denied|credits|spending limit|billing|quota/i.test(detail)
            ? "provider_billing_blocked"
            : "provider_backoff";
        }
        s.lastError = detail;
        s.lastDecision = transient
          ? "hold_dependency_retry"
          : "hold_failed_closed";
        if (analysisAttempted) s.lastRunAt = new Date().toISOString();
        await appendEvaluation(s, {
          id: crypto.randomUUID(),
          evaluatedAt: new Date().toISOString(),
          strategyType: s.strategyType || identifyAutopilotStrategy(s.policy.strategy),
          action: "hold",
          status: "failed",
          reason: transient
            ? "A temporary dependency was unavailable. No assets moved; the scheduler will retry automatically."
            : "The evaluation or protected execution failed closed. No assets moved.",
          bias: "unknown",
          confidence: 0,
          metrics: {},
          rules: [],
          error: s.lastError,
        });
      } finally {
        s.updatedAt = new Date().toISOString();
        await releaseStrategyLease(s.id, leaseScope, lease).catch(() => undefined);
      }
    }
    await save(items, "runtime");
  }
}
export function startAutopilotAutomation(cfg: AppConfig) {
  if (process.env.AUTOMATION_WORKER_ENABLED !== "1") return () => {};
  const run = () =>
    void runAutopilotCycle(cfg).catch((error) => {
      if (!isKvUnavailableError(error)) console.error("autopilot cycle failed", error);
    });
  const timer = setInterval(run, 60_000);
  timer.unref();
  run();
  return () => clearInterval(timer);
}
