import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, apiGet, apiPost } from "./api";
import { formatTokenBalance } from "./format";
import { applySiteMetadata } from "./siteMetadata";
import {
  ENABLED_WEB_NETWORKS,
  WEB_NETWORKS,
  assertPaymentBalance,
  fetchArcGatewayBalance,
  fetchNetworkBalances,
  networkKeyForChainId,
  readPreferredNetwork,
  savePreferredNetwork,
  switchWalletNetwork,
  type WebNetworkKey,
} from "./networks";
import { isArcMarketPair, marketPairLabel } from "./marketPreview";
import { t, type Lang } from "./i18n";
import { useDocumentLocale } from "./uiLocale";
import { formatMarketPrice } from "./format";
import { loadMarketPreview, ShortlistMarketChart } from "./SpotMarketPreview";
import { AnalysisReport, ContractEvidenceReport, SafetyPreflightReport, SafetyTokenReport, type ReportTradeIntent } from "./Report";
import { MarketPairPicker, NetworkTokenPicker, TimeframePicker } from "./Pickers";
import { SwapPanel } from "./SwapPanel";
import { PredictionWorkspace } from "./PredictionWorkspace";
import { AppearancePicker } from "./AppearancePicker";
import { applyAppearance, readAppearance, type AppearanceId } from "./appearancePreference";
import { AutopilotWorkspace, DocsWorkspace, OpportunityRadar, SpotWorkspace, TelegramWorkspace } from "./V6Workspaces";
import { clearJobRecovery, readJobRecovery, saveJobRecovery } from "./jobRecovery";
import { Tip } from "./Tip";
import { NetworkLogo } from "./NetworkLogo";
import { ReportHistory } from "./ReportHistory";
import { ASSESSMENT_EVENT, rememberOpportunityAssessment } from "./opportunityAssessment";
import { storeScopedReport, type ReportSlots } from "./reportScope";
import { useExecutionAvailability } from "./executionAvailability";
import { RouteAvailability } from "./RouteAvailability";
import { beginLatestRequest, isLatestRequest, supersedeRequests } from "./latestRequest";
import { hrefForTab, tabFromHref, type PulseTab } from "./navigation";
import { OverviewWorkspace } from "./OverviewWorkspace";
import { buildReportBuyIntent } from "./reportTradeHandoff";
import {
  clearWalletDisconnected,
  connectWallet,
  createWalletPaidFetch,
  disconnectWallet,
  getInjectedProvider,
  shortAddr,
  walletProviderName,
  wasWalletDisconnected,
  type WalletConnectionMethod,
} from "./wallet";
import { connectCircleWallet, isCircleWalletConnected, restoreCircleWallet } from "./circleWallet";
import { selectAppKitNetwork } from "./appkit";
import { hasRecoverablePayment } from "./paymentRecovery";

type Tab = PulseTab;
type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number };


function storedLanguage(): Lang {
  try { return localStorage.getItem("pulse:language") === "zh" ? "zh" : "en"; }
  catch { return "en"; }
}

