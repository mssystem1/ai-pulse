import { TelegramGuide } from './TelegramGuide';
import { TradingWorkspaceNav, SPOT_WORKSPACE_PAGES, AUTOPILOT_WORKSPACE_PAGES } from "./TradingWorkspaceNav";
import "./tradingWorkspace.css";
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
import { parseExecutionCapability, type ExecutionCapability as Capability } from "./executionCapability";
import { useExecutionAvailability } from "./executionAvailability";
import { RouteAvailability, useRouteResults } from "./RouteAvailability";
import { routeSortRank } from "./routeChecks";
import { ASSESSMENT_EVENT, currentOpportunityAssessment, isConfirmedSpotSetup, readOpportunityAssessments } from "./opportunityAssessment";
import { createWalletPaidFetch, getInjectedProvider } from "./wallet";
import { hasRecoverablePayment } from "./paymentRecovery";
import {
  switchWalletNetwork,
  assertArcUsdcGasReserve,
  fetchTokenBalance,
  WEB_NETWORKS,
  type WebNetworkKey,
} from "./networks";
import type { ReportTradeIntent } from "./Report";
import { rebaseReportTrade } from "./reportTradeHandoff";
import { reportTierLabel } from "./reportLabels";
import type { Lang } from "./i18n";
import { ShortlistMarketChart, SpotMarketPreview } from "./SpotMarketPreview";
import { confirmedTradeMarkers, isArcMarketPair } from "./marketPreview";
import { AutopilotDecisionJournal, type DecisionEntry } from "./AutopilotDecisionJournal";
import { decisionAuditColumns, serializeAuditCsv } from "./autopilotExport";
import { renewAndResumeAutopilot, autopilotSetupFailureState } from "./autopilotRenewal";
import { autopilotControlState } from "./autopilotControls";
import { DocsWorkflowVisuals } from "./DocsWorkflowVisuals";
import { ExecutionPairPicker, TimeframePicker } from "./Pickers";
import { aggregateAutopilotMetrics, assessBalanceAmount, confirmedAutopilotExecutionCounts, countExecutedAutopilotFills, hasProtectedAutopilotPosition, selectedAutopilotStrategy } from "./dashboardMetrics";
import { spotTradePerformance } from "./tradePerformance";
import { formatRuleEvidence } from "./evidenceDisplay";
import {
  DEFAULT_AUTOPILOT_CAPITAL,
  DEFAULT_TRADE_AMOUNT,
  arcLimitMinimum,
  positiveTokenAmount,
} from "./tradeAmounts";


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
  fillSide?: "buy" | "sell";
  fillQuantity?: number;
  fillQuoteValue?: number;
  fillBaseAsset?: string;
  fillQuoteAsset?: string;
  createdAt: string;
};

const EXECUTION_NETWORKS: WebNetworkKey[] = ["xlayer", "base", "arbitrum", "robinhood", "arc"];

