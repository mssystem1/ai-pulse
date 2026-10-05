import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiGet } from "./api";
import type { Lang } from "./i18n";
import { formatMarketPrice } from "./format";
import { createMarketPreviewLoader, loadHistoricalCandles, sparklinePoints, marketPairLabel, marketPriceCurrency, isRobinhoodMarketPair, isArcMarketPair, type MarketCandle, type MarketPreviewData, type TradeMarker } from "./marketPreview";
import "./spotMarketPreview.css";
const MarketCandleChart = lazy(() => import("./MarketCandleChart"));

export const loadMarketPreview = createMarketPreviewLoader(path => apiGet(path, { signal: AbortSignal.timeout(12_000) }));

function useMarketPreview(pair: string, timeframe: string, active: boolean) {
  const [state, setState] = useState<{ key: string; data?: MarketPreviewData; error?: string }>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  const key = `${pair}:${timeframe}`;
  useEffect(() => {
    if (!active) return;
    let current = true, loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const data = await loadMarketPreview(pair, timeframe);
        if (current) setState({ key, data });
      } catch (error) {
        if (current) setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, error: String(error) }));
      } finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { current = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [pair, timeframe, key, active, attempt]);
  return { ...(state.key === key ? state : {}), refresh: () => setAttempt(value => value + 1) };
}


