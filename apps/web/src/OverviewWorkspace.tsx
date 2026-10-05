import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SavedResearchDialog } from "./SavedResearchDialog";
import { ReportHistory } from "./ReportHistory";
import { reportTierLabel } from "./reportLabels";
import "./portfolio.css";
import { formatUnits } from "viem";
import { apiGet } from "./api";
import { aggregateAutopilotMetrics } from "./dashboardMetrics";
import { spotTradePerformance, type PerformanceFill } from "./tradePerformance";
import { listJobRecoveries, type JobRecoveryHandle } from "./jobRecovery";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";
import type { Lang } from "./i18n";
import type { PulseTab } from "./navigation";

type OverviewActivity = PerformanceFill & {
  id: string;
  source: string;
  kind: string;
  status: string;
  pair?: string;
  executionPair?: string;
  createdAt: string;
};

type OverviewOrder = {
  id: string;
  instId: string;
  status: string;
  currentPrice?: number;
  phase?: "entry" | "protected" | "complete";
  version?: "oco-v1" | "limit-v2" | "bracket-v1";
  estimatedPnlPct?: number | null;
  realizedPnlPct?: number | null;
};

type OverviewStrategy = {
  id: string;
  vault: string;
  pair: string;
  timeframe: string;
  status: string;
  runtimeState?: string;
  paused?: boolean;
  lastDecision?: string;
  lastRunAt?: string;
  lastError?: string;
  portfolioValueAtomic?: string;
  baselineValueAtomic?: string;
  pnlBasisAtomic?: string;
  pnlAtomic?: string | null;
  pnlCashFlow?: { state: string; progressPct: number; detail: string };
  settlementDecimals?: number;
  settlementSymbol?: string;
  aiPass?: {
    expiresAt: string;
    signalLimit: number;
    signalsUsed: number;
    pausedAt?: string;
  } | null;
};

type Copy = {
  eyebrow: string;
  title: string;
  lead: string;
  refresh: string;
  refreshing: string;
  openOrders: string;
  pendingAndProtected: string;
  autopilots: string;
  running: string;
  spotSummary: string;
  spotSummaryLead: string;
  autopilotSummary: string;
  autopilotSummaryLead: string;
  autopilotValue: string;
  autopilotPnl: string;
  cashFlowAdjusted: string;
  markToMarket: string;
  spotOpenPnl: string;
  spotRealizedPnl: string;
  averageKnown: string;
  awaitingBasis: string;
  strategiesLabel: string;
  attention: string;
  connectBody: string;
  notConnected: string;
  apiOffline: string;
  syncProblem: string;
  pendingTransactions: string;
  strategyFailures: string;
  passExpired: string;
  passExpiring: string;
  recentActivity: string;
  recentActivityLead: string;
  noActivity: string;
  noActivityBody: string;
  viewSpot: string;
  runtime: string;
  runtimeLead: string;
  noStrategies: string;
  noStrategiesBody: string;
  configure: string;
  runningLabel: string;
  pausedLabel: string;
  protectionLabel: string;
  expiredLabel: string;
  inactiveLabel: string;
  lastDecision: string;
  pass: string;
  timerHeld: string;
  remaining: string;
  savedReports: string;
  savedReportsLead: string;
  totalReports: string;
  globalReports: string;
  predictionReports: string;
  noReports: string;
  noReportsBody: string;
  globalReport: string;
  predictionReport: string;
  arcExecution: string;
  statusEyebrow: string;
  walletContracts: string;
  ownerControlled: string;
  recoverableResearch: string;
};

