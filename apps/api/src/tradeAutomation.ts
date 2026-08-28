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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppConfig } from "@pulse/config";
import { isKvUnavailableError, runKvCommand } from "./resilientKv.js";
import { asyncRoute } from "./httpResilience.js";
import { getTicker } from "@pulse/market";
import { analysisSymbolForExecutionToken, getGenericOkxSwap } from "./okxDex.js";
import { recordV6Activity } from "./v6Store.js";
import { executionPublicClient, getOnchainAccountSnapshot } from "./onchainDiscovery.js";
import { executionContractAddress } from "./executionContracts.js";

type Network = "xlayer" | "base" | "arbitrum";
type RegisteredOrder = {
  id: string;
  owner: string;
  network: Network;
  account: string;
  orderId: string;
  version: "oco-v1" | "limit-v2" | "bracket-v1";
  instId: string;
  executionPair?: string;
  sellToken: string;
  buyToken: string;
  txHash?: string;
  fillTxHash?: string;
  status: "active" | "paused" | "filled" | "cancelled" | "failed";
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  executionTxHash?: string;
  lastAction?: "entry_protected" | "take_profit" | "stop_loss" | "fill";
  entryPrice?: number;
  onchainState?: number;
  phase?: "entry" | "protected" | "complete";
  triggerPrice?: number;
  secondaryTriggerPrice?: number | null;
  currentPrice?: number | null;
  estimatedPnlPct?: number | null;
  takeProfit?: number | null;
  stopLoss?: number | null;
  triggerAbove?: boolean | null;
  expiry?: string;
};
const address = /^0x[a-fA-F0-9]{40}$/;
const hash = /^0x[a-fA-F0-9]{64}$/;
const networks = {
  xlayer: {
    id: 196,
    rpc: () => process.env.X_LAYER_RPC || "https://rpc.xlayer.tech",
    rpcFallback: () => process.env.X_LAYER_RPC_FALLBACK || "https://xlayerrpc.okx.com",
    oracle: () => executionContractAddress("xlayer", "oracleRouter"),
    adapter: () => executionContractAddress("xlayer", "executionAdapter"),
    router: () => executionContractAddress("xlayer", "okxRouter"),
    spender: () => executionContractAddress("xlayer", "okxApproval"),
    ocoFactory: () => executionContractAddress("xlayer", "spotFactory"),
    limitFactory: () => executionContractAddress("xlayer", "spotLimitFactory"),
    bracketFactory: () => executionContractAddress("xlayer", "spotBracketFactory"),
  },
  base: {
    id: 8453,
    rpc: () => process.env.BASE_RPC_URL || "https://mainnet.base.org",
    rpcFallback: () => process.env.BASE_RPC_FALLBACK_URL || "https://1rpc.io/base",
    oracle: () => executionContractAddress("base", "oracleRouter"),
    adapter: () => executionContractAddress("base", "executionAdapter"),
    router: () => executionContractAddress("base", "okxRouter"),
    spender: () => executionContractAddress("base", "okxApproval"),
    ocoFactory: () => executionContractAddress("base", "spotFactory"),
    limitFactory: () => executionContractAddress("base", "spotLimitFactory"),
    bracketFactory: () => executionContractAddress("base", "spotBracketFactory"),
  },
  arbitrum: {
    id: 42161,
    rpc: () => process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    rpcFallback: () => process.env.ARBITRUM_RPC_FALLBACK_URL || "https://arbitrum-one-rpc.publicnode.com",
    oracle: () => executionContractAddress("arbitrum", "oracleRouter"),
    adapter: () => executionContractAddress("arbitrum", "executionAdapter"),
    router: () => executionContractAddress("arbitrum", "okxRouter"),
    spender: () => executionContractAddress("arbitrum", "okxApproval"),
    ocoFactory: () => executionContractAddress("arbitrum", "spotFactory"),
    limitFactory: () => executionContractAddress("arbitrum", "spotLimitFactory"),
    bracketFactory: () => executionContractAddress("arbitrum", "spotBracketFactory"),
  },
} as const;
const schema = z.object({
  owner: z.string().regex(address),
  network: z.enum(["xlayer", "base", "arbitrum"]),
  account: z.string().regex(address),
  orderId: z.string().regex(/^\d+$/),
  version: z.enum(["oco-v1", "limit-v2", "bracket-v1"]),
  instId: z.string().regex(/^[A-Z0-9._-]{3,40}$/),
  sellToken: z.string().regex(address),
  buyToken: z.string().regex(address),
  txHash: z.string().regex(hash),
  fillTxHash: z.string().regex(hash).optional(),
});
const factoryAbi = [{
  type: "function", name: "accountOf", stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ name: "account", type: "address" }],
}] as const;
const ownerAbi = [{
  type: "function", name: "owner", stateMutability: "view", inputs: [],
  outputs: [{ name: "", type: "address" }],
}] as const;
const erc20MetadataAbi = [{
  type: "function", name: "symbol", stateMutability: "view", inputs: [],
  outputs: [{ name: "", type: "string" }],
}] as const;
const erc20DecimalsAbi = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const;