function ExpandedMarketChart({ pair, timeframe, lang, onClose, markers = [] }: { pair: string; timeframe: string; lang: Lang; onClose: () => void; markers?: TradeMarker[] }) {
  const [frame, setFrame] = useState(timeframe);
  const [before, setBefore] = useState<number | null>(null);
  const [newer, setNewer] = useState<Array<number | null>>([]);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [history, setHistory] = useState<{ key: string; candles?: MarketCandle[]; error?: string }>({ key: "" });
  const historyKey = `${pair}:${frame}:${before}`;
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, error, refresh } = useMarketPreview(pair, frame, before === null);
  useEffect(() => {
    if (before === null) return;
    let active = true;
    setHistory({ key: historyKey });
    void loadHistoricalCandles(apiGet, pair, frame, before).then(candles => {
      if (active) setHistory({ key: historyKey, candles });
    }, error => { if (active) setHistory({ key: historyKey, error: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [historyKey, historyAttempt, before, pair, frame]);
  const pageCandles = before === null ? data?.candles : history.key === historyKey ? history.candles : undefined;
  const pageError = before === null ? error : history.key === historyKey ? history.error : undefined;
  const latest = () => { setBefore(null); setNewer([]); };
  const olderPage = () => { if (!pageCandles?.length) return; setNewer(values => [...values, before]); setBefore(pageCandles[0].ts); };
  const newerPage = () => { setBefore(newer.at(-1) ?? null); setNewer(values => values.slice(0, -1)); };
  const showFill = (ts: number) => { setNewer([null]); setBefore(ts + 1); };
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previous; if (focus?.isConnected) focus.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="spot-chart-dialog" aria-label={`${pair} ${lang === "zh" ? "市场图表" : "market chart"}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header><div><small>{isArcMarketPair(pair) ? "ARC DEX" : "OKX"} · {lang === "zh" ? "市场参考" : "MARKET REFERENCE"}</small><h2>{marketPairLabel(pair)}</h2></div><button type="button" autoFocus onClick={onClose} aria-label={lang === "zh" ? "关闭图表" : "Close chart"}>×</button></header>
    <div className="spot-chart-controls"><label>{lang === "zh" ? "周期" : "Timeframe"}<select value={frame} onChange={e => { setFrame(e.target.value); latest(); }}>{["15m", "1H", "4H", "1D"].map(f => <option key={f}>{f}</option>)}</select></label><small>{before === null ? (lang === "zh" ? "最新行情" : "Latest market window") : (lang === "zh" ? "历史行情" : "Historical market window")}</small></div>
    <nav className="chart-history-navigation" aria-label="Candle history"><button type="button" disabled={!pageCandles?.length} onClick={olderPage}>{lang === "zh" ? "更早" : "← Older"}</button><button type="button" disabled={before === null} onClick={newerPage}>{lang === "zh" ? "更新" : "Newer →"}</button><button type="button" disabled={before === null} onClick={latest}>{lang === "zh" ? "最新" : "Latest"}</button></nav>
    {pageCandles?.length ? <>{before === null && data && <strong className="spot-chart-price">{formatMarketPrice(data.ticker.last, lang)} {marketPriceCurrency(pair)}</strong>}<Suspense fallback={<p role="status">{lang === "zh" ? "正在加载图表…" : "Loading chart…"}</p>}><MarketCandleChart key={historyKey} candles={pageCandles} timeframe={frame} lang={lang} markers={markers} /></Suspense></> : <p role="status">{pageError ? (lang === "zh" ? "市场数据暂不可用。" : "Market data temporarily unavailable. Retry this range.") : pageCandles ? (lang === "zh" ? "此范围没有更早的数据。" : "The provider returned no older candles for this range. Use Newer or Latest.") : (lang === "zh" ? "正在加载市场数据…" : "Loading market data…")}</p>}
    {markers.length > 0 && <details className="chart-fill-history"><summary>{lang === "zh" ? "已确认成交" : "Confirmed fills"} · {markers.length}</summary><p>{lang === "zh" ? "B 买入 · S 卖出。选择成交以打开该时间段。" : "B = Buy · S = Sell. Select a fill to open its candle window; use Older/Newer to browse history."}</p><div>{markers.map(m => <p key={m.id}><button type="button" className="chart-fill-jump" onClick={() => showFill(m.ts)} aria-label={`Show ${m.side} fill ${new Date(m.ts).toISOString()}`}><strong>{m.side === "buy" ? "BUY" : "SELL"}</strong> · {formatMarketPrice(m.price, lang)} {pair.split("-").at(-1)} · {new Date(m.ts).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")} ↗</button></p>)}</div></details>}
    {pageError && <button type="button" onClick={() => before === null ? refresh() : setHistoryAttempt(value => value + 1)}>{lang === "zh" ? "重试" : "Retry"}</button>}
    <p className="market-source-note">{before === null && error && data ? (lang === "zh" ? "更新失败，显示上次数据。 " : "Refresh failed; showing the last snapshot. ") : ""}{isArcMarketPair(pair) ? (lang === "zh" ? "RadarDex 经 Arcodex 提供此合约的 USDC 行情；非可执行报价。最新 K 线可能尚未收盘。" : "Contract-specific USDC history from RadarDex via Arcodex; not an executable quote. The newest candle may still be open.") : lang === "zh" ? "OKX 现货参考价格；非链上成交报价。最新 K 线可能尚未收盘。" : "OKX spot reference, not an executable on-chain quote. The newest candle may still be open."}</p>
  </dialog>, document.body);
}

export function ShortlistMarketChart({ pair, timeframe, mark, history, fetchedAt, lang }: { pair: string; timeframe: string; mark: number; history?: number[]; fetchedAt: string; lang: Lang }) {
  const [expanded, setExpanded] = useState(false);
  const points = sparklinePoints(history || []);
  return <div className="shortlist-market-snapshot"><span><b>{formatMarketPrice(mark, lang)}</b><small>{marketPriceCurrency(pair)} · {timeframe}</small></span><button type="button" className={`shortlist-sparkline ${(history?.at(-1) ?? 0) < (history?.[0] ?? 0) ? "declining" : ""}`} aria-label={`${lang === "zh" ? "打开市场图表" : "Open market chart"} ${pair}`} onClick={() => setExpanded(true)}>
    {points ? <svg viewBox="0 0 240 56" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : <span>{lang === "zh" ? "查看图表" : "View chart"}</span>}<small>{lang === "zh" ? "点击放大" : "Tap to expand"} ↗</small>
  </button><small className="market-source-note">{isArcMarketPair(pair) ? "ARC DEX" : "OKX"} · {Number.isFinite(Date.parse(fetchedAt)) ? new Date(fetchedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}</small>{expanded && <ExpandedMarketChart pair={pair} timeframe={timeframe} lang={lang} onClose={() => setExpanded(false)} />}</div>;
}

export function MarketChartPreview({ candles, pair, timeframe, lang, markers = [] }: { candles: MarketCandle[]; pair: string; timeframe: string; lang: Lang; markers?: TradeMarker[] }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="spot-preview-chart"><Suspense fallback={<p role="status">{lang === "zh" ? "正在加载图表…" : "Loading chart…"}</p>}><MarketCandleChart key={`${pair}:${timeframe}`} candles={candles} timeframe={timeframe} lang={lang} markers={markers} interactive={false} /></Suspense><button type="button" className="spot-chart-expand" onClick={() => setExpanded(true)} aria-label={`${lang === "zh" ? "打开市场图表" : "Open market chart"} ${pair}`}>{timeframe} · {lang === "zh" ? "放大并探索图表" : "Expand & explore chart"} ↗</button>{expanded && <ExpandedMarketChart pair={pair} timeframe={timeframe} lang={lang} markers={markers} onClose={() => setExpanded(false)} />}</div>;
}

export function SpotMarketPreview({ pair, timeframe, lang, context = "spot", markers = [] }: { pair: string; timeframe: string; lang: Lang; context?: "spot" | "autopilot"; markers?: TradeMarker[] }) {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true);
  const { data, error, refresh } = useMarketPreview(pair, timeframe, visible);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const stale = !!error || !!data && Date.now() - Number(data.ticker.ts) > 90_000;
  const stateLabel = !data ? (error ? (lang === "zh" ? "暂不可用" : "Unavailable") : (lang === "zh" ? "加载中" : "Loading")) : stale ? (lang === "zh" ? "旧数据" : "Stale snapshot") : (lang === "zh" ? "自动更新" : "Auto-updating");
  return <section ref={root} className="spot-market-preview" aria-label={`${pair} ${lang === "zh" ? "市场快照" : "market snapshot"}`}>
    <header><div><small>{isArcMarketPair(pair) ? (lang === "zh" ? "市场快照 · ARC DEX" : "MARKET SNAPSHOT · ARC DEX") : lang === "zh" ? "市场快照 · OKX" : "MARKET SNAPSHOT · OKX"}</small><strong>{marketPairLabel(pair)}</strong></div><span className="market-source-note">{stateLabel} · {data ? new Date(Number(data.ticker.ts)).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span></header>
    {data ? <><div className="spot-market-details"><div className="spot-market-price"><b>{formatMarketPrice(data.ticker.last, lang)}</b><small>{marketPriceCurrency(pair)} <span className={data.ticker.change24hPct >= 0 ? "positive" : "negative"}>{data.ticker.change24hPct > 0 ? "+" : ""}{data.ticker.change24hPct.toFixed(2)}% · 24h</span></small></div><dl><div><dt>{lang === "zh" ? "24h 最高" : "24h high"}</dt><dd>{formatMarketPrice(data.ticker.high24h, lang)}</dd></div><div><dt>{lang === "zh" ? "24h 最低" : "24h low"}</dt><dd>{formatMarketPrice(data.ticker.low24h, lang)}</dd></div><div><dt>{lang === "zh" ? "24h 成交额" : "24h volume"} · {marketPriceCurrency(pair)}</dt><dd>{new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { notation: "compact", maximumFractionDigits: 2 }).format(data.ticker.volCcy24h)}</dd></div></dl></div><MarketChartPreview candles={data.candles} pair={pair} timeframe={timeframe} lang={lang} markers={markers} /></> : <p role="status">{error ? (lang === "zh" ? "市场数据暂不可用，交易单仍可配置。" : "Market data unavailable. You can still configure the ticket.") : (lang === "zh" ? "正在加载所选市场…" : "Loading selected market…")}</p>}
    {error && <button type="button" onClick={refresh}>{lang === "zh" ? "重试市场数据" : "Retry market data"}</button>}
    {isRobinhoodMarketPair(pair) && <small className="market-source-note">{lang === "zh" ? "图表价格以美元计价；交易和成交价以 USDG 结算。USDG 的市场价格可能偏离 1 美元。24 小时统计为小时 K 线的近似汇总。" : "Chart prices are in USD; trades and recorded fills settle in USDG. USDG may trade above or below $1. Day statistics are approximate aggregates of 24 hourly candles."}</small>}
    <small className="market-source-note">{isArcMarketPair(pair) ? (lang === "zh" ? "RadarDex 经 Arcodex 提供此合约的 USDC 行情。24 小时统计和基础代币成交量为近似值；实际成交需另行验证实时报价。自动驾驶使用已收盘 K 线，查看图表不会启动策略。" : "Contract-specific USDC market data from RadarDex via Arcodex. Day statistics and base-token volume are approximate; execution requires a separate live quote. Autopilot uses completed candles; viewing the chart does not start a strategy.") : context === "autopilot" ? (lang === "zh" ? "OKX 参考行情，可见时每 30 秒更新。图表可含未收盘 K 线；自动驾驶只在已收盘 K 线上验证入场条件。查看图表不会启动策略或消耗 AI 次数。" : "OKX reference data, refreshed every 30s while visible. The chart can include an open candle; Autopilot evaluates entries on closed candles. Viewing this chart does not activate a strategy or consume AI confirmations.") : lang === "zh" ? "OKX 参考行情，每 30 秒更新。实际成交使用下方所选网络的实时报价。" : "OKX reference data, refreshed every 30s while visible. Execution uses the selected network's live quote below."}</small>
  </section>;
}
