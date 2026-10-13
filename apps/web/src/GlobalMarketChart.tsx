import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, type UTCTimestamp, type AutoscaleInfo, type Time } from "lightweight-charts";
import { parseCandleTimeframe, globalChartAnnotations, globalReportChartSvg, globalLabel, globalPrice, globalTimeframeLabel, type GlobalReport, type GlobalChartLayers } from "@pulse/domain";
import { downloadGlobalChart } from "./globalChartDownload";

const stamp = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;
const palette = ["#ffcb76", "#b790ff", "#59c2ee", "#e593c2", "#71969b"];
const chartOptions = { layout: { background: { type: ColorType.Solid, color: "#0d1420" }, textColor: "#8d9cb3", fontSize: 11 }, grid: { vertLines: { visible: false }, horzLines: { color: "#263142", style: 2 } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: .1, bottom: .08 } }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false }, autoSize: true };

function ContextChart({ report }: { report: GlobalReport }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || report.context.status !== "available" || report.context.candles.length < 2) return;
    const chart = createChart(ref.current, { ...chartOptions, localization:{locale:report.lang==="zh"?"zh-CN":"en-US"}, height: 112, handleScroll: false, handleScale: false, timeScale: { visible: false }, rightPriceScale: { visible: false }, grid: { vertLines: { visible: false }, horzLines: { visible: false } } });
    const candles = report.context.candles.slice(-36), start = candles[0].ts;
    chart.addSeries(CandlestickSeries, { upColor: "#35d0aa", downColor: "#ef6b85", wickUpColor: "#35d0aa", wickDownColor: "#ef6b85", borderVisible: false }).setData(candles.map(c => ({ ...c, time: stamp(c.ts) })));
    chart.addSeries(LineSeries, { color: "#b58aff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(report.context.sma55.filter(p => p.ts >= start).map(p => ({ time: stamp(p.ts), value: p.value })));
    chart.timeScale().fitContent(); return () => chart.remove();
  }, [report]);
  const agreement=report.context.agreement==="conflicts"?(report.lang==="zh"?"与恢复冲突":"recovery conflicts with context"):report.context.agreement==="supports"?(report.lang==="zh"?"支持恢复":"context supports recovery"):report.context.agreement==="neutral"?(report.lang==="zh"?"中性":"neutral"):globalLabel("unavailable",report.lang);
  return <div className="global-context"><strong>{report.context.timeframe} {globalLabel("context", report.lang)}</strong>{report.context.status === "available" ? <><div ref={ref} style={{ height: 112 }} /><small>SMA55 {globalPrice(report,report.context.sma55.at(-1)?.value)} · {agreement}</small></> : <p>{globalLabel("unavailable", report.lang)}</p>}</div>;
}