export function normaliseSymbol(value: string) {
  const symbol = value.trim().toUpperCase().replaceAll("₮", "T").replace(/\.E$/, "");
  if (symbol === "WETH") return "ETH";
  if (symbol === "WBTC" || symbol === "CBBTC") return "BTC";
  if (symbol === "CBETH") return "ETH";
  if (symbol === "USDBC") return "USDC";
  return symbol;
}
/** Report pairs use USDT while each chain deliberately settles in its native
 * liquid dollar token (USDC on Base/Arbitrum, USDT0 on X Layer). Treat those
 * assets as equivalent only when validating the route; their contract
 * addresses and displayed execution symbols remain exact. */
export function normaliseRouteSymbol(value: string) {
  const symbol = normaliseSymbol(value);
  return symbol === "USDC" || symbol === "USDT" || symbol === "USDT0"
    ? "USD_STABLE"
    : symbol;
}
export function onchainOrderStatus(state: number): RegisteredOrder["status"] {
  return state === 1 ? "active" : state === 2 ? "paused" : state === 3 ? "filled" : state === 4 ? "cancelled" : "failed";
}
export function bracketOrderStatus(state: number): RegisteredOrder["status"] {
  return state === 1 || state === 3 ? "active" : state === 2 || state === 4 ? "paused" : state === 5 ? "filled" : state === 6 ? "cancelled" : "failed";
}

type OrderLifecycle = Pick<RegisteredOrder, "status" | "phase" | "onchainState">;

function observedOrderLifecycle(
  version: RegisteredOrder["version"],
  state: number,
): OrderLifecycle {
  const status = version === "bracket-v1"
    ? bracketOrderStatus(state)
    : onchainOrderStatus(state);
  const phase: RegisteredOrder["phase"] = version === "bracket-v1"
    ? state === 1 || state === 2
      ? "entry"
      : state === 3 || state === 4
        ? "protected"
        : "complete"
    : version === "oco-v1"
      ? state === 1 || state === 2 ? "protected" : "complete"
      : state === 1 || state === 2 ? "entry" : "complete";
  return { status, phase, onchainState: state };
}

function terminalState(
  version: RegisteredOrder["version"],
  status: "filled" | "cancelled",
) {
  if (version === "bracket-v1") return status === "filled" ? 5 : 6;
  return status === "filled" ? 3 : 4;
}

/**
 * Contract order states only move forward. Public RPC fallbacks can briefly
 * return an older block, so a terminal/protected state already proved by a
 * receipt must never regress to entry in the UI or durable order ledger.
 */
export function reconcileOrderLifecycle(
  version: RegisteredOrder["version"],
  observedState: number,
  previous?: Pick<RegisteredOrder, "status" | "phase" | "onchainState">,
): OrderLifecycle {
  const observed = observedOrderLifecycle(version, observedState);
  const observedTerminal = observed.status === "filled" || observed.status === "cancelled";
  if (observedTerminal) return observed;

  const previousTerminal = previous?.status === "filled" || previous?.status === "cancelled";
  if (previous && previousTerminal) {
    const status = previous.status as "filled" | "cancelled";
    return {
      status,
      phase: "complete",
      onchainState: terminalState(version, status),
    };
  }

  if (version === "bracket-v1" && previous?.phase === "protected" && observed.phase === "entry") {
    return {
      status: previous.status,
      phase: "protected",
      onchainState: previous.status === "paused" ? 4 : 3,
    };
  }
  return observed;
}
function transientRpcFailure(error: unknown) {
  return /rate limit|429|timeout|timed out|fetch failed|network|rpc request failed|temporarily unavailable/i.test(error instanceof Error ? error.message : String(error));
}