const COPY: Record<Lang, Copy> = {
  en: {
    eyebrow: "PORTFOLIO · ACTIVITY · RESEARCH",
    title: "Your PULSE portfolio",
    lead: "Spot orders, autonomous strategies and saved research—separate views of your activity on the selected network.",
    refresh: "Refresh portfolio",
    refreshing: "Refreshing…",
    openOrders: "Open Spot orders",
    pendingAndProtected: "pending entries and protected positions",
    autopilots: "Autopilots",
    running: "running",
    spotSummary: "Spot trading",
    spotSummaryLead: "Orders and performance with a verified entry basis.",
    autopilotSummary: "Autopilot",
    autopilotSummaryLead: "Owner-controlled strategies and marked vault capital.",
    autopilotValue: "Autopilot portfolio",
    autopilotPnl: "Autopilot P&L",
    cashFlowAdjusted: "cash-flow adjusted",
    markToMarket: "settlement balance plus marked invested assets",
    spotOpenPnl: "Open Spot P&L",
    spotRealizedPnl: "Realized Spot P&L",
    averageKnown: "matched execution cost basis · excluding gas",
    awaitingBasis: "awaiting a verified entry and capital basis",
    strategiesLabel: "strategies",
    attention: "Needs attention",
    connectBody: "Connect the wallet that owns your orders and Autopilot vaults to load its private operating overview.",
    notConnected: "Not connected",
    apiOffline: "PULSE API is currently offline.",
    syncProblem: "Some wallet activity could not be refreshed.",
    pendingTransactions: "pending wallet or contract transactions",
    strategyFailures: "Autopilot strategies reporting a failure",
    passExpired: "Autopilot entry passes need renewal",
    passExpiring: "active Autopilot passes expire within six hours",
    recentActivity: "Recent activity",
    recentActivityLead: "Latest wallet and contract events on the selected network.",
    noActivity: "No activity yet",
    noActivityBody: "Spot confirmations and Autopilot actions will appear here after they occur.",
    viewSpot: "Open Spot activity",
    runtime: "Autopilot runtime",
    runtimeLead: "Current strategy state, decision and AI Entry Pass.",
    noStrategies: "No Autopilot on this network",
    noStrategiesBody: "Create an owner-controlled strategy when you want PULSE to evaluate a market within signed limits.",
    configure: "Open Autopilot",
    runningLabel: "Running",
    pausedLabel: "Paused",
    protectionLabel: "Protecting position",
    expiredLabel: "Entry pass expired",
    inactiveLabel: "Inactive",
    lastDecision: "Last decision",
    pass: "AI Entry Pass",
    timerHeld: "Timer held while paused",
    remaining: "remaining",
    savedReports: "Reports on this device",
    savedReportsLead: "Recovery handles for paid Global and Prediction reports.",
    totalReports: "Total reports",
    globalReports: "Global Market",
    predictionReports: "Prediction Market",
    noReports: "No saved reports yet",
    noReportsBody: "Reports purchased in this browser will be recoverable here without paying again.",
    globalReport: "Global report",
    predictionReport: "Prediction report",
    arcExecution: "Arc mainnet Spot and Autopilot availability depends on verified deployments and live routes.",
    statusEyebrow: "STATUS",
    walletContracts: "WALLET & CONTRACTS",
    ownerControlled: "OWNER CONTROLLED",
    recoverableResearch: "RECOVERABLE RESEARCH",
  },
  zh: {
    eyebrow: "资产 · 活动 · 研究",
    title: "你的 PULSE 资产总览",
    lead: "先查看当前网络、钱包、报告、现货活动和 Autopilot 运行状态，再选择下一步。",
    refresh: "刷新概览",
    refreshing: "正在刷新…",
    openOrders: "未结束的现货订单",
    pendingAndProtected: "待成交订单和受保护仓位",
    autopilots: "Autopilot 策略",
    running: "正在运行",
    spotSummary: "现货交易",
    spotSummaryLead: "订单以及具有已验证入场依据的交易表现。",
    autopilotSummary: "Autopilot",
    autopilotSummaryLead: "所有者控制的策略和按市价计算的金库资金。",
    autopilotValue: "Autopilot 资产总值",
    autopilotPnl: "Autopilot 盈亏",
    cashFlowAdjusted: "已按资金流调整",
    markToMarket: "结算余额加按市价计算的已投资资产",
    spotOpenPnl: "现货未实现盈亏",
    spotRealizedPnl: "现货已实现盈亏",
    averageKnown: "仅计算具有已验证入场依据的仓位平均值",
    awaitingBasis: "等待已验证的入场和资金依据",
    strategiesLabel: "个策略",
    attention: "需要处理",
    connectBody: "连接拥有订单和 Autopilot 金库的钱包，以加载其私有运行概览。",
    notConnected: "未连接",
    apiOffline: "PULSE API 当前离线。",
    syncProblem: "部分钱包活动暂时无法刷新。",
    pendingTransactions: "笔钱包或合约交易仍在等待确认",
    strategyFailures: "个 Autopilot 策略报告错误",
    passExpired: "个 Autopilot 入场通行证需要续期",
    passExpiring: "个有效 Autopilot 通行证将在六小时内到期",
    recentActivity: "最近活动",
    recentActivityLead: "当前网络最新的钱包和合约事件。",
    noActivity: "暂无活动",
    noActivityBody: "现货确认和 Autopilot 操作发生后会显示在这里。",
    viewSpot: "打开现货活动",
    runtime: "Autopilot 运行状态",
    runtimeLead: "当前策略状态、最近决策和 AI 入场通行证。",
    noStrategies: "当前网络没有 Autopilot",
    noStrategiesBody: "需要 PULSE 在签名限制内评估市场时，可创建所有者控制的策略。",
    configure: "打开 Autopilot",
    runningLabel: "运行中",
    pausedLabel: "已暂停",
    protectionLabel: "仅保护仓位",
    expiredLabel: "入场通行证已到期",
    inactiveLabel: "未运行",
    lastDecision: "最近决策",
    pass: "AI 入场通行证",
    timerHeld: "暂停期间计时停止",
    remaining: "剩余",
    savedReports: "此设备上的报告",
    savedReportsLead: "已付费全球市场和预测市场报告的恢复凭证。",
    totalReports: "报告总数",
    globalReports: "全球市场",
    predictionReports: "预测市场",
    noReports: "暂无已保存报告",
    noReportsBody: "在此浏览器购买的报告会显示在这里，无需再次付款即可恢复。",
    globalReport: "全球市场报告",
    predictionReport: "预测市场报告",
    arcExecution: "Arc 测试网不提供现货交易和 Autopilot；市场分析和风险卫士仍然可用。",
    statusEyebrow: "状态",
    walletContracts: "钱包与合约",
    ownerControlled: "所有者控制",
    recoverableResearch: "可恢复的研究报告",
  },
};