export function App() {
  const [lang, setLang] = useState<Lang>(storedLanguage);
  useDocumentLocale(lang);
  useEffect(() => { try { localStorage.setItem("pulse:language", lang); } catch { /* storage is optional */ } }, [lang]);
  const d = t(lang);
  const [tab, setTab] = useState<Tab>(() => tabFromHref(window.location.href));
  const [health, setHealth] = useState<"…" | "ONLINE" | "OFFLINE">("…");
  const [, setModel] = useState("");
  const [apiHint, setApiHint] = useState("");
  const [routePrices, setRoutePrices] = useState<Record<string, number>>({
    "/v1/analysis/base": .20, "/v1/analysis/premium": .30,
    "/v1/analysis/spot/standard": .20, "/v1/analysis/spot/premium": .30,
    "/v1/analysis/prediction/standard": .20, "/v1/analysis/prediction/premium": .30,
    "/v1/token/scan": .20, "/v1/preflight": .20,
  });

  const [wallet, setWallet] = useState<string | null>(null);
  const [expectedTelegramWallet] = useState(() => {
    const value = new URLSearchParams(window.location.search).get("expectedWallet");
    return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null;
  });
  const telegramWalletMatches = !expectedTelegramWallet || wallet?.toLowerCase() === expectedTelegramWallet;
  const [walletName, setWalletName] = useState("");
  const [networkKey, setNetworkKey] = useState<WebNetworkKey>(() => readPreferredNetwork(localStorage));
  const network = WEB_NETWORKS[networkKey];
  const [balances, setBalances] = useState<{ native: number; payment: number } | null>(null);
  const [gatewayBalance, setGatewayBalance] = useState<number | null>(null);
  const [loadingBal, setLoadingBal] = useState(false);
  const [needUsdt, setNeedUsdt] = useState(false);
  const [neededUsdt, setNeededUsdt] = useState<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceId>(() => {
    try { return readAppearance(localStorage); } catch { return readAppearance(); }
  });
  const networkPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => { applyAppearance(appearance); }, [appearance]);
  useEffect(() => {
    if (!networkMenuOpen) return;
    networkPopoverRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!networkPopoverRef.current?.contains(event.target as Node)) setNetworkMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setNetworkMenuOpen(false); networkPopoverRef.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [networkMenuOpen]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    window.history.replaceState(window.history.state, "", hrefForTab(window.location.href, tab));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const requested = tabFromHref(window.location.href);
      const next = requested;
      setTab(next);
      setMobileNavOpen(false);
      if (next !== requested) window.history.replaceState(window.history.state, "", hrefForTab(window.location.href, next));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [networkKey]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const sheet = document.querySelector<HTMLElement>(".mobile-service-sheet");
    sheet?.querySelector<HTMLElement>("button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
      if (event.key === "Tab" && sheet) {
        const targets = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')];
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  const [instId, setInstId] = useState("BTC-USDT");
  useEffect(() => { if (isArcMarketPair(instId)) setInstId("BTC-USDT"); }, [instId]);
  const executionAvailability = useExecutionAvailability(networkKey);
  const selectedExecution = executionAvailability(instId);
  const [timeframe, setTimeframe] = useState("1H");
  const [note, setNote] = useState("");

  const [ticker, setTicker] = useState<Record<string, unknown> | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const marketRequestRef = useRef(0);
  const teaserScope = `${instId}:${timeframe}`;
  const teaserScopeRef = useRef(teaserScope);
  teaserScopeRef.current = teaserScope;
  useEffect(() => { setTicker(null); setCandles([]); }, [teaserScope]);
  const [reportSlots, setReportSlots] = useState<ReportSlots>({ global: null, risk: null });
  const result = tab === "safety" ? reportSlots.risk : reportSlots.global;
  const assessmentNetworkRef = useRef(networkKey);
  useEffect(() => {
    if (assessmentNetworkRef.current !== networkKey) { assessmentNetworkRef.current = networkKey; return; }
    if (!reportSlots.global) return;
    try {
      rememberOpportunityAssessment(localStorage, networkKey, reportSlots.global);
      window.dispatchEvent(new Event(ASSESSMENT_EVENT));
    } catch { /* Local shortlist context is optional. */ }
  }, [reportSlots.global, networkKey]);
  const setResult = useCallback((report: Record<string, unknown> | null) => {
    setReportSlots(slots => storeScopedReport(slots, report, tab === "safety" ? "risk" : "global"));
  }, [tab]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [paidMetaSlots, setPaidMetaSlots] = useState<{ global: string | null; risk: string | null }>({ global: null, risk: null });
  const paidMetaScope = tab === "safety" ? "risk" : "global";
  const paidMeta = paidMetaSlots[paidMetaScope];
  const setPaidMeta = (value: string | null) => setPaidMetaSlots(slots => ({ ...slots, [paidMetaScope]: value }));
  const [spotJob, setSpotJob] = useState<{ id: string; stage: string; startedAt: number } | null>(null);
  const [paymentProgress, setPaymentProgress] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [tradeIntent, setTradeIntent] = useState<ReportTradeIntent | null>(null);
  const [spotPairDraft, setSpotPairDraft] = useState<string | null>(() => {
    const pair = new URLSearchParams(window.location.search).get("pair");
    return pair && /^[A-Z0-9]+-[A-Z0-9]+$/.test(pair) && pair.length <= 32 ? pair : null;
  });
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("telegramReport");
    if (!token || tab !== "spot" || !/^[A-Za-z0-9_-]{24,256}$/.test(token)) return;
    const controller = new AbortController();
    void fetch(`${API_BASE}/v1/shared/reports/${encodeURIComponent(token)}`, { signal: controller.signal, cache: "no-store", referrerPolicy: "no-referrer" })
      .then(async response => { if (!response.ok) throw new Error("Your Telegram report could not be loaded. Reopen the Spot handoff from My reports."); return response.json(); })
      .then(data => {
        if (!data.report?.instId) throw new Error("This report has no Spot market context.");
        setTradeIntent(buildReportBuyIntent(data.report, "limit"));
        const url = new URL(window.location.href); url.hash = "";
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Report handoff unavailable"); });
    return () => controller.abort();
  }, [tab]);
  const reportRequestRef = useRef(0);

  const [tokenAddr, setTokenAddr] = useState("0x779ded0c9e1022225f8e0630b35a9b54be713736");
  const [simulationData, setSimulationData] = useState("0x");
  const [simulationValue, setSimulationValue] = useState("0x0");

  const balanceRequestRef = useRef(0);
  const balanceContextRef = useRef({ networkKey, wallet });
  balanceContextRef.current = { networkKey, wallet };
  const refreshBalances = useCallback(async (addr?: string | null) => {
    const requestId = ++balanceRequestRef.current;
    const a = addr ?? wallet;
    if (!a) {
      setBalances(null);
      return;
    }
    setLoadingBal(true);
    try {
      const [b, gateway] = await Promise.all([
        fetchNetworkBalances(a, networkKey),
        networkKey === "arc" ? fetchArcGatewayBalance(a).catch(() => null) : Promise.resolve(null),
      ]);
      if (requestId !== balanceRequestRef.current || balanceContextRef.current.networkKey !== networkKey || balanceContextRef.current.wallet?.toLowerCase() !== a.toLowerCase()) return;
      setBalances(b);
      setGatewayBalance(gateway);
      const spendable = networkKey === "arc" ? gateway || 0 : b.payment;
      if (neededUsdt !== null && spendable >= neededUsdt) {
        setNeedUsdt(false);
        setNeededUsdt(null);
      }
    } catch (e) {
      if (requestId !== balanceRequestRef.current || balanceContextRef.current.networkKey !== networkKey) return;
      setBalances(null);
      setGatewayBalance(null);
      console.warn("balance fetch", e);
    } finally {
      if (requestId === balanceRequestRef.current) setLoadingBal(false);
    }
  }, [wallet, neededUsdt, networkKey]);

  const refreshHealth = useCallback(async () => {
    const r = await apiGet("/healthz");
    if (r.ok) {
      setHealth("ONLINE");
      const data = r.data as { grokModel?: string };
      setModel(data.grokModel || "");
      setApiHint(API_BASE || "same-origin");
    } else {
      setHealth("OFFLINE");
      setApiHint(API_BASE || "same-origin");
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    void apiGet("/v1/meta").then((response) => {
      if (!response.ok) return;
      const routes = (response.data as { routes?: Array<{ route?: string; priceUsd?: number }> }).routes || [];
      setRoutePrices((current) => ({ ...current, ...Object.fromEntries(routes.filter((item) => item.route?.startsWith("POST ") && Number.isFinite(item.priceUsd)).map((item) => [item.route!.slice(5), Number(item.priceUsd)])) }));
    });
    const id = window.setInterval(() => void refreshHealth(), 8000);
    return () => window.clearInterval(id);
  }, [refreshHealth]);


  // Restore session if already authorized
  useEffect(() => {
    if (wasWalletDisconnected()) return;
    const circle = restoreCircleWallet();
    if (circle) {
      (window as Window & { __pulseCircleProvider?: typeof circle.provider }).__pulseCircleProvider = circle.provider;
      setNetworkKey(circle.networkKey);
      setWallet(circle.address);
      setWalletName(circle.providerName);
      return;
    }
    const p = getInjectedProvider();
    if (!p) return;
    let active = true;
    p.request({ method: "eth_accounts" })
      .then(async (accs) => {
        if (!active || wasWalletDisconnected()) return;
        const list = accs as string[];
        if (list?.[0]) {
          const chainId = await p.request({ method: "eth_chainId" });
          if (!active || wasWalletDisconnected()) return;
          const selected = networkKeyForChainId(chainId);
          if (!selected || !ENABLED_WEB_NETWORKS.includes(selected)) {
            setError("Your connected wallet is on an unsupported network. Select a supported PULSE network in your wallet and reconnect.");
            return;
          }
          setNetworkKey(selected);
          setWallet(list[0]);
          setWalletName(walletProviderName(p));
          if (selected === networkKey) void refreshBalances(list[0]);
        } else {
          setWallet(null);
          setWalletName("");
          setBalances(null);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [refreshBalances]);

  useEffect(() => {
    const p = getInjectedProvider();
    if (!p) return;
    let active = true;
    const onAccountsChanged = (...args: unknown[]) => {
      if (!active) return;
      const accounts = args[0] as string[] | undefined;
      if (!accounts?.[0]) {
        setWallet(null);
        setWalletName("");
        setBalances(null);
        setWalletOpen(false);
        return;
      }
      if (wasWalletDisconnected()) return;
      setWallet(accounts[0]);
      setWalletName(walletProviderName(p));
      void refreshBalances(accounts[0]);
    };
    const onChainChanged = (...args: unknown[]) => {
      const chainId = Number.parseInt(String(args[0] || "0"), 16);
      const candidate = networkKeyForChainId(args[0]);
      const selected = candidate && ENABLED_WEB_NETWORKS.includes(candidate) ? candidate : undefined;
      if (selected) { setNetworkKey(selected); setError(null); }
      else setError(`Wallet changed to unsupported chain ${chainId}. Select a supported PULSE network before payment.`);
    };
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      void p.request({ method: "eth_accounts" }).then(accounts => onAccountsChanged(accounts)).catch(() => onAccountsChanged([]));
    };
    const onDisconnect = () => onAccountsChanged([]);
    const onSessionChanged = (event: Event) => {
      const host = window as Window & { __pulseDirectProvider?: unknown; __pulseCircleProvider?: unknown };
      if (host.__pulseDirectProvider || host.__pulseCircleProvider) return;
      if ((event as CustomEvent<{ connected: boolean }>).detail?.connected === false) onDisconnect();
      else recheck();
    };
    p.on?.("accountsChanged", onAccountsChanged);
    p.on?.("chainChanged", onChainChanged);
    p.on?.("disconnect", onDisconnect);
    window.addEventListener("focus", recheck);
    window.addEventListener("pulse:wallet-session-changed", onSessionChanged);
    document.addEventListener("visibilitychange", recheck);
    const timer = window.setInterval(recheck, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pulse:wallet-session-changed", onSessionChanged);
      document.removeEventListener("visibilitychange", recheck);
      p.removeListener?.("accountsChanged", onAccountsChanged);
      p.removeListener?.("chainChanged", onChainChanged);
      p.removeListener?.("disconnect", onDisconnect);
    };
  }, [refreshBalances, wallet]);

  useEffect(() => {
    if (wallet) void refreshBalances(wallet);
  }, [wallet, refreshBalances]);

  useEffect(() => {
    document.documentElement.dataset.pulseNetwork = networkKey;
    savePreferredNetwork(localStorage, networkKey);
  }, [networkKey]);

  // A report belongs to the exact market selection that produced it. Never
  // leave a previous pair, timeframe, or network report visible after the
  // user changes context.
  useEffect(() => {
    supersedeRequests(reportRequestRef);
    setTokenAddr(WEB_NETWORKS[networkKey].payment.address);
    setReportSlots({ global: null, risk: null });
    setSpotPairDraft(null);
    setTradeIntent(null);
    setPaidMetaSlots({ global: null, risk: null });
    setSpotJob(null);
    setPaymentProgress(null);
    setLoading(false);
    setBusyAction(null);
  }, [networkKey]);

  useEffect(() => {
    const saved = readJobRecovery(localStorage, networkKey, "spot");
    if (saved) { const requestId = beginLatestRequest(reportRequestRef); void pollSpotJob(saved.jobId, saved.recoveryToken, networkKey, requestId).catch((failure) => { if (isLatestRequest(reportRequestRef, requestId)) setRecoveryError(failure instanceof Error ? failure.message : String(failure)); }); }
  }, [networkKey]);

  const change = Number(ticker?.change24hPct ?? 0);
  const service = String(result?.service || "");
  const reportExecution = executionAvailability(String((result?.executionPlan as { pair?: string } | undefined)?.pair || result?.instId || instId));

  async function onConnect(method: WalletConnectionMethod = "auto") {
    setError(null);
    try {
      const { address, providerName } = await connectWallet(networkKey, method);
      clearWalletDisconnected();
      setWallet(address);
      setWalletName(providerName);
      await refreshBalances(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCircleConnect(email: string) {
    setError(null);
    if (!ENABLED_WEB_NETWORKS.includes("arc")) throw new Error("Enable Arc Mainnet before connecting Circle Wallet");
    const connected = await connectCircleWallet(email, "arc");
    (window as Window & { __pulseCircleProvider?: typeof connected.provider }).__pulseCircleProvider = connected.provider;
    clearWalletDisconnected();
    setNetworkKey("arc");
    setWallet(connected.address);
    setWalletName(connected.providerName);
  }

  async function onNetworkChange(next: WebNetworkKey) {
    if (isCircleWalletConnected() && next !== "arc") return;
    setError(null);
    const provider = getInjectedProvider();
    if (wallet && provider) {
      try {
        await switchWalletNetwork(provider, next);
        const accounts = await provider.request({ method: "eth_accounts" }) as string[];
        if (accounts?.[0]) setWallet(accounts[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setNetworkKey(next);
    setBalances(null);
    setGatewayBalance(null);
    setNeedUsdt(false);
    setNeededUsdt(null);
  }

  useEffect(() => {
    const changed = (event: Event) => {
      if (wallet || isCircleWalletConnected()) return;
      const key = networkKeyForChainId((event as CustomEvent<{ chainId?: unknown }>).detail?.chainId);
      if (key && ENABLED_WEB_NETWORKS.includes(key)) setNetworkKey(key);
    };
    window.addEventListener("pulse:wallet-network-changed", changed);
    return () => window.removeEventListener("pulse:wallet-network-changed", changed);
  }, [wallet]);

  useEffect(() => {
    if (wallet || isCircleWalletConnected()) return;
    let active = true;
    void selectAppKitNetwork(networkKey, true).catch(error => {
      if (active) setError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [networkKey, wallet]);

  async function onDisconnect() {
    await disconnectWallet();
    setWallet(null);
    setWalletName("");
    setBalances(null);
    setGatewayBalance(null);
    setNeedUsdt(false);
    setNeededUsdt(null);
    setWalletOpen(false);
  }

  async function loadTeaser() {
    const request = ++marketRequestRef.current;
    setMarketLoading(true);
    setMarketError(null);
    try {
      const preview = await loadMarketPreview(instId, timeframe);
      if (teaserScopeRef.current !== teaserScope || marketRequestRef.current !== request) return;
      setTicker(preview.ticker);
      setCandles(preview.candles);
    } catch (e) {
      if (teaserScopeRef.current === teaserScope && marketRequestRef.current === request) setMarketError(e instanceof Error ? e.message : String(e));
    } finally {
      if (teaserScopeRef.current === teaserScope && marketRequestRef.current === request) setMarketLoading(false);
    }
  }

  // Free market context is independent of report checkout/recovery state.
  // Changing pair, timeframe or page invalidates delayed responses.
  useEffect(() => {
    if (tab !== "analyze") return;
    const refresh = () => { if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) void loadTeaser(); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { marketRequestRef.current++; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [tab, teaserScope]);

  /** Paid call: check the selected network's payment balance, then let the wallet sign x402. */
  async function recoverSpotJob(jobId: string, recoveryToken: string, recoveryNetwork: WebNetworkKey, requestId = reportRequestRef.current) {
    setRecoveryError(null);
    const status = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}?fresh=${Date.now()}`, {
      headers: { "PULSE-RECOVERY-TOKEN": recoveryToken, "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    if (!status.ok) throw new Error(`Spot job recovery failed (${status.status})`);
    const payload = await status.json() as { job?: { stage?: string } };
    const stage = payload.job?.stage || "";
    if (!isLatestRequest(reportRequestRef, requestId)) return "superseded";
    setSpotJob((current) => ({ id: jobId, stage, startedAt: current?.id === jobId ? current.startedAt : Date.now() }));
    if (stage === "completed" || stage === "completed_partial") {
      const report = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}/report?fresh=${Date.now()}`, {
        headers: { "PULSE-RECOVERY-TOKEN": recoveryToken, "Cache-Control": "no-cache" },
        cache: "no-store",
      });
      if (!report.ok) {
        const failure = await report.json().catch(() => ({})) as { error?: string; recoverable?: boolean };
        throw new Error(`${failure.error || `Spot report recovery failed (${report.status})`}${failure.recoverable ? ". Your paid report is safe; retry recovery." : ""}`);
      }
      const body = await report.json() as { report?: Record<string, unknown> };
      if (body.report && isLatestRequest(reportRequestRef, requestId)) {
        const reportInstId = typeof body.report.instId === "string" ? body.report.instId : null;
        const reportTimeframe = typeof body.report.timeframe === "string" ? body.report.timeframe : null;
        if (reportInstId) setInstId(reportInstId);
        if (reportTimeframe) setTimeframe(reportTimeframe);
        setResult({ ...body.report, service: typeof body.report.service === "string" ? body.report.service : body.report.tier === "premium" ? "spot_analysis_premium" : "spot_analysis_standard" });
      }
      clearJobRecovery(localStorage, recoveryNetwork, "spot");
      setSpotJob(null);
    }
    return stage;
  }

  async function pollSpotJob(jobId: string, recoveryToken: string, recoveryNetwork: WebNetworkKey, requestId: number) {
    let lastTransientError: unknown = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (!isLatestRequest(reportRequestRef, requestId)) return "superseded";
      try {
        const stage = await recoverSpotJob(jobId, recoveryToken, recoveryNetwork, requestId);
        if (stage === "superseded" || stage === "completed" || stage === "completed_partial") return stage;
        if (["failed_retriable", "failed_terminal", "manual_reconciliation"].includes(stage)) {
          throw new Error("The paid report job stopped before delivery. Press Recover report now; PULSE will regenerate it from the settled receipt without another payment.");
        }
        lastTransientError = null;
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure);
        if (message.includes("stopped before delivery")) throw failure;
        lastTransientError = failure;
        if (isLatestRequest(reportRequestRef, requestId)) {
          setRecoveryError(`Connection interrupted; automatic recovery is still running. ${message}`);
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(5_000, 2_000 + attempt * 100)));
    }
    throw new Error(lastTransientError
      ? `The report is still safe but automatic recovery timed out: ${lastTransientError instanceof Error ? lastTransientError.message : String(lastTransientError)}`
      : "The paid report is still processing. Press Recover report now to continue without paying again.");
  }

  async function retrySpotRecovery() {
    const saved = readJobRecovery(localStorage, networkKey, "spot");
    if (!saved) return setRecoveryError("No recoverable paid Global report is stored in this browser for the selected network.");
    const requestId = beginLatestRequest(reportRequestRef);
    try {
      setRecoveryError(null);
      const retry = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(saved.jobId)}/retry`, {
        method: "POST",
        headers: { "PULSE-RECOVERY-TOKEN": saved.recoveryToken, "Cache-Control": "no-cache" },
        cache: "no-store",
      });
      if (!retry.ok) {
        const body = await retry.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Report recovery restart failed (${retry.status})`);
      }
      await pollSpotJob(saved.jobId, saved.recoveryToken, networkKey, requestId);
    }
    catch (failure) { setRecoveryError(failure instanceof Error ? failure.message : String(failure)); }
  }

  function openTradeFromReport(intent: ReportTradeIntent) {
    if (!executionAvailability(intent.pair).mapped) return;
    setTradeIntent(intent);
    navigateTo("spot");
    window.requestAnimationFrame(() => window.scrollTo({ top: 360, behavior: "smooth" }));
  }

  function selectCandidateForAnalysis(candidatePair: string, candidateTimeframe: string) {
    supersedeRequests(reportRequestRef);
    setInstId(candidatePair);
    setTimeframe(candidateTimeframe);
    setReportSlots(slots => ({ ...slots, global: null }));
    setSpotJob(null);
    setTradeIntent(null);
    setLoading(false);
    setBusyAction(null);
    navigateTo("analyze");
    window.requestAnimationFrame(() => {
      const discovery = document.querySelector<HTMLDetailsElement>(".workspace-discovery");
      if (discovery) discovery.open = false;
      const controls = document.getElementById("global-report-controls");
      controls?.focus({ preventScroll: true });
      controls?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function paidPost(path: string, body: unknown, action: string) {
    if (!wallet) {
      setError(d.needWallet);
      return;
    }
    const requestId = beginLatestRequest(reportRequestRef);
    setLoading(true);
    setBusyAction(action);
    setPaymentProgress("Checking the selected network and payment balance…");
    setError(null);
    setResult(null);
    setPaidMeta(null);
    setNeedUsdt(false);
    setNeededUsdt(null);
    try {
      const canonicalPath = path.replace(/^\/(xlayer|base|arbitrum|arc|robinhood)(?=\/)/, "");
      const required = routePrices[canonicalPath];
      if (!Number.isFinite(required)) throw new Error("This service has no published price and cannot be purchased.");
      const recovering = await hasRecoverablePayment(networkKey, wallet, `${API_BASE}${path}`, { method: "POST", body: JSON.stringify(body) }, localStorage);
      // Always refresh balances right before pay
      const [bal, gateway] = await Promise.all([
        fetchNetworkBalances(wallet, networkKey, true).catch(error => { if (!recovering) throw error; return balances; }),
        networkKey === "arc" ? fetchArcGatewayBalance(wallet).catch(error => { if (!recovering) throw error; return null; }) : Promise.resolve(null),
      ]);
      setBalances(bal);
      setGatewayBalance(gateway);
      const spendable = networkKey === "arc" ? gateway || 0 : bal?.payment;
      try {
        if (!recovering) assertPaymentBalance(spendable, required, network.payment.symbol, network.label);
      } catch (balanceError) {
        setNeedUsdt(true);
        setNeededUsdt(required);
        setWalletOpen(true);
        throw balanceError;
      }

      setPaymentProgress(recovering ? "Recovering your saved payment. No new payment signature is requested." : "Open your wallet and sign the x402 payment. A report job exists only after the signature is accepted.");
      const paidFetch = await createWalletPaidFetch(wallet, networkKey);
      const telegramDelivery = new URLSearchParams(window.location.search).get("tg");
      const res = await paidFetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(telegramDelivery ? { "PULSE-TELEGRAM-DELIVERY": telegramDelivery } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setPaymentProgress("Payment accepted. Creating your recoverable report job…");
      if (!res.ok) {
        throw new Error(
          typeof data === "object" && data
            ? JSON.stringify(data).slice(0, 300)
            : `HTTP ${res.status}`,
        );
      }
      if (res.status === 202) {
        if (action === "token" || action === "preflight") {
          throw new Error("This paid Risk Guard report is already processing. Open Paid report history → Sync with wallet to recover it. Do not purchase it again.");
        }
        const accepted = data as { job?: { id?: string; stage?: string }; recoveryToken?: string };
        if (!accepted.job?.id || !accepted.recoveryToken) throw new Error("Paid job response is missing its recovery capability");
        const request = body as { instId?: string; timeframe?: string };
        saveJobRecovery(localStorage, networkKey, { jobId: accepted.job.id, recoveryToken: accepted.recoveryToken, createdAt: new Date().toISOString(), label: `${request.instId || instId} · ${request.timeframe || timeframe}`, tier: action }, "spot");
        setSpotJob({ id: accepted.job.id, stage: accepted.job.stage || "payment_settled", startedAt: Date.now() });
        setPaymentProgress(null);
        await pollSpotJob(accepted.job.id, accepted.recoveryToken, networkKey, requestId);
        if (!isLatestRequest(reportRequestRef, requestId)) return;
        setPaidMeta(`paid by ${shortAddr(wallet)} via x402`);
        await refreshBalances(wallet);
        return;
      }
      if (data?.history?.jobId && data?.history?.recoveryToken && (action === "token" || action === "preflight")) {
        try { saveJobRecovery(localStorage, networkKey, { ...data.history, createdAt: data.generatedAt || new Date().toISOString(), label: `Risk Guard · ${tokenAddr}` }, "risk"); } catch { /* Wallet history remains available if browser storage is full. */ }
      }
      if (!isLatestRequest(reportRequestRef, requestId)) return;
      setResult(data as Record<string, unknown>);
      setPaidMeta(`paid by ${shortAddr(wallet)} via x402`);
      await refreshBalances(wallet);
      if (path.includes("analysis") && !candles.length) void loadTeaser();
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      try {
        const detail = JSON.parse(msg) as { error?: unknown; reason?: unknown };
        if (typeof detail.error === "string") {
          msg = detail.error;
          if (typeof detail.reason === "string" && /^[a-z_]+$/.test(detail.reason)) msg += ` (${detail.reason})`;
        }
      } catch { /* Plain wallet/provider errors are already readable. */ }
      if (msg.toLowerCase().includes("usdt") || msg.includes("USD₮0") || msg.includes("不足")) {
        setNeedUsdt(true);
      }
      if (isLatestRequest(reportRequestRef, requestId)) setError(msg);
    } finally {
      if (isLatestRequest(reportRequestRef, requestId)) {
        setLoading(false);
        setBusyAction(null);
        setPaymentProgress(null);
      }
    }
  }

  async function runAnalysis(tier: "base" | "premium") {
    const path = `/${network.route}/v1/analysis/spot/${tier === "base" ? "standard" : "premium"}`;
    await paidPost(
      path,
      { instId, timeframe, lang, userNote: note || undefined },
      tier,
    );
  }

  async function runSafety(kind: "token" | "preflight") {
    const prefix = networkKey === "xlayer" ? "" : `/${network.route}`;
    if (kind === "token") {
      await paidPost(`${prefix}/v1/token/scan`, { address: tokenAddr, lang }, "token");
    } else {
      await paidPost(
        `${prefix}/v1/preflight`,
        {
          intent: "generic",
          tokenAddress: tokenAddr,
          lang,
        },
        "preflight",
      );
    }
  }

  async function inspectContract() {
    const requestId = beginLatestRequest(reportRequestRef);
    setLoading(true);
    setBusyAction("contract");
    setError(null);
    setPaidMeta(null);
    try {
      const prefix = networkKey === "xlayer" ? "" : `/${network.route}`;
      let response = await apiPost(`${prefix}/v1/safety/evidence`, { address: tokenAddr });
      // Keep factual bytecode inspection available while live-safety rollout is disabled.
      if (response.status === 503) response = await apiPost(`${prefix}/v1/contract/inspect`, { address: tokenAddr });
      if (!response.ok) {
        const detail = response.data as { error?: string };
        throw new Error(detail?.error || `Contract inspection failed (${response.status})`);
      }
      if (isLatestRequest(reportRequestRef, requestId)) setResult(response.data as Record<string, unknown>);
    } catch (e) {
      if (isLatestRequest(reportRequestRef, requestId)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isLatestRequest(reportRequestRef, requestId)) { setLoading(false); setBusyAction(null); }
    }
  }

  async function simulateTransaction() {
    if (!wallet) return setError("Connect a wallet to set the simulation sender.");
    const requestId = beginLatestRequest(reportRequestRef);
    setLoading(true);
    setBusyAction("simulate");
    setError(null);
    setPaidMeta(null);
    try {
      const prefix = networkKey === "xlayer" ? "" : `/${network.route}`;
      const response = await apiPost(`${prefix}/v1/safety/simulate`, {
        transaction: { from: wallet, to: tokenAddr, data: simulationData, value: simulationValue },
      });
      if (!response.ok) {
        const detail = response.data as { error?: string };
        throw new Error(detail?.error || `Transaction simulation failed (${response.status})`);
      }
      if (isLatestRequest(reportRequestRef, requestId)) setResult(response.data as Record<string, unknown>);
    } catch (error) {
      if (isLatestRequest(reportRequestRef, requestId)) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (isLatestRequest(reportRequestRef, requestId)) { setLoading(false); setBusyAction(null); }
    }
  }

  const analysisReady = Boolean(result) && ["analysis_base", "analysis_premium", "spot_analysis_standard", "spot_analysis_premium"].includes(service);
  const riskOnchainSource = networkKey === "xlayer" ? "OKX API" : networkKey === "robinhood" ? "Blockscout, Robinhood RPC, Sourcify and official stock-registry" : networkKey === "base" || networkKey === "arbitrum" ? "Blockscout API" : "available indexed chain evidence";
  const experience = tab === "analyze"
    ? { title: "Global market intelligence", lead: networkKey === "arc" ? "Explore Arc contract markets in USDC, or exchange research mapped to Arc’s published wrapped assets. Choose Quick or Pro analysis." : "Explore every live OKX spot instrument—including crypto, xStocks and RWA—then choose Quick or Pro analysis." }
    : tab === "prediction"
      ? { title: "Prediction market intelligence", lead: "Choose one live Polymarket question, inspect its executable evidence, then request Quick or Pro analysis." }
      : tab === "spot"
        ? { title: "Trade with your wallet", lead: "Choose a pair or load a Global Market report. Review your Market or Limit ticket, amount and protection, then sign when ready." }
        : tab === "autopilot"
          ? { title: "Guarded autonomous execution", lead: "Allocate capital to an isolated vault and constrain the trading agent with an owner-signed on-chain policy." }
          : tab === "telegram"
            ? { title: "PULSE in Telegram", lead: "Learn how to start PULSE, buy research with Stars, link your report history and connect a TON wallet." }
            : tab === "docs"
              ? { title: "Product documentation", lead: "Understand every workflow, safety boundary, network and production test." }
              : { title: lang === "zh" ? "风险卫士" : "Risk Guard", lead: lang === "zh" ? `在 ${network.label} 上查看免费原始证据，或生成由多来源证据支持的 Grok 代币风险报告，再决定是否签名。` : `View free raw evidence or generate a multi-source Grok Token Risk report on ${network.label} before deciding whether to sign.` };
  const navigationTabs: Array<{ id: Tab; label: string; hint: string }> = [
    { id: "overview", label: lang === "zh" ? "资产总览" : "Portfolio", hint: lang === "zh" ? "钱包和活动摘要" : "Positions, activity and saved research" },
    { id: "analyze", label: lang === "zh" ? "全球市场" : "Global Market", hint: lang === "zh" ? "研究和报告" : "Research and reports" },
    { id: "prediction", label: lang === "zh" ? "预测市场" : "Prediction Market", hint: lang === "zh" ? "证据和概率" : "Evidence and probabilities" },
    { id: "safety", label: lang === "zh" ? "风险卫士" : "Risk Guard", hint: lang === "zh" ? "签名前检查" : "Inspect before signing" },
    ...([
      { id: "spot" as Tab, label: lang === "zh" ? "现货交易" : "Spot Trading", hint: lang === "zh" ? "市价单和限价单" : "Market and Limit orders" },
      { id: "autopilot" as Tab, label: "Autopilot", hint: lang === "zh" ? "在限制内自动运行" : "Automate with guardrails" },
    ]),
    { id: "telegram", label: "Telegram", hint: lang === "zh" ? "在聊天中接收报告" : "Reports in chat" },
    { id: "docs", label: lang === "zh" ? "文档" : "Docs", hint: lang === "zh" ? "指南和示例" : "Guides and examples" },
  ];
  const activeNavigationTab = navigationTabs.find((item) => item.id === tab) || navigationTabs[0];
  useEffect(() => { applySiteMetadata("app"); }, [tab]);

  function navigateTo(nextTab: Tab) {
    const safeTab = nextTab;
    setTab(safeTab);
    setMobileNavOpen(false);
    const nextHref = hrefForTab(window.location.href, safeTab);
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref !== currentHref) window.history.pushState(null, "", nextHref);
  }

  return (
    <div className={`app theme-${appearance}`}>
      <a className="app-skip-link" href="#app-main">Skip to workspace</a>
      <nav className="nav">
        <div className="brand">
          <div className="mark">
            <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden>
              <circle cx="32" cy="32" r="22" stroke="#00E5A0" strokeWidth="1.5" opacity="0.3" />
              <path
                d="M10 34 H20 L24 22 L28 44 L34 18 L40 38 L44 32 H54"
                stroke="#00E5A0"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="brand-wordmark"><span className="brand-ai">AI</span><span>PULSE</span></div>
            <span>{d.brandSub}</span>
          </div>
        </div>
        <div className="nav-right">
          <div className="network-popover" ref={networkPopoverRef}>
            <button type="button" className="network-picker" title={`${lang === "zh" ? "网络与支付" : "Network & payment"} · ${network.label} · ${network.payment.symbol}`} aria-haspopup="listbox" aria-expanded={networkMenuOpen} onClick={() => setNetworkMenuOpen((open) => !open)} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setNetworkMenuOpen(true); } }}>
              <span className={`network-symbol ${networkKey}`}><NetworkLogo network={networkKey} /></span>
              <span className="network-picker-copy"><small>{lang === "zh" ? "网络与支付" : "Network & payment"}</small><b>{network.label}</b></span><span className="network-picker-state"><i />{network.payment.symbol}</span><span className="chevron">⌄</span>
            </button>
            {networkMenuOpen && <div className="network-menu" role="listbox" aria-label={lang === "zh" ? "选择支付网络" : "Choose payment network"} onKeyDown={event => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
              const current = options.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
              options[next]?.focus();
            }}>
              <div className="network-menu-head"><span className="eyebrow">{lang === "zh" ? "执行环境" : "EXECUTION CONTEXT"}</span><strong>{lang === "zh" ? "选择网络" : "Choose network"}</strong><p>{lang === "zh" ? "设置支付资产、钱包链和链上流动性，不改变外观。" : "Sets payment asset, wallet chain and on-chain liquidity. Appearance stays unchanged."}</p></div>
              <div className="network-options">{ENABLED_WEB_NETWORKS.filter((key) => !isCircleWalletConnected() || key === "arc").map((key) => { const item = WEB_NETWORKS[key]; return <button key={key} type="button" role="option" aria-selected={key === networkKey} className={key === networkKey ? "selected" : ""} onClick={() => { setNetworkMenuOpen(false); networkPopoverRef.current?.querySelector<HTMLButtonElement>(".network-picker")?.focus(); void onNetworkChange(key); }}><span className={`network-option-symbol ${key}`}><NetworkLogo network={key} /></span><span className="network-option-copy"><strong>{item.label}</strong><small>{item.payment.symbol} {lang === "zh" ? "通过" : "via"} {item.provider}</small><em>{lang === "zh" ? "分析 · 现货 · Autopilot" : "Analysis · Spot · Autopilot"}</em></span><span className="network-option-check">{key === networkKey ? "✓" : ""}</span></button>; })}</div>
              <div className="network-menu-foot"><span><i /> {lang === "zh" ? "外观单独设置" : "Appearance is independent"}</span><span>{lang === "zh" ? "各功能单独检查可用性" : "Availability checked per feature"}</span></div>
            </div>}
          </div>
          <AppearancePicker value={appearance} lang={lang} onChange={setAppearance} />
          <div className="lang-switch" aria-label="Language">
            <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
            <button type="button" className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
          </div>
          <span className={`network-status ${health === "ONLINE" ? "live" : health === "…" ? "checking" : ""}`} title={`${health === "…" ? "Checking API" : health === "ONLINE" ? d.online : d.offline} · ${apiHint}`}>
            <i /> {health === "…" ? (lang === "zh" ? "正在检查 API" : "Checking API…") : health === "ONLINE" ? d.apiLive : d.apiOffline}
          </span>
          {wallet ? (
            <button
              type="button"
              className={`wallet-trigger ${needUsdt ? "warn" : ""} ${networkKey === "arc" ? "has-arc-balances" : ""}`}
              onClick={() => setWalletOpen(true)}
              aria-haspopup="dialog"
              aria-label={d.openWallet}
              title={d.openWallet}
            >
              <span className="wallet-glyph" aria-hidden>↗</span>
              <span className="wallet-action-copy"><strong>{d.walletFunding}</strong><small>{shortAddr(wallet)}</small></span>
              {networkKey === "arc" ? <span className="wallet-balances" aria-label={lang === "zh" ? "Arc USDC 余额" : "Arc USDC balances"}>
                <span title={lang === "zh" ? "交易资金与网络手续费" : "Trading capital and network gas"}><small>{lang === "zh" ? "钱包" : "Wallet"}</small><b>{formatTokenBalance(balances?.payment ?? NaN, lang)} USDC</b></span>
                <span title={lang === "zh" ? "研究付款与 Autopilot 通行证" : "Research payments and Autopilot passes"}><small>Gateway</small><b>{formatTokenBalance(gatewayBalance ?? NaN, lang)} USDC</b></span>
              </span> : <span className="wallet-balance">{balances ? `${formatTokenBalance(balances.payment, lang)} ${network.payment.symbol}` : "…"}</span>}
              <span className="chevron">›</span>
            </button>
          ) : (
            <button type="button" className="connect-button" onClick={() => setWalletOpen(true)} title={d.connectTip}>
              {d.connect}
            </button>
          )}
        </div>
      </nav>

      <main id="app-main" tabIndex={-1}>
      {expectedTelegramWallet && <section className="card" role="status"><strong>Telegram account wallet: {shortAddr(expectedTelegramWallet)}</strong><p>{telegramWalletMatches ? "This browser is using your linked Telegram wallet." : "Connect this exact wallet account to continue. A different browser wallet cannot replace your saved Telegram association."}</p>{!telegramWalletMatches && <button className="btn btn-accent" onClick={() => setWalletOpen(true)}>Connect linked wallet</button>}</section>}
      <div className="tabs desktop-service-tabs" role="tablist" aria-label="PULSE services">
        {navigationTabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`tab ${tab === item.id ? "active" : ""}`} onClick={() => navigateTo(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="mobile-service-nav">
        <button type="button" className="mobile-service-trigger" aria-haspopup="dialog" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>
          <span><small>{lang === "zh" ? "当前页面" : "CURRENT PAGE"}</small><strong>{activeNavigationTab.label}</strong></span>
          <span className="mobile-service-trigger-action">{lang === "zh" ? "切换" : "Switch"} <i aria-hidden>⌄</i></span>
        </button>
        {mobileNavOpen && <div className="mobile-service-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMobileNavOpen(false)}>
          <section className="mobile-service-sheet" role="dialog" aria-modal="true" aria-label="Choose a PULSE service">
            <header><div><small>{lang === "zh" ? "PULSE 导航" : "PULSE NAVIGATION"}</small><h2>{lang === "zh" ? "你想去哪里？" : "Where do you want to go?"}</h2></div><button type="button" aria-label="Close service navigation" onClick={() => setMobileNavOpen(false)}>×</button></header>
            <div className="mobile-service-grid" role="tablist" aria-label="PULSE services">
              {navigationTabs.map((item, index) => (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => navigateTo(item.id)}>
                  <i aria-hidden>{String(index + 1).padStart(2, "0")}</i><span><strong>{item.label}</strong><small>{item.hint}</small></span><b aria-hidden>{tab === item.id ? "✓" : "→"}</b>
                </button>
              ))}
            </div>
            <p>{lang === "zh" ? "全球市场分析可以预填现货订单。Autopilot 使用独立的已签名策略、资金和运行通行证启动。" : "Global analysis can prefill a Spot order. Autopilot starts independently from its own signed strategy, capital and runtime pass."}</p>
          </section>
        </div>}
      </div>


      {error && <div className="err" role="alert">{error}{needUsdt && <button type="button" onClick={() => setWalletOpen(true)}>{d.fundWallet}</button>}</div>}

      {analysisReady && (["analyze", "spot"] as Tab[]).includes(tab) && <section className="product-journey spot-journey" aria-label="Global intelligence and Spot trading workflow">
        <div className="journey-copy"><span className="eyebrow">GLOBAL → SPOT PATH</span><strong>{analysisReady ? "Report ready" : "Turn Global intelligence into a Spot action"}</strong><small>{analysisReady ? reportExecution.mapped ? `${instId} · ${timeframe} can prefill a Market or Limit ticket.` : `${reportExecution.label}. Choose a mapped pair for execution.` : "Global Quick/Pro can prefill entry, TP and SL; direct pair configuration also remains available."}</small></div>
        <button type="button" className={`${tab === "analyze" ? "active" : ""} ${analysisReady ? "complete" : ""}`} onClick={() => navigateTo("analyze")}><i>1</i><span><b>Global intelligence</b><small>{analysisReady ? "Report ready" : "Quick or Pro"}</small></span></button>
        <span className="journey-arrow">→</span>
        <button type="button" className={tab === "spot" ? "active" : ""} onClick={() => navigateTo("spot")}><i>2</i><span><b>Spot Market or Limit</b><small>Review and sign</small></span></button>
      </section>}

      {(["spot", "autopilot"] as Tab[]).includes(tab) && <header className="workspace-page-heading"><h1>{tab === "spot" ? (lang === "zh" ? "现货交易" : "Spot trading") : "Autopilot"}</h1><p>{tab === "spot" ? (lang === "zh" ? "选择交易对、查看行情，然后在钱包中审核订单。" : "Choose a pair, explore the market, then review your order in your wallet.") : (lang === "zh" ? "在你批准的资金和风险限制内自主交易。" : "Autonomous trading within your approved capital and risk limits.")}</p></header>}
      {tab === "analyze" && <header className="workspace-page-heading"><h1>{lang === "zh" ? "全球市场" : "Global Market"}</h1><p>{lang === "zh" ? "查看市场行情，选择报告深度，再决定下一步。" : "Explore the selected market, choose your research depth, then decide your next action."}</p></header>}

      {tab === "analyze" && <details className="workspace-discovery"><summary>Explore other markets <span>Free shortlist · choose a pair for research</span></summary><OpportunityRadar networkKey={networkKey} initialTimeframe={timeframe} context="global" onAnalyze={(candidate) => selectCandidateForAnalysis(candidate.pair, candidate.timeframe)} /></details>}

      {(tab === "prediction" || tab === "safety") && <header className="workspace-page-heading"><h1>{experience.title}</h1><p>{experience.lead}</p><div className="nfa">{d.nfa}</div></header>}

      {tab === "analyze" && <section className="card global-market-workspace" aria-label="Selected market and chart">
        <div className="global-market-controls"><div className="field"><label htmlFor="market-pair">{networkKey === "arc" ? (lang === "zh" ? "市场交易对" : "Market pair") : d.symbol} <Tip text={networkKey === "arc" ? (lang === "zh" ? "选择实时 OKX 研究市场。BTC 对应 Arc cirBTC/USDC，ETH 对应 WETH/USDC。" : "Choose a live OKX research instrument. BTC maps to Arc cirBTC/USDC and ETH to WETH/USDC for execution.") : d.symbolTip}/></label><MarketPairPicker id="market-pair" networkKey={networkKey} lang={lang} value={instId} onSelect={instrument => { supersedeRequests(reportRequestRef); setInstId(instrument.instId); setResult(null); setSpotJob(null); setLoading(false); setBusyAction(null); }}/></div><div className="field"><label htmlFor="market-timeframe">{d.timeframe} <Tip text={networkKey === "arc" ? (lang === "zh" ? "所选市场的 K 线周期；行情来源按市场区分。" : "Candle interval for the selected market. Data source follows the chosen market.") : d.tfTip}/></label><TimeframePicker id="market-timeframe" value={timeframe} networkKey={networkKey} onChange={next => { supersedeRequests(reportRequestRef); setTimeframe(next); setResult(null); setSpotJob(null); setLoading(false); setBusyAction(null); }}/></div><span className="market-auto-status" role="status">{marketLoading ? d.loading : lang === "zh" ? "行情自动更新" : "Market data updates automatically"}</span></div>
        <p><RouteAvailability network={networkKey} pair={instId} mapped={selectedExecution.mapped} fallback={selectedExecution.label}/></p>
        <div className="chart-head"><span title={instId}>{marketPairLabel(instId)}</span><span className="muted">{timeframe} · OKX · Free market preview</span></div>{networkKey === "arc" && ["BTC-USDT", "ETH-USDT"].includes(instId) && <small className="market-source-note">{instId === "BTC-USDT" ? "Arc cirBTC/USDC" : "Arc WETH/USDC"} · {lang === "zh" ? "图表使用 OKX 参考行情；实际成交使用 Arc 独立报价。" : "Chart uses OKX reference data; Arc execution uses a separate live quote."}</small>}
        <div className="global-market-reference" aria-label="Market reference chart">
        {candles.length > 0 ? <ShortlistMarketChart pair={instId} timeframe={timeframe} mark={Number(ticker?.last || candles.at(-1)?.close)} history={candles.map(candle => candle.close)} fetchedAt={new Date(candles.at(-1)!.ts).toISOString()} lang={lang}/> : <p role="status">{marketError ? (lang === "zh" ? "市场数据暂不可用，请重试。" : "Market data temporarily unavailable. Retrying automatically.") : d.loading}</p>}
        </div>
        {marketError && candles.length > 0 && <p role="status">{lang === "zh" ? "更新失败，显示上次行情。" : "Refresh failed; showing the last market snapshot."}</p>}
        <p className="hint">{d.nfa}</p>
      </section>}

      {tab === "overview" ? <OverviewWorkspace networkKey={networkKey} wallet={wallet} health={health} lang={lang} onNavigate={navigateTo} onRefreshBalances={refreshBalances} />
        : tab === "spot" ? <SpotWorkspace networkKey={networkKey} wallet={telegramWalletMatches ? wallet : null} lang={lang} initialPair={tradeIntent?.pair || spotPairDraft || instId} initialTrade={tradeIntent} onPairSelected={(pair) => { setTradeIntent(null); setSpotPairDraft(pair); }} onAnalyzeCandidate={selectCandidateForAnalysis} />
        : tab === "autopilot" ? <AutopilotWorkspace networkKey={networkKey} wallet={telegramWalletMatches ? wallet : null} lang={lang} onAnalyzeCandidate={selectCandidateForAnalysis} />
        : tab === "telegram" ? <TelegramWorkspace />
        : tab === "docs" ? <DocsWorkspace lang={lang} />
        : tab === "prediction" ? <div className="grid"><PredictionWorkspace networkKey={networkKey} wallet={wallet} lang={lang} prices={routePrices} onNeedWallet={() => wallet ? setWalletOpen(true) : void onConnect()} onBalancesChanged={() => void refreshBalances()} /></div> : <div className={`grid ${tab === "analyze" ? "analysis-layout" : ""}`}>
        <div className="card" id={tab === "analyze" ? "global-report-controls" : undefined} tabIndex={-1}>
          {tab === "analyze" ? (
            <>
              <div className="field">
                <label htmlFor="focus-note">
                  {d.note} <Tip text={d.noteTip} />
                </label>
                <input id="focus-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>


              {ticker && (
                <div className="ticker">
                  <div className="stat">
                    <b title={String(ticker.last)}>{formatMarketPrice(ticker.last, lang)}</b>
                    <small>{d.last}</small>
                  </div>
                  <div className={`stat ${change < 0 ? "down" : ""}`}>
                    <b>
                      {change > 0 ? "+" : ""}
                      {change}%
                    </b>
                    <small>{d.change}</small>
                  </div>
                  <div className="stat">
                    <b title={String(ticker.high24h)}>{formatMarketPrice(ticker.high24h, lang)}</b>
                    <small>{d.high}</small>
                  </div>
                  <div className="stat">
                    <b title={String(ticker.low24h)}>{formatMarketPrice(ticker.low24h, lang)}</b>
                    <small>{d.low}</small>
                  </div>
                </div>
              )}

              <div className="section">
                {lang === "zh" ? "选择报告深度" : "Choose report depth"} <Tip text={d.connectTip} />
              </div>
              {!wallet && <p className="wallet-guidance">↑ {d.headerWalletHint}</p>}
              <div className="actions stack" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary full"
                  disabled={loading || health !== "ONLINE"}
                  onClick={() => void runAnalysis("base")}
                  title={d.baseTip}
                >
                  {busyAction === "base" ? d.loading : `${lang === "zh" ? "快速报告" : "Quick report"} · $${routePrices[networkKey === "xlayer" ? "/v1/analysis/base" : "/v1/analysis/spot/standard"].toFixed(2)}`}
                </button>
                <button
                  type="button"
                  className="btn btn-accent full"
                  disabled={loading || health !== "ONLINE"}
                  onClick={() => void runAnalysis("premium")}
                  title={d.premiumTip}
                >
                  {busyAction === "premium" ? d.loading : `${lang === "zh" ? "专业报告" : "Pro report"} · $${routePrices[networkKey === "xlayer" ? "/v1/analysis/premium" : "/v1/analysis/spot/premium"].toFixed(2)}`}
                </button>
              </div>
              <p className="hint">{d.walletNote}</p>
            </>
          ) : (
            <>
              <div className="section">{lang === "zh" ? "风险卫士" : "RISK GUARD"} · {network.label}</div>
              <p className="lead" style={{ marginTop: 0 }}>
                {lang === "zh" ? "先检查准确的链上代币，再决定是否签署交易。" : "Inspect the exact on-chain token before deciding whether to sign a transaction."}
              </p>
              <div className="safety-scope">
                <div><span className="scope-dot" />{lang === "zh" ? "已选网络" : "Selected chain"} · {network.label}</div>
                <strong>{lang === "zh" ? "免费事实证据 → 付费代币风险报告 → 可选交易模拟" : "Free factual evidence → paid Token Risk report → optional transaction simulation"}</strong>
                <p>{lang === "zh" ? `免费检查显示原始事实。0.20 美元的报告使用 ${riskOnchainSource} 作为链上权威来源，结合 GeckoTerminal 市场、网站、X 资料和独立显示的供应商评分，再由 Grok 综合分析。社交链接不代表推广活跃度，数据缺失不代表已确认的缺陷。` : `The $0.20 report combines ${riskOnchainSource} on-chain facts with GeckoTerminal market data, project links and a separately attributed provider rating. Grok synthesizes the evidence. Social links do not prove promotion activity; missing data is not a confirmed defect.`}</p>
              </div>
              {!wallet && <p className="wallet-guidance">↑ {d.headerWalletHint}</p>}
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="contract-address">
                  {d.address} <Tip text={d.contractAddressTip} />
                </label>
                <div className="contract-entry">
                  <input id="contract-address" value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} />
                  <NetworkTokenPicker
                    lang={lang}
                    networkKey={networkKey}
                    selectedAddress={tokenAddr}
                    onSelect={(token) => setTokenAddr(token.address)}
                  />
                </div>
              </div>
              <div className="actions stack">
                <button
                  type="button"
                  className="btn btn-soft full"
                  disabled={loading || health !== "ONLINE"}
                  onClick={() => void inspectContract()}
                >
                  {busyAction === "contract" ? d.loading : lang === "zh" ? "查看原始代币与合约证据 · 免费" : "View raw token & contract evidence · Free"}
                </button>
                <div className="paid-risk-card">
                  <div><span>{lang === "zh" ? "完整尽调" : "FULL DUE DILIGENCE"}</span><strong>{lang === "zh" ? "代币风险报告" : "Token Risk report"}</strong><p>{lang === "zh" ? "市场与流动性、持币者、合约、网站与社交链接，附来源覆盖、损失情景、评分与未知项。推广活跃度若未被数据源测量则保持未知。" : "Market/liquidity, holders, contract, website and social links—with source coverage, loss scenario, score and explicit unknowns. Promotion activity stays unknown when not measured."}</p></div>
                  <b>$0.20 {network.payment.symbol}</b>
                </div>
                <button type="button" className="btn btn-primary full" disabled={loading || health !== "ONLINE" || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddr)} onClick={() => void runSafety("preflight")}>
                  {busyAction === "preflight" ? d.loading : lang === "zh" ? "生成完整代币风险报告 · $0.20" : "Generate full Token Risk report · $0.20"}
                </button>
                <details className="raw-details">
                  <summary>{lang === "zh" ? "可选：准确交易模拟 · 免费" : "Optional: exact transaction simulation · Free"}</summary>
                  <div className="field"><label htmlFor="simulation-data">Calldata</label><input id="simulation-data" className="mono" value={simulationData} onChange={(event) => setSimulationData(event.target.value)} placeholder="0x" /></div>
                  <div className="field"><label htmlFor="simulation-value">Native value (hex wei)</label><input id="simulation-value" className="mono" value={simulationValue} onChange={(event) => setSimulationValue(event.target.value)} placeholder="0x0" /></div>
                  <button type="button" className="btn btn-soft full" disabled={loading || health !== "ONLINE" || !wallet} onClick={() => void simulateTransaction()}>{busyAction === "simulate" ? d.loading : "Simulate without broadcasting"}</button>
                  <p className="hint">Uses the connected address as sender and the contract field as recipient. Success proves executability only—not safety or future inclusion.</p>
                </details>
                <div className="risk-guard-guide"><article><b>{lang === "zh" ? "1 · 选择" : "1 · Choose"}</b><span>{lang === "zh" ? `浏览 ${network.label} 代币或粘贴准确合约地址。` : `Browse ${network.label} tokens or paste the exact contract address.`}</span></article><article><b>{lang === "zh" ? "2 · 核实" : "2 · Verify"}</b><span>{lang === "zh" ? "先免费查看原始链上事实；需要综合判断时再购买完整报告。" : "Read raw on-chain facts for free; buy the full report when you need a synthesized decision."}</span></article><article><b>{lang === "zh" ? "3 · 决定" : "3 · Decide"}</b><span>{lang === "zh" ? "检查来源、评分、红旗和未知项；仅在需要时模拟准确 calldata。" : "Review sources, score, red flags and unknowns; simulate exact calldata only when needed."}</span></article></div>
              </div>
            </>
          )}

          {!error && result && (
            <div className="ok">
              OK · {service}
              {paidMeta ? ` · ${paidMeta}` : ""}
            </div>
          )}
        </div>

        <div className="card report-card">
          <div className="section">{d.report}</div>
          {!result && <div className="report-empty"><div className="signal-orbit" aria-hidden><i /><i /><i /></div><h3>{spotJob ? spotJob.stage.replaceAll("_", " ") : paymentProgress ? "Complete the wallet step" : d.emptyTitle}</h3><p>{spotJob ? `Paid report ${spotJob.id.slice(0, 8)}… is stored with a recovery capability. PULSE polls it automatically and does not charge again.` : paymentProgress || d.emptyReport}</p>{spotJob && <div className="recovery-actions"><button type="button" className="btn btn-primary" onClick={() => void retrySpotRecovery()}>Recover report now</button><details><summary>How recovery works</summary><p>PULSE keeps the job ID and an opaque recovery key only in this browser, separated by network. It resumes polling automatically; Recover restarts a stopped job from its settled receipt without another payment.</p></details></div>}{recoveryError && <div className="recovery-error"><strong>Recovery status</strong><span>{recoveryError}</span><button type="button" onClick={() => void retrySpotRecovery()}>Retry without paying</button></div>}</div>}

          {result && service === "token_scan" && <SafetyTokenReport data={result} />}
          {result && service === "preflight" && <SafetyPreflightReport data={result} />}
          {result && (service === "contract_inspect" || service === "live_contract_evidence") && <ContractEvidenceReport data={result} />}
          {result && (service === "analysis_base" || service === "analysis_premium" || service === "spot_analysis_standard" || service === "spot_analysis_premium") && (
            <>
            <div className="execution-availability" data-status={reportExecution.status}>{reportExecution.label}{!reportExecution.mapped ? ". This report is research; choose a mapped pair for Spot trading on this network." : ". Review the live route and amounts before signing."}</div>
            <AnalysisReport data={result} nfa={d.nfa} onTrade={reportExecution.mapped ? openTradeFromReport : undefined} />
            </>
          )}
          {result &&
            service !== "token_scan" &&
            service !== "preflight" &&
            service !== "contract_inspect" &&
            service !== "live_contract_evidence" &&
            service !== "analysis_base" &&
            service !== "analysis_premium" &&
            service !== "spot_analysis_standard" &&
            service !== "spot_analysis_premium" && (
              <pre className="raw">{JSON.stringify(result, null, 2)}</pre>
            )}

          {tab === "safety" && <ReportHistory networkKey={networkKey} scope="risk" wallet={wallet} onOpen={(report) => { if (typeof report.address === "string") setTokenAddr(report.address); setResult(report); }} />}
          {result && (
            <details className="raw-details">
              <summary>Raw JSON</summary>
              <pre className="raw">{JSON.stringify(result, null, 2)}</pre>
            </details>
          )}
          {tab === "analyze" && <ReportHistory networkKey={networkKey} scope="spot" wallet={wallet} onOpen={(report) => { const reportInstId = typeof report.instId === "string" ? report.instId : null; const reportTimeframe = typeof report.timeframe === "string" ? report.timeframe : null; if (reportInstId) setInstId(reportInstId); if (reportTimeframe) setTimeframe(reportTimeframe); setResult({ ...report, service: typeof report.service === "string" ? report.service : report.tier === "premium" ? "spot_analysis_premium" : "spot_analysis_standard" }); }} />}
        </div>
      </div>}
      </main>

      <footer className="footer">
        <div>PULSE · Signal when you need it. Proof when it matters.</div>
        <div data-no-localize>{lang === "zh"
          ? `OKX + Polymarket 数据 · ${network.label} 上的 ${network.provider}`
          : `OKX + Polymarket data · ${network.provider} on ${network.label}`}</div>
      </footer>
      <SwapPanel
        lang={lang}
        open={walletOpen}
        address={wallet}
        walletName={walletName}
        networkKey={networkKey}
        balances={balances}
        gatewayBalance={gatewayBalance}
        loadingBal={loadingBal}
        onClose={() => setWalletOpen(false)}
        onDisconnect={onDisconnect}
        onRefresh={() => void refreshBalances()}
        onOkxConnect={() => void onConnect("okx")}
        onOtherWalletConnect={() => void onConnect("other")}
        onCircleConnect={onCircleConnect}
        emphasize={needUsdt}
      />
    </div>
  );
}