async function readTokenSymbol(
  publicClient: ReturnType<typeof clients>["publicClient"],
  token: `0x${string}`,
) {
  const symbol = await publicClient.readContract({
    address: token,
    abi: erc20MetadataAbi,
    functionName: "symbol",
  });
  if (!symbol || symbol.length > 32) throw new Error("Token has invalid ERC-20 metadata");
  return symbol;
}
async function kv(command: unknown[]) {
  return runKvCommand(command, "trade automation");
}
const memory = new Map<string, RegisteredOrder>();
async function list() {
  const raw = await kv(["GET", "pulse:v6:automation:orders"]);
  if (typeof raw === "string") return JSON.parse(raw) as RegisteredOrder[];
  return [...memory.values()];
}
async function save(items: RegisteredOrder[]) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    await kv([
      "SET",
      "pulse:v6:automation:orders",
      JSON.stringify(items.slice(-1000)),
    ]);
  else {
    memory.clear();
    for (const item of items) memory.set(item.id, item);
  }
}
function clients(network: Network, key?: `0x${string}`) {
  const cfg = networks[network];
  const urls = [...new Set([cfg.rpc(), cfg.rpcFallback()].filter(Boolean))];
  const chain = {
    id: cfg.id,
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
const transferTopic = keccak256(toHex("Transfer(address,address,uint256)"));
function topicAddress(value: string | undefined) { return value && value.length === 66 ? `0x${value.slice(-40)}`.toLowerCase() : ""; }

async function verifiedFillPrice(input: z.infer<typeof schema>, publicClient: ReturnType<typeof clients>["publicClient"]) {
  if (input.version !== "oco-v1" || !input.fillTxHash) return undefined;
  const [receipt, tx, assetDecimals, settlementDecimals] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: input.fillTxHash as `0x${string}` }),
    publicClient.getTransaction({ hash: input.fillTxHash as `0x${string}` }),
    publicClient.readContract({ address: input.sellToken as `0x${string}`, abi: erc20DecimalsAbi, functionName: "decimals" }),
    publicClient.readContract({ address: input.buyToken as `0x${string}`, abi: erc20DecimalsAbi, functionName: "decimals" }),
  ]);
  const router = networks[input.network].router();
  if (receipt.status !== "success" || tx.from.toLowerCase() !== input.owner.toLowerCase() || !router || tx.to?.toLowerCase() !== router.toLowerCase())
    throw new Error("Market fill is not a confirmed owner-to-approved-router transaction");
  let settlementSpent = 0n;
  let assetReceived = 0n;
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== transferTopic.toLowerCase()) continue;
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    const amount = BigInt(log.data || "0x0");
    if (log.address.toLowerCase() === input.buyToken.toLowerCase() && from === input.owner.toLowerCase()) settlementSpent += amount;
    if (log.address.toLowerCase() === input.sellToken.toLowerCase() && to === input.owner.toLowerCase()) assetReceived += amount;
  }
  if (settlementSpent <= 0n || assetReceived <= 0n) throw new Error("Confirmed market fill did not contain the expected settlement spend and asset receipt");
  const spent = Number(settlementSpent) / 10 ** Number(settlementDecimals);
  const received = Number(assetReceived) / 10 ** Number(assetDecimals);
  if (!Number.isFinite(spent) || !Number.isFinite(received) || spent <= 0 || received <= 0) throw new Error("Confirmed market fill could not be normalized");
  return spent / received;
}

async function verifyRegistration(input: z.infer<typeof schema>) {
  const { publicClient } = clients(input.network);
  const [receipt, tx] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: input.txHash as `0x${string}` }),
    publicClient.getTransaction({ hash: input.txHash as `0x${string}` }),
  ]);
  if (
    receipt.status !== "success" ||
    tx.from.toLowerCase() !== input.owner.toLowerCase() ||
    tx.to?.toLowerCase() !== input.account.toLowerCase()
  )
    throw new Error(
      "Order transaction is not a confirmed owner-to-account call",
    );

  const factory = input.version === "oco-v1"
    ? networks[input.network].ocoFactory()
    : input.version === "bracket-v1"
      ? networks[input.network].bracketFactory()
      : networks[input.network].limitFactory();
  if (!factory || !address.test(factory)) throw new Error("Order factory is not configured");
  const [registeredAccount, onchainOwner, record] = await Promise.all([
    publicClient.readContract({
      address: factory as `0x${string}`,
      abi: factoryAbi,
      functionName: "accountOf",
      args: [input.owner as `0x${string}`],
    }),
    publicClient.readContract({
      address: input.account as `0x${string}`,
      abi: ownerAbi,
      functionName: "owner",
    }),
    input.version === "oco-v1"
      ? publicClient.readContract({ address: input.account as `0x${string}`, abi: ocoAbi, functionName: "positions", args: [BigInt(input.orderId)] })
      : input.version === "bracket-v1"
        ? publicClient.readContract({ address: input.account as `0x${string}`, abi: bracketAbi, functionName: "orders", args: [BigInt(input.orderId)] })
        : publicClient.readContract({ address: input.account as `0x${string}`, abi: limitAbi, functionName: "orders", args: [BigInt(input.orderId)] }),
  ]);
  if (
    String(registeredAccount).toLowerCase() !== input.account.toLowerCase() ||
    String(onchainOwner).toLowerCase() !== input.owner.toLowerCase()
  ) throw new Error("Account is not the owner's factory-created order account");

  const actualSell = String(record[0]);
  const actualBuy = String(record[1]);
  const state = Number(record.at(-1));
  if (
    actualSell.toLowerCase() !== input.sellToken.toLowerCase() ||
    actualBuy.toLowerCase() !== input.buyToken.toLowerCase() ||
    state !== 1
  ) throw new Error("Registered order does not match an active on-chain order");

  const [sellSymbol, buySymbol] = await Promise.all([
    readTokenSymbol(publicClient, actualSell as `0x${string}`),
    readTokenSymbol(publicClient, actualBuy as `0x${string}`),
  ]);
  const [pairBase, pairQuote, extra] = input.instId.toUpperCase().split("-");
  if (!pairBase || !pairQuote || extra) throw new Error("Instrument must be BASE-QUOTE");
  const triggerAbove = input.version === "bracket-v1" ? Boolean(record[12]) : Boolean(record[9]);
  const expected = input.version === "oco-v1" || triggerAbove
    ? [pairBase, pairQuote]
    : [pairQuote, pairBase];
  const normalizeForChain = (symbol: string) => normaliseRouteSymbol(analysisSymbolForExecutionToken(symbol, String(networks[input.network].id)));
  if (normalizeForChain(sellSymbol) !== normaliseRouteSymbol(expected[0]) || normalizeForChain(buySymbol) !== normaliseRouteSymbol(expected[1]))
    throw new Error(`On-chain tokens ${sellSymbol}/${buySymbol} do not match ${input.instId}`);
  const executionPair = input.version === "oco-v1" || triggerAbove
    ? `${sellSymbol}-${buySymbol}`
    : `${buySymbol}-${sellSymbol}`;
  return { entryPrice: await verifiedFillPrice(input, publicClient), executionPair };
}

