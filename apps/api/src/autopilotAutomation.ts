import { Router } from "express";
import { readAutopilotConfiguration } from "./autopilotConfiguration.js";
import { z } from "zod";
import {
  createWalletClient,
  encodeFunctionData,
  fallback,
  http,
  keccak256,
  parseUnits,
  parseAbi,
  toHex,
  verifyMessage,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { put } from "@vercel/blob";
import { opportunityUniverse } from "./opportunityUniverse.js";
import { buildMarketContext, listSpotInstruments } from "@pulse/market";
import { isRobinhoodMarket, assertExecutionMarketIdentity, verifyRobinhoodMarketBinding, executionSettlementTicker, executionMarketContext, robinhoodAutopilotContext, resolveRobinhoodMarket } from "./robinhoodMarkets.js";
import { assertArcExecutionBinding, arcOkxMarketContext, assertArcAutomationHistory, assertArcOkxMarketData, assertArcOkxTicker } from "./arcMarkets.js";
import { buildSpotExecutionPlan, buildTechnicalStructure, runPreparedAutopilotSignal, type AutopilotSignalResult } from "@pulse/analysis";
import type { AppConfig } from "@pulse/config";
import { arcAutomationReadiness } from "./arcExecutionReadiness.js";
import { isKvUnavailableError, kvCircuitStatus, kvConfigured, runKvCommand } from "./resilientKv.js";
import { persistJournalRow, readJournal } from "./autopilotJournal.js";
import { asyncRoute } from "./httpResilience.js";
import { analysisSymbolForExecutionToken, getOkxTradeTokens, getGenericOkxQuote, getGenericOkxSwap, betterGenericOkxExitSwap } from "./okxDex.js";
import { listV6Activity, recordV6Activity, confirmV6Activity, failV6Activity, reconcileV6Activity } from "./v6Store.js";
import { autopilotExecutionFailure, pendingAutopilotTrade, verifiedAutopilotReceipt, type AutopilotExecutionPhase } from "./autopilotExecutionRecovery.js";
import { ArcAutopilotOutbox, type PendingArcAutopilotTrade } from "./arcAutopilotOutbox.js";
import { cashFlowCoverage, readCashFlowCheckpoint, runCashFlowRecoveryCycle } from "./autopilotCashFlows.js";
import { normaliseRouteSymbol } from "./tradeAutomation.js";
import { executionPublicClient, executionRpcUrls } from "./onchainDiscovery.js";
import { executionContractAddress } from "./executionContracts.js";
import { executionSignerKey, hasExecutionSigner } from "./executionSigner.js";
import { assertAutopilotStorageReady, getAutopilotPass, mutateAutopilotPass, consumePassSignal, extendAutopilotPass, synchronizeAutopilotPassPause, autopilotPassRemainingMs, type AutopilotPass } from "./autopilotPassStore.js";
export { getAutopilotPass, autopilotPassRemainingMs, type AutopilotPass } from "./autopilotPassStore.js";
import { AUTOPILOT_STRATEGY_CATALOG, boundedTargetSellAmount, evaluateAutopilotEntryCandidate, evaluateAutopilotPolicy, evaluateAutopilotRiskExit, identifyAutopilotStrategy, minimumOracleOutput, type AutopilotRuleResult, type AutopilotStrategyType } from "./autopilotPolicy.js";
import { AUTOPILOT_STRATEGY_HASH_KEY, currentAutopilotAiUsage, cashFlowAdjustedPnl, decodeStrategyHash, deriveAutopilotRuntimeState, mergeStrategyRuntime, reconcileAutopilotLifetimeStats, reconcileStrategyExecution } from "./autopilotStrategyStore.js";
import { AutopilotAiBudgetExceededError, actualAutopilotSignalCostUsd, estimatedAutopilotSignalCostUsd, reserveAutopilotAiBudget } from "./autopilotAiBudget.js";
import { observeProvider, recordAiUsage } from "./telemetry.js";
import { deliverTelegramReportDurably } from "./telegram.js";
import { boundedBuyAmount, valuedPositionBalance } from "./autopilotPolicy.js";
import { validateRobinhoodSwap } from "./robinhoodFunding.js";
import { validateArcSwap } from "./arcSwap.js";
import { arcExecutionFees } from "./arcExecutionFees.js";
import { robinhoodAutomationReadiness } from "./robinhoodExecutionReadiness.js";

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
  context?: { pair?: string; signalMarket?: string; strategyType?: string; timeframe: string; candleClosedAt?: string; aiSource?: string; aiStatus?: string; nextAiEligibleAt?: string; minConfidence: number; maxTradePct: number; dailyLossPct: number };
  rules: AutopilotRuleResult[];
  evidenceHash?: string;
  txHash?: string;
  error?: string;
};

