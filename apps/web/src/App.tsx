import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, apiGet, apiPost } from "./api";
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
import { t, type Lang } from "./i18n";
import { useDocumentLocale } from "./uiLocale";
import { formatMarketPrice } from "./format";
import { AnalysisReport, ContractEvidenceReport, SafetyPreflightReport, SafetyTokenReport, type ReportTradeIntent } from "./Report";
import { MarketPairPicker, NetworkTokenPicker, TimeframePicker } from "./Pickers";
import { SwapPanel } from "./SwapPanel";
import { PredictionWorkspace } from "./PredictionWorkspace";
import { AutopilotWorkspace, DocsWorkspace, OpportunityRadar, SpotWorkspace, TelegramWorkspace } from "./V6Workspaces";
import { clearJobRecovery, readJobRecovery, saveJobRecovery } from "./jobRecovery";
import { Tip } from "./Tip";
import { NetworkLogo } from "./NetworkLogo";
import { ReportHistory } from "./ReportHistory";
import { beginLatestRequest, isLatestRequest, supersedeRequests } from "./latestRequest";
import { hrefForTab, tabFromHref, type PulseTab } from "./navigation";
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

type Tab = PulseTab;
type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number };

function drawChart(canvas: HTMLCanvasElement | null, candles: Candle[]) {
  if (!canvas || candles.length < 2) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  const pad = 12;
  const span = max - min || 1;

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  for (let i = 0; i < 4; i++) {
    const y = pad + ((h - pad * 2) * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  const points = candles.map((c, i) => {
    const x = pad + (i / (candles.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (c.close - min) / span) * (h - pad * 2);
    return { x, y };
  });
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--mint").trim() || "#00e5a0";
  const accentFill = /^#[0-9a-f]{6}$/i.test(accent) ? `${accent}47` : "rgba(0,229,160,.28)";
  const grad = ctx.createLinearGradient(0, pad, 0, h - pad);
  grad.addColorStop(0, accentFill);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(points[points.length - 1].x, h - pad);
  ctx.lineTo(points[0].x, h - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

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
    "/v1/analysis/base": .03, "/v1/analysis/premium": .06,
    "/v1/analysis/spot/standard": .03, "/v1/analysis/spot/premium": .06,
    "/v1/analysis/prediction/standard": .10, "/v1/analysis/prediction/premium": .20,
    "/v1/token/scan": .01, "/v1/preflight": .05,
  });

  const [wallet, setWallet] = useState<string | null>(null);
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    window.history.replaceState(window.history.state, "", hrefForTab(window.location.href, tab));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const requested = tabFromHref(window.location.href);
      const next = networkKey === "arc-testnet" && (requested === "spot" || requested === "autopilot") ? "analyze" : requested;
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  const [instId, setInstId] = useState("BTC-USDT");
  const [timeframe, setTimeframe] = useState("1H");
  const [note, setNote] = useState("");

  const [ticker, setTicker] = useState<Record<string, unknown> | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [paidMeta, setPaidMeta] = useState<string | null>(null);
  const [spotJob, setSpotJob] = useState<{ id: string; stage: string; startedAt: number } | null>(null);
  const [paymentProgress, setPaymentProgress] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [tradeIntent, setTradeIntent] = useState<ReportTradeIntent | null>(null);
  const reportRequestRef = useRef(0);

  const [tokenAddr, setTokenAddr] = useState("0x779ded0c9e1022225f8e0630b35a9b54be713736");
  const [simulationData, setSimulationData] = useState("0x");
  const [simulationValue, setSimulationValue] = useState("0x0");

  const refreshBalances = useCallback(async (addr?: string | null) => {
    const a = addr ?? wallet;
    if (!a) {
      setBalances(null);
      return;
    }
    setLoadingBal(true);
    try {
      const [b, gateway] = await Promise.all([
        fetchNetworkBalances(a, networkKey),
        networkKey === "arc-testnet" ? fetchArcGatewayBalance(a) : Promise.resolve(null),
      ]);
      setBalances(b);
      setGatewayBalance(gateway);
      const spendable = networkKey === "arc-testnet" ? gateway || 0 : b.payment;
      if (neededUsdt !== null && spendable >= neededUsdt) {
        setNeedUsdt(false);
        setNeededUsdt(null);
      }
    } catch (e) {
      console.warn("balance fetch", e);
    } finally {
      setLoadingBal(false);
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

  useEffect(() => {
    const c = document.getElementById("pulse-chart") as HTMLCanvasElement | null;
    drawChart(c, candles);
  }, [candles]);

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
    p.request({ method: "eth_accounts" })
      .then((accs) => {
        const list = accs as string[];
        if (list?.[0]) {
          setWallet(list[0]);
          setWalletName(walletProviderName(p));
          void refreshBalances(list[0]);
        }
      })
      .catch(() => undefined);
  }, [refreshBalances]);

  useEffect(() => {
    const p = getInjectedProvider();
    if (!p?.on) return;
    const onAccountsChanged = (...args: unknown[]) => {
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
    p.on("accountsChanged", onAccountsChanged);
    p.on("chainChanged", onChainChanged);
    return () => { p.removeListener?.("accountsChanged", onAccountsChanged); p.removeListener?.("chainChanged", onChainChanged); };
  }, [refreshBalances]);

  useEffect(() => {
    if (wallet) void refreshBalances(wallet);
  }, [wallet, refreshBalances]);

  useEffect(() => {
    document.documentElement.dataset.pulseNetwork = networkKey;
    savePreferredNetwork(localStorage, networkKey);
    if (networkKey === "arc-testnet" && (tab === "spot" || tab === "autopilot")) {
      setTab("analyze");
      window.history.replaceState(window.history.state, "", hrefForTab(window.location.href, "analyze"));
    }
  }, [networkKey]);

  // A report belongs to the exact market selection that produced it. Never
  // leave a previous pair, timeframe, or network report visible after the
  // user changes context.
  useEffect(() => {
    supersedeRequests(reportRequestRef);
    setTokenAddr(WEB_NETWORKS[networkKey].payment.address);
    setResult(null);
    setPaidMeta(null);
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
    if (!ENABLED_WEB_NETWORKS.includes("arc-testnet")) throw new Error("Enable Arc Testnet before connecting Circle Wallet");
    const connected = await connectCircleWallet(email, "arc-testnet");
    (window as Window & { __pulseCircleProvider?: typeof connected.provider }).__pulseCircleProvider = connected.provider;
    clearWalletDisconnected();
    setNetworkKey("arc-testnet");
    setWallet(connected.address);
    setWalletName(connected.providerName);
  }

  async function onNetworkChange(next: WebNetworkKey) {
    if (isCircleWalletConnected() && next !== "arc-testnet") return;
    setNetworkKey(next);
    setBalances(null);
    setGatewayBalance(null);
    setNeedUsdt(false);
    setNeededUsdt(null);
    const provider = getInjectedProvider();
    if (wallet && provider) {
      try {
        await switchWalletNetwork(provider, next);
        const accounts = await provider.request({ method: "eth_accounts" }) as string[];
        if (accounts?.[0]) setWallet(accounts[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

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
    setLoading(true);
    setBusyAction("free");
    setError(null);
    try {
      const [tRes, cRes] = await Promise.all([
        apiGet(`/v1/market/ticker?instId=${encodeURIComponent(instId)}`),
        apiGet(
          `/v1/market/candles?instId=${encodeURIComponent(instId)}&bar=${encodeURIComponent(timeframe)}&limit=100`,
        ),
      ]);
      if (!tRes.ok) throw new Error(`Ticker failed (${tRes.status}). Is API on ${API_BASE}?`);
      if (!cRes.ok) throw new Error(`Candles failed (${cRes.status})`);
      setTicker((tRes.data as { ticker: Record<string, unknown> }).ticker);
      setCandles((cRes.data as { candles: Candle[] }).candles || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  }

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
    setTradeIntent(intent);
    navigateTo("spot");
    window.requestAnimationFrame(() => window.scrollTo({ top: 360, behavior: "smooth" }));
  }

  function openAutopilotFromReport(intent: ReportTradeIntent) {
    setTradeIntent(intent);
    navigateTo("autopilot");
    window.requestAnimationFrame(() => window.scrollTo({ top: 360, behavior: "smooth" }));
  }

  function selectCandidateForAnalysis(candidatePair: string, candidateTimeframe: string) {
    supersedeRequests(reportRequestRef);
    setInstId(candidatePair);
    setTimeframe(candidateTimeframe);
    setResult(null);
    setSpotJob(null);
    setTradeIntent(null);
    setLoading(false);
    setBusyAction(null);
    navigateTo("analyze");
    window.requestAnimationFrame(() => window.scrollTo({ top: 430, behavior: "smooth" }));
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
      const canonicalPath = path.replace(/^\/(xlayer|base|arbitrum|arc)(?=\/)/, "");
      const required = routePrices[canonicalPath];
      if (!Number.isFinite(required)) throw new Error("This service has no published price and cannot be purchased.");
      // Always refresh balances right before pay
      const [bal, gateway] = await Promise.all([
        fetchNetworkBalances(wallet, networkKey),
        networkKey === "arc-testnet" ? fetchArcGatewayBalance(wallet) : Promise.resolve(null),
      ]);
      setBalances(bal);
      setGatewayBalance(gateway);
      const spendable = networkKey === "arc-testnet" ? gateway || 0 : bal.payment;
      try {
        assertPaymentBalance(spendable, required, network.payment.symbol, network.label);
      } catch (balanceError) {
        setNeedUsdt(true);
        setNeededUsdt(required);
        setWalletOpen(true);
        throw balanceError;
      }

      setPaymentProgress("Open your wallet and sign the x402 payment. A report job exists only after the signature is accepted.");
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
      if (!isLatestRequest(reportRequestRef, requestId)) return;
      setResult(data as Record<string, unknown>);
      setPaidMeta(`paid by ${shortAddr(wallet)} via x402`);
      await refreshBalances(wallet);
      if (path.includes("analysis") && !candles.length) void loadTeaser();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
    if (kind === "token") {
      await paidPost("/v1/token/scan", { address: tokenAddr, chainId: "196" }, "token");
    } else {
      await paidPost(
        "/v1/preflight",
        {
          intent: "swap",
          tokenAddress: tokenAddr,
          toToken: tokenAddr,
          fromToken: "0x0000000000000000000000000000000000000000",
          amount: "1",
        },
        "preflight",
      );
    }
  }

  async function inspectContract() {
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
      setResult(response.data as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  }

  async function simulateTransaction() {
    if (!wallet) return setError("Connect a wallet to set the simulation sender.");
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
      setResult(response.data as Record<string, unknown>);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  }

  const analysisReady = Boolean(result) && ["analysis_base", "analysis_premium", "spot_analysis_standard", "spot_analysis_premium"].includes(service);
  const experience = tab === "analyze"
    ? { title: "Global market intelligence", lead: "Explore every live OKX spot instrument—including crypto, xStocks and RWA—then choose Base or Premium analysis." }
    : tab === "prediction"
      ? { title: "Prediction market intelligence", lead: "Choose one live Polymarket question, inspect its executable evidence, then request Base or Premium analysis." }
      : tab === "spot"
        ? { title: "Execute a report with your wallet", lead: "Start with Global Market analysis, then review its prefilled Market or Limit buy, TP/SL and live on-chain route here." }
        : tab === "autopilot"
          ? { title: "Guarded autonomous execution", lead: "Allocate capital to an isolated vault and constrain the trading agent with an owner-signed on-chain policy." }
          : tab === "telegram"
            ? { title: "PULSE in Telegram", lead: "Deliver paid Global and Prediction reports in chat without giving the bot custody." }
            : tab === "docs"
              ? { title: "Product documentation", lead: "Understand every workflow, safety boundary, network and production test." }
              : { title: "Risk Guard", lead: `Discover tokens, verify contract evidence and simulate an exact transaction on ${network.label} before signing.` };
  const navigationTabs: Array<{ id: Tab; label: string; hint: string }> = [
    { id: "analyze", label: "Global Market", hint: "Research and reports" },
    { id: "prediction", label: "Prediction Market", hint: "Evidence and probabilities" },
    { id: "safety", label: "Risk Guard", hint: "Inspect before signing" },
    ...(networkKey === "arc-testnet" ? [] : [
      { id: "spot" as Tab, label: "Spot Trading", hint: "Trade from a report" },
      { id: "autopilot" as Tab, label: "Autopilot", hint: "Automate with guardrails" },
    ]),
    { id: "telegram", label: "Telegram", hint: "Reports in chat" },
    { id: "docs", label: "Docs", hint: "Guides and examples" },
  ];
  const activeNavigationTab = navigationTabs.find((item) => item.id === tab) || navigationTabs[0];

  function navigateTo(nextTab: Tab) {
    const safeTab = networkKey === "arc-testnet" && (nextTab === "spot" || nextTab === "autopilot") ? "analyze" : nextTab;
    setTab(safeTab);
    setMobileNavOpen(false);
    const nextHref = hrefForTab(window.location.href, safeTab);
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref !== currentHref) window.history.pushState(null, "", nextHref);
  }

  return (
    <div className={`app theme-${networkKey}`}>
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
            <h1><span className="brand-ai">AI</span><span>PULSE</span></h1>
            <span>{d.brandSub}</span>
          </div>
        </div>
        <div className="nav-right">
          <div className="network-popover">
            <button type="button" className="network-picker" title={`Network & payment · ${network.label} · ${network.payment.symbol}`} aria-haspopup="listbox" aria-expanded={networkMenuOpen} onClick={() => setNetworkMenuOpen((open) => !open)}>
              <span className={`network-symbol ${networkKey}`}><NetworkLogo network={networkKey} /></span>
              <span className="network-picker-copy"><small>Network & payment</small><b>{network.label}</b></span><span className="network-picker-state"><i />{network.payment.symbol}</span><span className="chevron">⌄</span>
            </button>
            {networkMenuOpen && <div className="network-menu" role="listbox" aria-label="Choose payment network">
              <div className="network-menu-head"><span className="eyebrow">EXECUTION CONTEXT</span><strong>Choose network</strong><p>The choice sets payment asset, wallet chain, on-chain liquidity and product theme.</p></div>
              <div className="network-options">{ENABLED_WEB_NETWORKS.filter((key) => !isCircleWalletConnected() || key === "arc-testnet").map((key) => { const item = WEB_NETWORKS[key]; const mainnet = key !== "arc-testnet"; return <button key={key} type="button" role="option" aria-selected={key === networkKey} className={key === networkKey ? "selected" : ""} onClick={() => { setNetworkMenuOpen(false); void onNetworkChange(key); }}><span className={`network-option-symbol ${key}`}><NetworkLogo network={key} /></span><span className="network-option-copy"><strong>{item.label}</strong><small>{item.payment.symbol} via {item.provider}</small><em>{mainnet ? "Analysis · Spot · Autopilot" : "Analysis · payment test"}</em></span><span className="network-option-check">{key === networkKey ? "✓" : ""}</span></button>; })}</div>
              <div className="network-menu-foot"><span><i /> Selected theme updates instantly</span><span>{networkKey === "arc-testnet" ? "Trading hidden on Arc Testnet" : "Mainnet execution available"}</span></div>
            </div>}
          </div>
          <div className="lang-switch" aria-label="Language">
            <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
            <button type="button" className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
          </div>
          <span className={`network-status ${health === "ONLINE" ? "live" : ""}`} title={`${health === "ONLINE" ? d.online : d.offline} · ${apiHint}`}>
            <i /> {health === "ONLINE" ? d.apiLive : d.apiOffline}
          </span>
          {wallet ? (
            <button
              type="button"
              className={`wallet-trigger ${needUsdt ? "warn" : ""}`}
              onClick={() => setWalletOpen(true)}
              aria-haspopup="dialog"
              aria-label={d.openWallet}
              title={d.openWallet}
            >
              <span className="wallet-glyph" aria-hidden>↗</span>
              <span className="wallet-action-copy"><strong>{d.walletFunding}</strong><small>{shortAddr(wallet)}</small></span>
              <span className="wallet-balance">{balances ? `${(networkKey === "arc-testnet" ? gatewayBalance || 0 : balances.payment).toFixed(2)} ${network.payment.symbol}` : "…"}</span>
              <span className="chevron">›</span>
            </button>
          ) : (
            <button type="button" className="connect-button" onClick={() => setWalletOpen(true)} title={d.connectTip}>
              {d.connect}
            </button>
          )}
        </div>
      </nav>

      <main>
      <section className="hero">
        <div className="card hero-copy">
          <h2>{experience.title}</h2>
          <p className="lead">{experience.lead}</p>
          <div className="nfa">{d.nfa}</div>
          <div className="hero-proof"><span><i /> {d.proofLive}</span><span>{d.proofPay}</span><span>{d.proofKeys}</span></div>
        </div>
        <div className={`card chart-card ${tab !== "analyze" ? "experience-card" : ""}`}>
          {tab === "analyze" ? <>
          <div className="chart-head">
            <span>{ticker ? String(ticker.instId) : "—"}</span>
            <span className="muted">{timeframe} · OKX</span>
          </div>
          <canvas id="pulse-chart" className="chart" />
          {!candles.length && <div className="chart-empty">{d.loadFree}</div>}
          </> : <div className="experience-summary"><span className="eyebrow">{network.label} · {network.provider}</span><h3>{tab === "prediction" ? "One question. Clear evidence. Two report depths." : "Evidence first. Unknown stays unknown."}</h3><p>{tab === "prediction" ? "Market selection and live context stay in the main workspace below." : "Contract evidence and simulation stay scoped to the selected chain."}</p></div>}
        </div>
      </section>

      <div className="tabs desktop-service-tabs" role="tablist" aria-label="PULSE services">
        {navigationTabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`tab ${tab === item.id ? "active" : ""}`} onClick={() => navigateTo(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="mobile-service-nav">
        <button type="button" className="mobile-service-trigger" aria-haspopup="dialog" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>
          <span><small>CURRENT SERVICE</small><strong>{activeNavigationTab.label}</strong></span>
          <span className="mobile-service-trigger-action">Switch <i aria-hidden>⌄</i></span>
        </button>
        {mobileNavOpen && <div className="mobile-service-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMobileNavOpen(false)}>
          <section className="mobile-service-sheet" role="dialog" aria-modal="true" aria-label="Choose a PULSE service">
            <header><div><small>PULSE NAVIGATION</small><h2>Where do you want to go?</h2></div><button type="button" aria-label="Close service navigation" onClick={() => setMobileNavOpen(false)}>×</button></header>
            <div className="mobile-service-grid" role="tablist" aria-label="PULSE services">
              {navigationTabs.map((item, index) => (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => navigateTo(item.id)}>
                  <i aria-hidden>{String(index + 1).padStart(2, "0")}</i><span><strong>{item.label}</strong><small>{item.hint}</small></span><b aria-hidden>{tab === item.id ? "✓" : "→"}</b>
                </button>
              ))}
            </div>
            <p>Analysis creates the plan. Spot Trading executes it once, while Autopilot follows your signed rules.</p>
          </section>
        </div>}
      </div>

      {networkKey !== "arc-testnet" && (["analyze", "spot", "autopilot"] as Tab[]).includes(tab) && <section className="product-journey" aria-label="Analyze, trade and automate workflow">
        <div className="journey-copy"><span className="eyebrow">YOUR PATH</span><strong>{analysisReady ? "Analysis ready — choose how to act" : "Start with evidence, then execute"}</strong><small>{analysisReady ? `${instId} · ${timeframe} is linked to the next step.` : "A report is what carries pair, timeframe, entry, TP and SL into execution."}</small></div>
        <button type="button" className={`${tab === "analyze" ? "active" : ""} ${analysisReady ? "complete" : ""}`} onClick={() => navigateTo("analyze")}><i>1</i><span><b>Analyze</b><small>{analysisReady ? "Report ready" : "Start here"}</small></span></button>
        <span className="journey-arrow">→</span>
        <button type="button" className={tab === "spot" ? "active" : ""} onClick={() => navigateTo("spot")}><i>2</i><span><b>Spot trade</b><small>Review and sign</small></span></button>
        <span className="journey-or">or</span>
        <button type="button" className={tab === "autopilot" ? "active" : ""} onClick={() => navigateTo("autopilot")}><i>3</i><span><b>Autopilot</b><small>Set rules and capital</small></span></button>
      </section>}

      {tab === "analyze" && <OpportunityRadar networkKey={networkKey} initialTimeframe={timeframe} context="global" onAnalyze={(candidate) => selectCandidateForAnalysis(candidate.pair, candidate.timeframe)} />}

      {tab === "spot" ? <SpotWorkspace networkKey={networkKey} wallet={wallet} initialPair={tradeIntent?.pair || instId} initialTrade={tradeIntent} onAnalyzeCandidate={selectCandidateForAnalysis} />
        : tab === "autopilot" ? <AutopilotWorkspace networkKey={networkKey} wallet={wallet} initialTrade={tradeIntent} onAnalyzeCandidate={selectCandidateForAnalysis} />
        : tab === "telegram" ? <TelegramWorkspace />
        : tab === "docs" ? <DocsWorkspace />
        : tab === "prediction" ? <div className="grid"><PredictionWorkspace networkKey={networkKey} wallet={wallet} lang={lang} prices={routePrices} onNeedWallet={() => wallet ? setWalletOpen(true) : void onConnect()} onBalancesChanged={() => void refreshBalances()} /></div> : <div className={`grid ${tab === "analyze" ? "analysis-layout" : ""}`}>
        <div className="card">
          {tab === "analyze" ? (
            <>
              <div className="section">{d.step1}</div>
              <div className="row">
                <div className="field">
                  <div className="field-label">
                    {d.symbol} <Tip text={d.symbolTip} />
                  </div>
                  <MarketPairPicker
                    id="market-pair"
                    lang={lang}
                    value={instId}
                    onSelect={(instrument) => { supersedeRequests(reportRequestRef); setInstId(instrument.instId); setResult(null); setSpotJob(null); setLoading(false); setBusyAction(null); }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="market-timeframe">
                    {d.timeframe} <Tip text={d.tfTip} />
                  </label>
                  <TimeframePicker id="market-timeframe" value={timeframe} networkKey={networkKey} onChange={(next) => { supersedeRequests(reportRequestRef); setTimeframe(next); setResult(null); setSpotJob(null); setLoading(false); setBusyAction(null); }} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="focus-note">
                  {d.note} <Tip text={d.noteTip} />
                </label>
                <input id="focus-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>

              <div className="section">
                {d.step2} <Tip text={d.freeTip} />
              </div>
              <button type="button" className="btn btn-soft full" disabled={loading} onClick={() => void loadTeaser()}>
                {busyAction === "free" ? d.loading : d.loadFree}
              </button>

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
                {d.step3} <Tip text={d.connectTip} />
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
                  {busyAction === "base" ? d.loading : `${lang === "zh" ? "基础分析" : "Base analysis"} · $${routePrices[networkKey === "xlayer" ? "/v1/analysis/base" : "/v1/analysis/spot/standard"].toFixed(2)}`}
                </button>
                <button
                  type="button"
                  className="btn btn-accent full"
                  disabled={loading || health !== "ONLINE"}
                  onClick={() => void runAnalysis("premium")}
                  title={d.premiumTip}
                >
                  {busyAction === "premium" ? d.loading : `${lang === "zh" ? "高级分析" : "Premium analysis"} · $${routePrices[networkKey === "xlayer" ? "/v1/analysis/premium" : "/v1/analysis/spot/premium"].toFixed(2)}`}
                </button>
              </div>
              <p className="hint">{d.walletNote}</p>
            </>
          ) : (
            <>
              <div className="section">RISK GUARD · {network.label}</div>
              <p className="lead" style={{ marginTop: 0 }}>
                Check the exact network token and transaction before your wallet asks for a signature.
              </p>
              <div className="safety-scope">
                <div><span className="scope-dot" />Selected chain · {network.label}</div>
                <strong>Identity → contract evidence → exact transaction simulation</strong>
                <p>Risk Guard reads the selected chain directly. Missing ownership, audit or liquidity evidence remains unknown instead of becoming a fabricated score.</p>
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
                  {busyAction === "contract" ? d.loading : "Inspect token & contract evidence · Free"}
                </button>
                <details className="raw-details">
                  <summary>Exact transaction simulation · Free</summary>
                  <div className="field"><label htmlFor="simulation-data">Calldata</label><input id="simulation-data" className="mono" value={simulationData} onChange={(event) => setSimulationData(event.target.value)} placeholder="0x" /></div>
                  <div className="field"><label htmlFor="simulation-value">Native value (hex wei)</label><input id="simulation-value" className="mono" value={simulationValue} onChange={(event) => setSimulationValue(event.target.value)} placeholder="0x0" /></div>
                  <button type="button" className="btn btn-soft full" disabled={loading || health !== "ONLINE" || !wallet} onClick={() => void simulateTransaction()}>{busyAction === "simulate" ? d.loading : "Simulate without broadcasting"}</button>
                  <p className="hint">Uses the connected address as sender and the contract field as recipient. Success proves executability only—not safety or future inclusion.</p>
                </details>
                <div className="risk-guard-guide"><article><b>1 · Choose</b><span>Browse contracts available on {network.label}, or paste a verified address.</span></article><article><b>2 · Inspect</b><span>Read bytecode, ERC-20 identity, proxy observations and explicit unknowns.</span></article><article><b>3 · Simulate</b><span>Open Exact transaction simulation and test the real calldata without broadcasting.</span></article></div>
              </div>
            </>
          )}

          {error && <div className="err">{error}{needUsdt && <button type="button" onClick={() => setWalletOpen(true)}>{d.fundWallet}</button>}</div>}
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
            <AnalysisReport data={result} nfa={d.nfa} onTrade={networkKey === "arc-testnet" ? undefined : openTradeFromReport} onAutopilot={networkKey === "arc-testnet" ? undefined : openAutopilotFromReport} />
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

          {result && (
            <details className="raw-details">
              <summary>Raw JSON</summary>
              <pre className="raw">{JSON.stringify(result, null, 2)}</pre>
            </details>
          )}
          <ReportHistory networkKey={networkKey} scope="spot" wallet={wallet} onOpen={(report) => { const reportInstId = typeof report.instId === "string" ? report.instId : null; const reportTimeframe = typeof report.timeframe === "string" ? report.timeframe : null; if (reportInstId) setInstId(reportInstId); if (reportTimeframe) setTimeframe(reportTimeframe); setResult({ ...report, service: typeof report.service === "string" ? report.service : report.tier === "premium" ? "spot_analysis_premium" : "spot_analysis_standard" }); }} />
        </div>
      </div>}
      </main>

      <footer className="footer">
        <div>PULSE · Signal when you need it. Proof when it matters.</div>
        <div>OKX + Polymarket data · {network.provider} on {network.label}</div>
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
