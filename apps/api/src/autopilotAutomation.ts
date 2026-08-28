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
import { buildSpotExecutionPlan, buildTechnicalStructure, runPreparedSpotAnalysis } from "@pulse/analysis";
import type { AppConfig } from "@pulse/config";
import { isKvUnavailableError, kvCircuitStatus, kvConfigured, runKvCommand } from "./resilientKv.js";
import { asyncRoute } from "./httpResilience.js";
import { analysisSymbolForExecutionToken, getGenericOkxSwap } from "./okxDex.js";
import { listV6Activity, recordV6Activity } from "./v6Store.js";
import { normaliseRouteSymbol } from "./tradeAutomation.js";
import { executionPublicClient } from "./onchainDiscovery.js";
import { executionContractAddress } from "./executionContracts.js";
import { AUTOPILOT_STRATEGY_CATALOG, boundedTargetSellAmount, evaluateAutopilotPolicy, evaluateAutopilotRiskExit, identifyAutopilotStrategy, minimumOracleOutput, type AutopilotRuleResult, type AutopilotStrategyType } from "./autopilotPolicy.js";
import { AUTOPILOT_STRATEGY_HASH_KEY, decodeStrategyHash, mergeStrategyRuntime, reconcileStrategyExecution } from "./autopilotStrategyStore.js";

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
  evaluations?: StrategyEvaluation[];
};
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
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
  settlementAsset: z.string().regex(ADDRESS),
  targetAsset: z.string().regex(ADDRESS),
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
let memory: Strategy[] = [];
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
export function createAutopilotAutomationRouter() {
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
        const price = parseUnits(ticker.last.toFixed(18), 18);
        const portfolioValueAtomic = settlementBalance + targetBalance * price * (10n ** BigInt(settlementDecimals)) / (10n ** BigInt(targetDecimals)) / 10n ** 18n;
        const baseline = BigInt(strategy.baselineValueAtomic || "0");
        const cashFlowAtomic = (activityByNetwork.get(strategy.network) || [])
          .filter((item) => item.status === "confirmed" && item.account?.toLowerCase() === strategy.vault.toLowerCase() && item.createdAt >= strategy.createdAt && (item.kind === "vault_fund" || item.kind === "vault_withdraw"))
          .reduce((sum, item) => sum + (item.kind === "vault_fund" ? 1n : -1n) * BigInt(item.amount || "0"), 0n);
        const capitalBasis = baseline + cashFlowAtomic;
        const pnl = portfolioValueAtomic - capitalBasis;
        const reconciled = reconcileStrategyExecution(strategy, activityByNetwork.get(strategy.network) || [], targetBalance);
        return { ...reconciled, paused, settlementBalance: String(settlementBalance), targetBalance: String(targetBalance), settlementDecimals: Number(settlementDecimals), targetDecimals: Number(targetDecimals), settlementSymbol, targetSymbol, portfolioValueAtomic: String(portfolioValueAtomic), markPrice: ticker.last, netCashFlowAtomic: String(cashFlowAtomic), pnlAtomic: capitalBasis > 0n ? String(pnl) : null, pnlPct: capitalBasis > 0n ? Number(pnl * 1_000_000n / capitalBasis) / 10_000 : null };
      } catch (error) {
        return { ...strategy, telemetryError: error instanceof Error ? error.message : String(error) };
      }
    }));
    res.json({ strategies: views, strategyCatalog: AUTOPILOT_STRATEGY_CATALOG, persistence: kvCircuitStatus() });
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
function appendEvaluation(strategy: Strategy, evaluation: StrategyEvaluation) {
  strategy.evaluations = [...(strategy.evaluations || []), evaluation].slice(-100);
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
      60_000,
      Number(process.env.AUTOPILOT_ANALYSIS_INTERVAL_MS || 900000) || 900000,
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
          if (!cfg.hasXaiKey) throw new Error("Premium analysis is not configured; deterministic TP/SL monitoring remains active");
          const market = await buildMarketContext({
            instId: s.pair,
            timeframe: s.timeframe,
            candleLimit: 120,
          });
          const report = await runPreparedSpotAnalysis(
            {
              apiKey: cfg.XAI_API_KEY,
              baseUrl: cfg.XAI_BASE_URL,
              model: cfg.GROK_MODEL,
            },
            {
              instId: s.pair,
              timeframe: s.timeframe,
              tier: "premium",
              lang: "en",
              userNote: s.policy.strategy,
              maxInputTokens: cfg.GROK_MAX_INPUT_PREMIUM,
              maxOutputTokens: cfg.GROK_MAX_OUTPUT_PREMIUM,
              reasoningEffort: cfg.GROK_REASONING_PREMIUM,
            },
            market,
          );
          const technical = buildTechnicalStructure(market.candles);
          executionPlan = buildSpotExecutionPlan({ instId: s.pair, timeframe: s.timeframe, tier: "premium", lastPrice: market.ticker.last, analysis: report.analysis, technical });
          const enrichedReport = { ...report, technical, executionPlan };
          decision = evaluateAutopilotPolicy({ strategyType, candles: market.candles, report: enrichedReport, minConfidence: s.minConfidence, hasPosition: targetBalance > 0n, exitPending: s.exitPending, activeTakeProfit: s.activeTakeProfit, activeStopLoss: s.activeStopLoss });
          executionPrice = market.ticker.last;
          evidenceContext = enrichedReport;
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
          appendEvaluation(s, { ...evaluationBase, status: "held", evidenceHash: proof.hash });
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
            appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: `A policy action is active; waiting ${cooldownRemaining}s for the on-chain cooldown.` });
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
          appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: "The strategy exit is valid, but no target amount fits the signed per-trade cap." });
          continue;
        }
        const balance = decision.action === "buy" ? settlementBalance : targetBalance;
        if (balance < amount) {
          s.lastDecision = "hold_insufficient_vault_balance";
          s.lastRunAt = new Date().toISOString();
          s.lastError = undefined;
          appendEvaluation(s, { ...evaluationBase, action: "hold", status: "held", reason: `The vault balance is below the configured ${decision.action} size.` });
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
        appendEvaluation(s, { ...evaluationBase, status: "filled", evidenceHash: proof.hash, txHash });
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
        s.lastError = detail;
        s.lastDecision = transient
          ? "hold_dependency_retry"
          : "hold_failed_closed";
        if (analysisAttempted) s.lastRunAt = new Date().toISOString();
        appendEvaluation(s, {
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
