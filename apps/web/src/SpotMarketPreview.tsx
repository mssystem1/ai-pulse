import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiGet } from "./api";
import type { Lang } from "./i18n";
import { formatMarketPrice } from "./format";
import { createMarketPreviewLoader, sparklinePoints, type MarketCandle, type MarketPreviewData } from "./marketPreview";
import "./spotMarketPreview.css";

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

function CandleChart({ candles, count, lang }: { candles: MarketCandle[]; count: number; lang: Lang }) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const visible = candles.slice(-count), height = 240, left = 8, right = width < 500 ? 80 : 98, top = 15, bottom = 32;
  const min = Math.min(...visible.map(c => c.low)), max = Math.max(...visible.map(c => c.high));
  const span = max - min || Math.max(max * .01, .000001), low = min - span * .08, high = max + span * .08;
  const y = (price: number) => top + (high - price) / (high - low) * (height - top - bottom);
  const step = (width - left - right) / visible.length;
  return <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={lang === "zh" ? "OKX 市场 K 线图" : "OKX market candlestick chart"}>
    {[0, 1, 2, 3].map(i => { const price = low + (high - low) * i / 3; return <g key={i}><line x1={left} x2={width - right} y1={y(price)} y2={y(price)} className="market-chart-grid" /><text x={width - right + 8} y={y(price) + 4}>{formatMarketPrice(price, lang)}</text></g>; })}
    {visible.map((c, i) => { const x = left + step * (i + .5), color = c.close >= c.open ? "var(--mint)" : "var(--red,#f87171)"; return <g key={c.ts} style={{ color }}><title>{`${new Date(c.ts).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")} · O ${c.open} H ${c.high} L ${c.low} C ${c.close}`}</title><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke="currentColor" /><rect x={x - step * .3} y={Math.min(y(c.open), y(c.close))} width={Math.max(1, step * .6)} height={Math.max(1.2, Math.abs(y(c.open) - y(c.close)))} fill="currentColor" /></g>; })}
    {[visible[0], visible.at(-1)].map((c, i) => c && <text key={i} x={i ? width - right : left} y={height - 7} textAnchor={i ? "end" : "start"}>{new Date(c.ts).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", width < 500 ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</text>)}
  </svg>;
}

function ExpandedMarketChart({ pair, timeframe, lang, onClose }: { pair: string; timeframe: string; lang: Lang; onClose: () => void }) {
  const [frame, setFrame] = useState(timeframe), [count, setCount] = useState(48);
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, error, refresh } = useMarketPreview(pair, frame, true);
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previous; if (focus?.isConnected) focus.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="spot-chart-dialog" aria-label={`${pair} ${lang === "zh" ? "市场图表" : "market chart"}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header><div><small>OKX · {lang === "zh" ? "市场参考" : "MARKET REFERENCE"}</small><h2>{pair}</h2></div><button type="button" autoFocus onClick={onClose} aria-label={lang === "zh" ? "关闭图表" : "Close chart"}>×</button></header>
    <div className="spot-chart-controls"><label>{lang === "zh" ? "周期" : "Timeframe"}<select value={frame} onChange={e => setFrame(e.target.value)}>{["15m", "1H", "4H", "1D"].map(f => <option key={f}>{f}</option>)}</select></label><div><button type="button" onClick={() => setCount(v => Math.min(100, v * 2))} disabled={count >= 100} aria-label={lang === "zh" ? "缩小" : "Zoom out"}>−</button><span>{Math.min(count, data?.candles.length || count)} {lang === "zh" ? "根 K 线" : "candles"}</span><button type="button" onClick={() => setCount(v => Math.max(12, Math.floor(v / 2)))} disabled={count <= 12} aria-label={lang === "zh" ? "放大" : "Zoom in"}>+</button></div></div>
    {data ? <><strong className="spot-chart-price">{formatMarketPrice(data.ticker.last, lang)} {pair.split("-")[1]}</strong><CandleChart candles={data.candles} count={count} lang={lang} /></> : <p role="status">{error ? (lang === "zh" ? "市场数据暂不可用。" : "Market data temporarily unavailable.") : (lang === "zh" ? "正在加载市场数据…" : "Loading market data…")}</p>}
    {error && <button type="button" onClick={refresh}>{lang === "zh" ? "重试" : "Retry"}</button>}
    <p className="market-source-note">{error && data ? (lang === "zh" ? "更新失败，显示上次数据。 " : "Refresh failed; showing the last snapshot. ") : ""}{lang === "zh" ? "OKX 现货参考价格；非链上成交报价。最新 K 线可能尚未收盘。" : "OKX spot reference, not an executable on-chain quote. The newest candle may still be open."}</p>
  </dialog>, document.body);
}

export function ShortlistMarketChart({ pair, timeframe, mark, history, fetchedAt, lang }: { pair: string; timeframe: string; mark: number; history?: number[]; fetchedAt: string; lang: Lang }) {
  const [expanded, setExpanded] = useState(false);
  const points = sparklinePoints(history || []);
  return <div className="shortlist-market-snapshot"><span><b>{formatMarketPrice(mark, lang)}</b><small>{pair.split("-")[1]} · {timeframe}</small></span><button type="button" className={`shortlist-sparkline ${(history?.at(-1) ?? 0) < (history?.[0] ?? 0) ? "declining" : ""}`} aria-label={`${lang === "zh" ? "打开市场图表" : "Open market chart"} ${pair}`} onClick={() => setExpanded(true)}>
    {points ? <svg viewBox="0 0 240 56" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : <span>{lang === "zh" ? "查看图表" : "View chart"}</span>}<small>{lang === "zh" ? "点击放大" : "Tap to expand"} ↗</small>
  </button><small className="market-source-note">OKX · {Number.isFinite(Date.parse(fetchedAt)) ? new Date(fetchedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}</small>{expanded && <ExpandedMarketChart pair={pair} timeframe={timeframe} lang={lang} onClose={() => setExpanded(false)} />}</div>;
}

export function SpotMarketPreview({ pair, timeframe, lang, context = "spot" }: { pair: string; timeframe: string; lang: Lang; context?: "spot" | "autopilot" }) {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true), [expanded, setExpanded] = useState(false);
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
    <header><div><small>{lang === "zh" ? "市场快照 · OKX" : "MARKET SNAPSHOT · OKX"}</small><strong>{pair}</strong></div><span className="market-source-note">{stateLabel} · {data ? new Date(Number(data.ticker.ts)).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span></header>
    {data ? <><div className="spot-market-details"><div className="spot-market-price"><b>{formatMarketPrice(data.ticker.last, lang)}</b><small>{pair.split("-")[1]} <span className={data.ticker.change24hPct >= 0 ? "positive" : "negative"}>{data.ticker.change24hPct > 0 ? "+" : ""}{data.ticker.change24hPct.toFixed(2)}% · 24h</span></small></div><dl><div><dt>{lang === "zh" ? "24h 最高" : "24h high"}</dt><dd>{formatMarketPrice(data.ticker.high24h, lang)}</dd></div><div><dt>{lang === "zh" ? "24h 最低" : "24h low"}</dt><dd>{formatMarketPrice(data.ticker.low24h, lang)}</dd></div><div><dt>{lang === "zh" ? "24h 成交额" : "24h volume"} · {pair.split("-")[1]}</dt><dd>{new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { notation: "compact", maximumFractionDigits: 2 }).format(data.ticker.volCcy24h)}</dd></div></dl></div><button type="button" className="spot-preview-chart" onClick={() => setExpanded(true)} aria-label={`${lang === "zh" ? "打开市场图表" : "Open market chart"} ${pair}`}><CandleChart candles={data.candles} count={48} lang={lang} /><small>{timeframe} · {lang === "zh" ? "点击放大图表" : "Open chart to zoom"} ↗</small></button></> : <p role="status">{error ? (lang === "zh" ? "市场数据暂不可用，交易单仍可配置。" : "Market data unavailable. You can still configure the ticket.") : (lang === "zh" ? "正在加载所选市场…" : "Loading selected market…")}</p>}
    {error && <button type="button" onClick={refresh}>{lang === "zh" ? "重试市场数据" : "Retry market data"}</button>}
    <small className="market-source-note">{context === "autopilot" ? (lang === "zh" ? "OKX 参考行情，可见时每 30 秒更新。图表可含未收盘 K 线；自动驾驶只在已收盘 K 线上验证入场条件。查看图表不会启动策略或消耗 AI 次数。" : "OKX reference data, refreshed every 30s while visible. The chart can include an open candle; Autopilot evaluates entries on closed candles. Viewing this chart does not activate a strategy or consume AI confirmations.") : lang === "zh" ? "OKX 参考行情，每 30 秒更新。实际成交使用下方所选网络的实时报价。" : "OKX reference data, refreshed every 30s while visible. Execution uses the selected network's live quote below."}</small>
    {expanded && <ExpandedMarketChart pair={pair} timeframe={timeframe} lang={lang} onClose={() => setExpanded(false)} />}
  </section>;
}
