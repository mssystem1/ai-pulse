import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  keccak256,
  parseUnits,
  toHex,
} from "viem";
import { API_BASE, apiGet, apiPost } from "./api";
import { createWalletPaidFetch, getInjectedProvider } from "./wallet";
import {
  switchWalletNetwork,
  fetchTokenBalance,
  WEB_NETWORKS,
  type WebNetworkKey,
} from "./networks";
import type { ReportTradeIntent } from "./Report";
import { ExecutionPairPicker, TimeframePicker } from "./Pickers";
import { aggregateAutopilotMetrics, assessBalanceAmount, averageKnownPnl, countExecutedAutopilotFills, hasProtectedAutopilotPosition, selectedAutopilotStrategy } from "./dashboardMetrics";
import {
  DEFAULT_AUTOPILOT_CAPITAL,
  DEFAULT_TRADE_AMOUNT,
  positiveTokenAmount,
} from "./tradeAmounts";

type Capability = {
  network: string;
  spot: {
    visible: boolean;
    enabled: boolean;
    market?: boolean;
    limit?: boolean;
    bracket?: boolean;
    protectedOrders?: boolean;
  };
  autopilot: { visible: boolean; enabled: boolean };
  contracts?: {
    registry?: string | null;
    oracleRouter?: string | null;
    spotFactory?: string | null;
    spotLimitFactory?: string | null;
    spotBracketFactory?: string | null;
    autopilotFactory?: string | null;
  };
  persistence?: string;
  reasons?: Record<string, string>;
};

type Activity = {
  id: string;
  source: string;
  kind: string;
  status: string;
  txHash?: string;
  account?: string;
  pair?: string;
  executionPair?: string;
  amount?: string;
  fillPrice?: number;
  fillInputAmount?: string;
  fillOutputAmount?: string;
  fillInputSymbol?: string;
  fillOutputSymbol?: string;
  fillObservedAt?: string;
  createdAt: string;
};

const EXECUTION_NETWORKS: WebNetworkKey[] = ["xlayer", "base", "arbitrum"];

async function probePairRoute(
  pair: string,
  network: WebNetworkKey,
  erc20Custody = false,
): Promise<{ base: TradeToken; quote: TradeToken } | null> {
  const response = await apiGet(
    `/v1/trading/resolve-pair?network=${network}&pair=${encodeURIComponent(pair)}${erc20Custody ? "&custody=erc20" : ""}`,
  );
  if (!response.ok) return null;
  const result = response.data as {
    available?: boolean;
    base?: TradeToken;
    quote?: TradeToken;
  };
  return result.available && result.base && result.quote
    ? { base: result.base, quote: result.quote }
    : null;
}

async function alternativePairNetworks(
  pair: string,
  excluded: WebNetworkKey,
): Promise<WebNetworkKey[]> {
  const checks = await Promise.all(
    EXECUTION_NETWORKS.filter((network) => network !== excluded).map(
      async (network) => ({
        network,
        route: await probePairRoute(pair, network).catch(() => null),
      }),
    ),
  );
  return checks.filter((item) => item.route).map((item) => item.network);
}
type TradeToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoUrl?: string | null;
  provider?: string;
};
type AutomationOrder = {
  id: string;
  account: string;
  orderId: string;
  version: "oco-v1" | "limit-v2" | "bracket-v1";
  instId: string;
  executionPair?: string;
  status: string;
  amount?: string;
  triggerPrice?: number;
  secondaryTriggerPrice?: number | null;
  triggerAbove?: boolean | null;
  currentPrice?: number | null;
  entryPrice?: number;
  exitPrice?: number;
  realizedPnlPct?: number | null;
  estimatedPnlPct?: number | null;
  markObservedAt?: string;
  markSource?: string;
  expiry?: string;
  lastError?: string;
  executionTxHash?: string;
  lastAction?: "entry_protected" | "take_profit" | "stop_loss" | "fill";
  phase?: "entry" | "protected" | "complete";
  takeProfit?: number | null;
  stopLoss?: number | null;
};
type AutopilotStrategyView = {
  id: string;
  vault: string;
  settlementAsset?: string;
  targetAsset?: string;
  pair: string;
  timeframe: string;
  strategyType?: "trend_following" | "breakout" | "mean_reversion";
  status: string;
  paused?: boolean;
  lastDecision?: string;
  lastRunAt?: string;
  createdAt?: string;
  lastError?: string;
  lastTxHash?: string;
  evidenceHash?: string;
  settlementBalance?: string;
  targetBalance?: string;
  settlementDecimals?: number;
  targetDecimals?: number;
  settlementSymbol?: string;
  targetSymbol?: string;
  portfolioValueAtomic?: string;
  baselineValueAtomic?: string;
  contributionsAtomic?: string;
  withdrawalsAtomic?: string;
  netCashFlowAtomic?: string;
  pnlBasisAtomic?: string;
  pnlAtomic?: string | null;
  pnlPct?: number | null;
  markPrice?: number;
  telemetryError?: string;
  activeTakeProfit?: number;
  activeStopLoss?: number;
  positionEntryPrice?: number;
  lastEntryPrice?: number;
  lastExitPrice?: number;
  realizedPositionPnlPct?: number;
  exitPending?: boolean;
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
  aiPass?: { purchasedAt: string; expiresAt: string; signalLimit: number; signalsUsed: number; pausedAt?: string } | null;
  evaluationCount?: number;
  holdCount?: number;
  filledBuyCount?: number;
  filledSellCount?: number;
  failureCount?: number;
  evaluations?: Array<{
    id: string;
    evaluatedAt: string;
    strategyType: string;
    action: "buy" | "sell" | "hold";
    status: "held" | "filled" | "failed";
    reason: string;
    bias: string;
    confidence: number;
    metrics: Record<string, number | null>;
    rules: Array<{
      id: string;
      label: string;
      passed: boolean;
      observed: string;
      required: string;
      scope: string;
    }>;
    evidenceHash?: string;
    txHash?: string;
    error?: string;
  }>;
};
type AutopilotStrategyCatalogItem = {
  id: string;
  label: string;
  purpose: string;
  entryRules: readonly string[];
  exitRules: readonly string[];
};
export type PotentialGainer = {
  pair: string;
  timeframe: string;
  score: number;
  strategyType: "trend_following" | "breakout" | "mean_reversion";
  technicalReady: boolean;
  reason: string;
  mark: number;
  change24hPct: number;
  rsi14: number;
  volumeRatio: number;
  fetchedAt: string;
};
type AccountSnapshot = {
  accounts: {
    protection: string | null;
    limit: string | null;
    bracket: string | null;
  };
  vaults: Array<{
    address: string;
    settlementAsset: string | null;
    settlementSymbol: string | null;
    settlementDecimals: number | null;
    balanceAtomic: string | null;
    paused: boolean | null;
  }>;
  stale?: boolean;
};

async function fetchAccountSnapshot(
  network: WebNetworkKey,
  owner: string,
  fresh = false,
) {
  const response = await apiGet(
    `/v1/trading/accounts?network=${network}&owner=${owner}${fresh ? "&fresh=1" : ""}`,
  );
  if (!response.ok) throw new Error(errorText(response.data));
  return response.data as AccountSnapshot;
}

async function registerOrRecoverAutomationOrder(input: {
  owner: string;
  network: WebNetworkKey;
  account: string;
  orderId: string;
  version: AutomationOrder["version"];
  instId: string;
  sellToken: string;
  buyToken: string;
  txHash: string;
  fillTxHash?: string;
}) {
  const registration = await apiPost("/v1/automation/orders", input);
  if (registration.ok)
    return {
      monitored: true,
      recovered: false,
      order: (registration.data as { order?: AutomationOrder }).order || null,
    };
  const recovered = await apiGet(
    `/v1/automation/orders?owner=${input.owner}&network=${input.network}&fresh=1`,
  ).catch(() => null);
  const orders = recovered?.ok
    ? (recovered.data as { orders?: AutomationOrder[] }).orders || []
    : [];
  const found = orders.find(
    (order) =>
      order.account.toLowerCase() === input.account.toLowerCase() &&
      order.orderId === input.orderId &&
      order.version === input.version,
  );
  return {
    monitored: Boolean(found),
    recovered: Boolean(found),
    order: found || null,
    error: errorText(registration.data),
  };
}

function upsertAutomationOrder(
  current: AutomationOrder[],
  incoming: AutomationOrder,
) {
  return [incoming, ...current.filter((item) => item.id !== incoming.id)];
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function errorText(value: unknown) {
  if (value && typeof value === "object" && "error" in value)
    return typeof value.error === "string"
      ? value.error
      : JSON.stringify(value.error);
  return "Request failed";
}

export function OpportunityRadar({
  networkKey,
  initialTimeframe = "1H",
  context,
  onAnalyze,
  onPrepare,
}: {
  networkKey: WebNetworkKey;
  initialTimeframe?: string;
  context: "global" | "spot" | "autopilot";
  onAnalyze: (candidate: PotentialGainer) => void;
  onPrepare?: (candidate: PotentialGainer) => void;
}) {
  const [radarTimeframe, setRadarTimeframe] = useState(
    ["15m", "1H", "4H", "1D"].includes(initialTimeframe)
      ? initialTimeframe
      : "1H",
  );
  const [items, setItems] = useState<PotentialGainer[]>([]);
  const [status, setStatus] = useState("Scanning live market structure…");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (["15m", "1H", "4H", "1D"].includes(initialTimeframe))
      setRadarTimeframe(initialTimeframe);
  }, [initialTimeframe]);
  useEffect(() => {
    let current = true;
    setStatus("Scanning live market structure…");
    void apiGet(
      `/v1/opportunities?timeframe=${encodeURIComponent(radarTimeframe)}`,
    ).then((response) => {
      if (!current) return;
      if (!response.ok) {
        setItems([]);
        setStatus(
          "Opportunity scan is temporarily unavailable. Pair search and analysis remain available.",
        );
        return;
      }
      setItems(
        (
          (response.data as { candidates?: PotentialGainer[] }).candidates || []
        ).slice(0, 8),
      );
      setStatus(
        "Technical shortlist from live OKX candles. Premium analysis decides whether a valid Buy setup exists.",
      );
    });
    return () => {
      current = false;
    };
  }, [radarTimeframe]);
  const title =
    context === "global"
      ? "Markets worth analyzing now"
      : context === "spot"
        ? "Find a setup before opening a trade"
        : "Markets worth evaluating for Autopilot";
  return (
    <section
      className={`card potential-gainers opportunity-radar ${context}`}
      aria-label="Market opportunity radar"
    >
      <div className="dashboard-head">
        <div>
          <span className="eyebrow">OPPORTUNITY RADAR · RESEARCH FIRST</span>
          <h3>{title}</h3>
          <p>{status}</p>
        </div>
        <div className="radar-timeframe">
          <span>Timeframe</span>
          <TimeframePicker
            id={`radar-timeframe-${context}`}
            value={radarTimeframe}
            networkKey={networkKey}
            values={["15m", "1H", "4H", "1D"]}
            onChange={setRadarTimeframe}
          />
        </div>
      </div>
      {items.length ? (
        <>
          <div className="potential-gainer-grid">
            {items.slice(0, expanded ? 8 : 4).map((candidate) => (
              <article
                key={`${context}:${candidate.pair}:${candidate.timeframe}`}
              >
                <div>
                  <strong>{candidate.pair}</strong>
                  <span
                    className={
                      candidate.change24hPct >= 0 ? "positive" : "negative"
                    }
                  >
                    {candidate.change24hPct >= 0 ? "+" : ""}
                    {candidate.change24hPct.toFixed(2)}%
                  </span>
                </div>
                <div className="candidate-score">
                  <b>{candidate.score}</b>
                  <span>setup score / 100</span>
                </div>
                <p>{candidate.reason}</p>
                <small>
                  {candidate.strategyType.replaceAll("_", " ")} · RSI{" "}
                  {candidate.rsi14.toFixed(1)} · volume{" "}
                  {candidate.volumeRatio.toFixed(2)}×
                </small>
                <div className="candidate-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onAnalyze(candidate)}
                  >
                    {context === "global"
                      ? "Select for analysis"
                      : "Analyze first"}
                  </button>
                  {onPrepare && (
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => onPrepare(candidate)}
                    >
                      {context === "spot"
                        ? "Preview pair"
                        : "Prepare Autopilot"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {items.length > 4 && (
            <button
              type="button"
              className="radar-more"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? "Show top 4"
                : `Show ${items.length - 4} more candidates`}
            </button>
          )}
        </>
      ) : (
        <div className="empty-dashboard compact">
          <strong>No shortlist loaded</strong>
          <span>{status}</span>
        </div>
      )}
      <div className="candidate-disclaimer">
        <b>How to use this:</b> choose a candidate → either buy Base/Premium
        analysis for a prefilled Spot Market/Limit ticket, or prepare a separate
        Autopilot that evaluates fresh strategy signals. Score alone never
        authorizes a trade. Execution also requires a verified representation,
        live route and sufficient wallet balance on{" "}
        {WEB_NETWORKS[networkKey].label}.
      </div>
    </section>
  );
}

function quantity(value: string) {
  const n = BigInt(value || "0");
  return `0x${n.toString(16)}`;
}
function oraclePrice(value: string) {
  if (!/^\d+(\.\d{1,18})?$/.test(value) || Number(value) <= 0)
    throw new Error("Enter a positive price with up to 18 decimals");
  return parseUnits(value, 18);
}

async function sendPrepared(
  networkKey: WebNetworkKey,
  wallet: string,
  tx: {
    from?: string;
    to: string;
    data: string;
    value?: string;
    gas?: string;
    gasPrice?: string;
  },
) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("Connect an injected wallet first");
  await switchWalletNetwork(provider, networkKey);
  if (!ADDRESS.test(tx.to) || !/^0x[a-fA-F0-9]*$/.test(tx.data))
    throw new Error("Prepared transaction is invalid");
  if (tx.from && tx.from.toLowerCase() !== wallet.toLowerCase())
    throw new Error("Prepared transaction wallet mismatch");
  const request: Record<string, string> = {
    from: wallet,
    to: tx.to,
    data: tx.data,
    value: quantity(tx.value || "0"),
  };
  // Let the connected wallet estimate gas against current state. The OKX gas
  // fields are useful quote hints but can become stale while approval confirms.
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [request],
  });
  if (typeof hash !== "string")
    throw new Error("Wallet returned no transaction hash");
  return hash;
}

const NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const erc20ExecutionAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
] as const;

async function waitForWalletReceipt(
  provider: ReturnType<typeof getInjectedProvider>,
  hash: string,
) {
  if (!provider) throw new Error("Wallet provider disconnected");
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0")
        throw new Error("Transaction reverted on-chain");
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error(
    "Token approval is still pending. Check your wallet, then retry the trade.",
  );
}

async function readTokenBalanceAtomic(
  provider: ReturnType<typeof getInjectedProvider>,
  wallet: string,
  token: string,
) {
  if (!provider) throw new Error("Wallet provider disconnected");
  if (token.toLowerCase() === NATIVE_TOKEN) {
    const value = await provider.request({
      method: "eth_getBalance",
      params: [wallet, "latest"],
    });
    return BigInt(String(value));
  }
  const data = encodeFunctionData({
    abi: erc20ExecutionAbi,
    functionName: "balanceOf",
    args: [wallet as `0x${string}`],
  });
  const value = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return BigInt(String(value));
}

async function ensureSwapAllowance(
  networkKey: WebNetworkKey,
  wallet: string,
  token: string,
  spender: string,
  amount: string,
) {
  if (token.toLowerCase() === NATIVE_TOKEN) return null;
  const provider = getInjectedProvider();
  if (!provider) throw new Error("Connect an injected wallet first");
  await switchWalletNetwork(provider, networkKey);
  const allowanceData = encodeFunctionData({
    abi: erc20ExecutionAbi,
    functionName: "allowance",
    args: [wallet as `0x${string}`, spender as `0x${string}`],
  });
  const raw = await provider.request({
    method: "eth_call",
    params: [{ to: token, data: allowanceData }, "latest"],
  });
  if (typeof raw === "string" && BigInt(raw) >= BigInt(amount)) return null;
  const approvalData = encodeFunctionData({
    abi: erc20ExecutionAbi,
    functionName: "approve",
    args: [spender as `0x${string}`, BigInt(amount)],
  });
  const approvalHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: wallet, to: token, data: approvalData, value: "0x0" }],
  });
  if (typeof approvalHash !== "string")
    throw new Error("Wallet returned no approval transaction hash");
  await waitForWalletReceipt(provider, approvalHash);
  return approvalHash;
}

const factoryAccountAbi = [
  {
    type: "function",
    name: "accountOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "account", type: "address" }],
  },
] as const;
async function findSpotAccount(
  networkKey: WebNetworkKey,
  factory: string,
  owner: string,
) {
  const data = encodeFunctionData({
    abi: factoryAccountAbi,
    functionName: "accountOf",
    args: [owner as `0x${string}`],
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(WEB_NETWORKS[networkKey].rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: attempt + 1,
          method: "eth_call",
          params: [{ to: factory, data }, "latest"],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await response.json()) as {
        result?: `0x${string}`;
        error?: { message?: string };
      };
      if (!response.ok || !body.result)
        throw new Error(
          body.error?.message || `Spot account RPC failed (${response.status})`,
        );
      const account = decodeFunctionResult({
        abi: factoryAccountAbi,
        functionName: "accountOf",
        data: body.result,
      });
      return /^0x0{40}$/i.test(account) ? null : account;
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) =>
          window.setTimeout(resolve, 250 * (attempt + 1)),
        );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not read Spot account");
}

function accountCacheKey(
  network: WebNetworkKey,
  factory: string,
  owner: string,
) {
  return `pulse:onchain-account:${network}:${factory.toLowerCase()}:${owner.toLowerCase()}`;
}
function cachedAccount(network: WebNetworkKey, factory: string, owner: string) {
  const value = localStorage.getItem(accountCacheKey(network, factory, owner));
  return value && ADDRESS.test(value) ? value : null;
}
async function readUint(
  networkKey: WebNetworkKey,
  contract: string,
  functionName: "nextPositionId" | "nextOrderId",
) {
  const abi = [
    {
      type: "function",
      name: functionName,
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "value", type: "uint256" }],
    },
  ] as const;
  const data = encodeFunctionData({ abi, functionName });
  const response = await fetch(WEB_NETWORKS[networkKey].rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "eth_call",
      params: [{ to: contract, data }, "latest"],
    }),
  });
  const body = (await response.json()) as { result?: `0x${string}` };
  if (!body.result) throw new Error("Could not read next order ID");
  return decodeFunctionResult({ abi, functionName, data: body.result });
}