export function GlobalMarketChart({ report, selectedPathId }: { report: GlobalReport; selectedPathId: string | null }) {
  const ref = useRef<HTMLDivElement>(null), reset = useRef<() => void>(() => {}),focus = useRef<() => void>(() => {});
  const pro = report.tier === "pro", [layers, setLayers] = useState<GlobalChartLayers>({ regression: pro, atr: pro });
  const [overlay, setOverlay] = useState({ svg: "", width: 0, height: 0 }), [readout, setReadout] = useState(""),[inspect,setInspect]=useState(false);
  const selection=useRef(selectedPathId);selection.current=selectedPathId;
  const overview=useMemo(()=>{const svg=globalReportChartSvg(report,{layers,selectedPathId}),height=pro?709:530;return svg?.replace(/height="\d+" viewBox="0 0 1300 \d+"/,`height="${height}" viewBox="0 65 1300 ${height}"`)??"";},[report,layers,selectedPathId,pro]);
  useEffect(() => {
    if (!ref.current || report.candles.length < 2) return;
    const lastTime = stamp(report.candles.at(-1)!.ts), unit = parseCandleTimeframe(report.snapshot.timeframe)?.unit;
    const chart = createChart(ref.current, { ...chartOptions, localization:{locale:report.lang==="zh"?"zh-CN":"en-US"}, height: pro ? 660 : 540, timeScale: { ...chartOptions.timeScale, timeVisible: unit === "minute" || unit === "hour", tickMarkFormatter: (time: Time) => typeof time === "number" && time > lastTime ? "" : null } });
    const values = report.view.levelIds.flatMap(id => report.levels.find(l => l.id === id)?.price ?? []);
    const candles = chart.addSeries(CandlestickSeries, { upColor: "#35d0aa", downColor: "#ef6b85", wickUpColor: "#35d0aa", wickDownColor: "#ef6b85", borderVisible: false, priceFormat: { type: "price", precision: report.snapshot.pricePrecision, minMove: 10 ** -report.snapshot.pricePrecision }, autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => { const info = base(); if (info?.priceRange && values.length) { info.priceRange.minValue = Math.min(info.priceRange.minValue, ...values); info.priceRange.maxValue = Math.max(info.priceRange.maxValue, ...values); } return info; } });
    const data = report.candles, last = data.at(-1)!, interval = data.length > 1 ? last.ts - data.at(-2)!.ts : 3600000;
    candles.setData([...data.map(c => ({ time: stamp(c.ts), open: c.open, high: c.high, low: c.low, close: c.close })), ...Array.from({ length: 300 }, (_, i) => ({ time: stamp(last.ts + interval * (i + 1)) }))]);
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 }, visible: false });
    volume.setData(data.map(c => ({ time: stamp(c.ts), value: c.volume, color: c.close >= c.open ? "#35d0aa40" : "#ef6b8540" })));
    const periods = pro && layers.allSmas ? [21, 55, 89, 144, 233] : report.view.smaPeriods;
    const addLine = (points: Array<{ ts: number; value: number }>, color: string, pane = 0, width:1|2=1) => { const series=chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,...(pane>0?{autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})}:{}) }, pane);series.setData(points.map(p => ({ time: stamp(p.ts), value: p.value })));if(pane>0)series.priceScale().applyOptions({scaleMargins:{top:0,bottom:0}}); };
    report.indicators.sma.forEach((s, i) => { if (periods.includes(s.period)) addLine(s.points, palette[i],0,s.period===55?2:1); });
    if (pro && layers.regression && report.indicators.regression) for (const points of [report.indicators.regression.upper, report.indicators.regression.mid, report.indicators.regression.lower]) addLine(points, "#31b8da");
    if (pro && layers.vwap && report.indicators.vwap) addLine(report.indicators.vwap.points, "#f8dea1");
    if (pro) {
      addLine(report.indicators.rsi.points, "#d4b479", 1);
      for (const value of [30, 50, 70]) addLine([{ ts: data[0].ts, value }, { ts: last.ts, value }], value===30?"#355e55":value===70?"#7a4659":"#465265", 1);
      chart.panes()[1]?.setHeight(170);
    }
    // fitContent excludes trailing whitespace in Quick. An explicit logical
    // range reserves the same future scenario space in both tiers.
    const resetView=()=>chart.timeScale().setVisibleLogicalRange({from:-5,to:data.length+300});
    resetView(); reset.current = resetView;
    focus.current=()=>chart.timeScale().setVisibleLogicalRange({from:Math.max(0,data.length-48),to:data.length+95});
    chart.subscribeCrosshairMove(event => { const candle = event.seriesData.get(candles); if (candle && "open" in candle) setReadout(`O ${globalPrice(report, candle.open)}  H ${globalPrice(report, candle.high)}  L ${globalPrice(report, candle.low)}  C ${globalPrice(report, candle.close)}`); });
    let frame = 0, prior = "", firstFrame=true;
    let previousWidth = chart.chartElement().clientWidth, previousRange = chart.timeScale().getVisibleLogicalRange();
    const render = () => {
      if(firstFrame){resetView();firstFrame=false;}
      const width = chart.chartElement().clientWidth, height = chart.panes()[0]?.getHeight() ?? 0;
      // Auto-size preserves bar spacing, which adds blank history on a wider
      // viewport. Preserve the user's logical range, including a focused setup.
      if(width > 0 && width !== previousWidth && previousRange) chart.timeScale().setVisibleLogicalRange(previousRange);
      previousWidth = width; previousRange = chart.timeScale().getVisibleLogicalRange();
      const historyEnd = chart.timeScale().timeToCoordinate(stamp(last.ts)), first = chart.timeScale().timeToCoordinate(stamp(data[0].ts));
      const signature = [width, height, historyEnd, first, candles.priceToCoordinate(last.close), candles.priceToCoordinate(data[0].low),selection.current].join("/");
      if (signature !== prior && width > 0 && historyEnd !== null) { prior = signature; const right = Math.max(historyEnd + 70, width - 210); setOverlay({ width, height, svg: globalChartAnnotations(report, { x: ts => chart.timeScale().timeToCoordinate(stamp(ts)), y: price => candles.priceToCoordinate(price), left: 8, right, top: 24, bottom: height - 12, historyEnd }, { layers, selectedPathId:selection.current }) }); }
      frame = requestAnimationFrame(render);
    }; frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); chart.remove(); reset.current = () => {};focus.current=()=>{}; };
  }, [report, pro, layers]);
  if (report.candles.length < 2) return <p>{globalLabel("chartUnavailable", report.lang)}</p>;
  // The phone overview uses the identical saved annotation renderer. Keep the
  // complete map visible; the native view remains available for candle inspection.
  const controls: Array<[keyof GlobalChartLayers, string]> = [["allSmas", "SMA 21/55/89/144/233"], ["regression", report.lang==="zh"?"120 根回归 ±2σ":"Regression 120 ±2σ"], ["fibonacci", "Fib 38.2/50/61.8"], ["vwap", report.lang==="zh"?"锚定 VWAP":"Anchored VWAP"], ["pivots", report.lang==="zh"?"已确认转折点":"Confirmed pivots"], ["atr", "ATR14"]];
  return <><div className="global-chart-toolbar"><div><strong>{report.snapshot.instId.split("-")[0]} · {pro?(report.lang==="zh"?"Pro 结构与计划证据":"Pro structure and setup evidence"):(report.lang==="zh"?"Quick 波浪结构与后续走势":"Quick Elliott structure and next move")}</strong><small>{report.candles.length} {report.lang === "zh" ? "根完整 K 线" : "completed candles"} · {globalLabel(pro?"proDepth":"quickDepth",report.lang)}</small></div><button onClick={() => reset.current()}>{report.lang === "zh" ? "重置视图" : "Reset view"}</button><button onClick={()=>{setInspect(true);focus.current();}}>{report.lang==="zh"?"聚焦计划":"Zoom to setup"}</button><button onClick={() => downloadGlobalChart(report, layers)}>{report.lang === "zh" ? "下载原图 PNG" : "Download chart PNG"}</button></div>
    {pro && <div className="global-layer-controls">{controls.map(([key, label]) => <button key={key} aria-pressed={Boolean(layers[key])} onClick={() => setLayers(current => ({ ...current, [key]: !current[key] }))}>{label}</button>)}</div>}
    <div className="global-chart-readout">{readout || `${report.snapshot.venue} · ${report.snapshot.priceCurrency} · ${report.snapshot.timeframe}`} · {report.lang === "zh" ? "条件走势 · 时间仅为示意" : "Conditional moves · timing is schematic"}</div>
    <p className="global-timeframe-label"><strong>{report.lang === "zh" ? "主图" : "Primary chart"}: {globalTimeframeLabel(report.snapshot.timeframe, report.lang)}</strong>{pro && <span>{globalLabel("context", report.lang)}: {globalTimeframeLabel(report.context.timeframe ?? "—", report.lang)}</span>}</p>
    <div className={`global-mobile-overview ${inspect?"is-inspecting":""}`} dangerouslySetInnerHTML={{__html:overview}} />
    <div className="global-mobile-inspect"><button aria-pressed={inspect} onClick={()=>setInspect(!inspect)}>{inspect?(report.lang==="zh"?"显示完整走势":"Show full map"):(report.lang==="zh"?"检查 K 线":"Inspect candles")}</button><small>{report.lang==="zh"?"原图可下载；详细视图支持滑动和缩放。":"Download the original PNG for full detail. Swipe and zoom in the detailed view."}</small></div>
    <div className={`global-chart-scroll ${inspect?"is-inspecting":""}`}><div className="global-chart-stage"><div ref={ref} style={{ height: pro ? 660 : 540 }} /><svg className="global-chart-overlay" style={{zIndex:5}} width={overlay.width} height={overlay.height} aria-label="Candles, Elliott hypothesis, conditional paths and decision levels" dangerouslySetInnerHTML={{ __html: overlay.svg }} />{pro&&<><span className="global-rsi-label">RSI14 · {report.indicators.rsi.points.at(-1)?.value.toFixed(2)??"—"}</span><ContextChart report={report} /></>}</div></div>
    <p className="global-sma-readings">{report.indicators.sma.filter(s=>(pro&&layers.allSmas?[21,55,89,144,233]:report.view.smaPeriods).includes(s.period)).map(s=>`SMA${s.period} ${globalPrice(report,s.points.at(-1)?.value)}`).join(" · ")}</p></>;
}