function safeReports(network: WebNetworkKey) {
  try {
    return [
      ...listJobRecoveries(localStorage, network, "spot").map((item) => ({ ...item, scope: "spot" as const })),
      ...listJobRecoveries(localStorage, network, "prediction").map((item) => ({ ...item, scope: "prediction" as const })),
    ].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  } catch {
    return [];
  }
}

function relativeTime(value: string | undefined, lang: Lang) {
  if (!value) return "—";
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "—";
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) return lang === "zh" ? "刚刚" : "just now";
  if (minutes < 60) return lang === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === "zh" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return lang === "zh" ? `${days} 天前` : `${days}d ago`;
}

function passLabel(strategy: OverviewStrategy, lang: Lang, copy: Copy) {
  const pass = strategy.aiPass;
  if (!pass) return lang === "zh" ? "未购买" : "Not purchased";
  if (strategy.paused || pass.pausedAt) return copy.timerHeld;
  const remainingMs = Date.parse(pass.expiresAt) - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return copy.expiredLabel;
  const hours = Math.ceil(remainingMs / 3_600_000);
  const time = hours < 48 ? `${hours}h` : `${Math.ceil(hours / 24)}d`;
  return `${time} ${copy.remaining} · ${pass.signalsUsed}/${pass.signalLimit}`;
}