type Network = import("./executionContracts.js").ExecutionNetwork;
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
    signalMarket?: string;
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
  riskCheckCount?: number;
  sameCandleSkipCount?: number;
  lastDecision?: string;
  lastError?: string;
  lastTxHash?: string;
  evidenceUrl?: string;
  evidenceHash?: string;
  baselineValueAtomic?: string;
  baselineBlockNumber?: string;
  configurationHash?: string;
  exitPending?: boolean;
  entryQuoteRetryPending?: boolean;
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
  evaluationPending?: StrategyEvaluation[];
  evaluationJournalError?: string;
};
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const NATIVE_TOKEN = /^0x[eE]{40}$/;
const Erc20AddressSchema = z.string().regex(ADDRESS).refine((value) => !NATIVE_TOKEN.test(value), "Autopilot assets must be ERC-20 contracts; use the wrapped native asset");
const configs = {
  arc: {
    id: 5042,
    rpc: () => process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io",
    rpcFallback: () => process.env.ARC_RPC_FALLBACK_URL || "https://rpc.quicknode.mainnet.arc.io",
    oracle: () => executionContractAddress("arc", "oracleRouter"),
    adapter: () => executionContractAddress("arc", "executionAdapter"),
    router: () => executionContractAddress("arc", "okxRouter"),
    spender: () => executionContractAddress("arc", "okxApproval"),
    factory: () => executionContractAddress("arc", "autopilotFactory"),
  },
  robinhood: {
    id: 4663,
    rpc: () => process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    rpcFallback: () => process.env.ROBINHOOD_RPC_FALLBACK_URL || "https://rpc.mainnet.chain.robinhood.com",
    oracle: () => executionContractAddress("robinhood", "oracleRouter"),
    adapter: () => executionContractAddress("robinhood", "executionAdapter"),
    router: () => executionContractAddress("robinhood", "okxRouter"),
    spender: () => executionContractAddress("robinhood", "okxApproval"),
    factory: () => executionContractAddress("robinhood", "autopilotFactory"),
  },
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
    rpcFallback: () => process.env.BASE_RPC_FALLBACK_URL || "https://base-rpc.publicnode.com",
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
  network: z.enum(["xlayer", "base", "arbitrum", "robinhood", "arc"]),
  vault: z.string().regex(ADDRESS),
  settlementAsset: Erc20AddressSchema,
  targetAsset: Erc20AddressSchema,
  pair: z.string().regex(/^[A-Z0-9._-]{3,64}$/),
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
    signalMarket: z.string().max(64).optional(),
  }),
  authorization: z.object({
    expiresAt: z.number().int().positive(),
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  }),
});
const StrategyPreflightSchema = z.object({
  network: z.enum(["xlayer", "base", "arbitrum", "robinhood", "arc"]),
  settlementAsset: Erc20AddressSchema,
  targetAsset: Erc20AddressSchema,
  pair: z.string().regex(/^[A-Z0-9._-]{3,64}$/),
  timeframe: z.enum(["15m", "1H", "4H", "1D"]).optional(),
  amountAtomic: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  maxTradeValueAtomic: z.string().regex(/^\d+$/).refine(value => BigInt(value) > 0n).optional(),
  maxSlippageBps: z.number().int().min(0).max(1000).default(100),
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
export const AUTOPILOT_ANALYSIS_MIN_INTERVAL_MS = 15 * 60_000;
export const AUTOPILOT_PROVIDER_BLOCK_BACKOFF_MS = 6 * 60 * 60_000;


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
export async function autopilotPassTargetExists(input: { owner: string; network: Network; vault: string }) {
  await assertAutopilotStorageReady();
  return (await list(false)).some((item) => {
    if (item.network !== input.network || item.vault.toLowerCase() !== input.vault.toLowerCase()
      || item.owner.toLowerCase() !== input.owner.toLowerCase()) return false;
    if (item.network === "arc") {
      try { assertArcExecutionBinding(item.pair, item.targetAsset, item.settlementAsset); }
      catch { return false; }
    }
    return true;
  });
}
async function saveAutopilotPass(value: AutopilotPass) {
  // Notification acknowledgements never overwrite entitlement or timer fields.
  await mutateAutopilotPass(value.network, value.vault, current => current && current.purchasedAt === value.purchasedAt
    ? { ...current, expiryWarningSentAt: value.expiryWarningSentAt, expiredNoticeSentAt: value.expiredNoticeSentAt } : current);
}
export async function grantAutopilotPass(input: { owner: string; network: Network; vault: string; days: 1 | 7 | 30; telegramDelivery?: string; paymentId?: string }) {
  const strategy = (await list(false)).find((item) => item.network === input.network && item.vault.toLowerCase() === input.vault.toLowerCase() && item.owner.toLowerCase() === input.owner.toLowerCase());
  if (!strategy) throw new Error("The selected vault is not a registered Autopilot owned by this wallet on the selected network");
  if (strategy.network === "arc") assertArcExecutionBinding(strategy.pair, strategy.targetAsset, strategy.settlementAsset);
  const { publicClient } = clients(input.network);
  const paused = await publicClient.readContract({ address: input.vault as `0x${string}`, abi: vaultReadAbi, functionName: "paused" });
  const now = Date.now();
  const value = await mutateAutopilotPass(input.network, input.vault, existing => extendAutopilotPass(existing, { ...input, paused: Boolean(paused) }, now));
  strategy.lastEvaluatedCandleTs = undefined;
  strategy.lastRunAt = undefined;
  strategy.aiBudgetStatus = "ready";
  strategy.updatedAt = new Date().toISOString();
  // The durable entitlement is authoritative even if a telemetry reset fails.
  try { await save((await list(false)).map((item) => item.id === strategy.id ? strategy : item), "runtime"); }
  catch { /* A failed telemetry refresh must not turn a saved pass into a failed checkout. */ }
  return value;
}
async function consumeAutopilotPassSignal(strategy: Strategy, signal: AutopilotSignalResult) {
  const now = Date.now();
  let reason = "";
  const value = await mutateAutopilotPass(strategy.network, strategy.vault, current => {
    const consumed = consumePassSignal(current, strategy.owner, `${strategy.pair}:${strategy.timeframe}:${signal.generatedAt}:${signal.candleTs}`, now);
    reason = consumed.reason;
    return consumed.pass;
  });
  return reason ? { ok: false as const, reason, pass: value } : { ok: true as const, pass: value };
}
const POTENTIAL_GAINER_PAIRS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "DOGE-USDT", "XRP-USDT", "ADA-USDT", "LTC-USDT", "PEPE-USDT", "SHIB-USDT", "WIF-USDT", "TURBO-USDT", "MOODENG-USDT"];
const potentialGainerCache = new Map<string, { expiresAt: number; value: unknown[] }>();
const potentialGainerInflight = new Map<string, Promise<unknown[]>>();

async function scanPotentialGainers(timeframe: "15m" | "1H" | "4H" | "1D", cfg: AppConfig, network: "xlayer" | "base" | "arbitrum" | "arc", erc20: boolean) {
  const cacheKey = `${network}:${erc20 ? "erc20" : "wallet"}:${timeframe}`;
  const cached = potentialGainerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (kvConfigured()) {
    const persisted = await kv(["GET", `pulse:v6:autopilot:potential-gainers:v2:${cacheKey}`]).catch(() => null);
    if (typeof persisted === "string") {
      try {
        const value = JSON.parse(persisted) as unknown[];
        potentialGainerCache.set(cacheKey, { value, expiresAt: Date.now() + 60_000 });
        return value;
      } catch {
        // Rebuild an invalid cache entry from authoritative OKX candles.
      }
    }
  }
  const pending = potentialGainerInflight.get(cacheKey);
  if (pending) return pending;
  const request = (async () => {
    const chainId = String(configs[network].id);
    const [tokens, instruments] = await Promise.all([getOkxTradeTokens(cfg, chainId, "", 5000), listSpotInstruments(5000)]);
    const universe = opportunityUniverse({ chainId, erc20, tokens, instruments, researchPairs: POTENTIAL_GAINER_PAIRS });
    const scanPairs = universe.pairs;
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < scanPairs.length; offset += 3) {
      const batch = scanPairs.slice(offset, offset + 3);
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
          return { pair, timeframe, score: Math.min(99, best.score), strategyType: best.id, technicalReady: best.ready, reason: best.reason, mark: market.ticker.last, change24hPct: market.ticker.change24hPct, rsi14: metrics.rsi14, volumeRatio: metrics.volumeRatio, fetchedAt: market.fetchedAt, priceHistory: market.candles.slice(-48).map(candle => candle.close) };
        } catch {
          return null;
        }
      }));
      rows.push(...results.filter((row): row is NonNullable<typeof row> => row !== null));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    // Keep the full scan so network filtering cannot hide supported pairs that
    // ranked below research-only assets in a global top-eight list.
    const value = rows.sort((a, b) => Number(b.technicalReady) - Number(a.technicalReady) || Number(b.score) - Number(a.score));
    potentialGainerCache.set(cacheKey, { value, expiresAt: Date.now() + 5 * 60_000 });
    if (kvConfigured()) await kv(["SET", `pulse:v6:autopilot:potential-gainers:v2:${cacheKey}`, JSON.stringify(value), "EX", 300]).catch(() => undefined);
    return value;
  })().finally(() => potentialGainerInflight.delete(cacheKey));
  potentialGainerInflight.set(cacheKey, request);
  return request;
}
async function list(allowCached = true) {
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
    if (allowCached && isKvUnavailableError(error) && memory.length) return memory;
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
  memory = [...new Map([...current, ...merged].map(item => [item.id, item])).values()].slice(-500);
}
function clients(network: Network, key?: `0x${string}`) {
  const c = configs[network];
  const urls = executionRpcUrls(network);
  const chain = {
    id: c.id,
    name: network,
    nativeCurrency: {
      name: "Native",
      symbol: network === "xlayer" ? "OKB" : network === "arc" ? "USDC" : "ETH",
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
  { type: "function", name: "exposureCap", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
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
    name: "name",
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
async function verifyStrategy(input: z.infer<typeof StrategySchema>, cfg: AppConfig) {
  assertExecutionMarketIdentity(input.network, input.pair);
  if (input.network === "arc") assertArcExecutionBinding(input.pair, input.targetAsset, input.settlementAsset);
  if (input.network === "arc" && input.policy.signalMarket && input.policy.signalMarket !== input.pair)
    throw new Error("Arc strategy signals must use the selected OKX research market");
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
  const [owner, settlement, policyHash, allowed, factoryVaults, targetSymbol, settlementSymbol, targetName, settlementName] = await publicClient.multicall({ contracts: [
    { address, abi: vaultReadAbi, functionName: "owner" },
    { address, abi: vaultReadAbi, functionName: "settlementAsset" },
    { address, abi: vaultReadAbi, functionName: "policyHash" },
    { address, abi: vaultReadAbi, functionName: "allowedAssets", args: [input.targetAsset as `0x${string}`] },
    { address: factory as `0x${string}`, abi: vaultFactoryAbi, functionName: "vaultsOf", args: [input.owner as `0x${string}`] },
    { address: input.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
    { address: input.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
    { address: input.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "name" },
    { address: input.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "name" },
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
  const normalizeForChain = (symbol: string, name: string) => normaliseRouteSymbol(analysisSymbolForExecutionToken(symbol, String(configs[input.network].id), name));
  if (input.network === "robinhood" && isRobinhoodMarket(input.pair)) {
    await verifyRobinhoodMarketBinding(cfg, input.pair, input.targetAsset, input.settlementAsset);
    const binding = await resolveRobinhoodMarket(cfg, input.pair);
    if (input.policy.signalMarket && ![input.pair, ...binding.researchPairs].includes(input.policy.signalMarket))
      throw new Error("Signed signal market is not verified for this Robinhood contract");
  } else if (!base || !quote || extra || normalizeForChain(targetSymbol, targetName) !== normaliseRouteSymbol(base) || normalizeForChain(settlementSymbol, settlementName) !== normaliseRouteSymbol(quote))
    throw new Error(`On-chain tokens ${targetSymbol}/${settlementSymbol} do not match ${input.pair}`);
  if (keccak256(toHex(JSON.stringify(input.policy))) !== policyHash)
    throw new Error(
      "Strategy policy does not match the owner-committed on-chain policy hash",
    );
}
export function createAutopilotAutomationRouter(cfg: AppConfig) {
  const router = Router();
  router.get("/v1/autopilot/market-readiness", asyncRoute(async (req, res) => {
    const parsed = z.object({ network: z.enum(["robinhood", "arc"]), pair: z.string().max(64), timeframe: z.enum(["15m", "1H", "4H", "1D"]), alternatives: z.enum(["1"]).optional() }).safeParse(req.query);
    if (!parsed.success || (parsed.data.network === "arc" ? !["BTC-USDT", "ETH-USDT"].includes(parsed.data.pair) : !isRobinhoodMarket(parsed.data.pair))) return res.status(400).json({ error: "Choose a supported market and timeframe" });
    const { network, pair, timeframe, alternatives } = parsed.data;
    const check = async (value: string) => {
      try {
        if (network === "arc") {
          const market = await arcOkxMarketContext({ instId: pair, timeframe: value, candleLimit: 120, completedOnly: true });
          assertArcAutomationHistory(market.candles, value);
          return { timeframe: value, ready: true, signalMarket: pair, signalSource: "okx-public-spot", reason: "Live OKX reference data and completed history are available. Live entry, exit and wallet checks still run before setup." };
        }
        const context = await robinhoodAutopilotContext(cfg, { instId: pair, timeframe: value });
        return { timeframe: value, ready: true, signalMarket: context.signalMarket, signalSource: context.signalSource,
          reason: context.signalSource === "verified-reference" ? `Signals use verified ${context.signalMarket} history. Trades and protection use the actual Robinhood token/USDG price. This source is included in your signed policy.` : "Token DEX strategy history is available. Route and wallet checks still run before setup." };
      } catch (error) {
        return { timeframe: value, ready: false, reason: error instanceof Error ? error.message : "Market history is temporarily unavailable" };
      }
    };
    const selected = await check(timeframe);
    const other = alternatives === "1" ? await Promise.all(["15m", "1H", "4H", "1D"].filter(value => value !== timeframe).map(check)) : [];
    res.setHeader("Cache-Control", "no-store");
    return res.json({ pair, ...selected, alternatives: other, walletTransactionsSent: false });
  }));
  router.post("/v1/autopilot/readiness", asyncRoute(async (_req, res) => {
    await assertAutopilotStorageReady();
    res.setHeader("Cache-Control", "no-store");
    res.json({ ready: true });
  }));
  router.get("/v1/autopilot/configuration", asyncRoute(async (req, res) => {
    const parsed = z.object({ network: z.enum(["xlayer", "base", "arbitrum", "robinhood", "arc"]), vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/), asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Select a valid network, vault and asset" });
    res.setHeader("Cache-Control", "no-store");
    const { network, vault, asset } = parsed.data;
    res.json({ configuration: await readAutopilotConfiguration(network, vault as `0x${string}`, asset as `0x${string}`) });
  }));
  const potentialGainersHandler = asyncRoute(async (req, res) => {
    const parsed = z.enum(["15m", "1H", "4H", "1D"]).safeParse(String(req.query.timeframe || "1H"));
    if (!parsed.success) return res.status(400).json({ error: "timeframe must be 15m, 1H, 4H or 1D" });
    const network = z.enum(["xlayer", "base", "arbitrum", "arc"]).safeParse(req.query.network || "xlayer");
    if (!network.success) return res.status(400).json({ error: "Select a supported execution network" });
    const candidates = await scanPotentialGainers(parsed.data, cfg, network.data, req.query.custody === "erc20");
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
    res.json({ candidates, methodology: "Read-only OKX candle prefilter. Score is not a forecast or trading authorization. Global research and Autopilot setup are separate workflows; selected-network route validation is always required.", premiumRequired: false, routeCheckedAfterSelection: true });
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
      let signalMarket: string | undefined;
      let settlementMark: number | undefined;
      assertExecutionMarketIdentity(network, pair);
      if (network === "arc") assertArcExecutionBinding(pair, targetAsset, settlementAsset);
      if (network === "robinhood") {
        const readiness = await robinhoodAutomationReadiness(cfg);
        if (!readiness.ready) throw new Error(readiness.reason);
      }
      const { publicClient } = clients(network);
      const [settlementCode, targetCode, metadata] = await Promise.all([
        publicClient.getCode({ address: settlementAsset as `0x${string}` }),
        publicClient.getCode({ address: targetAsset as `0x${string}` }),
        publicClient.multicall({ allowFailure: false, contracts: [
          { address: targetAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
          { address: settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
          { address: targetAsset as `0x${string}`, abi: erc20Abi, functionName: "name" },
          { address: settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "name" },
          { address: targetAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
          { address: settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
        ] }),
      ]);
      if (!settlementCode || settlementCode === "0x" || !targetCode || targetCode === "0x")
        throw new Error("The selected Autopilot route contains a non-contract token representation");
      const [targetSymbol, settlementSymbol, targetName, settlementName] = metadata.map(String);
      const [base, quote, extra] = pair.toUpperCase().split("-");
      const normalizeForChain = (symbol: string, name: string) => normaliseRouteSymbol(analysisSymbolForExecutionToken(symbol, String(configs[network].id), name));
      if (network === "arc") {
        if (!parsed.data.timeframe) throw new Error("Choose the Arc Autopilot timeframe before setup");
        const market = await arcOkxMarketContext({ instId: pair, timeframe: parsed.data.timeframe, candleLimit: 120, completedOnly: true });
        signalMarket = market.instId;
        settlementMark = market.ticker.last;
      }
      if (network === "robinhood" && isRobinhoodMarket(pair)) {
        await verifyRobinhoodMarketBinding(cfg, pair, targetAsset, settlementAsset);
        if (!parsed.data.timeframe) throw new Error("Choose the Robinhood Autopilot timeframe before setup");
        const context = await robinhoodAutopilotContext(cfg, { instId: pair, timeframe: parsed.data.timeframe });
        signalMarket = context.signalMarket;
        settlementMark = context.settlementTicker.last;
      } else if (!base || !quote || extra || normalizeForChain(targetSymbol, targetName) !== normaliseRouteSymbol(base) || normalizeForChain(settlementSymbol, settlementName) !== normaliseRouteSymbol(quote))
        throw new Error(`Contract route ${targetSymbol}/${settlementSymbol} does not represent ${pair}`);
      const entryQuote = await getGenericOkxQuote(cfg, { chainId: String(configs[network].id), fromTokenAddress: settlementAsset, toTokenAddress: targetAsset, amount: amountAtomic });
      if (settlementMark !== undefined) {
        const price = parseUnits(settlementMark.toFixed(18), 18);
        const targetDecimals = Number(metadata[4]), settlementDecimals = Number(metadata[5]);
        const slippageBps = BigInt(parsed.data.maxSlippageBps);
        const entryMinimum = minimumOracleOutput({ action: "buy", sellAmount: BigInt(amountAtomic), priceE18: price, targetDecimals, settlementDecimals, slippageBps });
        if (BigInt(entryQuote.toTokenAmount) < entryMinimum) throw new Error("The current entry route is outside the selected vault tolerance. No funding or payment was requested.");
        const exitAmount = boundedTargetSellAmount({ targetBalance: BigInt(entryQuote.toTokenAmount), maxTradeValue: BigInt(parsed.data.maxTradeValueAtomic || amountAtomic), priceE18: price, targetDecimals, settlementDecimals });
        if (exitAmount <= 0n) throw new Error("The selected trade size has no cap-compliant exit amount");
        const exitQuote = await getGenericOkxQuote(cfg, { chainId: String(configs[network].id), fromTokenAddress: targetAsset, toTokenAddress: settlementAsset, amount: String(exitAmount) });
        const exitMinimum = minimumOracleOutput({ action: "sell", sellAmount: exitAmount, priceE18: price, targetDecimals, settlementDecimals, slippageBps });
        if (BigInt(exitQuote.toTokenAmount) <= 0n || BigInt(exitQuote.toTokenAmount) < exitMinimum)
          throw new Error("The current sell route is outside the selected vault tolerance. No funding or payment was requested. A listed market still needs a guard-compliant exit route at your trade size.");
      }
      res.json({ ready: true, pair, executionPair: `${targetSymbol}/${settlementSymbol}`, targetAsset, settlementAsset, signalMarket });
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
      let passError: unknown;
      let aiPass = await getAutopilotPass(strategy.network, strategy.vault).catch(error => { passError = error; return null; });
      // History is independent of today's RPC/ticker availability.
      const history = await readJournal(strategy, kvConfigured() ? kv : undefined);
      const evaluations = history.rows;
      const networkActivity = activityByNetwork.get(strategy.network) || [];
      const lifetime = reconcileAutopilotLifetimeStats(strategy, networkActivity, evaluations);
      const historyView = { ...lifetime, ...currentAutopilotAiUsage(strategy), evaluations, journalStorage: history.storage,
        evaluationHistoryComplete: lifetime.evaluationHistoryComplete && history.storage !== "unavailable" };
      try {
        if (passError) throw passError;
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
          executionSettlementTicker(cfg, strategy.pair),
        ]);
        const [settlementBalance, targetBalance, settlementDecimals, targetDecimals, settlementSymbol, targetSymbol, paused] = chainState;
        if (aiPass) aiPass = await synchronizeAutopilotPassPause(aiPass, Boolean(paused), Date.now());
        const price = parseUnits(ticker.last.toFixed(18), 18);
        const portfolioValueAtomic = settlementBalance + targetBalance * price * (10n ** BigInt(settlementDecimals)) / (10n ** BigInt(targetDecimals)) / 10n ** 18n;
        const baseline = BigInt(strategy.baselineValueAtomic || "0");
        // PnL uses the independent chain-backed ledger, not browser-announced
        // activity. Never combine both sources: the same transfer may be in each.
        const checkpoint = await readCashFlowCheckpoint(strategy).catch(() => null);
        let pnlCashFlow = cashFlowCoverage(checkpoint, strategy.settlementAsset);
        let pnl: ReturnType<typeof cashFlowAdjustedPnl> = { contributionsAtomic: 0n, withdrawalsAtomic: 0n, netCashFlowAtomic: 0n, pnlBasisAtomic: baseline, pnlAtomic: null, pnlPct: null };
        let pnlAsOf: string | undefined;
        if (checkpoint && pnlCashFlow.state === "synced") {
          try {
            const blockNumber = BigInt(checkpoint.throughBlock);
            const checkpointBlock = await publicClient.getBlock({ blockNumber });
            if (checkpointBlock.hash !== checkpoint.throughHash) throw new Error("Accounting checkpoint changed");
            // Match balances and cash flows at the same block. Live balances above
            // still govern controls; historical accounting never pauses/resumes a pass.
            const [cash, invested] = await Promise.all([
              publicClient.readContract({ blockNumber, address: strategy.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [strategy.vault as `0x${string}`] }),
              publicClient.readContract({ blockNumber, address: strategy.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [strategy.vault as `0x${string}`] }),
            ]);
            const accountingValue = cash + invested * price * (10n ** BigInt(settlementDecimals)) / (10n ** BigInt(targetDecimals)) / 10n ** 18n;
            pnl = cashFlowAdjustedPnl(accountingValue, baseline, checkpoint.flows);
            pnlAsOf = new Date(Number(checkpointBlock.timestamp) * 1000).toISOString();
          } catch { pnlCashFlow = { state: "stale", progressPct: 100, detail: "The accounting checkpoint could not be verified. Live owner controls remain available." }; }
        }
        const policyBalance = valuedPositionBalance(targetBalance, price, Number(targetDecimals), Number(settlementDecimals));
        const reconciled = { ...reconcileStrategyExecution(strategy, networkActivity, policyBalance), ...historyView, hasResidualDust: targetBalance > 0n && policyBalance === 0n };
        const runtimeState = deriveAutopilotRuntimeState({ configuredStatus: reconciled.status, paused: Boolean(paused), targetBalance: policyBalance, pass: aiPass });
        return { ...reconciled, registrationStatus: reconciled.status, runtimeState, aiPass, paused, settlementBalance: String(settlementBalance), targetBalance: String(targetBalance), settlementDecimals: Number(settlementDecimals), targetDecimals: Number(targetDecimals), settlementSymbol, targetSymbol, portfolioValueAtomic: String(portfolioValueAtomic), markPrice: ticker.last, pnlCashFlow, pnlAsOf, contributionsAtomic: pnlCashFlow.state === "synced" ? String(pnl.contributionsAtomic) : undefined, withdrawalsAtomic: pnlCashFlow.state === "synced" ? String(pnl.withdrawalsAtomic) : undefined, netCashFlowAtomic: pnlCashFlow.state === "synced" ? String(pnl.netCashFlowAtomic) : undefined, pnlBasisAtomic: String(pnl.pnlBasisAtomic), pnlAtomic: pnl.pnlAtomic == null ? null : String(pnl.pnlAtomic), pnlPct: pnl.pnlPct };
      } catch (error) {
        return { ...strategy, ...historyView, registrationStatus: strategy.status, runtimeState: "telemetry_unavailable" as const, aiPass, passUnavailable: Boolean(passError), telemetryError: error instanceof Error ? error.message : String(error) };
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
      await assertAutopilotStorageReady();
      await verifyStrategy(parsed.data, cfg);
      const items = await list();
      const id = `${parsed.data.network}:${parsed.data.vault.toLowerCase()}`;
      const previous = items.find((s) => s.id === id);
      const now = new Date().toISOString();
      const { authorization: _authorization, ...authorizedStrategy } = parsed.data;
      const configurationHash = keccak256(toHex(JSON.stringify(authorizedStrategy)));
      const { publicClient } = clients(parsed.data.network);
      const balanceBlock = await publicClient.getBlockNumber();
      const [settlementBalance, targetBalance, settlementDecimals, targetDecimals] = await Promise.all([
        publicClient.readContract({ blockNumber: balanceBlock, address: parsed.data.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [parsed.data.vault as `0x${string}`] }),
        publicClient.readContract({ blockNumber: balanceBlock, address: parsed.data.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [parsed.data.vault as `0x${string}`] }),
        publicClient.readContract({ address: parsed.data.settlementAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
        publicClient.readContract({ address: parsed.data.targetAsset as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
      ]);
      // An empty target position needs no market dependency to value its deposit.
      const ticker = targetBalance > 0n ? await executionSettlementTicker(cfg, parsed.data.pair) : { last: 0 };
      const baselinePrice = parseUnits(ticker.last.toFixed(18), 18);
      const baselineValue = settlementBalance + targetBalance * baselinePrice * (10n ** BigInt(settlementDecimals)) / (10n ** BigInt(targetDecimals)) / 10n ** 18n;
      const strategy: Strategy = {
        ...previous,
        ...authorizedStrategy,
        id,
        configurationHash,
        ...(previous?.configurationHash !== configurationHash ? { lastEvaluatedCandleTs: undefined, lastRunAt: undefined } : {}),
        exitPending:
          previous?.configurationHash === configurationHash
            ? previous.exitPending
            : false,
        strategyType: parsed.data.strategyType || previous?.strategyType || identifyAutopilotStrategy(parsed.data.policy.strategy),
        status: "active",
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        baselineValueAtomic: previous?.baselineValueAtomic || String(baselineValue),
        baselineBlockNumber: previous ? previous.baselineBlockNumber : String(balanceBlock),
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
async function appendEvaluation(strategy: Strategy, evaluation: StrategyEvaluation) {
  evaluation.context = {
    pair: strategy.pair,
    signalMarket: strategy.policy.signalMarket || strategy.pair,
    strategyType: strategy.strategyType,
    timeframe: strategy.timeframe,
    candleClosedAt: strategy.lastEvaluatedCandleTs ? new Date(strategy.lastEvaluatedCandleTs).toISOString() : undefined,
    aiSource: strategy.aiSignalSource,
    aiStatus: strategy.aiBudgetStatus,
    nextAiEligibleAt: strategy.aiNextEligibleAt,
    minConfidence: strategy.minConfidence,
    maxTradePct: strategy.policy.maxTradePct,
    dailyLossPct: strategy.policy.dailyLossPct,
  };
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
  await persistJournalRow(strategy, evaluation, kvConfigured() ? kv : undefined);
}
export async function runAutopilotCycle(cfg: AppConfig, scope?: { network: Network; vault: string }) {
  {
    if (
      !hasExecutionSigner(cfg) ||
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
    const activeItems = items.filter((x) => x.status === "active" && Object.hasOwn(configs, x.network)
      && (x.network !== "robinhood" || process.env.FEATURE_ROBINHOOD_TRADING === "1")
      && (x.network !== "arc" || process.env.FEATURE_ARC_TRADING === "1")
      && (!scope || (x.network === scope.network && x.vault.toLowerCase() === scope.vault.toLowerCase())));
    const scheduled = [
      ...activeItems.map((strategy) => ({ strategy, mode: "risk" as const })),
      ...activeItems.map((strategy) => ({ strategy, mode: "analysis" as const })),
    ];
    const recoveryAttempted = new Set<string>();
    for (const { strategy: s, mode } of scheduled) {
      const key = executionSignerKey(cfg, s.network) as `0x${string}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(key)) continue;
      const leaseScope = mode === "risk" ? "execution" as const : "analysis" as const;
      const lease = await acquireStrategyLease(s.id, leaseScope);
      if (!lease) continue;
      let analysisAttempted = false;
      let aiAttemptedThisCycle = false;
      let executionPhase: AutopilotExecutionPhase = "not_submitted";
      let executionHash: `0x${string}` | undefined;
      let evaluatedDecision: ReturnType<typeof evaluateAutopilotPolicy> | ReturnType<typeof evaluateAutopilotRiskExit> | undefined;
      try {
        if (s.network === "arc") {
          const readiness = await arcAutomationReadiness(cfg);
          if (!readiness.ready) throw new Error(readiness.reason);
        }
        assertExecutionMarketIdentity(s.network, s.pair);
        if (s.network === "arc") assertArcExecutionBinding(s.pair, s.targetAsset, s.settlementAsset);
        if (recoveryAttempted.has(s.id)) continue;
        const outbox = s.network === "arc" ? new ArcAutopilotOutbox(key) : undefined;
        const recoveringTrade = outbox ? await outbox.read(s.owner, s.vault) : null;
        const now = Date.now();
        const lastAnalysis = Date.parse(s.lastRunAt || "");
        const lastRiskCheck = Date.parse(s.lastRiskCheckAt || "");
        // A paused-status poll is not an entry evaluation. Resume may evaluate
        // immediately; closed-candle dedupe and paid-AI cooldowns still apply.
        const analysisDue = s.lastDecision === "hold_paused" || !Number.isFinite(lastAnalysis) || now - lastAnalysis >= analysisInterval;
        const riskDue = !Number.isFinite(lastRiskCheck) || now - lastRiskCheck >= riskInterval;
        if (!recoveringTrade && ((mode === "risk" && !riskDue) || (mode === "analysis" && !analysisDue))) continue;
        if (recoveringTrade) recoveryAttempted.add(s.id);
        if (mode === "risk") s.riskCheckCount = (s.riskCheckCount || 0) + 1;
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
        let aiPass = await getAutopilotPass(s.network, s.vault);
        if (aiPass) aiPass = await synchronizeAutopilotPassPause(aiPass, Boolean(paused), Date.now());
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
        if (recoveringTrade && outbox) {
          executionPhase = "submitted";
          executionHash = recoveringTrade.txHash as `0x${string}`;
          const recoveryLease = mode === "analysis" ? await acquireStrategyLease(s.id, "execution") : null;
          if (mode === "analysis" && !recoveryLease) { s.lastDecision = "hold_receipt_pending"; continue; }
          try {
            let activity = (await listV6Activity(s.owner, s.network)).find(row => row.txHash?.toLowerCase() === recoveringTrade.txHash.toLowerCase()
              && row.source === "autopilot" && row.account?.toLowerCase() === s.vault.toLowerCase() && row.kind === recoveringTrade.kind);
            activity ??= await recordV6Activity({ owner: s.owner, network: s.network, source: "autopilot", account: s.vault,
              pair: recoveringTrade.pair, kind: recoveringTrade.kind, amount: recoveringTrade.amount,
              txHash: recoveringTrade.txHash, status: "pending" }, { requireDurable: true });
            let receipt;
            try { receipt = await publicClient.getTransactionReceipt({ hash: executionHash }); }
            catch (error) { if ((error as { name?: string }).name !== "TransactionReceiptNotFoundError") throw error; }
            if (receipt) {
              if (receipt.transactionHash.toLowerCase() !== recoveringTrade.txHash.toLowerCase()) throw new Error("Arc Autopilot recovered receipt hash does not match the signed transaction");
              if (receipt.status === "reverted") {
                await failV6Activity(activity, { requireDurable: true });
                executionPhase = "reverted";
                s.lastDecision = "hold_execution_reverted";
              } else {
                const factory = c.factory();
                if (!factory || !ADDRESS.test(factory)) throw new Error("Arc Autopilot recovery factory is unavailable");
                const owned = await publicClient.readContract({ address: factory as `0x${string}`,
                  abi: parseAbi(["function vaultsOf(address) view returns(address[])"]), functionName: "vaultsOf", args: [s.owner as `0x${string}`] });
                if (!verifiedAutopilotReceipt(receipt, s.vault, owned)) throw new Error("Arc Autopilot recovered execution ownership or event cannot be verified");
                await confirmV6Activity(activity, { requireDurable: true });
                executionPhase = "confirmed";
                s.exitPending = recoveringTrade.kind === "sell_partial_filled";
                if (recoveringTrade.kind === "sell_filled") { s.activeTakeProfit = undefined; s.activeStopLoss = undefined; }
                s.lastDecision = "hold_receipt_reconciled";
              }
              s.lastTxHash = recoveringTrade.txHash;
              s.evidenceHash = recoveringTrade.evidenceHash;
              s.evidenceUrl = recoveringTrade.evidenceUrl;
              s.lastError = undefined;
              s.updatedAt = new Date().toISOString();
              await save([s], "runtime");
              await outbox.clear(recoveringTrade);
            } else {
              // Only the original bytes can be resent. Owner controls and quote
              // expiry still prevent broadcasting a stale signed intent.
              const canRetry = !paused && String(version) === recoveringTrade.policyVersion
                && String(nonce) === recoveringTrade.actionNonce && Date.now() + 3000 < recoveringTrade.expiresAt;
              if (canRetry) {
                try {
                  const hash = await walletClient.sendRawTransaction({ serializedTransaction: recoveringTrade.serializedTransaction as `0x${string}` });
                  if (hash.toLowerCase() !== recoveringTrade.txHash.toLowerCase()) throw new Error("Arc Autopilot broadcast returned a different transaction hash");
                } catch (error) { if (!/already known|known transaction|nonce too low/i.test(error instanceof Error ? error.message : String(error))) throw error; }
              }
              s.lastDecision = "hold_receipt_pending";
              s.lastTxHash = recoveringTrade.txHash;
              s.lastError = canRetry ? undefined : "The original transaction is unresolved and cannot be resent under the current vault policy or quote expiry. Operator reconciliation is required.";
            }
            await appendEvaluation(s, { id: crypto.randomUUID(), evaluatedAt: new Date().toISOString(),
              strategyType: s.strategyType || identifyAutopilotStrategy(s.policy.strategy), action: "hold", status: "held",
              reason: receipt ? "The original Arc vault transaction was reconciled. The next cycle will read fresh balances."
                : "The original Arc vault transaction remains unresolved. No new trade or AI confirmation was created.",
              txHash: recoveringTrade.txHash, bias: "unknown", confidence: 0, metrics: {}, rules: [] });
          } finally { if (recoveryLease) await releaseStrategyLease(s.id, "execution", recoveryLease).catch(() => undefined); }
          continue;
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
        if (pendingAutopilotTrade(await listV6Activity(s.owner, s.network), s)) {
          const pending = pendingAutopilotTrade(await reconcileV6Activity(s.owner, s.network, c.rpc()), s);
          if (pending) {
            s.lastDecision = "hold_receipt_pending";
            s.lastError = undefined;
            await appendEvaluation(s, { id: crypto.randomUUID(), evaluatedAt: new Date().toISOString(), strategyType,
              action: "hold", status: "held", reason: "A previously submitted vault trade is awaiting receipt reconciliation. No additional trade was submitted.",
              bias: "unknown", confidence: 0, metrics: {}, rules: [], txHash: pending.txHash });
            continue;
          }
          // Receipt reconciliation may have changed balances and the action
          // nonce after readRuntime(). Start fresh instead of buying AI analysis
          // or attempting execution from the stale pre-reconciliation snapshot.
          s.lastDecision = "hold_receipt_reconciled";
          s.lastError = undefined;
          continue;
        }
        const positionTicker = targetBalance > 0n ? await executionSettlementTicker(cfg, s.pair) : undefined;
        if (s.network === "arc" && positionTicker) assertArcOkxTicker(positionTicker, s.pair);
        const policyBalance = valuedPositionBalance(targetBalance, positionTicker ? parseUnits(positionTicker.last.toFixed(18), 18) : 0n, Number(targetDecimals), Number(settlementDecimals));
        if (policyBalance === 0n && s.lastTxHash && s.lastDecision !== "sell_filled") {
          Object.assign(s, reconcileStrategyExecution(s, await listV6Activity(s.owner, s.network), policyBalance));
        }
        if (policyBalance === 0n) {
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
        let analysisToSettlement = 1;
        let evidenceContext: unknown;
        let signalProvenance: unknown;
        let executionPlan: ReturnType<typeof buildSpotExecutionPlan> | undefined;

        // Protection is intentionally independent of Premium analysis. A live
        // TP/SL touch is latched, so a cooldown or dependency outage cannot
        // make the strategy forget an exit that the owner already authorized.
        if (mode === "risk" && policyBalance > 0n) {
          const ticker = positionTicker!;
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
            continue;
          } else {
            continue;
          }
        } else if (mode === "risk") {
          s.lastRiskCheckAt = new Date().toISOString();
          if (targetBalance > 0n) s.lastDecision = "hold_residual_dust";
          continue;
        }

        if (!decision) {
          analysisAttempted = true;
          const robinhoodContext = isRobinhoodMarket(s.pair) ? await robinhoodAutopilotContext(cfg, { instId: s.pair, timeframe: s.timeframe, signalMarket: s.policy.signalMarket || s.pair }) : null;
          if (robinhoodContext) signalProvenance = {
            executionPair: s.pair, signalMarket: robinhoodContext.signalMarket,
            signalSource: robinhoodContext.signalSource, analysisToSettlement: robinhoodContext.analysisToSettlement,
            executionPrice: robinhoodContext.settlementTicker.last, executionPriceTimestamp: robinhoodContext.settlementTicker.ts,
          };
          const market = robinhoodContext?.market || await executionMarketContext(cfg, {
            instId: s.pair,
            timeframe: s.timeframe,
            candleLimit: 120,
            completedOnly: true,
          });
          if (s.network === "arc") {
            assertArcOkxMarketData(market, s.pair);
            assertArcAutomationHistory(market.candles, s.timeframe);
          }
          const candleTs = market.candles.at(-1)?.ts || 0;
          // A quote rejected before submission did not execute the approved
          // entry. Recheck its real route without fabricating another signal;
          // AI cooldown/pass dedupe and pending-receipt reconciliation still apply.
          const lastEvaluation = s.evaluations?.at(-1);
          const rejectedQuoteMessage = "The live route is below the vault oracle minimum; the latched action will retry with a fresh quote";
          const retryRejectedQuote = policyBalance === 0n && (s.entryQuoteRetryPending || s.lastError === rejectedQuoteMessage
            || (lastEvaluation?.context?.pair === s.pair && lastEvaluation.error === rejectedQuoteMessage));
          if (s.lastEvaluatedCandleTs === candleTs && !retryRejectedQuote) {
            if (!s.lastError) s.lastDecision = "hold_same_candle";
            s.sameCandleSkipCount = (s.sameCandleSkipCount || 0) + 1;
            s.lastRunAt = new Date().toISOString();
            continue;
          }
          s.entryQuoteRetryPending = false;
          const technical = buildTechnicalStructure(market.candles);
          executionPrice = market.ticker.last;
          if (robinhoodContext) {
            executionPrice = robinhoodContext.settlementTicker.last;
            analysisToSettlement = robinhoodContext.analysisToSettlement;
          }
          s.lastEvaluatedCandleTs = candleTs;
          const neutralAnalysis = { bias: "neutral", confidence: 0, regime: "transition", keyLevels: { support: [] as number[], resistance: [] as number[] } };

          // An open position never needs a new AI call to remain protected or
          // to react to deterministic structure failure.
          if (policyBalance > 0n) {
            const report = { analysis: neutralAnalysis };
            decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report, aiEvaluated: false, minConfidence: s.minConfidence, hasPosition: true, exitPending: s.exitPending,
              activeTakeProfit: s.activeTakeProfit === undefined ? undefined : s.activeTakeProfit / analysisToSettlement,
              activeStopLoss: s.activeStopLoss === undefined ? undefined : s.activeStopLoss / analysisToSettlement });
            s.aiSignalSource = "deterministic";
            s.aiBudgetStatus = "not_required_for_open_position";
            evidenceContext = { mode: "deterministic_position_monitor", technical };
          } else {
            const candidate = evaluateAutopilotEntryCandidate({ strategyType, candles: market.candles });
            if (!candidate.candidate) {
              decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report: { analysis: neutralAnalysis }, aiEvaluated: false, minConfidence: s.minConfidence, hasPosition: false });
              s.aiSignalSource = "deterministic";
              s.aiBudgetStatus = "candidate_not_ready";
              evidenceContext = { mode: "deterministic_entry_prefilter", candidate, technical };
            } else {
              const pass = await getAutopilotPass(s.network, s.vault);
              const passActive = Boolean(pass && autopilotPassRemainingMs(pass) > 0);
              const signalIdentity = robinhoodContext ? `${s.pair}@${robinhoodContext.signalMarket}` : s.pair;
              let signal = passActive ? await cachedAutopilotSignal(signalIdentity, s.timeframe) : null;
              const alreadyConfirmed = Boolean(signal && pass?.consumedSignalIds?.includes(`${s.pair}:${s.timeframe}:${signal.generatedAt}:${signal.candleTs}`));
              const passReady = passActive && Boolean(pass && (pass.signalsUsed < pass.signalLimit || alreadyConfirmed));
              if (!passReady) {
                signal = null;
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
                  const signalLeaseId = `signal:${signalIdentity}:${s.timeframe}`;
                  const signalLease = await acquireStrategyLease(signalLeaseId, "analysis");
                  if (!signalLease) {
                    signal = await cachedAutopilotSignal(signalIdentity, s.timeframe);
                    s.aiBudgetStatus = signal ? "ready" : "signal_generation_in_progress";
                    s.aiSignalSource = signal ? "cache" : "deterministic";
                  } else {
                    try {
                      signal = await cachedAutopilotSignal(signalIdentity, s.timeframe);
                      if (!signal) {
                        // Record the attempt before any network call. A rejected
                        // request must throttle the next cycle exactly like a
                        // successful request.
                        s.lastAiAttemptAt = new Date().toISOString();
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
                        aiAttemptedThisCycle = true;
                        signal = await observeProvider("xai", "autopilot_compact_signal", () => runPreparedAutopilotSignal(
                          { apiKey: cfg.XAI_API_KEY, baseUrl: cfg.XAI_BASE_URL, model: cfg.GROK_AUTOPILOT_MODEL },
                          { instId: market.instId, timeframe: s.timeframe, strategyType, market, maxInputTokens: cfg.GROK_MAX_INPUT_AUTOPILOT, maxOutputTokens: cfg.GROK_MAX_OUTPUT_AUTOPILOT },
                        ));
                        aiAttemptedThisCycle = false;
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
                        await cacheAutopilotSignal(signalIdentity, s.timeframe, signal, cfg.AUTOPILOT_AI_SIGNAL_TTL_MS);
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
                const entitlement = await consumeAutopilotPassSignal(s, signal);
                if (!entitlement.ok) {
                  signal = null;
                  s.aiSignalSource = "deterministic";
                  s.aiBudgetStatus = entitlement.reason;
                }
              }
              if (signal) {
                const analysis = { bias: signal.signal.bias, confidence: signal.signal.confidence, regime: signal.signal.regime, keyLevels: { support: [...signal.signal.support], resistance: [...signal.signal.resistance] } };
                executionPlan = buildSpotExecutionPlan({ instId: s.pair, timeframe: s.timeframe, tier: "premium", lastPrice: market.ticker.last, entryMode: "market", analysis, technical });
                const compactReport = { analysis, executionPlan };
                decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report: compactReport, minConfidence: s.minConfidence, hasPosition: false });
                evidenceContext = { mode: "event_driven_compact_signal", signal, candidate, technical, executionPlan };
              } else {
                decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report: { analysis: neutralAnalysis }, aiEvaluated: false, minConfidence: s.minConfidence, hasPosition: false });
                decision = { ...decision, reason: `Hold: AI confirmation unavailable (${s.aiBudgetStatus || "unknown"}); deterministic protection remains active.` };
                evidenceContext = { mode: "cost_guard_hold", status: s.aiBudgetStatus, candidate, technical };
              }
            }
          }
        }

        if (signalProvenance) evidenceContext = { ...(evidenceContext as Record<string, unknown>), signalProvenance };
        evaluatedDecision = decision;
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
          await appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: "Entry conditions were evaluated, but another protected action is in progress. No duplicate order was sent." });
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
              await appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: "The owner paused the vault after evaluation and before execution. No order was sent." });
              continue;
            }
            const freshPolicyBalance = valuedPositionBalance(targetBalance, parseUnits(executionPrice.toFixed(18), 18), Number(targetDecimals), Number(settlementDecimals));
            if (decision.action === "sell" && freshPolicyBalance === 0n) {
              s.exitPending = false;
              s.activeTakeProfit = undefined;
              s.activeStopLoss = undefined;
              s.lastDecision = "hold_position_closed";
              s.lastRunAt = new Date().toISOString();
              s.lastError = undefined;
              await appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: "The position was already closed when balances were rechecked. No additional sell was sent." });
              continue;
            }
            if (decision.action === "buy" && freshPolicyBalance > 0n) {
              s.lastDecision = "hold_position_already_open";
              s.lastRunAt = new Date().toISOString();
              s.lastError = undefined;
              await appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: "A position was already open when balances were rechecked. No duplicate buy was sent." });
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
        let amount = decision.action === "buy"
          ? [BigInt(s.buyAmountAtomic), maxTradeValue, settlementBalance].reduce((a, b) => a < b ? a : b)
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
        let prepared = await getGenericOkxSwap(cfg, {
          chainId: String(c.id),
          fromTokenAddress: sellToken,
          toTokenAddress: buyToken,
          amount: String(amount),
          userWalletAddress: adapter!,
          slippagePercent: String(Number(slippage) / 100),
        });
        if (decision.action === "buy") {
          const cap = await publicClient.readContract({ address: vault, abi: vaultReadAbi, functionName: "exposureCap", args: [s.targetAsset as `0x${string}`] });
          const valueOf = (quantity: bigint) => quantity * price * 10n ** BigInt(settlementDecimals) / 10n ** BigInt(targetDecimals) / 10n ** 18n;
          const headroom = cap - valueOf(targetBalance);
          const quotedValue = valueOf(BigInt(String(prepared.quote?.toTokenAmount || "0")));
          const bounded = boundedBuyAmount({ requested: amount, balance: settlementBalance, maxTrade: maxTradeValue, exposureHeadroom: headroom, quotedValue, quotedInput: amount });
          if (bounded <= 0n) throw new Error("EXPOSURE: no executable amount fits the signed asset exposure cap");
          if (bounded < amount) {
            amount = bounded;
            prepared = await getGenericOkxSwap(cfg, { chainId: String(c.id), fromTokenAddress: sellToken, toTokenAddress: buyToken, amount: String(amount), userWalletAddress: adapter!, slippagePercent: String(Number(slippage) / 100) });
          }
          if (valueOf(BigInt(String(prepared.quote?.toTokenAmount || "0"))) > headroom) throw new Error("EXPOSURE: refreshed quote exceeds the signed asset exposure cap; no vault trade sent");
        }
        const oracleMinimum = minimumOracleOutput({
          action: decision.action, sellAmount: amount, priceE18: price,
          targetDecimals: Number(targetDecimals), settlementDecimals: Number(settlementDecimals), slippageBps: BigInt(slippage),
        });
        if (decision.action === "sell" && (s.network === "robinhood" || s.network === "arc") && BigInt(String(prepared.quote?.toTokenAmount || "0")) < oracleMinimum) {
          // Gas-optimized default routing can return less than another source.
          // Probe once; unavailable alternatives never relax the vault guard.
          prepared = await betterGenericOkxExitSwap(cfg, { chainId: String(c.id), fromTokenAddress: sellToken,
            toTokenAddress: buyToken, amount: String(amount), userWalletAddress: adapter!,
            slippagePercent: String(Number(slippage) / 100) }, prepared).catch(() => prepared);
        }
        if (
          prepared.tx.to.toLowerCase() !== router!.toLowerCase() ||
          BigInt(prepared.tx.value) !== 0n
        )
          throw new Error(
            "Autopilot prepared route failed router/value policy",
          );
        if (s.network === "robinhood") validateRobinhoodSwap(prepared, { from: sellToken, to: buyToken, amount: String(amount), receiver: adapter!, slippageBps: Number(slippage) });
        const arcExpiresAt = s.network === "arc" ? (await validateArcSwap(prepared, { from: sellToken, to: buyToken, amount: String(amount), receiver: adapter!, slippageBps: Number(slippage) })).expiresAt : undefined;
        const quoted = BigInt(String(prepared.quote?.toTokenAmount || "0"));
        const quoteMinimum = (quoted * (10000n - BigInt(slippage))) / 10000n;
        if (quoted < oracleMinimum) {
          if (decision.action === "buy") s.entryQuoteRetryPending = true;
          const baseline = minimumOracleOutput({ action: decision.action, sellAmount: amount, priceE18: price,
            targetDecimals: Number(targetDecimals), settlementDecimals: Number(settlementDecimals), slippageBps: 0n });
          const outputGapPct = baseline > 0n ? Number((baseline - quoted) * 10000n / baseline) / 100 : 0;
          throw new Error(`The live route is below the vault oracle minimum; the latched action will retry with a fresh quote. Quoted output is ${outputGapPct.toFixed(2)}% below valuation; configured tolerance is ${(Number(slippage) / 100).toFixed(2)}%.`);
        }
        let entryExitQuote: Awaited<ReturnType<typeof getGenericOkxQuote>> | undefined;
        if (decision.action === "buy") {
          // A cheap buy can hide a large issuer/venue basis or an unquoteable
          // sell. Check the real bounded exit before custody changes, using
          // the same owner-approved valuation and tolerance as execution.
          s.entryQuoteRetryPending = true;
          const exitAmount = boundedTargetSellAmount({ targetBalance: quoted, maxTradeValue, priceE18: price,
            targetDecimals: Number(targetDecimals), settlementDecimals: Number(settlementDecimals) });
          if (exitAmount <= 0n) throw new Error("Autopilot entry has no cap-compliant exit amount; no buy was sent");
          entryExitQuote = await getGenericOkxQuote(cfg, { chainId: String(c.id), fromTokenAddress: buyToken,
            toTokenAddress: sellToken, amount: String(exitAmount) });
          const exitMinimum = minimumOracleOutput({ action: "sell", sellAmount: exitAmount, priceE18: price,
            targetDecimals: Number(targetDecimals), settlementDecimals: Number(settlementDecimals), slippageBps: BigInt(slippage) });
          if (BigInt(entryExitQuote.toTokenAmount) <= 0n || BigInt(entryExitQuote.toTokenAmount) < exitMinimum)
            throw new Error("Autopilot entry blocked: the current sell route is below the vault oracle minimum. No buy was sent; the existing AI confirmation can be retried while valid.");
          s.entryQuoteRetryPending = false;
        }
        const minOut = quoteMinimum > oracleMinimum ? quoteMinimum : oracleMinimum;
        const entryProtection = decision.action === "buy" ? {
          takeProfit: Number(executionPlan?.buy.takeProfit) * analysisToSettlement,
          stopLoss: Number(executionPlan?.buy.stopLoss) * analysisToSettlement,
        } : undefined;
        if (entryProtection && (!Number.isFinite(entryProtection.takeProfit) || !Number.isFinite(entryProtection.stopLoss)
          || entryProtection.stopLoss <= 0 || entryProtection.stopLoss >= executionPrice || entryProtection.takeProfit <= executionPrice))
          throw new Error("Autopilot entry requires valid market-entry TP/SL levels");
        const proof = await evidence(s, {
          decision: decision.action,
          evaluation: decision,
          report: evidenceContext,
          quote: prepared.quote,
          entryExitQuote,
          quoteMinimum: String(quoteMinimum),
          oracleMinimum: String(oracleMinimum),
          enforcedMinimum: String(minOut),
          policyHash: keccak256(toHex(JSON.stringify(s.policy))),
        });
        if (arcExpiresAt && Date.now() + 3000 >= arcExpiresAt) throw new Error("Arc execution quote expired before oracle submission; refresh the route");
        const priceFees = s.network === "arc" ? await arcExecutionFees(publicClient, { account: walletClient.account!, to: oracle as `0x${string}`,
          data: encodeFunctionData({ abi: oracleAbi, functionName: "setPrice", args: [s.targetAsset as `0x${string}`, s.settlementAsset as `0x${string}`, price, 300n] }) }) : {};
        const priceTx = await walletClient.writeContract({
          ...priceFees,
          account: walletClient.account,
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
        if (entryProtection) {
          // Save protection before the transaction can land. A receipt timeout
          // or process restart must not leave the resulting position unprotected.
          s.activeTakeProfit = entryProtection.takeProfit;
          s.activeStopLoss = entryProtection.stopLoss;
          s.exitPending = false;
          s.updatedAt = new Date().toISOString();
          await save([s], "runtime");
        }
        const executionFees = s.network === "arc" ? await arcExecutionFees(publicClient, { account: walletClient.account!, to: vault,
          data: encodeFunctionData({ abi: vaultReadAbi, functionName: "execute", args: simulation.request.args }) }) : {};
        if (arcExpiresAt && Date.now() + 3000 >= arcExpiresAt) throw new Error("Arc execution quote expired before signing; refresh the route");
        const partialExit = decision.action === "sell" && valuedPositionBalance(targetBalance - amount, price, Number(targetDecimals), Number(settlementDecimals)) > 0n;
        let pendingArcTrade: PendingArcAutopilotTrade | undefined;
        let submittedActivity;
        let txHash: `0x${string}`;
        if (outbox) {
          const data = encodeFunctionData({ abi: vaultReadAbi, functionName: "execute", args: simulation.request.args });
          const request = await walletClient.prepareTransactionRequest({ account: walletClient.account, to: vault, data, value: 0n, ...executionFees });
          const serializedTransaction = await walletClient.signTransaction(request);
          pendingArcTrade = await outbox.stage({ owner: s.owner, vault: s.vault, pair: s.pair,
            kind: partialExit ? "sell_partial_filled" : `${decision.action}_filled`, amount: String(amount),
            policyVersion: String(version), actionNonce: String(nonce), data, serializedTransaction,
            evidenceHash: proof.hash, evidenceUrl: proof.url, expiresAt: arcExpiresAt! });
          txHash = pendingArcTrade.txHash as `0x${string}`;
          executionHash = txHash;
          s.lastTxHash = txHash;
          submittedActivity = await recordV6Activity({ owner: s.owner, network: s.network, source: "autopilot",
            kind: pendingArcTrade.kind, status: "pending", txHash, account: s.vault, pair: s.pair, amount: String(amount) }, { requireDurable: true });
          if (Date.now() + 3000 >= pendingArcTrade.expiresAt) throw new Error("Arc Autopilot persisted quote expired before broadcasting; retain the original transaction for reconciliation");
          executionPhase = "submitted";
          const broadcastHash = await walletClient.sendRawTransaction({ serializedTransaction });
          if (broadcastHash.toLowerCase() !== txHash.toLowerCase()) throw new Error("Arc Autopilot broadcast returned a different transaction hash");
        } else {
          executionPhase = "submitted";
          txHash = await walletClient.writeContract({ ...simulation.request, ...executionFees });
          executionHash = txHash;
          s.lastTxHash = txHash;
          submittedActivity = await recordV6Activity({ owner: s.owner, network: s.network, source: "autopilot",
          kind: partialExit ? "sell_partial_filled" : `${decision.action}_filled`, status: "pending",
          txHash, account: s.vault, pair: s.pair, amount: String(amount) });
        }
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        if (receipt.status !== "success") {
          executionPhase = "reverted";
          throw new Error("Autopilot execution reverted");
        }
        executionPhase = "confirmed";
        s.lastDecision = partialExit ? "sell_partial_filled" : `${decision.action}_filled`;
        s.lastRunAt = new Date().toISOString();
        s.lastRiskCheckAt = new Date().toISOString();
        s.lastTxHash = txHash;
        s.evidenceUrl = proof.url;
        s.evidenceHash = proof.hash;
        s.lastError = undefined;
        if (decision.action === "buy") {
          s.exitPending = false;
          s.activeTakeProfit = Number(executionPlan!.buy.takeProfit) * analysisToSettlement || undefined;
          s.activeStopLoss = Number(executionPlan!.buy.stopLoss) * analysisToSettlement || undefined;
        } else {
          s.exitPending = partialExit;
          if (!partialExit) {
            s.activeTakeProfit = undefined;
            s.activeStopLoss = undefined;
          }
        }
        await confirmV6Activity(submittedActivity, { requireDurable: Boolean(outbox) });
        await appendEvaluation(s, { ...evaluationBase, status: "filled", evidenceHash: proof.hash, txHash });
        if (outbox && pendingArcTrade) {
          s.updatedAt = new Date().toISOString();
          await save([s], "runtime");
          await outbox.clear(pendingArcTrade);
        }
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
        const failure = autopilotExecutionFailure(executionPhase, transient);
        s.lastDecision = failure.lastDecision;
        if (analysisAttempted) s.lastRunAt = new Date().toISOString();
        await appendEvaluation(s, {
          id: crypto.randomUUID(),
          evaluatedAt: new Date().toISOString(),
          strategyType: s.strategyType || identifyAutopilotStrategy(s.policy.strategy),
          action: "hold",
          status: "failed",
          reason: failure.reason,
          txHash: executionHash,
          bias: evaluatedDecision?.bias || "unknown",
          confidence: evaluatedDecision?.confidence || 0,
          metrics: evaluatedDecision?.metrics || {},
          rules: evaluatedDecision?.rules || [],
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
  const recover = () => void list().then(runCashFlowRecoveryCycle).catch(() => undefined);
  const recoveryTimer = setInterval(recover, 60_000);
  recoveryTimer.unref();
  recover();
  timer.unref();
  run();
  return () => { clearInterval(timer); clearInterval(recoveryTimer); };
}
