import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, type UTCTimestamp, type AutoscaleInfo, type Time } from "lightweight-charts";
import { parseCandleTimeframe, globalChartAnnotations, globalReportChartSvg, globalFibonacciAnchors, globalTradeCards, globalLabel, globalPrice, globalTimeframeLabel, globalTradePlan, globalSetupMap, globalSetupWindow, type GlobalReport, type GlobalChartLayers } from "@pulse/domain";
import {globalOrderFlowLines,globalOrderFlowStudy} from "@pulse/domain";
import { downloadGlobalChart } from "./globalChartDownload";
import {GlobalChartClock} from "./GlobalChartClock";
import {globalDecision,globalContextLine,globalChannelLines,globalEntryStudySvg,globalDefaultChartLayers,globalStructureChartLayers,globalSetupStudySeries,globalSetupStudyReadings,globalStructuralScaleValues,globalStructuralWindow,globalChannelAvailability,globalFibonacciDescription,globalFrameReference,globalVwapContextLine} from "@pulse/domain";

const stamp = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;
const palette = ["#ffcb76", "#b790ff", "#59c2ee", "#e593c2", "#71969b"];
const chartOptions = { layout: { background: { type: ColorType.Solid, color: "#0d1420" }, textColor: "#8d9cb3", fontSize: 11 }, grid: { vertLines: { visible: false }, horzLines: { color: "#263142", style: 2 } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: .1, bottom: .08 } }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false }, autoSize: true };

function ContextChart({ report }: { report: GlobalReport }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || report.context.candles.length < 2) return;
    const chart = createChart(ref.current, { ...chartOptions, localization:{locale:report.lang==="zh"?"zh-CN":"en-US"}, height: 112, handleScroll: false, handleScale: false, timeScale: { visible: false }, rightPriceScale: { visible: false }, grid: { vertLines: { visible: false }, horzLines: { visible: false } } });
    const candles = report.context.candles.slice(-36), start = candles[0].ts;
    chart.addSeries(CandlestickSeries, { upColor: "#35d0aa", downColor: "#ef6b85", wickUpColor: "#35d0aa", wickDownColor: "#ef6b85", borderVisible: false }).setData(candles.map(c => ({ ...c, time: stamp(c.ts) })));
    chart.addSeries(LineSeries, { color: "#b58aff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(report.context.sma55.filter(p => p.ts >= start).map(p => ({ time: stamp(p.ts), value: p.value })));
    chart.timeScale().fitContent(); return () => chart.remove();
  }, [report]);
  const agreement=globalContextLine(report,globalTradePlan(report).side);
  return <div className="global-context"><strong>{globalFrameReference(report.context.timeframe??"—")} {globalLabel("context", report.lang)}</strong>{report.context.candles.length>=2 ? <><div ref={ref} style={{ height: 112 }} /><small>{report.context.sma55.length?`SMA55 ${globalPrice(report,report.context.sma55.at(-1)?.value)}`:`${report.context.candles.length} ${report.lang==="zh"?"根完整 K 线":"completed candles"}`} · {agreement}</small></> : <p>{globalLabel("unavailable", report.lang)}</p>}</div>;
}