const nextIdAbi = [
  { type: "function", name: "nextOrderId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nextPositionId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

function reportSymbol(value: string, network?: Network) {
  const symbol = network ? analysisSymbolForExecutionToken(value, String(networks[network].id)) : normaliseSymbol(value);
  return symbol === "USDC" || symbol === "USDT0" ? "USDT" : symbol;
}

async function discoverOwnerOrdersUncached(owner: string, network: Network, existing: RegisteredOrder[], fresh = false) {
  const { publicClient } = clients(network);
  const now = new Date().toISOString();
  const found: RegisteredOrder[] = [];
  const snapshot = await getOnchainAccountSnapshot(network, owner, fresh);
  const configurations = [
    { version: "limit-v2" as const, account: snapshot.accounts.limit, next: "nextOrderId" as const },
    { version: "bracket-v1" as const, account: snapshot.accounts.bracket, next: "nextOrderId" as const },
    { version: "oco-v1" as const, account: snapshot.accounts.protection, next: "nextPositionId" as const },
  ];
  for (const configuration of configurations) {
    if (!configuration.account || !address.test(configuration.account)) continue;
    try {
      const account = configuration.account;
      const nextId = await publicClient.readContract({
        address: account as `0x${string}`,
        abi: nextIdAbi,
        functionName: configuration.next,
      });
      // Accounts are per-owner and normally small. Bound reconstruction so a
      // malicious account cannot turn this read endpoint into an RPC fan-out.
      const firstId = nextId > 201n ? nextId - 200n : 1n;
      const ids: bigint[] = [];
      for (let id = firstId; id < nextId; id += 1n) ids.push(id);
      const records = await Promise.all(ids.map(async (id) => ({
        id,
        record: configuration.version === "oco-v1"
          ? await publicClient.readContract({ address: account as `0x${string}`, abi: ocoAbi, functionName: "positions", args: [id] })
          : configuration.version === "bracket-v1"
            ? await publicClient.readContract({ address: account as `0x${string}`, abi: bracketAbi, functionName: "orders", args: [id] })
            : await publicClient.readContract({ address: account as `0x${string}`, abi: limitAbi, functionName: "orders", args: [id] }),
      })));
      for (const { id, record } of records) {
        const sellToken = String(record[0]);
        const buyToken = String(record[1]);
        if (!address.test(sellToken) || !address.test(buyToken) || /^0x0{40}$/i.test(sellToken)) continue;
        const [sellSymbol, buySymbol] = await Promise.all([
          readTokenSymbol(publicClient, sellToken as `0x${string}`),
          readTokenSymbol(publicClient, buyToken as `0x${string}`),
        ]);
        const triggerAbove = configuration.version === "limit-v2" ? Boolean(record[9]) : configuration.version === "bracket-v1" ? Boolean(record[12]) : true;
        const baseSymbol = configuration.version === "oco-v1" || triggerAbove ? sellSymbol : buySymbol;
        const quoteSymbol = configuration.version === "oco-v1" || triggerAbove ? buySymbol : sellSymbol;
        const key = `${network}:${account.toLowerCase()}:${id}`;
        const previous = existing.find((item) => item.id === key);
        const incomingState = Number(record.at(-1));
        const lifecycle = reconcileOrderLifecycle(configuration.version, incomingState, previous);
        found.push({
          ...previous,
          id: key,
          owner,
          network,
          account,
          orderId: String(id),
          version: configuration.version,
          instId: `${reportSymbol(baseSymbol, network)}-${reportSymbol(quoteSymbol, network)}`,
          executionPair: `${baseSymbol}-${quoteSymbol}`,
          sellToken,
          buyToken,
          ...lifecycle,
          createdAt: previous?.createdAt || now,
          updatedAt: now,
          lastError: previous?.lastError,
          ...(previous?.txHash ? { txHash: previous.txHash } : {}),
          ...(previous?.executionTxHash ? { executionTxHash: previous.executionTxHash } : {}),
          ...(previous?.entryPrice ? { entryPrice: previous.entryPrice } : {}),
        });
      }
    } catch {
      // One unavailable factory/RPC must not hide orders discovered from the
      // other account type or stale the rest of the product.
    }
  }
  return found;
}

const discoveryCache = new Map<string, { expiresAt: number; orders: RegisteredOrder[] }>();
const discoveryInflight = new Map<string, Promise<RegisteredOrder[]>>();
async function discoverOwnerOrders(owner: string, network: Network, existing: RegisteredOrder[], fresh = false) {
  const key = `${network}:${owner.toLowerCase()}`;
  const cached = discoveryCache.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.orders;
  const pending = discoveryInflight.get(key);
  if (pending) return pending;
  const request = discoverOwnerOrdersUncached(owner, network, existing, fresh)
    .then((orders) => { discoveryCache.set(key, { orders, expiresAt: Date.now() + 20_000 }); return orders; })
    .catch((error) => {
      if (cached) return cached.orders.map((order) => ({ ...order, lastError: `Using cached on-chain state: ${error instanceof Error ? error.message : String(error)}` }));
      throw error;
    })
    .finally(() => discoveryInflight.delete(key));
  discoveryInflight.set(key, request);
  return request;
}

export function createTradeAutomationRouter() {
  const router = Router();
  router.get("/v1/automation/orders", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const owner = String(req.query.owner || "");
    const requestedNetwork = String(req.query.network || "");
    if (!address.test(owner))
      return res.status(400).json({ error: "Valid owner required" });
    if (requestedNetwork && !(requestedNetwork in networks))
      return res.status(400).json({ error: "Unsupported network" });
    let all = await list();
    const networksToDiscover = requestedNetwork
      ? [requestedNetwork as Network]
      : (Object.keys(networks) as Network[]);
    const fresh = req.query.fresh === "1";
    const discovered = (await Promise.all(networksToDiscover.map((network) => discoverOwnerOrders(owner, network, all, fresh)))).flat();
    if (discovered.length) {
      const byId = new Map(all.map((item) => [item.id, item]));
      for (const item of discovered) byId.set(item.id, { ...byId.get(item.id), ...item });
      all = [...byId.values()];
    }
    const owned = all.filter((o) => o.owner.toLowerCase() === owner.toLowerCase() && (!requestedNetwork || o.network === requestedNetwork));
    const views = await Promise.all(owned.map(async (order) => {
      try {
        const { publicClient } = clients(order.network);
        const record = order.version === "oco-v1"
          ? await publicClient.readContract({ address: order.account as `0x${string}`, abi: ocoAbi, functionName: "positions", args: [BigInt(order.orderId)] })
          : order.version === "bracket-v1"
            ? await publicClient.readContract({ address: order.account as `0x${string}`, abi: bracketAbi, functionName: "orders", args: [BigInt(order.orderId)] })
            : await publicClient.readContract({ address: order.account as `0x${string}`, abi: limitAbi, functionName: "orders", args: [BigInt(order.orderId)] });
        const state = Number(record.at(-1));
        const lifecycle = reconcileOrderLifecycle(order.version, state, order);
        const ticker = await getTicker(order.instId);
        const currentPrice = ticker.last;
        let entryPrice = order.entryPrice;
        if (order.version === "bracket-v1" && (state === 3 || state === 4) && BigInt(record[5] as bigint) > 0n) {
          const [sellDecimals, buyDecimals] = await Promise.all([
            publicClient.readContract({ address: order.sellToken as `0x${string}`, abi: erc20DecimalsAbi, functionName: "decimals" }),
            publicClient.readContract({ address: order.buyToken as `0x${string}`, abi: erc20DecimalsAbi, functionName: "decimals" }),
          ]);
          const spent = Number(record[4] as bigint) / 10 ** Number(sellDecimals);
          const received = Number(record[5] as bigint) / 10 ** Number(buyDecimals);
          if (spent > 0 && received > 0) entryPrice = Boolean(record[12]) ? received / spent : spent / received;
        }
        const view: RegisteredOrder = {
          ...order,
          ...lifecycle,
          lastError: order.lastError,
          currentPrice,
          ...(entryPrice ? { entryPrice } : {}),
          estimatedPnlPct: (order.version === "oco-v1" || (order.version === "bracket-v1" && (state === 3 || state === 4))) && Boolean(entryPrice && entryPrice > 0)
            ? ((currentPrice - entryPrice!) / entryPrice!) * 100
            : null,
          triggerPrice: Number(record[order.version === "oco-v1" ? 3 : order.version === "bracket-v1" ? lifecycle.phase === "entry" ? 6 : 7 : 5]) / 1e18,
          secondaryTriggerPrice: order.version === "oco-v1" ? Number(record[4]) / 1e18 : order.version === "bracket-v1" && lifecycle.phase !== "entry" ? Number(record[8]) / 1e18 : null,
          takeProfit: order.version === "bracket-v1" ? Number(record[7]) / 1e18 : order.version === "oco-v1" ? Number(record[3]) / 1e18 : null,
          stopLoss: order.version === "bracket-v1" ? Number(record[8]) / 1e18 : order.version === "oco-v1" ? Number(record[4]) / 1e18 : null,
          triggerAbove: order.version === "limit-v2" ? Boolean(record[9]) : order.version === "bracket-v1" ? Boolean(record[12]) : null,
          expiry: new Date(Number(record[order.version === "oco-v1" ? 5 : order.version === "bracket-v1" ? 10 : 7]) * 1000).toISOString(),
        };
        Object.assign(order, view, { updatedAt: new Date().toISOString() });
        return view;
      } catch (error) {
        return {
          ...order,
          // A provider outage is not an on-chain failure. Preserve the last
          // reconstructed state and let the UI report degraded telemetry.
          lastError: `Live state temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }));
    await save(all);
    res.json({ orders: views });
  }));
  router.post("/v1/automation/orders", asyncRoute(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const verified = await verifyRegistration(parsed.data);
      const items = await list();
      const id = `${parsed.data.network}:${parsed.data.account.toLowerCase()}:${parsed.data.orderId}`;
      const now = new Date().toISOString();
      const item: RegisteredOrder = {
        ...parsed.data,
        id,
        status: "active",
        phase: parsed.data.version === "oco-v1" ? "protected" : "entry",
        onchainState: 1,
        createdAt: now,
        updatedAt: now,
        ...(verified.entryPrice ? { entryPrice: verified.entryPrice } : {}),
        executionPair: verified.executionPair,
      };
      await save([...items.filter((o) => o.id !== id), item]);
      // The next owner refresh must not receive the account snapshot from just
      // before this order was created.
      discoveryCache.delete(`${parsed.data.network}:${parsed.data.owner.toLowerCase()}`);
      res.status(201).json({ order: item });
    } catch (error) {
      if (isKvUnavailableError(error)) throw error;
      res
        .status(transientRpcFailure(error) ? 503 : 422)
        .json({
          error: error instanceof Error ? error.message : String(error),
          retryable: transientRpcFailure(error),
        });
    }
  }));
  return router;
}

const oracleAbi = [
  {
    type: "function",
    name: "setPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "base", type: "address" },
      { name: "quote", type: "address" },
      { name: "price", type: "uint192" },
      { name: "maxAge", type: "uint64" },
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
      { name: "router", type: "address" },
      { name: "spender", type: "address" },
      { name: "sellToken", type: "address" },
      { name: "buyToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "minOut", type: "uint256" },
      { name: "routerCalldata", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;
const ocoAbi = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "asset", type: "address" },
      { name: "settlement", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "takeProfit", type: "uint128" },
      { name: "stopLoss", type: "uint128" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "state", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "executeExit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "adapter", type: "address" },
      { name: "adapterData", type: "bytes" },
      { name: "minOut", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;
const limitAbi = [
  {
    type: "function",
    name: "orders",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "sellToken", type: "address" },
      { name: "buyToken", type: "address" },
      { name: "oracleBase", type: "address" },
      { name: "oracleQuote", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "triggerPrice", type: "uint128" },
      { name: "minOut", type: "uint128" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "triggerAbove", type: "bool" },
      { name: "state", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "adapter", type: "address" },
      { name: "adapterData", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;
const bracketAbi = [
  {
    type: "function", name: "orders", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "sellToken", type: "address" }, { name: "buyToken", type: "address" },
      { name: "oracleBase", type: "address" }, { name: "oracleQuote", type: "address" },
      { name: "entryAmount", type: "uint128" }, { name: "positionAmount", type: "uint128" },
      { name: "entryTrigger", type: "uint128" }, { name: "takeProfit", type: "uint128" },
      { name: "stopLoss", type: "uint128" }, { name: "entryMinOut", type: "uint128" },
      { name: "expiry", type: "uint64" }, { name: "nonce", type: "uint64" },
      { name: "triggerAbove", type: "bool" }, { name: "protectAfterFill", type: "bool" },
      { name: "state", type: "uint8" },
    ],
  },
  { type: "function", name: "executeEntry", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }, { name: "adapter", type: "address" }, { name: "adapterData", type: "bytes" }], outputs: [{ name: "amountOut", type: "uint256" }] },
  { type: "function", name: "executeExit", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }, { name: "adapter", type: "address" }, { name: "adapterData", type: "bytes" }, { name: "minOut", type: "uint256" }], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;
let running = false;
export async function runTradeAutomationCycle(cfg: AppConfig) {
  if (running) return;
  running = true;
  try {
    const rawKey = (cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY) as `0x${string}`;
    if (!/^0x[a-fA-F0-9]{64}$/.test(rawKey || "")) return;
    const items = await list();
    for (const item of items
      .filter((o) => o.status === "active" || o.status === "paused")
      .slice(0, 100)) {
      try {
        const net = networks[item.network];
        const oracle = net.oracle();
        const adapter = net.adapter();
        const approvedRouter = net.router();
        const approvedSpender = net.spender();
        if (
          !address.test(oracle || "") ||
          !address.test(adapter || "") ||
          !address.test(approvedRouter || "") ||
          !address.test(approvedSpender || "")
        )
          throw new Error("Automation contract/router configuration missing");
        const { publicClient, walletClient } = clients(item.network, rawKey);
        if (!walletClient) throw new Error("Executor unavailable");
        const record =
          item.version === "oco-v1"
            ? await publicClient.readContract({
                address: item.account as `0x${string}`,
                abi: ocoAbi,
                functionName: "positions",
                args: [BigInt(item.orderId)],
              })
            : item.version === "bracket-v1"
              ? await publicClient.readContract({ address: item.account as `0x${string}`, abi: bracketAbi, functionName: "orders", args: [BigInt(item.orderId)] })
              : await publicClient.readContract({
                  address: item.account as `0x${string}`,
                  abi: limitAbi,
                  functionName: "orders",
                  args: [BigInt(item.orderId)],
                });
        const state = Number(record.at(-1));
        const bracketProtected = item.version === "bracket-v1" && state === 3;
        Object.assign(item, reconcileOrderLifecycle(item.version, state, item));
        if (state === 2 || (item.version === "bracket-v1" && state === 4)) {
          item.updatedAt = new Date().toISOString();
          continue;
        }
        if (state !== 1 && !bracketProtected) {
          item.updatedAt = new Date().toISOString();
          continue;
        }
        if (item.status === "paused") {
          item.status = "active";
          item.updatedAt = new Date().toISOString();
        }
        item.lastError = undefined;
        const ticker = await getTicker(item.instId);
        const price = parseUnits(ticker.last.toFixed(18), 18);
        const triggered =
          item.version === "oco-v1"
            ? price >= (record[3] as bigint) || price <= (record[4] as bigint)
            : item.version === "bracket-v1"
              ? bracketProtected
                ? price >= (record[7] as bigint) || price <= (record[8] as bigint)
                : record[12] ? price >= (record[6] as bigint) : price <= (record[6] as bigint)
              : record[9]
                ? price >= (record[5] as bigint)
                : price <= (record[5] as bigint);
        if (!triggered) continue;
        const base = (item.version === "oco-v1" ? item.sellToken : bracketProtected ? record[1] : record[2]) as `0x${string}`;
        const quote = (item.version === "oco-v1" ? item.buyToken : bracketProtected ? record[0] : record[3]) as `0x${string}`;
        const priceHash = await walletClient.writeContract({
          address: oracle as `0x${string}`,
          abi: oracleAbi,
          functionName: "setPrice",
          args: [base, quote, price, 300n],
        });
        await publicClient.waitForTransactionReceipt({ hash: priceHash });
        const amount = (item.version === "oco-v1" ? record[2] : bracketProtected ? record[5] : record[4]) as bigint;
        const swapFrom = (bracketProtected ? record[1] : item.sellToken) as string;
        const swapTo = (bracketProtected ? record[0] : item.buyToken) as string;
        const prepared = await getGenericOkxSwap(cfg, {
          chainId: String(net.id),
          fromTokenAddress: swapFrom,
          toTokenAddress: swapTo,
          amount: String(amount),
          userWalletAddress: adapter!,
          slippagePercent: "0.5",
        });
        if (
          prepared.tx.to.toLowerCase() !== approvedRouter!.toLowerCase() ||
          BigInt(prepared.tx.value) !== 0n
        )
          throw new Error(
            `Prepared route target ${prepared.tx.to} (value ${prepared.tx.value}) does not match approved zero-value router ${approvedRouter}`,
          );
        const quoted = BigInt(String(prepared.quote?.toTokenAmount || "0"));
        const minOut =
          item.version === "oco-v1" || bracketProtected
            ? (quoted * 99n) / 100n
            : item.version === "bracket-v1" ? (record[9] as bigint) : (record[6] as bigint);
        const adapterData = encodeFunctionData({
          abi: adapterAbi,
          functionName: "execute",
          args: [
            approvedRouter as `0x${string}`,
            approvedSpender as `0x${string}`,
            swapFrom as `0x${string}`,
            swapTo as `0x${string}`,
            amount,
            minOut,
            prepared.tx.data as `0x${string}`,
          ],
        });
        let executionHash: `0x${string}`;
        if (item.version === "oco-v1") {
          const simulation = await publicClient.simulateContract({
            address: item.account as `0x${string}`,
            abi: ocoAbi,
            functionName: "executeExit",
            args: [
              BigInt(item.orderId),
              adapter as `0x${string}`,
              adapterData,
              minOut,
            ],
            account: walletClient.account,
          });
          executionHash = await walletClient.writeContract(simulation.request);
        } else if (item.version === "limit-v2") {
          const simulation = await publicClient.simulateContract({
            address: item.account as `0x${string}`,
            abi: limitAbi,
            functionName: "execute",
            args: [BigInt(item.orderId), adapter as `0x${string}`, adapterData],
            account: walletClient.account,
          });
          executionHash = await walletClient.writeContract(simulation.request);
        } else {
          if (bracketProtected) {
            const simulation = await publicClient.simulateContract({ address: item.account as `0x${string}`, abi: bracketAbi, functionName: "executeExit", args: [BigInt(item.orderId), adapter as `0x${string}`, adapterData, minOut], account: walletClient.account });
            executionHash = await walletClient.writeContract(simulation.request);
          } else {
            const simulation = await publicClient.simulateContract({ address: item.account as `0x${string}`, abi: bracketAbi, functionName: "executeEntry", args: [BigInt(item.orderId), adapter as `0x${string}`, adapterData], account: walletClient.account });
            executionHash = await walletClient.writeContract(simulation.request);
          }
        }
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: executionHash,
        });
        if (receipt.status !== "success")
          throw new Error("Automation execution reverted");
        const entryBecomesProtected = item.version === "bracket-v1" && !bracketProtected && Boolean(record[13]);
        const exitsProtectedPosition = item.version === "oco-v1" || bracketProtected;
        const takeProfitReached = exitsProtectedPosition && price >= (record[item.version === "oco-v1" ? 3 : 7] as bigint);
        const executionKind = entryBecomesProtected
          ? "automatic_entry_protected"
          : exitsProtectedPosition
            ? takeProfitReached ? "automatic_take_profit" : "automatic_stop_loss"
            : "automatic_fill";
        if (entryBecomesProtected) {
          item.status = "active";
          item.phase = "protected";
          item.onchainState = 3;
          item.lastAction = "entry_protected";
        } else {
          item.status = "filled";
          item.phase = "complete";
          item.onchainState = item.version === "bracket-v1" ? 5 : 3;
          item.lastAction = takeProfitReached ? "take_profit" : exitsProtectedPosition ? "stop_loss" : "fill";
        }
        item.executionTxHash = executionHash;
        item.lastError = undefined;
        item.updatedAt = new Date().toISOString();
        await recordV6Activity({
          owner: item.owner,
          network: item.network,
          source: item.version === "oco-v1" || item.version === "bracket-v1" ? "spot" : "limit",
          kind: executionKind,
          status: "confirmed",
          txHash: executionHash,
          pair: item.instId,
          executionPair: item.executionPair,
          amount: String(amount),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/NOT_TRIGGERED|STATE|TIME/.test(message)) {
          item.lastError = message.slice(0, 500);
          item.updatedAt = new Date().toISOString();
        }
      }
    }
    await save(items);
  } finally {
    running = false;
  }
}

export function startTradeAutomation(cfg: AppConfig) {
  if (process.env.AUTOMATION_WORKER_ENABLED !== "1") return () => {};
  const run = () =>
    void runTradeAutomationCycle(cfg).catch((error) => {
      if (!isKvUnavailableError(error)) console.error("trade automation cycle failed", error);
    });
  const timer = setInterval(
    run,
    Number(process.env.AUTOMATION_INTERVAL_MS || 30000),
  );
  timer.unref();
  run();
  return () => clearInterval(timer);
}
