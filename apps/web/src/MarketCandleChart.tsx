import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type LogicalRange, type Time } from "lightweight-charts";
import type { Lang } from "./i18n";
import { formatMarketPrice } from "./format";
import type { MarketCandle, TradeMarker } from "./marketPreview";
import { CANDLE_DOWN, CANDLE_UP, candlePriceStep, chartCandles, chartFillMarkers, readableCandleCount } from "./candleChartData";

type ChartInstance = { chart: IChartApi; series: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; markers: ISeriesMarkersPluginApi<Time>; initialized: boolean };
const EMPTY_MARKERS: TradeMarker[] = [];

/** Local renderer only: no TradingView feed, script CDN, credentials or payment. */
export default function MarketCandleChart({ candles, timeframe, lang, markers = EMPTY_MARKERS, interactive = true }: {
  candles: MarketCandle[]; timeframe: string; lang: Lang; markers?: TradeMarker[]; interactive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null), instance = useRef<ChartInstance | null>(null);
  const bars = useMemo(() => chartCandles(candles), [candles]);
  const fills = useMemo(() => chartFillMarkers(markers, bars, timeframe), [markers, bars, timeframe]);
  const latest = useRef({ bars, candles, fills });
  latest.current = { bars, candles, fills };
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [range, setRange] = useState<LogicalRange | null>(null);
  const locale = lang === "zh" ? "zh-CN" : "en-US";

  const resetView = () => {
    const current = instance.current;
    if (!current || !host.current || !latest.current.bars.length) return;
    const length = latest.current.bars.length, count = Math.min(length, readableCandleCount(host.current.clientWidth));
    current.chart.priceScale("right").applyOptions({ autoScale: true });
    current.chart.timeScale().setVisibleLogicalRange({ from: length - count, to: length - 1 + 3 });
  };
  const zoom = (factor: number) => {
    const chart = instance.current?.chart, current = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !current) return;
    const width = Math.min(Math.max(8, (current.to - current.from) * factor), Math.max(12, latest.current.bars.length + 6));
    chart.timeScale().setVisibleLogicalRange({ from: current.to - width, to: current.to });
  };
  const pan = (direction: number) => {
    const chart = instance.current?.chart, current = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !current) return;
    const delta = direction * (current.to - current.from) * .3;
    chart.timeScale().setVisibleLogicalRange({ from: current.from + delta, to: current.to + delta });
  };

  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#05070c" }, textColor: "#b8c4d7", fontSize: 12, fontFamily: "system-ui, sans-serif", attributionLogo: true },
      rightPriceScale: { borderVisible: false, minimumWidth: 70, scaleMargins: { top: .12, bottom: .27 } },
      timeScale: { timeVisible: timeframe !== "1D", secondsVisible: false, borderVisible: false, rightOffset: 3, minBarSpacing: 3, fixLeftEdge: true, fixRightEdge: true },
      grid: { vertLines: { visible: false }, horzLines: { color: "#ffffff12" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: interactive, labelVisible: interactive }, horzLine: { visible: interactive, labelVisible: interactive } },
      handleScroll: interactive ? { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false } : false,
      handleScale: interactive ? { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true } : false,
      kineticScroll: { mouse: false, touch: interactive },
      localization: { locale, timeFormatter: (time: Time) => typeof time === "number" ? `${new Date(time * 1000).toLocaleString(locale, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} UTC` : String(time) },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: CANDLE_UP, downColor: CANDLE_DOWN, wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN, borderVisible: false, priceLineVisible: true });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 }, visible: false });
    const markerPlugin = createSeriesMarkers(series, [], { autoScale: false });
    instance.current = { chart, series, volume, markers: markerPlugin, initialized: false };
    const updateTheme = () => {
      const style = getComputedStyle(host.current!), light = document.documentElement.dataset.pulseTheme === "base";
      chart.applyOptions({ layout: { background: { type: ColorType.Solid, color: style.getPropertyValue("--bg").trim() || "#05070c" }, textColor: style.getPropertyValue("--text").trim() || "#e9eef7" }, grid: { horzLines: { color: light ? "#10182812" : "#ffffff12" } } });
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-pulse-theme", "class", "style"] });
    const changed = (value: LogicalRange | null) => setRange(value);
    chart.timeScale().subscribeVisibleLogicalRangeChange(changed);
    chart.subscribeCrosshairMove(event => { if (interactive) setHoverTime(typeof event.time === "number" ? event.time : null); });
    return () => { observer.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(changed); instance.current = null; chart.remove(); };
  }, [interactive, locale, timeframe]);

  useEffect(() => {
    const current = instance.current;
    if (!current || !bars.length) return;
    const scale = current.chart.timeScale(), previousRange = scale.getVisibleRange(), following = scale.scrollPosition() <= 4;
    current.series.applyOptions({ priceFormat: { type: "custom", formatter: (price: number) => formatMarketPrice(price, lang), minMove: candlePriceStep(bars) } });
    current.series.setData(bars);
    const volumes = new Map(candles.map(c => [Math.floor(c.ts / 1000), c.volume]));
    current.volume.setData(bars.flatMap(bar => { const value = volumes.get(bar.time); return Number.isFinite(value) && value! >= 0 ? [{ time: bar.time, value: value!, color: bar.close >= bar.open ? "#26a69a55" : "#ef535055" }] : []; }));
    current.markers.setMarkers(fills);
    if (!current.initialized) { resetView(); current.initialized = true; }
    else if (!following && previousRange) scale.setVisibleRange(previousRange);
  }, [bars, candles, fills, lang, interactive, locale, timeframe]);

  const selected = bars.find(bar => bar.time === hoverTime) || bars.at(-1);
  const selectedVolume = selected ? candles.find(c => Math.floor(c.ts / 1000) === selected.time)?.volume : undefined;
  const shown = range ? Math.max(0, Math.min(bars.length - 1, Math.floor(range.to)) - Math.max(0, Math.ceil(range.from)) + 1) : 0;
  return <div className={`market-candle-chart ${interactive ? "interactive" : "preview"}`} data-marker-count={fills.length} data-range-from={range?.from} data-range-to={range?.to}>
    <div className="candle-readout" aria-label={lang === "zh" ? "蜡烛数据" : "Candle data"}>
      <span className="candle-time">{selected ? `${new Date(selected.time * 1000).toLocaleString(locale, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} UTC` : "—"}</span>
      <dl>{([ ["O", selected?.open], ["H", selected?.high], ["L", selected?.low], ["C", selected?.close] ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === undefined ? "—" : formatMarketPrice(value, lang)}</dd></div>)}</dl>
      <small>{lang === "zh" ? "成交量" : "Volume"} {Number.isFinite(selectedVolume) ? new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(selectedVolume!) : "—"} · {lang === "zh" ? "基础资产数量" : "base units"}</small>
    </div>
    <div ref={host} className="candle-canvas" tabIndex={interactive ? 0 : undefined} role="group" aria-label={lang === "zh" ? "交互式市场 K 线图" : "Market candlestick chart"} onKeyDown={event => {
      if (!interactive || !["ArrowLeft", "ArrowRight", "+", "=", "-", "Home"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") resetView(); else if (event.key === "ArrowLeft") pan(-1); else if (event.key === "ArrowRight") pan(1); else zoom(event.key === "-" ? 1.35 : 1 / 1.35);
    }} />
    {interactive && <div className="candle-chart-toolbar" role="group" aria-label={lang === "zh" ? "图表视图" : "Chart view"}>
      <div><button type="button" onClick={() => zoom(1.35)} aria-label={lang === "zh" ? "缩小" : "Zoom out"}>−</button><button type="button" onClick={() => zoom(1 / 1.35)} aria-label={lang === "zh" ? "放大" : "Zoom in"}>+</button><button type="button" onClick={resetView}>{lang === "zh" ? "重置视图" : "Reset view"}</button></div>
      <small>{shown} / {bars.length} {lang === "zh" ? "根 K 线" : "candles in view"}</small>
    </div>}
    {interactive && <p className="candle-interaction-hint">{lang === "zh" ? "拖动平移 · 滚轮/双指缩放 · 长按查看蜡烛数据 · 时间为 UTC" : "Drag to pan · scroll/pinch to zoom · hover or long-press to inspect · UTC"}</p>}
    <small className="candle-attribution">TradingView Lightweight Charts™ · Copyright (с) 2025–2026 <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView, Inc.</a> · <a href="/chart-licenses.txt" target="_blank" rel="noopener noreferrer">{lang === "zh" ? "许可证" : "Licenses"}</a></small>
  </div>;
}
