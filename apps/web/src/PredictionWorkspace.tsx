import { useEffect, useState } from "react";
import { API_BASE, apiGet } from "./api";
import { assertPaymentBalance, fetchArcGatewayBalance, fetchNetworkBalances, WEB_NETWORKS, type WebNetworkKey } from "./networks";
import { clearJobRecovery, readJobRecovery, saveJobRecovery } from "./jobRecovery";
import { createWalletPaidFetch } from "./wallet";
import { PredictionAnalysisReport } from "./Report";
import { Tip } from "./Tip";

type Market = {
  id: string; question: string; description: string | null; resolutionSource: string | null;
  outcomes: Array<{ name: string; tokenId: string; referencePrice: number | null }>;
  eligibility: string; endDate: string | null; volumeUsd: number | null; liquidityUsd: number | null;
};
type Context = {
  market: Market; books?: Array<{ tokenId: string; outcome: string; book: { timestamp: string; bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> } }>;
  openInterest?: number | null; partial?: boolean; missingSources?: string[];
};

type Props = {
  networkKey: WebNetworkKey;
  wallet: string | null;
  lang: "en" | "zh";
  prices: Record<string, number>;
  onNeedWallet: () => void;
  onBalancesChanged: () => void;
};

function money(value: number | null | undefined) {
  return value == null ? "Unavailable" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function PredictionWorkspace({ networkKey, wallet, lang, prices, onNeedWallet, onBalancesChanged }: Props) {
  const network = WEB_NETWORKS[networkKey];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selected, setSelected] = useState<Market | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [jobStage, setJobStage] = useState("");

  async function loadMarkets(search = "") {
    setBusy("markets"); setError("");
    try {
      const path = search.trim() ? `/v1/polymarket/search?q=${encodeURIComponent(search)}&limit=40` : "/v1/polymarket/crypto?limit=30";
      const response = await apiGet(path);
      if (!response.ok) throw new Error(`Crypto prediction discovery failed (${response.status})`);
      const rows = (response.data as { markets?: Market[] }).markets || [];
      const asset = /\b(bitcoin|btc|ethereum|ether|eth|solana|sol|xrp|dogecoin|doge|bnb|sui|cardano|ada|avalanche|avax|chainlink|link|crypto)\b/i;
      const intent = /\b(up\s+or\s+down|above|below|higher|lower|price|reach|hit|close|trade|worth|all[- ]time high|ath|market cap)\b/i;
      setMarkets(rows.filter((market) => asset.test(market.question) && intent.test(market.question) && (!market.endDate || Date.parse(market.endDate) > Date.now())));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }

  async function chooseMarket(market: Market) {
    setPickerOpen(false); setSelected(market); setContext(null); setResult(null); setError(""); setBusy("context");
    try {
      const response = await apiGet(`/v1/polymarket/markets/${encodeURIComponent(market.id)}/context`);
      if (!response.ok) throw new Error(`Live prediction context failed (${response.status})`);
      const data = response.data as Context;
      setSelected(data.market); setContext(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }

  async function recover(jobId: string, recoveryToken: string) {
    const response = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}`, { headers: { "PULSE-RECOVERY-TOKEN": recoveryToken } });
    if (!response.ok) throw new Error(`Prediction recovery failed (${response.status})`);
    const payload = await response.json() as { job?: { stage?: string } };
    const stage = payload.job?.stage || ""; setJobStage(stage);
    if (stage === "completed" || stage === "completed_partial") {
      const report = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}/report`, { headers: { "PULSE-RECOVERY-TOKEN": recoveryToken } });
      if (!report.ok) throw new Error(`Prediction report recovery failed (${report.status})`);
      const body = await report.json() as { report?: Record<string, unknown> };
      if (body.report) setResult(body.report);
      clearJobRecovery(localStorage, networkKey, "prediction"); setJobStage("");
    }
    return stage;
  }

  useEffect(() => {
    const saved = readJobRecovery(localStorage, networkKey, "prediction");
    if (saved) void recover(saved.jobId, saved.recoveryToken).catch(() => undefined);
  }, [networkKey]);

  async function analyze(tier: "standard" | "premium") {
    if (!selected || !context) return setError("Select a prediction and load its live context first.");
    if (!wallet) { onNeedWallet(); return; }
    const route = `/v1/analysis/prediction/${tier}`;
    setBusy(tier); setError(""); setResult(null);
    try {
      const [balances, gateway] = await Promise.all([fetchNetworkBalances(wallet, networkKey), networkKey === "arc-testnet" ? fetchArcGatewayBalance(wallet) : Promise.resolve(null)]);
      assertPaymentBalance(networkKey === "arc-testnet" ? gateway : balances.payment, prices[route], network.payment.symbol, network.label);
      const paidFetch = await createWalletPaidFetch(wallet, networkKey);
      const response = await paidFetch(`${API_BASE}/${network.route}${route}`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ primaryMarketId: selected.id, additionalMarketIds: [], lang, userNote: note || undefined }),
      });
      const data = await response.json().catch(() => ({})) as { job?: { id?: string; stage?: string }; recoveryToken?: string } & Record<string, unknown>;
      if (!response.ok) throw new Error(JSON.stringify(data).slice(0, 500));
      if (response.status === 202 && data.job?.id && data.recoveryToken) {
        saveJobRecovery(localStorage, networkKey, { jobId: data.job.id, recoveryToken: data.recoveryToken }, "prediction");
        setJobStage(data.job.stage || "payment_settled");
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const stage = await recover(data.job.id, data.recoveryToken);
          if (["completed", "completed_partial", "failed_retriable", "failed_terminal", "manual_reconciliation"].includes(stage)) break;
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        }
      } else setResult(data);
      onBalancesChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }

  return <>
    <div className="card prediction-workspace">
      <div className="section">1 · Select a crypto prediction</div>
      <button type="button" className="selector-trigger prediction-selector" onClick={() => { setPickerOpen(true); if (!markets.length) void loadMarkets(); }}>
        <span><small>Polymarket question</small><b>{selected?.question || "Choose a live crypto prediction"}</b></span><strong>Browse markets⌄</strong>
      </button>
      {selected && <>
        <div className="section">2 · Live market context</div>
        {busy === "context" && <div className="picker-state">Loading order book and market evidence…</div>}
        {context && <>
          <div className="prediction-outcomes">{selected.outcomes.map((outcome) => <div key={outcome.tokenId}><span>{outcome.name}</span><strong>{outcome.referencePrice == null ? "—" : `${(outcome.referencePrice * 100).toFixed(1)}%`}</strong></div>)}</div>
          <div className="prediction-metrics"><div><span>Liquidity</span><b>{money(selected.liquidityUsd)}</b></div><div><span>Volume</span><b>{money(selected.volumeUsd)}</b></div></div>
          <div className="prediction-orderbooks">{(context.books || []).map((row) => {
            const bid = row.book.bids.reduce((best, item) => Math.max(best, Number(item.price)), 0);
            const ask = row.book.asks.reduce((best, item) => Math.min(best, Number(item.price)), 1);
            return <div className="market-evidence-row" key={row.tokenId}><span>{row.outcome}</span><b>Bid {(bid * 100).toFixed(1)}% · Ask {(ask * 100).toFixed(1)}%</b><small>Spread {((ask - bid) * 100).toFixed(2)} points</small></div>;
          })}</div>
          <div className="prediction-meta"><span>Ends {selected.endDate ? new Date(selected.endDate).toLocaleString() : "not published"}</span><span>Open interest {context.openInterest ?? "Unavailable"}</span><span>{selected.eligibility === "restricted" ? "Read-only · trading restricted" : "Active"}</span></div>
          <details><summary>Resolution rules and source</summary><p>{selected.description}</p><p>{selected.resolutionSource || "No separate resolution source published."}</p></details>
          <div className="field"><label htmlFor="prediction-note">Focus note (optional) <Tip text="Tell the analyst what matters most to you. Examples: assess the Up case, challenge the market consensus, focus on catalysts, liquidity quality, resolution risk, or what would invalidate the current probability." /></label><input id="prediction-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: assess the Up case and its strongest counter-argument" /><small className="field-hint">Optional guidance for the report—not a new prediction or an order.</small></div>
          <div className="section">3 · Choose report depth</div>
          {!wallet && <p className="wallet-guidance">Connect once from the header to purchase a report.</p>}
          <div className="actions stack">
            <button className="btn btn-primary full" disabled={Boolean(busy)} onClick={() => void analyze("standard")}>Base prediction analysis · ${prices["/v1/analysis/prediction/standard"].toFixed(2)}<small>Drivers, market quality, risks, invalidation and concise conclusion.</small></button>
            <button className="btn btn-accent full" disabled={Boolean(busy)} onClick={() => void analyze("premium")}>Premium prediction analysis · ${prices["/v1/analysis/prediction/premium"].toFixed(2)}<small>Detailed scenarios, catalysts, counter-case, evidence weighting and checklist.</small></button>
          </div>
        </>}
      </>}
      {error && <div className="err">{error}</div>}
    </div>
    <div className="card report-card"><div className="section">Prediction report</div>
      {!result && <div className="report-empty"><div className="signal-orbit" aria-hidden><i /><i /><i /></div><h3>{jobStage ? jobStage.replaceAll("_", " ") : "Your prediction report lands here"}</h3><p>Select one crypto prediction, review its live evidence, then choose base or premium analysis.</p></div>}
      {result && <PredictionAnalysisReport data={result} />}
    </div>
    {pickerOpen && <div className="picker-layer" role="dialog" aria-modal="true" aria-label="Choose crypto prediction"><button className="picker-backdrop" type="button" onClick={() => setPickerOpen(false)} aria-label="Close" /><div className="picker-dialog"><div className="picker-head"><div><span className="eyebrow">Crypto prediction markets</span><h3>Choose one question</h3></div><button type="button" onClick={() => setPickerOpen(false)}>×</button></div><div className="picker-search-wrap"><input className="picker-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search BTC, ETH, SOL…" /><button className="btn btn-soft" type="button" onClick={() => void loadMarkets(query)}>Search</button></div><div className="prediction-picker-list">{markets.map((market) => <button type="button" key={market.id} onClick={() => void chooseMarket(market)}><span>{market.question}</span><small>{money(market.volumeUsd)} volume · {market.endDate ? new Date(market.endDate).toLocaleDateString() : "No end date"}</small></button>)}{!markets.length && <div className="picker-state">{busy === "markets" ? "Loading live crypto markets…" : "No matching live crypto price or direction markets."}</div>}</div></div></div>}
  </>;
}
