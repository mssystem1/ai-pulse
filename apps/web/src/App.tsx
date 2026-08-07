import { useCallback, useEffect, useState } from "react";
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
import { formatMarketPrice } from "./format";
import { AnalysisReport, ContractEvidenceReport, SafetyPreflightReport, SafetyTokenReport } from "./Report";
import { MarketPairPicker, XLayerTokenPicker } from "./Pickers";
import { SwapPanel } from "./SwapPanel";
import { PredictionWorkspace } from "./PredictionWorkspace";
import { clearJobRecovery, readJobRecovery, saveJobRecovery } from "./jobRecovery";
import { Tip } from "./Tip";
import {
  clearWalletDisconnected,
  connectWallet,
  createWalletPaidFetch,
  disconnectWallet,
  getInjectedProvider,
  shortAddr,
  walletProviderName,
  wasWalletDisconnected,
} from "./wallet";
import { connectCircleWallet, isCircleWalletConnected, restoreCircleWallet } from "./circleWallet";

type Tab = "analyze" | "prediction" | "safety";
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

export function App() {
  const [lang, setLang] = useState<Lang>("en");
  const d = t(lang);
  const [tab, setTab] = useState<Tab>("analyze");
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
  }, [networkKey]);

  // A report belongs to the exact market selection that produced it. Never
  // leave a previous pair, timeframe, or network report visible after the
  // user changes context.
  useEffect(() => {
    setResult(null);
    setPaidMeta(null);
    setSpotJob(null);
  }, [networkKey, instId, timeframe]);

  useEffect(() => {
    const saved = readJobRecovery(localStorage, networkKey, "spot");
    if (saved) void recoverSpotJob(saved.jobId, saved.recoveryToken, networkKey).catch(() => undefined);
  }, [networkKey]);

  const change = Number(ticker?.change24hPct ?? 0);
  const service = String(result?.service || "");

  async function onConnect() {
    setError(null);
    try {
      const { address, providerName } = await connectWallet(networkKey);
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
  async function recoverSpotJob(jobId: string, recoveryToken: string, recoveryNetwork: WebNetworkKey) {
    const status = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}`, { headers: { "PULSE-RECOVERY-TOKEN": recoveryToken } });
    if (!status.ok) throw new Error(`Spot job recovery failed (${status.status})`);
    const payload = await status.json() as { job?: { stage?: string } };
    const stage = payload.job?.stage || "";
    setSpotJob((current) => ({ id: jobId, stage, startedAt: current?.id === jobId ? current.startedAt : Date.now() }));
    if (stage === "completed" || stage === "completed_partial") {
      const report = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}/report`, { headers: { "PULSE-RECOVERY-TOKEN": recoveryToken } });
      if (!report.ok) throw new Error(`Spot report recovery failed (${report.status})`);
      const body = await report.json() as { report?: Record<string, unknown> };
      if (body.report) {
        const reportInstId = typeof body.report.instId === "string" ? body.report.instId : null;
        const reportTimeframe = typeof body.report.timeframe === "string" ? body.report.timeframe : null;
        if ((!reportInstId || reportInstId === instId) && (!reportTimeframe || reportTimeframe === timeframe)) {
          setResult(body.report);
        }
      }
      clearJobRecovery(localStorage, recoveryNetwork, "spot");
      setSpotJob(null);
    }
    return stage;
  }

  async function paidPost(path: string, body: unknown, action: string) {
    if (!wallet) {
      setError(d.needWallet);
      return;
    }
    setLoading(true);
    setBusyAction(action);
    setError(null);
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

      const paidFetch = await createWalletPaidFetch(wallet, networkKey);
      const res = await paidFetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
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
        saveJobRecovery(localStorage, networkKey, { jobId: accepted.job.id, recoveryToken: accepted.recoveryToken }, "spot");
        setSpotJob({ id: accepted.job.id, stage: accepted.job.stage || "payment_settled", startedAt: Date.now() });
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const stage = await recoverSpotJob(accepted.job.id, accepted.recoveryToken, networkKey);
          if (["completed", "completed_partial", "failed_retriable", "failed_terminal", "manual_reconciliation"].includes(stage)) break;
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        }
        setPaidMeta(`paid by ${shortAddr(wallet)} via x402`);
        await refreshBalances(wallet);
        return;
      }
      setResult(data as Record<string, unknown>);
      setPaidMeta(`paid by ${shortAddr(wallet)} via x402`);
      await refreshBalances(wallet);
      if (path.includes("analysis") && !candles.length) void loadTeaser();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("usdt") || msg.includes("USD₮0") || msg.includes("不足")) {
        setNeedUsdt(true);
      }
      setError(msg);
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  }

  async function runAnalysis(tier: "base" | "premium") {
    const path = networkKey === "xlayer"
      ? (tier === "base" ? "/v1/analysis/base" : "/v1/analysis/premium")
      : `/${network.route}/v1/analysis/spot/${tier === "base" ? "standard" : "premium"}`;
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

  const experience = tab === "analyze"
    ? { title: "Crypto market intelligence", lead: "Explore live OKX spot data, then choose base or premium analysis for your selected pair and timeframe." }
    : tab === "prediction"
      ? { title: "Crypto prediction intelligence", lead: "Choose one live Polymarket crypto question, inspect its executable market evidence, then request base or premium analysis." }
      : { title: "Onchain safety checks", lead: `Inspect contracts and simulate transactions on ${network.label}. Missing evidence remains unknown; checks never broadcast.` };

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
          <label className="network-picker" aria-label="Payment network">
            <span className="network-dot" /><span className="network-picker-copy"><small>Pay on</small><b>{network.label}</b></span>
            <select value={networkKey} onChange={(event) => void onNetworkChange(event.target.value as WebNetworkKey)}>
              {ENABLED_WEB_NETWORKS.filter((key) => !isCircleWalletConnected() || key === "arc-testnet").map((key) => <option key={key} value={key}>{WEB_NETWORKS[key].label}</option>)}
            </select>
          </label>
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

      <div className="tabs">
        <button type="button" className={`tab ${tab === "analyze" ? "active" : ""}`} onClick={() => setTab("analyze")}>
          Crypto Market
        </button>
        <button type="button" className={`tab ${tab === "prediction" ? "active" : ""}`} onClick={() => setTab("prediction")}>Prediction Market</button>
        <button type="button" className={`tab ${tab === "safety" ? "active" : ""}`} onClick={() => setTab("safety")}>
          {d.tabSafety}
        </button>
      </div>

      {tab === "prediction" ? <div className="grid"><PredictionWorkspace networkKey={networkKey} wallet={wallet} lang={lang} prices={routePrices} onNeedWallet={() => wallet ? setWalletOpen(true) : void onConnect()} onBalancesChanged={() => void refreshBalances()} /></div> : <div className="grid">
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
                    onSelect={(instrument) => setInstId(instrument.instId)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="market-timeframe">
                    {d.timeframe} <Tip text={d.tfTip} />
                  </label>
                  <select id="market-timeframe" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                    {["15m", "1H", "4H", "1D", "1W"].map((tf) => (
                      <option key={tf} value={tf}>
                        {tf}
                      </option>
                    ))}
                  </select>
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
              <div className="section">{d.safetyTitle}</div>
              <p className="lead" style={{ marginTop: 0 }}>
                {d.safetyLead}
              </p>
              <div className="safety-scope">
                <div><span className="scope-dot" />Live RPC evidence · {network.label}</div>
                <strong>{d.safetyMethod}</strong>
                <p>Contract and ERC-20 evidence is network-aware. Missing observations stay unknown. Legacy paid heuristic scores remain X Layer-only and are never presented as live audits.</p>
              </div>
              {!wallet && <p className="wallet-guidance">↑ {d.headerWalletHint}</p>}
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="contract-address">
                  {d.address} <Tip text={d.contractAddressTip} />
                </label>
                <div className="contract-entry">
                  <input id="contract-address" value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} />
                  {networkKey === "xlayer" && <XLayerTokenPicker
                    lang={lang}
                    selectedAddress={tokenAddr}
                    onSelect={(token) => setTokenAddr(token.address)}
                  />}
                </div>
              </div>
              <div className="actions stack">
                <button
                  type="button"
                  className="btn btn-soft full"
                  disabled={loading || health !== "ONLINE"}
                  onClick={() => void inspectContract()}
                >
                  {busyAction === "contract" ? d.loading : d.contractInspect}
                </button>
                <details className="raw-details">
                  <summary>Exact transaction simulation · Free</summary>
                  <div className="field"><label htmlFor="simulation-data">Calldata</label><input id="simulation-data" className="mono" value={simulationData} onChange={(event) => setSimulationData(event.target.value)} placeholder="0x" /></div>
                  <div className="field"><label htmlFor="simulation-value">Native value (hex wei)</label><input id="simulation-value" className="mono" value={simulationValue} onChange={(event) => setSimulationValue(event.target.value)} placeholder="0x0" /></div>
                  <button type="button" className="btn btn-soft full" disabled={loading || health !== "ONLINE" || !wallet} onClick={() => void simulateTransaction()}>{busyAction === "simulate" ? d.loading : "Simulate without broadcasting"}</button>
                  <p className="hint">Uses the connected address as sender and the contract field as recipient. Success proves executability only—not safety or future inclusion.</p>
                </details>
                <button
                  type="button"
                  className="btn btn-primary full"
                  disabled={loading || health !== "ONLINE" || networkKey !== "xlayer"}
                  onClick={() => void runSafety("token")}
                >
                  {busyAction === "token" ? d.loading : d.tokenScan}
                </button>
                <button
                  type="button"
                  className="btn btn-soft full"
                  disabled={loading || health !== "ONLINE" || networkKey !== "xlayer"}
                  onClick={() => void runSafety("preflight")}
                >
                  {busyAction === "preflight" ? d.loading : d.preflight}
                </button>
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
          {!result && <div className="report-empty"><div className="signal-orbit" aria-hidden><i /><i /><i /></div><h3>{spotJob ? spotJob.stage.replaceAll("_", " ") : d.emptyTitle}</h3><p>{spotJob ? `Persisted spot job ${spotJob.id.slice(0, 8)}… · ${Math.floor((Date.now() - spotJob.startedAt) / 1000)}s elapsed. You may refresh or close PULSE and recover without paying again.` : d.emptyReport}</p></div>}

          {result && service === "token_scan" && <SafetyTokenReport data={result} />}
          {result && service === "preflight" && <SafetyPreflightReport data={result} />}
          {result && (service === "contract_inspect" || service === "live_contract_evidence") && <ContractEvidenceReport data={result} />}
          {result && (service === "analysis_base" || service === "analysis_premium" || service === "spot_analysis_standard" || service === "spot_analysis_premium") && (
            <AnalysisReport data={result} nfa={d.nfa} />
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
        onBrowserConnect={() => void onConnect()}
        onCircleConnect={onCircleConnect}
        emphasize={needUsdt}
      />
    </div>
  );
}