function strategyState(strategy: OverviewStrategy, copy: Copy) {
  const state = strategy.runtimeState || (strategy.paused ? "paused" : strategy.status);
  if (state === "running") return { label: copy.runningLabel, className: "running" };
  if (state === "paused") return { label: copy.pausedLabel, className: "paused" };
  if (state === "protecting_position") return { label: copy.protectionLabel, className: "protecting" };
  if (state === "entry_pass_expired" || state === "entry_signals_exhausted") return { label: copy.expiredLabel, className: "warning" };
  return { label: copy.inactiveLabel, className: "inactive" };
}

function readableKind(value: string, lang: Lang) {
  if (lang === "zh") {
    const labels: Record<string, string> = {
      market_buy: "市价买入",
      market_sell: "市价卖出",
      limit_created: "限价单已创建",
      limit_fill: "限价单已成交",
      vault_buy: "Autopilot 买入",
      vault_sell: "Autopilot 卖出",
      vault_fund: "Autopilot 入金",
      vault_withdraw: "Autopilot 提取",
      vault_pause: "Autopilot 已暂停",
      vault_resume: "Autopilot 已恢复",
    };
    return labels[value] || value.replaceAll("_", " ");
  }
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readableStatus(value: string, lang: Lang) {
  if (lang !== "zh") return value;
  return ({ confirmed: "已确认", pending: "待确认", failed: "失败", reverted: "已回滚", cancelled: "已取消" } as Record<string, string>)[value] || value;
}

function reportLabel(report: JobRecoveryHandle & { scope: "spot" | "prediction" }, copy: Copy) {
  return report.label || (report.scope === "spot" ? copy.globalReport : copy.predictionReport);
}

function percentageLabel(value: number | null) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function OverviewWorkspace({
  networkKey,
  wallet,
  health,
  lang,
  onNavigate,
  onRefreshBalances,
}: {
  networkKey: WebNetworkKey;
  wallet: string | null;
  health: string;
  lang: Lang;
  onNavigate: (tab: PulseTab) => void;
  onRefreshBalances: () => Promise<void>;
}) {
  const copy = COPY[lang];
  const network = WEB_NETWORKS[networkKey];
  const [activityData, setActivity] = useState<OverviewActivity[]>([]);
  const [orderData, setOrders] = useState<OverviewOrder[]>([]);
  const [strategyData, setStrategies] = useState<OverviewStrategy[]>([]);
  const contextKey=`${networkKey}:${wallet?.toLowerCase() || ""}`;
  const [dataContext,setDataContext]=useState("");
  const activity=dataContext===contextKey?activityData:[];
  const orders=dataContext===contextKey?orderData:[];
  const strategies=dataContext===contextKey?strategyData:[];
  const request=useRef<AbortController|null>(null);
  const [openedReport,setOpenedReport]=useState<(JobRecoveryHandle & {scope:"spot"|"prediction";contextKey:string})|null>(null);
  const [loading, setLoading] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const reports = useMemo(() => safeReports(networkKey), [networkKey, refreshVersion]);

  const refresh = useCallback(async (includeWalletBalance = false) => {
    request.current?.abort();
    const controller=new AbortController(); request.current=controller;
    setRefreshVersion((value) => value + 1);
    if (!wallet) {
      setActivity([]);
      setOrders([]);
      setStrategies([]);
      setSyncError(false);
      setLoading(false);
      setDataContext(contextKey);
      return;
    }
    setLoading(true);
    const encodedWallet = encodeURIComponent(wallet);
    const timeout=setTimeout(()=>controller.abort(),20_000);
    try {
    const [history, orderResult, strategyResult] = await Promise.all([
      apiGet(`/v1/trading/activity?network=${networkKey}&address=${encodedWallet}`,{signal:controller.signal}),
      apiGet(`/v1/automation/orders?owner=${encodedWallet}&network=${networkKey}`,{signal:controller.signal}),
      apiGet(`/v1/autopilot/strategies?owner=${encodedWallet}&network=${networkKey}`,{signal:controller.signal}),
    ]);
    if(controller.signal.aborted || request.current!==controller) return;
    if (includeWalletBalance) await onRefreshBalances();
    if(controller.signal.aborted || request.current!==controller) return;
    setActivity(history.ok ? ((history.data as { activity?: OverviewActivity[] }).activity || []) : []);
    setOrders(orderResult.ok ? ((orderResult.data as { orders?: OverviewOrder[] }).orders || []) : []);
    setStrategies(strategyResult.ok ? ((strategyResult.data as { strategies?: OverviewStrategy[] }).strategies || []) : []);
    setSyncError(!history.ok || !orderResult.ok || !strategyResult.ok);
    setDataContext(contextKey);
    } catch { if(request.current===controller)setSyncError(true); }
    finally {clearTimeout(timeout);if(request.current===controller){setLoading(false);if(controller.signal.aborted)setSyncError(true);}}
  }, [networkKey, onRefreshBalances, wallet, contextKey]);

  useEffect(() => {
    void refresh(false);
    const timer = window.setInterval(() => void refresh(false), 60_000);
    return () => {window.clearInterval(timer);request.current?.abort();};
  }, [refresh]);
  useEffect(()=>{setOpenedReport(null);},[contextKey]);

  const openOrders = orders.filter((item) => item.status === "active" || item.status === "paused");
  const runningStrategies = strategies.filter((item) => {
    const state = item.runtimeState || (item.paused ? "paused" : item.status);
    return state === "running" || state === "protecting_position";
  });
  const pendingTransactions = activity.filter((item) => item.status === "pending").length;
  const failedStrategies = strategies.filter((item) => item.runtimeState === "failed" || item.runtimeState === "telemetry_unavailable" || Boolean(item.lastError)).length;
  const expiredPasses = strategies.filter((item) => item.runtimeState === "entry_pass_expired" || item.runtimeState === "entry_signals_exhausted" || (item.aiPass && !item.paused && Date.parse(item.aiPass.expiresAt) <= Date.now())).length;
  const expiringPasses = strategies.filter((item) => {
    if (!item.aiPass || item.paused || item.aiPass.pausedAt) return false;
    const remaining = Date.parse(item.aiPass.expiresAt) - Date.now();
    return remaining > 0 && remaining <= 6 * 3_600_000;
  }).length;
  const alerts = [
    health === "OFFLINE" ? copy.apiOffline : "",
    syncError ? copy.syncProblem : "",
    pendingTransactions ? `${pendingTransactions} ${copy.pendingTransactions}` : "",
    failedStrategies ? `${failedStrategies} ${copy.strategyFailures}` : "",
    expiredPasses ? `${expiredPasses} ${copy.passExpired}` : "",
    expiringPasses ? `${expiringPasses} ${copy.passExpiring}` : "",
  ].filter(Boolean);
  const recentActivity = activity.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6);
  const [libraryScope, setLibraryScope] = useState<"spot" | "prediction">("spot");
  const [restoredReport, setRestoredReport] = useState<{ report: Record<string, unknown>; scope: "spot" | "prediction"; contextKey: string } | null>(null);
  const aggregateAutopilot = aggregateAutopilotMetrics(strategies);
  const portfolioLabel = aggregateAutopilot.portfolioValueAtomic !== undefined
    ? `${Number(formatUnits(BigInt(aggregateAutopilot.portfolioValueAtomic), network.payment.decimals)).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 4 })} ${network.payment.symbol}`
    : null;
  const autopilotPnlAmount = aggregateAutopilot.pnlAtomic !== undefined
    ? Number(formatUnits(BigInt(aggregateAutopilot.pnlAtomic), network.payment.decimals))
    : null;
  const marks = Object.fromEntries(orders.filter(item => typeof item.currentPrice === "number" && item.currentPrice > 0).map(item => [item.instId, item.currentPrice!]));
  const spotPerformance = spotTradePerformance(activity, marks);
  const openSpotPnl = spotPerformance.openPnlPct;
  const realizedSpotPnl = spotPerformance.realizedPct;
  const executionAvailable = true;
  const globalReportCount = reports.filter((report) => report.scope === "spot").length;
  const predictionReportCount = reports.filter((report) => report.scope === "prediction").length;
  const allocation = strategies.map(strategy => {
    let value = NaN;
    try { if (strategy.portfolioValueAtomic != null && strategy.settlementDecimals != null) value = Number(formatUnits(BigInt(strategy.portfolioValueAtomic), strategy.settlementDecimals)); } catch { /* Malformed valuation is unavailable, not a broken Portfolio. */ }
    return { strategy, value };
  });
  const allocationReady=allocation.length>0 && allocation.every(item=>Number.isFinite(item.value) && item.value>=0 && item.strategy.settlementSymbol===network.payment.symbol);
  const allocationTotal=allocationReady ? allocation.reduce((sum,item)=>sum+item.value,0) : 0;

  useEffect(() => {
    if (window.location.hash !== "#reports" && new URLSearchParams(window.location.search).get("service") !== "reports") return;
    const frame = requestAnimationFrame(() => document.getElementById("reports")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="overview-workspace">
      <header className="overview-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow} · {network.label}</span>
          <h1>{lang === "zh" ? "资产总览" : "Portfolio"}</h1>
          <p>{copy.lead}</p>
        </div>
        <button type="button" className="overview-refresh" disabled={loading} onClick={() => void refresh(true)}>
          <span aria-hidden>↻</span>{loading ? copy.refreshing : copy.refresh}
        </button>
      </header>


      {executionAvailable && <div className="overview-domain-grid">
        <section className="card overview-domain-summary spot">
          <header className="overview-panel-head"><div><span className="eyebrow">{lang === "zh" ? "现货" : "SPOT"}</span><h3>{copy.spotSummary}</h3><p>{copy.spotSummaryLead}</p></div><button type="button" onClick={() => onNavigate("spot")}>{copy.viewSpot} →</button></header>
          <div className="overview-metrics">
            <button type="button" onClick={() => onNavigate("spot")}><span>{copy.openOrders}</span><strong>{wallet ? openOrders.length : "—"}</strong><small>{copy.pendingAndProtected}</small></button>
            <button type="button" onClick={() => onNavigate("spot")}><span>{copy.spotOpenPnl}</span><strong className={openSpotPnl === null ? undefined : openSpotPnl < 0 ? "negative" : "positive"}>{wallet ? percentageLabel(openSpotPnl) : "—"}</strong><small>{openSpotPnl === null ? copy.awaitingBasis : copy.averageKnown}</small></button>
            <button type="button" onClick={() => onNavigate("spot")}><span>{copy.spotRealizedPnl}</span><strong className={realizedSpotPnl === null ? undefined : realizedSpotPnl < 0 ? "negative" : "positive"}>{wallet ? percentageLabel(realizedSpotPnl) : "—"}</strong><small>{realizedSpotPnl === null ? copy.awaitingBasis : copy.averageKnown}</small></button>
          </div>
        </section>
        <section className="card overview-domain-summary autopilot">
          <header className="overview-panel-head"><div><span className="eyebrow">{copy.ownerControlled}</span><h3>{copy.autopilotSummary}</h3><p>{copy.autopilotSummaryLead}</p></div><button type="button" onClick={() => onNavigate("autopilot")}>{copy.configure} →</button></header>
          <div className="overview-metrics">
            <button type="button" onClick={() => onNavigate("autopilot")}><span>{copy.autopilots}</span><strong>{wallet ? strategies.length : "—"}</strong><small>{wallet ? `${runningStrategies.length} ${copy.running} · ${strategies.length} ${copy.strategiesLabel}` : copy.notConnected}</small></button>
            <button type="button" onClick={() => onNavigate("autopilot")}><span>{copy.autopilotValue}</span><strong>{wallet ? (portfolioLabel || "—") : "—"}</strong><small>{copy.markToMarket}</small></button>
            <button type="button" onClick={() => onNavigate("autopilot")}><span>{copy.autopilotPnl}</span><strong className={aggregateAutopilot.pnlPct === null ? undefined : aggregateAutopilot.pnlPct < 0 ? "negative" : "positive"}>{wallet ? percentageLabel(aggregateAutopilot.pnlPct) : "—"}</strong><small>{strategies.some(item => item.pnlCashFlow && item.pnlCashFlow.state !== "synced") ? (lang === "zh" ? "正在核验资金流；查看自动驾驶中的进度" : "Cash-flow verification pending · see Autopilot for details") : autopilotPnlAmount === null ? copy.awaitingBasis : `${autopilotPnlAmount >= 0 ? "+" : ""}${autopilotPnlAmount.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 4 })} ${network.payment.symbol} · ${copy.cashFlowAdjusted}`}</small></button>
          </div>
        </section>
      </div>}

      {wallet && alerts.length > 0 && <aside className="card overview-attention has-alerts">
          <span className="eyebrow">{copy.statusEyebrow}</span>
          <div className="attention-symbol warning">!</div>
          <h3>{copy.attention}</h3>
          <ul>{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul>
        </aside>}

      {wallet && allocationReady && allocationTotal>0 && <section className="card portfolio-allocation" aria-label={lang==="zh"?"自动驾驶资金分配":"Autopilot capital allocation"}>
        <header><div><span className="eyebrow">{network.label} · {lang==="zh"?"已注册自动驾驶":"REGISTERED AUTOPILOTS"}</span><h3>{lang==="zh"?"资金分配":"Where your Autopilot capital sits"}</h3></div><span>{allocationTotal.toLocaleString(lang==="zh"?"zh-CN":"en-US",{maximumFractionDigits:4})} {network.payment.symbol}</span></header>
        <div className="allocation-bar" aria-hidden>{allocation.filter(item=>item.value>0).map(({strategy,value},index)=><span key={strategy.vault} style={{flexGrow:value/allocationTotal,background:`var(--allocation-${index%4})`}}/>)}</div>
        <ul>{allocation.filter(item=>item.value>0).map(({strategy,value},index)=><li key={strategy.vault}><i aria-hidden style={{background:`var(--allocation-${index%4})`}}/><span>{strategy.pair}<small>{strategy.vault.slice(0,6)}…{strategy.vault.slice(-4)}</small></span><strong>{value.toLocaleString(lang==="zh"?"zh-CN":"en-US",{maximumFractionDigits:4})} {network.payment.symbol}<small>{(value/allocationTotal*100).toFixed(1)}%</small></strong></li>)}</ul>
        <p>{lang==="zh"?"所选网络已注册账户的当前参考估值；不是收益或整个钱包的余额。":"Current reference valuation of registered accounts on this network—not profit or your entire wallet balance."}</p>
      </section>}

      {executionAvailable && <div className="overview-detail-grid">
        <section className="card overview-panel">
          <header className="overview-panel-head">
            <div><span className="eyebrow">{copy.walletContracts}</span><h3>{copy.recentActivity}</h3><p>{copy.recentActivityLead}</p></div>
          </header>
          {wallet && recentActivity.length ? <div className="overview-activity-list">
            {recentActivity.map((item) => <article key={item.id}>
              <span className={`overview-status ${item.status}`}>{readableStatus(item.status, lang)}</span>
              <div><button type="button" onClick={() => onNavigate(item.source === "autopilot" ? "autopilot" : "spot")}><strong>{readableKind(item.kind, lang)}</strong></button><small>{item.pair || item.executionPair || item.source}</small></div>
              <time>{relativeTime(item.createdAt, lang)}</time>
            </article>)}
          </div> : <div className="overview-empty"><i aria-hidden>⇄</i><strong>{copy.noActivity}</strong><span>{wallet ? copy.noActivityBody : copy.connectBody}</span></div>}
        </section>

        <section className="card overview-panel">
          <header className="overview-panel-head">
            <div><span className="eyebrow">{copy.ownerControlled}</span><h3>{copy.runtime}</h3><p>{copy.runtimeLead}</p></div>
            {executionAvailable && <button type="button" onClick={() => onNavigate("autopilot")}>{copy.configure} →</button>}
          </header>
          {wallet && strategies.length ? <div className="overview-strategy-list">
            {strategies.slice(0, 4).map((strategy) => {
              const state = strategyState(strategy, copy);
              return <article key={strategy.id}>
                <div className="overview-strategy-title"><span className={`overview-runtime ${state.className}`}>{state.label}</span><strong>{strategy.pair} · {strategy.timeframe}</strong></div>
                <dl><div><dt>{copy.lastDecision}</dt><dd>{strategy.lastDecision || "—"}</dd></div><div><dt>{copy.pass}</dt><dd>{passLabel(strategy, lang, copy)}</dd></div></dl>
                <small>{strategy.lastRunAt ? relativeTime(strategy.lastRunAt, lang) : "—"}</small>
              </article>;
            })}
          </div> : <div className="overview-empty"><i aria-hidden>◈</i><strong>{copy.noStrategies}</strong><span>{wallet ? copy.noStrategiesBody : copy.connectBody}</span>{wallet && executionAvailable && <button type="button" onClick={() => onNavigate("autopilot")}>{copy.configure} →</button>}</div>}
        </section>
      </div>}

      <section id="reports" className="card overview-panel overview-reports">
        <header className="overview-panel-head">
          <div><span className="eyebrow">{copy.recoverableResearch}</span><h3>{copy.savedReports}</h3><p>{copy.savedReportsLead}</p></div>
        </header>
        <div className="overview-report-metrics">
          <div><span>{copy.totalReports}</span><strong>{reports.length}</strong></div>
          <button type="button" onClick={() => onNavigate("analyze")}><span>{copy.globalReports}</span><strong>{globalReportCount}</strong><small>{copy.globalReport} →</small></button>
          <button type="button" onClick={() => onNavigate("prediction")}><span>{copy.predictionReports}</span><strong>{predictionReportCount}</strong><small>{copy.predictionReport} →</small></button>
        </div>
        {reports.length ? <div className="overview-report-list">{reports.slice(0, 6).map((report) => <button type="button" key={`${report.scope}:${report.jobId}`} onClick={() => setOpenedReport({...report,contextKey})}>
          <span>{report.scope === "spot" ? copy.globalReport : copy.predictionReport}</span><strong>{reportLabel(report, copy)}</strong><small>{relativeTime(report.createdAt, lang)} · {reportTierLabel(report.tier)}</small><b>→</b>
        </button>)}</div> : <div className="overview-empty compact"><i aria-hidden>▤</i><strong>{copy.noReports}</strong><span>{copy.noReportsBody}</span></div>}
      </section>
      {openedReport?.contextKey===contextKey && <SavedResearchDialog key={`${contextKey}:${openedReport.jobId}`} handle={openedReport} scope={openedReport.scope} onClose={()=>setOpenedReport(null)} />}
      <details className="portfolio-report-library"><summary>Recover wallet-owned reports <span>Another device or the new app address? No repurchase needed.</span></summary><p>Connect the wallet that originally paid, choose its payment network in the header, then sign a report-access message. Reconnecting does not create a payment.</p><div role="group" aria-label="Report library type"><button type="button" aria-pressed={libraryScope === "spot"} onClick={() => setLibraryScope("spot")}>Global Market</button><button type="button" aria-pressed={libraryScope === "prediction"} onClick={() => setLibraryScope("prediction")}>Prediction Market</button></div><ReportHistory networkKey={networkKey} scope={libraryScope} wallet={wallet} onOpen={report => setRestoredReport({report,scope:libraryScope,contextKey})}/><p>Device-only recovery handles stay in the browser where you bought the report. <a href="https://www.ai-pulse.tech/portfolio?legacyRecovery=1#reports" rel="noreferrer">Open the original-site recovery page</a>. No recovery tokens are transferred between sites.</p></details>
      {restoredReport?.contextKey === contextKey && <SavedResearchDialog restoredReport={restoredReport.report} scope={restoredReport.scope} onClose={() => setRestoredReport(null)}/>}
    </section>
  );
}