const spotAccountAbi = [
  {
    type: "function",
    name: "createPosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "settlement", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "takeProfit", type: "uint128" },
      { name: "stopLoss", type: "uint128" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "updateProtection",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "takeProfit", type: "uint128" },
      { name: "stopLoss", type: "uint128" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setPaused",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "paused", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAndWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
] as const;
const limitAccountAbi = [
  {
    type: "function",
    name: "createOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sellToken", type: "address" },
      { name: "buyToken", type: "address" },
      { name: "oracleBase", type: "address" },
      { name: "oracleQuote", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "triggerPrice", type: "uint128" },
      { name: "triggerAbove", type: "bool" },
      { name: "minOut", type: "uint128" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "setPaused",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "value", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAndWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelMany",
    stateMutability: "nonpayable",
    inputs: [{ name: "ids", type: "uint256[]" }],
    outputs: [],
  },
] as const;
const bracketAccountAbi = [
  {
    type: "function",
    name: "createOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sellToken", type: "address" },
      { name: "buyToken", type: "address" },
      { name: "oracleBase", type: "address" },
      { name: "oracleQuote", type: "address" },
      { name: "entryAmount", type: "uint128" },
      { name: "entryTrigger", type: "uint128" },
      { name: "triggerAbove", type: "bool" },
      { name: "entryMinOut", type: "uint128" },
      { name: "takeProfit", type: "uint128" },
      { name: "stopLoss", type: "uint128" },
      { name: "protectAfterFill", type: "bool" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelAndWithdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "updateProtection",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "takeProfit", type: "uint128" },
      { name: "stopLoss", type: "uint128" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setPaused",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "value", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const vaultFactoryAbi = [
  {
    type: "function",
    name: "vaultsOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "vaults", type: "address[]" }],
  },
] as const;
const vaultAbi = [
  {
    type: "function",
    name: "updatePolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "next", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "configureAsset",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "allowed", type: "bool" },
      { name: "cap", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "configureLimits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "maxTrade", type: "uint128" },
      { name: "dailyCap", type: "uint128" },
      { name: "slippageBps", type: "uint16" },
      { name: "dailyLossBps", type: "uint16" },
      { name: "cooldown", type: "uint64" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setPaused",
    stateMutability: "nonpayable",
    inputs: [{ name: "value", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
async function findAutopilotVaults(
  networkKey: WebNetworkKey,
  factory: string,
  owner: string,
) {
  const data = encodeFunctionData({
    abi: vaultFactoryAbi,
    functionName: "vaultsOf",
    args: [owner as `0x${string}`],
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(WEB_NETWORKS[networkKey].rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: attempt + 1,
          method: "eth_call",
          params: [{ to: factory, data }, "latest"],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await response.json()) as {
        result?: `0x${string}`;
        error?: { message?: string };
      };
      if (!response.ok || !body.result)
        throw new Error(
          body.error?.message ||
            `Autopilot vault RPC failed (${response.status})`,
        );
      return [
        ...decodeFunctionResult({
          abi: vaultFactoryAbi,
          functionName: "vaultsOf",
          data: body.result,
        }),
      ].map(String);
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) =>
          window.setTimeout(resolve, 250 * (attempt + 1)),
        );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not read Autopilot vaults");
}

function vaultCacheKey(network: WebNetworkKey, factory: string, owner: string) {
  return `pulse:autopilot-vaults:${network}:${factory.toLowerCase()}:${owner.toLowerCase()}`;
}
function cachedVaults(network: WebNetworkKey, factory: string, owner: string) {
  try {
    const values = JSON.parse(
      localStorage.getItem(vaultCacheKey(network, factory, owner)) || "[]",
    );
    return Array.isArray(values)
      ? values.filter(
          (value): value is string =>
            typeof value === "string" && ADDRESS.test(value),
        )
      : [];
  } catch {
    return [];
  }
}

function CapabilityNotice({
  capability,
  type,
}: {
  capability: Capability | null;
  type: "spot" | "autopilot";
}) {
  if (!capability)
    return <div className="v6-notice">Loading live network capabilities…</div>;
  const enabled =
    type === "spot" ? capability.spot.enabled : capability.autopilot.enabled;
  if (enabled)
    return (
      <div className="v6-notice success">
        <span />
        <strong>
          {type === "spot" ? "Live Spot ready" : "Autopilot contracts ready"}
        </strong>
        <small>
          {WEB_NETWORKS[capability.network as WebNetworkKey]?.label ||
            capability.network}{" "}
          · wallet-signed · on-chain activity
        </small>
      </div>
    );
  return (
    <div className="v6-notice warning">
      <span />
      {capability.reasons?.[type] ||
        capability.reasons?.market ||
        `${type} requires production provider and contract configuration.`}
    </div>
  );
}

export function SpotWorkspace({
  networkKey,
  wallet,
  initialPair,
  initialTrade,
  onAnalyzeCandidate,
}: {
  networkKey: WebNetworkKey;
  wallet: string | null;
  initialPair: string;
  initialTrade?: ReportTradeIntent | null;
  onAnalyzeCandidate?: (pair: string, timeframe: string) => void;
}) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [pair, setPair] = useState(initialPair);
  useEffect(() => setPair(initialPair), [initialPair]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [executionMode, setExecutionMode] = useState<"market" | "limit">(
    "market",
  );
  const [baseToken, setBaseToken] = useState<TradeToken | null>(null);
  const [quoteToken, setQuoteToken] = useState<TradeToken | null>(null);
  const [mappingScope, setMappingScope] = useState("");
  const [tokenStatus, setTokenStatus] = useState(
    "Resolving report pair on this network…",
  );
  const [routeStatus, setRouteStatus] = useState("Checking live route…");
  const [routeAvailable, setRouteAvailable] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeAlternatives, setRouteAlternatives] = useState<WebNetworkKey[]>(
    [],
  );
  const [tokenBalances, setTokenBalances] = useState<{
    base: number | null;
    quote: number | null;
  }>({ base: null, quote: null });
  const [fromToken, setFromToken] = useState("");
  const [toToken, setToToken] = useState("");
  const [amount, setAmount] = useState("0");
  const [amountHuman, setAmountHuman] = useState(DEFAULT_TRADE_AMOUNT);
  const [slippage, setSlippage] = useState("0.5");
  const [slippageMode, setSlippageMode] = useState<"auto" | "manual">("auto");
  const [protectAfterFill, setProtectAfterFill] = useState(false);
  const [mappingAttempt, setMappingAttempt] = useState(0);
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [orders, setOrders] = useState<AutomationOrder[]>([]);
  const [activitySyncNotice, setActivitySyncNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [spotAccount, setSpotAccount] = useState<string | null>(null);
  const [spotAccountStatus, setSpotAccountStatus] = useState<
    "idle" | "checking" | "found" | "absent" | "error"
  >("idle");
  const [protectedAsset, setProtectedAsset] = useState("");
  const [settlementAsset, setSettlementAsset] = useState("");
  const [protectedAmount, setProtectedAmount] = useState("");
  const [protectedAmountHuman, setProtectedAmountHuman] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [positionId, setPositionId] = useState("1");
  const [limitAccount, setLimitAccount] = useState<string | null>(null);
  const [limitAccountStatus, setLimitAccountStatus] = useState<
    "idle" | "checking" | "found" | "absent" | "error"
  >("idle");
  const [bracketAccount, setBracketAccount] = useState<string | null>(null);
  const [bracketAccountStatus, setBracketAccountStatus] = useState<
    "idle" | "checking" | "found" | "absent" | "error"
  >("idle");
  const [accountLookupError, setAccountLookupError] = useState("");
  const accountLookupRef = useRef("");
  const lastRefreshAtRef = useRef(0);
  const [limitTrigger, setLimitTrigger] = useState("");
  const [limitMinOut, setLimitMinOut] = useState("");
  const [limitMinOutHuman, setLimitMinOutHuman] = useState("");
  const [limitAbove, setLimitAbove] = useState(false);
  const [limitIds, setLimitIds] = useState("1");

  const executionPair = useMemo(
    () =>
      baseToken && quoteToken
        ? `${baseToken.symbol}/${quoteToken.symbol}`
        : pair.replace("-", "/"),
    [baseToken, quoteToken, pair],
  );
  const spendBalance =
    side === "buy" ? tokenBalances.quote : tokenBalances.base;
  const insufficientBalance =
    spendBalance !== null && Number(amountHuman || 0) > spendBalance;
  const expectedMappingScope = `${networkKey}:${pair}`;

  useEffect(() => {
    if (networkKey === "arc-testnet") return;
    let cancelled = false;
    setBaseToken(null);
    setQuoteToken(null);
    setMappingScope("");
    setFromToken("");
    setToToken("");
    setProtectedAsset("");
    setSettlementAsset("");
    setQuote(null);
    setTokenBalances({ base: null, quote: null });
    setRouteAvailable(false);
    setRouteError("");
    setRouteAlternatives([]);
    setTokenStatus(
      `Mapping ${pair} to ${WEB_NETWORKS[networkKey].label} token contracts…`,
    );
    void apiGet(
      `/v1/trading/resolve-pair?network=${networkKey}&pair=${encodeURIComponent(pair)}`,
    )
      .then((response) => {
        if (cancelled) return;
        const result = response.data as {
          available?: boolean;
          base?: TradeToken;
          quote?: TradeToken;
          explanation?: string;
          reason?: string;
        };
        // A verified token representation and a safely executable route are
        // different facts. Keep the real contracts visible even when OKX
        // rejects the route, but never enable an order without both.
        const resolvedBase = response.ok ? result.base || null : null;
        const resolvedQuote = response.ok ? result.quote || null : null;
        setBaseToken(resolvedBase);
        setQuoteToken(resolvedQuote);
        setMappingScope(`${networkKey}:${pair}`);
        setTokenStatus(
          resolvedBase && resolvedQuote
            ? `${resolvedBase.symbol}/${resolvedQuote.symbol} is the required ${WEB_NETWORKS[networkKey].label} settlement pair. Verifying a live OKX route…`
            : `${pair} is available for analysis, but no complete on-chain token mapping was found on ${WEB_NETWORKS[networkKey].label}. Choose another pair or network.`,
        );
        setTokenStatus(
          resolvedBase && resolvedQuote
            ? result.available
              ? result.explanation || `${pair} executes as ${resolvedBase.symbol}/${resolvedQuote.symbol} on ${WEB_NETWORKS[networkKey].label}.`
              : `${resolvedBase.symbol} and ${resolvedQuote.symbol} exist on ${WEB_NETWORKS[networkKey].label}, but they are not a safely executable pair right now.`
            : result.reason ||
                `${pair} is available for analysis, but no verified on-chain representation was found on ${WEB_NETWORKS[networkKey].label}. PULSE is checking other networks.`,
        );
      })
      .catch(
        (error) =>
          !cancelled &&
          setTokenStatus(
            error instanceof Error ? error.message : String(error),
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [pair, networkKey, mappingAttempt]);

  useEffect(() => {
    if (networkKey === "arc-testnet") {
      setRouteAvailable(false);
      return;
    }
    if (mappingScope !== expectedMappingScope) {
      setRouteAvailable(false);
      setRouteStatus("Mapping the selected pair on this network…");
      return;
    }
    if (!baseToken || !quoteToken) {
      setRouteAvailable(false);
      setRouteStatus("No executable token mapping on this network");
      let cancelled = false;
      void alternativePairNetworks(pair, networkKey).then((items) => {
        if (!cancelled) setRouteAlternatives(items);
      });
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    setRouteAvailable(false);
    setRouteError("");
    setRouteStatus("Checking live OKX route…");
    void apiPost("/v1/trading/quote", {
      network: networkKey,
      fromTokenAddress: quoteToken.address,
      toTokenAddress: baseToken.address,
      amount: parseUnits("1", quoteToken.decimals).toString(),
      slippagePercent: 1,
    })
      .then((response) => {
        if (cancelled) return;
        setRouteAvailable(response.ok);
        setRouteError(response.ok ? "" : errorText(response.data));
        setRouteStatus(
          response.ok
            ? `Live ${baseToken.symbol}/${quoteToken.symbol} route verified`
            : "Live route check needs a retry",
        );
        if (response.ok) setRouteAlternatives([]);
        else
          void alternativePairNetworks(pair, networkKey).then(
            (items) => {
              if (!cancelled) setRouteAlternatives(items);
            },
          );
      })
      .catch((error) => {
        if (!cancelled) {
          setRouteAvailable(false);
          setRouteError(error instanceof Error ? error.message : String(error));
          setRouteStatus("Live route check needs a retry");
          void alternativePairNetworks(pair, networkKey).then(
            (items) => {
              if (!cancelled) setRouteAlternatives(items);
            },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseToken, quoteToken, mappingScope, expectedMappingScope, networkKey, pair]);

  useEffect(() => {
    if (!wallet || mappingScope !== expectedMappingScope || !baseToken || !quoteToken || networkKey === "arc-testnet") {
      setTokenBalances({ base: null, quote: null });
      return;
    }
    let cancelled = false;
    void Promise.all([
      fetchTokenBalance(
        wallet,
        baseToken.address,
        baseToken.decimals,
        networkKey,
      ),
      fetchTokenBalance(
        wallet,
        quoteToken.address,
        quoteToken.decimals,
        networkKey,
      ),
    ])
      .then(([base, quote]) => {
        if (!cancelled) setTokenBalances({ base, quote });
      })
      .catch(() => {
        if (!cancelled) setTokenBalances({ base: null, quote: null });
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, baseToken, quoteToken, mappingScope, expectedMappingScope, networkKey]);

  useEffect(() => {
    if (mappingScope !== expectedMappingScope) return;
    const sell = side === "buy" ? quoteToken : baseToken;
    const buy = side === "buy" ? baseToken : quoteToken;
    if (sell) setFromToken(sell.address);
    if (buy) setToToken(buy.address);
    if (sell)
      setAmount(
        positiveTokenAmount(amountHuman, sell.decimals)?.toString() || "0",
      );
    if (baseToken) setProtectedAsset(baseToken.address);
    if (quoteToken) setSettlementAsset(quoteToken.address);
    if (baseToken && protectedAmountHuman) {
      try {
        setProtectedAmount(
          parseUnits(protectedAmountHuman, baseToken.decimals).toString(),
        );
      } catch {
        setProtectedAmount("");
      }
    }
    if (buy && limitMinOutHuman) {
      try {
        setLimitMinOut(parseUnits(limitMinOutHuman, buy.decimals).toString());
      } catch {
        setLimitMinOut("");
      }
    }
    setQuote(null);
  }, [
    side,
    baseToken,
    quoteToken,
    mappingScope,
    expectedMappingScope,
    amountHuman,
    protectedAmountHuman,
    limitMinOutHuman,
  ]);

  useEffect(() => {
    const trigger = Number(limitTrigger);
    const spend = Number(amountHuman);
    const slip = Math.min(Math.max(Number(slippage) || 0, 0), 50) / 100;
    if (
      !Number.isFinite(trigger) ||
      trigger <= 0 ||
      !Number.isFinite(spend) ||
      spend <= 0
    ) {
      setLimitMinOutHuman("");
      return;
    }
    const estimate = side === "buy" ? spend / trigger : spend * trigger;
    const safeMinimum = estimate * (1 - slip);
    setLimitMinOutHuman(
      safeMinimum.toLocaleString("en-US", {
        useGrouping: false,
        maximumSignificantDigits: 12,
      }),
    );
  }, [amountHuman, limitTrigger, side, slippage]);

  useEffect(() => {
    if (!initialTrade) return;
    setSide(initialTrade.side);
    setExecutionMode(initialTrade.orderType);
    if (initialTrade.entryPrice)
      setLimitTrigger(String(initialTrade.entryPrice));
    if (initialTrade.takeProfit) setTakeProfit(String(initialTrade.takeProfit));
    if (initialTrade.stopLoss) setStopLoss(String(initialTrade.stopLoss));
    setProtectAfterFill(
      initialTrade.side === "buy" &&
        Boolean(initialTrade.takeProfit && initialTrade.stopLoss),
    );
    setLimitAbove(initialTrade.side === "sell");
  }, [initialTrade]);

  const refresh = useCallback(async (freshOrders = false) => {
    lastRefreshAtRef.current = Date.now();
    // Establish the active chain/wallet scope before the first await. Without
    // this guard, a slower request from the previous tab/network can overwrite
    // the newly selected network's account state.
    const refreshScope = `${networkKey}:${wallet?.toLowerCase() || "disconnected"}`;
    accountLookupRef.current = refreshScope;
    const isCurrentScope = () => accountLookupRef.current === refreshScope;
    const cap = await apiGet(`/v1/trading/capabilities?network=${networkKey}`);
    if (!isCurrentScope()) return;
    if (cap.ok) setCapability(cap.data as Capability);
    else {
      setCapability(null);
      if (wallet && networkKey !== "arc-testnet") {
        setSpotAccountStatus("error");
        setLimitAccountStatus("error");
        setBracketAccountStatus("error");
        setAccountLookupError(
          `Could not load ${WEB_NETWORKS[networkKey].label} contract configuration. Retry when the API is available.`,
        );
      }
    }
    if (wallet && networkKey !== "arc-testnet") {
      let syncNotice = "";
      const history = await apiGet(
        `/v1/trading/activity?network=${networkKey}&address=${wallet}`,
      );
      if (!isCurrentScope()) return;
      if (history.ok) {
        const historyData = history.data as {
          activity?: Activity[];
          persistence?: { state?: string; retryAfterSeconds?: number };
        };
        setActivity(historyData.activity || []);
        if (
          historyData.persistence?.state === "degraded" ||
          historyData.persistence?.state === "recovering"
        ) {
          syncNotice = `Cloud activity storage is reconnecting${historyData.persistence.retryAfterSeconds ? `; retry in about ${historyData.persistence.retryAfterSeconds}s` : ""}. Current activity remains available and will sync automatically.`;
        }
      } else {
        syncNotice =
          "Cloud activity storage is temporarily unreachable. Existing activity remains visible; PULSE will reconnect automatically.";
      }
      const registered = await apiGet(
        `/v1/automation/orders?owner=${wallet}&network=${networkKey}${freshOrders ? "&fresh=1" : ""}`,
      );
      if (!isCurrentScope()) return;
      if (registered.ok)
        setOrders(
          (registered.data as { orders?: AutomationOrder[] }).orders || [],
        );
      else
        syncNotice ||=
          "Order monitoring is reconnecting. Existing rows remain visible and execution continues on-chain.";
      setActivitySyncNotice(syncNotice);
      if (cap.ok) {
        const contracts = (cap.data as Capability).contracts;
        const lookupId = `${refreshScope}:${contracts?.spotFactory || ""}:${contracts?.spotLimitFactory || ""}:${contracts?.spotBracketFactory || ""}`;
        accountLookupRef.current = lookupId;
        setAccountLookupError("");
        for (const [factory, setter] of [
          [contracts?.spotFactory, setSpotAccount],
          [contracts?.spotLimitFactory, setLimitAccount],
          [contracts?.spotBracketFactory, setBracketAccount],
        ] as const) {
          if (factory) {
            const remembered = cachedAccount(networkKey, factory, wallet);
            if (remembered) setter(remembered);
          }
        }
        setSpotAccountStatus(contracts?.spotFactory ? "checking" : "error");
        setLimitAccountStatus(
          contracts?.spotLimitFactory ? "checking" : "error",
        );
        setBracketAccountStatus(
          contracts?.spotBracketFactory ? "checking" : "absent",
        );
        try {
          const snapshot = await fetchAccountSnapshot(networkKey, wallet);
          if (accountLookupRef.current !== lookupId) return;
          const apply = (
            found: string | null,
            factory: string | null | undefined,
            setter: (value: string | null) => void,
            setStatus: (value: "found" | "absent") => void,
          ) => {
            setter(found);
            setStatus(found ? "found" : "absent");
            if (factory && found)
              localStorage.setItem(
                accountCacheKey(networkKey, factory, wallet),
                found,
              );
            else if (factory)
              localStorage.removeItem(
                accountCacheKey(networkKey, factory, wallet),
              );
          };
          apply(
            snapshot.accounts.protection,
            contracts?.spotFactory,
            setSpotAccount,
            setSpotAccountStatus,
          );
          apply(
            snapshot.accounts.limit,
            contracts?.spotLimitFactory,
            setLimitAccount,
            setLimitAccountStatus,
          );
          apply(
            snapshot.accounts.bracket,
            contracts?.spotBracketFactory,
            setBracketAccount,
            setBracketAccountStatus,
          );
          if (snapshot.stale)
            setAccountLookupError(
              "Showing the last confirmed contract snapshot while RPC connectivity recovers.",
            );
        } catch (error) {
          if (accountLookupRef.current === lookupId) {
            setSpotAccountStatus((value) =>
              value === "found" ? value : "error",
            );
            setLimitAccountStatus((value) =>
              value === "found" ? value : "error",
            );
            setBracketAccountStatus((value) =>
              value === "found" ? value : "error",
            );
            setAccountLookupError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        if (!contracts?.spotFactory) {
          setSpotAccountStatus("error");
          setAccountLookupError(
            `Protected-position factory is not configured on ${WEB_NETWORKS[networkKey].label}.`,
          );
        }
        if (!contracts?.spotLimitFactory) {
          setLimitAccountStatus("error");
          setAccountLookupError(
            `Limit-order factory is not configured on ${WEB_NETWORKS[networkKey].label}.`,
          );
        }
        if (!contracts?.spotBracketFactory) setBracketAccountStatus("absent");
      }
    } else {
      setActivity([]);
      setOrders([]);
      setActivitySyncNotice("");
      setSpotAccount(null);
      setLimitAccount(null);
      setBracketAccount(null);
      setSpotAccountStatus("idle");
      setLimitAccountStatus("idle");
      setBracketAccountStatus("idle");
    }
  }, [networkKey, wallet]);
  useEffect(() => {
    accountLookupRef.current = `${networkKey}:${wallet || "disconnected"}:changing`;
    setSpotAccount(null);
    setLimitAccount(null);
    setBracketAccount(null);
    setSpotAccountStatus(wallet ? "checking" : "idle");
    setLimitAccountStatus(wallet ? "checking" : "idle");
    setBracketAccountStatus(wallet ? "checking" : "idle");
    setAccountLookupError("");
  }, [networkKey, wallet]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const needsLiveReconciliation =
    activity.some((item) => item.status === "pending") ||
    orders.some(
      (order) => order.status === "active" || order.status === "paused",
    );
  useEffect(() => {
    if (!wallet || !needsLiveReconciliation || networkKey === "arc-testnet")
      return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [wallet, networkKey, needsLiveReconciliation, refresh]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshAtRef.current >= 60_000
      )
        void refresh();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  async function requestQuote() {
    setBusy("quote");
    setMessage("");
    setQuote(null);
    try {
      if (networkKey === "arc-testnet")
        throw new Error(
          "Spot Trading is intentionally unavailable on Arc Testnet",
        );
      const response = await apiPost("/v1/trading/quote", {
        network: networkKey,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
        amount,
        slippagePercent: Number(slippage),
        slippageMode,
        maxAutoSlippagePercent: Number(slippage),
      });
      if (!response.ok) throw new Error(errorText(response.data));
      setQuote(response.data as Record<string, unknown>);
      setRouteAvailable(true);
      setRouteError("");
      setRouteStatus(
        `Live ${baseToken?.symbol || "asset"}/${quoteToken?.symbol || "settlement"} route verified`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function execute() {
    if (!wallet)
      return setMessage("Connect the wallet you want to trade with.");
    if (insufficientBalance)
      return setMessage(
        `Insufficient ${side === "buy" ? quoteToken?.symbol : baseToken?.symbol} balance for this trade.`,
      );
    if (protectAfterFill && (side !== "buy" || !takeProfit || !stopLoss))
      return setMessage(
        "To attach TP/SL, use Buy and enter both protection levels.",
      );
    let confirmedMarketHash = "";
    setBusy("swap");
    setMessage("");
    try {
      if (networkKey === "arc-testnet")
        throw new Error("Spot Trading is unavailable on Arc Testnet");
      const protectionAccount = protectAfterFill
        ? await ensureProtectionAccount()
        : null;
      const response = await apiPost("/v1/trading/prepare-swap", {
        network: networkKey,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
        amount,
        userWalletAddress: wallet,
        slippagePercent: Number(slippage),
        slippageMode,
        maxAutoSlippagePercent: Number(slippage),
      });
      if (!response.ok) throw new Error(errorText(response.data));
      const prepared = response.data as {
        approvalAddress?: string;
        tx?: {
          from?: string;
          to: string;
          data: string;
          value?: string;
          gas?: string;
          gasPrice?: string;
        };
      };
      const tx = prepared.tx;
      if (!tx) throw new Error("No executable transaction returned");
      if (!prepared.approvalAddress || !ADDRESS.test(prepared.approvalAddress))
        throw new Error("The verified OKX token approval contract is missing");
      const provider = getInjectedProvider();
      const balanceBefore = protectAfterFill
        ? await readTokenBalanceAtomic(provider, wallet, toToken)
        : 0n;
      const approvalHash = await ensureSwapAllowance(
        networkKey,
        wallet,
        fromToken,
        prepared.approvalAddress,
        amount,
      );
      const hash = await sendPrepared(networkKey, wallet, tx);
      if (approvalHash)
        await apiPost("/v1/trading/activity", {
          owner: wallet,
          network: networkKey,
          source: "wallet",
          kind: "token_approval",
          status: "pending",
          txHash: approvalHash,
          pair,
          amount,
        });
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "wallet",
        kind: protectAfterFill
          ? `market_${side}_with_protection`
          : `market_${side}`,
        status: "pending",
        txHash: hash,
        pair,
        executionPair: `${baseToken?.symbol || pair.split("-")[0]}-${quoteToken?.symbol || pair.split("-")[1]}`,
        amount,
      });
      await waitForWalletReceipt(provider, hash);
      confirmedMarketHash = hash;
      let protectionHash = "";
      if (protectAfterFill) {
        const balanceAfter = await readTokenBalanceAtomic(
          provider,
          wallet,
          toToken,
        );
        const received = balanceAfter - balanceBefore;
        if (received <= 0n)
          throw new Error(
            "Market trade confirmed, but no received asset balance was detected for TP/SL protection.",
          );
        protectionHash = await activateProtection(
          received.toString(),
          protectionAccount,
          hash,
        );
      }
      setMessage(
        protectionHash
          ? `Market trade confirmed and TP/SL activated. Protection transaction ${protectionHash}`
          : `Market trade confirmed ${hash}`,
      );
      setQuote(null);
      await refresh();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(
        confirmedMarketHash && protectAfterFill
          ? `Market trade ${confirmedMarketHash} confirmed, but protection is not active: ${detail}. Use the position controls in the dashboard to protect or close the asset.`
          : detail,
      );
    } finally {
      setBusy("");
    }
  }

  async function ensureProtectionAccount() {
    if (spotAccount) return spotAccount;
    if (!wallet || !capability?.contracts?.spotFactory)
      throw new Error(
        "Automatic market protection is not configured on this network.",
      );
    if (spotAccountStatus === "checking")
      throw new Error(
        "PULSE is still checking your existing protection setup. Try again in a moment.",
      );
    if (spotAccountStatus === "error")
      throw new Error(
        "PULSE could not safely verify your existing protection setup. Retry the account check first.",
      );
    const data = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "createAccount",
          stateMutability: "nonpayable",
          inputs: [],
          outputs: [{ name: "account", type: "address" }],
        },
      ],
      functionName: "createAccount",
    });
    const hash = await sendPrepared(networkKey, wallet, {
      to: capability.contracts.spotFactory,
      data,
      value: "0",
    });
    await waitForWalletReceipt(getInjectedProvider(), hash);
    await apiPost("/v1/trading/activity", {
      owner: wallet,
      network: networkKey,
      source: "spot",
      kind: "create_account",
      status: "pending",
      txHash: hash,
    });
    const found = (await fetchAccountSnapshot(networkKey, wallet, true))
      .accounts.protection;
    if (!found)
      throw new Error(
        "Protection setup was confirmed but its account could not yet be rediscovered. Retry after the network updates.",
      );
    setSpotAccount(found);
    setSpotAccountStatus("found");
    localStorage.setItem(
      accountCacheKey(networkKey, capability.contracts.spotFactory, wallet),
      found,
    );
    return found;
  }

  async function createSpotAccount() {
    if (!wallet || !capability?.contracts?.spotFactory)
      return setMessage(
        "Connect a wallet and configure the Spot factory address first.",
      );
    setBusy("account");
    setMessage("");
    try {
      await ensureProtectionAccount();
      setMessage("Market protection is ready for this wallet and network.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function createLimitAccount() {
    if (!wallet || !capability?.contracts?.spotLimitFactory)
      return setMessage(
        "Connect a wallet and configure the Limit factory first.",
      );
    setBusy("limit-account");
    setMessage("");
    try {
      const data = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "createAccount",
            stateMutability: "nonpayable",
            inputs: [],
            outputs: [{ name: "account", type: "address" }],
          },
        ],
        functionName: "createAccount",
      });
      const hash = await sendPrepared(networkKey, wallet, {
        to: capability.contracts.spotLimitFactory,
        data,
        value: "0",
      });
      await waitForWalletReceipt(getInjectedProvider(), hash);
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "limit",
        kind: "create_limit_account",
        status: "pending",
        txHash: hash,
      });
      setMessage(`Limit account created ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function createBracketAccount() {
    if (!wallet || !capability?.contracts?.spotBracketFactory)
      return setMessage(
        "The Limit + TP/SL factory is not configured on this network.",
      );
    setBusy("bracket-account");
    setMessage("");
    try {
      const data = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "createAccount",
            stateMutability: "nonpayable",
            inputs: [],
            outputs: [{ name: "account", type: "address" }],
          },
        ],
        functionName: "createAccount",
      });
      const hash = await sendPrepared(networkKey, wallet, {
        to: capability.contracts.spotBracketFactory,
        data,
        value: "0",
      });
      await waitForWalletReceipt(getInjectedProvider(), hash);
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "limit",
        kind: "create_bracket_account",
        status: "pending",
        txHash: hash,
      });
      setMessage(`Limit + TP/SL account created ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function ensureLimitOrderAccount(useBracket: boolean) {
    const existing = useBracket ? bracketAccount : limitAccount;
    if (existing) return existing;
    const status = useBracket ? bracketAccountStatus : limitAccountStatus;
    const factory = useBracket
      ? capability?.contracts?.spotBracketFactory
      : capability?.contracts?.spotLimitFactory;
    if (!wallet || !factory)
      throw new Error(
        `${useBracket ? "Protected limit" : "Limit"} orders are not configured on this network.`,
      );
    if (status === "checking")
      throw new Error(
        "PULSE is still checking this wallet's order setup. Try again in a moment.",
      );
    if (status === "error")
      throw new Error(
        "PULSE could not safely verify this wallet's existing order setup. Retry the on-chain check first.",
      );
    const data = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "createAccount",
          stateMutability: "nonpayable",
          inputs: [],
          outputs: [{ name: "account", type: "address" }],
        },
      ],
      functionName: "createAccount",
    });
    const hash = await sendPrepared(networkKey, wallet, {
      to: factory,
      data,
      value: "0",
    });
    await waitForWalletReceipt(getInjectedProvider(), hash);
    await apiPost("/v1/trading/activity", {
      owner: wallet,
      network: networkKey,
      source: "limit",
      kind: useBracket ? "create_bracket_account" : "create_limit_account",
      status: "pending",
      txHash: hash,
    });
    const snapshot = await fetchAccountSnapshot(networkKey, wallet, true);
    const found = useBracket
      ? snapshot.accounts.bracket
      : snapshot.accounts.limit;
    if (!found)
      throw new Error(
        "Order setup was confirmed but is not visible from the RPC yet. Retry after the network updates.",
      );
    if (useBracket) {
      setBracketAccount(found);
      setBracketAccountStatus("found");
    } else {
      setLimitAccount(found);
      setLimitAccountStatus("found");
    }
    localStorage.setItem(accountCacheKey(networkKey, factory, wallet), found);
    return found;
  }

  async function createLimitOrder() {
    const useBracket = protectAfterFill && side === "buy";
    if (!wallet || !ADDRESS.test(fromToken) || !ADDRESS.test(toToken))
      return setMessage(
        "Connect your wallet and wait for PULSE to resolve the execution assets.",
      );
    if (insufficientBalance)
      return setMessage(
        `Insufficient ${side === "buy" ? quoteToken?.symbol : baseToken?.symbol} balance for this order.`,
      );
    setBusy("limit");
    setMessage("");
    try {
      const orderAccount = await ensureLimitOrderAccount(useBracket);
      if (
        ![amount, limitMinOut].every(
          (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
        )
      )
        throw new Error(
          "Enter a positive amount, trigger price and minimum received value.",
        );
      const route = await apiPost("/v1/trading/quote", {
        network: networkKey,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
        amount,
        slippagePercent: Number(slippage),
        slippageMode,
        maxAutoSlippagePercent: Number(slippage),
      });
      if (!route.ok)
        throw new Error(
          `A fresh OKX route could not be verified: ${errorText(route.data)}`,
        );
      setRouteAvailable(true);
      setRouteError("");
      setRouteStatus(
        `Live ${baseToken?.symbol || "asset"}/${quoteToken?.symbol || "settlement"} route verified`,
      );
      const triggerValue = oraclePrice(limitTrigger);
      const takeProfitValue = useBracket ? oraclePrice(takeProfit) : 0n;
      const stopLossValue = useBracket ? oraclePrice(stopLoss) : 0n;
      if (useBracket && takeProfitValue <= stopLossValue)
        throw new Error("Take profit must be higher than stop loss");
      const approvalHash = await ensureSwapAllowance(
        networkKey,
        wallet,
        fromToken,
        orderAccount,
        amount,
      );
      const expectedId = await readUint(
        networkKey,
        orderAccount,
        "nextOrderId",
      );
      const oracleBase = limitAbove ? fromToken : toToken;
      const oracleQuote = limitAbove ? toToken : fromToken;
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
      const data = useBracket
        ? encodeFunctionData({
            abi: bracketAccountAbi,
            functionName: "createOrder",
            args: [
              fromToken as `0x${string}`,
              toToken as `0x${string}`,
              oracleBase as `0x${string}`,
              oracleQuote as `0x${string}`,
              BigInt(amount),
              triggerValue,
              limitAbove,
              BigInt(limitMinOut),
              takeProfitValue,
              stopLossValue,
              true,
              expiry,
            ],
          })
        : encodeFunctionData({
            abi: limitAccountAbi,
            functionName: "createOrder",
            args: [
              fromToken as `0x${string}`,
              toToken as `0x${string}`,
              oracleBase as `0x${string}`,
              oracleQuote as `0x${string}`,
              BigInt(amount),
              triggerValue,
              limitAbove,
              BigInt(limitMinOut),
              expiry,
            ],
          });
      const hash = await sendPrepared(networkKey, wallet, {
        to: orderAccount,
        data,
        value: "0",
      });
      await waitForWalletReceipt(getInjectedProvider(), hash);
      if (approvalHash)
        await apiPost("/v1/trading/activity", {
          owner: wallet,
          network: networkKey,
          source: "limit",
          kind: "limit_approval",
          status: "pending",
          txHash: approvalHash,
          pair,
          amount,
        });
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "limit",
        kind: limitAbove ? "sell_above" : "buy_below",
        status: "pending",
        txHash: hash,
        pair,
        executionPair: `${baseToken?.symbol || pair.split("-")[0]}-${quoteToken?.symbol || pair.split("-")[1]}`,
        amount,
      });
      const registration = await registerOrRecoverAutomationOrder({
        owner: wallet,
        network: networkKey,
        account: orderAccount,
        orderId: String(expectedId),
        version: useBracket ? "bracket-v1" : "limit-v2",
        instId: pair,
        sellToken: fromToken,
        buyToken: toToken,
        txHash: hash,
      });
      if (registration.order)
        setOrders((current) =>
          upsertAutomationOrder(current, registration.order!),
        );
      setMessage(
        registration.monitored
          ? `${useBracket ? "Limit entry with automatic TP/SL" : "Limit order"} submitted and monitored ${hash}`
          : `Order confirmed on-chain ${hash}. Monitoring is reconnecting and will discover it automatically; your owner account remains in control.`,
      );
      // The verified POST result makes the row visible immediately; the fresh
      // read then reconciles the account's authoritative on-chain phase.
      await refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function closeLimitOrders(all: boolean) {
    if (!wallet || !limitAccount) return setMessage("No Limit account");
    setBusy("limit-close");
    setMessage("");
    try {
      const ids = limitIds
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^\d+$/.test(value))
        .map(BigInt);
      if (!ids.length)
        throw new Error("Enter one or more comma-separated order IDs");
      const data = all
        ? encodeFunctionData({
            abi: limitAccountAbi,
            functionName: "cancelMany",
            args: [ids],
          })
        : encodeFunctionData({
            abi: limitAccountAbi,
            functionName: "cancelAndWithdraw",
            args: [ids[0]],
          });
      const hash = await sendPrepared(networkKey, wallet, {
        to: limitAccount,
        data,
        value: "0",
      });
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "limit",
        kind: all ? "close_selected_limits" : "close_limit",
        status: "pending",
        txHash: hash,
        pair,
      });
      setMessage(`Close submitted ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function activateProtection(
    amountAtomic: string,
    accountOverride?: string | null,
    fillTxHash?: string,
  ) {
    const protectionAccount = accountOverride || spotAccount;
    if (
      !wallet ||
      !protectionAccount ||
      !ADDRESS.test(protectedAsset) ||
      !ADDRESS.test(settlementAsset)
    )
      throw new Error(
        "Create your protection account and resolve valid asset contracts first.",
      );
    if (!/^\d+$/.test(amountAtomic) || BigInt(amountAtomic) <= 0n)
      throw new Error("Protection amount must be positive");
    const takeProfitValue = oraclePrice(takeProfit);
    const stopLossValue = oraclePrice(stopLoss);
    if (takeProfitValue <= stopLossValue)
      throw new Error("Take profit must be higher than stop loss");
    const approvalHash = await ensureSwapAllowance(
      networkKey,
      wallet,
      protectedAsset,
      protectionAccount,
      amountAtomic,
    );
    const expectedId = await readUint(
      networkKey,
      protectionAccount,
      "nextPositionId",
    );
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
    const data = encodeFunctionData({
      abi: spotAccountAbi,
      functionName: "createPosition",
      args: [
        protectedAsset as `0x${string}`,
        settlementAsset as `0x${string}`,
        BigInt(amountAtomic),
        takeProfitValue,
        stopLossValue,
        expiry,
      ],
    });
    const hash = await sendPrepared(networkKey, wallet, {
      to: protectionAccount,
      data,
      value: "0",
    });
    await waitForWalletReceipt(getInjectedProvider(), hash);
    if (approvalHash)
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "spot",
        kind: "protection_approval",
        status: "pending",
        txHash: approvalHash,
        pair,
        amount: amountAtomic,
      });
    await apiPost("/v1/trading/activity", {
      owner: wallet,
      network: networkKey,
      source: "spot",
      kind: "protected_position",
      status: "pending",
      txHash: hash,
      pair,
      amount: amountAtomic,
    });
    const registration = await registerOrRecoverAutomationOrder({
      owner: wallet,
      network: networkKey,
      account: protectionAccount,
      orderId: String(expectedId),
      version: "oco-v1",
      instId: pair,
      sellToken: protectedAsset,
      buyToken: settlementAsset,
      txHash: hash,
      fillTxHash,
    });
    if (registration.order)
      setOrders((current) =>
        upsertAutomationOrder(current, registration.order!),
      );
    if (!registration.monitored)
      setMessage(
        `Protection is active on-chain ${hash}. Monitoring is reconnecting and will discover it automatically.`,
      );
    return hash;
  }

  async function createProtectedPosition() {
    setBusy("protect");
    setMessage("");
    try {
      const hash = await activateProtection(protectedAmount);
      setMessage(`Protected position submitted ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function managePosition(
    action: "pause" | "resume" | "update" | "close",
  ) {
    if (!wallet || !spotAccount || !/^\d+$/.test(positionId))
      return setMessage("Enter a valid position ID");
    setBusy(action);
    setMessage("");
    try {
      const id = BigInt(positionId);
      let data: `0x${string}`;
      if (action === "close")
        data = encodeFunctionData({
          abi: spotAccountAbi,
          functionName: "cancelAndWithdraw",
          args: [id],
        });
      else if (action === "pause" || action === "resume")
        data = encodeFunctionData({
          abi: spotAccountAbi,
          functionName: "setPaused",
          args: [id, action === "pause"],
        });
      else {
        data = encodeFunctionData({
          abi: spotAccountAbi,
          functionName: "updateProtection",
          args: [
            id,
            oraclePrice(takeProfit),
            oraclePrice(stopLoss),
            BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
          ],
        });
      }
      const hash = await sendPrepared(networkKey, wallet, {
        to: spotAccount,
        data,
        value: "0",
      });
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "spot",
        kind: action === "close" ? "close_immediately" : `${action}_protection`,
        status: "pending",
        txHash: hash,
        pair,
      });
      setMessage(`${action} submitted ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function closeRegisteredOrder(order: AutomationOrder) {
    if (!wallet || !ADDRESS.test(order.account))
      return setMessage("Connect the order owner wallet");
    setBusy(`close-${order.id}`);
    setMessage("");
    try {
      const data =
        order.version === "oco-v1"
          ? encodeFunctionData({
              abi: spotAccountAbi,
              functionName: "cancelAndWithdraw",
              args: [BigInt(order.orderId)],
            })
          : order.version === "bracket-v1"
            ? encodeFunctionData({
                abi: bracketAccountAbi,
                functionName: "cancelAndWithdraw",
                args: [BigInt(order.orderId)],
              })
            : encodeFunctionData({
                abi: limitAccountAbi,
                functionName: "cancelAndWithdraw",
                args: [BigInt(order.orderId)],
              });
      const hash = await sendPrepared(networkKey, wallet, {
        to: order.account,
        data,
        value: "0",
      });
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: order.version === "oco-v1" ? "spot" : "limit",
        kind: "close_immediately",
        status: "pending",
        txHash: hash,
        pair: order.instId,
        amount: order.amount,
      });
      setMessage(`Close submitted ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function manageBracketOrder(
    order: AutomationOrder,
    action: "update" | "pause" | "resume",
    nextTakeProfit?: string,
    nextStopLoss?: string,
  ) {
    if (!wallet || order.version !== "bracket-v1")
      return setMessage("Connect the bracket account owner wallet.");
    setBusy(`bracket-${action}-${order.id}`);
    setMessage("");
    try {
      const data =
        action === "update"
          ? encodeFunctionData({
              abi: bracketAccountAbi,
              functionName: "updateProtection",
              args: [
                BigInt(order.orderId),
                oraclePrice(nextTakeProfit || ""),
                oraclePrice(nextStopLoss || ""),
                BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
              ],
            })
          : encodeFunctionData({
              abi: bracketAccountAbi,
              functionName: "setPaused",
              args: [BigInt(order.orderId), action === "pause"],
            });
      const hash = await sendPrepared(networkKey, wallet, {
        to: order.account,
        data,
        value: "0",
      });
      await waitForWalletReceipt(getInjectedProvider(), hash);
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "limit",
        kind: `bracket_${action}`,
        status: "pending",
        txHash: hash,
        pair: order.instId,
      });
      setMessage(`Bracket ${action} confirmed ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function closeAllOrders() {
    if (!wallet) return setMessage("Connect the order owner wallet");
    const active = orders.filter(
      (order) => order.status === "active" || order.status === "paused",
    );
    if (!active.length) return setMessage("There are no open orders to close");
    setBusy("close-all");
    setMessage("");
    try {
      const limitGroups = new Map<string, AutomationOrder[]>();
      for (const order of active.filter((item) => item.version === "limit-v2"))
        limitGroups.set(order.account, [
          ...(limitGroups.get(order.account) || []),
          order,
        ]);
      for (const [account, group] of limitGroups) {
        const data = encodeFunctionData({
          abi: limitAccountAbi,
          functionName: "cancelMany",
          args: [group.map((item) => BigInt(item.orderId))],
        });
        const hash = await sendPrepared(networkKey, wallet, {
          to: account,
          data,
          value: "0",
        });
        await waitForWalletReceipt(getInjectedProvider(), hash);
        await apiPost("/v1/trading/activity", {
          owner: wallet,
          network: networkKey,
          source: "limit",
          kind: "close_all_limits",
          status: "pending",
          txHash: hash,
        });
      }
      for (const order of active.filter((item) => item.version === "oco-v1")) {
        const data = encodeFunctionData({
          abi: spotAccountAbi,
          functionName: "cancelAndWithdraw",
          args: [BigInt(order.orderId)],
        });
        const hash = await sendPrepared(networkKey, wallet, {
          to: order.account,
          data,
          value: "0",
        });
        await waitForWalletReceipt(getInjectedProvider(), hash);
        await apiPost("/v1/trading/activity", {
          owner: wallet,
          network: networkKey,
          source: "spot",
          kind: "close_all_positions",
          status: "pending",
          txHash: hash,
          pair: order.instId,
        });
      }
      for (const order of active.filter(
        (item) => item.version === "bracket-v1",
      )) {
        const data = encodeFunctionData({
          abi: bracketAccountAbi,
          functionName: "cancelAndWithdraw",
          args: [BigInt(order.orderId)],
        });
        const hash = await sendPrepared(networkKey, wallet, {
          to: order.account,
          data,
          value: "0",
        });
        await waitForWalletReceipt(getInjectedProvider(), hash);
        await apiPost("/v1/trading/activity", {
          owner: wallet,
          network: networkKey,
          source: "limit",
          kind: "close_bracket",
          status: "pending",
          txHash: hash,
          pair: order.instId,
        });
      }
      setMessage(
        `Closed ${active.length} open order${active.length === 1 ? "" : "s"}.`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  if (networkKey === "arc-testnet")
    return <DisabledArc feature="Spot Trading" />;
  const quoteData = quote?.quote as Record<string, unknown> | undefined;
  const sellAsset = side === "buy" ? quoteToken : baseToken;
  const buyAsset = side === "buy" ? baseToken : quoteToken;
  const mappingReady = Boolean(
    mappingScope === expectedMappingScope &&
      baseToken &&
      quoteToken &&
      ADDRESS.test(fromToken) &&
      ADDRESS.test(toToken) &&
      [baseToken.address.toLowerCase(), quoteToken.address.toLowerCase()].includes(fromToken.toLowerCase()) &&
      [baseToken.address.toLowerCase(), quoteToken.address.toLowerCase()].includes(toToken.toLowerCase()) &&
      fromToken.toLowerCase() !== toToken.toLowerCase(),
  );
  const executionReady = mappingReady && routeAvailable;
  const bracketSelected = protectAfterFill && side === "buy";
  const selectedLimitAccount = bracketSelected ? bracketAccount : limitAccount;
  const selectedLimitAccountStatus = bracketSelected
    ? bracketAccountStatus
    : limitAccountStatus;
  const amountReady = /^\d+$/.test(amount) && BigInt(amount) > 0n;
  const selectedLimitCapabilityReady = bracketSelected
    ? capability?.spot.bracket === true
    : capability?.spot.limit === true;
  const selectedLimitCapabilityReason = selectedLimitCapabilityReady
    ? ""
    : capability
      ? capability.reasons?.[bracketSelected ? "bracket" : "limit"] ||
        capability.reasons?.automation ||
        `${bracketSelected ? "Limit + TP/SL" : "Limit"} execution is not available on this API runtime.`
      : "Loading live execution capability…";
  let quoteHuman = "—";
  if (quoteData?.toTokenAmount && buyAsset) {
    try {
      quoteHuman = Number(
        formatUnits(BigInt(String(quoteData.toTokenAmount)), buyAsset.decimals),
      ).toLocaleString("en-US", { maximumSignificantDigits: 10 });
    } catch {
      quoteHuman = "—";
    }
  }
  return (
    <div className="v6-workspace spot-workspace">
      <section className="v6-heading">
        <div>
          <span className="eyebrow">REPORT-DRIVEN · CONNECTED WALLET</span>
          <h2>Spot execution</h2>
          <p>
            Choose a live pair on this network and trade directly, or load a
            Global Market report to prefill entry, take-profit and stop-loss.
            PULSE verifies the on-chain assets and route before your wallet can sign.
          </p>
        </div>
        <CapabilityNotice capability={capability} type="spot" />
      </section>

      {!initialTrade && (
        <OpportunityRadar
          networkKey={networkKey}
          context="spot"
          onAnalyze={(candidate) =>
            onAnalyzeCandidate?.(candidate.pair, candidate.timeframe)
          }
          onPrepare={(candidate) =>
            onAnalyzeCandidate?.(candidate.pair, candidate.timeframe)
          }
        />
      )}

      {initialTrade ? (
        <section className="report-intent-strip">
          <div>
            <span className="eyebrow">
              LOADED FROM {initialTrade.sourceTier.toUpperCase()} REPORT
            </span>
            <strong>
              {initialTrade.side === "buy" ? "Buy setup" : "Sell / exit setup"}{" "}
              · {initialTrade.pair} · {initialTrade.timeframe}
            </strong>
            <p>{initialTrade.rationale}</p>
          </div>
          <div className="intent-levels">
            <span>
              Entry <b>{initialTrade.entryPrice ?? "live market"}</b>
            </span>
            {initialTrade.takeProfit && (
              <span>
                TP <b>{initialTrade.takeProfit}</b>
              </span>
            )}
            {initialTrade.stopLoss && (
              <span>
                SL <b>{initialTrade.stopLoss}</b>
              </span>
            )}
          </div>
        </section>
      ) : (
        <section className="report-intent-strip neutral">
          <div>
            <span className="eyebrow">DIRECT SPOT MODE</span>
            <strong>Choose a verified pair and build your own trade</strong>
            <p>
              Global Market analysis is recommended, not required. Without a
              report you choose the amount and levels; the same route and wallet
              safety checks still apply.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onAnalyzeCandidate?.(pair, "1H")}
          >
            Go to Global Market
          </button>
        </section>
      )}

      <section
        className="account-discovery-strip trader-readiness"
        aria-label="Trading readiness"
      >
        <div>
          <span>Wallet</span>
          <strong className={wallet ? "found" : "idle"}>
            {wallet ? "Connected" : "Connect wallet"}
          </strong>
        </div>
        <div>
          <span>Market</span>
          <strong className={routeAvailable ? "found" : "checking"}>
            {routeAvailable
              ? "Route ready"
              : mappingReady
                ? "Route unavailable"
                : "Resolving pair"}
          </strong>
        </div>
        <div>
          <span>Automatic orders</span>
          <strong
            className={
              [
                limitAccountStatus,
                bracketAccountStatus,
                spotAccountStatus,
              ].includes("error")
                ? "error"
                : "found"
            }
          >
            {[
              limitAccountStatus,
              bracketAccountStatus,
              spotAccountStatus,
            ].includes("error")
              ? "Check needed"
              : "PULSE manages setup"}
          </strong>
        </div>
        <button
          type="button"
          className="btn btn-soft"
          disabled={!wallet || busy !== ""}
          onClick={() => void refresh()}
        >
          Refresh status
        </button>
      </section>

      <div className="spot-trade-shell">
        <section className="card report-trade-ticket">
          <div className="ticket-header">
            <div>
              <span className="eyebrow">TRADE TICKET</span>
              <h3>{pair}</h3>
            </div>
            <span className="provider-chip">OKX Onchain OS</span>
          </div>
          <div className="execution-pair-control">
            <label htmlFor="spot-execution-pair">Pair on this network</label>
            <ExecutionPairPicker
              id="spot-execution-pair"
              networkKey={networkKey}
              value={pair}
              onSelect={(selected) => {
                setPair(selected.pair);
                setQuote(null);
                setMessage("");
                setSide("buy");
              }}
            />
            <small>
              Choose a pair directly, or load a Global Market report to prefill
              its entry, take-profit and stop-loss levels.
            </small>
          </div>
          <div
            className="trade-mode-tabs"
            role="tablist"
            aria-label="Order type"
          >
            <button
              type="button"
              role="tab"
              aria-selected={executionMode === "market"}
              className={executionMode === "market" ? "active" : ""}
              onClick={() => setExecutionMode("market")}
            >
              Market
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={executionMode === "limit"}
              className={executionMode === "limit" ? "active" : ""}
              onClick={() => setExecutionMode("limit")}
            >
              Limit
            </button>
          </div>
          <div className="segmented side-selector">
            <button
              type="button"
              className={side === "buy" ? "active" : ""}
              onClick={() => setSide("buy")}
            >
              Buy {baseToken?.symbol || pair.split("-")[0]}
            </button>
            <button
              type="button"
              className={side === "sell" ? "active sell" : ""}
              onClick={() => setSide("sell")}
            >
              Sell {baseToken?.symbol || pair.split("-")[0]}
            </button>
          </div>

          <div
            className={`asset-resolution ${executionReady ? "ready" : "warning"}`}
          >
            <div className="asset-route">
              <div>
                <span>You spend</span>
                <strong>{sellAsset?.symbol || "Not mapped"}</strong>
                <small>
                  {sellAsset
                    ? `${sellAsset.name} · Wallet ${spendBalance == null ? (wallet ? "balance unavailable" : "connect to check") : spendBalance.toLocaleString("en-US", { maximumSignificantDigits: 8 })}`
                    : "Select a supported on-chain asset"}
                </small>
              </div>
              <i>→</i>
              <div>
                <span>You receive</span>
                <strong>{buyAsset?.symbol || "Not mapped"}</strong>
                <small>
                  {buyAsset
                    ? `${buyAsset.name} · Wallet ${(side === "buy" ? tokenBalances.base : tokenBalances.quote) == null ? (wallet ? "balance unavailable" : "connect to check") : (side === "buy" ? tokenBalances.base : tokenBalances.quote)?.toLocaleString("en-US", { maximumSignificantDigits: 8 })}`
                    : "Select a supported on-chain asset"}
                </small>
              </div>
            </div>
            <p>
              {tokenStatus} {routeStatus}.{" "}
              {baseToken && quoteToken
                ? `Global Market uses ${pair}; ${WEB_NETWORKS[networkKey].label} execution settles as ${executionPair}.`
                : ""}
            </p>
          </div>
          {!mappingReady && (
            <div className="route-suggestion">
              <strong>
                This pair is not executable on {WEB_NETWORKS[networkKey].label}
              </strong>
              {routeAlternatives.length ? (
                <p>
                  Switch <b>Network &amp; Payment</b> to{" "}
                  {routeAlternatives
                    .map((item) => WEB_NETWORKS[item].label)
                    .join(" or ")}
                  ; PULSE verified the analysis asset, settlement token and a
                  live route there.
                </p>
              ) : (
                <p>
                  PULSE found no identity-safe representation on its supported
                  execution networks. Keep the report for analysis and{" "}
                  <a
                    href={`https://www.okx.com/trade-spot/${pair.toLowerCase()}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    trade this pair on OKX Spot ↗
                  </a>
                  .
                </p>
              )}
              <button
                type="button"
                className="inline-retry"
                onClick={() => setMappingAttempt((value) => value + 1)}
              >
                Retry asset &amp; route lookup
              </button>
            </div>
          )}
          {!routeAvailable && mappingReady && (
            <div className="route-suggestion route-blocked">
              <strong>{executionPair} exists, but Spot execution is blocked</strong>
              <p>
                {routeError ||
                  "OKX Onchain OS did not return a safe live route for this pair on the selected network."}
              </p>
              {routeAlternatives.length ? (
                <p>
                  Choose the same analysis pair after switching <b>Network &amp; Payment</b> to{" "}
                  {routeAlternatives
                    .map((item) => WEB_NETWORKS[item].label)
                    .join(" or ")}
                  , where PULSE verified a live route.
                </p>
              ) : <p>Select another pair in the picker above, or keep this pair for analysis only and trade it on OKX Spot.</p>}
              <button
                type="button"
                className="inline-retry"
                onClick={() => setMappingAttempt((value) => value + 1)}
              >
                Recheck live route
              </button>
            </div>
          )}

          {!executionReady && (
            <div className="execution-unavailable-state" role="status">
              <strong>No order can be created for this selection</strong>
              <span>Choose a pair whose on-chain token, settlement asset and live route are all verified on {WEB_NETWORKS[networkKey].label}. PULSE will then show the Market or Limit ticket with real symbols and balances.</span>
            </div>
          )}

          {executionReady && executionMode === "market" && (
            <>
              <div className="friendly-fields">
                <label
                  className={
                    insufficientBalance || (!amountReady && amountHuman !== "")
                      ? "field-invalid"
                      : ""
                  }
                >
                  <span>
                    Amount to spend{" "}
                    <button
                      type="button"
                      className="amount-max"
                      disabled={spendBalance == null || spendBalance <= 0}
                      onClick={() => setAmountHuman(String(spendBalance || 0))}
                    >
                      Max
                    </button>
                  </span>
                  <div className="unit-input">
                    <input
                      aria-invalid={insufficientBalance}
                      inputMode="decimal"
                      value={amountHuman}
                      placeholder="0.00"
                      onChange={(event) => {
                        setAmountHuman(event.target.value);
                        setQuote(null);
                      }}
                    />
                    <b>{sellAsset?.symbol || "TOKEN"}</b>
                  </div>
                  <small>
                    Available{" "}
                    {spendBalance == null
                      ? "—"
                      : spendBalance.toLocaleString("en-US", {
                          maximumSignificantDigits: 8,
                        })}{" "}
                    {sellAsset?.symbol || ""}
                  </small>
                </label>
                <div className="slippage-control">
                  <span>Slippage</span>
                  <div className="mini-segmented">
                    <button
                      type="button"
                      className={slippageMode === "auto" ? "active" : ""}
                      onClick={() => {
                        setSlippageMode("auto");
                        setQuote(null);
                      }}
                    >
                      Auto
                    </button>
                    <button
                      type="button"
                      className={slippageMode === "manual" ? "active" : ""}
                      onClick={() => {
                        setSlippageMode("manual");
                        setQuote(null);
                      }}
                    >
                      Manual
                    </button>
                  </div>
                  <label>
                    <span>
                      {slippageMode === "auto"
                        ? "Maximum auto slippage"
                        : "Manual slippage"}
                    </span>
                    <div className="unit-input">
                      <input
                        inputMode="decimal"
                        value={slippage}
                        onChange={(event) => {
                          setSlippage(event.target.value);
                          setQuote(null);
                        }}
                      />
                      <b>%</b>
                    </div>
                  </label>
                  <small>
                    {slippageMode === "auto"
                      ? "OKX calculates the route tolerance up to this cap."
                      : "Fixed tolerance applied to this swap."}
                  </small>
                </div>
              </div>
              {side === "buy" && (
                <div
                  className={`attached-protection ${protectAfterFill ? "enabled" : ""}`}
                >
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={protectAfterFill}
                      onChange={(event) =>
                        setProtectAfterFill(event.target.checked)
                      }
                    />
                    <span>
                      <b>Protect this buy with TP / SL</b>
                      <small>
                        Report levels are prefilled and editable. PULSE prepares
                        the one-time owner-controlled setup automatically when
                        needed.
                      </small>
                    </span>
                  </label>
                  {protectAfterFill && (
                    <>
                      <div className="friendly-fields">
                        <label>
                          <span>Take profit</span>
                          <input
                            inputMode="decimal"
                            value={takeProfit}
                            onChange={(event) =>
                              setTakeProfit(event.target.value)
                            }
                          />
                        </label>
                        <label>
                          <span>Stop loss</span>
                          <input
                            inputMode="decimal"
                            value={stopLoss}
                            onChange={(event) =>
                              setStopLoss(event.target.value)
                            }
                          />
                        </label>
                      </div>
                      {spotAccountStatus === "checking" && (
                        <small className="setup-note">
                          Checking your existing protection setup…
                        </small>
                      )}
                      {spotAccountStatus === "absent" && (
                        <small className="setup-note">
                          First protected buy: your wallet will also ask you to
                          create the reusable protection setup.
                        </small>
                      )}
                      {spotAccountStatus === "error" && (
                        <div className="inline-warning">
                          Protection setup could not be checked. Refresh status
                          before trading with TP/SL.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {insufficientBalance && (
                <div className="inline-warning balance-warning">
                  <div>
                    <strong>Route ready — amount exceeds wallet balance</strong>
                    <span>
                      You entered {amountHuman} {sellAsset?.symbol}; this wallet
                      has{" "}
                      {spendBalance?.toLocaleString("en-US", {
                        maximumSignificantDigits: 8,
                      })}{" "}
                      {sellAsset?.symbol}. You can still preview the live quote,
                      but a wallet transaction cannot spend more than the
                      available balance.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => setAmountHuman(String(spendBalance || 0))}
                  >
                    Use available balance
                  </button>
                </div>
              )}
              {!amountReady && amountHuman !== "" && (
                <div className="inline-warning">
                  Enter any positive amount representable in {sellAsset?.symbol || "the selected token"}. There is no fixed fiat minimum.
                </div>
              )}
              {quoteData && (
                <div className="quote-box">
                  <span>Expected output</span>
                  <strong>
                    {quoteHuman} {buyAsset?.symbol}
                  </strong>
                  <small>
                    {String(
                      (quoteData.route as string[] | undefined)?.join(" + ") ||
                        "OKX Onchain OS",
                    )}{" "}
                    · impact {String(quoteData.priceImpactPercent || "—")}% ·
                    refresh before signing
                  </small>
                </div>
              )}
              <div className="ticket-actions">
                <button
                  className="btn btn-soft"
                  disabled={
                    busy !== "" || !mappingReady || BigInt(amount || "0") <= 0n
                  }
                  onClick={() => void requestQuote()}
                >
                  {busy === "quote"
                    ? "Finding route…"
                    : quote
                      ? "Refresh live quote"
                      : "Get live quote"}
                </button>
                <button
                  className={`btn ${side === "buy" ? "btn-primary" : "btn-danger"}`}
                  disabled={
                    busy !== "" ||
                    !quote ||
                    !wallet ||
                    insufficientBalance ||
                    (protectAfterFill && spotAccountStatus === "error")
                  }
                  onClick={() => void execute()}
                >
                  {busy === "swap"
                    ? "Open wallet…"
                    : insufficientBalance
                      ? `Use ${sellAsset?.symbol || "wallet"} balance first`
                      : `Review ${side} in wallet`}
                </button>
              </div>
              {side === "buy" &&
                initialTrade?.takeProfit &&
                !protectAfterFill && (
                  <button
                    type="button"
                    className="next-step-link"
                    onClick={() => setProtectAfterFill(true)}
                  >
                    Use report TP {initialTrade.takeProfit} / SL{" "}
                    {initialTrade.stopLoss} with this market buy
                  </button>
                )}
            </>
          )}

          {executionReady && executionMode === "limit" && (
            <div className="guided-order-panel">
              {side === "buy" && (
                <label className="switch-row attached-protection">
                  <input
                    type="checkbox"
                    checked={protectAfterFill}
                    onChange={(event) =>
                      setProtectAfterFill(event.target.checked)
                    }
                  />
                  <span>
                    <b>Attach TP / SL automatically after the limit fill</b>
                    <small>
                      The bracket account retains only the received asset,
                      activates both report levels, and cancels the remaining
                      exit when one executes.
                    </small>
                  </span>
                </label>
              )}
              <div className="slippage-control limit-slippage-control">
                <span>Limit fill protection</span>
                <div
                  className="mini-segmented"
                  aria-label="Limit slippage mode"
                >
                  <button
                    type="button"
                    className={slippageMode === "auto" ? "active" : ""}
                    aria-pressed={slippageMode === "auto"}
                    onClick={() => setSlippageMode("auto")}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    className={slippageMode === "manual" ? "active" : ""}
                    aria-pressed={slippageMode === "manual"}
                    onClick={() => setSlippageMode("manual")}
                  >
                    Manual
                  </button>
                </div>
                <label>
                  <span>
                    {slippageMode === "auto"
                      ? "Maximum auto slippage"
                      : "Manual slippage"}
                  </span>
                  <div className="unit-input">
                    <input
                      inputMode="decimal"
                      value={slippage}
                      onChange={(event) => setSlippage(event.target.value)}
                    />
                    <b>%</b>
                  </div>
                </label>
                <small>
                  {slippageMode === "auto"
                    ? `Auto is on. The order stores a minimum received amount protected by this ${slippage || "0"}% cap.`
                    : `Manual is on. The order uses this fixed ${slippage || "0"}% tolerance.`}
                </small>
              </div>
              <div className="step-title">
                <span>1</span>
                <div>
                  <strong>
                    {!selectedLimitCapabilityReady
                      ? "Order execution is not ready"
                      : selectedLimitAccount
                      ? "Order setup ready"
                      : selectedLimitAccountStatus === "checking"
                        ? "Checking your existing order setup…"
                        : selectedLimitAccountStatus === "error"
                          ? "Order setup check needs attention"
                          : "PULSE will prepare the order setup when you review"}
                  </strong>
                  <p>
                    {selectedLimitCapabilityReady
                      ? "No contract address or atomic amount is required. If this is your first order on this network, the wallet will show one additional setup transaction."
                      : selectedLimitCapabilityReason}
                  </p>
                </div>
              </div>
              {selectedLimitAccountStatus === "error" && (
                <div className="account-lookup-error">
                  <span>
                    PULSE cannot safely decide whether setup already exists.
                  </span>
                  <small>{accountLookupError}</small>
                  <button
                    className="btn btn-soft"
                    type="button"
                    onClick={() => void refresh()}
                  >
                    Retry on-chain check
                  </button>
                </div>
              )}
              <div className="friendly-fields three">
                <label
                  className={
                    insufficientBalance || (!amountReady && amountHuman !== "")
                      ? "field-invalid"
                      : ""
                  }
                >
                  <span>
                    Amount to spend{" "}
                    <button
                      type="button"
                      className="amount-max"
                      disabled={spendBalance == null || spendBalance <= 0}
                      onClick={() => setAmountHuman(String(spendBalance || 0))}
                    >
                      Max
                    </button>
                  </span>
                  <div className="unit-input">
                    <input
                      aria-invalid={insufficientBalance}
                      inputMode="decimal"
                      value={amountHuman}
                      placeholder="0.00"
                      onChange={(event) => setAmountHuman(event.target.value)}
                    />
                    <b>{sellAsset?.symbol || "token"}</b>
                  </div>
                  <small>
                    Available{" "}
                    {spendBalance == null
                      ? "—"
                      : spendBalance.toLocaleString("en-US", {
                          maximumSignificantDigits: 8,
                        })}{" "}
                    {sellAsset?.symbol || ""}
                  </small>
                </label>
                <label>
                  <span>Trigger price</span>
                  <div className="unit-input">
                    <input
                      inputMode="decimal"
                      value={limitTrigger}
                      onChange={(event) => setLimitTrigger(event.target.value)}
                    />
                    <b>{quoteToken?.symbol || "quote"}</b>
                  </div>
                  <small>
                    {side === "buy"
                      ? "Execute at or below"
                      : "Execute at or above"}
                  </small>
                </label>
                <label>
                  <span>Estimated minimum received</span>
                  <div className="unit-input">
                    <input
                      inputMode="decimal"
                      value={limitMinOutHuman}
                      onChange={(event) =>
                        setLimitMinOutHuman(event.target.value)
                      }
                    />
                    <b>{buyAsset?.symbol || "token"}</b>
                  </div>
                  <small>
                    {slippageMode === "auto"
                      ? `Auto minimum after the ${slippage || "0"}% cap; editable.`
                      : `Minimum after the fixed ${slippage || "0"}% tolerance; editable.`}
                  </small>
                </label>
              </div>
              {bracketSelected && (
                <div className="friendly-fields">
                  <label>
                    <span>Take profit</span>
                    <input
                      inputMode="decimal"
                      value={takeProfit}
                      onChange={(event) => setTakeProfit(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Stop loss</span>
                    <input
                      inputMode="decimal"
                      value={stopLoss}
                      onChange={(event) => setStopLoss(event.target.value)}
                    />
                  </label>
                </div>
              )}
              <div className="order-direction">
                <button
                  type="button"
                  className={!limitAbove ? "active" : ""}
                  onClick={() => {
                    setLimitAbove(false);
                    setSide("buy");
                  }}
                >
                  Buy at or below
                </button>
                <button
                  type="button"
                  className={limitAbove ? "active" : ""}
                  onClick={() => {
                    setLimitAbove(true);
                    setSide("sell");
                  }}
                >
                  Sell at or above
                </button>
              </div>
              {insufficientBalance && (
                <div className="inline-warning balance-warning">
                  <div>
                    <strong>
                      Route ready — order is larger than your balance
                    </strong>
                    <span>
                      You need {amountHuman} {sellAsset?.symbol}; the connected
                      wallet has{" "}
                      {spendBalance?.toLocaleString("en-US", {
                        maximumSignificantDigits: 8,
                      })}{" "}
                      {sellAsset?.symbol}.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => setAmountHuman(String(spendBalance || 0))}
                  >
                    Use available balance
                  </button>
                </div>
              )}
              {!amountReady && amountHuman !== "" && (
                <div className="inline-warning">
                  Enter any positive amount representable in {sellAsset?.symbol || "the selected token"}. There is no fixed fiat minimum.
                </div>
              )}
              {!selectedLimitCapabilityReady && (
                <div className="account-lookup-error" role="status">
                  <span>Limit execution is unavailable on the connected API.</span>
                  <small>{selectedLimitCapabilityReason}</small>
                </div>
              )}
              <button
                className="btn btn-primary full"
                disabled={
                  busy !== "" ||
                  !wallet ||
                  !mappingReady ||
                  !amountReady ||
                  !limitTrigger ||
                  !limitMinOut ||
                  insufficientBalance ||
                  !selectedLimitCapabilityReady ||
                  selectedLimitAccountStatus === "checking" ||
                  selectedLimitAccountStatus === "error" ||
                  (bracketSelected &&
                    (!takeProfit || !stopLoss || !capability?.spot.bracket)) ||
                  (!bracketSelected && !capability?.spot.limit)
                }
                onClick={() => void createLimitOrder()}
              >
                {busy === "limit"
                  ? "Opening wallet…"
                  : insufficientBalance
                    ? `Use ${sellAsset?.symbol || "wallet"} balance first`
                    : !selectedLimitCapabilityReady
                      ? "Limit execution unavailable"
                    : bracketSelected
                      ? "Review limit + TP / SL"
                      : "Review limit order"}
              </button>
            </div>
          )}

          {executionReady && <details className="advanced-panel contract-details">
            <summary>Advanced · token contracts and atomic values</summary>
            <p>
              Normally resolved automatically from the report pair and selected
              network. Change these only when you have independently verified
              the token.
            </p>
            <label>
              Sell token contract
              <input
                className="mono"
                value={fromToken}
                onChange={(event) => {
                  setFromToken(event.target.value);
                  setQuote(null);
                }}
              />
            </label>
            <label>
              Buy token contract
              <input
                className="mono"
                value={toToken}
                onChange={(event) => {
                  setToToken(event.target.value);
                  setQuote(null);
                }}
              />
            </label>
            <div className="advanced-values">
              <span>
                Sell amount atomic <code>{amount}</code>
              </span>
              <span>
                Minimum output atomic <code>{limitMinOut || "not set"}</code>
              </span>
            </div>
          </details>}
          {message && (
            <div className="v6-message" role="status">
              {message}
            </div>
          )}
        </section>

        <aside className="card trade-guidance-card">
          <span className="tier-mark premium">DECISION CHECK</span>
          <h3>Before you sign</h3>
          <ol className="trade-steps">
            <li>
              <b>Report (recommended)</b>
              <span>Use a report for entry, TP/SL and invalidation, or configure the ticket yourself.</span>
            </li>
            <li>
              <b>Amount</b>
              <span>Stay within the available wallet balance or use Max.</span>
            </li>
            <li>
              <b>Route</b>
              <span>Review expected output, price impact and slippage.</span>
            </li>
            <li>
              <b>Protection</b>
              <span>
                Optional TP/SL is part of the Market or Limit ticket and uses
                the levels shown here.
              </span>
            </li>
          </ol>
          <div className="boundary-note">
            <strong>Spot, not Autopilot</strong>
            <p>
              You approve this exact trade. PULSE hides reusable contract setup,
              but your wallet still shows every required signature.
            </p>
          </div>
          <dl className="trade-facts">
            <div>
              <dt>Analysis pair</dt>
              <dd>{pair}</dd>
            </div>
            <div>
              <dt>On-chain route</dt>
              <dd>{executionPair}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{WEB_NETWORKS[networkKey].label}</dd>
            </div>
            <div>
              <dt>Custody</dt>
              <dd>Connected wallet</dd>
            </div>
          </dl>
        </aside>
      </div>

      <ActivityDashboard
        title="Spot orders, protected positions and activity"
        activity={activity.filter((item) => item.source !== "autopilot")}
        networkKey={networkKey}
        onRefresh={refresh}
        orders={orders}
        onCloseOrder={closeRegisteredOrder}
        onManageBracket={manageBracketOrder}
        onCloseAll={closeAllOrders}
        syncNotice={activitySyncNotice}
      />
    </div>
  );

  /* Legacy console below is intentionally unreachable while migrations retain
     its handler references. It will be removed after the PULSE user-flow soak. */
  const q = quote?.quote as Record<string, unknown> | undefined;
  return (
    <div className="v6-workspace">
      <section className="v6-heading">
        <div>
          <span className="eyebrow">INDEPENDENT EXECUTION</span>
          <h2>Spot Trading</h2>
          <p>
            Trade with your connected wallet. Protected TP/SL capital is
            isolated in your own Spot Order Account and is never Autopilot
            capital.
          </p>
        </div>
        <CapabilityNotice capability={capability} type="spot" />
      </section>
      <div className="v6-layout">
        <section className="card order-ticket">
          <div className="segmented">
            <button
              className={side === "buy" ? "active" : ""}
              onClick={() => setSide("buy")}
            >
              Buy
            </button>
            <button
              className={side === "sell" ? "active sell" : ""}
              onClick={() => setSide("sell")}
            >
              Sell
            </button>
          </div>
          <div className="trade-context">
            <span>Selected report pair</span>
            <strong>{pair}</strong>
            <small>
              Execution uses exact chain token addresses, not ticker text.
            </small>
          </div>
          <label>
            Sell token contract
            <input
              className="mono"
              value={fromToken}
              onChange={(e) => {
                setFromToken(e.target.value);
                setQuote(null);
              }}
              placeholder="0x…"
            />
          </label>
          <label>
            Buy token contract
            <input
              className="mono"
              value={toToken}
              onChange={(e) => {
                setToToken(e.target.value);
                setQuote(null);
              }}
              placeholder="0x…"
            />
          </label>
          <div className="row">
            <label>
              Amount (atomic units)
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Max slippage %
              <input
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
              />
            </label>
          </div>
          {q && (
            <div className="quote-box">
              <span>Expected output</span>
              <strong>{String(q?.toTokenAmount || "—")}</strong>
              <small>
                {String(
                  (q?.route as string[] | undefined)?.join(" + ") ||
                    "OKX Onchain OS",
                )}{" "}
                · impact {String(q?.priceImpactPercent || "—")}%
              </small>
            </div>
          )}
          <div className="actions">
            <button
              className="btn btn-soft"
              disabled={
                busy !== "" ||
                !ADDRESS.test(fromToken) ||
                !ADDRESS.test(toToken)
              }
              onClick={() => void requestQuote()}
            >
              {busy === "quote" ? "Quoting…" : "Get live quote"}
            </button>
            <button
              className="btn btn-accent"
              disabled={busy !== "" || !quote || !wallet}
              onClick={() => void execute()}
            >
              {busy === "swap" ? "Open wallet…" : "Review & trade"}
            </button>
          </div>
          {message && <div className="v6-message">{message}</div>}
        </section>
        <section className="card protection-card">
          <span className="tier-mark premium">PROTECTED SPOT</span>
          <h3>Automatic TP / SL / OCO</h3>
          <p>
            Your connected wallet owns an isolated order account. Enter normal
            market prices; PULSE converts them to the contract oracle scale.
          </p>
          <div className="contract-stack">
            <span>Your account</span>
            <code>{spotAccount || "Not created"}</code>
            <span>Oracle router</span>
            <code>
              {capability?.contracts?.oracleRouter || "Not configured"}
            </code>
          </div>
          {!spotAccount ? (
            <button
              className="btn btn-primary full"
              disabled={
                busy !== "" || !capability?.spot.protectedOrders || !wallet
              }
              onClick={() => void createSpotAccount()}
            >
              {busy === "account"
                ? "Creating…"
                : "Create my Spot Order Account"}
            </button>
          ) : (
            <>
              <label>
                Position asset contract
                <input
                  className="mono"
                  value={protectedAsset}
                  onChange={(e) => setProtectedAsset(e.target.value)}
                />
              </label>
              <label>
                Settlement asset contract
                <input
                  className="mono"
                  value={settlementAsset}
                  onChange={(e) => setSettlementAsset(e.target.value)}
                />
              </label>
              <div className="row">
                <label>
                  Amount (atomic)
                  <input
                    value={protectedAmount}
                    onChange={(e) => setProtectedAmount(e.target.value)}
                  />
                </label>
                <label>
                  Position ID
                  <input
                    value={positionId}
                    onChange={(e) => setPositionId(e.target.value)}
                  />
                </label>
              </div>
              <div className="row">
                <label>
                  Take profit price
                  <input
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(e.target.value)}
                  />
                </label>
                <label>
                  Stop loss price
                  <input
                    value={stopLoss}
                    onChange={(e) => setStopLoss(e.target.value)}
                  />
                </label>
              </div>
              <button
                className="btn btn-primary full"
                disabled={busy !== ""}
                onClick={() => void createProtectedPosition()}
              >
                {busy === "protect" ? "Creating…" : "Fund & protect position"}
              </button>
              <div className="actions">
                <button
                  className="btn btn-soft"
                  disabled={busy !== ""}
                  onClick={() => void managePosition("update")}
                >
                  Update TP/SL
                </button>
                <button
                  className="btn btn-soft"
                  disabled={busy !== ""}
                  onClick={() => void managePosition("pause")}
                >
                  Pause
                </button>
                <button
                  className="btn btn-soft"
                  disabled={busy !== ""}
                  onClick={() => void managePosition("resume")}
                >
                  Resume
                </button>
                <button
                  className="btn btn-accent"
                  disabled={busy !== ""}
                  onClick={() => void managePosition("close")}
                >
                  Close now
                </button>
              </div>
            </>
          )}
          <p className="hint">
            Close now cancels automation and returns the asset to your connected
            wallet; use the market ticket to sell it immediately.
          </p>
        </section>
      </div>
      <section className="card limit-panel">
        <div className="dashboard-head">
          <div>
            <span className="eyebrow">OWNER-CONTROLLED CONDITIONAL ENTRY</span>
            <h3>Buy / sell limit orders</h3>
          </div>
          <span className="tier-mark premium">ON-CHAIN LIMIT</span>
        </div>
        <p>
          This is independent from TP/SL protection and Autopilot. It locks only
          the exact sell amount in your connected-wallet-owned Limit account.
        </p>
        <div className="contract-stack">
          <span>Your Limit account</span>
          <code>{limitAccount || "Not created"}</code>
          <span>Factory</span>
          <code>
            {capability?.contracts?.spotLimitFactory || "Not configured"}
          </code>
        </div>
        {!limitAccount ? (
          <button
            className="btn btn-primary"
            disabled={busy !== "" || !capability?.spot.limit || !wallet}
            onClick={() => void createLimitAccount()}
          >
            Create my Limit account
          </button>
        ) : (
          <>
            <div className="segmented">
              <button
                className={!limitAbove ? "active" : ""}
                onClick={() => setLimitAbove(false)}
              >
                Buy below
              </button>
              <button
                className={limitAbove ? "active sell" : ""}
                onClick={() => setLimitAbove(true)}
              >
                Sell above
              </button>
            </div>
            <div className="row">
              <label>
                Trigger price
                <input
                  value={limitTrigger}
                  onChange={(e) => setLimitTrigger(e.target.value)}
                />
              </label>
              <label>
                Minimum output (atomic)
                <input
                  value={limitMinOut}
                  onChange={(e) => setLimitMinOut(e.target.value)}
                />
              </label>
            </div>
            <button
              className="btn btn-accent"
              disabled={
                busy !== "" ||
                !ADDRESS.test(fromToken) ||
                !ADDRESS.test(toToken)
              }
              onClick={() => void createLimitOrder()}
            >
              {busy === "limit" ? "Creating…" : "Create conditional order"}
            </button>
            <div className="row">
              <label>
                Order IDs (comma separated)
                <input
                  value={limitIds}
                  onChange={(e) => setLimitIds(e.target.value)}
                />
              </label>
              <div className="actions">
                <button
                  className="btn btn-soft"
                  disabled={busy !== ""}
                  onClick={() => void closeLimitOrders(false)}
                >
                  Close first
                </button>
                <button
                  className="btn btn-soft"
                  disabled={busy !== ""}
                  onClick={() => void closeLimitOrders(true)}
                >
                  Close selected
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <ActivityDashboard
        title="Spot orders, positions and history"
        activity={activity.filter((a) => a.source !== "autopilot")}
        networkKey={networkKey}
        onRefresh={refresh}
        orders={orders}
        onCloseOrder={closeRegisteredOrder}
        onCloseAll={closeAllOrders}
        syncNotice={activitySyncNotice}
      />
    </div>
  );
}

type AutopilotAccountOption = {
  value: string;
  label: string;
  address: string;
  status: string;
  capital: string;
};

function AutopilotAccountPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly AutopilotAccountOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!selected) return null;
  return (
    <div className="vault-account-picker" ref={root}>
      <button
        type="button"
        className="vault-account-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <small>SELECTED AUTOPILOT</small>
          <strong>{selected.label}</strong>
          <em>{selected.address}</em>
        </span>
        <span className="vault-account-trigger-meta">
          <b>{selected.capital}</b>
          <small>{selected.status}</small>
          <i aria-hidden="true">⌄</i>
        </span>
      </button>
      {open && (
        <div className="vault-account-menu" role="listbox" aria-label="Strategy account">
          <header>
            <small>OWNER-CONTROLLED ACCOUNTS</small>
            <strong>Choose an Autopilot</strong>
            <span>Capital and status are read for the selected network.</span>
          </header>
          <div className="vault-account-options">
            {options.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === selected.value}
                className={option.value === selected.value ? "selected" : ""}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <i>{index + 1}</i>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.address}</small>
                </span>
                <span>
                  <b>{option.capital}</b>
                  <small>{option.status}</small>
                </span>
              </button>
            ))}
          </div>
          <footer>
            <i /> Switch Network &amp; Payment to view accounts on another chain.
          </footer>
        </div>
      )}
    </div>
  );
}

export function AutopilotWorkspace({
  networkKey,
  wallet,
  initialTrade,
  onAnalyzeCandidate,
}: {
  networkKey: WebNetworkKey;
  wallet: string | null;
  initialTrade?: ReportTradeIntent | null;
  onAnalyzeCandidate?: (pair: string, timeframe: string) => void;
}) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [settlement, setSettlement] = useState<string>(
    WEB_NETWORKS[networkKey].payment.address,
  );
  const [pair, setPair] = useState("BTC-USDT");
  const [timeframe, setTimeframe] = useState("4H");
  const [maxTrade, setMaxTrade] = useState("50");
  const [dailyLoss, setDailyLoss] = useState("3");
  const [riskProfile, setRiskProfile] = useState<
    "conservative" | "balanced" | "active"
  >("balanced");
  const [capitalHuman, setCapitalHuman] = useState(DEFAULT_AUTOPILOT_CAPITAL);
  const [capitalAction, setCapitalAction] = useState<"add" | "withdraw">("add");
  const [addAmountHuman, setAddAmountHuman] = useState("");
  const [withdrawAmountHuman, setWithdrawAmountHuman] = useState("");
  const [withdrawAssetMode, setWithdrawAssetMode] = useState<"settlement" | "target">("settlement");
  const [exposurePct, setExposurePct] = useState("50");
  const [dailyTurnoverPct, setDailyTurnoverPct] = useState("100");
  const [maxSlippagePct, setMaxSlippagePct] = useState("1");
  const [strategy, setStrategy] = useState(
    "Trend-following with compact AI confirmation; stop after daily loss cap.",
  );
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activitySyncNotice, setActivitySyncNotice] = useState("");
  const [strategies, setStrategies] = useState<AutopilotStrategyView[]>([]);
  const [strategyCatalog, setStrategyCatalog] = useState<
    AutopilotStrategyCatalogItem[]
  >([]);
  const [aiPolicy, setAiPolicy] = useState<{
    mode?: string;
    maxCallsPerVaultDay?: number;
    maxUsdPerVaultDay?: number;
    commercialPass?: { enabled?: boolean; price24hUsd?: number; price7dUsd?: number; price30dUsd?: number; signalsPerDay?: number; expiryBehavior?: string };
  } | null>(null);
  const [vaults, setVaults] = useState<readonly string[]>([]);
  const [vaultDetails, setVaultDetails] = useState<AccountSnapshot["vaults"]>(
    [],
  );
  const [selectedVault, setSelectedVault] = useState("");
  const createNewVaultRef = useRef(false);
  const [vaultStatus, setVaultStatus] = useState<
    "idle" | "checking" | "found" | "absent" | "error"
  >("idle");
  const [vaultLookupError, setVaultLookupError] = useState("");
  const vaultLookupRef = useRef("");
  const [cooldownSeconds, setCooldownSeconds] = useState("300");
  const [targetAsset, setTargetAsset] = useState("");
  const [targetToken, setTargetToken] = useState<TradeToken | null>(null);
  const [autopilotRouteStatus, setAutopilotRouteStatus] = useState(
    "Checking selected pair…",
  );
  const [autopilotRouteAvailable, setAutopilotRouteAvailable] = useState(false);
  const [autopilotAlternatives, setAutopilotAlternatives] = useState<
    WebNetworkKey[]
  >([]);
  const [autopilotBalances, setAutopilotBalances] = useState<{
    settlement: number | null;
    target: number | null;
  }>({ settlement: null, target: null });
  const [vaultWalletBalance, setVaultWalletBalance] = useState<number | null>(null);
  const [sellAmountAtomic, setSellAmountAtomic] = useState("");
  const [sizingStatus, setSizingStatus] = useState(
    "Enter capital to calculate trade sizing.",
  );
  const [minConfidence, setMinConfidence] = useState("70");
  const [busy, setBusy] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [selectedPassPlan, setSelectedPassPlan] = useState<"24h" | "7d" | "30d">("24h");
  const [preparedCandidate, setPreparedCandidate] = useState("");
  const builderRef = useRef<HTMLElement>(null);
  const [closeConfirming, setCloseConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const settlementDecimals = WEB_NETWORKS[networkKey].payment.decimals;
  const activeStrategy = selectedAutopilotStrategy(strategies, selectedVault);
  const activeVault = vaultDetails.find(
    (item) => item.address.toLowerCase() === selectedVault.toLowerCase(),
  );
  const activeSettlementAsset =
    activeStrategy?.settlementAsset || activeVault?.settlementAsset || settlement;
  const activeSettlementDecimals =
    activeStrategy?.settlementDecimals ??
    activeVault?.settlementDecimals ??
    settlementDecimals;
  const activeSettlementSymbol =
    activeStrategy?.settlementSymbol ||
    activeVault?.settlementSymbol ||
    WEB_NETWORKS[networkKey].payment.symbol;
  const parsedCapital = useMemo(() => {
    return positiveTokenAmount(capitalHuman, settlementDecimals) || 0n;
  }, [capitalHuman, settlementDecimals]);
  const existingVaultCapital =
    activeVault?.balanceAtomic && /^\d+$/.test(activeVault.balanceAtomic)
      ? BigInt(activeVault.balanceAtomic)
      : 0n;
  const reusingFundedVault = Boolean(
    ADDRESS.test(selectedVault) && existingVaultCapital > 0n,
  );
  const effectiveCapital = reusingFundedVault
    ? existingVaultCapital
    : parsedCapital;
  const percentOf = (amountValue: bigint, percentValue: string) =>
    (amountValue *
      BigInt(Math.max(0, Math.round((Number(percentValue) || 0) * 100)))) /
    10_000n;
  const maxTradeAtomic = String(percentOf(effectiveCapital, maxTrade));
  const dailyCapAtomic = String(
    [
      percentOf(effectiveCapital, dailyTurnoverPct),
      BigInt(maxTradeAtomic || "0"),
    ].reduce((a, b) => (a > b ? a : b)),
  );
  const exposureCapAtomic = String(percentOf(effectiveCapital, exposurePct));
  const buyAmountAtomic = maxTradeAtomic;
  const maxSlippageBps = String(
    Math.max(
      5,
      Math.min(1000, Math.round((Number(maxSlippagePct) || 0) * 100)),
    ),
  );
  const maxDailyLossBps = String(
    Math.max(1, Math.min(3000, Math.round((Number(dailyLoss) || 0) * 100))),
  );
  const addAmountAtomic = useMemo(() => {
    try {
      return parseUnits(
        addAmountHuman || "0",
        activeSettlementDecimals,
      ).toString();
    } catch {
      return "0";
    }
  }, [addAmountHuman, activeSettlementDecimals]);
  const withdrawDecimals = withdrawAssetMode === "target"
    ? activeStrategy?.targetDecimals ?? targetToken?.decimals ?? 18
    : activeStrategy?.settlementDecimals ?? settlementDecimals;
  const withdrawAmountAtomic = useMemo(() => {
    try {
      return parseUnits(withdrawAmountHuman || "0", withdrawDecimals).toString();
    } catch {
      return "0";
    }
  }, [withdrawAmountHuman, withdrawDecimals]);
  const withdrawBalanceAtomic = withdrawAssetMode === "target"
    ? activeStrategy?.targetBalance ?? null
    : activeStrategy?.settlementBalance ?? activeVault?.balanceAtomic ?? null;
  const withdrawSymbol = withdrawAssetMode === "target"
    ? activeStrategy?.targetSymbol || targetToken?.symbol || pair.split("-")[0]
    : activeStrategy?.settlementSymbol || WEB_NETWORKS[networkKey].payment.symbol;
  const autopilotInsufficientCapital =
    !reusingFundedVault &&
    autopilotBalances.settlement !== null &&
    Number(capitalHuman || 0) > autopilotBalances.settlement;

  useEffect(() => {
    if (!initialTrade) return;
    setPair(initialTrade.pair);
    if (["15m", "1H", "4H", "1D"].includes(initialTrade.timeframe))
      setTimeframe(initialTrade.timeframe);
  }, [initialTrade]);

  const applyRiskProfile = useCallback(
    (profile: "conservative" | "balanced" | "active") => {
      setRiskProfile(profile);
      const settings =
        profile === "conservative"
          ? {
              trade: "25",
              loss: "2",
              exposure: "25",
              turnover: "60",
              slippage: "0.5",
              cooldown: "900",
              confidence: "80",
            }
          : profile === "active"
            ? {
                trade: "100",
                loss: "5",
                exposure: "100",
                turnover: "200",
                slippage: "1.5",
                cooldown: "120",
                confidence: "60",
              }
            : {
                trade: "50",
                loss: "3",
                exposure: "50",
                turnover: "100",
                slippage: "1",
                cooldown: "300",
                confidence: "70",
              };
      setMaxTrade(settings.trade);
      setDailyLoss(settings.loss);
      setExposurePct(settings.exposure);
      setDailyTurnoverPct(settings.turnover);
      setMaxSlippagePct(settings.slippage);
      setCooldownSeconds(settings.cooldown);
      setMinConfidence(settings.confidence);
    },
    [],
  );
  const refresh = useCallback(async () => {
    const refreshScope = `${networkKey}:${wallet?.toLowerCase() || "disconnected"}`;
    vaultLookupRef.current = refreshScope;
    const isCurrentScope = () => vaultLookupRef.current === refreshScope;
    if (wallet && networkKey !== "arc-testnet") {
      setVaultStatus("checking");
      setVaultLookupError("");
    }
    const cap = await apiGet(`/v1/trading/capabilities?network=${networkKey}`);
    if (!isCurrentScope()) return;
    if (cap.ok) setCapability(cap.data as Capability);
    else {
      setCapability(null);
      if (wallet && networkKey !== "arc-testnet") {
        setVaultStatus("error");
        setVaultLookupError(
          `Could not load ${WEB_NETWORKS[networkKey].label} Autopilot configuration.`,
        );
      }
    }
    if (wallet && networkKey !== "arc-testnet") {
      let syncNotice = "";
      const h = await apiGet(
        `/v1/trading/activity?network=${networkKey}&address=${wallet}`,
      );
      if (!isCurrentScope()) return;
      if (h.ok) {
        const historyData = h.data as {
          activity?: Activity[];
          persistence?: { state?: string; retryAfterSeconds?: number };
        };
        setActivity(historyData.activity || []);
        if (
          historyData.persistence?.state === "degraded" ||
          historyData.persistence?.state === "recovering"
        ) {
          syncNotice = `Cloud activity storage is reconnecting${historyData.persistence.retryAfterSeconds ? `; retry in about ${historyData.persistence.retryAfterSeconds}s` : ""}. Current activity remains available and will sync automatically.`;
        }
      } else {
        syncNotice =
          "Cloud activity storage is temporarily unreachable. Existing activity remains visible; PULSE will reconnect automatically.";
      }
      const runtime = await apiGet(
        `/v1/autopilot/strategies?owner=${wallet}&network=${networkKey}`,
      );
      if (!isCurrentScope()) return;
      if (runtime.ok) {
        const runtimeData = runtime.data as {
          strategies?: AutopilotStrategyView[];
          strategyCatalog?: AutopilotStrategyCatalogItem[];
          aiPolicy?: typeof aiPolicy;
        };
        setStrategies(runtimeData.strategies || []);
        setStrategyCatalog(runtimeData.strategyCatalog || []);
        setAiPolicy(runtimeData.aiPolicy || null);
      } else
        syncNotice ||=
          "Autopilot monitoring is reconnecting. On-chain vault guardrails remain active.";
      setActivitySyncNotice(syncNotice);
      if (cap.ok) {
        const factory = (cap.data as Capability).contracts?.autopilotFactory;
        if (factory) {
          const lookupId = `${refreshScope}:${factory.toLowerCase()}`;
          vaultLookupRef.current = lookupId;
          const remembered = cachedVaults(networkKey, factory, wallet);
          if (remembered.length) {
            setVaults(remembered);
            setSelectedVault((current) =>
              createNewVaultRef.current
                ? ""
                : remembered.includes(current) ? current : remembered.at(-1) || "",
            );
          }
          try {
            const snapshot = await fetchAccountSnapshot(networkKey, wallet);
            const found = snapshot.vaults.map((item) => item.address);
            if (vaultLookupRef.current !== lookupId) return;
            setVaultDetails(snapshot.vaults);
            setVaults(found);
            setSelectedVault((current) =>
              createNewVaultRef.current
                ? ""
                : found.includes(current) ? current : found.at(-1) || "",
            );
            setVaultStatus(found.length ? "found" : "absent");
            if (found.length)
              localStorage.setItem(
                vaultCacheKey(networkKey, factory, wallet),
                JSON.stringify(found),
              );
            else
              localStorage.removeItem(
                vaultCacheKey(networkKey, factory, wallet),
              );
          } catch (error) {
            if (vaultLookupRef.current === lookupId) {
              setVaultStatus("error");
              setVaultLookupError(
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        } else {
          setVaultStatus("error");
          setVaultLookupError(
            `Autopilot factory is not configured on ${WEB_NETWORKS[networkKey].label}.`,
          );
        }
      }
    } else {
      setActivity([]);
      setStrategies([]);
      setAiPolicy(null);
      setActivitySyncNotice("");
      setVaults([]);
      setVaultDetails([]);
      setSelectedVault("");
      setVaultStatus("idle");
    }
  }, [networkKey, wallet]);
  useEffect(() => {
    vaultLookupRef.current = `${networkKey}:${wallet || "disconnected"}:changing`;
    setVaults([]);
    createNewVaultRef.current = false;
    setSelectedVault("");
    setVaultStatus(wallet ? "checking" : "idle");
    setVaultLookupError("");
  }, [networkKey, wallet]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSettlement(WEB_NETWORKS[networkKey].payment.address);
  }, [networkKey]);

  useEffect(() => {
    if (networkKey === "arc-testnet") return;
    let cancelled = false;
    setAutopilotRouteAvailable(false);
    setAutopilotRouteStatus("Checking token contracts and live OKX route…");
    void probePairRoute(pair, networkKey, true)
      .then((route) => {
        if (cancelled) return;
        if (route) {
          setTargetToken(route.base);
          setTargetAsset(route.base.address);
          setSettlement(route.quote.address);
          setAutopilotRouteAvailable(true);
          setAutopilotAlternatives([]);
          setAutopilotRouteStatus(
            `Verified ${route.base.symbol}/${route.quote.symbol} route on ${WEB_NETWORKS[networkKey].label}`,
          );
        } else {
          setTargetToken(null);
          setTargetAsset("");
          setAutopilotRouteStatus(
            `No live route for ${pair} on ${WEB_NETWORKS[networkKey].label}`,
          );
          void alternativePairNetworks(pair, networkKey).then((items) => {
            if (!cancelled) setAutopilotAlternatives(items);
          });
        }
      })
      .catch(() => {
        if (!cancelled) setAutopilotRouteStatus("Could not verify this pair");
      });
    return () => {
      cancelled = true;
    };
  }, [pair, networkKey]);

  useEffect(() => {
    if (!wallet || !ADDRESS.test(settlement)) {
      setAutopilotBalances({ settlement: null, target: null });
      return;
    }
    let cancelled = false;
    setAutopilotBalances({ settlement: null, target: null });
    void Promise.allSettled([
      fetchTokenBalance(
        wallet,
        settlement,
        WEB_NETWORKS[networkKey].payment.decimals,
        networkKey,
      ),
      targetToken
        ? fetchTokenBalance(wallet, targetToken.address, targetToken.decimals, networkKey)
        : Promise.resolve(null),
    ])
      .then(([settlementResult, targetResult]) => {
        if (cancelled) return;
        setAutopilotBalances({
          settlement: settlementResult.status === "fulfilled" ? settlementResult.value : null,
          target: targetResult.status === "fulfilled" ? targetResult.value : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, targetToken, settlement, networkKey, activity]);

  useEffect(() => {
    setAddAmountHuman("");
    setWithdrawAmountHuman("");
    setWithdrawAssetMode("settlement");
  }, [selectedVault]);

  useEffect(() => {
    if (
      !wallet ||
      !selectedVault ||
      !ADDRESS.test(activeSettlementAsset)
    ) {
      setVaultWalletBalance(null);
      return;
    }
    let cancelled = false;
    setVaultWalletBalance(null);
    void fetchTokenBalance(
      wallet,
      activeSettlementAsset,
      activeSettlementDecimals,
      networkKey,
    )
      .then((balance) => {
        if (!cancelled) setVaultWalletBalance(balance);
      })
      .catch(() => {
        if (!cancelled) setVaultWalletBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    wallet,
    selectedVault,
    activeSettlementAsset,
    activeSettlementDecimals,
    networkKey,
    activity,
  ]);

  useEffect(() => {
    if (
      !targetToken ||
      !ADDRESS.test(settlement) ||
      !autopilotRouteAvailable ||
      BigInt(buyAmountAtomic || "0") <= 0n
    ) {
      setSellAmountAtomic("");
      setSizingStatus("Enter a valid capital amount for this route.");
      return;
    }
    let cancelled = false;
    setSizingStatus("Calculating trade size from a live route…");
    const timer = window.setTimeout(() => {
      void apiPost("/v1/trading/quote", {
        network: networkKey,
        fromTokenAddress: settlement,
        toTokenAddress: targetToken.address,
        amount: buyAmountAtomic,
        slippagePercent: Number(maxSlippagePct),
      })
        .then((response) => {
          if (cancelled) return;
          const quoted = response.ok
            ? (response.data as { quote?: { toTokenAmount?: string } }).quote
                ?.toTokenAmount
            : "";
          if (!quoted || !/^\d+$/.test(quoted) || BigInt(quoted) <= 0n) {
            setSellAmountAtomic("");
            setSizingStatus(
              response.ok
                ? "The route returned no executable size."
                : errorText(response.data),
            );
            return;
          }
          setSellAmountAtomic(quoted);
          setSizingStatus(
            `Each trade uses at most ${formatUnits(BigInt(buyAmountAtomic), settlementDecimals)} ${WEB_NETWORKS[networkKey].payment.symbol}; reverse sizing is calculated automatically.`,
          );
        })
        .catch((error) => {
          if (!cancelled) {
            setSellAmountAtomic("");
            setSizingStatus(
              error instanceof Error ? error.message : String(error),
            );
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    targetToken,
    settlement,
    autopilotRouteAvailable,
    buyAmountAtomic,
    maxSlippagePct,
    networkKey,
    settlementDecimals,
  ]);

  /* Retired multi-form handlers kept as source migration notes only.
  async function createVault() {
    if (
      !wallet ||
      !capability?.contracts?.autopilotFactory ||
      !ADDRESS.test(settlement) ||
      !autopilotRouteAvailable
    )
      return setMessage(
        "Connect a wallet, select a pair with a verified live route, and configure the Autopilot factory.",
      );
    setBusy(true);
    setMessage("");
    try {
      const policy = JSON.stringify({
        pair,
        timeframe,
        maxTradePct: Number(maxTrade),
        dailyLossPct: Number(dailyLoss),
        strategy,
      });
      const policyHash = keccak256(toHex(policy));
      const data = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "createVault",
            stateMutability: "nonpayable",
            inputs: [
              { name: "settlementAsset", type: "address" },
              { name: "policyHash", type: "bytes32" },
            ],
            outputs: [{ name: "vault", type: "address" }],
          },
        ],
        functionName: "createVault",
        args: [settlement as `0x${string}`, policyHash],
      });
      const hash = await sendPrepared(networkKey, wallet, {
        to: capability.contracts.autopilotFactory,
        data,
        value: "0",
      });
      await waitForWalletReceipt(getInjectedProvider(), hash);
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "autopilot",
        kind: "create_vault",
        status: "pending",
        txHash: hash,
        pair,
      });
      setMessage(
        `Vault creation submitted. Policy ${policyHash} · transaction ${hash}`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function activateStrategy() {
    if (!wallet || !ADDRESS.test(selectedVault) || !ADDRESS.test(settlement) || !ADDRESS.test(targetAsset) || !autopilotRouteAvailable) return setMessage("Select a vault and a pair with a verified live route on this network.");
    setBusy(true); setMessage("");
    try {
      if (![buyAmountAtomic, sellAmountAtomic].every((value) => /^\d+$/.test(value) && BigInt(value) > 0n)) throw new Error("Buy and sell amounts must be positive atomic integers");
      const policy = { pair, timeframe, maxTradePct: Number(maxTrade), dailyLossPct: Number(dailyLoss), strategy };
      const payload = { owner: wallet, network: networkKey, vault: selectedVault, settlementAsset: settlement, targetAsset, pair, timeframe, buyAmountAtomic, sellAmountAtomic, minConfidence: Number(minConfidence), policy };
      const expiresAt = Date.now() + 5 * 60_000;
      const authorizationMessage = `PULSE Autopilot strategy\n${keccak256(toHex(JSON.stringify(payload)))}\nExpires:${expiresAt}`;
      const provider = getInjectedProvider();
      if (!provider) throw new Error("Connect an injected wallet first");
      await switchWalletNetwork(provider, networkKey);
      const signature = await provider.request({ method: "personal_sign", params: [authorizationMessage, wallet] });
      if (typeof signature !== "string") throw new Error("Wallet returned no authorization signature");
      const response = await apiPost("/v1/autopilot/strategies", { ...payload, authorization: { expiresAt, signature } });
      if (!response.ok) throw new Error(errorText(response.data));
      setMessage("Autopilot strategy activated. Cost-capped compact signals run only after deterministic entry gates; every trade remains contract-bounded."); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  */
  async function launchAutopilot() {
    if (
      !wallet ||
      !capability?.contracts?.autopilotFactory ||
      !ADDRESS.test(settlement) ||
      !ADDRESS.test(targetAsset) ||
      !autopilotRouteAvailable
    )
      return setMessage(
        "Connect your wallet and choose a pair with a verified route.",
      );
    if (vaultStatus === "checking" || vaultStatus === "error")
      return setMessage(
        "PULSE must finish checking this wallet's existing Autopilot setup before starting.",
      );
    if (effectiveCapital <= 0n || autopilotInsufficientCapital)
      return setMessage(
        `Choose an amount within your available ${WEB_NETWORKS[networkKey].payment.symbol} balance.`,
      );
    if (
      BigInt(buyAmountAtomic || "0") <= 0n ||
      BigInt(sellAmountAtomic || "0") <= 0n
    )
      return setMessage(
        "PULSE is still calculating safe trade sizes from the live route.",
      );
    setBusy(true);
    setMessage("Preparing your guarded strategy…");
    let safelyPaused = false;
    try {
      setMessage("Checking token contracts and the live route before any wallet transaction...");
      const preflight = await apiPost("/v1/autopilot/preflight", {
        network: networkKey,
        settlementAsset: settlement,
        targetAsset,
        pair,
        amountAtomic: buyAmountAtomic,
      });
      if (!preflight.ok)
        throw new Error(`${errorText(preflight.data)} No wallet transaction was sent.`);
      const policy = {
        pair,
        timeframe,
        maxTradePct: Number(maxTrade),
        dailyLossPct: Number(dailyLoss),
        strategy,
      };
      const policyHash = keccak256(toHex(JSON.stringify(policy)));
      const provider = getInjectedProvider();
      if (!provider) throw new Error("Connect an injected wallet first");
      const record = async (
        kind: string,
        txHash: string,
        vault?: string,
        amount?: string,
      ) => {
        await apiPost("/v1/trading/activity", {
          owner: wallet,
          network: networkKey,
          source: "autopilot",
          kind,
          status: "pending",
          txHash,
          account: vault,
          pair,
          amount,
        });
      };
      let vault = selectedVault;
      const wasExisting = ADDRESS.test(vault);
      safelyPaused = !wasExisting || activeVault?.paused !== false;
      if (!wasExisting) {
        setMessage(
          "Step 1 of 6 · Confirm the owner-controlled strategy wallet.",
        );
        const createData = encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "createVault",
              stateMutability: "nonpayable",
              inputs: [
                { name: "settlementAsset", type: "address" },
                { name: "policyHash", type: "bytes32" },
              ],
              outputs: [{ name: "vault", type: "address" }],
            },
          ],
          functionName: "createVault",
          args: [settlement as `0x${string}`, policyHash],
        });
        const createHash = await sendPrepared(networkKey, wallet, {
          to: capability.contracts.autopilotFactory,
          data: createData,
          value: "0",
        });
        await waitForWalletReceipt(provider, createHash);
        await record("create_vault", createHash);
        const accountSnapshot = await fetchAccountSnapshot(
          networkKey,
          wallet,
          true,
        );
        const found = accountSnapshot.vaults.map((item) => item.address);
        vault =
          found.find(
            (item) =>
              !vaults.some(
                (known) => known.toLowerCase() === item.toLowerCase(),
              ),
          ) ||
          found.at(-1) ||
          "";
        if (!ADDRESS.test(vault))
          throw new Error(
            "The strategy wallet was confirmed but has not appeared on the RPC yet. Retry after the network updates.",
          );
        setVaults(found);
        setVaultDetails(accountSnapshot.vaults);
        createNewVaultRef.current = false;
        setSelectedVault(vault);
        setVaultStatus("found");
        localStorage.setItem(
          vaultCacheKey(
            networkKey,
            capability.contracts.autopilotFactory,
            wallet,
          ),
          JSON.stringify(found),
        );
      } else {
        if (activeVault?.paused === false) {
          setMessage(
            "Step 1 of 6 · Pausing the existing strategy before changing its policy.",
          );
          const pauseHash = await sendPrepared(networkKey, wallet, {
            to: vault,
            data: encodeFunctionData({
              abi: vaultAbi,
              functionName: "setPaused",
              args: [true],
            }),
            value: "0",
          });
          await waitForWalletReceipt(provider, pauseHash);
          await record("vault_pause", pauseHash, vault);
          safelyPaused = true;
        }
        setMessage("Step 1 of 6 · Confirm the updated strategy policy.");
        const updateHash = await sendPrepared(networkKey, wallet, {
          to: vault,
          data: encodeFunctionData({
            abi: vaultAbi,
            functionName: "updatePolicy",
            args: [policyHash],
          }),
          value: "0",
        });
        await waitForWalletReceipt(provider, updateHash);
        await record("vault_policy_update", updateHash, vault);
      }

      setMessage(
        "Step 2 of 6 · Confirm the selected asset and maximum exposure.",
      );
      const staleAssets = [
        activeStrategy?.targetAsset,
        networkKey === "xlayer" ? NATIVE_TOKEN : undefined,
      ]
        .filter((asset): asset is string => Boolean(asset && ADDRESS.test(asset)))
        .filter((asset) => asset.toLowerCase() !== targetAsset.toLowerCase())
        .filter((asset, index, all) => all.findIndex((item) => item.toLowerCase() === asset.toLowerCase()) === index);
      for (const staleAsset of staleAssets) {
        const removeHash = await sendPrepared(networkKey, wallet, {
          to: vault,
          data: encodeFunctionData({
            abi: vaultAbi,
            functionName: "configureAsset",
            args: [staleAsset as `0x${string}`, false, 0n],
          }),
          value: "0",
        });
        await waitForWalletReceipt(provider, removeHash);
        await record("vault_asset_removed", removeHash, vault);
      }
      const assetHash = await sendPrepared(networkKey, wallet, {
        to: vault,
        data: encodeFunctionData({
          abi: vaultAbi,
          functionName: "configureAsset",
          args: [targetAsset as `0x${string}`, true, BigInt(exposureCapAtomic)],
        }),
        value: "0",
      });
      await waitForWalletReceipt(provider, assetHash);
      await record("vault_asset_policy", assetHash, vault);

      setMessage("Step 3 of 6 · Confirm the risk limits.");
      const limitsHash = await sendPrepared(networkKey, wallet, {
        to: vault,
        data: encodeFunctionData({
          abi: vaultAbi,
          functionName: "configureLimits",
          args: [
            BigInt(maxTradeAtomic),
            BigInt(dailyCapAtomic),
            Number(maxSlippageBps),
            Number(maxDailyLossBps),
            BigInt(cooldownSeconds),
            BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60),
          ],
        }),
        value: "0",
      });
      await waitForWalletReceipt(provider, limitsHash);
      await record("vault_risk_policy", limitsHash, vault);

      if (!reusingFundedVault) {
        setMessage(
          `Step 4 of 6 · Confirm the ${capitalHuman} ${WEB_NETWORKS[networkKey].payment.symbol} allocation.`,
        );
        const fundHash = await sendPrepared(networkKey, wallet, {
          to: settlement,
          data: encodeFunctionData({
            abi: [
              {
                type: "function",
                name: "transfer",
                stateMutability: "nonpayable",
                inputs: [
                  { name: "to", type: "address" },
                  { name: "amount", type: "uint256" },
                ],
                outputs: [{ name: "ok", type: "bool" }],
              },
            ] as const,
            functionName: "transfer",
            args: [vault as `0x${string}`, parsedCapital],
          }),
          value: "0",
        });
        await waitForWalletReceipt(provider, fundHash);
        await record("vault_fund", fundHash, vault, parsedCapital.toString());
      } else {
        setMessage(
          `Step 4 of 6 · Reusing ${formatUnits(existingVaultCapital, settlementDecimals)} ${WEB_NETWORKS[networkKey].payment.symbol} already held by your strategy wallet.`,
        );
      }

      setMessage(
        "Step 5 of 6 · Authorize the strategy configuration.",
      );
      const strategyType = strategy.toLowerCase().includes("breakout")
        ? "breakout"
        : strategy.toLowerCase().includes("mean-reversion")
          ? "mean_reversion"
          : "trend_following";
      const payload = {
        owner: wallet,
        network: networkKey,
        vault,
        settlementAsset: settlement,
        targetAsset,
        pair,
        timeframe,
        strategyType,
        buyAmountAtomic,
        sellAmountAtomic,
        minConfidence: Number(minConfidence),
        policy,
      };
      const expiresAt = Date.now() + 5 * 60_000;
      const authorizationMessage = `PULSE Autopilot strategy\n${keccak256(toHex(JSON.stringify(payload)))}\nExpires:${expiresAt}`;
      await switchWalletNetwork(provider, networkKey);
      const signature = await provider.request({
        method: "personal_sign",
        params: [authorizationMessage, wallet],
      });
      if (typeof signature !== "string")
        throw new Error("Wallet returned no strategy authorization signature");
      const response = await apiPost("/v1/autopilot/strategies", {
        ...payload,
        authorization: { expiresAt, signature },
      });
      if (!response.ok) throw new Error(errorText(response.data));
      let passExpiry = activePass?.expiresAt;
      if (!wasExisting || !passActive) {
        setMessage(`Step 6 of 6 · Approve the ${selectedPassPlan} AI Entry Pass. The paid timer stops whenever this Autopilot is paused.`);
        passExpiry = await requestAutopilotPass(selectedPassPlan, vault);
      } else {
        setMessage("Step 6 of 6 · Existing AI Entry Pass verified; no additional payment is required.");
      }
      const resumeHash = await sendPrepared(networkKey, wallet, {
        to: vault,
        data: encodeFunctionData({
          abi: vaultAbi,
          functionName: "setPaused",
          args: [false],
        }),
        value: "0",
      });
      await waitForWalletReceipt(provider, resumeHash);
      await record("vault_resume", resumeHash, vault);
      const latestAccounts = await fetchAccountSnapshot(
        networkKey,
        wallet,
        true,
      );
      setVaultDetails(latestAccounts.vaults);
      setMessage(
        `Autopilot is running for ${pair}. AI Entry Pass active until ${passExpiry ? new Date(passExpiry).toLocaleString() : "the purchased expiry"}; pause stops its timer.`,
      );
      await refresh();
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : String(error)}${safelyPaused ? " The strategy wallet remains paused; funds stay owner-withdrawable." : " Pause the existing strategy before retrying any policy change."}`,
      );
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function operateVault(
    action: "configure" | "fund" | "pause" | "resume" | "withdraw",
  ) {
    if (!wallet || !ADDRESS.test(selectedVault))
      return setMessage("Connect the owner wallet and select an Autopilot");
    setBusy(true);
    setMessage("");
    try {
      let to = selectedVault;
      let data: `0x${string}`;
      if (action === "configure") {
        if (
          !ADDRESS.test(targetAsset) ||
          ![maxTradeAtomic, dailyCapAtomic, exposureCapAtomic].every(
            (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
          )
        )
          throw new Error("Enter target asset and positive atomic-unit limits");
        const assetData = encodeFunctionData({
          abi: vaultAbi,
          functionName: "configureAsset",
          args: [targetAsset as `0x${string}`, true, BigInt(exposureCapAtomic)],
        });
        const assetHash = await sendPrepared(networkKey, wallet, {
          to: selectedVault,
          data: assetData,
          value: "0",
        });
        await waitForWalletReceipt(getInjectedProvider(), assetHash);
        data = encodeFunctionData({
          abi: vaultAbi,
          functionName: "configureLimits",
          args: [
            BigInt(maxTradeAtomic),
            BigInt(dailyCapAtomic),
            Number(maxSlippageBps),
            Number(maxDailyLossBps),
            BigInt(cooldownSeconds),
            BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60),
          ],
        });
      } else if (action === "pause" || action === "resume")
        data = encodeFunctionData({
          abi: vaultAbi,
          functionName: "setPaused",
          args: [action === "pause"],
        });
      else if (action === "withdraw") {
        if (
          !/^\d+$/.test(withdrawAmountAtomic) ||
          BigInt(withdrawAmountAtomic) <= 0n
        )
          throw new Error(`Enter a positive ${withdrawSymbol} amount`);
        if (withdrawBalanceState === "balance_unavailable")
          throw new Error(
            `PULSE could not verify this Autopilot's ${withdrawSymbol} balance`,
          );
        if (withdrawBalanceState === "insufficient")
          throw new Error(`This Autopilot has only ${formatUnits(BigInt(withdrawBalanceAtomic || "0"), withdrawDecimals)} ${withdrawSymbol} available to withdraw`);
        const withdrawAsset = withdrawAssetMode === "target"
          ? activeStrategy?.targetAsset || targetAsset
          : activeStrategy?.settlementAsset || settlement;
        if (!ADDRESS.test(withdrawAsset || ""))
          throw new Error("The selected vault asset is unavailable");
        data = encodeFunctionData({
          abi: vaultAbi,
          functionName: "withdraw",
          args: [withdrawAsset as `0x${string}`, BigInt(withdrawAmountAtomic)],
        });
      } else {
        if (!ADDRESS.test(activeSettlementAsset))
          throw new Error("The selected Autopilot settlement asset is unavailable");
        if (
          !/^\d+$/.test(addAmountAtomic) ||
          BigInt(addAmountAtomic) <= 0n
        )
          throw new Error(
            `Enter a positive ${activeSettlementSymbol} amount`,
          );
        if (addBalanceState === "balance_unavailable")
          throw new Error(
            `PULSE could not verify the connected wallet's ${activeSettlementSymbol} balance`,
          );
        if (addBalanceState === "insufficient")
          throw new Error(
            `The connected wallet has only ${(vaultWalletBalance || 0).toLocaleString("en-US", { maximumFractionDigits: activeSettlementDecimals })} ${activeSettlementSymbol}`,
          );
        to = activeSettlementAsset;
        data = encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "transfer",
              stateMutability: "nonpayable",
              inputs: [
                { name: "to", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              outputs: [{ name: "ok", type: "bool" }],
            },
          ] as const,
          functionName: "transfer",
          args: [selectedVault as `0x${string}`, BigInt(addAmountAtomic)],
        });
      }
      const hash = await sendPrepared(networkKey, wallet, {
        to,
        data,
        value: "0",
      });
      await waitForWalletReceipt(getInjectedProvider(), hash);
      await apiPost("/v1/trading/activity", {
        owner: wallet,
        network: networkKey,
        source: "autopilot",
        kind: `vault_${action}`,
        status: "pending",
        txHash: hash,
        account: selectedVault,
        pair,
        amount:
          action === "withdraw"
            ? withdrawAmountAtomic
            : action === "fund"
              ? addAmountAtomic
              : undefined,
      });
      const latestAccounts = await fetchAccountSnapshot(
        networkKey,
        wallet,
        true,
      );
      setVaultDetails(latestAccounts.vaults);
      if (action === "pause") setCapitalAction("withdraw");
      if (action === "fund") setAddAmountHuman("");
      if (action === "withdraw") setWithdrawAmountHuman("");
      setMessage(`Vault ${action} submitted ${hash}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function closeAndWithdrawAutopilot() {
    if (!wallet || !ADDRESS.test(selectedVault))
      return setMessage("Select an existing Autopilot first");
    const provider = getInjectedProvider();
    if (!provider) return setMessage("Connect the owner wallet first");
    setBusy(true);
    setMessage("Closing the selected Autopilot...");
    try {
      const recordClose = async (kind: string, txHash: string, amount?: string) => {
        await apiPost("/v1/trading/activity", {
          owner: wallet,
          network: networkKey,
          source: "autopilot",
          kind,
          status: "pending",
          txHash,
          account: selectedVault,
          pair: activeStrategy?.pair || pair,
          amount,
        });
      };
      if (!(activeStrategy?.paused ?? activeVault?.paused ?? true)) {
        setMessage("Step 1 - Pause the strategy before owner recovery.");
        const pauseHash = await sendPrepared(networkKey, wallet, {
          to: selectedVault,
          data: encodeFunctionData({ abi: vaultAbi, functionName: "setPaused", args: [true] }),
          value: "0",
        });
        await waitForWalletReceipt(provider, pauseHash);
        await recordClose("vault_pause", pauseHash);
      }
      const assets = [activeSettlementAsset, activeStrategy?.targetAsset]
        .filter((asset): asset is string => Boolean(asset && ADDRESS.test(asset)))
        .filter((asset, index, all) => all.findIndex((item) => item.toLowerCase() === asset.toLowerCase()) === index);
      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index];
        const balance = await readTokenBalanceAtomic(provider, selectedVault, asset);
        if (balance <= 0n) continue;
        setMessage(`Step ${index + 2} - Withdraw the full ${asset.toLowerCase() === activeSettlementAsset.toLowerCase() ? activeSettlementSymbol : activeStrategy?.targetSymbol || "invested asset"} balance.`);
        const withdrawHash = await sendPrepared(networkKey, wallet, {
          to: selectedVault,
          data: encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [asset as `0x${string}`, balance] }),
          value: "0",
        });
        await waitForWalletReceipt(provider, withdrawHash);
        await recordClose("vault_withdraw", withdrawHash, balance.toString());
      }
      setCapitalAction("withdraw");
      setCloseConfirming(false);
      setMessage("Autopilot closed and available balances returned to the owner. Its empty account remains in the selector as an auditable, reusable vault.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function requestAutopilotPass(plan: "24h" | "7d" | "30d", vault: string) {
    if (!wallet || !ADDRESS.test(vault)) throw new Error("Select an existing Autopilot and connect its owner wallet first");
    const prices = { "24h": aiPolicy?.commercialPass?.price24hUsd || 1.5, "7d": aiPolicy?.commercialPass?.price7dUsd || 10.5, "30d": aiPolicy?.commercialPass?.price30dUsd || 45 };
    const available = fundingWalletBalance;
    if (available === null) throw new Error(`PULSE could not verify your ${activeSettlementSymbol} payment balance. Refresh before purchasing the pass.`);
    if (available < prices[plan]) throw new Error(`You need ${prices[plan].toFixed(2)} ${activeSettlementSymbol}; the connected wallet has ${available.toLocaleString("en-US", { maximumFractionDigits: 6 })}.`);
    const paidFetch = await createWalletPaidFetch(wallet, networkKey);
    const telegramDelivery = new URLSearchParams(window.location.search).get("tg") || undefined;
    const prefix = WEB_NETWORKS[networkKey].route;
    const response = await paidFetch(`${API_BASE}/${prefix}/v1/autopilot/pass/${plan}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ owner: wallet, vault, ...(telegramDelivery ? { telegramDelivery } : {}) }),
    });
    const body = await response.json().catch(() => ({})) as { aiPass?: { expiresAt?: string }; error?: string };
    if (!response.ok) throw new Error(body.error || `Autopilot pass purchase failed (${response.status})`);
    return body.aiPass?.expiresAt;
  }

  async function purchaseAutopilotPass(plan: "24h" | "7d" | "30d") {
    setPassBusy(true);
    setMessage(`Preparing the ${plan} AI Entry Pass payment…`);
    try {
      const expiry = await requestAutopilotPass(plan, selectedVault);
      setMessage(`AI Entry Pass active until ${expiry ? new Date(expiry).toLocaleString() : "the purchased expiry"}. Its timer stops whenever you pause this Autopilot.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPassBusy(false);
    }
  }

  function exportAutopilotLog(item: AutopilotStrategyView) {
    const relatedActivity = activity.filter((entry) => entry.source === "autopilot" && (
      entry.account?.toLowerCase() === item.vault.toLowerCase()
      || (!entry.account && entry.pair === item.pair)
    ));
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const headings = ["record_type", "timestamp", "pair", "timeframe", "decision_or_event", "status", "bias", "confidence_pct", "reason", "error", "tx_hash", "vault", "network"];
    const rows = [
      ...(item.evaluations || []).map((entry) => ["strategy_decision", entry.evaluatedAt, item.pair, item.timeframe, entry.action, entry.status, entry.bias, entry.confidence, entry.reason, entry.error, entry.txHash, item.vault, networkKey]),
      ...relatedActivity.map((entry) => ["onchain_activity", entry.createdAt, entry.pair || item.pair, item.timeframe, entry.kind, entry.status, "", "", "", "", entry.txHash, entry.account || item.vault, networkKey]),
    ].sort((left, right) => Date.parse(String(left[1])) - Date.parse(String(right[1])));
    const csv = [headings, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pulse-autopilot-${item.pair.toLowerCase()}-${item.vault.slice(2, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (networkKey === "arc-testnet") return <DisabledArc feature="Autopilot" />;

  const displayedCapitalAtomic =
    activeStrategy?.portfolioValueAtomic ||
    activeVault?.balanceAtomic ||
    undefined;
  const aggregateRuntime = aggregateAutopilotMetrics(strategies);
  const formatAtomic = (value?: string) => {
    if (!value || !/^\d+$/.test(value)) return "—";
    try {
      return Number(
        formatUnits(BigInt(value), settlementDecimals),
      ).toLocaleString("en-US", { maximumSignificantDigits: 8 });
    } catch {
      return "—";
    }
  };
  const formatAssetAtomic = (value: string | undefined, decimals: number) => {
    if (!value || !/^\d+$/.test(value)) return "—";
    try {
      return Number(formatUnits(BigInt(value), decimals)).toLocaleString("en-US", { maximumSignificantDigits: 8 });
    } catch {
      return "—";
    }
  };
  const existingVaultPickerOptions: AutopilotAccountOption[] = vaults.map(
    (vault, index) => {
      const strategyView = strategies.find(
        (item) => item.vault.toLowerCase() === vault.toLowerCase(),
      );
      const vaultView = vaultDetails.find(
        (item) => item.address.toLowerCase() === vault.toLowerCase(),
      );
      const paused = strategyView?.paused ?? vaultView?.paused;
      const decimals =
        strategyView?.settlementDecimals ??
        vaultView?.settlementDecimals ??
        settlementDecimals;
      const symbol =
        strategyView?.settlementSymbol ||
        vaultView?.settlementSymbol ||
        WEB_NETWORKS[networkKey].payment.symbol;
      const capital =
        strategyView?.portfolioValueAtomic || vaultView?.balanceAtomic;
      return {
        value: vault,
        label: `Autopilot ${index + 1}`,
        address: `${vault.slice(0, 8)}…${vault.slice(-6)}`,
        status: paused
          ? "Paused"
          : strategyView?.exitPending
            ? "Closing position"
            : strategyView
              ? "Running"
              : vaultView?.paused === false
                ? "On-chain active"
                : "Ready to configure",
        capital: capital
          ? `${formatAssetAtomic(capital, decimals)} ${symbol}`
          : "Balance unavailable",
      };
    },
  );
  const vaultPickerOptions: AutopilotAccountOption[] = [
    {
      value: "",
      label: "Create new Autopilot",
      address: "New owner-controlled account",
      status: "Not created",
      capital: "Set capital on the left",
    },
    ...existingVaultPickerOptions,
  ];
  const fundingWalletBalance = selectedVault
    ? vaultWalletBalance
    : autopilotBalances.settlement;
  const addMaximum =
    fundingWalletBalance === null
      ? ""
      : fundingWalletBalance.toLocaleString("en-US", {
          useGrouping: false,
          maximumFractionDigits: activeSettlementDecimals,
        });
  const vaultWalletBalanceAtomic = (() => {
    if (!addMaximum) return null;
    try {
      return parseUnits(addMaximum, activeSettlementDecimals).toString();
    } catch {
      return null;
    }
  })();
  const addBalanceState = assessBalanceAmount(
    addAmountAtomic,
    vaultWalletBalanceAtomic,
  );
  const withdrawBalanceState = assessBalanceAmount(
    withdrawAmountAtomic,
    withdrawBalanceAtomic,
  );
  const walletBalanceText =
    fundingWalletBalance === null
      ? "Balance unavailable"
      : `${fundingWalletBalance.toLocaleString("en-US", {
          maximumFractionDigits: activeSettlementDecimals,
        })} ${activeSettlementSymbol}`;
  const activePass = activeStrategy?.aiPass || null;
  const passRemainingMs = activePass ? Date.parse(activePass.expiresAt) - (activePass.pausedAt ? Date.parse(activePass.pausedAt) : Date.now()) : 0;
  const passSignalsRemaining = activePass ? Math.max(0, activePass.signalLimit - activePass.signalsUsed) : 0;
  const passActive = passRemainingMs > 0 && passSignalsRemaining > 0;
  const passTimeLabel = passRemainingMs > 0
    ? passRemainingMs >= 86_400_000
      ? `${Math.floor(passRemainingMs / 86_400_000)}d ${Math.floor((passRemainingMs % 86_400_000) / 3_600_000)}h remaining`
      : `${Math.max(1, Math.ceil(passRemainingMs / 3_600_000))}h remaining`
    : "Expired or not purchased";
  const passTimerState = activePass?.pausedAt ? "Timer on hold while paused" : "Timer active while running";
  const strategyPresets = [
    {
      id: "trend_following",
      label: "Trend following",
      value:
        "Trend-following with compact AI confirmation; stop after daily loss cap.",
      note: "Bullish compact signal + trend-up + close above SMA20 + SMA20 above SMA50.",
    },
    {
      id: "breakout",
      label: "Breakout",
      value:
        "Breakout continuation only when compact AI confirms momentum and volume; otherwise hold.",
      note: "Bullish compact signal + prior 20-candle high break + at least 1.15x volume.",
    },
    {
      id: "mean_reversion",
      label: "Mean reversion",
      value:
        "Mean-reversion entries only at compact-signal support zones; stop after daily loss cap.",
      note: "Bullish compact signal near support/RSI pullback in a range or transition.",
    },
  ];
  const selectedStrategy =
    strategyPresets.find((item) => item.value === strategy) ||
    strategyPresets[0];
  const capitalNumber = Math.max(
    0,
    Number(formatUnits(effectiveCapital, settlementDecimals)) || 0,
  );
  const settlementBalanceText =
    autopilotBalances.settlement == null
      ? wallet
        ? "balance unavailable"
        : "connect to check"
      : autopilotBalances.settlement.toLocaleString("en-US", {
          maximumSignificantDigits: 8,
        });
  const targetBalanceText =
    autopilotBalances.target == null
      ? wallet
        ? "balance unavailable"
        : "connect to check"
      : autopilotBalances.target.toLocaleString("en-US", {
          maximumSignificantDigits: 8,
        });
  const passPrices = { "24h": aiPolicy?.commercialPass?.price24hUsd || 1.5, "7d": aiPolicy?.commercialPass?.price7dUsd || 10.5, "30d": aiPolicy?.commercialPass?.price30dUsd || 45 };
  const passPrice = passPrices[selectedPassPlan];
  const needsActivationPass = !selectedVault || !passActive;
  const requiredWalletFunds = (reusingFundedVault ? 0 : capitalNumber) + (needsActivationPass ? passPrice : 0);
  const passFundingUnavailable = needsActivationPass && fundingWalletBalance === null;
  const passFundingInsufficient = fundingWalletBalance !== null && fundingWalletBalance + 1e-9 < requiredWalletFunds;
  const startDisabled =
    busy ||
    !wallet ||
    !capability?.autopilot.enabled ||
    !autopilotRouteAvailable ||
    effectiveCapital <= 0n ||
    autopilotInsufficientCapital ||
    passFundingUnavailable ||
    passFundingInsufficient ||
    !sellAmountAtomic ||
    vaultStatus === "checking" ||
    vaultStatus === "error";
  const startLabel = busy
    ? message || "Preparing Autopilot…"
    : !wallet
      ? "Connect wallet to continue"
      : !capability?.autopilot.enabled
        ? "Autopilot execution unavailable"
        : !autopilotRouteAvailable
          ? "Choose a pair with a live route"
          : effectiveCapital <= 0n
            ? `Enter ${WEB_NETWORKS[networkKey].payment.symbol} capital to continue`
      : autopilotInsufficientCapital
        ? `Use available ${WEB_NETWORKS[networkKey].payment.symbol} balance first`
        : passFundingUnavailable
          ? `Refresh ${activeSettlementSymbol} balance before activation`
        : passFundingInsufficient
          ? `Keep ${passPrice.toFixed(2)} ${activeSettlementSymbol} for the AI Entry Pass`
        : vaultStatus === "checking"
          ? "Checking existing Autopilot…"
          : activeStrategy
            ? "Save changes & restart selected"
            : selectedVault
              ? "Configure & start selected Autopilot"
              : "Create & start new Autopilot";

  return (
    <div className="v6-workspace autopilot-simple">
      <section className="v6-heading">
        <div>
          <span className="eyebrow">
            COST-CAPPED AI SIGNALS · ON-CHAIN GUARDRAILS
          </span>
          <h2>Autopilot</h2>
          <p>
            Choose the market, capital and risk level. PULSE handles route
            sizing and contract configuration; you keep pause and withdrawal
            control.
          </p>
        </div>
        <CapabilityNotice capability={capability} type="autopilot" />
      </section>

      <OpportunityRadar
        networkKey={networkKey}
        initialTimeframe={timeframe}
        context="autopilot"
        onAnalyze={(candidate) =>
          onAnalyzeCandidate?.(candidate.pair, candidate.timeframe)
        }
        onPrepare={(candidate) => {
          setPair(candidate.pair);
          setTimeframe(candidate.timeframe);
          setStrategy(
            candidate.strategyType === "breakout"
              ? "Breakout continuation only when compact AI confirms momentum and volume; otherwise hold."
              : candidate.strategyType === "mean_reversion"
                ? "Mean-reversion entries only at compact-signal support zones; stop after daily loss cap."
                : "Trend-following with compact AI confirmation; stop after daily loss cap.",
          );
          setPreparedCandidate(`${candidate.pair} · ${candidate.timeframe} · ${candidate.strategyType.replaceAll("_", " ")}`);
          requestAnimationFrame(() => builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }}
      />
      {preparedCandidate && <div className="prepared-autopilot-notice" role="status"><strong>Autopilot draft prepared</strong><span>{preparedCandidate}. Review capital, risk and AI Entry Pass below; no transaction has been sent.</span></div>}

      <div className="autopilot-onboarding">
        <section className="card autopilot-builder" ref={builderRef}>
          <div className="setup-target-field">
            <span>Configure</span>
            <AutopilotAccountPicker value={selectedVault} options={vaultPickerOptions} onChange={(vault) => { createNewVaultRef.current = !vault; setSelectedVault(vault); setCloseConfirming(false); }} />
            <small>{selectedVault ? "Editing only the selected account. Runtime controls remain in the dashboard." : "A new isolated owner-controlled vault will be created."}</small>
          </div>
          <div className="autopilot-step-head">
            <span>1</span>
            <div>
              <small>MARKET</small>
              <h3>What should PULSE trade?</h3>
            </div>
          </div>
          <div className="friendly-fields">
            <div className="friendly-field">
              <span>Global Market pair</span>
              <ExecutionPairPicker
                id="autopilot-execution-pair"
                networkKey={networkKey}
                value={pair}
                custody="erc20"
                onSelect={(selected) => setPair(selected.pair)}
              />
              <small>Choose directly. A prepaid pass supplies compact AI entry confirmation only after the free technical gate passes.</small>
            </div>
            <div className="friendly-field">
              <span>Analysis timeframe</span>
              <TimeframePicker
                id="autopilot-timeframe"
                value={timeframe}
                networkKey={networkKey}
                values={["15m", "1H", "4H", "1D"]}
                onChange={setTimeframe}
              />
            </div>
          </div>
          <div
            className={`autopilot-route-card ${autopilotRouteAvailable ? "ready" : "warning"}`}
          >
            <div>
              <span>Connected-wallet funding asset</span>
              <strong>{WEB_NETWORKS[networkKey].payment.symbol}</strong>
              <small>Available to deposit · {settlementBalanceText}</small>
            </div>
            <i>→</i>
            <div>
              <span>Asset PULSE may trade</span>
              <strong>{targetToken?.symbol || "Not available"}</strong>
              <small>Your wallet holds {targetBalanceText} · not required to start</small>
            </div>
            <p>{autopilotRouteStatus}</p>
          </div>
          {!autopilotRouteAvailable && (
            <div className="route-suggestion">
              <strong>This pair is not executable here</strong>
              {autopilotAlternatives.length ? (
                <p>
                  Switch Network &amp; Payment to{" "}
                  {autopilotAlternatives
                    .map((item) => WEB_NETWORKS[item].label)
                    .join(" or ")}
                  ; PULSE verified a live route there.
                </p>
              ) : (
                <p>
                  Keep the report for analysis and trade this pair on{" "}
                  <a
                    href={`https://www.okx.com/trade-spot/${pair.toLowerCase()}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OKX Spot ↗
                  </a>
                  .
                </p>
              )}
            </div>
          )}

          <div className="autopilot-step-head">
            <span>2</span>
            <div>
              <small>STRATEGY</small>
              <h3>How should it look for entries?</h3>
            </div>
          </div>
          <div className="strategy-presets">
            {strategyPresets.map((item) => (
              <button
                type="button"
                key={item.label}
                className={strategy === item.value ? "active" : ""}
                onClick={() => setStrategy(item.value)}
              >
                <b>{item.label}</b>
                <span>{item.note}</span>
              </button>
            ))}
          </div>

          <div className="autopilot-step-head">
            <span>3</span>
            <div>
              <small>CAPITAL &amp; RISK</small>
              <h3>How much may it use?</h3>
            </div>
          </div>
          {reusingFundedVault ? (
            <div className="capital-field existing-capital">
              <span>Capital already in this Autopilot</span>
              <strong>
                {formatUnits(existingVaultCapital, settlementDecimals)}{" "}
                {WEB_NETWORKS[networkKey].payment.symbol}
              </strong>
              <small>
                PULSE will update the policy without depositing this amount
                again. Add or withdraw capital from Your Autopilot.
              </small>
            </div>
          ) : (
            <div className="initial-capital-step">
              <div className="capital-source-card">
                <span>STEP 3 SOURCE · CONNECTED WALLET</span>
                <strong>{settlementBalanceText} {WEB_NETWORKS[networkKey].payment.symbol} available</strong>
                <small>Choose the amount to transfer into the new owner-controlled Autopilot. This initial deposit also sizes the risk limits below.</small>
              </div>
            <label
              className={`capital-field ${autopilotInsufficientCapital ? "field-invalid" : ""}`}
            >
              <span>
                Initial Autopilot deposit{" "}
                <button
                  type="button"
                  className="amount-max"
                  disabled={!autopilotBalances.settlement}
                  onClick={() =>
                    setCapitalHuman(String(autopilotBalances.settlement || 0))
                  }
                >
                  Max
                </button>
              </span>
              <div className="unit-input">
                <input
                  aria-invalid={autopilotInsufficientCapital}
                  inputMode="decimal"
                  value={capitalHuman}
                  onChange={(event) => setCapitalHuman(event.target.value)}
                  placeholder="0.00"
                />
                <b>{WEB_NETWORKS[networkKey].payment.symbol}</b>
              </div>
              <small>
                Connected-wallet balance{" "}
                {autopilotBalances.settlement == null
                  ? "—"
                  : autopilotBalances.settlement.toLocaleString("en-US", {
                      maximumSignificantDigits: 8,
                    })}{" "}
                {WEB_NETWORKS[networkKey].payment.symbol}
              </small>
              <span className="capital-help">Start transfers only this amount. Later top-ups use Your Autopilot → Add funds; save the strategy again before expecting larger per-trade limits.</span>
            </label>
            </div>
          )}
          {autopilotInsufficientCapital && (
            <div className="inline-warning balance-warning">
              <div>
                <strong>Capital exceeds wallet balance</strong>
                <span>Reduce the allocation or use the available balance.</span>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() =>
                  setCapitalHuman(String(autopilotBalances.settlement || 0))
                }
              >
                Use available balance
              </button>
            </div>
          )}
          <div className="risk-presets" aria-label="Risk profile">
            {(["conservative", "balanced", "active"] as const).map(
              (profile) => (
                <button
                  type="button"
                  key={profile}
                  className={riskProfile === profile ? "active" : ""}
                  onClick={() => applyRiskProfile(profile)}
                >
                  <b>{profile[0].toUpperCase() + profile.slice(1)}</b>
                  <span>
                    {profile === "conservative"
                      ? "Up to 25% per Buy · strictest signals"
                      : profile === "active"
                        ? "Up to 100% per Buy · wider tolerance"
                        : "Up to 50% per Buy · balanced signals"}
                  </span>
                </button>
              ),
            )}
          </div>
          <div className="risk-summary-grid">
            <div>
              <span>Max each trade</span>
              <strong>
                {((capitalNumber * Number(maxTrade)) / 100).toLocaleString(
                  "en-US",
                  { maximumSignificantDigits: 6 },
                )}{" "}
                {WEB_NETWORKS[networkKey].payment.symbol}
              </strong>
              <small>{maxTrade}% of allocated capital</small>
            </div>
            <div>
              <span>Stop for the day</span>
              <strong>
                {((capitalNumber * Number(dailyLoss)) / 100).toLocaleString(
                  "en-US",
                  { maximumSignificantDigits: 6 },
                )}{" "}
                {WEB_NETWORKS[networkKey].payment.symbol}
              </strong>
              <small>after {dailyLoss}% loss</small>
            </div>
            <div>
              <span>Maximum asset exposure</span>
              <strong>
                {((capitalNumber * Number(exposurePct)) / 100).toLocaleString(
                  "en-US",
                  { maximumSignificantDigits: 6 },
                )}{" "}
                {WEB_NETWORKS[networkKey].payment.symbol}
              </strong>
              <small>{exposurePct}% of allocated capital</small>
            </div>
            <div>
              <span>Signal threshold</span>
              <strong>{minConfidence}%</strong>
              <small>Compact AI confidence</small>
            </div>
          </div>
          <details className="advanced-panel autopilot-advanced">
            <summary>Advanced risk controls</summary>
            <p>
              Defaults come from the selected risk profile. Change them only if
              you understand the impact.
            </p>
            <div className="friendly-fields three">
              <label>
                <span>Max per trade</span>
                <div className="unit-input">
                  <input
                    inputMode="decimal"
                    value={maxTrade}
                    onChange={(event) => setMaxTrade(event.target.value)}
                  />
                  <b>%</b>
                </div>
              </label>
              <label>
                <span>Daily loss stop</span>
                <div className="unit-input">
                  <input
                    inputMode="decimal"
                    value={dailyLoss}
                    onChange={(event) => setDailyLoss(event.target.value)}
                  />
                  <b>%</b>
                </div>
              </label>
              <label>
                <span>Asset exposure</span>
                <div className="unit-input">
                  <input
                    inputMode="decimal"
                    value={exposurePct}
                    onChange={(event) => setExposurePct(event.target.value)}
                  />
                  <b>%</b>
                </div>
              </label>
              <label>
                <span>Daily turnover</span>
                <div className="unit-input">
                  <input
                    inputMode="decimal"
                    value={dailyTurnoverPct}
                    onChange={(event) =>
                      setDailyTurnoverPct(event.target.value)
                    }
                  />
                  <b>%</b>
                </div>
              </label>
              <label>
                <span>Maximum slippage</span>
                <div className="unit-input">
                  <input
                    inputMode="decimal"
                    value={maxSlippagePct}
                    onChange={(event) => setMaxSlippagePct(event.target.value)}
                  />
                  <b>%</b>
                </div>
              </label>
              <label>
                <span>Wait between trades</span>
                <select
                  value={cooldownSeconds}
                  onChange={(event) => setCooldownSeconds(event.target.value)}
                >
                  <option value="120">2 minutes</option>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                  <option value="3600">1 hour</option>
                </select>
              </label>
            </div>
            <label>
              <span>Custom instructions</span>
              <textarea
                rows={3}
                value={strategy}
                onChange={(event) => setStrategy(event.target.value)}
              />
            </label>
          </details>

          <div className="autopilot-step-head">
            <span>4</span>
            <div>
              <small>AI ENTRY PASS</small>
              <h3>How long may AI confirm new entries?</h3>
            </div>
          </div>
          <div className="setup-pass-step">
            {selectedVault && passActive ? <div className="existing-pass-choice"><strong>Use current pass · {passTimeLabel}</strong><span>No additional payment when saving this strategy. Renew from the dashboard whenever you want to add time.</span></div> : <div className="pass-plans" role="radiogroup" aria-label="AI Entry Pass duration">
              {(["24h", "7d", "30d"] as const).map((plan) => (
                <button type="button" role="radio" aria-checked={selectedPassPlan === plan} className={`btn ${selectedPassPlan === plan ? "btn-accent" : "btn-soft"}`} key={plan} onClick={() => setSelectedPassPlan(plan)}>
                  {plan} · ${passPrices[plan].toFixed(2)}
                </button>
              ))}
            </div>}
            <div className="pass-explainer">
              <strong>Prepaid x402 payment · no auto-renewal</strong>
              <span>Only compact AI checks for valid entry candidates consume the pass. Pausing the Autopilot freezes the time remaining. TP/SL, exits and withdrawals never require a pass.</span>
              <small>{selectedVault && passActive ? "The existing pass remains bound to this vault." : "PULSE creates and registers a new vault first when needed, requests this payment in step 6, then starts it. Renew later from the dashboard."}</small>
            </div>
            {passFundingInsufficient && <div className="capital-inline-warning">The connected wallet needs {requiredWalletFunds.toFixed(2)} {activeSettlementSymbol} for {reusingFundedVault ? "this pass" : "the initial deposit plus this pass"}; available {fundingWalletBalance?.toLocaleString("en-US", { maximumFractionDigits: 6 })}.</div>}
            {passFundingUnavailable && <div className="capital-inline-warning">PULSE cannot verify the connected-wallet payment balance. Refresh before any vault transaction is prepared.</div>}
          </div>

          <div className="autopilot-step-head">
            <span>5</span>
            <div><small>REVIEW</small><h3>Verify the complete Autopilot</h3></div>
          </div>

          <div className="autopilot-review">
            <div>
              <span className="eyebrow">READY TO REVIEW</span>
              <h3>
                {selectedStrategy.label} · {pair} · {timeframe}
              </h3>
              <p>
                PULSE starts with free deterministic monitoring and requests a compact AI entry signal only when a setup candidate exists,
                trades only{" "}
                {targetToken?.symbol || "the verified asset"}, and enforce the{" "}
                {riskProfile} limits above on-chain.
              </p>
            </div>
            <ul>
              <li>You approve the setup in your wallet.</li>
              <li>Hold starts normally: no entry transaction is sent until every Buy rule passes.</li>
              <li>After a Buy, it keeps evaluating Hold and Sell rules, then can Buy again later.</li>
              <li>Autopilot cannot withdraw your funds.</li>
              <li>You can pause at any time, then withdraw from the selected Autopilot.</li>
            </ul>
          </div>
          <div className="autopilot-step-head activation-step">
            <span>6</span>
            <div><small>ACTIVATE</small><h3>Approve setup, pass and start</h3></div>
          </div>
          <button
            className="btn btn-primary full autopilot-launch"
            disabled={startDisabled}
            onClick={() => void launchAutopilot()}
          >
            {startLabel}
          </button>
          <small className="wallet-prompt-note">
            First-time setup may require several wallet confirmations because
            each on-chain guardrail is independently verifiable. PULSE guides
            them as one flow and never asks you for a contract address or atomic
            amount.
          </small>
          {sizingStatus && <div className="sizing-status">{sizingStatus}</div>}
          {vaultStatus === "error" && (
            <div className="account-lookup-error">
              <span>
                PULSE could not safely verify existing Autopilot setup.
              </span>
              <small>{vaultLookupError}</small>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => void refresh()}
              >
                Retry check
              </button>
            </div>
          )}
          {message && (
            <div className="v6-message" role="status">
              {message}
            </div>
          )}
        </section>

        <aside hidden className="card autopilot-manager" aria-hidden="true">
          <span className="tier-mark premium">OWNER CONTROLLED</span>
          <h3>Your Autopilot</h3>
          {vaults.length ? (
            <>
              <div className="vault-picker-field">
                <span>Strategy account</span>
                <AutopilotAccountPicker
                  value={selectedVault}
                  options={vaultPickerOptions}
                  onChange={(vault) => {
                    createNewVaultRef.current = !vault;
                    setCloseConfirming(false);
                    setSelectedVault(vault);
                    const option = vaultPickerOptions.find(
                      (item) => item.value === vault,
                    );
                    setCapitalAction(option?.status === "Paused" ? "withdraw" : "add");
                  }}
                />
              </div>
              <div className="autopilot-status-card">
                <span>Status</span>
                <strong
                  className={
                    (activeStrategy?.paused ?? activeVault?.paused)
                      ? "warning"
                      : "positive"
                  }
                >
                  {activeStrategy
                    ? activeStrategy.paused
                      ? "Paused"
                      : activeStrategy.exitPending
                        ? "Closing position"
                      : activeStrategy.status === "active"
                        ? "Running"
                        : activeStrategy.status
                    : activeVault?.paused === false
                      ? "On-chain active · registration needed"
                      : "Ready to configure"}
                </strong>
                <small>
                  {activeStrategy?.exitPending
                    ? "A triggered exit is completing in cap-compliant chunks"
                    : activeStrategy?.lastDecision?.replaceAll("_", " ") ||
                      "No trading decision yet"}
                </small>
              </div>
              {selectedVault && (
                <section className={`autopilot-pass-card ${passActive ? "active" : "warning"}`}>
                  <div>
                    <span>AI ENTRY PASS</span>
                    <strong>{passActive ? passTimeLabel : "New entries are on Hold"}</strong>
                    <small>{passActive ? `${passSignalsRemaining} compact AI confirmation${passSignalsRemaining === 1 ? "" : "s"} remaining` : "TP/SL, deterministic exits, pause and withdrawal continue without interruption."}</small>
                  </div>
                  <div className="pass-plans">
                    <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void purchaseAutopilotPass("24h")}>24h · ${(aiPolicy?.commercialPass?.price24hUsd || 1.5).toFixed(2)}</button>
                    <button type="button" className="btn btn-soft" disabled={busy} onClick={() => void purchaseAutopilotPass("7d")}>7d · ${(aiPolicy?.commercialPass?.price7dUsd || 10.5).toFixed(2)}</button>
                    <button type="button" className="btn btn-soft" disabled={busy} onClick={() => void purchaseAutopilotPass("30d")}>30d · ${(aiPolicy?.commercialPass?.price30dUsd || 45).toFixed(2)}</button>
                  </div>
                  <small>Manual prepaid renewal only—never auto-renews. Buying again extends unused time. Telegram reminders are enabled when purchased from the PULSE Mini App.</small>
                </section>
              )}
              {selectedVault && <><dl className="trade-facts">
                <div>
                  <dt>Market</dt>
                  <dd>{activeStrategy?.pair || pair}</dd>
                </div>
                <div>
                  <dt>Timeframe</dt>
                  <dd>{activeStrategy?.timeframe || timeframe}</dd>
                </div>
                <div>
                  <dt>Capital</dt>
                  <dd>
                    {formatAssetAtomic(
                      displayedCapitalAtomic,
                      activeSettlementDecimals,
                    )}{" "}
                    {activeSettlementSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Actual entry</dt>
                  <dd>{(activeStrategy?.positionEntryPrice || activeStrategy?.lastEntryPrice)?.toLocaleString(undefined, { maximumFractionDigits: 8 }) || "No filled buy"}</dd>
                </div>
                <div>
                  <dt>OKX mark</dt>
                  <dd>{activeStrategy?.markPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) || "Refreshing…"}</dd>
                </div>
                <div>
                  <dt>Portfolio P&amp;L</dt>
                  <dd>
                    {typeof activeStrategy?.pnlPct === "number"
                      ? `${activeStrategy.pnlPct >= 0 ? "+" : ""}${activeStrategy.pnlPct.toFixed(2)}%`
                      : "Not available until strategy starts"}
                  </dd>
                  <small>
                    {activeStrategy?.pnlBasisAtomic
                      ? `Gross contributed ${formatAssetAtomic(activeStrategy.pnlBasisAtomic, activeSettlementDecimals)} · withdrawn ${formatAssetAtomic(activeStrategy.withdrawalsAtomic, activeSettlementDecimals)} ${activeSettlementSymbol}`
                      : "Value plus withdrawals minus contributed capital"}
                  </small>
                </div>
              </dl>
              <div className="vault-balance-grid">
                <div><span>Available settlement</span><strong>{formatAssetAtomic(activeStrategy?.settlementBalance || activeVault?.balanceAtomic || undefined, activeStrategy?.settlementDecimals ?? activeVault?.settlementDecimals ?? settlementDecimals)} {activeSettlementSymbol}</strong><small>Can be withdrawn after pausing</small></div>
                <div><span>Invested asset</span><strong>{formatAssetAtomic(activeStrategy?.targetBalance, activeStrategy?.targetDecimals ?? targetToken?.decimals ?? 18)} {activeStrategy?.targetSymbol || targetToken?.symbol || pair.split("-")[0]}</strong><small>Withdraw separately, or let the strategy sell</small></div>
                <div><span>Total portfolio value</span><strong>{formatAssetAtomic(activeStrategy?.portfolioValueAtomic || activeVault?.balanceAtomic || undefined, activeSettlementDecimals)} {activeSettlementSymbol}</strong><small>Settlement plus marked invested asset</small></div>
              </div>
              </>}
              {!selectedVault && (
                <div className="capital-source-card creation-only-guide">
                  <span>NEW AUTOPILOT · ONE FUNDING STEP</span>
                  <strong>Use Initial deposit on the left</strong>
                  <small>PULSE creates the owner-controlled account, transfers exactly that amount, and derives its starting risk limits in one guided flow. Add funds is available only after creation as an optional later top-up.</small>
                </div>
              )}
              {selectedVault && <section className="vault-capital-manager">
                <div className="capital-action-tabs" role="tablist" aria-label="Manage Autopilot capital">
                  <button type="button" role="tab" aria-selected={capitalAction === "add"} className={capitalAction === "add" ? "active" : ""} onClick={() => setCapitalAction("add")}>Add funds</button>
                  <button type="button" role="tab" aria-selected={capitalAction === "withdraw"} className={capitalAction === "withdraw" ? "active" : ""} onClick={() => setCapitalAction("withdraw")}>Withdraw</button>
                </div>
                {capitalAction === "add" ? (
                  <div className="capital-action-panel" role="tabpanel">
                    <div className="capital-source-card">
                      <span>FROM CONNECTED WALLET</span>
                      <strong>{walletBalanceText}</strong>
                      <small>{activeSettlementSymbol} available on {WEB_NETWORKS[networkKey].label}</small>
                    </div>
                    <label>
                      <span>Amount to add</span>
                      <div className="unit-input">
                        <input inputMode="decimal" value={addAmountHuman} onChange={(event) => setAddAmountHuman(event.target.value)} placeholder="0.00" />
                        <button
                          type="button"
                          className="unit-max"
                          aria-label={`Use maximum connected-wallet ${activeSettlementSymbol} balance`}
                          disabled={!addMaximum || Number(addMaximum) <= 0}
                          onClick={() => setAddAmountHuman(addMaximum)}
                        >
                          Max
                        </button>
                        <b>{activeSettlementSymbol}</b>
                      </div>
                    </label>
                    {addBalanceState === "insufficient" && <div className="capital-inline-warning">Amount exceeds the connected wallet balance.</div>}
                    {addBalanceState === "balance_unavailable" && BigInt(addAmountAtomic || "0") > 0n && <div className="capital-inline-warning">Wallet balance is unavailable. Refresh before adding funds.</div>}
                    <button className="btn btn-accent full" disabled={busy || addBalanceState !== "ready"} onClick={() => void operateVault("fund")}>Add {activeSettlementSymbol} to this Autopilot</button>
                    <small className="capital-help">This transfers only the entered settlement asset from your wallet. Keep {WEB_NETWORKS[networkKey].native.symbol} for gas.</small>
                  </div>
                ) : (
                  <div className="capital-action-panel" role="tabpanel">
                    <div className="withdraw-asset-tabs" role="tablist" aria-label="Asset to withdraw">
                      <button type="button" role="tab" aria-selected={withdrawAssetMode === "settlement"} className={withdrawAssetMode === "settlement" ? "active" : ""} onClick={() => { setWithdrawAssetMode("settlement"); setWithdrawAmountHuman(""); }}>{activeSettlementSymbol}</button>
                      <button type="button" role="tab" aria-selected={withdrawAssetMode === "target"} className={withdrawAssetMode === "target" ? "active" : ""} disabled={!activeStrategy?.targetAsset} onClick={() => { setWithdrawAssetMode("target"); setWithdrawAmountHuman(""); }}>{activeStrategy?.targetSymbol || targetToken?.symbol || pair.split("-")[0]}</button>
                    </div>
                    <div className="capital-source-card vault-source">
                      <span>AVAILABLE IN THIS AUTOPILOT</span>
                      <strong>{formatAssetAtomic(withdrawBalanceAtomic || undefined, withdrawDecimals)} {withdrawSymbol}</strong>
                      <small>{(activeStrategy?.paused ?? activeVault?.paused) ? "Paused and ready for owner withdrawal" : "Pause this Autopilot before withdrawing"}</small>
                    </div>
                    <label>
                      <span>Amount to withdraw</span>
                      <div className="unit-input">
                        <input inputMode="decimal" value={withdrawAmountHuman} onChange={(event) => setWithdrawAmountHuman(event.target.value)} placeholder="0.00" />
                        <button
                          type="button"
                          className="unit-max"
                          aria-label={`Use maximum withdrawable ${withdrawSymbol} balance`}
                          disabled={BigInt(withdrawBalanceAtomic || "0") <= 0n}
                          onClick={() => setWithdrawAmountHuman(formatUnits(BigInt(withdrawBalanceAtomic || "0"), withdrawDecimals))}
                        >
                          Max
                        </button>
                        <b>{withdrawSymbol}</b>
                      </div>
                    </label>
                    {withdrawBalanceState === "balance_unavailable" && BigInt(withdrawAmountAtomic || "0") > 0n && <div className="capital-inline-warning">Vault balance is unavailable. Refresh before withdrawing.</div>}
                    {withdrawBalanceState === "insufficient" && <div className="capital-inline-warning">Amount exceeds this Autopilot&apos;s available {withdrawSymbol}.</div>}
                    <button className="btn btn-accent full" disabled={busy || !(activeStrategy?.paused ?? activeVault?.paused ?? true) || withdrawBalanceState !== "ready"} onClick={() => void operateVault("withdraw")}>Withdraw {withdrawSymbol} to owner wallet</button>
                    <small className="capital-help">Only the connected owner can withdraw. The automation executor has no withdrawal permission.</small>
                  </div>
                )}
              </section>}
              {selectedVault && <div className="manager-actions vault-state-actions">
                <button
                  className="btn btn-danger"
                  disabled={
                    busy ||
                    (activeStrategy?.paused ?? activeVault?.paused ?? true)
                  }
                  onClick={() => void operateVault("pause")}
                >
                  Pause
                </button>
                <button
                  className="btn btn-accent"
                  disabled={
                    busy ||
                    !(activeStrategy?.paused ?? activeVault?.paused ?? false)
                  }
                  onClick={() => void operateVault("resume")}
                >
                  Resume
                </button>
              </div>}
              {selectedVault && (closeConfirming ? (
                <div className="account-lookup-error">
                  <span>Close this Autopilot?</span>
                  <small>PULSE will pause it and ask the owner wallet to withdraw every available settlement and invested asset. The empty contract remains auditable and reusable.</small>
                  <div className="manager-actions">
                    <button type="button" className="btn btn-soft" disabled={busy} onClick={() => setCloseConfirming(false)}>Cancel</button>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void closeAndWithdrawAutopilot()}>Confirm close &amp; withdraw</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger full"
                  disabled={busy || !selectedVault}
                  onClick={() => setCloseConfirming(true)}
                >
                  Close &amp; withdraw all
                </button>
              ))}
              {selectedVault && <small className="capital-help">The contract is not deleted: it remains verifiable on-chain and can be configured again later.</small>}
              <details className="advanced-panel contract-details">
                <summary>Technical proof and addresses</summary>
                <dl className="technical-facts">
                  <div>
                    <dt>Strategy account</dt>
                    <dd>{selectedVault}</dd>
                  </div>
                  <div>
                    <dt>Allowed asset</dt>
                    <dd>{targetAsset || "—"}</dd>
                  </div>
                  <div>
                    <dt>Factory</dt>
                    <dd>{capability?.contracts?.autopilotFactory || "—"}</dd>
                  </div>
                  <div>
                    <dt>Registry</dt>
                    <dd>{capability?.contracts?.registry || "—"}</dd>
                  </div>
                </dl>
              </details>
            </>
          ) : (
            <div className="empty-dashboard compact">
              <strong>No Autopilot yet</strong>
              <span>
                Complete the three choices on the left. PULSE checks on-chain
                before offering creation.
              </span>
            </div>
          )}
          <div className="guardrail-explainer">
            <h4>Always enforced</h4>
            <ul>
              <li>Only the selected asset and settlement token</li>
              <li>Per-trade, exposure and daily-loss limits</li>
              <li>Compact AI confidence threshold</li>
              <li>Owner-only pause and withdrawal</li>
            </ul>
          </div>
        </aside>
      </div>

      <section className="card activity-dashboard autopilot-unified-dashboard">
        <div className="dashboard-head">
          <div>
            <span className="eyebrow">AUTOPILOT DASHBOARD</span>
            <h3>Control, positions, decisions and activity</h3>
          </div>
          <button className="btn btn-soft" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {message && <div className="v6-message dashboard-message" role="status">{message}</div>}
        {vaults.length > 0 && <section className="dashboard-control-panel">
          <div className="dashboard-account-line">
            <div className="vault-picker-field">
              <span>Autopilot account</span>
              <AutopilotAccountPicker
                value={selectedVault}
                options={existingVaultPickerOptions}
                onChange={(vault) => { setSelectedVault(vault); setCloseConfirming(false); }}
              />
            </div>
            <div className="autopilot-status-card">
              <span>Runtime</span>
              <strong className={(activeStrategy?.paused ?? activeVault?.paused) ? "warning" : "positive"}>
                {(activeStrategy?.paused ?? activeVault?.paused) ? "Paused" : activeStrategy?.exitPending ? "Closing position" : "Running"}
              </strong>
              <small>{activeStrategy?.lastDecision?.replaceAll("_", " ") || "Awaiting first decision"}</small>
            </div>
            <div className={`autopilot-pass-card compact ${passActive ? "active" : "warning"}`}>
              <div><span>AI ENTRY PASS</span><strong>{passActive ? `${passTimeLabel}${activePass?.pausedAt ? " · on hold" : ""}` : "New entries on Hold"}</strong><small>{activePass?.pausedAt ? "Timer on hold while Autopilot is paused" : passTimerState} · {passSignalsRemaining} confirmations left</small></div>
              <div className="pass-plans">
                <button type="button" className="btn btn-accent" disabled={passBusy} onClick={() => void purchaseAutopilotPass("24h")}>24h · ${passPrices["24h"].toFixed(2)}</button>
                <button type="button" className="btn btn-soft" disabled={passBusy} onClick={() => void purchaseAutopilotPass("7d")}>7d · ${passPrices["7d"].toFixed(2)}</button>
                <button type="button" className="btn btn-soft" disabled={passBusy} onClick={() => void purchaseAutopilotPass("30d")}>30d · ${passPrices["30d"].toFixed(2)}</button>
              </div>
              <small>{passBusy ? "Waiting for wallet payment…" : "Manual x402 renewal. Added time starts after unused time; never auto-renews."}</small>
            </div>
          </div>
          {selectedVault && <>
            <div className="dashboard-balance-strip">
              <div><span>Wallet available</span><strong>{walletBalanceText}</strong><small>Source for top-ups and pass payments</small></div>
              <div><span>Vault settlement</span><strong>{formatAssetAtomic(activeStrategy?.settlementBalance || activeVault?.balanceAtomic || undefined, activeSettlementDecimals)} {activeSettlementSymbol}</strong><small>Withdrawable after pausing</small></div>
              <div><span>Invested asset</span><strong>{formatAssetAtomic(activeStrategy?.targetBalance, activeStrategy?.targetDecimals ?? targetToken?.decimals ?? 18)} {activeStrategy?.targetSymbol || targetToken?.symbol || pair.split("-")[0]}</strong><small>May be sold by the strategy or withdrawn</small></div>
              <div><span>Total value</span><strong>{formatAssetAtomic(activeStrategy?.portfolioValueAtomic || activeVault?.balanceAtomic || undefined, activeSettlementDecimals)} {activeSettlementSymbol}</strong><small>Mark-to-market</small></div>
            </div>
            <div className="dashboard-actions-grid">
              <section className="vault-capital-manager">
                <div className="capital-action-tabs" role="tablist" aria-label="Manage Autopilot capital">
                  <button type="button" role="tab" aria-selected={capitalAction === "add"} className={capitalAction === "add" ? "active" : ""} onClick={() => setCapitalAction("add")}>Add funds</button>
                  <button type="button" role="tab" aria-selected={capitalAction === "withdraw"} className={capitalAction === "withdraw" ? "active" : ""} onClick={() => setCapitalAction("withdraw")}>Withdraw</button>
                </div>
                {capitalAction === "add" ? <div className="capital-action-panel" role="tabpanel">
                  <label><span>Amount from connected wallet</span><div className="unit-input"><input inputMode="decimal" value={addAmountHuman} onChange={(event) => setAddAmountHuman(event.target.value)} placeholder="0.00" /><button type="button" className="unit-max" disabled={!addMaximum || Number(addMaximum) <= 0} onClick={() => setAddAmountHuman(addMaximum)}>Max</button><b>{activeSettlementSymbol}</b></div></label>
                  {addBalanceState === "insufficient" && <div className="capital-inline-warning">Amount exceeds the connected wallet balance.</div>}
                  <button className="btn btn-accent full" disabled={busy || addBalanceState !== "ready"} onClick={() => void operateVault("fund")}>Add funds</button>
                </div> : <div className="capital-action-panel" role="tabpanel">
                  <div className="withdraw-asset-tabs" role="tablist"><button type="button" className={withdrawAssetMode === "settlement" ? "active" : ""} onClick={() => { setWithdrawAssetMode("settlement"); setWithdrawAmountHuman(""); }}>{activeSettlementSymbol}</button><button type="button" className={withdrawAssetMode === "target" ? "active" : ""} disabled={!activeStrategy?.targetAsset} onClick={() => { setWithdrawAssetMode("target"); setWithdrawAmountHuman(""); }}>{activeStrategy?.targetSymbol || targetToken?.symbol || pair.split("-")[0]}</button></div>
                  <label><span>Amount available: {formatAssetAtomic(withdrawBalanceAtomic || undefined, withdrawDecimals)} {withdrawSymbol}</span><div className="unit-input"><input inputMode="decimal" value={withdrawAmountHuman} onChange={(event) => setWithdrawAmountHuman(event.target.value)} placeholder="0.00" /><button type="button" className="unit-max" disabled={BigInt(withdrawBalanceAtomic || "0") <= 0n} onClick={() => setWithdrawAmountHuman(formatUnits(BigInt(withdrawBalanceAtomic || "0"), withdrawDecimals))}>Max</button><b>{withdrawSymbol}</b></div></label>
                  <button className="btn btn-accent full" disabled={busy || !(activeStrategy?.paused ?? activeVault?.paused ?? true) || withdrawBalanceState !== "ready"} onClick={() => void operateVault("withdraw")}>Withdraw to owner</button>
                  {!(activeStrategy?.paused ?? activeVault?.paused) && <small>Pause first; only the owner wallet can withdraw.</small>}
                </div>}
              </section>
              <section className="runtime-controls">
                <span className="eyebrow">OWNER CONTROLS</span>
                <div className="manager-actions"><button className="btn btn-danger" disabled={busy || (activeStrategy?.paused ?? activeVault?.paused ?? true)} onClick={() => void operateVault("pause")}>Pause · hold pass timer</button><button className="btn btn-accent" disabled={busy || !(activeStrategy?.paused ?? activeVault?.paused ?? false)} onClick={() => void operateVault("resume")}>Resume · run timer</button></div>
                {closeConfirming ? <div className="account-lookup-error"><strong>Withdraw every asset and close?</strong><small>The auditable vault contract remains reusable.</small><div className="manager-actions"><button className="btn btn-soft" onClick={() => setCloseConfirming(false)}>Cancel</button><button className="btn btn-danger" disabled={busy} onClick={() => void closeAndWithdrawAutopilot()}>Confirm</button></div></div> : <button className="btn btn-danger full" disabled={busy} onClick={() => setCloseConfirming(true)}>Close &amp; withdraw all</button>}
              </section>
            </div>
          </>}
        </section>}
        <div className="dashboard-metrics">
          <div>
            <span>Strategies</span>
            <strong>{strategies.length}</strong>
          </div>
          <div>
            <span>Running</span>
            <strong>
              {
                strategies.filter(
                  (item) => item.status === "active" && !item.paused,
                ).length
              }
            </strong>
          </div>
          <div>
            <span>Total portfolio value</span>
            <strong>{formatAtomic(aggregateRuntime.portfolioValueAtomic)}</strong>
            <small>
              {activeVault?.settlementSymbol ||
                WEB_NETWORKS[networkKey].payment.symbol}
            </small>
          </div>
          <div>
            <span>P&amp;L since activation</span>
            <strong
              className={
                (aggregateRuntime.pnlPct || 0) >= 0 ? "positive" : "negative"
              }
            >
              {typeof aggregateRuntime.pnlPct === "number"
                ? `${aggregateRuntime.pnlPct >= 0 ? "+" : ""}${aggregateRuntime.pnlPct.toFixed(2)}%`
                : "—"}
            </strong>
            <small>mark-to-market, cash-flow adjusted</small>
          </div>
        </div>
        {strategies.length ? (
          <div className="order-monitor">
            {strategies.map((item) => (
              <div className="order-monitor-row autopilot-row" key={item.id}>
                <span
                  className={`status-chip ${item.paused ? "paused" : item.status}`}
                >
                  {item.paused ? "paused" : item.status}
                </span>
                <div>
                  <strong>
                    {item.pair} · {item.timeframe}
                  </strong>
                  <small>Owner-controlled strategy</small>
                </div>
                <div>
                  <small>Last decision</small>
                  <strong>
                    {item.lastDecision?.replaceAll("_", " ") ||
                      "awaiting cycle"}
                  </strong>
                </div>
                <div>
                  <small>Mark</small>
                  <strong>{item.markPrice?.toLocaleString() || "—"}</strong>
                </div>
                <div>
                  <small>Proof</small>
                  <strong className="mono">
                    {item.evidenceHash
                      ? `${item.evidenceHash.slice(0, 10)}…`
                      : "—"}
                  </strong>
                </div>
                {item.lastTxHash ? (
                  <a
                    href={`${WEB_NETWORKS[networkKey].explorer}/tx/${item.lastTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Trade ↗
                  </a>
                ) : (
                  <span />
                )}
                {(item.lastError || item.telemetryError) && (
                  <small className="runtime-error">
                    {/\b401\b|\b402\b|\b403\b|permission[- ]denied|credits|spending limit|billing|quota/i.test(item.lastError || item.telemetryError || "")
                      ? `AI provider unavailable. New entry checks are backed off${item.aiRetryAt ? ` until ${new Date(item.aiRetryAt).toLocaleString()}` : ""}; no assets moved.`
                      : "A dependency check failed closed. Open the Strategy journal for details."}
                  </small>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-dashboard">
            <strong>No active strategy</strong>
            <span>
              Choose a market, capital and risk profile above to start.
            </span>
          </div>
        )}
        {strategies.length > 0 && (
          <div className="autopilot-trading-reports">
            {strategies.map((item) => {
              const definition = strategyCatalog.find(
                (entry) => entry.id === item.strategyType,
              );
              const latest = item.evaluations?.at(-1);
              const evaluations = item.evaluations || [];
              const evaluationCount = item.evaluationCount ?? evaluations.length;
              const filledBuys = item.filledBuyCount ?? evaluations.filter((entry) => entry.action === "buy" && entry.status === "filled").length;
              const filledSells = item.filledSellCount ?? evaluations.filter((entry) => entry.action === "sell" && entry.status === "filled").length;
              const holds = item.holdCount ?? evaluations.filter((entry) => entry.action === "hold" && entry.status === "held").length;
              const failures = item.failureCount ?? evaluations.filter((entry) => entry.status === "failed").length;
              const failureIncidents = evaluations.reduce((count, entry, index) => {
                if (entry.status !== "failed") return count;
                const previous = evaluations[index - 1];
                const sameBurst = previous?.status === "failed"
                  && `${previous.reason}:${previous.error || ""}` === `${entry.reason}:${entry.error || ""}`
                  && Date.parse(entry.evaluatedAt) - Date.parse(previous.evaluatedAt) < 6 * 60 * 60_000;
                return count + (sameBurst ? 0 : 1);
              }, 0);
              const recentDecisions = [...evaluations].reverse().filter((entry, index, all) => {
                if (index === 0) return true;
                const previous = all[index - 1];
                return `${entry.action}:${entry.status}:${entry.reason}:${entry.error || ""}` !== `${previous.action}:${previous.status}:${previous.reason}:${previous.error || ""}`;
              }).slice(0, 20);
              const providerBlocked = /\b401\b|\b402\b|\b403\b|permission[- ]denied|credits|spending limit|billing|quota/i.test(latest?.error || "");
              return (
                <details key={`${item.id}-report`}>
                  <summary>
                    Strategy journal · {item.pair} ·{" "}
                    {definition?.label ||
                      item.strategyType?.replaceAll("_", " ") ||
                      "Strategy"}
                  </summary>
                  <div className="autopilot-report-toolbar">
                    <div><span>Evaluations</span><strong>{evaluationCount}</strong><small>lifetime</small></div>
                    <div><span>Filled buys</span><strong>{filledBuys}</strong></div>
                    <div><span>Filled sells</span><strong>{filledSells}</strong></div>
                    <div><span>Holds</span><strong>{holds}</strong></div>
                    <div><span>Failure incidents</span><strong>{failureIncidents}</strong><small>{failures} raw failed attempts retained</small></div>
                    <div><span>AI today</span><strong>{item.aiCallsToday || 0} · ${(item.aiActualCostTodayUsd || 0).toFixed(4)}</strong><small>provider calls · USD</small></div>
                    <div><span>Last cycle</span><strong>{latest ? new Date(latest.evaluatedAt).toLocaleTimeString() : "—"}</strong><small>{latest ? new Date(latest.evaluatedAt).toLocaleDateString() : "awaiting"}</small></div>
                    <div><span>Next AI eligible</span><strong>{item.aiNextEligibleAt ? new Date(item.aiNextEligibleAt).toLocaleTimeString() : "Candidate driven"}</strong><small>{item.aiBudgetStatus?.replaceAll("_", " ") || "free gate first"}</small></div>
                    <div><span>Position basis</span><strong>{item.positionEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) || "No open entry"}</strong><small>mark {item.markPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) || "—"}</small></div>
                    <button type="button" className="btn btn-soft" onClick={() => exportAutopilotLog(item)}>Export CSV activity</button>
                  </div>
                  <div className={`strategy-now ${item.paused ? "paused" : latest?.status || "held"}`}>
                    <div><span>WHAT IT IS DOING NOW</span><strong>{item.paused ? "PAUSED · no entry checks" : providerBlocked ? "WAITING · AI provider unavailable" : latest ? `${latest.action.toUpperCase()} · ${latest.status}` : "WAITING · first candle"}</strong></div>
                    <p>{item.paused ? "The vault cannot trade and the AI Entry Pass timer is on hold. Resume when you want monitoring to continue." : providerBlocked ? `No assets moved. New AI requests are blocked until ${item.aiRetryAt ? new Date(item.aiRetryAt).toLocaleString() : "the provider retry window"}; deterministic position protection remains available.` : latest?.reason || "PULSE is waiting for the next eligible candle."}</p>
                  </div>
                  <div className="autopilot-report-grid">
                    <section>
                      <span className="eyebrow">STRATEGY FUNCTION</span>
                      <h4>
                        {definition?.purpose ||
                          "Rule-bound compact-signal strategy"}
                      </h4>
                      <b>Entry rules</b>
                      <ul>
                        {definition?.entryRules.map((rule) => (
                          <li key={rule}>{rule}</li>
                        ))}
                      </ul>
                      <b>Exit rules</b>
                      <ul>
                        {definition?.exitRules.map((rule) => (
                          <li key={rule}>{rule}</li>
                        ))}
                      </ul>
                      <b>Live workflow</b>
                      <ol>
                        <li>Every new candle passes a free deterministic setup gate.</li>
                        <li>Only a valid candidate may consume one compact AI confirmation from the prepaid pass.</li>
                        <li>All signed entry rules must pass before a Buy; otherwise the vault remains in Hold.</li>
                        <li>After a fill, one-minute deterministic TP/SL and structure monitoring govern Sell decisions without using xAI.</li>
                        <li>After a full Sell, the same strategy may wait and Buy again while its pass remains active.</li>
                      </ol>
                    </section>
                    <section>
                      <span className="eyebrow">LATEST EVALUATION</span>
                      <h4>
                        {latest
                          ? `${latest.action.toUpperCase()} - ${latest.status}`
                          : "Awaiting evaluation"}
                      </h4>
                      {latest && (
                        <>
                          <p>{latest.reason}</p>
                          <dl className="trade-facts">
                            <div>
                              <dt>Evaluated</dt>
                              <dd>
                                {new Date(latest.evaluatedAt).toLocaleString()}
                              </dd>
                            </div>
                            <div>
                              <dt>Compact AI signal</dt>
                              <dd>
                                {latest.bias} - {latest.confidence}%
                              </dd>
                            </div>
                            <div>
                              <dt>TP / SL</dt>
                              <dd>
                                {item.activeTakeProfit ?? "-"} /{" "}
                                {item.activeStopLoss ?? "-"}
                              </dd>
                            </div>
                          </dl>
                          <div className="rule-results">
                            {latest.rules.map((rule) => (
                              <div
                                className={rule.passed ? "pass" : "fail"}
                                key={rule.id}
                              >
                                <b>{rule.passed ? "PASS" : "WAIT"}</b>
                                <span>{rule.label}</span>
                                <small>
                                  {rule.observed} - requires {rule.required}
                                </small>
                              </div>
                            ))}
                          </div>
                          {latest.txHash && (
                            <a
                              href={`${WEB_NETWORKS[networkKey].explorer}/tx/${latest.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open executed trade
                            </a>
                          )}
                          {latest.error && <details className="technical-error"><summary>Technical error details</summary><div className="runtime-error">{latest.error}</div></details>}
                        </>
                      )}
                    </section>
                  </div>
                  <section className="autopilot-evaluation-log">
                    <div className="dashboard-head"><div><span className="eyebrow">STRATEGY DECISIONS</span><h4>Why PULSE waited, bought or sold</h4></div><small>Newest first · repeated identical failures are collapsed · CSV includes on-chain activity</small></div>
                    {recentDecisions.length ? recentDecisions.map((entry) => (
                      <div className="evaluation-log-row" key={entry.id}>
                        <span className={`status-chip ${entry.status}`}>{entry.status}</span>
                        <strong>{entry.action.toUpperCase()}</strong>
                        <span>{new Date(entry.evaluatedAt).toLocaleString()}</span>
                        <span>{entry.bias} · {entry.confidence}%</span>
                        <small>{entry.reason}</small>
                        {entry.txHash ? <a href={`${WEB_NETWORKS[networkKey].explorer}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">Transaction ↗</a> : <span />}
                      </div>
                    )) : <div className="empty-dashboard compact"><strong>Awaiting the first new-candle evaluation</strong></div>}
                  </section>
                </details>
              );
            })}
          </div>
        )}
        <section className="autopilot-chain-activity">
          <div className="dashboard-head"><div><span className="eyebrow">ON-CHAIN ACTIVITY</span><h4>Wallet confirmations, fills and owner actions</h4></div><small>Separate from strategy decisions · newest first</small></div>
          {activitySyncNotice && <div className="capital-inline-warning">{activitySyncNotice}</div>}
          {activity.filter((entry) => entry.source === "autopilot").length ? activity.filter((entry) => entry.source === "autopilot").slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 30).map((entry) => (
            <div className="chain-activity-row" key={entry.id}>
              <span className={`status-chip ${entry.status}`}>{entry.status}</span>
              <strong>{entry.kind.replaceAll("_", " ")}</strong>
              <span>{entry.pair || "Autopilot account"}</span>
              <time>{new Date(entry.createdAt).toLocaleString()}</time>
              {entry.txHash ? <a href={`${WEB_NETWORKS[networkKey].explorer}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">Transaction ↗</a> : <span />}
            </div>
          )) : <div className="empty-dashboard compact"><strong>No on-chain activity yet</strong><span>Wallet confirmations and executed trades will appear here.</span></div>}
        </section>
      </section>
    </div>
  );

}

function ActivityDashboard({
  title,
  activity,
  networkKey,
  onRefresh,
  orders = [],
  strategies = [],
  onCloseOrder,
  onManageBracket,
  onCloseAll,
  syncNotice = "",
}: {
  title: string;
  activity: Activity[];
  networkKey: WebNetworkKey;
  onRefresh: () => Promise<void>;
  orders?: AutomationOrder[];
  strategies?: AutopilotStrategyView[];
  onCloseOrder?: (order: AutomationOrder) => Promise<void>;
  onManageBracket?: (
    order: AutomationOrder,
    action: "update" | "pause" | "resume",
    takeProfit?: string,
    stopLoss?: string,
  ) => Promise<void>;
  onCloseAll?: () => Promise<void>;
  syncNotice?: string;
}) {
  const [filter, setFilter] = useState<
    "all" | "pending" | "active" | "executed" | "cancelled" | "activity"
  >("all");
  const openOrders = orders.filter(
    (order) => order.status === "active" || order.status === "paused",
  );
  const pendingOrders = orders.filter(
    (order) =>
      (order.version === "limit-v2" ||
        (order.version === "bracket-v1" && order.phase === "entry")) &&
      (order.status === "active" || order.status === "paused"),
  );
  const activePositions = orders.filter(
    (order) =>
      (order.version === "oco-v1" ||
        (order.version === "bracket-v1" && order.phase === "protected")) &&
      (order.status === "active" || order.status === "paused"),
  );
  const executedOrders = orders.filter(
    (order) =>
      (order.version === "limit-v2" || order.version === "bracket-v1") &&
      order.status === "filled",
  );
  const cancelledOrders = orders.filter(
    (order) => order.status === "cancelled",
  );
  const confirmedMarketTrades = activity.filter(
    (item) =>
      item.status === "confirmed" &&
      (item.kind === "market_buy" || item.kind === "market_sell"),
  );
  const isExecutedActivity = (item: Activity) =>
    item.status === "confirmed" &&
    /market_|fill|execute|take_profit|stop_loss/i.test(item.kind);
  const executedAutopilotCount = countExecutedAutopilotFills(activity, strategies);
  const pendingTransactions = activity.filter(
    (item) =>
      item.status === "pending" &&
      item.kind !== "buy_below" &&
      item.kind !== "sell_above",
  ).length;
  const activeAutopilotPositions = strategies.filter(hasProtectedAutopilotPosition);
  const pnlRows = activePositions.filter(
    (order) => typeof order.estimatedPnlPct === "number",
  );
  const estimatedPnlPct = averageKnownPnl([
    ...pnlRows.map((order) => order.estimatedPnlPct),
    ...strategies.map((item) => item.pnlPct),
  ]);
  const orderMatches = (order: AutomationOrder) =>
    filter === "all" ||
    (filter === "pending" && pendingOrders.includes(order)) ||
    (filter === "active" && activePositions.includes(order)) ||
    (filter === "executed" && executedOrders.includes(order)) ||
    (filter === "cancelled" && cancelledOrders.includes(order));
  const visibleOrders =
    filter === "activity" ? [] : orders.filter(orderMatches);
  const visibleActivity =
    filter === "all" || filter === "activity"
      ? activity
      : filter === "pending"
        ? activity.filter((item) => item.status === "pending")
        : filter === "executed"
          ? activity.filter(isExecutedActivity)
          : filter === "cancelled"
            ? activity.filter((item) => /cancel|close/i.test(item.kind))
            : [];
  return (
    <section className="card activity-dashboard">
      <div className="dashboard-head">
        <div>
          <span className="eyebrow">RECONCILED ACTIVITY</span>
          <h3>{title}</h3>
        </div>
        <div className="actions">
          {onCloseAll && (
            <button
              className="btn btn-soft"
              disabled={!openOrders.length}
              onClick={() => void onCloseAll()}
            >
              Close all open
            </button>
          )}
          <button className="btn btn-soft" onClick={() => void onRefresh()}>
            Refresh
          </button>
        </div>
      </div>
      {syncNotice && (
        <div className="activity-sync-notice" role="status">
          <span />
          {syncNotice}
        </div>
      )}
      <div className="dashboard-metrics">
        <div>
          <span>Pending</span>
          <strong>{pendingOrders.length + pendingTransactions}</strong>
          <small>limit orders + transactions awaiting settlement</small>
        </div>
        <div>
          <span>Active</span>
          <strong>{activePositions.length + activeAutopilotPositions.length}</strong>
          <small>positions currently governed by TP / SL</small>
        </div>
        <div>
          <span>Executed</span>
          <strong>
            {executedOrders.length +
              confirmedMarketTrades.length +
              executedAutopilotCount}
          </strong>
          <small>filled spot buys and sells without active protection</small>
        </div>
        <div>
          <span>Cancelled</span>
          <strong>{cancelledOrders.length}</strong>
          <small>owner cancel-and-withdraw confirmed on-chain</small>
        </div>
        <div>
          <span>Activity</span>
          <strong>{activity.length}</strong>
          <small>all wallet and contract transactions</small>
        </div>
        <div>
          <span>PNL</span>
          <strong>
            {estimatedPnlPct === null
              ? "—"
              : `${estimatedPnlPct >= 0 ? "+" : ""}${estimatedPnlPct.toFixed(2)}%`}
          </strong>
          <small>
            {strategies.length
              ? "autopilot vault mark-to-market P&L"
              : orders.length
                ? "estimated open OCO P&L"
                : "shown when position basis is known"}
          </small>
        </div>
      </div>
      <div
        className="dashboard-filters"
        role="tablist"
        aria-label="Dashboard view"
      >
        {(
          [
            "all",
            "pending",
            "active",
            "executed",
            "cancelled",
            "activity",
          ] as const
        ).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={filter === item}
            className={filter === item ? "active" : ""}
            onClick={() => setFilter(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      {visibleOrders.length > 0 && (
        <div className="order-monitor">
          <div className="monitor-title">
            <strong>On-chain order monitor</strong>
            <span>Contract state · actual receipt fill · OKX spot mark</span>
          </div>
          {visibleOrders.map((order) => (
            <div className="order-monitor-row" key={order.id}>
              <span className={`status-chip ${order.status}`}>
                {(order.version === "limit-v2" ||
                  (order.version === "bracket-v1" &&
                    order.phase === "entry")) &&
                order.status === "active"
                  ? "pending"
                  : (order.version === "limit-v2" ||
                        order.version === "bracket-v1") &&
                      order.status === "filled"
                    ? "executed"
                    : order.version === "oco-v1" && order.status === "filled"
                      ? "closed"
                      : order.status}
              </span>
              <div>
                <strong>{order.instId}</strong>
                <small>
                  {order.executionPair && order.executionPair !== order.instId
                    ? `${order.executionPair} · `
                    : ""}
                  {order.version === "oco-v1"
                    ? `OCO #${order.orderId}`
                    : order.version === "bracket-v1"
                      ? `${order.status === "cancelled" ? "Owner cancelled and withdrew" : order.lastAction === "take_profit" ? "Take-profit executed" : order.lastAction === "stop_loss" ? "Stop-loss executed" : order.status === "filled" ? "Protected exit executed" : order.phase === "protected" ? "Protected bracket" : order.triggerAbove ? "Bracket above" : "Bracket below"} #${order.orderId}`
                      : `${order.triggerAbove ? "Sell above" : "Buy below"} #${order.orderId}`}
                </small>
              </div>
              <div>
                <small>
                  {order.phase === "entry" ? "Trigger" : order.version === "bracket-v1" || order.version === "oco-v1" ? "TP / SL" : "Fill trigger"}
                </small>
                <strong>
                  {order.triggerPrice && order.triggerPrice > 0
                    ? order.triggerPrice.toLocaleString()
                    : "Refreshing…"}
                  {order.secondaryTriggerPrice &&
                  order.secondaryTriggerPrice > 0
                    ? ` / ${order.secondaryTriggerPrice.toLocaleString()}`
                    : ""}
                </strong>
              </div>
              <div>
                <small>{order.exitPrice ? "Actual entry / exit" : "Actual entry"}</small>
                <strong>
                  {order.entryPrice && order.entryPrice > 0
                    ? order.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })
                    : order.phase === "entry" ? "Not filled" : "Unavailable"}
                  {order.exitPrice && order.exitPrice > 0
                    ? ` / ${order.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}`
                    : ""}
                </strong>
              </div>
              <div>
                <small>Mark (OKX)</small>
                <strong>
                  {order.currentPrice && order.currentPrice > 0
                    ? order.currentPrice.toLocaleString()
                    : "Refreshing…"}
                </strong>
              </div>
              <div>
                <small>{order.status === "filled" ? "Realized P&L" : "Est. P&L"}</small>
                <strong
                  className={
                    ((order.status === "filled" ? order.realizedPnlPct : order.estimatedPnlPct) || 0) >= 0 ? "positive" : "negative"
                  }
                >
                  {order.status === "filled" && typeof order.realizedPnlPct === "number"
                    ? `${order.realizedPnlPct >= 0 ? "+" : ""}${order.realizedPnlPct.toFixed(2)}%`
                    : typeof order.estimatedPnlPct === "number"
                    ? `${order.estimatedPnlPct >= 0 ? "+" : ""}${order.estimatedPnlPct.toFixed(2)}%`
                    : order.phase === "entry"
                      ? "Not filled"
                      : order.entryPrice
                        ? "Refreshing…"
                        : "Fill basis unavailable"}
                </strong>
              </div>
              {order.version === "bracket-v1" &&
              order.phase === "protected" &&
              onManageBracket &&
              onCloseOrder ? (
                <BracketRowActions
                  order={order}
                  onManage={onManageBracket}
                  onClose={onCloseOrder}
                />
              ) : onCloseOrder &&
                (order.status === "active" || order.status === "paused") ? (
                <button
                  className="btn btn-soft"
                  onClick={() => void onCloseOrder(order)}
                >
                  Close
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
      {strategies.length > 0 && (filter === "all" || filter === "active") && (
        <div className="order-monitor">
          <div className="monitor-title">
            <strong>On-chain Autopilot monitor</strong>
            <span>Vault capital · actual entry · OKX spot mark</span>
          </div>
          {strategies
            .filter(
              (item) =>
                filter === "all" || (item.status === "active" && !item.paused),
            )
            .map((item) => (
              <div className="order-monitor-row autopilot-row" key={item.id}>
                <span
                  className={`status-chip ${item.paused ? "paused" : item.status}`}
                >
                  {item.paused ? "paused" : item.status}
                </span>
                <div>
                  <strong>
                    {item.pair} · {item.timeframe}
                  </strong>
                  <small>
                    {item.vault.slice(0, 8)}…{item.vault.slice(-6)}
                  </small>
                </div>
                <div>
                  <small>Capital</small>
                  <strong>
                    {item.portfolioValueAtomic
                      ? `${formatUnits(BigInt(item.portfolioValueAtomic), WEB_NETWORKS[networkKey].payment.decimals)} ${WEB_NETWORKS[networkKey].payment.symbol}`
                      : "Refreshing…"}
                  </strong>
                </div>
                <div>
                  <small>{item.positionEntryPrice ? "Position entry" : "Last entry"}</small>
                  <strong>
                    {(item.positionEntryPrice || item.lastEntryPrice)?.toLocaleString(undefined, { maximumFractionDigits: 8 }) || "No filled buy"}
                  </strong>
                </div>
                <div>
                  <small>Mark</small>
                  <strong>
                    {item.markPrice?.toLocaleString() || "Refreshing…"}
                  </strong>
                </div>
                <div>
                  <small>Portfolio P&amp;L</small>
                  <strong>
                    {typeof item.pnlPct === "number"
                      ? `${item.pnlPct >= 0 ? "+" : ""}${item.pnlPct.toFixed(2)}%`
                      : "Starts after activation"}
                  </strong>
                </div>
                <span />
              </div>
            ))}
        </div>
      )}
      {visibleActivity.length ? (
        <div className="activity-table">
          {visibleActivity.map((a) => (
            <div className="activity-row" key={a.id}>
              <span className={`status-chip ${isExecutedActivity(a) ? "filled" : a.status}`}>
                {isExecutedActivity(a) ? "executed" : a.status}
              </span>
              <strong>{a.kind.replaceAll("_", " ")}</strong>
              <span>
                {a.executionPair && a.executionPair !== a.pair
                  ? `${a.pair || "Analysis"} → ${a.executionPair}`
                  : a.pair || a.source}
              </span>
              {a.fillPrice ? (
                <span className="activity-execution-detail">
                  <b>{/buy|entry_protected/i.test(a.kind) ? "Entry" : "Exit"} {a.fillPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}</b>
                  <small>{a.fillInputSymbol && a.fillOutputSymbol ? `${a.fillInputSymbol} → ${a.fillOutputSymbol} · ` : ""}{new Date(a.fillObservedAt || a.createdAt).toLocaleString()}</small>
                </span>
              ) : <span>{new Date(a.createdAt).toLocaleString()}</span>}
              {a.txHash ? (
                <a
                  href={`${WEB_NETWORKS[networkKey].explorer}/tx/${a.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Explorer ↗
                </a>
              ) : (
                <span>—</span>
              )}
            </div>
          ))}
        </div>
      ) : !visibleOrders.length &&
        !(strategies.length && (filter === "all" || filter === "active")) ? (
        <div className="empty-dashboard">
          <strong>No {filter === "all" ? "recorded" : filter} items</strong>
          <span>
            On-chain state and confirmed wallet actions will appear here.
          </span>
        </div>
      ) : null}
      <details className="price-methodology">
        <summary>How trigger, entry, mark and P&amp;L are calculated</summary>
        <p><b>Trigger</b> is the owner-set price condition; it is not the fill price. <b>Actual entry/exit</b> is calculated from confirmed on-chain token amounts in the contract or transaction receipt. <b>Mark</b> is the timestamped OKX public spot last price. Open P&amp;L compares Mark with Actual entry; realized P&amp;L compares Actual exit with Actual entry. PULSE shows &quot;unavailable&quot; instead of inventing a basis.</p>
        <p>For automated execution, the keeper writes the fresh OKX observation to the PULSE oracle router with a five-minute maximum age. The contract rejects missing or stale observations. The OKX Onchain OS route is separately constrained by the signed slippage and minimum-output rules.</p>
      </details>
    </section>
  );
}

function BracketRowActions({
  order,
  onManage,
  onClose,
}: {
  order: AutomationOrder;
  onManage: (
    order: AutomationOrder,
    action: "update" | "pause" | "resume",
    takeProfit?: string,
    stopLoss?: string,
  ) => Promise<void>;
  onClose: (order: AutomationOrder) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [takeProfit, setTakeProfit] = useState(
    order.takeProfit ? String(order.takeProfit) : "",
  );
  const [stopLoss, setStopLoss] = useState(
    order.stopLoss ? String(order.stopLoss) : "",
  );
  return (
    <div className="bracket-row-actions">
      <button
        className="btn btn-soft"
        type="button"
        onClick={() => setEditing((value) => !value)}
      >
        Edit
      </button>
      <button
        className="btn btn-soft"
        type="button"
        onClick={() =>
          void onManage(order, order.status === "paused" ? "resume" : "pause")
        }
      >
        {order.status === "paused" ? "Resume" : "Pause"}
      </button>
      <button
        className="btn btn-danger"
        type="button"
        onClick={() => void onClose(order)}
      >
        Close
      </button>
      {editing && (
        <div className="bracket-edit-popover">
          <label>
            Take profit
            <input
              inputMode="decimal"
              value={takeProfit}
              onChange={(event) => setTakeProfit(event.target.value)}
            />
          </label>
          <label>
            Stop loss
            <input
              inputMode="decimal"
              value={stopLoss}
              onChange={(event) => setStopLoss(event.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!takeProfit || !stopLoss}
            onClick={() => void onManage(order, "update", takeProfit, stopLoss)}
          >
            Save levels
          </button>
        </div>
      )}
    </div>
  );
}

function DisabledArc({ feature }: { feature: string }) {
  return (
    <div className="card disabled-feature">
      <span className="network-badge">ARC TESTNET</span>
      <h2>{feature} is hidden on this network</h2>
      <p>
        Arc Testnet remains available for analysis and x402 payment testing.
        Select X Layer, Base, or Arbitrum for mainnet execution.
      </p>
    </div>
  );
}

export function TelegramWorkspace() {
  const [status, setStatus] = useState<{
    configured?: boolean;
    botUrl?: string | null;
    botUsername?: string | null;
    durableDelivery?: boolean;
  } | null>(null);
  useEffect(() => {
    void apiGet("/v1/telegram/status").then(
      (response) => response.ok && setStatus(response.data as typeof status),
    );
  }, []);
  return (
    <div className="v6-workspace docs-workspace telegram-user-guide">
      <section className="v6-heading">
        <div>
          <span className="eyebrow">ANALYSIS IN YOUR CHAT</span>
          <h2>Use PULSE in Telegram</h2>
          <p>
            Choose a market in chat, approve the normal x402 payment in the
            secure Mini App, and receive the completed Global or Prediction
            report back in the same conversation.
          </p>
        </div>
        {status?.botUrl ? (
          <a
            className="btn btn-accent telegram-launch"
            href={status.botUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open @{status.botUsername} ↗
          </a>
        ) : (
          <span className="telegram-availability">
            <i className={status?.configured ? "ready" : ""} />
            {status?.configured ? "Bot ready" : "Bot link is being configured"}
          </span>
        )}
      </section>
      <section className="card telegram-flow-card">
        <div className="dashboard-head">
          <div>
            <span className="eyebrow">FIRST REPORT</span>
            <h3>Four steps—no bot custody</h3>
          </div>
          <span
            className={`status-chip ${status?.durableDelivery ? "confirmed" : "pending"}`}
          >
            {status?.durableDelivery ? "durable delivery" : "checking delivery"}
          </span>
        </div>
        <div className="telegram-steps">
          <article>
            <span>1</span>
            <div>
              <strong>Open and start</strong>
              <p>
                Open the official PULSE bot and press Start. Do not send a seed
                phrase or private key.
              </p>
            </div>
          </article>
          <article>
            <span>2</span>
            <div>
              <strong>Choose a service</strong>
              <p>
                Use Global Market for an OKX pair or Prediction Market for one
                live question. Then choose Base or Premium.
              </p>
            </div>
          </article>
          <article>
            <span>3</span>
            <div>
              <strong>Pay securely</strong>
              <p>
                Tap Pay & generate. The PULSE Mini App opens with the exact
                service, network and price. Connect your wallet and review its
                x402 signature.
              </p>
            </div>
          </article>
          <article>
            <span>4</span>
            <div>
              <strong>Receive and recover</strong>
              <p>
                The bot posts a concise result and a private full-report button.
                Delivery retries do not create another charge.
              </p>
            </div>
          </article>
        </div>
      </section>
      <div className="telegram-guide-grid">
        <section className="card command-card">
          <span className="eyebrow">WHAT TO TYPE</span>
          <h3>Commands</h3>
          <div className="command-list">
            <code>/global</code>
            <span>Pair → timeframe → tier</span>
            <code>/prediction</code>
            <span>Question → tier</span>
            <code>/reports</code>
            <span>Your delivered report history</span>
            <code>/wallet</code>
            <span>Explain link/unlink security</span>
            <code>/help</code>
            <span>Show the guided menu again</span>
          </div>
        </section>
        <section className="card telegram-example">
          <span className="eyebrow">EXAMPLE</span>
          <h3>BTC 4H Premium</h3>
          <div className="chat-demo">
            <div className="chat-user">/global</div>
            <div className="chat-bot">
              Choose pair <b>BTC-USDT</b> → timeframe <b>4H</b> → <b>Premium</b>
              .
            </div>
            <div className="chat-user">Pay & generate</div>
            <div className="chat-bot report">
              Report ready ✓
              <small>
                Elliott continuation/correction paths, invalidation, chart and
                private full report.
              </small>
            </div>
          </div>
        </section>
      </div>
      <section className="card telegram-security">
        <div>
          <span className="eyebrow">SECURITY</span>
          <h3>What Telegram can—and cannot—access</h3>
        </div>
        <div className="security-columns">
          <ul>
            <li>Receives the report selected for that chat</li>
            <li>Uses an expiring chat-bound delivery capability</li>
            <li>Retries a failed delivery from KV</li>
          </ul>
          <ul>
            <li>Never receives private keys or seed phrases</li>
            <li>Cannot reuse wallet authorization</li>
            <li>Cannot trade or move funds from chat</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export function DocsWorkspace() {
  const sections = [
    ["docs-start", "Quick start"],
    ["docs-global", "Global reports"],
    ["docs-global-flow", "Timeframes & handoff"],
    ["docs-prediction", "Prediction reports"],
    ["docs-safety", "Risk Guard"],
    ["docs-spot", "Spot trading"],
    ["docs-spot-examples", "Spot examples"],
    ["docs-spot-troubleshoot", "Spot troubleshooting"],
    ["docs-auto", "Autopilot"],
    ["docs-auto-capital", "Autopilot capital"],
    ["docs-auto-rules", "Autopilot rules"],
    ["docs-auto-example", "Autopilot example"],
    ["docs-pay", "Payments"],
    ["docs-agents", "Agents & API"],
    ["docs-recover", "Report history"],
    ["docs-telegram", "Telegram"],
  ];
  return (
    <div className="docs-product">
      <header className="docs-product-head">
        <div>
          <span className="eyebrow">PULSE USER HANDBOOK</span>
          <h2>Learn the product, then act with context</h2>
          <p>
            Interactive guidance for analysis, execution, payments and recovery.
            No operator deployment files, no architecture prerequisites.
          </p>
        </div>
        <div className="docs-version">
          <span>PRODUCT GUIDE</span>
          <strong>PULSE</strong>
          <small>Global · Prediction · Spot · Autopilot</small>
        </div>
      </header>
      <div className="docs-product-layout">
        <aside className="docs-nav" aria-label="Documentation navigation">
          <strong>On this page</strong>
          {sections.map(([id, label], index) => (
            <a href={`#${id}`} key={id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {label}
            </a>
          ))}
        </aside>
        <div className="docs-content">
          <section id="docs-start" className="docs-section hero-doc">
            <div>
              <span className="eyebrow">QUICK START</span>
              <h3>From question to controlled action</h3>
              <p>
                PULSE separates evidence, payment and execution. A report never
                broadcasts a transaction; it creates a conditional setup you can
                load into Spot or an owner-bounded policy you can use in
                Autopilot.
              </p>
              <div className="docs-journey">
                <b>Choose market</b>
                <i>→</i>
                <b>Load free data</b>
                <i>→</i>
                <b>Buy report</b>
                <i>→</i>
                <b>Review setup</b>
                <i>→</i>
                <b>Choose next action</b>
              </div>
            </div>
            <div className="docs-mini-chart">
              <svg viewBox="0 0 500 230">
                <path
                  d="M20 178 L80 155 L135 168 L195 110 L250 132 L310 72 L365 95"
                  className="docs-price"
                />
                <path d="M365 95 Q420 58 478 38" className="docs-bull" />
                <path d="M365 95 Q410 122 438 96 Q458 78 478 103" className="docs-base" />
                <path d="M365 95 Q420 145 478 180" className="docs-bear" />
                <text x="425" y="30">
                  WAVE (5)
                </text>
                <text x="402" y="88">
                  A-B-C RESET
                </text>
                <text x="395" y="198">
                  COUNT INVALID
                </text>
              </svg>
              <small>
                Premium reports map wave-consistent continuation, correction
                and invalidation paths—not generic up/side/down guesses.
              </small>
            </div>
          </section>

          <section id="docs-global" className="docs-section">
            <span className="docs-number">01</span>
            <div className="docs-copy">
              <span className="eyebrow">GLOBAL MARKET</span>
              <h3>
                Analyze any live OKX spot pair, including available RWA/xSTOCK
                instruments
              </h3>
              <ol>
                <li>
                  Start from the product-wide Opportunity Radar or choose any
                  live OKX pair.
                </li>
                <li>
                  Select a timeframe and load free market data to confirm
                  freshness.
                </li>
                <li>
                  Choose Base for concise context or Premium for chart structure
                  and scenario depth.
                </li>
                <li>
                  When the evidence supports a long spot setup, choose{" "}
                  <b>Market buy</b> or <b>Limit buy</b> directly in the report.
                  Agentic Wallet reviews and signs the prepared transaction.
                  Autopilot starts separately with its own live signal policy.
                </li>
              </ol>
              <div className="docs-callout">
                <b>How the visible workflow works</b>
                <span>
                  The journey bar keeps Analyze → Spot trade / Autopilot
                  visible. Spot also repeats the radar when no report is loaded
                  and sends you back to analysis instead of leaving an empty
                  ticket unexplained.
                </span>
              </div>
              <div className="docs-callout">
                <b>How to read a setup</b>
                <span>
                  Entry is a condition—not a command. TP is the bullish scenario
                  objective. SL is the report invalidation. Reports create buy
                  or wait plans; selling remains an owner action for closing
                  assets already held.
                </span>
              </div>
              <div className="docs-callout">
                <b>DeFi uses the selected chain asset</b>
                <span>
                  PULSE resolves the exact representation before searching for
                  yield—for example BTC becomes cbBTC on Base or WBTC on
                  Arbitrum. A product is shown only when its token contract
                  matches; otherwise the report says none were verified on the
                  selected RPC instead of presenting a different asset.
                </span>
              </div>
            </div>
            <div className="docs-example">
              <span>EXAMPLE</span>
              <strong>ETH-USDT · 4H · Premium</strong>
              <dl>
                <div>
                  <dt>Observed</dt>
                  <dd>2,320</dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd>2,280–2,320</dd>
                </div>
                <div>
                  <dt>TP</dt>
                  <dd>2,550</dd>
                </div>
                <div>
                  <dt>SL</dt>
                  <dd>2,067</dd>
                </div>
              </dl>
              <small>
                Illustrative values only. Your report uses its live snapshot.
              </small>
            </div>
          </section>

          <section id="docs-global-flow" className="docs-deep-dive">
            <div className="docs-deep-head">
              <span className="eyebrow">
                GLOBAL MARKET · TIMEFRAME &amp; HANDOFF
              </span>
              <h3>One selection follows the report into execution</h3>
              <p>
                The themed timeframe picker changes its visual language with X
                Layer, Base, Arbitrum and Arc while preserving the same candle
                meaning. Selecting a new interval clears stale report state so
                chart indicators and the paid analysis cannot silently disagree.
              </p>
            </div>
            <div className="docs-timeframe-map">
              <article>
                <b>15m</b>
                <span>Fast momentum</span>
                <small>Short intraday entries; highest noise.</small>
              </article>
              <article>
                <b>1H</b>
                <span>Intraday trend</span>
                <small>Session structure and tactical levels.</small>
              </article>
              <article>
                <b>4H</b>
                <span>Swing trading</span>
                <small>Balanced active-trading context.</small>
              </article>
              <article>
                <b>1D</b>
                <span>Position context</span>
                <small>Major levels and multi-day structure.</small>
              </article>
              <article>
                <b>1W</b>
                <span>Macro structure</span>
                <small>Long-cycle context, not entry timing.</small>
              </article>
            </div>
            <div
              className="docs-signal-flow"
              aria-label="Analysis to execution workflow"
            >
              <div>
                <small>DISCOVER</small>
                <b>Opportunity Radar</b>
              </div>
              <i>→</i>
              <div>
                <small>VERIFY</small>
                <b>Base / Premium report</b>
              </div>
              <i>→</i>
              <div>
                <small>CHOOSE</small>
                <b>Market or Limit</b>
              </div>
              <i>or</i>
              <div>
                <small>AUTOMATE</small>
                <b>Guarded Autopilot</b>
              </div>
            </div>
            <div className="docs-callout">
              <b>What is carried forward</b>
              <span>
                Pair, timeframe, Buy/Wait decision, entry condition, take
                profit, stop loss, analysis snapshot and selected RPC context.
                Spot and Autopilot then independently re-check token identity,
                live route and wallet or vault balance.
              </span>
            </div>
          </section>

          <section id="docs-prediction" className="docs-section">
            <span className="docs-number">02</span>
            <div className="docs-copy">
              <span className="eyebrow">PREDICTION MARKET</span>
              <h3>Analyze one explicitly selected live question</h3>
              <p>
                PULSE keeps market probability evidence separate from the
                referenced asset’s price chart. Premium adds an independent 4H
                underlying chart with Fibonacci, pivots and Elliott candidate
                structure.
              </p>
              <div className="docs-two-paths">
                <div>
                  <b>Prediction evidence</b>
                  <span>
                    YES/NO price · spread · depth · probability · catalysts
                  </span>
                </div>
                <div>
                  <b>Underlying context</b>
                  <span>
                    4H spot trend · levels · possible moves · invalidation
                  </span>
                </div>
              </div>
            </div>
            <div className="docs-tip">
              <b>Do not mix them</b>
              <p>
                A bullish BTC chart does not prove a YES outcome. Read the
                market definition, resolution source and expiry first.
              </p>
            </div>
          </section>

          <section id="docs-safety" className="docs-section">
            <span className="docs-number">03</span>
            <div className="docs-copy">
              <span className="eyebrow">RISK GUARD</span>
              <h3>Check before execution—not after it</h3>
              <ol>
                <li>
                  Select X Layer, Base, Arbitrum or Arc Testnet in Network &amp;
                  Payment.
                </li>
                <li>
                  Browse that network’s token catalog or paste a verified
                  contract address.
                </li>
                <li>
                  Inspect live bytecode, proxy and ERC-20 interface evidence.
                </li>
                <li>
                  For an exact action, expand simulation, provide calldata and
                  simulate without broadcasting.
                </li>
              </ol>
              <ul className="check-list">
                <li>Verify network and connected address.</li>
                <li>Verify token symbols and contracts in the wallet.</li>
                <li>Reject unexpected approval amounts or router targets.</li>
                <li>
                  Remember that source verification is not an independent audit.
                </li>
              </ul>
            </div>
            <div className="docs-risk-flow" aria-label="Risk Guard workflow">
              <div>
                <small>1 · CHAIN CATALOG</small>
                <b>Exact contract</b>
                <span>X Layer · Base · Arbitrum · Arc</span>
              </div>
              <i>→</i>
              <div>
                <small>2 · LIVE EVIDENCE</small>
                <b>Bytecode &amp; interface</b>
                <span>Proxy and ERC-20 checks</span>
              </div>
              <i>→</i>
              <div>
                <small>3 · EXACT ACTION</small>
                <b>Simulate calldata</b>
                <span>No broadcast</span>
              </div>
            </div>
          </section>

          <section id="docs-spot" className="docs-section">
            <span className="docs-number">04</span>
            <div className="docs-copy">
              <span className="eyebrow">SPOT TRADING</span>
              <h3>Choose a pair directly—or execute a report setup</h3>
              <p>
                PULSE resolves each analysis asset to a verified chain
                representation, checks balances, proves a live OKX Onchain OS
                route and keeps final approval in your wallet. Examples include
                BTC→cbBTC and DOGE→cbDOGE on Base, or ETH→WETH. Base and
                Arbitrum settle in native USDC; X Layer settles in USDT0. If no
                identity-safe representation exists, PULSE checks the other
                supported networks and does not invent one.
              </p>
              <div className="docs-order-types">
                <article>
                  <b>Market</b>
                  <span>
                    Request a fresh executable quote. Auto slippage lets the
                    router calculate tolerance up to your cap; Manual applies
                    exactly the value you enter. Optional TP/SL is attached
                    inside this ticket after the fill.
                  </span>
                </article>
                <article>
                  <b>Limit</b>
                  <span>
                    A report loads buy-below, amount and trigger. Optional TP/SL
                    is part of the same order. PULSE checks for an existing
                    owner account and only prepares one when the chain says it
                    is absent.
                  </span>
                </article>
                <article>
                  <b>Dashboard</b>
                  <span>
                    Use All, Pending, Active, Executed, Cancelled or Activity.
                    Pending is waiting for entry; Active is governed by TP/SL;
                    Executed has completed; Cancelled was closed by the owner.
                  </span>
                </article>
              </div>
              <ol>
                <li>
                  Choose a supported pair in Spot, or open Market/Limit from a
                  Global report. A report additionally prefills timeframe,
                  entry, TP and SL.
                </li>
                <li>
                  Confirm the analysis pair and chain route. Example: ETH-USDT
                  analysis becomes WETH/USDC on Base.
                </li>
                <li>
                  Check “You spend,” its wallet balance and the network. Use Max
                  or enter any smaller human-readable amount.
                </li>
                <li>
                  For Market, get a live quote, inspect output, price impact and
                  slippage, then review in the wallet.
                </li>
                <li>
                  For Limit, confirm the buy trigger and minimum received.
                  Enable or edit integrated TP/SL if wanted.
                </li>
                <li>
                  If first-time account setup is needed, PULSE explains the
                  extra signature. It never asks you to paste a contract address
                  or atomic value.
                </li>
                <li>
                  After confirmation, monitor the exact lifecycle with the
                  dashboard filters below the ticket.
                </li>
              </ol>
            </div>
            <div className="docs-wallet-diagram">
              <div>
                REPORT
                <br />
                <b>ETH-USDT</b>
              </div>
              <i>→</i>
              <div>
                ROUTE
                <br />
                <b>WETH/USDC</b>
              </div>
              <i>→</i>
              <div>
                QUOTE
                <br />
                <b>Live</b>
              </div>
              <i>→</i>
              <div>
                WALLET
                <br />
                <b>Confirm</b>
              </div>
              <i>→</i>
              <div>
                DASHBOARD
                <br />
                <b>Reconcile</b>
              </div>
            </div>
          </section>

          <section id="docs-spot-examples" className="docs-deep-dive">
            <div className="docs-deep-head">
              <span className="eyebrow">SPOT · WORKED EXAMPLES</span>
              <h3>Know exactly which asset you spend</h3>
              <p>
                The report pair is market language. The execution pair is
                chain-specific: Base and Arbitrum settle in USDC; X Layer
                settles in USDT0. PULSE verifies the route and reads both wallet
                balances before enabling Review.
              </p>
            </div>
            <div className="worked-examples">
              <article>
                <span>BUY · BASE</span>
                <h4>Limit buy ETH with automatic protection</h4>
                <ol>
                  <li>
                    Open the report’s <b>Buy</b> action and confirm{" "}
                    <b>WETH/USDC</b>.
                  </li>
                  <li>
                    Enter <b>100 USDC</b> and trigger <b>2,067.80</b>.
                  </li>
                  <li>
                    Keep <b>Attach TP / SL</b> enabled; review the report levels
                    and editable minimum WETH.
                  </li>
                  <li>
                    Create the owner-controlled Limit + TP/SL account only if
                    on-chain discovery says it is absent.
                  </li>
                  <li>
                    Sign approval and order. The dashboard shows <b>Pending</b>.
                  </li>
                  <li>
                    When entry fills, received WETH stays in that account and
                    the row becomes <b>Active</b>.
                  </li>
                  <li>
                    TP or SL swaps WETH back to USDC and pays the connected
                    owner; the row becomes <b>Executed</b>.
                  </li>
                </ol>
              </article>
              <article>
                <span>SELL · ARBITRUM</span>
                <h4>Sell WETH you already own</h4>
                <ol>
                  <li>
                    Select <b>Sell WETH</b>; the spend asset changes to WETH.
                  </li>
                  <li>
                    Enter <b>0.05 WETH</b>, not USDC.
                  </li>
                  <li>Set “Sell at or above”; expected settlement is USDC.</li>
                  <li>
                    PULSE blocks Review if the amount exceeds the wallet WETH
                    balance.
                  </li>
                  <li>
                    Confirm the exact token, amount, account contract and
                    network in the wallet.
                  </li>
                </ol>
              </article>
              <article>
                <span>BUY · X LAYER</span>
                <h4>Use USDT0, never legacy USDT</h4>
                <ol>
                  <li>
                    An ETH-USDT analysis maps to <b>WETH/USDT0</b>.
                  </li>
                  <li>PULSE resolves the official X Layer contracts.</li>
                  <li>
                    Spend uses human USDT0; atomic values remain under Advanced.
                  </li>
                  <li>
                    If no route exists, PULSE recommends another verified
                    network or links to OKX Spot.
                  </li>
                </ol>
              </article>
              <article>
                <span>BUY · DOGE FALLBACK</span>
                <h4>Switch networks only to a verified representation</h4>
                <ol>
                  <li>
                    A DOGE-USDT report on Base maps to <b>cbDOGE/USDC</b>.
                  </li>
                  <li>
                    Market and Limit tickets both use cbDOGE while retaining
                    DOGE market levels.
                  </li>
                  <li>
                    If Arbitrum or X Layer is selected, PULSE checks those
                    chains and does not invent a wrapped DOGE.
                  </li>
                  <li>
                    When Base liquidity is verified, the ticket says to switch{" "}
                    <b>Network &amp; Payment</b> to Base. If no supported
                    network works, it links to OKX Spot.
                  </li>
                </ol>
              </article>
            </div>
            <div className="docs-glossary">
              <div>
                <b>Pending</b>
                <span>
                  A signed limit entry is funded but has not executed.
                </span>
              </div>
              <div>
                <b>Active</b>
                <span>
                  The owned asset is currently governed by editable TP/SL.
                </span>
              </div>
              <div>
                <b>Executed</b>
                <span>
                  A market or limit buy/sell completed without remaining active
                  protection.
                </span>
              </div>
              <div>
                <b>Cancelled</b>
                <span>
                  The owner closed an unfilled order or withdrew an open
                  protected asset.
                </span>
              </div>
              <div>
                <b>Activity</b>
                <span>
                  All approvals, account creation, fills, protection and close
                  transactions.
                </span>
              </div>
            </div>
          </section>

          <section id="docs-spot-troubleshoot" className="docs-deep-dive">
            <div className="docs-deep-head">
              <span className="eyebrow">SPOT · BUTTONS &amp; RECOVERY</span>
              <h3>Why an action may be unavailable</h3>
              <p>
                Route status and wallet readiness are different checks. A
                verified route proves liquidity exists; it does not mean the
                connected wallet owns enough of the spend token.
              </p>
            </div>
            <div className="worked-examples troubleshooting-grid">
              <article>
                <span>ROUTE READY · BUTTON DISABLED</span>
                <h4>Amount exceeds balance</h4>
                <ol>
                  <li>Read the exact balance under “You spend.”</li>
                  <li>
                    Press <b>Use available balance</b> or enter less.
                  </li>
                  <li>
                    You may still request a live quote for the larger amount;
                    only wallet submission stays blocked.
                  </li>
                </ol>
              </article>
              <article>
                <span>ROUTE CHECK NEEDS RETRY</span>
                <h4>Provider/API interruption</h4>
                <ol>
                  <li>The ticket remains editable.</li>
                  <li>
                    Press <b>Retry background check</b>, or request the
                    amount-specific quote.
                  </li>
                  <li>
                    PULSE retries transient OKX errors; it does not label the
                    pair permanently unavailable from one timeout.
                  </li>
                </ol>
              </article>
              <article>
                <span>SETUP CHECKING</span>
                <h4>Prevent duplicate accounts</h4>
                <ol>
                  <li>
                    PULSE reads the selected network’s factory for this wallet.
                  </li>
                  <li>
                    If an account exists, it is reused—even after changing tabs
                    or devices.
                  </li>
                  <li>
                    If the RPC cannot answer, creation is blocked until Retry
                    confirms found or absent.
                  </li>
                </ol>
              </article>
            </div>
            <div className="docs-callout">
              <b>Amount choice stays yours</b>
              <span>
                Market, Limit and Autopilot amount fields start empty. Enter any
                positive value representable by the token, including 0.1 USDC
                or USDT0, provided the live route accepts it and the connected
                wallet has enough balance. Keep native gas separately.
              </span>
            </div>
          </section>

          <section id="docs-auto" className="docs-section">
            <span className="docs-number">05</span>
            <div className="docs-copy">
              <span className="eyebrow">AUTOPILOT</span>
              <h3>Six clear setup steps; one runtime dashboard</h3>
              <p>
                Choose the market and timeframe, a familiar strategy preset, and
                the capital/risk profile. PULSE resolves tokens, verifies the
                route, calculates human-sized limits, checks for an existing
                owner-controlled strategy account and guides the required wallet
                confirmations as one flow. Contract addresses and atomic values
                live only under Technical proof.
              </p>
              <div className="docs-order-types">
                <article>
                  <b>1 · Market &amp; strategy</b>
                  <span>
                    Select pair/timeframe and Trend following, Breakout or Mean
                    reversion. A compact AI confirmation is requested only after a free
                    deterministic candidate gate. An uncertain signal results
                    in Hold without creating a trade.
                  </span>
                </article>
                <article>
                  <b>2 · Capital &amp; risk</b>
                  <span>
                    For a new Autopilot, Initial deposit is the amount moved
                    from the connected wallet when Start is confirmed. It also
                    sizes the first per-trade, daily-loss and exposure limits.
                    Choose Conservative, Balanced or Active and review those
                    calculated limits before signing.
                  </span>
                </article>
                <article>
                  <b>3 · Pass, review &amp; activate</b>
                  <span>
                    Choose 24h, 7d or 30d AI Entry Pass time, review the whole
                    policy, then approve activation. A new vault is registered
                    before its x402 pass payment; an existing active pass is
                    reused without charging again. Runtime controls then live
                    together in the dashboard, not in a separate side card.
                  </span>
                </article>
              </div>
              <div className="docs-guardrails">
                <span>Asset allowlist</span>
                <span>Exposure cap</span>
                <span>Daily loss stop</span>
                <span>Turnover cap</span>
                <span>Cooldown</span>
                <span>Owner pause &amp; withdrawal</span>
              </div>
              <div className="docs-callout">
                <b>AI pass: predictable cost per vault</b>
                <span>
                  Choose $1.50 for 24 hours, $10.50 for 7 days, or $45 for 30
                  days. Renewal adds time to the current expiry. Pausing freezes
                  the paid timer; resuming restores it with the same remaining
                  time. Each covered
                  day includes up to three compact entry confirmations; routine
                  Holds and deterministic TP/SL or structure exits do not call
                  xAI. Two active-runtime hours before expiry PULSE shows an urgent reminder
                  and can notify the linked Telegram chat. After expiry, new
                  entries remain on Hold while protection, exits, Pause and
                  Withdraw continue.
                </span>
              </div>
            </div>
            <div className="docs-tip good">
              <b>What stays hidden—and enforced</b>
              <p>
                PULSE converts percentages to on-chain units and signs a
                short-lived strategy authorization. The executor cannot
                withdraw, add assets, raise limits, change policy, reuse a nonce
                or bypass the approved adapter.
              </p>
            </div>
          </section>

          <section id="docs-auto-capital" className="docs-deep-dive">
            <div className="docs-deep-head">
              <span className="eyebrow">AUTOPILOT · CAPITAL</span>
              <h3>Know which balance moves before you sign</h3>
              <p>
                Every strategy account is isolated. First choose the exact
                Autopilot in the dashboard account selector; its status, portfolio
                value, available settlement asset and invested asset update
                together. Changing Network &amp; Payment shows only that chain’s
                accounts.
              </p>
            </div>
            <div className="docs-two-paths capital-doc-paths">
              <div>
                <b>Add funds · source is your wallet</b>
                <span>
                  Open Add funds. PULSE reads the connected wallet’s USDC on
                  Base/Arbitrum or USDT0 on X Layer, shows the available amount,
                  and provides Max inside the amount field. An unknown or insufficient
                  wallet balance blocks the transfer. Add funds is a later top-up
                  to an existing vault; it differs from the Initial deposit used
                  during creation. Save the selected strategy again if the signed
                  risk limits should use the larger capital base.
                </span>
              </div>
              <div>
                <b>Withdraw · source is the selected Autopilot</b>
                <span>
                  Pause the strategy, open Withdraw, then choose settlement or
                  invested asset. PULSE reads that vault’s balance and offers
                  Max for that selected asset. Funds return only to the connected owner
                  wallet.
                </span>
              </div>
            </div>
            <div className="autopilot-example-flow capital-example-flow">
              <b>1 · Select Autopilot 1</b>
              <span>
                Confirm its short address, Paused/Running state and portfolio
                value in the unified dashboard. Do not use another account’s balance.
              </span>
              <i>→</i>
              <b>2 · Read the three balance cards</b>
              <span>
                Available settlement is idle USDC/USDT0. Invested asset is the
                token currently held. Total portfolio value marks both together
                in the settlement currency and is not itself a withdrawable
                token balance.
              </span>
              <i>→</i>
              <b>3 · Pause before withdrawal</b>
              <span>
                Pausing prevents an executor trade from racing the owner’s
                withdrawal. If you want settlement only, you may instead let or
                instruct the strategy to sell the invested asset first.
              </span>
              <i>→</i>
              <b>4 · Withdraw each asset that remains</b>
              <span>
                Use Withdraw → USDC/USDT0 for idle settlement and Withdraw →
                token for any invested balance. Repeat for the second Autopilot
                after selecting it; balances never aggregate in this form.
              </span>
            </div>
            <div className="docs-callout">
              <b>Why Add and Withdraw are separate</b>
              <span>
                Add validates the connected wallet balance and spends from the
                wallet. Withdraw validates the selected vault balance and calls
                the vault’s owner-only withdrawal. Sharing one amount field
                would hide this authority boundary, so PULSE keeps the flows in
                separate tabs.
              </span>
            </div>
          </section>

          <section id="docs-auto-rules" className="docs-deep-dive">
            <div className="docs-deep-head">
              <span className="eyebrow">AUTOPILOT · EXACT TRADING RULES</span>
              <h3>What each strategy actually does</h3>
              <p>
                Every entry first requires the selected deterministic setup.
                Only a surviving candidate may consume one compact bullish AI
                confirmation from the selected vault&apos;s prepaid pass. The
                signed confidence threshold and every preset rule must still
                pass; narrative text cannot override a failed rule.
              </p>
            </div>
            <div className="worked-examples autopilot-rule-docs">
              <article>
                <span>TREND FOLLOWING</span>
                <h4>Join confirmed direction</h4>
                <p>
                  <b>Buy only when all pass:</b> trend-up regime, close above
                  SMA20, SMA20 above SMA50.
                </p>
                <p>
                  <b>Sell when any passes:</b> TP, SL, threshold-qualified
                  bearish compact signal, or close below SMA20.
                </p>
              </article>
              <article>
                <span>BREAKOUT</span>
                <h4>Require price and participation</h4>
                <p>
                  <b>Buy only when all pass:</b> close above the previous
                  20-candle high, volume at least 1.15× its 20-candle average,
                  and trend-up/transition regime.
                </p>
                <p>
                  <b>Sell when any passes:</b> TP, SL, threshold-qualified
                  bearish compact signal, or close below SMA20.
                </p>
              </article>
              <article>
                <span>MEAN REVERSION</span>
                <h4>Buy a confirmed pullback</h4>
                <p>
                  <b>Buy only when all pass:</b> within 1% of confirmed support or
                  RSI14 ≤ 42, plus range/transition regime.
                </p>
                <p>
                  <b>Sell when any passes:</b> TP, SL, threshold-qualified
                  bearish compact signal, or price reaches SMA20.
                </p>
              </article>
            </div>
            <div className="docs-glossary">
              <div>
                <b>Conservative</b>
                <span>
                  Up to 25% per Buy · 2% daily loss · 25% exposure · 0.5%
                  slippage · 15 min cooldown · 80% signal.
                </span>
              </div>
              <div>
                <b>Balanced</b>
                <span>
                  Up to 50% per Buy · 3% daily loss · 50% exposure · 1%
                  slippage · 5 min cooldown · 70% signal.
                </span>
              </div>
              <div>
                <b>Active</b>
                <span>
                  Up to 100% per Buy · 5% daily loss · 100% exposure · 1.5%
                  slippage · 2 min cooldown · 60% signal. This is spot capital,
                  never leverage or borrowed exposure.
                </span>
              </div>
              <div>
                <b>Contract authority</b>
                <span>
                  Owner creates, configures, pauses and withdraws. The approved
                  executor can only call evidence/nonce-bound trades through an
                  approved adapter.
                </span>
              </div>
            </div>
            <div className="docs-callout">
              <b>How to read the trading report</b>
              <span>
                Open the Strategy journal. “What it is doing now” translates
                runtime state into Wait, Buy, Sell, Paused or provider outage.
                PASS means the observed market value met that signed rule. WAIT
                means it did not. Buy requires every entry row to pass; Sell
                needs one exit row. Hold never sends a transaction. A filled row
                includes the evidence hash and explorer transaction. Strategy
                decisions are separate from wallet/on-chain activity, repeated
                identical failures are collapsed, and Export CSV activity joins
                both streams for auditing.
              </span>
            </div>
            <div className="docs-callout">
              <b>Opportunity Radar</b>
              <span>
                Global Market, empty Spot and Autopilot share the same read-only
                OKX candle shortlist. It is not a recommendation: the
                deterministic setup, compact AI confirmation, token identity,
                selected-network route and wallet balance must still pass.
              </span>
            </div>
            <div className="docs-callout">
              <b>Run more than one strategy safely</b>
              <span>
                Each Autopilot is a separate owner-controlled strategy account
                with its own asset, capital and signed limits. For example, you
                may monitor 0.5 USDT0 in WETH Mean Reversion on X Layer, 0.5
                USDC in cbDOGE Breakout on Base and 0.5 USDC in WBTC Mean
                Reversion on Arbitrum. Switch Network &amp; payment to view that
                network&apos;s agents. The selected dashboard account shows one
                vault&apos;s capital and P&amp;L; the strategy summary above it
                aggregates all vaults on the selected network.
              </span>
            </div>
            <div className="docs-callout">
              <b>If a dependency disconnects</b>
              <span>
                PULSE fails closed and moves no assets. A temporary provider or
                RPC failure appears as dependency retry. Every xAI attempt is
                timestamped before the request, so even a failed call observes
                the 15-minute minimum. Billing, permission and quota failures
                open a six-hour circuit breaker instead of retrying every worker
                tick. The signed strategy remains available without the browser
                tab or another wallet signature.
              </span>
            </div>
            <div className="docs-callout">
              <b>Close an Autopilot without losing custody</b>
              <span>
                Close &amp; withdraw all first pauses the selected account, then
                asks the connected owner to withdraw its complete settlement
                and invested-asset balances. The deployed vault is not deleted:
                it stays auditable on-chain and can be configured again later.
              </span>
            </div>
          </section>

          <section id="docs-auto-example" className="docs-deep-dive">
            <div className="docs-deep-head">
              <span className="eyebrow">AUTOPILOT · COMPLETE EXAMPLE</span>
              <h3>Run a Balanced WETH strategy on Base</h3>
              <p>
                Spot and Autopilot are independent. This flow allocates new
                capital to its own guarded strategy balance; it never takes
                funds from a Spot order account.
              </p>
            </div>
            <div className="autopilot-example-flow">
              <b>1 · Choose ETH-USDT / 4H</b>
              <span>
                PULSE maps it to WETH/USDC, verifies an amount-sized live route
                and shows available USDC.
              </span>
              <i>→</i>
              <b>2 · Choose Trend following</b>
              <span>
                The automation requests a compact AI confirmation only after a deterministic candidate gate on its
                cycle. Below-confidence or invalidated setups become Hold.
              </span>
              <i>→</i>
              <b>3 · Allocate 500 USDC</b>
              <span>
                Select Balanced. PULSE displays 250 USDC maximum per trade, 15
                USDC daily-loss stop and 250 USDC maximum WETH exposure.
              </span>
              <i>→</i>
              <b>4 · Choose the AI Entry Pass</b>
              <span>
                Choose $1.50 / 24h, $10.50 / 7d or $45 / 30d. PULSE validates
                ERC-20 contracts and the live route, creates/registers the vault,
                then requests x402 payment as the final activation step. Paid
                time is frozen whenever the vault is paused.
              </span>
              <i>→</i>
              <b>5 · Evaluate and execute</b>
              <span>
                The detailed report shows every PASS/WAIT rule. Buy broadcasts
                only after every entry rule passes. Hold keeps monitoring
                without a trade. An owned position exits on TP, SL, bearish
                confirmation or its strategy structure rule, after which the
                strategy can buy again on a later qualified signal.
              </span>
              <i>→</i>
              <b>6 · Reconcile and control</b>
              <span>
                In one dashboard, see actual vault capital, target balance,
                Strategy journal, on-chain activity, evidence, transaction and
                cash-flow-adjusted P&amp;L. Select the exact vault; pause/resume,
                renew, add funds, withdraw either asset with Max, or close and
                withdraw all as the owner.
              </span>
            </div>
            <div className="docs-callout">
              <b>Why there may be multiple wallet prompts</b>
              <span>
                Guardrail setup is on-chain and each confirmation is visible in
                your wallet. PULSE presents it as one guided launch; if a prompt
                is rejected or the connection drops, the account remains
                owner-controlled and the strategy does not run past incomplete
                activation.
              </span>
            </div>
          </section>

          <section id="docs-pay" className="docs-section">
            <span className="docs-number">06</span>
            <div className="docs-copy">
              <span className="eyebrow">PAYMENTS</span>
              <h3>
                “Network & payment” changes the entire transaction context
              </h3>
              <div className="network-doc-grid">
                <div>
                  <b>X Layer</b>
                  <span>USDT0 · OKX x402</span>
                </div>
                <div>
                  <b>Base</b>
                  <span>USDC · CDP x402</span>
                </div>
                <div>
                  <b>Arbitrum</b>
                  <span>USDC · CDP x402</span>
                </div>
                <div>
                  <b>Arc Testnet</b>
                  <span>test USDC · analysis only</span>
                </div>
              </div>
              <p>
                Always confirm the selected network, payment asset, exact price
                and wallet account before signing.
              </p>
              <div className="docs-glossary payment-price-grid">
                <div><b>Global Base</b><span>$0.20 per report</span></div>
                <div><b>Global Premium</b><span>$0.30 per report</span></div>
                <div><b>Prediction Base</b><span>$0.20 per report</span></div>
                <div><b>Prediction Premium</b><span>$0.30 per report</span></div>
                <div><b>Pre-Trade Risk Guard</b><span>$0.15 per check</span></div>
              </div>
              <div className="docs-callout">
                <b>Report fee, trading capital and gas are separate</b>
                <span>
                  x402 pays only for the selected PULSE service. A later Spot
                  order spends the amount shown in its ticket; Autopilot uses
                  only capital added to its selected vault. Keep native OKB or
                  ETH for on-chain gas. The live purchase button and metadata
                  show the configured price if an operator changes a default.
                </span>
              </div>
            </div>
          </section>

          <section id="docs-agents" className="docs-deep-dive">
            <div className="docs-deep-head">
              <span className="eyebrow">AGENTS &amp; API</span>
              <h3>Discover eight services on every supported execution mainnet</h3>
              <p>
                X Layer, Base and Arbitrum expose five analysis/risk services
                plus three duration-specific Autopilot start services. Global
                Spot and Autopilot contract calls remain owned and confirmed by
                the caller&apos;s Agentic Wallet. Circle/Arc exposes only the five
                analysis/risk services because execution is unavailable there.
              </p>
            </div>
            <div className="docs-agent-flow" aria-label="Agent service workflow">
              <div><small>1 В· DISCOVER</small><b>Choose one PULSE service</b></div>
              <i>в†’</i>
              <div><small>2 В· REQUEST</small><b>Send typed market or risk input</b></div>
              <i>в†’</i>
              <div><small>3 В· SETTLE</small><b>Pay the x402 challenge</b></div>
              <i>в†’</i>
              <div><small>4 В· RECOVER</small><b>Poll the durable report job</b></div>
            </div>
            <div className="docs-agent-services">
              <article><b>Global Quick → Spot Market or Limit</b><span>$0.20 В· concise plan, then Agentic Wallet execution</span></article>
              <article><b>Global Pro → Spot Market or Limit</b><span>$0.30 В· deeper chart and Elliott plan, then Agentic Wallet execution</span></article>
              <article><b>Prediction Quick</b><span>$0.20 В· selected-market evidence</span></article>
              <article><b>Prediction Pro</b><span>$0.30 В· deeper evidence and 4H underlying chart</span></article>
              <article><b>Risk Guard</b><span>$0.15 В· PASS/WARN/FAIL before signing</span></article>
              <article><b>Start Autopilot В· 24h</b><span>$1.50 В· six-step owner-wallet setup and active runtime</span></article>
              <article><b>Start Autopilot В· 7d</b><span>$10.50 В· same workflow for seven active-runtime days</span></article>
              <article><b>Start Autopilot В· 30d</b><span>$45.00 В· same workflow for 30 active-runtime days</span></article>
            </div>
            <div className="docs-agent-channels">
              <article>
                <span>OKX.AI В· X LAYER</span>
                <h4>PULSE agent #8355</h4>
                <p>
                  The existing identity exposes all eight X Layer services and
                  settles in USDT0. Agentic Wallet owns and confirms Spot and
                  Autopilot calls. Base and Arbitrum do not require a second
                  copy of this ERC-8004 identity.
                </p>
                <a href="https://www.okx.ai/agents/8355" target="_blank" rel="noreferrer">Open PULSE agent #8355 в†—</a>
                <code>/xlayer/v1/analysis/spot/premium</code>
              </article>
              <article>
                <span>CDP BAZAAR В· MAINNET</span>
                <h4>Base and Arbitrum discovery</h4>
                <p>
                  The same eight services are advertised under the selected
                  network prefix with typed schemas. Agentic Wallet signs Spot
                  and Autopilot contract calls; payment uses native USDC.
                </p>
                <code>/base/... В· /arbitrum/...</code>
              </article>
              <article>
                <span>CIRCLE В· ARC TESTNET</span>
                <h4>Circle Agent Marketplace</h4>
                <p>
                  The Arc listing exposes the same five analysis and Risk Guard
                  services with test USDC. Arc Testnet never exposes Spot or
                  Autopilot execution.
                </p>
                <code>/arc/v1/analysis/spot/premium</code>
              </article>
            </div>
            <div className="docs-callout">
              <b>Three Agentic Wallet Autopilot start services</b>
              <span>
                Choose pair/timeframe, strategy, capital/risk and vault. The
                caller&apos;s Agentic Wallet reviews creation, configuration,
                funding and registration calls; x402 then activates 24h, 7d or
                30d and the owner resumes/starts the vault. Pause freezes paid
                runtime. Autopilot never requires a Global report and does not
                spend a full analysis fee every cycle.
              </span>
            </div>
          </section>

          <section id="docs-recover" className="docs-section">
            <span className="docs-number">08</span>
            <div className="docs-copy">
              <span className="eyebrow">REPORT HISTORY &amp; RECOVERY</span>
              <h3>Your paying wallet carries report access across devices</h3>
              <ol>
                <li>
                  Select the network used for payment and connect the same
                  wallet.
                </li>
                <li>
                  Open Global Market or Prediction Market and find{" "}
                  <b>Paid report history</b>.
                </li>
                <li>
                  Press <b>Sync with wallet</b> and sign the report-access
                  message. It can reopen reports and retry an already-settled
                  failure, but it cannot create a payment or trade.
                </li>
                <li>
                  Choose a completed report and press <b>Open</b>. If a row is
                  marked failed, press <b>Retry</b>; PULSE reuses its settled
                  receipt without charging again. The private report payload is
                  returned only after wallet authentication.
                </li>
              </ol>
              <div className="docs-callout">
                <b>Blob + KV, not one device</b>
                <span>
                  Blob stores the private report; KV stores the wallet/network
                  job index and short-lived access session. Browser recovery
                  capabilities remain only as a convenient fallback for an
                  unfinished job. Clearing an iPhone, Android or desktop browser
                  does not remove the server-side wallet history.
                </span>
              </div>
            </div>
            <div className="recovery-diagram">
              <span>wallet signs report-access challenge</span>
              <i>→</i>
              <span>KV wallet index</span>
              <i>→</i>
              <span>private Blob report</span>
              <i>→</i>
              <span>any device</span>
            </div>
          </section>

          <section id="docs-telegram" className="docs-section">
            <span className="docs-number">09</span>
            <div className="docs-copy">
              <span className="eyebrow">TELEGRAM</span>
              <h3>Request in chat, authorize in the Mini App</h3>
              <p>
                Use `/global` or `/prediction`, make selections, then open the
                secure payment button. Telegram receives the result, not your
                wallet credentials. See the Telegram tab for the complete guided
                example.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

}
