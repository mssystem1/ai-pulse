import { useCallback, useEffect, useState } from "react";
import { API_BASE, apiGet, apiPost } from "./api";
import {
  assertUsdt0Enough,
  fetchWalletBalances,
  PRICE_USDT0,
  type WalletBalances,
} from "./balances";
import { t, type Lang } from "./i18n";
import { formatMarketPrice } from "./format";
import { AnalysisReport, ContractEvidenceReport, SafetyPreflightReport, SafetyTokenReport } from "./Report";
import { MarketPairPicker, XLayerTokenPicker } from "./Pickers";
import { SwapPanel } from "./SwapPanel";
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

type Tab = "analyze" | "safety";
type Candle = { ts: number; open: number; high: number; low: number; close: number; volume: number };

function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} data-tip={text} aria-label={text}>
      ?
    </span>
  );
}

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
  const grad = ctx.createLinearGradient(0, pad, 0, h - pad);
  grad.addColorStop(0, "rgba(0,229,160,0.28)");
  grad.addColorStop(1, "rgba(0,229,160,0)");
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(points[points.length - 1].x, h - pad);
  ctx.lineTo(points[0].x, h - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = "#00E5A0";
  ctx.lineWidth = 2;
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.fillStyle = "#00E5A0";
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

  const [wallet, setWallet] = useState<string | null>(null);
  const [walletName, setWalletName] = useState("");
  const [balances, setBalances] = useState<WalletBalances | null>(null);
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

  const [tokenAddr, setTokenAddr] = useState("0x779ded0c9e1022225f8e0630b35a9b54be713736");

  const refreshBalances = useCallback(async (addr?: string | null) => {
    const a = addr ?? wallet;
    if (!a) {
      setBalances(null);
      return;
    }
    setLoadingBal(true);
    try {
      const b = await fetchWalletBalances(a);
      setBalances(b);
      if (neededUsdt !== null && b.usdt0 >= neededUsdt) {
        setNeedUsdt(false);
        setNeededUsdt(null);
      }
    } catch (e) {
      console.warn("balance fetch", e);
    } finally {
      setLoadingBal(false);
    }
  }, [wallet, neededUsdt]);

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
    p.on("accountsChanged", onAccountsChanged);
    return () => p.removeListener?.("accountsChanged", onAccountsChanged);
  }, [refreshBalances]);

  useEffect(() => {
    if (wallet) void refreshBalances(wallet);
  }, [wallet, refreshBalances]);

  const change = Number(ticker?.change24hPct ?? 0);
  const service = String(result?.service || "");

  async function onConnect() {
    setError(null);
    try {
      const { address, providerName } = await connectWallet();
      clearWalletDisconnected();
      setWallet(address);
      setWalletName(providerName);
      await refreshBalances(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onDisconnect() {
    void disconnectWallet();
    setWallet(null);
    setWalletName("");
    setBalances(null);
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

  /** Paid call: check USDT0 balance first, then user wallet signs x402 */
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
      const required = PRICE_USDT0[action] ?? 0.01;
      // Always refresh balances right before pay
      const bal = await fetchWalletBalances(wallet);
      setBalances(bal);
      try {
        assertUsdt0Enough(bal.usdt0, required, lang);
      } catch (insuff) {
        setNeedUsdt(true);
        setNeededUsdt(required);
        setWalletOpen(true);
        throw insuff;
      }

      const paidFetch = await createWalletPaidFetch(wallet);
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
    const path = tier === "base" ? "/v1/analysis/base" : "/v1/analysis/premium";
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
      const response = await apiPost("/v1/contract/inspect", { address: tokenAddr });
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

  return (
    <div className="app">
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
            <h1>PULSE</h1>
            <span>{d.brandSub}</span>
          </div>
        </div>
        <div className="nav-right">
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
              <span className="wallet-balance">{balances ? `${balances.usdt0.toFixed(2)} USDT0` : "…"}</span>
              <span className="chevron">›</span>
            </button>
          ) : (
            <button type="button" className="connect-button" onClick={() => void onConnect()} title={d.connectTip}>
              {d.connect}
            </button>
          )}
        </div>
      </nav>

      <main>
      <section className="hero">
        <div className="card hero-copy">
          <h2>{d.tagline}</h2>
          <p className="lead">{d.heroLead}</p>
          <div className="nfa">{d.nfa}</div>
          <div className="hero-proof"><span><i /> {d.proofLive}</span><span>{d.proofPay}</span><span>{d.proofKeys}</span></div>
        </div>
        <div className="card chart-card">
          <div className="chart-head">
            <span>{ticker ? String(ticker.instId) : "—"}</span>
            <span className="muted">{timeframe} · OKX</span>
          </div>
          <canvas id="pulse-chart" className="chart" />
          {!candles.length && <div className="chart-empty">{d.loadFree}</div>}
        </div>
      </section>

      <div className="tabs">
        <button type="button" className={`tab ${tab === "analyze" ? "active" : ""}`} onClick={() => setTab("analyze")}>
          {d.tabAnalyze}
        </button>
        <button type="button" className={`tab ${tab === "safety" ? "active" : ""}`} onClick={() => setTab("safety")}>
          {d.tabSafety}
        </button>
      </div>

      <div className="grid">
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
                  {busyAction === "base" ? d.loading : d.base}
                </button>
                <button
                  type="button"
                  className="btn btn-accent full"
                  disabled={loading || health !== "ONLINE"}
                  onClick={() => void runAnalysis("premium")}
                  title={d.premiumTip}
                >
                  {busyAction === "premium" ? d.loading : d.premium}
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
                <div><span className="scope-dot" />{d.safetyNetwork}</div>
                <strong>{d.safetyMethod}</strong>
                <p>{d.safetyRpc}</p>
              </div>
              {!wallet && <p className="wallet-guidance">↑ {d.headerWalletHint}</p>}
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="contract-address">
                  {d.address} <Tip text={d.contractAddressTip} />
                </label>
                <div className="contract-entry">
                  <input id="contract-address" value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} />
                  <XLayerTokenPicker
                    lang={lang}
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
                  {busyAction === "contract" ? d.loading : d.contractInspect}
                </button>
                <button
                  type="button"
                  className="btn btn-primary full"
                  disabled={loading || health !== "ONLINE"}
                  onClick={() => void runSafety("token")}
                >
                  {busyAction === "token" ? d.loading : d.tokenScan}
                </button>
                <button
                  type="button"
                  className="btn btn-soft full"
                  disabled={loading || health !== "ONLINE"}
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
          {!result && <div className="report-empty"><div className="signal-orbit" aria-hidden><i /><i /><i /></div><h3>{d.emptyTitle}</h3><p>{d.emptyReport}</p></div>}

          {result && service === "token_scan" && <SafetyTokenReport data={result} />}
          {result && service === "preflight" && <SafetyPreflightReport data={result} />}
          {result && service === "contract_inspect" && <ContractEvidenceReport data={result} />}
          {result && (service === "analysis_base" || service === "analysis_premium") && (
            <AnalysisReport data={result} nfa={d.nfa} />
          )}
          {result &&
            service !== "token_scan" &&
            service !== "preflight" &&
            service !== "contract_inspect" &&
            service !== "analysis_base" &&
            service !== "analysis_premium" && (
              <pre className="raw">{JSON.stringify(result, null, 2)}</pre>
            )}

          {result && (
            <details className="raw-details">
              <summary>Raw JSON</summary>
              <pre className="raw">{JSON.stringify(result, null, 2)}</pre>
            </details>
          )}
        </div>
      </div>
      </main>

      <footer className="footer">
        <div>PULSE · Signal when you need it. Proof when it matters.</div>
        <div>OKX market data · x402 on X Layer</div>
      </footer>
      <SwapPanel
        lang={lang}
        open={walletOpen}
        address={wallet}
        walletName={walletName}
        balances={balances}
        loadingBal={loadingBal}
        onClose={() => setWalletOpen(false)}
        onDisconnect={onDisconnect}
        onRefresh={() => void refreshBalances()}
        emphasize={needUsdt}
      />
    </div>
  );
}