async function probePairRoute(
  pair: string,
  network: WebNetworkKey,
  erc20Custody = false,
): Promise<{ base: TradeToken; quote: TradeToken; executionMarketPair?: string } | null> {
  const response = await apiGet(
    `/v1/trading/resolve-pair?network=${network}&pair=${encodeURIComponent(pair)}${erc20Custody ? "&custody=erc20" : ""}`,
  );
  if (!response.ok) return null;
  const result = response.data as {
    available?: boolean;
    base?: TradeToken;
    quote?: TradeToken;
    executionMarketPair?: string;
  };
  return result.available && result.base && result.quote
    ? { base: result.base, quote: result.quote, executionMarketPair: result.executionMarketPair }
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
  network?: "xlayer" | "base" | "arbitrum" | "robinhood" | "arc";
  vault: string;
  settlementAsset?: string;
  targetAsset?: string;
  pair: string;
  timeframe: string;
  strategyType?: "trend_following" | "breakout" | "mean_reversion";
  minConfidence?: number;
  buyAmountAtomic?: string;
  policy?: { maxTradePct?: number; dailyLossPct?: number; strategy?: string; signalMarket?: string };
  status: string;
  registrationStatus?: string;
  runtimeState?: "running" | "paused" | "protecting_position" | "entry_pass_expired" | "entry_signals_exhausted" | "telemetry_unavailable" | "failed" | "inactive";
  paused?: boolean;
  lastDecision?: string;
  lastRunAt?: string;
  lastRiskCheckAt?: string;
  riskCheckCount?: number;
  sameCandleSkipCount?: number;
  createdAt?: string;
  lastError?: string;
  lastTxHash?: string;
  evidenceHash?: string;
  settlementBalance?: string;
  targetBalance?: string;
  hasResidualDust?: boolean;
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
  pnlCashFlow?: { state: string; progressPct: number; detail: string };
  pnlAsOf?: string;
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
  detailedEvaluationCount?: number;
  evaluationHistoryComplete?: boolean;
  journalStorage?: "synced" | "pending_sync" | "unavailable" | "memory_only";
  lifetimeStatsComplete?: boolean;
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
    context?: DecisionEntry["context"];
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

function autopilotRuntimeLabel(item?: AutopilotStrategyView, fallbackPaused?: boolean | null) {
  if (!item) return "Setup incomplete";
  const state = item?.runtimeState || ((item?.paused ?? fallbackPaused) ? "paused" : item?.status === "active" ? "running" : item?.status || "inactive");
  switch (state) {
    case "running": return "Running";
    case "paused": return "Paused";
    case "protecting_position": return "Exit protection only";
    case "entry_pass_expired": return "Entry pass expired";
    case "entry_signals_exhausted": return "Entry confirmations used";
    case "telemetry_unavailable": return "Runtime unavailable";
    case "failed": return "Failed";
    default: return "Inactive";
  }
}

function autopilotRuntimeClass(item?: AutopilotStrategyView, fallbackPaused?: boolean | null) {
  const state = item?.runtimeState || ((item?.paused ?? fallbackPaused) ? "paused" : item?.status || "inactive");
  if (state === "running") return "active";
  if (state === "protecting_position") return "protecting-position";
  if (state === "paused") return "paused";
  if (state === "failed" || state === "telemetry_unavailable") return "failed";
  return "entry-pass-expired";
}
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
  priceHistory?: number[];
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
  lang = "en",
}: {
  networkKey: WebNetworkKey;
  initialTimeframe?: string;
  context: "global" | "spot" | "autopilot";
  onAnalyze: (candidate: PotentialGainer) => void;
  onPrepare?: (candidate: PotentialGainer) => void;
  lang?: Lang;
}) {
  const [radarTimeframe, setRadarTimeframe] = useState(
    ["15m", "1H", "4H", "1D"].includes(initialTimeframe)
      ? initialTimeframe
      : "1H",
  );
  const [items, setItems] = useState<PotentialGainer[]>([]);
  const [showTechnical, setShowTechnical] = useState(true);
  const [assessments, setAssessments] = useState(() => readOpportunityAssessments(localStorage, networkKey));
  useEffect(() => {
    const refresh = () => setAssessments(readOpportunityAssessments(localStorage, networkKey));
    refresh(); window.addEventListener(ASSESSMENT_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(ASSESSMENT_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [networkKey]);
  const executionAvailability = useExecutionAvailability(networkKey, context === "autopilot" ? "erc20" : "spot");
  const routeResult = useRouteResults();
  const [status, setStatus] = useState("Scanning live market structure…");
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const loadedTimeframeRef = useRef("");
  const [compactMobile, setCompactMobile] = useState(false);
  const radarRoot = useRef<HTMLElement>(null);
  const radarVisible = useRef(true);
  const [scanRefresh, setScanRefresh] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { radarVisible.current = entry.isIntersecting; });
    if (radarRoot.current) observer.observe(radarRoot.current);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && radarVisible.current && !expandedRef.current && !document.querySelector("dialog[open]")) setScanRefresh(value => value + 1);
    }, 60_000);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 650px)");
    const update = () => setCompactMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (["15m", "1H", "4H", "1D"].includes(initialTimeframe))
      setRadarTimeframe(initialTimeframe);
  }, [initialTimeframe]);
  useEffect(() => {
    let current = true;
    const scanScope = `${networkKey}:${context}:${radarTimeframe}`;
    if (loadedTimeframeRef.current !== scanScope) {
      setItems([]);
      setStatus("Scanning live market structure…");
    }
    void apiGet(
      `/v1/opportunities?timeframe=${encodeURIComponent(radarTimeframe)}&network=${networkKey === "robinhood" ? "xlayer" : networkKey}&custody=${context === "autopilot" ? "erc20" : "wallet"}`,
    ).then((response) => {
      if (!current) return;
      // A background request already in flight must not replace expanded cards.
      if (expandedRef.current && loadedTimeframeRef.current === scanScope) return;
      if (!response.ok) {
        setStatus(context === "autopilot"
          ? "Market shortlist is temporarily unavailable. Configure any supported pair directly below."
          : "Opportunity scan is temporarily unavailable. Pair search and analysis remain available.");
        return;
      }
      loadedTimeframeRef.current = scanScope;
      setItems(
        (
          (response.data as { candidates?: PotentialGainer[] }).candidates || []
        ),
      );
      setStatus(context === "autopilot"
        ? "Live OKX candle shortlist. Selecting a card only prepares a draft; Autopilot evaluates fresh entry conditions after activation."
        : "Technical shortlist from live OKX candles. Global analysis can add research context before a Spot trade.");
    });
    return () => {
      current = false;
    };
  }, [context, radarTimeframe, scanRefresh, networkKey]);
  const title =
    context === "global"
      ? "Markets worth analyzing now"
      : context === "spot"
        ? "Choose a pair to trade or research"
        : "Choose a market for Autopilot";
  const eyebrow = context === "autopilot"
    ? "MARKET SHORTLIST · AUTOPILOT SETUP"
    : context === "spot"
      ? "MARKET SHORTLIST · CHOOSE YOUR NEXT ACTION"
      : "OPPORTUNITY RADAR · RESEARCH FIRST";
  const collapsedCount = compactMobile ? 2 : 4;
  const eligibleItems = items.filter(candidate => (context === "global" || executionAvailability(candidate.pair).mapped)
    && (showTechnical || isConfirmedSpotSetup(currentOpportunityAssessment(assessments, candidate.pair, candidate.timeframe))))
    .sort((a, b) => routeSortRank(executionAvailability(a.pair).mapped, routeResult(networkKey, a.pair, context === "autopilot" ? "erc20" : "wallet")) - routeSortRank(executionAvailability(b.pair).mapped, routeResult(networkKey, b.pair, context === "autopilot" ? "erc20" : "wallet")));
  const visibleItems = eligibleItems.slice(0, expanded ? 8 : collapsedCount);
  return (
    <section
      className={`card potential-gainers opportunity-radar ${context}`}
      ref={radarRoot}
      aria-label="Market opportunity radar"
    >
      <div className="dashboard-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
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
            purpose={context === "autopilot" ? "strategy" : "analysis"}
            onChange={setRadarTimeframe}
          />
        </div>
      </div>
      {context !== "autopilot" && <div className="report-execution-choice" role="group" aria-label="Shortlist evidence">
        <button type="button" className={showTechnical ? "active" : ""} onClick={() => setShowTechnical(true)}><b>Explore technical candidates</b><span>Free scan · confidence needs a report</span></button>
        <button type="button" className={!showTechnical ? "active" : ""} onClick={() => setShowTechnical(false)}><b>Recent bullish reports &gt;60%</b><span>Your existing reports · last 15 minutes</span></button>
      </div>}
      {eligibleItems.length ? (
        <>
          <div className="potential-gainer-grid">
            {visibleItems.map((candidate) => (
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
                <ShortlistMarketChart pair={candidate.pair} timeframe={candidate.timeframe} mark={candidate.mark} history={candidate.priceHistory} fetchedAt={candidate.fetchedAt} lang={lang} />
                <div className="candidate-score">
                  <b>{currentOpportunityAssessment(assessments, candidate.pair, candidate.timeframe) ? `${currentOpportunityAssessment(assessments, candidate.pair, candidate.timeframe)!.confidence}%` : "—"}</b>
                  <span>{currentOpportunityAssessment(assessments, candidate.pair, candidate.timeframe)?.bias || "Report confidence not assessed"}</span>
                </div>
                <small>Technical match {candidate.score}/100 · {candidate.technicalReady ? "candle conditions met" : "waiting for candle conditions"}</small>
                <p>{candidate.reason}</p>
                <RouteAvailability network={networkKey} pair={candidate.pair} custody={context === "autopilot" ? "erc20" : "wallet"} mapped={executionAvailability(candidate.pair).mapped} fallback={executionAvailability(candidate.pair).label}/>
                <small>
                  {candidate.strategyType.replaceAll("_", " ")} · RSI{" "}
                  {candidate.rsi14.toFixed(1)} · volume{" "}
                  {candidate.volumeRatio.toFixed(2)}×
                </small>
                <div className="candidate-actions">
                  {context === "autopilot" && onPrepare ? <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!executionAvailability(candidate.pair).mapped}
                      onClick={() => onPrepare(candidate)}
                    >
                      Use for Autopilot
                    </button>
                    <button type="button" className="btn btn-soft" onClick={() => onAnalyze(candidate)}>Open Global analysis</button>
                  </> : context === "spot" && onPrepare ? <>
                    <button type="button" className="btn btn-primary" disabled={!executionAvailability(candidate.pair).mapped} onClick={() => onPrepare(candidate)} aria-label={`Load ${candidate.pair} in Spot ticket`}><span>{executionAvailability(candidate.pair).mapped ? "Trade this pair" : "Spot unavailable here"}</span><small>{executionAvailability(candidate.pair).mapped ? "Loads ticket · no trade placed" : "Choose a mapped pair or research"}</small></button>
                    <button type="button" className="btn btn-soft" onClick={() => onAnalyze(candidate)}><span>Research in Global</span><small>Choose Quick or Pro report</small></button>
                  </> : <>
                    <button type="button" className="btn btn-primary" onClick={() => onAnalyze(candidate)}>
                      {context === "global" ? "Select for analysis" : "Open Global analysis"}
                    </button>
                    {onPrepare && <button type="button" className="btn btn-soft" onClick={() => onPrepare(candidate)}>Preview pair</button>}
                  </>}
                </div>
              </article>
            ))}
          </div>
          {eligibleItems.length > collapsedCount && (<div className="radar-browse-controls">
            <button
              type="button"
              className="radar-more"
              aria-expanded={expanded}
              onClick={() => setExpanded(true)}
              disabled={expanded}
            >
              {expanded
                 ? `${visibleItems.length} candidates shown · refresh pauses while you browse`
                 : `Show ${Math.min(8, eligibleItems.length) - collapsedCount} more candidates`}
            </button>
            {expanded && <button type="button" className="radar-more" onClick={() => setExpanded(false)}>Show fewer candidates</button>}
          </div>)}
        </>
      ) : (
        <div className="empty-dashboard compact">
          <strong>{!showTechnical ? "No current confirmed setup above 60%" : items.length ? "No shortlisted markets available for this network" : "No shortlist loaded"}</strong>
          <span>{!showTechnical ? "Open a recent bullish report or explore the free technical candidates. Neutral, bearish, stale and unassessed markets are not confirmed buy setups. You can still choose any supported pair for a manual trade." : items.length ? "Choose a supported pair directly below, or explore Global Market for research. Availability is checked again before a trade." : status}</span>
        </div>
      )}
      <div className="candidate-disclaimer">
        {context === "autopilot" ? <>
          <b>Two separate actions:</b> Use for Autopilot prefills pair, timeframe and strategy without buying a report. Open Global analysis starts the full Quick/Pro intelligence workflow. Neither action starts or authorizes a vault; fresh runtime gates, a verified route, owner-approved capital and an active AI Entry Pass are still required on {WEB_NETWORKS[networkKey].label}.
        </> : context === "spot" ? <>
          <b>Choose your next action:</b> Trade this pair loads the Spot ticket below, where you choose Market or Limit, amount and protection. Research in Global opens the analysis page for this pair. Neither button charges your wallet or places a trade. Technical match ranks candle conditions; it is not report confidence or a probability of profit.
        </> : <>
          <b>How to use this:</b> choose a candidate for Global intelligence or a Spot ticket. A shortlist score never authorizes a trade; execution still requires a verified representation, live route, sufficient wallet balance and your signature on {WEB_NETWORKS[networkKey].label}.
        </>}
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
    spendToken?: string;
    spendAmount?: string;
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
  if (networkKey === "arc") {
    let spend = tx.spendToken?.toLowerCase() === WEB_NETWORKS.arc.payment.address.toLowerCase() ? BigInt(tx.spendAmount || "0") : 0n;
    if (tx.to.toLowerCase() === WEB_NETWORKS.arc.payment.address.toLowerCase() && /^0xa9059cbb[\da-f]{128}$/i.test(tx.data)) spend = BigInt(`0x${tx.data.slice(-64)}`);
    const gas = BigInt(String(await provider.request({ method: "eth_estimateGas", params: [request] })));
    await assertArcUsdcGasReserve(provider, wallet, spend, gas, BigInt(tx.value || "0"));
  }
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
  if (networkKey === "arc" && token.toLowerCase() === WEB_NETWORKS.arc.payment.address.toLowerCase()) await assertArcUsdcGasReserve(provider, wallet, BigInt(amount), 500_000n);
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
  unavailable = false,
}: {
  capability: Capability | null;
  type: "spot" | "autopilot";
  unavailable?: boolean;
}) {
  if (!capability && unavailable)
    return <div className="v6-notice warning" role="status">Network configuration unavailable. Refresh to retry; trading remains blocked.</div>;
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
  initialTrade: incomingTrade,
  onPairSelected,
  onAnalyzeCandidate,
  lang = "en",
}: {
  networkKey: WebNetworkKey;
  wallet: string | null;
  initialPair: string;
  initialTrade?: ReportTradeIntent | null;
  onPairSelected?: (pair: string) => void;
  onAnalyzeCandidate?: (pair: string, timeframe: string) => void;
  lang?: Lang;
}) {
  const [spotPage, setSpotPage] = useState("setup");
  useEffect(() => { setSpotPage("setup"); }, [incomingTrade, initialPair]);
  const [dismissedTrade, setDismissedTrade] = useState<ReportTradeIntent | null>(null);
  const [rebasedTrade, setRebasedTrade] = useState<{ source: ReportTradeIntent; network: WebNetworkKey; intent: ReportTradeIntent } | null>(null);
  const initialTrade = incomingTrade && !isArcMarketPair(incomingTrade.pair) && incomingTrade !== dismissedTrade
    ? rebasedTrade?.source === incomingTrade && rebasedTrade.network === networkKey ? rebasedTrade.intent : incomingTrade : null;
  const [capability, setCapability] = useState<Capability | null>(null);
  const [pair, setPair] = useState(isArcMarketPair(initialPair) ? "BTC-USDT" : initialPair);
  const [marketTimeframe, setMarketTimeframe] = useState(initialTrade?.timeframe || "1H");
  const [capabilityUnavailable, setCapabilityUnavailable] = useState(false);
  useEffect(() => setPair(isArcMarketPair(initialPair) ? "BTC-USDT" : initialPair), [initialPair, incomingTrade, networkKey]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [executionMode, setExecutionMode] = useState<"market" | "limit">(
    "market",
  );
  const [baseToken, setBaseToken] = useState<TradeToken | null>(null);
  const [quoteToken, setQuoteToken] = useState<TradeToken | null>(null);
  const [mappingScope, setMappingScope] = useState("");
  const [mappingPending, setMappingPending] = useState(true);
  const [routePending, setRoutePending] = useState(false);
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
  const [spotBalanceRefresh, setSpotBalanceRefresh] = useState(0);
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
  const quoteContext = JSON.stringify([networkKey, pair, side, fromToken, toToken, amount, slippage, slippageMode, wallet]);
  const quoteContextRef = useRef(quoteContext);
  quoteContextRef.current = quoteContext;
  const quoteRequestRef = useRef(0);

  function selectSpotPair(nextPair: string, scrollToTicket = false) {
    onPairSelected?.(nextPair);
    setDismissedTrade(incomingTrade || null);
    quoteRequestRef.current += 1;
    if (busy === "quote") setBusy("");
    setPair(nextPair);
    setQuote(null);
    setAmountHuman("");
    setAmount("0");
    setSide("buy");
    setTakeProfit("");
    setStopLoss("");
    setLimitTrigger("");
    setLimitMinOut("");
    setLimitMinOutHuman("");
    setProtectAfterFill(false);
    setMessage(`${nextPair} loaded in the Spot ticket. Choose Market or Limit and enter your amount. No transaction was sent.`);
    if (scrollToTicket) requestAnimationFrame(() => {
      const ticket = document.getElementById("spot-trade-ticket");
      ticket?.focus({ preventScroll: true });
      ticket?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
  }

  useEffect(() => {
    let cancelled = false;
    setBaseToken(null);
    setQuoteToken(null);
    setMappingScope("");
    setMappingPending(true);
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
      `/v1/trading/resolve-pair?network=${networkKey}&pair=${encodeURIComponent(pair)}${initialTrade?.entryPrice ? "&includeExecutionMark=1" : ""}`,
    )
      .then((response) => {
        if (cancelled) return;
        const result = response.data as {
          available?: boolean;
          base?: TradeToken;
          quote?: TradeToken;
          executionMarketPair?: string;
          executionMark?: { last: number; priceCurrency: string; ts: string };
          explanation?: string;
          reason?: string;
        };
        // A verified token representation and a safely executable route are
        // different facts. Keep the real contracts visible even when OKX
        // rejects the route, but never enable an order without both.
        if (response.ok && result.available && networkKey === "robinhood" && result.executionMarketPair && result.executionMarketPair !== pair) {
          if (incomingTrade && initialTrade?.entryPrice && incomingTrade.pair === pair) {
            const mark = result.executionMark;
            if (!mark || mark.priceCurrency !== "USDG" || !Number.isFinite(Number(mark.ts)) || Date.now() - Number(mark.ts) > 180_000 || Number(mark.ts) > Date.now() + 30_000)
              throw new Error("A fresh USDG price is required to carry the report levels. Retry mapping; your report draft has been kept.");
            const intent = rebaseReportTrade(incomingTrade, result.executionMarketPair, mark.last);
            setRebasedTrade({ source: incomingTrade, network: networkKey, intent });
            setPair(result.executionMarketPair);
            setMessage("Report entry, TP and SL converted to the Robinhood token's USDG price. Review the adjusted levels before signing. No transaction was sent.");
            return;
          }
          selectSpotPair(result.executionMarketPair);
          setMessage("Robinhood token market loaded. Review fresh USDG order levels; Global report prices were not copied because token and underlying-share prices can differ. No transaction was sent.");
          return;
        }
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
      ).finally(() => { if (!cancelled) setMappingPending(false); });
    return () => {
      cancelled = true;
    };
  }, [pair, networkKey, mappingAttempt, incomingTrade]);

  useEffect(() => {
    if (mappingScope !== expectedMappingScope) {
      setRoutePending(false);
      setRouteAvailable(false);
      setRouteStatus("Mapping the selected pair on this network…");
      return;
    }
    if (!baseToken || !quoteToken) {
      setRoutePending(false);
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
    setRoutePending(true);
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
      }).finally(() => { if (!cancelled) setRoutePending(false); });
    return () => {
      cancelled = true;
    };
  }, [baseToken, quoteToken, mappingScope, expectedMappingScope, networkKey, pair]);

  useEffect(() => {
    if (!wallet || mappingScope !== expectedMappingScope || !baseToken || !quoteToken) {
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
        spotBalanceRefresh > 0,
      ),
      fetchTokenBalance(
        wallet,
        quoteToken.address,
        quoteToken.decimals,
        networkKey,
        spotBalanceRefresh > 0,
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
  }, [wallet, baseToken, quoteToken, mappingScope, expectedMappingScope, networkKey, spotBalanceRefresh]);

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
    if (networkKey === "arc") {
      const input = side === "buy" ? quoteToken : baseToken;
      const output = side === "buy" ? baseToken : quoteToken;
      setLimitMinOutHuman(input && output ? arcLimitMinimum(amountHuman, limitTrigger, slippage || "0", side, input.decimals, output.decimals) : "");
      return;
    }
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
  }, [amountHuman, limitTrigger, side, slippage, networkKey, baseToken, quoteToken]);

  useEffect(() => {
    if (!initialTrade) return;
    setSide(initialTrade.side);
    setExecutionMode(initialTrade.orderType);
    setLimitTrigger(initialTrade.entryPrice ? String(initialTrade.entryPrice) : "");
    setTakeProfit(initialTrade.takeProfit ? String(initialTrade.takeProfit) : "");
    setStopLoss(initialTrade.stopLoss ? String(initialTrade.stopLoss) : "");
    setMarketTimeframe(initialTrade.timeframe || "1H");
    setProtectAfterFill(
      initialTrade.side === "buy" &&
        Boolean(initialTrade.takeProfit && initialTrade.stopLoss),
    );
    setLimitAbove(initialTrade.side === "sell" || Boolean(initialTrade.entryPrice && initialTrade.observedPrice && initialTrade.entryPrice > initialTrade.observedPrice));
  }, [initialTrade]);

  const refresh = useCallback(async (freshOrders = false) => {
    lastRefreshAtRef.current = Date.now();
    // Receipt settlement and manual refresh must refresh the ticket balances,
    // not only the order history. Otherwise a sold balance stays spendable in UI.
    setSpotBalanceRefresh(value => value + 1);
    // Establish the active chain/wallet scope before the first await. Without
    // this guard, a slower request from the previous tab/network can overwrite
    // the newly selected network's account state.
    const refreshScope = `${networkKey}:${wallet?.toLowerCase() || "disconnected"}`;
    accountLookupRef.current = refreshScope;
    setCapabilityUnavailable(false);
    const isCurrentScope = () => accountLookupRef.current === refreshScope;
    const cap = await apiGet(`/v1/trading/capabilities?network=${networkKey}`);
    if (!isCurrentScope()) return;
    const nextCapability = cap.ok ? parseExecutionCapability(cap.data, networkKey) : null;
    setCapabilityUnavailable(!nextCapability);
    if (nextCapability) setCapability(nextCapability);
    else {
      setCapability(null);
      if (wallet) {
        setSpotAccountStatus("error");
        setLimitAccountStatus("error");
        setBracketAccountStatus("error");
        setAccountLookupError(
          `Could not load ${WEB_NETWORKS[networkKey].label} contract configuration. Retry when the API is available.`,
        );
      }
    }
    if (wallet) {
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
      if (nextCapability) {
        const contracts = nextCapability.contracts;
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
    if (!wallet || !needsLiveReconciliation)
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
    const requestId = ++quoteRequestRef.current;
    const isCurrentQuote = () => requestId === quoteRequestRef.current && quoteContext === quoteContextRef.current;
    setBusy("quote");
    setMessage("");
    setQuote(null);
    try {
      const response = await apiPost("/v1/trading/quote", {
        network: networkKey,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
        amount,
        slippagePercent: Number(slippage),
        slippageMode,
        maxAutoSlippagePercent: Number(slippage),
      });
      if (!isCurrentQuote()) return;
      if (!response.ok) throw new Error(errorText(response.data));
      const result = response.data as { quote?: { toTokenAmount?: unknown } } | null;
      if (!result?.quote || !/^[1-9]\d*$/.test(String(result.quote.toTokenAmount)))
        throw new Error("No positive output returned for this amount. Change the amount or refresh the live quote before reviewing a trade.");
      setQuote(response.data as Record<string, unknown>);
      setRouteAvailable(true);
      setRouteError("");
      setRouteStatus(
        `Live ${baseToken?.symbol || "asset"}/${quoteToken?.symbol || "settlement"} route verified`,
      );
    } catch (error) {
      if (isCurrentQuote()) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === quoteRequestRef.current) setBusy("");
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
      const hash = await sendPrepared(networkKey, wallet, { ...tx, spendToken: fromToken, spendAmount: amount });
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
    <div className="v6-workspace spot-workspace trading-workspace-shell">
      <TradingWorkspaceNav title="Spot trading" items={SPOT_WORKSPACE_PAGES} value={spotPage} disabled={Boolean(busy)} onChange={setSpotPage} />
      <div className="trading-workspace-content">
      <section hidden={spotPage !== "setup"} aria-label="Trade setup workspace">
        <details className="workspace-discovery"><summary>Explore other pairs <span>Free market previews · optional research</span></summary>
        <OpportunityRadar
          networkKey={networkKey}
          context="spot"
          lang={lang}
          onAnalyze={(candidate) =>
            onAnalyzeCandidate?.(candidate.pair, candidate.timeframe)
          }
          onPrepare={(candidate) => { setMarketTimeframe(candidate.timeframe); selectSpotPair(candidate.pair, true); }}
        />
        </details>

      <section className="v6-heading">
        <div><h2>Trade setup</h2></div>
        <CapabilityNotice capability={capability} type="spot" unavailable={capabilityUnavailable} />
      </section>

      {initialTrade ? (
        <section className="report-intent-strip">
          <div>
            <span className="eyebrow">
              LOADED FROM {reportTierLabel(initialTrade.sourceTier).toUpperCase()} REPORT
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
              : routePending
                ? "Checking route"
                : mappingReady && !mappingPending
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
          disabled={busy !== ""}
          onClick={() => void refresh()}
        >
          Refresh status
        </button>
      </section>

      <div className="spot-trade-shell">
        <section id="spot-trade-ticket" tabIndex={-1} className="card report-trade-ticket">
          <SpotMarketPreview key={`${pair}:${marketTimeframe}`} pair={pair} timeframe={marketTimeframe} lang={lang} markers={confirmedTradeMarkers(activity, pair)} />
          <div className="ticket-header">
            <div>
              <span className="eyebrow">TRADE TICKET</span>
              <h3>{pair}</h3>
            </div>
            <span className="provider-chip">OKX Onchain OS</span>
          </div>
          {message.includes("loaded in the Spot ticket") && <p className="ticket-selection-feedback" role="status">{message}</p>}
          <div className="execution-pair-control">
            <label htmlFor="spot-execution-pair">Pair on this network</label>
            <ExecutionPairPicker
              id="spot-execution-pair"
              networkKey={networkKey}
              value={pair}
              onSelect={(selected) => {
                selectSpotPair(selected.pair);
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
          {!mappingReady && !mappingPending && (
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
          {!routeAvailable && mappingReady && !routePending && (
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
              <strong>{mappingPending || routePending ? "Checking market data and the selected route…" : "No order can be created for this selection"}</strong>
              <span>{mappingPending || routePending ? "PULSE is checking the token mapping and live provider evidence before enabling this ticket." : `Choose a pair whose on-chain token, settlement asset and live route are all verified on ${WEB_NETWORKS[networkKey].label}. PULSE will then show the Market or Limit ticket with real symbols and balances.`}</span>
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
                    !mappingReady ||
                    !amountReady ||
                    !wallet ||
                    insufficientBalance ||
                    (protectAfterFill && spotAccountStatus === "error")
                  }
                  onClick={() => void (quote ? execute() : requestQuote())}
                  aria-describedby="spot-market-review-help"
                >
                  {busy === "swap"
                    ? "Open wallet…"
                    : busy === "quote"
                      ? "Finding route…"
                    : insufficientBalance
                      ? `Use ${sellAsset?.symbol || "wallet"} balance first`
                      : quote ? `Review ${side} in wallet` : `Get quote to review ${side}`}
                </button>
              </div>
              <p id="spot-market-review-help" className="setup-note" role="status">
                {!wallet ? "Connect the wallet you want to trade with."
                  : !amountReady ? "Enter a positive amount before requesting a trade quote."
                  : protectAfterFill && spotAccountStatus === "error" ? "Refresh status to check your protection setup before trading with TP/SL."
                  : quote ? "Review the expected output above, then continue in your wallet. The execution route is refreshed before signing."
                  : "Get a live quote for your entered amount first. Then review the output and continue in your wallet. Getting a quote sends no wallet transaction."}
              </p>
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
                      ? "Enter amounts in token units. If this is your first order on this network, the wallet will show one additional setup transaction."
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
            <summary>Advanced · verified token contracts</summary>
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
                Sell amount <code>{amountHuman || "—"} {sellAsset?.symbol}</code>
              </span>
              <span>
                Minimum output <code>{limitMinOut && buyAsset ? `${formatUnits(BigInt(limitMinOut), buyAsset.decimals)} ${buyAsset.symbol}` : "not set"}</code>
              </span>
            </div>
          </details>}
          {message && !message.includes("loaded in the Spot ticket") && (
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

      </section>
      <section hidden={spotPage !== "dashboard"} aria-label="Spot dashboard">
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
      </section></div>
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
    options.find((option) => option.value.toLowerCase() === value.toLowerCase()) || { value: "", label: "Choose an Autopilot", address: "Select an account to view its controls", status: "Not selected", capital: "" };

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
  lang,
  initialTrade,
  onAnalyzeCandidate,
}: {
  networkKey: WebNetworkKey;
  wallet: string | null;
  lang: Lang;
  initialTrade?: ReportTradeIntent | null;
  onAnalyzeCandidate?: (pair: string, timeframe: string) => void;
}) {
  const [autopilotPage, setAutopilotPage] = useState("dashboard");
  const setupOpen = autopilotPage === "create" || autopilotPage === "edit";
  const setSetupOpen = (open: boolean) => setAutopilotPage(open ? (selectedVault ? "edit" : "create") : "dashboard");
  const [launchStage, setLaunchStage] = useState<number | null>(null);
  const [launchState, setLaunchState] = useState<"running" | "complete" | "interrupted">("running");
  useEffect(() => {
    if (launchStage === 0) document.querySelector(".autopilot-progress")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [launchStage]);
  useEffect(() => { setSetupOpen(false); }, [networkKey, wallet]);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [settlement, setSettlement] = useState<string>(
    WEB_NETWORKS[networkKey].payment.address,
  );
  const [capabilityUnavailable, setCapabilityUnavailable] = useState(false);
  const [pair, setPair] = useState("BTC-USDT");
  const [timeframe, setTimeframe] = useState("4H");
  const historyScope = `${networkKey}:${pair}:${timeframe}`;
  const requiresMarketHistory = networkKey === "robinhood" || networkKey === "arc";
  const [historyCheck, setHistoryCheck] = useState<{ scope: string; ready: boolean; reason: string; signalMarket?: string; alternatives?: Array<{ timeframe: string; ready: boolean; reason: string }> } | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [checkOtherTimeframes, setCheckOtherTimeframes] = useState(false);
  useEffect(() => {
    if (!setupOpen || !requiresMarketHistory) return;
    let cancelled = false;
    setHistoryCheck(null);
    const timer = setTimeout(() => {
      void apiGet(`/v1/autopilot/market-readiness?network=${networkKey}&pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}${checkOtherTimeframes ? "&alternatives=1" : ""}`)
        .then(response => {
          if (cancelled) return;
          const data = response.data as { ready?: boolean; reason?: string; signalMarket?: string; alternatives?: Array<{ timeframe: string; ready: boolean; reason: string }> };
          setHistoryCheck({ scope: historyScope, ready: response.ok && data.ready === true, reason: data.reason || "Market history could not be checked. Retry before setup.", signalMarket: data.signalMarket, alternatives: data.alternatives });
        }).catch(() => { if (!cancelled) setHistoryCheck({ scope: historyScope, ready: false, reason: "Market history check is temporarily unavailable. Retry before setup." }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [setupOpen, historyScope, historyAttempt, checkOtherTimeframes, requiresMarketHistory, networkKey, pair, timeframe]);
  const [maxTrade, setMaxTrade] = useState("50");
  const [dailyLoss, setDailyLoss] = useState("3");
  const [riskProfile, setRiskProfile] = useState<
    "conservative" | "balanced" | "active" | "custom"
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
  const [runtimeStorageReady, setRuntimeStorageReady] = useState(false);
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
  const passCheckoutScope = `${networkKey}:${wallet}:${selectedVault}`;
  const passCheckoutScopeRef = useRef(passCheckoutScope);
  passCheckoutScopeRef.current = passCheckoutScope;
  const passCheckoutInFlight = useRef(false);
  const createNewVaultRef = useRef(false);
  const accountBeforeSetupRef = useRef("");
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
  const vaultBalanceScopeRef = useRef("");
  const setupBalanceScopeRef = useRef({ settlement: "", target: "" });
  const [balanceRefreshTick, setBalanceRefreshTick] = useState(0);
  useEffect(() => {
    if (!wallet) return;
    const refresh = () => { if (document.visibilityState === "visible") setBalanceRefreshTick((tick) => tick + 1); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [wallet, networkKey]);
  const [sellAmountAtomic, setSellAmountAtomic] = useState("");
  const [sizingStatus, setSizingStatus] = useState(
    "Enter capital to calculate trade sizing.",
  );
  const [minConfidence, setMinConfidence] = useState("70");
  const [busy, setBusy] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [selectedPassPlan, setSelectedPassPlan] = useState<"24h" | "7d" | "30d">("24h");
  const [preparedCandidate, setPreparedCandidate] = useState("");
  const preparedNoticeRef = useRef<HTMLDivElement>(null);
  const [closeConfirming, setCloseConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const settlementDecimals = WEB_NETWORKS[networkKey].payment.decimals;
  const activeStrategy = selectedAutopilotStrategy(strategies, selectedVault);
  const recoveringVault = Boolean(selectedVault && !activeStrategy);
  const selectedVaultNumber = vaults.findIndex(vault => vault.toLowerCase() === selectedVault.toLowerCase()) + 1;
  const [recoveryCheck, setRecoveryCheck] = useState<{ vault: string; state: "checking" | "ready" | "failed" } | null>(null);
  async function reviewVaultSetup(vault: string) {
    if (busy) return;
    setSetupOpen(true);
    createNewVaultRef.current = false;
    setSelectedVault(vault);
    setCloseConfirming(false);
    setPreparedCandidate("");
    // Activity is only a market hint, never a substitute for signed trading rules.
    const hint = [...activity].filter(item => item.account?.toLowerCase() === vault.toLowerCase() && item.status === "confirmed" && item.pair).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (hint?.pair) setPair(hint.pair);
    setRecoveryCheck({ vault, state: "checking" });
    setBusy(true);
    setMessage("Checking the existing account and registration service. No transaction or payment is being requested.");
    requestAnimationFrame(() => document.getElementById("autopilot-review-target")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const readiness = await apiPost("/v1/autopilot/readiness", {});
      if (!readiness.ok) throw new Error("Registration storage is unavailable. Your existing vault remains unchanged; retry after the service recovers.");
      await refresh();
      setRecoveryCheck({ vault, state: "ready" });
      setMessage("Review this account's market and risk summary below, then approve its wallet prompts. Existing funds are reused. Unsaved settings are drafts—not recovered trading instructions. No new vault will be created.");
    } catch (error) {
      setRecoveryCheck({ vault, state: "failed" });
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }
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
  const [editConfiguration, setEditConfiguration] = useState<{ scope: string; capital: string; tradePct: number; turnoverPct: number; exposurePct: number; maxTradeValue: string; dailyTurnoverCap: string; exposureCap: string; maxSlippageBps: string; maxDailyLossBps: string; cooldown: string; expiry: string; assetAllowed: boolean } | null>(null);
  const [editLoadError, setEditLoadError] = useState("");
  const savedEditDraft = useRef("");
  const draftFingerprint = JSON.stringify([pair, timeframe, strategy, Number(maxTrade), Number(dailyLoss), Number(exposurePct), Number(dailyTurnoverPct), Number(maxSlippagePct), Number(cooldownSeconds), Number(minConfidence)]);
  const editScope = networkKey + ":" + selectedVault.toLowerCase();
  const signalSourceChanged = networkKey === "robinhood" && historyCheck?.scope === historyScope && historyCheck.ready && Boolean(activeStrategy) && historyCheck.signalMarket !== (activeStrategy?.policy?.signalMarket || activeStrategy?.pair);
  const unchangedEdit = autopilotPage === "edit" && Boolean(activeStrategy) && savedEditDraft.current === draftFingerprint && !signalSourceChanged;
  useEffect(() => {
    if (autopilotPage !== "edit" || !activeStrategy) return;
    let cancelled = false;
    setEditConfiguration(null); setEditLoadError(""); savedEditDraft.current = "";
    void apiGet("/v1/autopilot/configuration?network=" + networkKey + "&vault=" + selectedVault + "&asset=" + activeStrategy.targetAsset).then(response => {
      if (cancelled) return;
      if (!response.ok) throw new Error("Could not load this vault's current risk limits. Return to Dashboard and reopen Edit to retry.");
      const config = (response.data as { configuration: Record<string, unknown> }).configuration;
      if (!config || !["maxTradeValue", "dailyTurnoverCap", "exposureCap", "maxSlippageBps", "maxDailyLossBps", "cooldown", "expiry"].every(key => /^\d+$/.test(String(config[key])))) throw new Error("Risk configuration is incomplete. Editing is blocked until it can be verified.");
      const tradePct = activeStrategy.policy?.maxTradePct || 50;
      const capital = BigInt(String(config.maxTradeValue)) * 10000n / BigInt(Math.max(1, Math.round(tradePct * 100)));
      if (capital <= 0n) throw new Error("This strategy has no configured trade capital. Finish setup first.");
      const percentage = (value: unknown) => Number(BigInt(String(value)) * 10000n / capital) / 100;
      const exposure = percentage(config.exposureCap), turnover = percentage(config.dailyTurnoverCap);
      const loss = Number(config.maxDailyLossBps) / 100, slippage = Number(config.maxSlippageBps) / 100;
      const strategyText = activeStrategy.policy?.strategy || activeStrategy.strategyType?.replaceAll("_", " ") || "Trend following";
      const confidence = activeStrategy.minConfidence ?? 70;
      setPair(activeStrategy.pair); setTimeframe(activeStrategy.timeframe); setStrategy(strategyText); setMaxTrade(String(tradePct)); setDailyLoss(String(loss)); setExposurePct(String(exposure)); setDailyTurnoverPct(String(turnover)); setMaxSlippagePct(String(slippage)); setCooldownSeconds(String(config.cooldown)); setMinConfidence(String(confidence)); setRiskProfile("custom");
      savedEditDraft.current = JSON.stringify([activeStrategy.pair, activeStrategy.timeframe, strategyText, tradePct, loss, exposure, turnover, slippage, Number(config.cooldown), confidence]);
      setEditConfiguration({ ...(config as unknown as NonNullable<typeof editConfiguration>), scope: editScope, capital: String(capital), tradePct, turnoverPct: turnover, exposurePct: exposure });
    }).catch(error => { if (!cancelled) setEditLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [autopilotPage, networkKey, selectedVault, activeStrategy?.id]);
  const hydratedVaultRef = useRef("");
  useEffect(() => {
    if (!selectedVault) { hydratedVaultRef.current = ""; return; }
    if (!activeStrategy) return;
    const scope = `${networkKey}:${selectedVault.toLowerCase()}`;
    if (hydratedVaultRef.current === scope) return;
    hydratedVaultRef.current = scope;
    setPair(activeStrategy.pair);
    setTimeframe(activeStrategy.timeframe);
    setStrategy(activeStrategy.policy?.strategy || activeStrategy.strategyType?.replaceAll("_", " ") || "Trend following");
    if (Number.isFinite(activeStrategy.minConfidence)) setMinConfidence(String(activeStrategy.minConfidence));
    if (Number.isFinite(activeStrategy.policy?.maxTradePct)) setMaxTrade(String(activeStrategy.policy!.maxTradePct));
    if (Number.isFinite(activeStrategy.policy?.dailyLossPct)) setDailyLoss(String(activeStrategy.policy!.dailyLossPct));
    setRiskProfile("custom");
    setPreparedCandidate("");
  }, [selectedVault, networkKey, activeStrategy]);
  const parsedCapital = useMemo(() => {
    return positiveTokenAmount(capitalHuman, settlementDecimals) || 0n;
  }, [capitalHuman, settlementDecimals]);
  const knownSettlementBalance = activeVault?.balanceAtomic ?? activeStrategy?.settlementBalance;
  const existingVaultCapital =
    knownSettlementBalance && /^\d+$/.test(knownSettlementBalance)
      ? BigInt(knownSettlementBalance)
      : 0n;
  const reusingFundedVault = Boolean(
    ADDRESS.test(selectedVault) && (existingVaultCapital > 0n || (autopilotPage === "edit" && Boolean(activeStrategy))),
  );
  const effectiveCapital = autopilotPage === "edit" && editConfiguration?.scope === editScope
    ? BigInt(editConfiguration.capital)
    : reusingFundedVault ? existingVaultCapital : parsedCapital;
  const percentOf = (amountValue: bigint, percentValue: string) =>
    (amountValue *
      BigInt(Math.max(0, Math.round((Number(percentValue) || 0) * 100)))) /
    10_000n;
  const loadedEdit = autopilotPage === "edit" && editConfiguration?.scope === editScope ? editConfiguration : null;
  const maxTradeAtomic = loadedEdit && Number(maxTrade) === loadedEdit.tradePct ? loadedEdit.maxTradeValue : String(percentOf(effectiveCapital, maxTrade));
  const dailyCapAtomic = loadedEdit && Number(dailyTurnoverPct) === loadedEdit.turnoverPct && BigInt(loadedEdit.dailyTurnoverCap) >= BigInt(maxTradeAtomic) ? loadedEdit.dailyTurnoverCap : String(
    [
      percentOf(effectiveCapital, dailyTurnoverPct),
      BigInt(maxTradeAtomic || "0"),
    ].reduce((a, b) => (a > b ? a : b)),
  );
  const exposureCapAtomic = loadedEdit && Number(exposurePct) === loadedEdit.exposurePct ? loadedEdit.exposureCap : String(percentOf(effectiveCapital, exposurePct));
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
    setBalanceRefreshTick((tick) => tick + 1);
    setCapabilityUnavailable(false);
    const isCurrentScope = () => vaultLookupRef.current === refreshScope;
    if (wallet) {
      setVaultStatus("checking");
      setVaultLookupError("");
    }
    const cap = await apiGet(`/v1/trading/capabilities?network=${networkKey}`);
    if (!isCurrentScope()) return;
    const nextCapability = cap.ok ? parseExecutionCapability(cap.data, networkKey) : null;
    setCapabilityUnavailable(!nextCapability);
    if (nextCapability) setCapability(nextCapability);
    else {
      setCapability(null);
      if (wallet) {
        setVaultStatus("error");
        setVaultLookupError(
          `Could not load ${WEB_NETWORKS[networkKey].label} Autopilot configuration.`,
        );
      }
    }
    if (wallet) {
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
          persistence?: { state?: string; lastError?: string };
        };
        setStrategies(runtimeData.strategies || []);
        setStrategyCatalog(runtimeData.strategyCatalog || []);
        setAiPolicy(runtimeData.aiPolicy || null);
        const storageState = runtimeData.persistence?.state;
        const storageReady = storageState === "online" || storageState === "local";
        setRuntimeStorageReady(storageReady);
        if (!storageReady) syncNotice = /max requests limit/i.test(runtimeData.persistence?.lastError || "")
          ? "Service storage request allowance is exhausted. Setup, pass checkout and Resume are stopped until the operator restores it. Wallet funds remain owner-controlled."
          : "Service storage is unavailable. Pass status is unverified—not expired. Setup, checkout and Resume are temporarily stopped.";
      } else {
        setRuntimeStorageReady(false);
        syncNotice ||=
          "Autopilot monitoring is reconnecting. On-chain vault guardrails remain active.";
      }
      setActivitySyncNotice(syncNotice);
      if (nextCapability) {
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
    let cancelled = false;
    setAutopilotRouteAvailable(false);
    setAutopilotRouteStatus("Checking token contracts and live OKX route…");
    void probePairRoute(pair, networkKey, true)
      .then((route) => {
        if (cancelled) return;
        if (route) {
          if (networkKey === "robinhood" && route.executionMarketPair && route.executionMarketPair !== pair) {
            setPair(route.executionMarketPair);
            return;
          }
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
      setupBalanceScopeRef.current = { settlement: "", target: "" };
      setAutopilotBalances({ settlement: null, target: null });
      return;
    }
    let cancelled = false;
    const scopes = { settlement: `${networkKey}:${wallet.toLowerCase()}:${settlement.toLowerCase()}`, target: `${networkKey}:${wallet.toLowerCase()}:${targetToken?.address.toLowerCase() || ""}` };
    const previousScopes = setupBalanceScopeRef.current;
    setupBalanceScopeRef.current = scopes;
    setAutopilotBalances((previous) => ({ settlement: previousScopes.settlement === scopes.settlement ? previous.settlement : null, target: previousScopes.target === scopes.target ? previous.target : null }));
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
  }, [wallet, targetToken, settlement, networkKey, activity, balanceRefreshTick]);

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
      vaultBalanceScopeRef.current = "";
      setVaultWalletBalance(null);
      return;
    }
    let cancelled = false;
    const scope = `${networkKey}:${wallet.toLowerCase()}:${activeSettlementAsset.toLowerCase()}:${activeSettlementDecimals}`;
    if (vaultBalanceScopeRef.current !== scope) setVaultWalletBalance(null);
    vaultBalanceScopeRef.current = scope;
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
    balanceRefreshTick,
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
      if (![buyAmountAtomic, sellAmountAtomic].every((value) => /^\d+$/.test(value) && BigInt(value) > 0n)) throw new Error("Enter a positive trade amount within this token's supported precision");
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
    if (unchangedEdit || editNotReady) return;
    setBusy(true);
    setLaunchStage(0); setLaunchState("running");
    setMessage("Preparing your guarded strategy…");
    let safelyPaused = false;
    let passPurchased = false;
    let resumeConfirmed = false;
    try {
      setMessage("Checking token contracts and the live route before any wallet transaction...");
      const readiness = await apiPost("/v1/autopilot/readiness", {});
      if (!readiness.ok) throw new Error("Service storage is unavailable. No wallet transaction or payment was requested. Retry setup after service recovery.");
      const preflight = await apiPost("/v1/autopilot/preflight", {
        network: networkKey,
        settlementAsset: settlement,
        targetAsset,
        pair,
        timeframe,
        amountAtomic: buyAmountAtomic,
        maxTradeValueAtomic: maxTradeAtomic,
        maxSlippageBps: Number(maxSlippageBps),
      });
      if (!preflight.ok)
        throw new Error(`${errorText(preflight.data)} No wallet transaction was sent.`);
      const signalMarket = (preflight.data as { signalMarket?: string }).signalMarket;
      if (requiresMarketHistory && (!signalMarket || historyCheck?.scope !== historyScope || historyCheck.signalMarket !== signalMarket)) {
        setHistoryAttempt(value => value + 1);
        throw new Error("The strategy signal source changed. Review the refreshed history source before starting. No wallet transaction was sent.");
      }
      const policy = {
        pair,
        timeframe,
        maxTradePct: Number(maxTrade),
        dailyLossPct: Number(dailyLoss),
        strategy,
        ...(requiresMarketHistory ? { signalMarket } : {}),
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
      setLaunchStage(1);
      let vault = selectedVault;
      const wasExisting = ADDRESS.test(vault);
      type CurrentConfiguration = NonNullable<typeof editConfiguration> & { paused: boolean; policyHash: string; targetBalance: string };
      let currentConfiguration: CurrentConfiguration | null = null;
      if (wasExisting) {
        const current = await apiGet("/v1/autopilot/configuration?network=" + networkKey + "&vault=" + vault + "&asset=" + (activeStrategy?.targetAsset || targetAsset));
        if (!current.ok) throw new Error("Could not verify current on-chain settings. No wallet transaction was requested.");
        currentConfiguration = (current.data as { configuration: CurrentConfiguration }).configuration;
        if (!currentConfiguration || typeof currentConfiguration.paused !== "boolean") throw new Error("Current vault state is incomplete. Retry without signing.");
        if (activeStrategy?.targetAsset && activeStrategy.targetAsset.toLowerCase() !== targetAsset.toLowerCase() && BigInt(currentConfiguration.targetBalance || "0") > 0n) throw new Error("Close or withdraw the existing invested asset in Dashboard before changing this Autopilot's trading pair.");
      }
      safelyPaused = !wasExisting || currentConfiguration?.paused === true;
      if (!wasExisting) {
        setMessage(
          "Wallet confirmation · Confirm the owner-controlled strategy wallet.",
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
          ) || "";
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
        if (currentConfiguration?.paused === false) {
          setMessage(
            "Wallet confirmation · Pausing the existing strategy before changing its policy.",
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
        if (policyHash !== currentConfiguration?.policyHash) {
        setMessage("Wallet confirmation · Confirm the updated strategy policy.");
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
      }

      setMessage(
        "Wallet confirmation · Confirm the selected asset and maximum exposure.",
      );
      setLaunchStage(2);
      const staleAssets = [wasExisting ? activeStrategy?.targetAsset : undefined]
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
      if (!wasExisting || !currentConfiguration?.assetAllowed || activeStrategy?.targetAsset?.toLowerCase() !== targetAsset.toLowerCase() || currentConfiguration.exposureCap !== exposureCapAtomic) {
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
      }

      setMessage("Wallet confirmation · Confirm the risk limits.");
      setLaunchStage(3);
      if (!wasExisting || !currentConfiguration || currentConfiguration.maxTradeValue !== maxTradeAtomic || currentConfiguration.dailyTurnoverCap !== dailyCapAtomic || currentConfiguration.maxSlippageBps !== maxSlippageBps || currentConfiguration.maxDailyLossBps !== maxDailyLossBps || currentConfiguration.cooldown !== cooldownSeconds || Number(currentConfiguration.expiry) <= Date.now() / 1000) {
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
      }

      setLaunchStage(4);
      if (!reusingFundedVault) {
        setMessage(
          `Wallet confirmation · Confirm the ${capitalHuman} ${WEB_NETWORKS[networkKey].payment.symbol} allocation.`,
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
          `Wallet confirmation · Reusing ${formatUnits(existingVaultCapital, settlementDecimals)} ${WEB_NETWORKS[networkKey].payment.symbol} already held by your strategy wallet.`,
        );
      }

      setMessage(
        "Wallet confirmation · Authorize the strategy configuration.",
      );
      setLaunchStage(5);
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
        setMessage(`Wallet confirmation · Approve the ${selectedPassPlan} AI Entry Pass. The paid timer stops whenever this Autopilot is paused.`);
        passExpiry = await requestAutopilotPass(selectedPassPlan, vault);
        passPurchased = true;
      } else {
        setMessage("Wallet confirmation · Existing AI Entry Pass verified; no additional payment is required.");
      }
      setLaunchStage(6);
      setMessage("Wallet confirmation · Start the configured Autopilot, then wait for network confirmation.");
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
      resumeConfirmed = true;
      safelyPaused = false;
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
      setLaunchState("complete"); setAutopilotPage("dashboard");
    } catch (error) {
      setLaunchState(resumeConfirmed ? "complete" : "interrupted");
      if (resumeConfirmed) setAutopilotPage("dashboard");
      setMessage(
        `${error instanceof Error ? error.message : String(error)} ${autopilotSetupFailureState({ resumed: resumeConfirmed, paid: passPurchased, safelyPaused })}`,
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
    if (action === "resume" && !controlState.resumeAllowed) return setMessage(controlState.reason || "This Autopilot is not paused.");
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
          throw new Error("Select a target asset and enter positive trade limits");
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
    const telegramDelivery = new URLSearchParams(window.location.search).get("tg") || undefined;
    const prefix = WEB_NETWORKS[networkKey].route;
    const paidUrl = `${API_BASE}/${prefix}/v1/autopilot/pass/${plan}`;
    const paidBody = JSON.stringify({ owner: wallet, vault, ...(telegramDelivery ? { telegramDelivery } : {}) });
    const recovering = await hasRecoverablePayment(networkKey, wallet, paidUrl, { method: "POST", body: paidBody }, localStorage);
    const available = fundingWalletBalance;
    if (!recovering && available === null) throw new Error(`PULSE could not verify your ${activeSettlementSymbol} payment balance. Refresh before purchasing the pass.`);
    if (!recovering && available !== null && available < prices[plan]) throw new Error(`You need ${prices[plan].toFixed(2)} ${activeSettlementSymbol}; the connected wallet has ${available.toLocaleString("en-US", { maximumFractionDigits: 6 })}.`);
    const paidFetch = await createWalletPaidFetch(wallet, networkKey);
    const response = await paidFetch(paidUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: paidBody,
    });
    const body = await response.json().catch(() => ({})) as { aiPass?: { expiresAt?: string }; error?: string };
    if (!response.ok) throw new Error(body.error || `Autopilot pass purchase failed (${response.status})`);
    return body.aiPass?.expiresAt;
  }

  async function purchaseAutopilotPass(plan: "24h" | "7d" | "30d") {
    if (busy || passBusy || passCheckoutInFlight.current) return;
    if (!controlState.purchaseAllowed) return setMessage(controlState.reason || "Finish setup and fund this Autopilot before purchasing a pass.");
    if (!wallet || !selectedVault) {
      setMessage("Connect your wallet and select an Autopilot before buying its pass.");
      return;
    }
    passCheckoutInFlight.current = true;
    setPassBusy(true);
    setBusy(true);
    setMessage(`Preparing the ${plan} AI Entry Pass payment…`);
    try {
      const vault = selectedVault;
      const owner = wallet;
      let activitySyncPending = false;
      const verifyScope = () => {
        if (passCheckoutScopeRef.current !== passCheckoutScope) throw new Error("Wallet, network or selected Autopilot changed. Select the paid vault to resume it");
      };
      const result = await renewAndResumeAutopilot({
        pay: () => requestAutopilotPass(plan, vault),
        isPaused: async () => {
          verifyScope();
          const snapshot = await fetchAccountSnapshot(networkKey, owner, true);
          verifyScope();
          const account = snapshot.vaults.find(item => item.address.toLowerCase() === vault.toLowerCase());
          if (!account || typeof account.paused !== "boolean") throw new Error("Could not verify the selected vault's current state");
          return account.paused;
        },
        resume: async () => {
          verifyScope();
          setMessage("Pass paid. Confirm Resume in your wallet to start this Autopilot and its pass timer.");
          const hash = await sendPrepared(networkKey, owner, { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "setPaused", args: [false] }), value: "0" });
          await waitForWalletReceipt(getInjectedProvider(), hash);
          await apiPost("/v1/trading/activity", { owner, network: networkKey, source: "autopilot", kind: "vault_resume", status: "pending", txHash: hash, account: vault, pair: activeStrategy?.pair || pair }).catch(() => { activitySyncPending = true; });
        },
      });
      setMessage(`AI Entry Pass paid; Autopilot is running. Estimated expiry: ${result.expiresAt ? new Date(result.expiresAt).toLocaleString() : "see the timer"}. Pausing holds the remaining time.${activitySyncPending ? " Resume confirmed on-chain; activity indexing is pending." : ""}`);
      await refresh().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await refresh().catch(() => undefined);
    } finally {
      passCheckoutInFlight.current = false;
      setPassBusy(false);
      setBusy(false);
    }
  }

  function exportAutopilotLog(item: AutopilotStrategyView) {
    const relatedActivity = activity.filter((entry) => entry.source === "autopilot" && (
      entry.account?.toLowerCase() === item.vault.toLowerCase()
      // Same-pair vaults are different accounts. Never assign ambiguous events.
    ));
    const exportNetwork = item.network || item.id.split(":")[0] || networkKey;
    const headings = ["record_type", "timestamp", "pair", "timeframe", "decision_or_event", "status", "bias", "confidence_pct", "reason", "error", "tx_hash", "vault", "network", "runtime_state", "pass_expires_at", "pass_signals_used", "pass_signal_limit", "evidence_hash", "market_metrics", "rule_results", "decision_context", "fill_price", "history_coverage"];
    const runtimeSnapshot = ["runtime_snapshot", new Date().toISOString(), item.pair, item.timeframe, "effective_runtime", item.runtimeState || "unknown", "", "", `Registration: ${item.registrationStatus || item.status}; effective runtime: ${autopilotRuntimeLabel(item)}.`, item.telemetryError, "", item.vault, exportNetwork, item.runtimeState || "unknown", item.aiPass?.expiresAt, item.aiPass?.signalsUsed, item.aiPass?.signalLimit];
    const historyRows = [
      ...(item.evaluations || []).map((entry) => ["strategy_decision", entry.evaluatedAt, entry.context?.pair || item.pair, entry.context?.timeframe || item.timeframe, entry.action, entry.status, entry.bias, ["not_evaluated", "not_required", "unknown"].includes(entry.bias) ? "" : entry.confidence, entry.reason, entry.error, entry.txHash, item.vault, exportNetwork, "", "", "", "", ...decisionAuditColumns(entry), "", ""]),
      ...relatedActivity.map((entry) => ["onchain_activity", entry.createdAt, entry.pair || item.pair, item.timeframe, entry.kind, entry.status, "", "", "", "", entry.txHash, entry.account || item.vault, exportNetwork, "", "", "", "", "", "", "", "", entry.fillPrice || "", ""]),
    ].sort((left, right) => Date.parse(String(left[1])) - Date.parse(String(right[1])));
    const coverage = `${item.evaluations?.length || 0} retained / ${item.evaluationCount ?? "unknown"} evaluations; ${item.evaluationHistoryComplete ? "complete" : "partial or unverified"}; storage ${item.journalStorage || "unknown"}`;
    const rows = [[...runtimeSnapshot, "", "", "", "", "", coverage], ...historyRows];
    const csv = serializeAuditCsv([headings, ...rows]);
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pulse-autopilot-${item.pair.toLowerCase()}-${item.vault.slice(2, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }


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
      const balance = Number(formatUnits(BigInt(value), decimals));
      return balance > 0 && balance < 0.000001 ? "<0.000001" : balance.toLocaleString("en-US", { maximumFractionDigits: 6 });
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
        status: strategyView?.exitPending
            ? "Closing position"
            : strategyView
              ? autopilotRuntimeLabel(strategyView, paused)
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
  const passUnavailable = !runtimeStorageReady || activeStrategy?.runtimeState === "telemetry_unavailable";
  const controlState = autopilotControlState({ registered: Boolean(activeStrategy), storageReady: runtimeStorageReady,
    paused: activeVault?.paused ?? activeStrategy?.paused, funded: existingVaultCapital > 0n || BigInt(activeStrategy?.targetBalance || "0") > 0n,
    passRemainingMs, signalsRemaining: passSignalsRemaining, hasPosition: BigInt(activeStrategy?.targetBalance || "0") > 0n });
  const passTimeLabel = passRemainingMs > 0
    ? passRemainingMs >= 86_400_000
      ? `${Math.floor(passRemainingMs / 86_400_000)}d ${Math.floor((passRemainingMs % 86_400_000) / 3_600_000)}h remaining`
      : `${Math.max(1, Math.ceil(passRemainingMs / 3_600_000))}h remaining`
    : "Expired or not purchased";
  const passTimerState = !activePass ? "No pass purchased" : activePass.pausedAt || activeStrategy?.paused || activeVault?.paused ? "Timer on hold while paused" : passRemainingMs <= 0 ? "Pass expired — renewal required" : "Timer active while running";
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
  const localizedStrategyValue = lang === "zh"
    ? strategy === strategyPresets[0].value
      ? "趋势跟踪并由精简 AI 确认；达到当日亏损上限后停止。"
      : strategy === strategyPresets[1].value
        ? "仅在精简 AI 确认动量与成交量时延续突破；否则持有。"
        : strategy === strategyPresets[2].value
          ? "仅在精简信号确认的支撑区域进行均值回归入场；达到当日亏损上限后停止。"
          : strategy
    : strategy;
  const riskProfileLabel = lang === "zh"
    ? riskProfile === "custom" ? "自定义" : riskProfile === "conservative"
      ? "保守型"
      : riskProfile === "active"
        ? "积极型"
        : "均衡型"
    : riskProfile[0].toUpperCase() + riskProfile.slice(1);
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
  const editNotReady = autopilotPage === "edit" && Boolean(activeStrategy) && editConfiguration?.scope !== editScope;
  const startDisabled =
    busy || unchangedEdit || editNotReady ||
    (requiresMarketHistory && (historyCheck?.scope !== historyScope || !historyCheck.ready)) ||
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
  const startLabel = unchangedEdit ? "No changes to save" : editNotReady ? "Loading current risk limits…" : busy
    ? message || "Preparing Autopilot…"
    : !wallet
      ? "Connect wallet to continue"
      : !capability?.autopilot.enabled
        ? "Autopilot execution unavailable"
        : !autopilotRouteAvailable
          ? "Choose a pair with a live route"
          : requiresMarketHistory && historyCheck?.scope !== historyScope
            ? "Checking strategy history…"
          : requiresMarketHistory && !historyCheck?.ready
            ? "Choose a market/timeframe with sufficient history"
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
              ? `Approve setup & start Autopilot #${selectedVaultNumber}`
              : "Create & start new Autopilot";

  return (
    <div className="v6-workspace autopilot-simple trading-workspace-shell">
      <TradingWorkspaceNav title="Autopilot" items={AUTOPILOT_WORKSPACE_PAGES} value={autopilotPage} disabled={busy} onChange={(page) => {
        if (page === "create") { accountBeforeSetupRef.current = selectedVault; createNewVaultRef.current = true; setSelectedVault(""); setRecoveryCheck(null); setPreparedCandidate(""); setLaunchStage(null); }
        else { createNewVaultRef.current = false; if (!selectedVault) setSelectedVault(accountBeforeSetupRef.current || vaults[0] || ""); }
        if (page === "edit") setLaunchStage(null);
        setAutopilotPage(page);
      }} />
      <div className="trading-workspace-content">
      {launchStage !== null && <section className={"card autopilot-progress " + launchState} role="status" aria-live="polite">
        <span className="eyebrow">{launchState === "complete" ? "AUTOPILOT STARTED" : launchState === "interrupted" ? "SETUP INTERRUPTED" : "SETUP IN PROGRESS"}</span>
        <h3>{launchState === "complete" ? "Your Autopilot is running" : launchState === "interrupted" ? "Review the completed steps before continuing" : "Step " + (launchStage + 1) + " of 7"}</h3>
        <progress max={7} value={launchState === "complete" ? 7 : launchStage} />
        <ol>{["Check market & account", "Create or update vault", "Set asset exposure", "Set risk limits", "Allocate capital", "Authorize strategy & pass", "Start & verify"].map((label, index) => <li key={label} data-state={launchState === "complete" || index < launchStage ? "complete" : index === launchStage ? "current" : "pending"}><span>{index < launchStage || launchState === "complete" ? "✓" : index + 1}</span>{label}</li>)}</ol>
        <p>{message}</p><small>Each wallet prompt belongs to the current step. A confirmed vault-creation transaction is only one part of setup.</small>
      </section>}
      <section id="autopilot-configuration" className="autopilot-configuration" hidden={!setupOpen}>
      <fieldset className="autopilot-form-lock" disabled={busy}>
      {autopilotPage === "edit" && <div className="card autopilot-edit-selector"><h2>Edit Autopilot</h2><p>Select the account to load its current strategy. Review changes, then save and restart.</p><AutopilotAccountPicker value={selectedVault} options={existingVaultPickerOptions} onChange={(vault) => { createNewVaultRef.current = false; setSelectedVault(vault); }} />{!vaults.length && <p>Connect the owning wallet or create an Autopilot first.</p>}{editLoadError && <p role="alert">{editLoadError}</p>}{editNotReady && !editLoadError && <p role="status">Loading the selected account’s on-chain risk limits…</p>}</div>}
      <div hidden={autopilotPage === "edit" && (!selectedVault || editNotReady)}>
      <OpportunityRadar
        networkKey={networkKey}
        initialTimeframe={timeframe}
        context="autopilot"
        onAnalyze={(candidate) =>
          onAnalyzeCandidate?.(candidate.pair, candidate.timeframe)
        }
        onPrepare={(candidate) => {
          createNewVaultRef.current = autopilotPage === "create" && !recoveringVault;
          if (createNewVaultRef.current) setSelectedVault("");
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
          requestAnimationFrame(() => preparedNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }}
      />
      <section className="v6-heading">
        <div><h2>{recoveringVault ? `Finish Autopilot #${selectedVaultNumber} setup` : "Autopilot setup"}</h2></div>
        <CapabilityNotice capability={capability} type="autopilot" unavailable={capabilityUnavailable} />
      </section>
      {preparedCandidate && <div className="prepared-autopilot-notice" ref={preparedNoticeRef} role="status"><strong>{lang === "zh" ? "自动驾驶草案已准备" : "Autopilot draft prepared"}</strong><span>{lang === "zh" ? `${preparedCandidate.replace("trend following", "趋势跟随").replace("mean reversion", "均值回归").replace("breakout", "突破")}。仅预填了交易对、周期和策略。请检查下方每个步骤；未购买报告，也未发送交易。` : `${preparedCandidate}. Only pair, timeframe and strategy were prefilled. Review every step below; no report was purchased and no transaction was sent.`}</span></div>}

      <div className="autopilot-onboarding">
        <section className="card autopilot-builder">
          <div className="setup-target-field" id="autopilot-setup-target">
            <span>SETUP TARGET</span>
            <strong>{selectedVault ? `Autopilot #${selectedVaultNumber} · ${selectedVault.slice(0, 8)}…${selectedVault.slice(-6)}` : "New owner-controlled account"}</strong>
            <small>{recoveringVault ? "This existing account has no saved strategy registration. Select its market and review every risk limit below. These are draft settings, not recovered trading instructions. Completing setup reuses this account and its available funds." : selectedVault ? (lang === "zh" ? "已载入此账户的交易对和策略。下方风险参数是待审核草案；签署更新前请逐项检查。暂停、充值和提现请使用仪表板。" : "The saved market and strategy are loaded for this account. Risk inputs below are a reviewable draft: check every limit before signing an update. Use the dashboard to pause, fund or withdraw.") : "A new isolated owner-controlled vault will be created."}</small>
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
              <span>Trading pair</span>
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
              <span>Decision timeframe</span>
              <TimeframePicker
                id="autopilot-timeframe"
                value={timeframe}
                networkKey={networkKey}
                values={["15m", "1H", "4H", "1D"]}
                purpose="strategy"
                onChange={setTimeframe}
              />
            </div>
          </div>
          {requiresMarketHistory && <section className="v6-message" role="status" aria-label="Autopilot market history">
            <strong>{historyCheck?.scope !== historyScope ? "Checking strategy history…" : historyCheck.ready ? "Strategy history available" : "This market/timeframe is not ready for Autopilot"}</strong>
            <p>{historyCheck?.scope === historyScope ? historyCheck.reason : "Checking completed candles before any funding, payment or wallet signature."}</p>
            {signalSourceChanged && <p>The existing strategy uses {activeStrategy?.policy?.signalMarket || activeStrategy?.pair}. Saving this change requires a new owner-signed policy; it does not change the asset traded.</p>}
            {historyCheck?.scope === historyScope && !historyCheck.ready && <>
              <p>A live swap route does not guarantee enough candle history for an autonomous strategy. Choose another market or check other timeframes; no funds have moved.</p>
              <button type="button" className="btn btn-soft" onClick={() => setHistoryAttempt(value => value + 1)}>Retry history check</button>{" "}
              <button type="button" className="btn btn-soft" onClick={() => { setCheckOtherTimeframes(true); setHistoryAttempt(value => value + 1); }}>Check other timeframes</button>
              {historyCheck.alternatives?.map(item => <p key={item.timeframe}>{item.ready ? <button type="button" className="btn btn-soft" onClick={() => setTimeframe(item.timeframe)}>Use {item.timeframe} · history available</button> : `${item.timeframe}: ${item.reason}`}</p>)}
            </>}
          </section>}
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
          <SpotMarketPreview key={`autopilot:${pair}:${timeframe}`} pair={pair} timeframe={timeframe} lang={lang} context="autopilot" markers={selectedVault ? confirmedTradeMarkers(activity, pair, selectedVault) : []} />
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
                  Choose another supported pair below, or trade this pair manually on{" "}
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
                again. Add or withdraw capital from Dashboard.
                {loadedEdit && <> Risk percentages use the saved configured capital of {formatUnits(BigInt(loadedEdit.capital), settlementDecimals)} {activeSettlementSymbol}, so opening Edit does not resize existing limits.</>}
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
                  <b data-no-localize>{lang === "zh"
                    ? profile === "conservative"
                      ? "保守型"
                      : profile === "active"
                        ? "积极型"
                        : "均衡型"
                    : profile[0].toUpperCase() + profile.slice(1)}</b>
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
                  {!["120", "300", "900", "3600"].includes(cooldownSeconds) && <option value={cooldownSeconds}>{Number(cooldownSeconds) / 60} minutes · current setting</option>}
                </select>
              </label>
            </div>
            <label>
              <span>Custom instructions</span>
              <textarea
                rows={3}
                value={localizedStrategyValue}
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
              <span>This is Autopilot runtime—not a Global Quick or Pro report. Only compact AI checks for candidates that pass the free technical gate use the pass. Pausing freezes the time remaining. TP/SL, exits and withdrawals never require a pass.</span>
              <small>{selectedVault && passActive ? "The existing pass remains bound to this vault." : "PULSE creates and registers a new vault first when needed, requests this payment in step 6, then starts it. Renew later from the dashboard."}</small>
            </div>
            {passFundingInsufficient && <div className="capital-inline-warning">The connected wallet needs {requiredWalletFunds.toFixed(2)} {activeSettlementSymbol} for {reusingFundedVault ? "this pass" : "the initial deposit plus this pass"}; available {fundingWalletBalance?.toLocaleString("en-US", { maximumFractionDigits: 6 })}.</div>}
            {passFundingUnavailable && <div className="capital-inline-warning">PULSE cannot verify the connected-wallet payment balance. Refresh before any vault transaction is prepared.</div>}
          </div>

          <div id="autopilot-review-target" className="autopilot-step-head">
            <span>5</span>
            <div><small>REVIEW BEFORE SIGNING</small><h3>Review your strategy and limits</h3></div>
          </div>

          <div className="autopilot-review">
            <div>
              {recoveringVault && <div className="autopilot-recovery-summary" role="status">
                <strong>Continue existing Autopilot #{selectedVaultNumber}</strong>
                <p>{recoveryCheck?.vault === selectedVault && recoveryCheck.state === "checking" ? "Checking account and registration service…" : recoveryCheck?.vault === selectedVault && recoveryCheck.state === "failed" ? "Readiness check failed. Read the error below before retrying." : "This account needs signed strategy registration. Review these draft settings before continuing; funding alone does not authorize trading."}</p>
                <dl><div><dt>Already in this vault</dt><dd>{knownSettlementBalance == null || !/^\d+$/.test(knownSettlementBalance) ? "Balance unavailable" : `${formatUnits(BigInt(knownSettlementBalance), activeSettlementDecimals)} ${activeSettlementSymbol}`}</dd></div><div><dt>Maximum trade</dt><dd>{maxTrade}% of configured capital</dd></div><div><dt>Daily loss limit</dt><dd>{dailyLoss}%</dd></div><div><dt>AI confidence required</dt><dd>{minConfidence}%</dd></div></dl>
                <button type="button" className="btn btn-soft" disabled={busy} onClick={() => document.getElementById("autopilot-setup-target")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Change market or risk limits</button>
              </div>}
              <span className="eyebrow">READY TO REVIEW</span>
              <h3>
                {selectedStrategy.label} · {pair} · {timeframe}
              </h3>
              <p data-no-localize>{lang === "zh"
                ? `不会购买或复用全球市场报告。PULSE 先运行免费的确定性监控，仅在出现符合设置的候选机会时请求精简 AI 入场信号；仅交易 ${targetToken?.symbol || "已验证资产"}，并在链上强制执行上述${riskProfileLabel}风险限额。`
                : `No Global report is bought or reused. PULSE starts with free deterministic monitoring and requests a compact AI entry signal only when a setup candidate exists, trades only ${targetToken?.symbol || "the verified asset"}, and enforces the ${riskProfileLabel} limits above on-chain.`}</p>
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
          <div className="wallet-confirmation-plan">
            <strong>Wallet confirmations explained</strong>
            <p>A new Autopilot normally asks for five on-chain transactions and two signatures. Each confirmation has a different purpose:</p>
            <ol>
              <li>Create your vault, approve its asset exposure, and set risk limits (3 transactions).</li>
              <li>Transfer the initial deposit (1 transaction), then sign the strategy authorization.</li>
              <li>Sign the AI Entry Pass payment, then resume the configured vault (1 transaction).</li>
            </ol>
            <p>Existing vaults skip creation. Existing funds, a valid pass, and unchanged on-chain settings are reused. Changing a running strategy first pauses it; changing assets may require removing the old asset. Cancelling a prompt leaves completed transactions on-chain; the progress panel shows where setup stopped.</p>
          </div>
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
                    ? activeStrategy.exitPending
                        ? "Closing position"
                        : autopilotRuntimeLabel(activeStrategy, activeVault?.paused)
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
                <div><span>Invested asset</span><strong>{formatAssetAtomic(activeStrategy?.targetBalance, activeStrategy?.targetDecimals ?? targetToken?.decimals ?? 18)} {activeStrategy?.targetSymbol || targetToken?.symbol || pair.split("-")[0]}</strong><small>{activeStrategy?.hasResidualDust ? (lang === "zh" ? "剩余微量代币，可提取；不作为可交易持仓。" : "A tiny leftover balance remains withdrawable; it is not treated as a tradable position.") : "Withdraw separately, or let the strategy sell"}</small></div>
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
                Complete setup steps 1–6 above. PULSE will verify the route,
                capital, policy and pass before offering activation.
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
      </div></fieldset></section>

      <section hidden={autopilotPage !== "dashboard"} className="card activity-dashboard autopilot-unified-dashboard">
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
        {vaults.length > 0 && <section className="dashboard-control-panel" id="autopilot-dashboard-controls">
          <div className="dashboard-account-line">
            <div className="vault-picker-field">
              <span>Autopilot account</span>
              <AutopilotAccountPicker
                value={selectedVault}
                options={existingVaultPickerOptions}
                onChange={(vault) => { createNewVaultRef.current = false; setSelectedVault(vault); setCloseConfirming(false); }}
              />
            </div>
            <div className="autopilot-status-card">
              <span>Runtime</span>
              <strong className={autopilotRuntimeClass(activeStrategy, activeVault?.paused) === "active" ? "positive" : "warning"}>
                {activeStrategy?.exitPending ? "Closing position" : autopilotRuntimeLabel(activeStrategy, activeVault?.paused)}
              </strong>
              <small>{activeStrategy?.lastDecision?.replaceAll("_", " ") || "Awaiting first decision"}</small>
            </div>
            <div className={`autopilot-pass-card compact ${passActive ? "active" : "warning"}`}>
              <div><span>AI ENTRY PASS</span><strong>{passUnavailable ? "Pass status unavailable" : passRemainingMs > 0 ? `${passTimeLabel}${activePass?.pausedAt ? " · on hold" : ""}` : "New entries on Hold"}</strong><small>{passUnavailable ? "Storage unavailable · do not pay again" : `${activePass?.pausedAt ? "Timer on hold while Autopilot is paused" : passTimerState} · ${passSignalsRemaining} confirmations left`}</small></div>
              <div className="pass-plans">
                <button type="button" className="btn btn-accent" disabled={busy || passBusy || !selectedVault || !controlState.purchaseAllowed} onClick={() => void purchaseAutopilotPass("24h")}>24h · ${passPrices["24h"].toFixed(2)}</button>
                <button type="button" className="btn btn-soft" disabled={busy || passBusy || !selectedVault || !controlState.purchaseAllowed} onClick={() => void purchaseAutopilotPass("7d")}>7d · ${passPrices["7d"].toFixed(2)}</button>
                <button type="button" className="btn btn-soft" disabled={busy || passBusy || !selectedVault || !controlState.purchaseAllowed} onClick={() => void purchaseAutopilotPass("30d")}>30d · ${passPrices["30d"].toFixed(2)}</button>
              </div>
              <small>{passBusy ? "Completing payment and checking Resume…" : "Pay & resume: after payment, a paused vault requests one wallet confirmation to resume. Running vaults need no extra transaction. Added time follows unused time; never auto-renews."}</small>
            </div>
          </div>
          {selectedVault && <>
            <div className="dashboard-balance-strip">
              <div><span>Wallet available</span><strong>{walletBalanceText}</strong><small>Source for top-ups and pass payments</small></div>
              <div><span>Vault settlement</span><strong>{formatAssetAtomic(activeStrategy?.settlementBalance || activeVault?.balanceAtomic || undefined, activeSettlementDecimals)} {activeSettlementSymbol}</strong><small>Withdrawable after pausing</small></div>
              <div><span>Invested asset</span><strong>{formatAssetAtomic(activeStrategy?.targetBalance, activeStrategy?.targetDecimals ?? targetToken?.decimals ?? 18)} {activeStrategy?.targetSymbol || targetToken?.symbol || pair.split("-")[0]}</strong><small>{activeStrategy?.hasResidualDust ? (lang === "zh" ? "剩余微量代币，可提取；不作为可交易持仓。" : "A tiny leftover balance remains withdrawable; it is not treated as a tradable position.") : "May be sold by the strategy or withdrawn"}</small></div>
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
                <div className="manager-actions"><button className="btn btn-danger" disabled={busy || (activeVault?.paused ?? activeStrategy?.paused ?? true)} onClick={() => void operateVault("pause")}>Pause · hold pass timer</button><button className="btn btn-accent" disabled={busy || !controlState.resumeAllowed} onClick={() => void operateVault("resume")}>Resume · run timer</button></div>
                {controlState.reason && <p className="control-help" role="status">{controlState.reason}</p>}
                {recoveringVault && <button type="button" className="btn btn-accent full" disabled={busy || !runtimeStorageReady} onClick={() => reviewVaultSetup(selectedVault)}>Finish setup for Autopilot #{selectedVaultNumber}</button>}
                {closeConfirming ? <div className="account-lookup-error"><strong>Withdraw every asset and close?</strong><small>The auditable vault contract remains reusable.</small><div className="manager-actions"><button className="btn btn-soft" onClick={() => setCloseConfirming(false)}>Cancel</button><button className="btn btn-danger" disabled={busy} onClick={() => void closeAndWithdrawAutopilot()}>Confirm</button></div></div> : <button className="btn btn-danger full" disabled={busy} onClick={() => setCloseConfirming(true)}>Close &amp; withdraw all</button>}
              </section>
            </div>
          </>}
        </section>}
        <div className="dashboard-metrics">
          <div>
            <span>Autopilot accounts</span>
            <strong>{new Set([...vaults, ...strategies.map(item => item.vault)].map(address => address.toLowerCase())).size}</strong>
            <small>{strategies.length} registered strategies · includes unfinished accounts</small>
          </div>
          <div>
            <span>Running</span>
            <strong>
              {
                strategies.filter(
                  (item) => item.runtimeState === "running" || item.runtimeState === "protecting_position" || (!item.runtimeState && item.status === "active" && !item.paused),
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
              {vaults.some(vault => !strategies.some(item => item.vault.toLowerCase() === vault.toLowerCase())) ? " · registered strategies only; other funds shown below" : ""}
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
            <small>{strategies.some(item => item.pnlCashFlow && item.pnlCashFlow.state !== "synced") ? "Cash-flow history is being verified; incomplete returns stay unavailable." : "mark-to-market, cash-flow adjusted"}</small>
          </div>
        </div>
        {activeStrategy?.pnlCashFlow && <section className="cash-flow-coverage" aria-label={lang === "zh" ? "盈亏数据覆盖" : "PnL data coverage"}>
          <div><strong>{lang === "zh" ? "所选自动驾驶 · 盈亏数据" : "Selected Autopilot · PnL data"}</strong><span>{activeStrategy.pnlCashFlow.state === "synced" ? (lang === "zh" ? "已核验" : "Verified through checkpoint") : activeStrategy.pnlCashFlow.state === "recovering" ? `${lang === "zh" ? "正在同步" : "Synchronizing"} · ${activeStrategy.pnlCashFlow.progressPct}%` : (lang === "zh" ? "盈亏暂不可用" : "PnL unavailable")}</span></div>
          <p>{activeStrategy.pnlCashFlow.detail}</p>
          {activeStrategy.pnlAsOf && <small>{lang === "zh" ? "余额与资金流时间点" : "Balances and cash flows as of"} {new Date(activeStrategy.pnlAsOf).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}. {lang === "zh" ? "持仓按最新参考价格估值；上方可用余额更新得更及时。" : "Holdings use the current reference mark; spendable balances above can be newer."}</small>}
          {activeStrategy.pnlCashFlow.state !== "synced" && <small>{lang === "zh" ? "后台核验不会暂停交易或更改通行证。无需再次付款。" : "Background verification does not pause trading or change your pass. No new payment is needed."}</small>}
        </section>}
        {activeStrategy && <details className="autopilot-runtime-market"><summary>{lang === "zh" ? "所选自动驾驶的市场行情" : "Market context for selected Autopilot"} · {activeStrategy.pair} · {activeStrategy.timeframe}</summary><SpotMarketPreview key={`runtime:${activeStrategy.pair}:${activeStrategy.timeframe}`} pair={activeStrategy.pair} timeframe={activeStrategy.timeframe} lang={lang} context="autopilot" markers={confirmedTradeMarkers(activity, activeStrategy.pair, activeStrategy.vault)} /></details>}
        {strategies.length || vaults.length ? (
          <div className="order-monitor">
            {[...vaults, ...strategies.filter(item => !vaults.some(vault => vault.toLowerCase() === item.vault.toLowerCase())).map(item => item.vault)].map(vault => {
              const item = strategies.find(item => item.vault.toLowerCase() === vault.toLowerCase());
              if (!item) {
              const account = vaultDetails.find(item => item.address.toLowerCase() === vault.toLowerCase());
              const index = vaults.findIndex(item => item.toLowerCase() === vault.toLowerCase());
              return <div className="order-monitor-row autopilot-row identified-vault incomplete-vault" key={vault}>
                <span className="status-chip paused">{account?.paused ? "Paused" : "Not registered"}</span>
                <button type="button" className="vault-identity" aria-label={`Open Autopilot #${index + 1} controls`} onClick={() => { createNewVaultRef.current = false; setSelectedVault(vault); document.getElementById("autopilot-dashboard-controls")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><small>Autopilot</small><strong>#{index + 1}</strong></button>
                <div><strong>Setup incomplete</strong><small className="autopilot-id">{vault.slice(0, 8)}…{vault.slice(-4)}</small></div>
                <div><small>Vault funds</small><strong>{account?.balanceAtomic != null ? `${formatUnits(BigInt(account.balanceAtomic), account.settlementDecimals ?? settlementDecimals)} ${account.settlementSymbol || activeSettlementSymbol}` : "Unavailable"}</strong></div>
                <div className="incomplete-vault-note">This on-chain account has no saved strategy. Select it, then review setup; do not create or fund a replacement.</div>
                <button type="button" className="btn btn-soft" disabled={busy} onClick={() => reviewVaultSetup(vault)}>Finish setup</button>
              </div>;
              }
              const confirmedExecution = confirmedAutopilotExecutionCounts(activity, item.vault);
              const filledBuys = Math.max(item.filledBuyCount ?? 0, item.evaluations?.filter((entry) => entry.action === "buy" && entry.status === "filled").length ?? 0, confirmedExecution.buyCount);
              const filledSells = Math.max(item.filledSellCount ?? 0, item.evaluations?.filter((entry) => entry.action === "sell" && entry.status === "filled").length ?? 0, confirmedExecution.sellCount);
              const vaultIndex = vaults.findIndex(vault => vault.toLowerCase() === item.vault.toLowerCase());
              return <div className="order-monitor-row autopilot-row identified-vault" key={item.id}>
                <span
                  className={`status-chip ${autopilotRuntimeClass(item)}`}
                >
                  {autopilotRuntimeLabel(item)}
                </span>
                <button type="button" className="vault-identity" aria-label={`Open Autopilot ${vaultIndex >= 0 ? `#${vaultIndex + 1}` : item.vault} controls`} onClick={() => { createNewVaultRef.current = false; setSelectedVault(item.vault); setCloseConfirming(false); document.getElementById("autopilot-dashboard-controls")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  <small>Autopilot</small><strong>{vaultIndex >= 0 ? `#${vaultIndex + 1}` : "Account"}</strong>
                </button>
                <div>
                  <strong>
                    {item.pair} · {item.timeframe}
                  </strong>
                  <small className="autopilot-id">{item.vault.slice(0, 8)}…{item.vault.slice(-4)}</small>
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
                <div className="monitor-fill-counts">
                  <small>Confirmed fills</small>
                  <strong><span className="buy-count">{filledBuys} Buy</span> · <span className="sell-count">{filledSells} Sell</span></strong>
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
              </div>;
            })}
          </div>
        ) : (
          <div className="empty-dashboard">
            <strong>No active strategy</strong>
            <span>
              Complete steps 1–6 above to create and activate an Autopilot.
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
              const confirmedExecution = confirmedAutopilotExecutionCounts(activity, item.vault);
              const retainedBuyCount = evaluations.filter((entry) => entry.action === "buy" && entry.status === "filled").length;
              const retainedSellCount = evaluations.filter((entry) => entry.action === "sell" && entry.status === "filled").length;
              const apiBuyCount = item.filledBuyCount ?? 0;
              const apiSellCount = item.filledSellCount ?? 0;
              const filledBuys = Math.max(apiBuyCount, retainedBuyCount, confirmedExecution.buyCount);
              const filledSells = Math.max(apiSellCount, retainedSellCount, confirmedExecution.sellCount);
              const countersRepairedFromLedger = confirmedExecution.buyCount > apiBuyCount || confirmedExecution.sellCount > apiSellCount;
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
              const providerBlocked = /\b401\b|\b402\b|\b403\b|permission[- ]denied|credits|spending limit|billing|quota/i.test(latest?.error || "");
              return (
                <details key={`${item.id}-report`} id={`autopilot-journal-${item.vault.toLowerCase()}`}>
                  <summary>
                    <span>Autopilot {vaults.findIndex((vault) => vault.toLowerCase() === item.vault.toLowerCase()) >= 0 ? `#${vaults.findIndex((vault) => vault.toLowerCase() === item.vault.toLowerCase()) + 1}` : item.vault.slice(0, 10)} · Strategy journal · {item.pair} ·{" "}
                      {definition?.label ||
                        item.strategyType?.replaceAll("_", " ") ||
                        "Strategy"}</span>
                    <span className="journal-fill-summary">{filledBuys} buys · {filledSells} sells</span>
                  </summary>
                  <div className="autopilot-report-toolbar">
                    <div><span>Evaluations</span><strong>{evaluationCount}</strong><small>{item.lifetimeStatsComplete === false ? "available minimum" : "lifetime"}</small></div>
                    <div className="confirmed-stat"><span>Filled buys</span><strong>{filledBuys}</strong><small>confirmed on-chain</small></div>
                    <div className="confirmed-stat"><span>Filled sells</span><strong>{filledSells}</strong><small>partial + full fills</small></div>
                    <div><span>Holds</span><strong>{holds}</strong><small>{item.lifetimeStatsComplete === false ? "available minimum" : "lifetime"}</small></div>
                    <div><span>Failures</span><strong>{failures}</strong><small>{item.lifetimeStatsComplete === false ? `${failureIncidents} visible incidents · available minimum` : `${failureIncidents} distinct incidents in the available journal`}</small></div>
                    <div><span>AI today · UTC</span><strong>{item.aiCallsToday || 0} · ${(item.aiActualCostTodayUsd || 0).toFixed(4)}</strong><small>provider calls · USD</small></div>
                    <div><span>Last Grok signal</span><strong>{item.lastAiSignalAt ? new Date(item.lastAiSignalAt).toLocaleTimeString() : "Not requested yet"}</strong><small>{item.lastAiSignalAt ? new Date(item.lastAiSignalAt).toLocaleDateString() : "Only requested after entry conditions pass"}</small></div>
                    <div><span>Configured buy amount</span><strong>{/^\d+$/.test(item.buyAmountAtomic || "") ? `${formatUnits(BigInt(item.buyAmountAtomic!), item.settlementDecimals ?? WEB_NETWORKS[networkKey].payment.decimals)} ${item.settlementSymbol || WEB_NETWORKS[networkKey].payment.symbol}` : "Unavailable"}</strong><small>Signed configuration. Adding funds alone does not increase this; review Capital & risk and approve an updated strategy.</small></div>
                    <div><span>Last cycle</span><strong>{latest ? new Date(latest.evaluatedAt).toLocaleTimeString() : "—"}</strong><small>{latest ? new Date(latest.evaluatedAt).toLocaleDateString() : "awaiting"}</small></div>
                    <div><span>Protection checks</span><strong>{item.riskCheckCount?.toLocaleString() ?? "—"}</strong><small>{item.lastRiskCheckAt ? `Last check ${new Date(item.lastRiskCheckAt).toLocaleString()}` : "No check recorded"} · since monitoring counters enabled</small></div>
                    <div><span>Repeated candle skips</span><strong>{item.sameCandleSkipCount?.toLocaleString() ?? "—"}</strong><small>Same candle was already evaluated; no extra AI call · since monitoring counters enabled</small></div>
                    <div><span>Next AI eligible</span><strong>{item.aiNextEligibleAt ? new Date(item.aiNextEligibleAt).toLocaleTimeString() : "Candidate driven"}</strong><small>{item.aiBudgetStatus?.replaceAll("_", " ") || "free gate first"}</small></div>
                    <div><span>Position basis</span><strong>{item.positionEntryPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) || "No open entry"}</strong><small>mark {item.markPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) || "—"}</small></div>
                    <button type="button" className="btn btn-soft" onClick={() => exportAutopilotLog(item)}>Export CSV activity</button>
                  </div>
                  {item.journalStorage && item.journalStorage !== "synced" && <p className="capital-inline-warning">{item.journalStorage === "unavailable" ? "History storage is temporarily unavailable. Showing recovered rows, not a complete archive. Refresh to retry." : item.journalStorage === "pending_sync" ? "Some decisions are waiting to sync to history storage. They remain included below." : "Development memory only: history does not survive a server restart."}</p>}
                  {confirmedExecution.executions.length > 0 && <section className="strategy-execution-ledger">
                    <div className="dashboard-head"><div><span className="eyebrow">CONFIRMED TRADING</span><h4>{confirmedExecution.buyCount} Buy fill{confirmedExecution.buyCount === 1 ? "" : "s"} · {confirmedExecution.sellCount} Sell fill{confirmedExecution.sellCount === 1 ? "" : "s"}</h4></div><small>{countersRepairedFromLedger ? "Dashboard counters repaired from confirmed activity" : "Verified from confirmed activity"}</small></div>
                    <div className="strategy-execution-rows">
                      {confirmedExecution.executions.map((entry) => <div className="strategy-execution-row" key={entry.id}>
                        <span className={`execution-side ${entry.kind === "buy_filled" ? "buy" : "sell"}`}>{entry.kind === "buy_filled" ? "BUY" : entry.kind === "sell_partial_filled" ? "PARTIAL SELL" : "SELL"}</span>
                        <strong>{entry.fillPrice ? `Fill ${entry.fillPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : "Confirmed fill"}</strong>
                        <time>{new Date(entry.fillObservedAt || entry.createdAt).toLocaleString()}</time>
                        {entry.txHash ? <a href={`${WEB_NETWORKS[item.network || networkKey].explorer}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">Transaction ↗</a> : <span />}
                      </div>)}
                    </div>
                  </section>}
                  {item.evaluationHistoryComplete === false && <details className="capital-inline-warning"><summary>{item.lifetimeStatsComplete === false ? `History coverage: ${evaluations.length.toLocaleString()} saved decisions · older total unknown` : `History coverage: ${evaluations.length.toLocaleString()} of ${evaluationCount.toLocaleString()} decisions · ${Math.max(0, evaluationCount - evaluations.length).toLocaleString()} older details missing`}</summary><p>The former retention window deleted older decision details. This is not a limit on the rows displayed or exported now. {item.lifetimeStatsComplete === false ? "Lifetime counters are minimums because the older total is unknown." : "Lifetime evaluation, Hold and failure counters still include those older decisions."} Confirmed on-chain Buy/Sell totals are separate and remain authoritative. New decisions are appended to the journal; check the journal storage status for synchronization problems. Missing historical reasons cannot be reconstructed without a backup.</p></details>}
                  <div className={`strategy-now ${autopilotRuntimeClass(item)}`}>
                    <div><span>WHAT IT IS DOING NOW</span><strong>{item.runtimeState === "paused" || item.paused ? "PAUSED · no monitoring or entry checks" : item.runtimeState === "protecting_position" ? "PROTECTING · exits only" : item.runtimeState === "entry_pass_expired" ? "DORMANT · entry pass expired" : item.runtimeState === "entry_signals_exhausted" ? "DORMANT · confirmations used" : item.runtimeState === "telemetry_unavailable" ? "UNKNOWN · refresh runtime" : providerBlocked ? "WAITING · AI provider unavailable" : latest ? `${latest.action.toUpperCase()} · ${latest.status}` : "WAITING · first candle"}</strong></div>
                    <p>{item.runtimeState === "paused" || item.paused ? "The on-chain vault is paused. It cannot trade, and any active AI Entry Pass timer is held until you resume." : item.runtimeState === "protecting_position" ? "No new Buy is allowed without an active pass. Deterministic TP/SL and authorized exits continue for the invested asset." : item.runtimeState === "entry_pass_expired" ? "The vault has no invested position and cannot open a new one. Renew the AI Entry Pass to resume entry evaluation." : item.runtimeState === "entry_signals_exhausted" ? "The prepaid compact confirmations are used. Renew the AI Entry Pass to allow another qualified entry check." : item.runtimeState === "telemetry_unavailable" ? "PULSE could not verify the current on-chain runtime. No running claim is made until the next successful refresh." : providerBlocked ? `No assets moved. New AI requests are blocked until ${item.aiRetryAt ? new Date(item.aiRetryAt).toLocaleString() : "the provider retry window"}; deterministic position protection remains available.` : latest?.reason || "PULSE is waiting for the next eligible candle."}</p>
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
                        <li>Each newly closed candle passes a free deterministic setup gate. An unfinished candle cannot authorize an entry.</li>
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
                                {latest.bias === "not_evaluated" ? "Not evaluated · waiting for market conditions or AI eligibility" : latest.bias === "not_required" ? "Not required · deterministic protection" : latest.bias === "unknown" ? "Unavailable · see error details" : latest.confidence === 0 && item.aiSignalSource === "deterministic" ? "No current AI confirmation · legacy record stored 0%, not a trade recommendation" : `${latest.bias} · ${latest.confidence}%`}
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
                                  {formatRuleEvidence(rule.observed)} - requires {formatRuleEvidence(rule.required)}
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
                  <AutopilotDecisionJournal entries={evaluations} explorer={WEB_NETWORKS[networkKey].explorer} lang={lang} />
                </details>
              );
            })}
          </div>
        )}
      </section>
        <section hidden={autopilotPage !== "activity"} className="card autopilot-chain-activity">
          <div className="dashboard-head"><div><span className="eyebrow">ON-CHAIN ACTIVITY</span><h4>Wallet confirmations, fills and owner actions</h4></div><small>Separate from strategy decisions · newest first</small></div>
          {activitySyncNotice && <div className="capital-inline-warning">{activitySyncNotice}</div>}
          {activity.filter((entry) => entry.source === "autopilot").length ? activity.filter((entry) => entry.source === "autopilot").slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((entry) => (
            <div className="chain-activity-row" key={entry.id}>
              <span className={`status-chip ${entry.status}`}>{entry.status}</span>
              <strong>{entry.kind.replaceAll("_", " ")}</strong>
              <span>{entry.pair || "Autopilot account"}</span>
              <time>{new Date(entry.createdAt).toLocaleString()}</time>
              {entry.txHash ? <a href={`${WEB_NETWORKS[networkKey].explorer}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">Transaction ↗</a> : <span />}
            </div>
          )) : <div className="empty-dashboard compact"><strong>No on-chain activity yet</strong><span>Wallet confirmations and executed trades will appear here.</span></div>}
        </section>
      </div>
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
  const estimatedPnlPct = spotTradePerformance(activity).realizedPct;
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
          <span>Realized Spot P&amp;L</span>
          <strong>
            {estimatedPnlPct === null
              ? "—"
              : `${estimatedPnlPct >= 0 ? "+" : ""}${estimatedPnlPct.toFixed(2)}%`}
          </strong>
          <small>
            {estimatedPnlPct === null ? "awaiting matched Buy/Sell cost basis" : "Market + Limit fills · excluding gas"}
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


export function TelegramWorkspace() { return <TelegramGuide />; }

export function DocsWorkspace({ lang = "en" }: { lang?: Lang } = {}) {
  const [topic, setTopic] = useState(() => window.location.hash.slice(1) || "docs-workflows");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const update = () => { const next = window.location.hash.slice(1); if (next.startsWith("docs-")) setTopic(next); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const sections = [
    ["docs-workflows", "Workflow maps"],
    ["docs-start", "Quick start"],
    ["docs-global", "Global reports"],
    ["docs-catalog", "Assets & routes"],
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
    ["docs-arc", lang === "zh" ? "Arc 主网与 USDC" : "Arc mainnet & USDC"],
    ["docs-robinhood", "Robinhood & USDG"],
    ["docs-agents", "Agents & API"],
    ["docs-recover", "Report history"],
    ["docs-telegram", "Telegram"],
  ];
  const article = sections.some(([id]) => id === topic) ? topic : "docs-workflows";
  return (
    <div className="docs-product">
      <header className="docs-product-head">
        <div>
          <span className="eyebrow">PULSE USER HANDBOOK</span>
          <h1>PULSE guides</h1>
          <p>
            Interactive guidance for analysis, execution, payments and recovery.
            No operator deployment files, no architecture prerequisites.
          </p>
        </div>
      </header>
      <div className="docs-product-layout">
        <div className="docs-mobile-topics"><label>Find a guide<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search topics"/></label><label>Current guide<select value={article} onChange={event => { setTopic(event.target.value); setSearch(""); window.location.hash=event.target.value; requestAnimationFrame(() => document.getElementById(event.target.value)?.scrollIntoView({block:"start"})); }}>{sections.filter(([id,label]) => id === article || label.toLowerCase().includes(search.trim().toLowerCase())).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
        <aside className="docs-nav" aria-label="Documentation navigation">
          <label className="docs-search">Find a topic<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Trading, reports, recovery…" /></label>
          <strong>Choose a guide</strong>
          {sections.filter(([, label]) => label.toLowerCase().includes(search.trim().toLowerCase())).map(([id, label], index) => (
            <a href={`#${id}`} key={id} aria-current={topic === id ? "page" : undefined} onClick={() => { setTopic(id); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" })); }}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {label}
            </a>
          ))}
          {!sections.some(([, label]) => label.toLowerCase().includes(search.trim().toLowerCase())) && <p role="status">No matching topic. Try “Spot”, “Autopilot” or “reports”.</p>}
        </aside>
        <div className="docs-content">
          <div hidden={article !== "docs-workflows"}><DocsWorkflowVisuals /></div>
          <section id="docs-arc" className="docs-section" hidden={article !== "docs-arc"} data-no-localize>
            <div className="docs-copy">
              <span className="eyebrow">ARC MAINNET · 5042 · USDC</span>
              <h3>{lang === "zh" ? "选择 Arc，核对资产与资金来源" : "Choose Arc, then review the asset and funding source"}</h3>
              <ol>
                <li>{lang === "zh" ? "在顶部“网络与支付”中选择 Arc Mainnet。钱包连接面板也支持 Arc；付款或签名交易前，请确认钱包网络为 5042。外观设置不改变网络。" : "Select Arc Mainnet in Network & payment. The wallet connection panel also includes Arc. Confirm wallet chain 5042 before payment or a transaction signature. Appearance settings do not change the network."}</li>
                <li>{lang === "zh" ? "连接钱包后，桌面和手机顶部均显示独立的 Wallet 与 Gateway USDC 余额。钱包 USDC 用于交易资金与网络费用；Gateway 用于研究服务与 Autopilot 通行证。余额读取失败时显示破折号，而非零。原生 18 位接口和代币 6 位接口读取同一笔钱包余额；请勿相加。" : "Once connected, the desktop and mobile header shows separate Wallet and Gateway USDC balances. Wallet USDC funds trading and gas; Gateway pays for research and Autopilot passes. An unavailable balance shows a dash instead of zero. The native 18-decimal and ERC-20 6-decimal interfaces read the same wallet balance; do not add them together."}</li>
                <li>{lang === "zh" ? "在“钱包与资金”中查看 Gateway 余额，检查充值金额与授权后再签名。钱包有余额不代表 Gateway 已有余额。Arc 测试网资金不能支付主网服务。" : "Open Wallet & funding to check Gateway balance. Review the deposit amount and approval before signing. A funded wallet does not imply a funded Gateway balance. Arc testnet funds cannot pay for mainnet services."}</li>
              </ol>
              <h4>{lang === "zh" ? "交易与 Autopilot 的资金流程" : "Spot and Autopilot funding workflow"}</h4>
              <ul>
                <li>{lang === "zh" ? "Spot Market：选择交易对并输入金额 → 点击“获取报价以审核买入/卖出” → 检查预期收到数量与滑点 → 点击“在钱包中审核买入/卖出”并签署 → 代币回到同一钱包。第一步报价不会签名；执行前会刷新路由。后台路由检查不等于你的下单金额报价。研究报告不会自动发起交易。" : "Spot Market: select a pair and enter the amount → Get quote to review buy/sell → inspect expected output and slippage → Review buy/sell in wallet and sign → receive tokens in that wallet. Getting a quote requests no signature; execution refreshes the route. The background route check is separate from your entered-amount quote. A research report does not place a trade automatically."}</li>
                <li>{lang === "zh" ? "Limit / TP-SL / bracket：从钱包将资金转入自己的订单账户，审核并授权入场及保护条件。Keeper 只能按批准的条件执行；取消订单按其状态返还未使用的托管资金。" : "Limit / TP-SL / bracket: fund your owner order account from your wallet, review and authorize entry/protection conditions. Keepers execute within those conditions. Cancellation returns unused escrow according to the order state."}</li>
                <li>{lang === "zh" ? "Autopilot：选择市场 → 检查买卖路由与 K 线 → 配置风险策略 → 从钱包充值自己的 vault → 授权策略 → 从 Gateway 购买通行证 → 启动。交易在 vault 内执行；Gateway 不提供交易本金。" : "Autopilot: select the market → verify entry/exit routes and candles → configure risk policy → fund your owner vault from your wallet → authorize the strategy → buy an Entry Pass from Gateway → start. Trades execute inside the vault; Gateway does not supply trading capital."}</li>
              </ul>
              <h4>{lang === "zh" ? "Gateway 充值与提取" : "Gateway deposit and withdrawal"}</h4>
              <p>{lang === "zh" ? "充值 Max 会预留授权和存款两笔交易的手续费；提取 Max 会扣除实时最高 Gateway 费用。Max 只填写待审核金额，不会签名。卖家的服务款项记入 PAY_TO_ADDRESS 对应钱包的 Gateway 余额；连接该钱包后使用同一提取流程。即使 Gateway 有余额，该钱包也须持有少量 Arc USDC 支付铸币交易手续费。" : "Deposit Max reserves approval and deposit gas; Withdrawal Max subtracts the live maximum Gateway fee. Max fills a reviewed amount without signing. Seller service proceeds accrue in the Gateway balance belonging to the PAY_TO_ADDRESS wallet; connect that wallet to use the same withdrawal flow. Even with Gateway funds, that wallet needs separate Arc USDC for mint transaction gas."}</p>
              <p>{lang === "zh" ? "打开“钱包与资金”。充值需审核 USDC 授权和 Gateway 存款两笔交易。选择“提取到钱包”，输入金额并查看实时最高费用；审核提取签名，再签署将 USDC 铸回同一 Arc 钱包的交易。Gateway 余额必须覆盖金额与费用，钱包须另有 USDC 支付手续费。正常提取无需七天等待。" : "Open Wallet & funding. Deposit requires USDC approval and a Gateway deposit transaction. Choose Withdraw to wallet, enter the amount and review the live maximum fee. Review the withdrawal signature, then sign the mint transaction back to the same Arc wallet. Gateway balance must cover the amount plus fee; keep wallet USDC for gas. Normal withdrawal has no seven-day waiting period."}</p>
              <p>{lang === "zh" ? "若提取中断，请使用“继续提取”，并保留浏览器恢复记录；不会自动创建新的扣款授权。备用合约提取需明确发起、等待实际领取区块（通常约七天），再领取到钱包。已有备用提取等待期间不能追加金额，以免重置等待期。" : "If interrupted, use Resume withdrawal and keep browser recovery storage; a new debit is not authorized automatically. The contract fallback requires explicit initiation, a wait until the actual claim block (usually about seven days), then a claim to the wallet. Additional delayed withdrawals are blocked while one is pending to avoid resetting its delay."}</p>
              <p>{lang === "zh" ? "Gateway 提取不等于从交易账户或 vault 提取资金，也不会停止策略。请分别使用账户的取消、暂停与提取控件。" : "Gateway withdrawal does not withdraw trading-account or vault capital and does not stop a strategy. Use the account's cancel, pause and withdrawal controls separately."}</p>
              <h4>{lang === "zh" ? "Arc 原生代币、模因币与路由" : "Arc-native tokens, memecoins and routes"}</h4>
              <p>{lang === "zh" ? "Global Market 与 Base、Arbitrum 一样使用实时 OKX 研究市场。Arc Spot 与 Autopilot 当前将 BTC-USDT 映射到 cirBTC/USDC，将 ETH-USDT 映射到 WETH/USDC。更广泛的索引代币与模因币目录仅用于 Token Risk Guard，可按名称、代码或合约地址搜索；收录不是安全结论。" : "Global Market uses live OKX research instruments, following the same logic as Base and Arbitrum. Arc Spot and Autopilot currently map BTC-USDT to cirBTC/USDC and ETH-USDT to WETH/USDC. The wider indexed token and memecoin catalog is available only in Token Risk Guard, including search by name, ticker or contract address. A listing is not a safety verdict."}</p>
              <ul>
                <li>{lang === "zh" ? "BTC 使用 Circle Wrapped Bitcoin（cirBTC），合约 0x171A4217b86A807A64eB94757Db6849fb4bDbAA0；ETH 使用官方 Arc WETH。图表、信号和 oracle 更新使用 OKX 参考价格，实际交易需 Arc 独立报价。索引模因币不能用于 Global、Spot 或 Autopilot。" : "BTC executes as Circle Wrapped Bitcoin (cirBTC), contract 0x171A4217b86A807A64eB94757Db6849fb4bDbAA0. ETH executes as the published Arc WETH. Charts, signals and oracle updates use OKX reference prices; the actual swap receives its own Arc quote. Indexed memecoins cannot be selected for Global, Spot or Autopilot."}</li>
                <li>{lang === "zh" ? "“Route available”默认开启，自动检查实时 OKX 行情、合约与买入、卖出路由。选择“All assets”可查看尚未确认路由的条目；报价故障会显示未知并重试。下单金额仍需重新报价。" : "Route available is selected by default and automatically checks live OKX market data, the contract, and entry and exit routes. Choose All assets to browse entries whose routes have not been confirmed. Provider failures remain unknown and are retried. Your actual order amount is quoted again."}</li>
                <li>{lang === "zh" ? "Autopilot 还需要所选市场与周期的至少 50 根 OKX连续、近期、已收盘 K 线。流动性或行情不足时，先更换市场或重试，再考虑充值或购买通行证。" : "Autopilot also needs at least 50 consecutive, recent completed candles from OKX for that market and timeframe. If routes or history are unavailable, choose another market or retry before funding or purchasing a pass."}</li>
              </ul>
              <h4>{lang === "zh" ? "当前可用性与恢复" : "Current availability and recovery"}</h4>
              <p>{lang === "zh" ? "Agent 与 SDK 使用 BTC-USDT 等 OKX 市场 ID，并选择 Arc 网络。Telegram 聊天中的 Global 输入 BTC-USDT 加周期；Risk Guard 输入 arc 加完整代币合约地址。聊天报告使用 Telegram Stars 结算，不会充值钱包或 Gateway，也不会授权交易。TON Mini App 仍提供其独立的 TON 研究服务。" : "Agents and SDK clients use OKX instrument IDs such as BTC-USDT and select Arc. In Telegram chat, Global accepts BTC-USDT plus a timeframe; Risk Guard accepts arc followed by the full token contract address. Chat reports are paid with Telegram Stars and do not fund a wallet or Gateway or authorize trading. The TON Mini App retains its separate TON research services."}</p>
              <p>{lang === "zh" ? "Arc 主网的交易合约已部署并公开验证；全局自动执行已于 2026 年 10 月 7 日恢复。各订单和 vault 仍须满足所有者授权、独立暂停状态、实时 OKX 数据、路由和风险限制。以当前 API 可用性为准。Circle 邮箱钱包的生产配置仍在准备中，因此邮箱登录暂未开启。" : "Arc mainnet trading contracts are deployed and publicly verified; global automation resumed on October 7, 2026. Each order and vault still requires its owner authorization, individual pause state, live OKX data, routes and risk limits. Follow the current API availability. Production Circle email-wallet setup is still pending, so email sign-in remains disabled."}</p>
              <p>{lang === "zh" ? "账户读取失败时，请重试同步；无法确定已有账户不等于需要新建账户。已付报告可通过 Report history 恢复，无需再次付款。旧 Arc 测试网报告保留原网络标签与独立归档。" : "Retry synchronization when account discovery fails. An unknown existing-account state does not mean you need to create another account. Recover paid reports through Report history without another payment. Old Arc testnet reports retain their original network labels and separate archive."}</p>
              <p>{lang === "zh" ? "Autopilot 交易超时后会核对原交易回执，期间不会创建新交易或消耗新的 AI 确认。恢复只会重发同一笔已签名交易，并继续检查暂停状态、策略与报价有效期。若报价过期或策略改变且原交易仍未确定，保持 Hold，由运营人员核对原交易；超时不代表交易失败。" : "After an Autopilot trade times out, PULSE checks the original receipt before creating another trade or consuming another AI confirmation. Recovery can resend only that same signed transaction while the vault is unpaused and its policy and quote remain valid. If the quote expires or the policy changes while the transaction remains unresolved, the strategy stays on Hold for operator reconciliation. A timeout does not prove that a trade failed."}</p>
              <p><a href="https://explorer.arc.io" target="_blank" rel="noreferrer">{lang === "zh" ? "Arc 主网浏览器" : "Arc mainnet explorer"}</a> · <a href="https://www.arcodex.fun/tokens" target="_blank" rel="noreferrer">{lang === "zh" ? "Arc 代币数据来源" : "Arc token data source"}</a></p>
            </div>
          </section>
          <section id="docs-robinhood" className="docs-section" hidden={article !== "docs-robinhood"}>
            <div className="docs-copy">
              <span className="eyebrow">ROBINHOOD MAINNET</span>
              <h3>Exact assets. USDG settlement.</h3>
              <p>Stock-token order marks use fresh issuer USD quotes adjusted once by the verified on-chain token multiplier, then converted to USDG. Trading halts, paused token oracles and stale prices block execution. A valuation is not a swap quote: the actual route is checked separately before trading.</p>
              <p>When Robinhood is enabled, use USDG for payments and trading capital, and keep ETH for network fees. Wallet funding lets you review an ETH-to-USDG swap before signing. Changing appearance never changes your network.</p>
              <ul>
                <li>Choose the token by its name and contract. Route available is selected by default and checks run automatically. A catalog listing is not a promise of liquidity; the actual order is quoted again before execution.</li>
                <li>Charts use the actual token’s DEX prices in USD. Trading levels and settlement use USDG with a fresh conversion. A stock token’s price must not be replaced with the underlying share price.</li>
                <li>A Global research report does not authorize a trade. Valid trigger, TP and SL levels carry into Spot, including manual trades opened with risk acceptance from low-confidence reports. On Robinhood, these are rebased to a fresh token/USDG price, preserving the report’s percentage distances from its reference price. Review the labelled adjusted levels before signing; they are not the original research prices. Invalid or missing protection levels must be configured manually.</li>
                <li>Autopilot requires sufficient closed-candle history, a verified route, your signed risk policy and an active Entry Pass. A failed entry condition means Hold, not an automatic paid AI call.</li>
                <li>Risk Guard distinguishes issuer stock tokens, USDG and wrapped ETH. Missing provider evidence stays unknown; market capitalization and an issuer listing do not establish safety.</li>
              </ul>
              <p>Availability is checked independently for each feature. If automated execution is paused or unavailable, do not repeatedly fund or pay to bypass it. Owner withdrawals remain subject to the account’s on-chain controls.</p>
            </div>
          </section>
          <section id="docs-start" className="docs-section hero-doc" hidden={article !== "docs-start"}>
            <div>
              <span className="eyebrow">QUICK START</span>
              <h3>From question to controlled action</h3>
              <p>
                PULSE separates evidence, payment and execution. A Global report
                can provide a conditional setup to load into Spot; it never
                broadcasts a transaction. Autopilot starts independently and
                evaluates its own entry signals after activation.
              </p>
              <div className="docs-journey">
                <b>Choose market</b>
                <i>→</i>
                <b>Preview live data</b>
                <i>→</i>
                <b>Optional report</b>
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
                Pro reports map wave-consistent continuation, correction
                and invalidation paths—not generic up/side/down guesses.
              </small>
            </div>
          </section>

          <section id="docs-catalog" className="docs-section" hidden={article !== "docs-catalog"}>
            <div className="docs-copy">
              <span className="eyebrow">MARKET DISCOVERY</span>
              <h3>Find assets with a verified route on your network</h3>
              <p>Global Market, Spot Trading and Autopilot open their pair pickers with <b>Route available</b> selected. Checks run automatically across the mapped catalog, including offscreen rows. Results appear as checks finish, with progress showing how many mapped pairs have been checked.</p>
              <ul>
                <li>Combine route availability with All, Crypto, Tokenized stock, Tokenized ETF or RWA and search. Category counts describe the catalog; visible results also depend on route status and search.</li>
                <li>Choose <b>All assets</b> to inspect unchecked or unavailable candidates. Global also includes unmapped research-only markets. Verified routes appear first. A listing or token mapping alone does not prove a route.</li>
                <li>Routes belong to the selected network and execution mode. Switching networks checks that network independently. An empty category means no matching route has been verified; try All assets to inspect the broader catalog.</li>
                <li><b>Route available · OKX</b> means an indicative OKX quote succeeded. <b>No OKX route found</b> does not establish that every provider lacks liquidity. Failed provider checks remain unknown, are retried and do not qualify for this filter.</li>
                <li>Your actual order amount is quoted again before signing. Autopilot also requires usable price history, an authorized policy and activation. Browsing or selecting a pair never places a trade.</li>
                <li>Robinhood Autopilot prefers the token’s own completed DEX history. Where that history is sparse, a registry-verified reference market can supply strategy signals. Setup names the source and commits it in your signed policy; existing strategies never switch silently. Orders and TP/SL use fresh prices and quotes for the actual Robinhood token in USDG, not an assumed executable reference price.</li>
              </ul>
              <p>Stock, ETF and RWA coverage varies by chain, verified representation and liquidity. Catalog additions use reviewed contract metadata. Coinbase supports the existing funding flow; general Coinbase Spot and Autopilot routing is deferred.</p>
              <p>Free technical candidates use market candles, not paid AI screening. Technical match scores are separate from report confidence. Recent bullish reports above 60% use your existing reports. A low-confidence report can still lead to a manually reviewed Spot trade at your discretion.</p>
              <p>Spot navigation separates Trade setup and Dashboard. Autopilot separates Create new Autopilot, Edit Autopilot, Dashboard and On-chain activity. Editing loads the selected vault's settings; save and restart shows confirmation progress and reuses existing funds and a valid pass.</p>
            </div>
          </section>
          <section id="docs-global" className="docs-section" hidden={article !== "docs-global"}>
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
                  Select a timeframe. Free market data loads automatically;
                  the compact chart remains visible and expands on demand.
                </li>
                <li>
                  Choose Quick for concise context or Pro for chart structure
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
                  Global Market intelligence has its own Global → Spot path:
                  a Quick or Pro report can prefill a ticket, while direct Spot
                  configuration remains available. Autopilot has a separate Configure → Fund &amp;
                  protect → Activate path and never requires a Global report.
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
              <strong>ETH-USDT · 4H · Pro</strong>
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

          <section id="docs-global-flow" className="docs-deep-dive" hidden={article !== "docs-global-flow"}>
            <div className="docs-deep-head">
              <span className="eyebrow">
                GLOBAL MARKET · TIMEFRAME &amp; HANDOFF
              </span>
              <h3>One selection follows the report into execution</h3>
              <p>
                The timeframe picker follows your chosen appearance, independently
                of the selected network, while preserving the same candle
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
                <b>Quick / Pro report</b>
              </div>
              <i>→</i>
              <div>
                <small>CHOOSE</small>
                <b>Market or Limit</b>
              </div>
            </div>
            <div className="docs-callout">
              <b>What is carried forward</b>
              <span>
                Pair, timeframe, Buy/Wait decision, entry condition, take
                profit, stop loss, analysis snapshot and selected RPC context.
                Spot re-checks token identity, live route and wallet balance.
                Autopilot is configured separately: it does not inherit the report's
                recommendation or use that report as its live entry signal.
              </span>
            </div>
          </section>

          <section id="docs-prediction" className="docs-section" hidden={article !== "docs-prediction"}>
            <span className="docs-number">02</span>
            <div className="docs-copy">
              <span className="eyebrow">PREDICTION MARKET</span>
              <h3>Analyze one explicitly selected live question</h3>
              <p>
                PULSE keeps market probability evidence separate from the
                referenced asset’s price chart. Pro adds an independent 4H
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

          <section id="docs-safety" className="docs-section" hidden={article !== "docs-safety"}>
            <span className="docs-number">03</span>
            <div className="docs-copy">
              <span className="eyebrow">RISK GUARD</span>
              <h3>Separate raw evidence from a complete risk report</h3>
              <ol>
                <li>
                  Select X Layer, Base, Arbitrum, Robinhood or Arc Mainnet in Network &amp;
                  Payment.
                </li>
                <li>
                  Browse that network’s token catalog or paste a verified
                  contract address.
                </li>
                <li>
                  View raw RPC contract evidence for free, or buy the $0.20
                  Token Risk report for a sourced Grok assessment.
                </li>
                <li>
                  The paid report uses OKX API on X Layer, Blockscout API on
                  Base/Arbitrum/Robinhood and GeckoTerminal for market, website, X-profile
                  and provider-rating observations. Robinhood also checks RPC evidence, Sourcify and the official stock registry. Social links alone do not establish promotion activity; unavailable sources remain unknown.
                </li>
                <li>
                  If you have exact calldata, optionally simulate it without broadcasting.
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
                <span>X Layer · Base · Arbitrum · Robinhood · Arc</span>
              </div>
              <i>→</i>
              <div>
                <small>2 · TOKEN RISK · $0.20</small>
                <b>Provider evidence + Grok</b>
                <span>Score · sources · risks · unknowns</span>
              </div>
              <i>→</i>
              <div>
                <small>3 · EXACT ACTION</small>
                <b>Simulate calldata</b>
                <span>No broadcast</span>
              </div>
            </div>
          </section>

          <section id="docs-spot" className="docs-section" hidden={article !== "docs-spot"}>
            <span className="docs-number">04</span>
            <div className="docs-copy">
              <span className="eyebrow">SPOT TRADING</span>
              <h3>Choose a pair directly—or execute a report setup</h3>
              <p data-no-localize>{lang === "zh" ? "候选卡片自动显示 OKX 价格和近期迷你走势图。点击图表可放大查看并切换周期，不会更改交易单。点击“交易此币对”后，所选币对的价格、24 小时涨跌幅、最高价、最低价、成交额和 K 线将显示在交易单上方。市场面板可见时每 30 秒更新。参考行情不等于链上可执行报价；Quick/Pro 研究报告仍是独立的分析服务。" : "Shortlist cards automatically show the OKX price and a recent-price chart. Click a chart to enlarge it and change timeframe without changing your ticket. Trade this pair loads the selected market's price, 24-hour change, high, low, volume and candles above the order form. The market panel refreshes every 30 seconds while visible. Reference data is not an executable on-chain quote; Quick/Pro research remains a separate analysis service."}</p>
              <p>
                PULSE resolves each analysis asset to a verified chain
                representation, checks balances, proves a live OKX Onchain OS
                route and keeps final approval in your wallet. Examples include
                BTC→cbBTC and DOGE→cbDOGE on Base, or ETH→WETH. Base and
                Arbitrum settle in native USDC; X Layer settles in USDT0. If no
                identity-safe representation exists, PULSE checks the other
                supported networks and does not invent one.
              </p>
              <p>
                Current Base routes include ZEC to cbZEC, HYPE to cbHYPE, and
                the OKX XNVDA, XMETA, XAAPL and XGOOGL analysis instruments to
                Coinbase&apos;s NVDAc, METAc, AAPLc and GOOGLc tokens. Each one
                remains disabled until its exact USDC route passes a fresh
                quote. PAXG and XAUT are analysis-only while no verified route
                exists on X Layer, Base or Arbitrum.
              </p>
              <p>
                On X Layer and Arbitrum, PULSE maps a live OKX category-3
                X-ticker analysis instrument to the matching ticker-x token
                only when the OKX chain catalog identifies it as an xStock.
                Seeing a token in the pair selector proves representation, not
                liquidity: Market, Limit and Autopilot still require a fresh
                amount-sized route quote, so availability can differ by chain.
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
                  For Market, choose Get quote to review buy/sell or Get live
                  quote. This first action only quotes your entered amount.
                  Inspect output, price impact and slippage, then choose Review
                  buy/sell in wallet. PULSE refreshes the route before approval.
                </li>
                <li>
                  For Limit, confirm the buy trigger and minimum received.
                  Enable or edit integrated TP/SL if wanted.
                </li>
                <li>
                  If first-time account setup is needed, PULSE explains the
                  extra signature. It never asks you to paste a contract address
                  or convert token amounts yourself.
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

          <section id="docs-spot-examples" className="docs-deep-dive" hidden={article !== "docs-spot-examples"}>
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
                    Spend is shown in USDT0, with conversion handled automatically.
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

          <section id="docs-spot-troubleshoot" className="docs-deep-dive" hidden={article !== "docs-spot-troubleshoot"}>
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

          <section id="docs-auto" className="docs-section" hidden={article !== "docs-auto"}>
            <span className="docs-number">05</span>
            <div className="docs-copy">
              <span className="eyebrow">AUTOPILOT</span>
              <h3>Six clear setup steps; one runtime dashboard</h3>
              <p>
                Choose the market and timeframe, a familiar strategy preset, and
                the capital/risk profile. PULSE resolves tokens, verifies the
                route, calculates human-sized limits, checks for an existing
                owner-controlled strategy account and guides the required wallet
                confirmations as one flow. Amounts use readable token units;
                verified contract addresses remain available under Technical proof.
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

          <section id="docs-auto-capital" className="docs-deep-dive" hidden={article !== "docs-auto-capital"}>
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

          <section id="docs-auto-rules" className="docs-deep-dive" hidden={article !== "docs-auto-rules"}>
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
              <p>
                Robinhood setup checks both buy and sell quotes against your
                selected vault tolerance before funding or payment. Every entry
                checks the bounded sell route again before buying. These checks
                do not guarantee future liquidity: TP/SL exits still require a
                fresh executable route, the signed limits and contract simulation.
                Open-position protection does not request another AI signal.
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
                  <b>Sell when any passes:</b> TP, SL, a previously triggered
                  partial exit, or close below SMA20.
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
                  <b>Sell when any passes:</b> TP, SL, a previously triggered
                  partial exit, or close below SMA20.
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
                  <b>Sell when any passes:</b> TP, SL, a previously triggered
                  partial exit, or price reaches SMA20.
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
                runtime state into Running, Paused, Exit protection only, Entry
                pass expired, Entry confirmations used, or Runtime unavailable.
                PASS means the observed market value met that signed rule. WAIT
                means it did not. Buy requires every entry row to pass; Sell
                needs one exit row. Hold never sends a transaction. A filled row
                includes the evidence hash and explorer transaction. Strategy
                decisions are separate from wallet/on-chain activity, and Export
                CSV activity joins every available row from both streams for
                auditing. Its first row is a current runtime
                snapshot with network, pass expiry and confirmation counters, so
                a registered strategy is never mistaken for a running vault.
              </span>
            </div>
            <div className="docs-callout">
              <b>{lang === "zh" ? "完整历史与有用的诊断" : "Complete history and useful diagnostics"}</b>
              <span>{lang === "zh" ? "历史不限制在 100 条。使用结果筛选和搜索，展开每次决策查看条件、观测值、AI 可用性及保存的风险设置。CSV 导出所有可用记录，不限于当前页。重复 K 线跳过和保护检查有独立计数，不会冒充新的 AI 分析。旧系统已删除的记录会明确标注缺失；储存故障会显示同步状态。" : "History is not capped at 100. Filter by outcome, search the reason and expand a decision for its rules, observed values, AI eligibility and saved risk settings. CSV exports all available records, not just the current page. Repeated-candle skips and protection checks have separate counters; they are not new AI analyses. Discarded legacy records are explicitly marked missing, and storage interruptions show their sync status."}</span>
            </div>
            <div className="docs-callout">
              <b>{lang === "zh" ? "自动驾驶市场行情" : "Autopilot market context"}</b>
              <span>{lang === "zh" ? "候选卡片、市场设置与所选自动驾驶仪表板均提供 OKX 行情图。点击展开，切换周期或缩放。可见行情每 30 秒更新，不消耗 AI 次数；图表可能含未收盘 K 线，而入场决策仅使用已收盘 K 线。" : "Shortlist cards, market setup and the selected Autopilot dashboard include OKX market charts. Expand to change timeframe or zoom. Visible snapshots refresh every 30 seconds without consuming AI confirmations. Charts can include an open candle; entry decisions use closed candles only."}</span>
            </div>
            <div className="docs-callout">
              <b>Opportunity Radar</b>
              <span>
                Global Market, empty Spot and Autopilot can display the same
                read-only OKX candle shortlist, but the actions are different.
                On Autopilot, Use for Autopilot only prefills pair, timeframe
                and strategy; Open Global analysis starts its separate Quick/Pro report flow.
                Neither action starts a vault. The deterministic setup, compact
                AI confirmation, token identity, selected-network route, owner
                capital and active pass must still pass.
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
                Before submission, unavailable dependencies prevent a new trade.
                After submission, a timeout does not prove failure: PULSE reconciles
                the transaction before attempting another trade. Every xAI attempt is
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

          <section id="docs-auto-example" className="docs-deep-dive" hidden={article !== "docs-auto-example"}>
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
                The Strategy journal shows every PASS/WAIT rule. Buy broadcasts
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

          <section id="docs-pay" className="docs-section" hidden={article !== "docs-pay"}>
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
                  <b>Arc Mainnet</b>
                  <span>USDC · Circle Gateway</span>
                </div>
                <div>
                  <b>Robinhood Chain</b>
                  <span>USDG · PULSE self-hosted x402 · opt-in rollout</span>
                </div>
              </div>
              <p>
                Always confirm the selected network, payment asset, exact price
                and wallet account before signing.
              </p>
              <div className="docs-callout">
                <b>Robinhood: research payments and funding</b>
                <span>When enabled, Global Quick/Pro, Prediction Quick/Pro and Risk Guard use USDG on Robinhood mainnet. Wallet &amp; funding offers an ETH → USDG quote, shows the minimum received, then simulates before your wallet signs. Keep ETH for gas. Dawn changes appearance, not the network. Wallet Spot, Limit/protection and Autopilot have separate readiness checks; wallet swaps can remain available while automated execution is paused. Follow the selected feature's availability message before funding or paying.</span>
              </div>
              <div className="docs-glossary payment-price-grid">
                <div><b>Global Quick</b><span>$0.20 per report</span></div>
                <div><b>Global Pro</b><span>$0.30 per report</span></div>
                <div><b>Prediction Quick</b><span>$0.20 per report</span></div>
                <div><b>Prediction Pro</b><span>$0.30 per report</span></div>
                <div><b>Token Risk Guard</b><span>$0.20 per report</span></div>
                <div><b>Autopilot · 24h</b><span>$1.50 per vault</span></div>
                <div><b>Autopilot · 7d</b><span>$10.50 per vault</span></div>
                <div><b>Autopilot · 30d</b><span>$45.00 per vault</span></div>
              </div>
              <div className="docs-callout">
                <b>Pass paid, but Resume rejected?</b>
                <span>Purchased time stays with the paid vault. Select it and use Resume; do not buy another pass to retry activation. Dashboard renewal automatically prompts Resume for a paused vault after payment. A running vault needs no extra Resume transaction. None of these passes auto-renews.</span>
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

          <section id="docs-agents" className="docs-deep-dive" hidden={article !== "docs-agents"}>
            <div className="docs-deep-head">
              <span className="eyebrow">AGENTS &amp; API</span>
              <h3>Discover eight services on every supported execution mainnet</h3>
              <p>
                X Layer, Base, Arbitrum and enabled Robinhood deployments expose five analysis/risk services
                plus three duration-specific Autopilot start services. Global
                Spot and Autopilot contract calls remain owned and confirmed by
                the caller&apos;s Agentic Wallet. Circle/Arc exposes only the five
                analysis/risk services because execution is unavailable there.
              </p>
            </div>
            <div className="docs-agent-flow" aria-label="Agent service workflow">
              <div><small>1 · DISCOVER</small><b>Choose one PULSE service</b></div>
              <i>→</i>
              <div><small>2 · REQUEST</small><b>Send typed market or risk input</b></div>
              <i>→</i>
              <div><small>3 · SETTLE</small><b>Pay the x402 challenge</b></div>
              <i>→</i>
              <div><small>4 · CONTINUE</small><b>Recover the report or resume the paid vault</b></div>
            </div>
            <div className="docs-agent-services">
              <article><b>Global Quick → Spot Market or Limit</b><span>$0.20 · concise plan, then Agentic Wallet execution</span></article>
              <article><b>Global Pro → Spot Market or Limit</b><span>$0.30 · deeper chart and Elliott plan, then Agentic Wallet execution</span></article>
              <article><b>Prediction Quick</b><span>$0.20 · selected-market evidence</span></article>
              <article><b>Prediction Pro</b><span>$0.30 · deeper evidence and 4H underlying chart</span></article>
              <article><b>Token Risk Guard</b><span>$0.20 · OKX/Blockscout + GeckoTerminal evidence, Grok score</span></article>
              <article><b>Start Autopilot · 24h</b><span>$1.50 · six-step owner-wallet setup and active runtime</span></article>
              <article><b>Start Autopilot · 7d</b><span>$10.50 · same workflow for seven active-runtime days</span></article>
              <article><b>Start Autopilot · 30d</b><span>$45.00 · same workflow for 30 active-runtime days</span></article>
            </div>
            <div className="docs-agent-channels">
              <article>
                <span>OKX.AI · X LAYER</span>
                <h4>PULSE agent #8355</h4>
                <p>
                  PULSE's X Layer catalog contains eight services paid in
                  USDT0. Agentic Wallet owns and confirms Spot and
                  Autopilot calls. Base and Arbitrum do not require a second
                  copy of this ERC-8004 identity.
                </p>
                <a href="https://www.okx.ai/agents/8355" target="_blank" rel="noreferrer">Open PULSE agent #8355 ↗</a>
                <code>/xlayer/v1/analysis/spot/premium</code>
              </article>
              <article>
                <span>CDP BAZAAR · MAINNET</span>
                <h4>Base and Arbitrum discovery</h4>
                <p>
                  The same eight services are advertised under the selected
                  network prefix with typed schemas. Agentic Wallet signs Spot
                  and Autopilot contract calls; payment uses native USDC.
                </p>
                <code>/base/... · /arbitrum/...</code>
              </article>
              <article>
                <span>CIRCLE · ARC MAINNET</span>
                <h4>Circle Agent Marketplace</h4>
                <p>
                  The Arc listing settles PULSE research services in USDC through
                  Circle Gateway. Spot and Autopilot become available after
                  verified mainnet deployment, route checks and trading activation.
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

          <section id="docs-recover" className="docs-section" hidden={article !== "docs-recover"}>
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
                  In Portfolio, expand <b>Recover wallet-owned reports</b> and choose Global or Prediction. The same <b>Paid report history</b> is also available inside each research workspace.
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
              <p>The application home is <b>app.ai-pulse.tech/portfolio</b>. If you move from the public-site origin, reconnect the paying wallet; do not repurchase. Device-only recovery handles remain on the original browser/origin. <a href="https://www.ai-pulse.tech/portfolio?legacyRecovery=1#reports" rel="noreferrer">Open original-site report recovery</a>.</p>
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

          <section id="docs-telegram" className="docs-section" hidden={article !== "docs-telegram"}>
            <span className="docs-number">09</span>
            <div className="docs-copy">
              <span className="eyebrow">TELEGRAM</span>
              <h3>One PULSE bot. Chat research and a TON Mini App.</h3>
              <p>Open <a href="https://t.me/pulsemi_bot?start=docs" rel="noreferrer">@pulsemi_bot</a> and press Start. Choose a service in the private chat, send the requested pair, token contract or prediction market, then approve its Stars invoice. PULSE sends the summary and complete report document to this chat. Opening a menu or selecting a service does not charge you.</p>
              <ul>
                <li><b>Global Quick:</b> 10 Stars. <b>Global Pro:</b> 15 Stars.</li>
                <li><b>Risk Guard:</b> 15 Stars.</li>
                <li><b>Prediction Quick:</b> 10 Stars. <b>Prediction Pro:</b> 15 Stars.</li>
              </ul>
              <p><b>My reports</b> recovers chat and TON Mini App purchases using your Telegram account, including on another device. If a report is still generating, recover its existing order rather than buying it again. Use <b>/paysupport</b> for a purchase issue and include the order ID.</p>
              <p><b>History wallet</b> links your existing EVM wallet to this Telegram account. Prove ownership once in your browser, return to PULSE chat and confirm the exact address. Paid history from the website or mobile wallet browser then appears in chat. This association survives browser disconnects, closing Telegram and changing devices; it lasts until you explicitly change or unlink it. Reading history needs no transaction or chain switch.</p>
              <p><b>Open PULSE Mini App</b> launches the TON workspace from this same bot. It offers TON-USDT Global Quick and Pro, Stars checkout and an optional TON Connect wallet connection. The Mini App shows TON research; all of its purchases are also available in PULSE chat. Connecting a TON wallet does not replace your EVM history association.</p>
              <div className="docs-callout"><b>Keep your research close</b><span>Use /reports, /wallet and /miniapp, or the matching menu buttons. Stars buy research. Wallet connection does not authorize a trade. The full PULSE platform is at <a href="https://www.ai-pulse.tech" rel="noreferrer">www.ai-pulse.tech</a>.</span></div>
              <p><a href="/telegram">Explore PULSE in Telegram</a> · <a href="https://t.me/pulsemi_bot?startapp" rel="noreferrer">Open its TON Mini App</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

}