export function GlobalMarketChart({ report, selectedPathId }: { report: GlobalReport; selectedPathId: string | null }) {
  // Parsing a saved report can return a fresh object on each parent refresh.
  // Recreate series only when chart evidence changes, not narrative or identity.
  const evidenceKey=useMemo(()=>JSON.stringify({...report,narrative:undefined}),[report]);
  const chartReport=useMemo(()=>report,[evidenceKey]);
  const viewport=useRef<{key:string;logical:{from:number;to:number}|null;price:{from:number;to:number}|null;autoScale:boolean}|null>(null);
  const ref = useRef<HTMLDivElement>(null), reset = useRef<() => void>(() => {}),focus = useRef<() => void>(() => {}),history = useRef<() => void>(() => {}),fitFib=useRef<()=>void>(()=>{});
  const [chartView,setChartView]=useState<"setup"|"structure"|"history"|"fibonacci">("setup");
  const pro = report.tier === "pro", [layers, setLayers] = useState<GlobalChartLayers>(()=>globalDefaultChartLayers(report));
  const layerState=useRef(layers);layerState.current=layers;
  const updateLayers=useRef<(value:GlobalChartLayers)=>void>(()=>{});
  const [overlay, setOverlay] = useState({ svg: "", width: 0, height: 0 }), [readout, setReadout] = useState(""),[inspect,setInspect]=useState(false);
  const selection=useRef(selectedPathId);selection.current=selectedPathId;
  const fibAnchors = globalFibonacciAnchors(report);
  const overview=useMemo(()=>{const svg=globalReportChartSvg(report,{layers,selectedPathId,structure:chartView==="structure",fullHistory:chartView==="history",fitFibonacci:chartView==="fibonacci"}),height=pro?709:530;return svg?.replace(/height="\d+" viewBox="0 0 1300 \d+"/,`height="${height}" viewBox="0 65 1300 ${height}"`)??"";},[report,layers,selectedPathId,pro,chartView]);
  useEffect(() => {
    const report=chartReport;
    if (!ref.current || report.candles.length < 2) return;
    const viewportKey=JSON.stringify([report.snapshot.source,report.snapshot.instId,report.snapshot.timeframe,report.snapshot.observedAt,report.tier]);
    const lastTime = stamp(report.candles.at(-1)!.ts), unit = parseCandleTimeframe(report.snapshot.timeframe)?.unit;
    const chart = createChart(ref.current, { ...chartOptions, handleScale:{axisDoubleClickReset:{time:false,price:false}}, localization:{locale:report.lang==="zh"?"zh-CN":"en-US",timeFormatter:(time:Time)=>typeof time==="number"?new Date(time*1000).toISOString().slice(0,16).replace("T"," ")+" UTC":String(time)}, height: pro ? 660 : 540, timeScale: { ...chartOptions.timeScale, timeVisible: unit === "minute" || unit === "hour", tickMarkFormatter: (time: Time) => typeof time === "number" && time > lastTime ? "" : null } });
    const plan=globalTradePlan(report),qualified=report.decisionVersion==="decision-v5"||globalDecision(report).planningValid,values = [...(report.decisionVersion==="decision-v5"?globalTradeCards(report).flatMap(c=>[...(c.plan.referenceEntry??[]),...(c.plan.referenceStop?[c.plan.referenceStop]:[]),...c.targets.map(t=>t.price)]):[]),...globalSetupMap(report).view.levelIds.flatMap(id => report.levels.find(l => l.id === id)?.price ?? []),...(qualified?plan.referenceEntry??[]:[]),...(qualified&&plan.referenceStop!==null?[plan.referenceStop]:[])];
    const candles = chart.addSeries(CandlestickSeries, { upColor: "#35d0aa", downColor: "#ef6b85", wickUpColor: "#35d0aa", wickDownColor: "#ef6b85", borderVisible: false, priceFormat: { type: "price", precision: report.snapshot.pricePrecision, minMove: 10 ** -report.snapshot.pricePrecision }, autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => { const info = base(), visible=chart.timeScale().getVisibleLogicalRange(),first=report.candles[Math.max(0,Math.floor(visible?.from??report.candles.length-globalSetupWindow(report)))]; const structureValues=first?globalStructuralScaleValues(report,first.ts,layerState.current):[]; const latestX = chart.timeScale().timeToCoordinate(lastTime), plotWidth = chart.timeScale().width(); if (info?.priceRange && (values.length||structureValues.length) && latestX !== null && latestX >= 8 && latestX + 70 < plotWidth - 145) { info.priceRange.minValue = Math.min(info.priceRange.minValue, ...values,...structureValues); info.priceRange.maxValue = Math.max(info.priceRange.maxValue, ...values,...structureValues); } return info; } });
    const data = report.candles, last = data.at(-1)!, interval = data.length > 1 ? last.ts - data.at(-2)!.ts : 3600000;
    candles.setData([...data.map(c => ({ time: stamp(c.ts), open: c.open, high: c.high, low: c.low, close: c.close })), ...Array.from({ length: 300 }, (_, i) => ({ time: stamp(last.ts + interval * (i + 1)) }))]);
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 }, visible: false });
    volume.setData(data.map(c => ({ time: stamp(c.ts), value: c.volume, color: c.close >= c.open ? "#35d0aa40" : "#ef6b8540" })));
    const visibility: Array<(value:GlobalChartLayers)=>void> = [];
    const addLine = (points: Array<{ ts: number; value: number }>, color: string, pane = 0, width:1|2=1) => { const series=chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,...(pane>0?{autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})}:{}) }, pane);series.setData(points.map(p => ({ time: stamp(p.ts), value: p.value })));if(pane>0)series.priceScale().applyOptions({scaleMargins:{top:0,bottom:0}}); };
    const study=(points:Array<{ts:number;value:number}>,color:string,enabled:(value:GlobalChartLayers)=>boolean,width:1|2=1)=>{
      const series=chart.addSeries(LineSeries,{color,lineWidth:width,priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:()=>null,visible:enabled(layerState.current)});
      series.setData(points.map(p=>({time:stamp(p.ts),value:p.value})));visibility.push(value=>series.applyOptions({visible:enabled(value)}));
    };
    report.indicators.sma.forEach((s,i)=>study(s.points,palette[i],value=>value.sma!==false&&(s.period===55||Boolean(pro&&value.allSmas)),s.period===55?2:1));
    if(pro&&report.indicators.regression)for(const points of[report.indicators.regression.upper,report.indicators.regression.mid,report.indicators.regression.lower])study(points,"#31b8da",value=>Boolean(value.regression));
    for(const saved of globalSetupStudySeries(report,{ema:true,vwap:true,vwapBands:true})){
      const key=saved.name.startsWith("EMA")?"ema":saved.dash?"vwapBands":"vwap";
      const series=chart.addSeries(LineSeries,{color:saved.color,lineWidth:saved.dash?1:2,lineStyle:saved.dash?2:0,priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:()=>null,visible:Boolean(layerState.current[key]&&(key!=="vwapBands"||layerState.current.vwap))});
      series.setData(saved.points.map(p=>({time:stamp(p.ts),value:p.value})));
      visibility.push(value=>series.applyOptions({visible:Boolean(value[key]&&(key!=="vwapBands"||value.vwap))}));
    }
    updateLayers.current=value=>visibility.forEach(update=>update(value));
    if (pro) {
      addLine(report.indicators.rsi.points, "#d4b479", 1);
      for (const value of [30, 50, 70]) addLine([{ ts: data[0].ts, value }, { ts: last.ts, value }], value===30?"#355e55":value===70?"#7a4659":"#465265", 1);
      chart.panes()[1]?.setHeight(170);
    }
    // fitContent excludes trailing whitespace in Quick. An explicit logical
    // range reserves the same future scenario space in both tiers.
    const showWindow=(count:number,full=false)=>{
      chart.priceScale("right").applyOptions({autoScale:true});
      // Preserve the history count while allowing exact setup prices to fit
      // beside the candles on a narrow inspection chart as well as desktop.
      const width=chart.timeScale().width(),reserved=Math.min(width*.55,Math.max(300,width*.28));
      const future=Math.ceil(count*reserved/Math.max(1,width-reserved));
      chart.timeScale().setVisibleLogicalRange({from:full?-5:Math.max(-5,data.length-count),to:data.length+future});
    };
    const resetView=()=>showWindow(globalSetupWindow(report));
    reset.current = resetView;
    history.current=()=>showWindow(data.length,true);
    fitFib.current=()=>showWindow(globalStructuralWindow(report,true));
    focus.current=()=>showWindow(Math.max(180,globalSetupWindow(report)));
    chart.subscribeCrosshairMove(event => { const candle = event.seriesData.get(candles); if (candle && "open" in candle) setReadout(`O ${globalPrice(report, candle.open)}  H ${globalPrice(report, candle.high)}  L ${globalPrice(report, candle.low)}  C ${globalPrice(report, candle.close)}`); });
    let frame = 0, prior = "", firstFrame=true;
    let previousWidth = chart.chartElement().clientWidth, previousRange = chart.timeScale().getVisibleLogicalRange();
    const render = () => {
      const width = chart.chartElement().clientWidth, height = chart.panes()[0]?.getHeight() ?? 0;
      if(firstFrame&&width>0){
        const saved=viewport.current;
        if(saved?.key===viewportKey&&saved.logical){
          chart.timeScale().setVisibleLogicalRange(saved.logical);
          if(!saved.autoScale&&saved.price)chart.priceScale("right").setVisibleRange(saved.price);
        }else resetView();
        firstFrame=false;previousWidth=width;previousRange=chart.timeScale().getVisibleLogicalRange();
      }
      // Auto-size preserves bar spacing, which adds blank history on a wider
      // viewport. Preserve the user's logical range, including a focused setup.
      if(width > 0 && width !== previousWidth && previousRange) chart.timeScale().setVisibleLogicalRange(previousRange);
      previousWidth = width; previousRange = chart.timeScale().getVisibleLogicalRange();
      const scale=chart.priceScale("right"),priceRange=scale.getVisibleRange();
      viewport.current={key:viewportKey,logical:previousRange,price:priceRange,autoScale:scale.options().autoScale};
      if(ref.current){
        ref.current.dataset.viewportFrom=String(previousRange?.from??"");ref.current.dataset.viewportTo=String(previousRange?.to??"");
        ref.current.dataset.priceFrom=String(priceRange?.from??"");ref.current.dataset.priceTo=String(priceRange?.to??"");ref.current.dataset.priceAutoscale=String(scale.options().autoScale);
      }
      const historyEnd = chart.timeScale().timeToCoordinate(stamp(last.ts)), first = chart.timeScale().timeToCoordinate(stamp(data[0].ts));
      const signature = [width, height, historyEnd, first, candles.priceToCoordinate(last.close), candles.priceToCoordinate(data[0].low),selection.current,JSON.stringify(layerState.current)].join("/");
      if(signature!==prior&&width>0){prior=signature;
        const plotWidth=chart.timeScale().width(),right=plotWidth-145;
        // A projection cannot be placed beyond the viewport when the user pans
        // into older history. Keep the native candles usable at every zoom.
        const canShowMap=historyEnd!==null&&historyEnd>=8&&historyEnd+70<right;
        setOverlay({width,height,svg:globalChartAnnotations(report,{x:ts=>chart.timeScale().timeToCoordinate(stamp(ts)),y:price=>candles.priceToCoordinate(price),left:8,right:canShowMap?right:plotWidth-8,top:24,bottom:height-12,historyEnd:canShowMap?historyEnd!:Math.max(8,Math.min(plotWidth-8,historyEnd??plotWidth-8))},{layers:layerState.current,selectedPathId:selection.current,showScenarios:canShowMap})});
      }
      frame = requestAnimationFrame(render);
    }; frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); chart.remove(); reset.current = () => {};focus.current=()=>{};history.current=()=>{};updateLayers.current=()=>{}; };
  }, [chartReport, pro]);
  useEffect(()=>{updateLayers.current(layers);},[layers]);
  if (report.candles.length < 2) return <p>{globalLabel("chartUnavailable", report.lang)}</p>;
  const flowStudy=pro&&layers.footprint?globalOrderFlowStudy(report,660):null;
  // The phone overview uses the identical saved annotation renderer. Keep the
  // complete map visible; the native view remains available for candle inspection.
  const controls: Array<[keyof GlobalChartLayers, string]> = [["ema", "EMA 12 / 25"], ["vwapBands", report.lang==="zh"?"VWAP 偏差带":"VWAP bands"], ["range", report.lang==="zh"?"区间参考":"Range references"], ["waves", report.lang==="zh"?"波浪候选":"Wave hypotheses"], ["channel",report.lang==="zh"?"宽平行通道":"Broad parallel channel"],["localChannel",report.lang==="zh"?"局部平行通道":"Local parallel channel"],["channelMid",report.lang==="zh"?"通道中线":"Channel midlines"],["allSmas", "SMA 21/55/89/144/233"], ["regression", report.lang==="zh"?"120 根回归 ±2σ":"Regression 120 ±2σ"], ["fibonacci", "Fibonacci retracement"], ["vwap", report.lang==="zh"?"锚定 VWAP":"Anchored VWAP"], ["pivots", report.lang==="zh"?"已确认转折点":"Confirmed pivots"], ["atr", "ATR14"]];
  if(report.orderFlow){controls.splice(3,0,["volumeProfile",report.lang==="zh"?"成交量分布":"Volume profile"]);if(report.orderFlow.footprints.length)controls.splice(4,0,["footprint",report.lang==="zh"?"成交足迹":"Trade footprint"]);}
  return <><div className="global-chart-toolbar"><div><strong>{report.snapshot.instId.split("-")[0]} · {pro?(report.lang==="zh"?"Pro 结构与计划证据":"Pro structure and setup evidence"):(report.lang==="zh"?"Quick 波浪结构与后续走势":"Quick Elliott structure and next move")}</strong><small>{report.candles.length} {report.lang === "zh" ? "根完整 K 线" : "completed candles"} · {globalLabel(pro?"proDepth":"quickDepth",report.lang)}</small></div><button onClick={() => {setChartView("setup");reset.current();}}>{report.lang === "zh" ? "重置视图" : "Reset view"}</button><button onClick={()=>{setLayers(current=>({...current,studyScale:"context"}));setInspect(true);setChartView("history");history.current();}}>{report.lang==="zh"?"全部历史":"Full history"}</button><button onClick={()=>{setLayers(globalStructureChartLayers(report));setInspect(true);setChartView("structure");}}>{report.lang==="zh"?"结构视图":"Structure view"}</button><button onClick={() => downloadGlobalChart(report, layers, {selectedPathId,structure:chartView==="structure",fullHistory:chartView==="history",fitFibonacci:chartView==="fibonacci"})}>{report.lang === "zh" ? "下载原图 PNG" : "Download chart PNG"}</button></div>
    {pro && <><button onClick={()=>{setLayers(globalDefaultChartLayers(report));setChartView("setup");}}>{report.lang==="zh"?"入场视图":"Setup view"}</button><div className="global-chart-presets" aria-label="Chart views"><button aria-pressed={layers.studyScale==="context"} onClick={()=>setLayers(current=>({...current,studyScale:current.studyScale==="context"?"setup":"context"}))}>{report.lang==="zh"?"价值背景":"Value context"}</button><button onClick={()=>setLayers(globalDefaultChartLayers(report))}>{report.lang==="zh"?"恢复默认指标":"Reset studies"}</button><span>{report.lang==="zh"?"入场视图聚焦已保存的趋势、价值与区间参考；结构视图显示更广的研究。":"Setup view focuses on saved trend, value and range references. Choose Structure view for wider studies."}</span></div><details className="global-study-options" open><summary>{report.lang==="zh"?"指标设置":"Indicator settings"}</summary><div className="global-layer-controls">{controls.map(([key,label])=><button key={key} aria-pressed={Boolean(layers[key])} title={key==="channel"?globalChannelAvailability(report,"broad").reason:key==="localChannel"?globalChannelAvailability(report,"local").reason:undefined} disabled={key==="fibonacci"&&!fibAnchors||key==="ema"&&!report.indicators.ema?.some(e=>e.points.length)||key==="vwapBands"&&!report.indicators.vwap?.bands?.length||key==="range"&&!report.range&&!report.horizonContext?.zones.length&&!report.horizonContext?.ranges.length||key==="vwap"&&!report.indicators.vwap||key==="channel"&&!globalChannelAvailability(report,"broad").available||key==="localChannel"&&!globalChannelAvailability(report,"local").available||key==="channelMid"&&!report.indicators.channels?.length} onClick={()=>setLayers(current=>({...current,[key]:!current[key],...(key==="allSmas"?{sma:!current.allSmas}:{}),...(key==="vwapBands"&&!current.vwapBands?{vwap:true}:{})}))}>{label}</button>)}</div></details></>}
    {pro&&!report.indicators.channels?.length&&<p className="global-meta">{globalChannelAvailability(report,"broad").reason}</p>}
    {pro&&layers.fibonacci&&fibAnchors&&<div className="global-fib-readings">{globalFibonacciDescription(report).map(line=><p key={line}>{line}</p>)}<button onClick={()=>{setChartView("fibonacci");fitFib.current();}}>{report.lang==="zh"?"查看斐波那契锚点":"Show measured swing"}</button></div>}
    <div className="global-chart-readout">{readout || `${report.snapshot.venue} · ${report.snapshot.priceCurrency} · ${globalFrameReference(report.snapshot.timeframe)}`} · {report.decisionVersion==="decision-v5"?(report.lang==="zh"?"交易计划 · Entry / SL / TP":"Trade plan · Entry / SL / TP"):(report.lang === "zh" ? "条件走势 · 时间仅为示意" : "Conditional moves · timing is schematic")}</div>
    <p className="global-timeframe-label"><strong>{report.lang === "zh" ? "主图" : "Primary chart"}: {globalTimeframeLabel(report.snapshot.timeframe, report.lang)}</strong>{report.entryStudy&&<span>{report.lang==="zh"?"入场研究":"Entry study"}: {globalTimeframeLabel(report.entryStudy.timeframe,report.lang)} · {report.entryStudy.status==="available"?(report.lang==="zh"?"已完成 K 线":"completed candles"):(report.lang==="zh"?"不可用":"unavailable")}</span>}{pro && <span>{globalLabel("context", report.lang)}: {globalTimeframeLabel(report.context.timeframe ?? "—", report.lang)}</span>}</p>
    <div className={`global-mobile-overview ${inspect?"is-inspecting":""}`} dangerouslySetInnerHTML={{__html:overview}} />
    <div className="global-mobile-inspect"><button aria-pressed={inspect} onClick={()=>setInspect(!inspect)}>{inspect?(report.lang==="zh"?"显示完整走势":"Show full map"):(report.lang==="zh"?"检查 K 线":"Inspect candles")}</button><small>{report.lang==="zh"?"原图可下载；详细视图支持滑动和缩放。":"Download the original PNG for full detail. Swipe and zoom in the detailed view."}</small></div>
    <div className={`global-chart-scroll ${inspect?"is-inspecting":""}`}><div className="global-chart-stage"><div ref={ref} style={{ height: pro ? 660 : 540 }} /><svg className="global-chart-overlay" style={{zIndex:5,width:overlay.width,height:overlay.height}} width={overlay.width} height={overlay.height} aria-label="Candles, saved setup indicators, range references, Entry, SL and TP" dangerouslySetInnerHTML={{ __html: overlay.svg }} />{pro&&<span className="global-rsi-label">RSI14 · {report.indicators.rsi.points.at(-1)?.value.toFixed(2)??"—"}</span>}</div></div>
    <GlobalChartClock report={report}/>
    <p className="global-sma-readings">{[...report.indicators.sma.filter(s=>layers.sma!==false&&(pro&&layers.allSmas?[21,55,89,144,233]:[55]).includes(s.period)).map(s=>`SMA${s.period} ${globalPrice(report,s.points.at(-1)?.value)}`),...globalSetupStudyReadings(report,layers).map(s=>`${s.name} ${globalPrice(report,s.value)}`)].join(" · ")}</p>{pro&&layers.vwap&&globalVwapContextLine(report)&&<p className="global-meta">{globalVwapContextLine(report)}</p>}{pro&&globalChannelLines(report).map(line=><p key={line} className="global-meta">{line}</p>)}{pro&&<ContextChart report={report}/>}{report.entryStudy&&<div className="global-entry-detail" aria-label="Entry study candles" dangerouslySetInnerHTML={{__html:globalEntryStudySvg(report,660,selectedPathId)??""}}/>}
    {pro&&report.orderFlow&&globalOrderFlowLines(report).map(line=><p className="global-meta" key={line}>{line}</p>)}
    {flowStudy&&<div className="global-entry-detail global-footprint-detail" aria-label="Executed trade footprint" dangerouslySetInnerHTML={{__html:flowStudy.svg}}/>}
    <details className="global-chart-help"><summary>{report.lang==="zh"?"如何阅读此图":"How to read this chart"}</summary><p>{report.lang==="zh"?"先读方向与具体入场条件。绿色为上行、红色为下行。虚线入场、止损和止盈是计划；信号确认另有时间标记，不代表实际成交。":"Read the direction and exact entry condition first. Green routes rise; red routes fall. Dashed entry, SL and TP marks are plans. A confirmed signal is time-stamped separately and does not mean an order filled."}</p><p>{report.lang==="zh"?"刷新报告、切换指标及研究预设均保留缩放与平移。拖动查看历史，滚轮或双指缩放时间，拖动价格轴缩放价格。“重置视图”恢复默认时间范围及价格比例；“全部历史”和“查看斐波那契锚点”按明确选择调整范围。":"Zoom and pan stay where you leave them through report refreshes, indicator changes and study presets. Drag to pan, scroll or pinch to zoom time, and drag the price axis to zoom prices. Reset view restores the default time window and price scale. Full history and Show measured swing explicitly fit their requested history."}</p><a href="/docs#docs-global-chart">{report.lang==="zh"?"指标、斐波那契和图表完整指南":"Full guide: indicators, Fibonacci and chart reading"}</a></details></>;
}
