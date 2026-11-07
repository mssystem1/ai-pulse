import {globalChartColor,themeGlobalChartSvg} from "./globalChartTheme";
import {useGlobalChartAppearance} from "./useGlobalChartAppearance";
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, type UTCTimestamp, type AutoscaleInfo, type Time, type IPriceLine } from "lightweight-charts";
import { parseCandleTimeframe, globalChartAnnotations, globalReportChartSvg, globalFibonacciAnchors, globalTradeCards, globalLabel, globalPrice, globalTimeframeLabel, globalTradePlan, globalSetupMap, globalSetupWindow, type GlobalReport, type GlobalChartLayers } from "@pulse/domain";
import {globalOrderFlowLines,globalOrderFlowStudy,globalOrderFlowCoverageLabel} from "@pulse/domain";
import {GlobalExportButton} from "./GlobalExportButton";
import type {ReportExportAccess} from "./reportDownload";
import {globalLiveCandle,type GlobalLiveCandle} from "./globalLiveCandle";
import { terminalIndicatorSeries, type TerminalChartIndicator } from "./terminalIndicatorChart";
import {GlobalChartClock} from "./GlobalChartClock";
import {globalVisibleCandleExtrema,resolveGlobalChartQuote,type GlobalChartCurrentQuote,type GlobalChartQuote} from "./globalChartQuote";
import {globalDecision,globalContextLine,globalChannelLines,globalEntryStudySvg,globalDefaultChartLayers,globalStructureChartLayers,globalSetupStudySeries,globalSetupStudyReadings,globalStructuralScaleValues,globalStructuralWindow,globalChannelAvailability,globalFibonacciDescription,globalFrameReference,globalVwapContextLine} from "@pulse/domain";

const stamp = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;
const palette = ["#ffcb76", "#b790ff", "#59c2ee", "#e593c2", "#71969b"];
const chartOptions = { layout: { background: { type: ColorType.Solid, color: "#0d1420" }, textColor: "#8d9cb3", fontSize: 11 }, grid: { vertLines: { visible: false }, horzLines: { color: "#263142", style: 2 } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: .1, bottom: .08 } }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false }, autoSize: true };

function ContextChart({ report }: { report: GlobalReport }) {
  const appearance=useGlobalChartAppearance(),paint=(color:string)=>globalChartColor(color,appearance);
  const options={...chartOptions,layout:{...chartOptions.layout,fontSize:appearance==="light"?13:11,fontFamily:'Inter, "Segoe UI", sans-serif',background:{type:ColorType.Solid,color:appearance==="light"?"#f8fbff":"#0d1420"},textColor:globalChartColor("#8d9cb3",appearance,"text")},grid:{...chartOptions.grid,horzLines:{...chartOptions.grid.horzLines,color:appearance==="light"?"#cbd5e4":"#263142"}}};
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || report.context.candles.length < 2) return;
    const chart = createChart(ref.current, { ...options, localization:{locale:report.lang==="zh"?"zh-CN":"en-US"}, height: 112, handleScroll: false, handleScale: false, timeScale: { visible: false }, rightPriceScale: { visible: false }, grid: { vertLines: { visible: false }, horzLines: { visible: false } } });
    const candles = report.context.candles.slice(-36), start = candles[0].ts;
    chart.addSeries(CandlestickSeries, { upColor: paint("#35d0aa"), downColor: paint("#ef6b85"), wickUpColor: paint("#35d0aa"), wickDownColor: paint("#ef6b85"), borderVisible: false }).setData(candles.map(c => ({ ...c, time: stamp(c.ts) })));
    chart.addSeries(LineSeries, { color: paint("#b58aff"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(report.context.sma55.filter(p => p.ts >= start).map(p => ({ time: stamp(p.ts), value: p.value })));
    chart.timeScale().fitContent(); return () => chart.remove();
  }, [report,appearance]);
  const agreement=globalContextLine(report,globalTradePlan(report).side);
  return <div className="global-context"><strong>{globalFrameReference(report.context.timeframe??"—")} {globalLabel("context", report.lang)}</strong>{report.context.candles.length>=2 ? <><div ref={ref} style={{ height: 112 }} /><small>{report.context.sma55.length?`SMA55 ${globalPrice(report,report.context.sma55.at(-1)?.value)}`:`${report.context.candles.length} ${report.lang==="zh"?"根完整 K 线":"completed candles"}`} · {agreement}</small></> : <p>{globalLabel("unavailable", report.lang)}</p>}</div>;
}

export function GlobalMarketChart({ report, selectedPathId, access, viewportIdentity, currentQuote, currentCandle, terminalIndicators = [] }: { report: GlobalReport; selectedPathId: string | null; access?:ReportExportAccess; viewportIdentity?:string; currentQuote?:GlobalChartCurrentQuote;currentCandle?:GlobalLiveCandle; terminalIndicators?: TerminalChartIndicator[] }) {
  const appearance=useGlobalChartAppearance(),paint=(color:string)=>globalChartColor(color,appearance);
  const options={...chartOptions,layout:{...chartOptions.layout,fontSize:appearance==="light"?13:11,fontFamily:'Inter, "Segoe UI", sans-serif',background:{type:ColorType.Solid,color:appearance==="light"?"#f8fbff":"#0d1420"},textColor:globalChartColor("#8d9cb3",appearance,"text")},grid:{...chartOptions.grid,horzLines:{...chartOptions.grid.horzLines,color:appearance==="light"?"#cbd5e4":"#263142"}}};
  // Parsing a saved report can return a fresh object on each parent refresh.
  // Recreate series only when chart evidence changes, not narrative or identity.
  const evidenceKey=useMemo(()=>JSON.stringify({...report,narrative:undefined}),[report]);
  const chartReport=useMemo(()=>report,[evidenceKey]);
  const viewport=useRef<{key:string;logical:{from:number;to:number}|null;price:{from:number;to:number}|null;autoScale:boolean;anchor?:{ts:number;index:number}}|null>(null);
  const ref = useRef<HTMLDivElement>(null), reset = useRef<() => void>(() => {}),focus = useRef<() => void>(() => {}),history = useRef<() => void>(() => {}),fitFib=useRef<()=>void>(()=>{});
  const [chartView,setChartView]=useState<"setup"|"structure"|"history"|"fibonacci">("setup");
  const pro = report.tier === "pro", [layers, setLayers] = useState<GlobalChartLayers>(()=>globalDefaultChartLayers(report));
  const layerState=useRef(layers);layerState.current=layers;
  const indicatorState=useRef(terminalIndicators);indicatorState.current=terminalIndicators;
  const indicatorIdentity=terminalIndicators.map(item=>item.id).join("|");
  const focusTerminalIndicators=useRef<()=>void>(()=>{});
  const updateTerminalIndicators=useRef<(studies:TerminalChartIndicator[])=>void>(()=>{});
  const [indicatorReadings,setIndicatorReadings]=useState<Record<string,string>>({});
  const chartHeight=(pro?660:540)+terminalIndicators.length*150;
  const updateLayers=useRef<(value:GlobalChartLayers)=>void>(()=>{});
  const [quoteClock,setQuoteClock]=useState(()=>performance.now());
  useEffect(()=>{const timer=window.setInterval(()=>setQuoteClock(performance.now()),1000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{if(currentCandle)setInspect(true);},[currentCandle?.instId,currentCandle?.timeframe]);
  const quoteAnchor=useRef<{key:string;serverNow:number;monotonic:number}|null>(null);
  const serverObservedAt=currentQuote?.observedAt??currentCandle?.observedAt;
  const quoteKey=`${serverObservedAt??""}/${currentQuote?.ts??""}/${currentQuote?.price??""}/${currentCandle?.candle.ts??""}`;
  if(Number.isFinite(serverObservedAt)&&quoteAnchor.current?.key!==quoteKey)quoteAnchor.current={key:quoteKey,serverNow:serverObservedAt!,monotonic:performance.now()};
  if(!Number.isFinite(serverObservedAt))quoteAnchor.current=null;
  const quoteNow=quoteAnchor.current?quoteAnchor.current.serverNow+Math.max(0,quoteClock-quoteAnchor.current.monotonic):Date.now();
  const quote=resolveGlobalChartQuote(report,currentQuote,quoteNow),quoteState=useRef<GlobalChartQuote|null>(quote);
  quoteState.current=quote;
  const forming=globalLiveCandle(report,currentCandle,currentQuote,quoteNow),formingState=useRef(forming);formingState.current=forming;
  const updateForming=useRef<(value:GlobalLiveCandle["candle"]|null)=>void>(()=>{});
  const [candleDetail,setCandleDetail]=useState<{ts:number;open:number;high:number;low:number;close:number;volume:number;live:boolean}|null>(null);
  const updateQuote=useRef<(value:GlobalChartQuote|null)=>void>(()=>{});
  const [overlay, setOverlay] = useState({ svg: "", width: 0, height: 0 }), [readout] = useState(""),[inspect,setInspect]=useState(false);
  const selection=useRef(selectedPathId);selection.current=selectedPathId;
  const fibAnchors = globalFibonacciAnchors(report);
  const overview=useMemo(()=>{const svg=globalReportChartSvg(report,{layers,selectedPathId,structure:chartView==="structure",fullHistory:chartView==="history",fitFibonacci:chartView==="fibonacci",quoteMarker:quote??undefined}),height=pro?709:530;return themeGlobalChartSvg(svg?.replace(/height="\d+" viewBox="0 0 1300 \d+"/,`height="${height}" viewBox="0 65 1300 ${height}"`)??"",appearance);},[report,layers,selectedPathId,pro,chartView,appearance,quote?.price,quote?.ts,quote?.kind]);
  useEffect(() => {
    const report=chartReport;
    if (!ref.current || report.candles.length < 2) return;
    const viewportKey=viewportIdentity??JSON.stringify([report.snapshot.source,report.snapshot.instId,report.snapshot.timeframe,report.snapshot.observedAt,report.tier]);
    const lastTime = stamp(report.candles.at(-1)!.ts), unit = parseCandleTimeframe(report.snapshot.timeframe)?.unit;
    const chart = createChart(ref.current, { ...options, handleScale:{axisDoubleClickReset:{time:false,price:false}}, localization:{locale:report.lang==="zh"?"zh-CN":"en-US",timeFormatter:(time:Time)=>typeof time==="number"?new Date(time*1000).toISOString().slice(0,16).replace("T"," ")+" UTC":String(time)}, height: chartHeight, timeScale: { ...chartOptions.timeScale, timeVisible: unit === "minute" || unit === "hour", tickMarkFormatter: (time: Time) => typeof time === "number" && time > lastTime ? "" : null } });
    const plan=globalTradePlan(report),qualified=report.decisionVersion==="decision-v5"||globalDecision(report).planningValid,values = [...(report.decisionVersion==="decision-v5"?globalTradeCards(report).flatMap(c=>[...(c.plan.referenceEntry??[]),...(c.plan.referenceStop?[c.plan.referenceStop]:[]),...c.targets.map(t=>t.price),...(report.discretionaryPlan?.priceZones?.targets.flatMap(z=>[z.lower,z.upper])??[])]):[]),...globalSetupMap(report).view.levelIds.flatMap(id => report.levels.find(l => l.id === id)?.price ?? []),...(qualified?plan.referenceEntry??[]:[]),...(qualified&&plan.referenceStop!==null?[plan.referenceStop]:[])];
    const candles = chart.addSeries(CandlestickSeries, { upColor: paint("#35d0aa"), downColor: paint("#ef6b85"), wickUpColor: paint("#35d0aa"), wickDownColor: paint("#ef6b85"), borderVisible: false, priceLineVisible:false,lastValueVisible:false, priceFormat: { type: "price", precision: report.snapshot.pricePrecision, minMove: 10 ** -report.snapshot.pricePrecision }, autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      let info=base();
      const visible=chart.timeScale().getVisibleLogicalRange(),extrema=globalVisibleCandleExtrema(formingState.current?[...report.candles,formingState.current]:report.candles,visible);
      if(extrema){if(!info)info={priceRange:{...extrema}};else if(info.priceRange){info.priceRange.minValue=Math.min(info.priceRange.minValue,extrema.minValue);info.priceRange.maxValue=Math.max(info.priceRange.maxValue,extrema.maxValue);}}
      const first=report.candles[Math.max(0,Math.floor(visible?.from??report.candles.length-globalSetupWindow(report)))];
      const structureValues=first?globalStructuralScaleValues(report,first.ts,layerState.current):[];
      const latestX=chart.timeScale().timeToCoordinate(lastTime),plotWidth=chart.timeScale().width(),latestVisible=visible&&visible.from<=report.candles.length-1&&visible.to>=report.candles.length-1;
      // A manual price scale is retained by the library. During autoscale the
      // quote joins the visible latest candles, never replacing their wicks.
      const quoted=latestVisible&&quoteState.current?[quoteState.current.price]:[];
      const mapValues=latestX!==null&&latestX>=8&&latestX+70<plotWidth-145?[...values,...structureValues]:[];
      if(info?.priceRange){info.priceRange.minValue=Math.min(info.priceRange.minValue,...mapValues,...quoted);info.priceRange.maxValue=Math.max(info.priceRange.maxValue,...mapValues,...quoted);}
      return info;
    } });
    const data = report.candles, last = data.at(-1)!, interval = data.length > 1 ? last.ts - data.at(-2)!.ts : 3600000;
    candles.setData([...data.map(c => ({ time: stamp(c.ts), open: c.open, high: c.high, low: c.low, close: c.close })), ...Array.from({ length: 300 }, (_, i) => ({ time: stamp(last.ts + interval * (i + 1)) }))]);
    let quoteLine:IPriceLine|null=null;
    updateQuote.current=value=>{
      if(!value){if(quoteLine)candles.removePriceLine(quoteLine);quoteLine=null;return;}
      const title=value.kind==="current"?(report.lang==="zh"?"当前报价":"Current quote"):(report.lang==="zh"?"快照报价":"Snapshot quote");
      const line={price:value.price,color:paint(value.kind==="current"?"#59c2ee":"#91a1b8"),lineWidth:2 as const,lineStyle:2,axisLabelVisible:true,title};
      if(quoteLine)quoteLine.applyOptions(line);else quoteLine=candles.createPriceLine(line);
    };
    updateQuote.current(quoteState.current);
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 }, visible: false });
    volume.setData(data.map(c => ({ time: stamp(c.ts), value: c.volume, color: paint(c.close >= c.open ? (appearance==="light"?"#35d0aa99":"#35d0aa40") : (appearance==="light"?"#ef6b8599":"#ef6b8540")) })));
    updateForming.current=value=>{
      const logical=chart.timeScale().getVisibleLogicalRange(),scale=chart.priceScale("right"),auto=scale.options().autoScale,priceRange=scale.getVisibleRange();
      const complete=data.map(c=>({time:stamp(c.ts),open:c.open,high:c.high,low:c.low,close:c.close}));
      const future=Array.from({length:300},(_,i)=>({time:stamp(last.ts+interval*(i+1))})).filter(c=>c.time!==stamp(value?.ts??-1));
      candles.setData([...complete,...(value?[{time:stamp(value.ts),open:value.open,high:value.high,low:value.low,close:value.close}]:[]),...future].sort((a,b)=>Number(a.time)-Number(b.time)));
      volume.setData([...data,...(value?[value]:[])].map(c=>({time:stamp(c.ts),value:c.volume,color:paint(c.close>=c.open?"#35d0aa80":"#ef6b8580")})));
      if(logical)chart.timeScale().setVisibleLogicalRange(logical);if(!auto&&priceRange)scale.setVisibleRange(priceRange);
      setCandleDetail(previous=>!previous||previous.live?(value?{...value,live:true}:{...last,live:false}):previous);
    };
    updateForming.current(formingState.current);
    const visibility: Array<(value:GlobalChartLayers)=>void> = [];
    const addLine = (points: Array<{ ts: number; value: number }>, color: string, pane = 0, width:1|2=1) => { const series=chart.addSeries(LineSeries, { color:paint(color), lineWidth: width, priceLineVisible: false, lastValueVisible: false,...(pane>0?{autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})}:{}) }, pane);series.setData(points.map(p => ({ time: stamp(p.ts), value: p.value })));if(pane>0)series.priceScale().applyOptions({scaleMargins:{top:0,bottom:0}}); };
    const study=(points:Array<{ts:number;value:number}>,color:string,enabled:(value:GlobalChartLayers)=>boolean,width:1|2=1)=>{
      const series=chart.addSeries(LineSeries,{color:paint(color),lineWidth:width,priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:()=>null,visible:enabled(layerState.current)});
      series.setData(points.map(p=>({time:stamp(p.ts),value:p.value})));visibility.push(value=>series.applyOptions({visible:enabled(value)}));
    };
    report.indicators.sma.forEach((s,i)=>study(s.points,palette[i],value=>value.sma!==false&&(s.period===55||Boolean(pro&&value.allSmas)),s.period===55?2:1));
    if(pro&&report.indicators.regression)for(const points of[report.indicators.regression.upper,report.indicators.regression.mid,report.indicators.regression.lower])study(points,"#31b8da",value=>Boolean(value.regression));
    for(const saved of globalSetupStudySeries(report,{ema:true,vwap:true,vwapBands:true})){
      const key=saved.name.startsWith("EMA")?"ema":saved.dash?"vwapBands":"vwap";
      const series=chart.addSeries(LineSeries,{color:paint(saved.color),lineWidth:saved.dash?1:2,lineStyle:saved.dash?2:0,priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:()=>null,visible:Boolean(layerState.current[key]&&(key!=="vwapBands"||layerState.current.vwap))});
      series.setData(saved.points.map(p=>({time:stamp(p.ts),value:p.value})));
      visibility.push(value=>series.applyOptions({visible:Boolean(value[key]&&(key!=="vwapBands"||value.vwap))}));
    }
    updateLayers.current=value=>visibility.forEach(update=>update(value));
    if (pro) {
      addLine(report.indicators.rsi.points, "#d4b479", 1);
      for (const value of [30, 50, 70]) addLine([{ ts: data[0].ts, value }, { ts: last.ts, value }], value===30?"#355e55":value===70?"#7a4659":"#465265", 1);
      chart.panes()[1]?.setHeight(170);
    }
    const indicatorSeries = indicatorState.current.map((item, index) => {
      const series=chart.addSeries(LineSeries,{color:paint(palette[index%palette.length]),lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:item.title,priceFormat:{type:"custom",formatter:(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:4})+" "+item.units,minMove:.0001}},(pro?2:1)+index);
      series.setData(terminalIndicatorSeries(item).map(point=>({...point,time:point.time as UTCTimestamp})));
      chart.panes()[(pro?2:1)+index]?.setHeight(150);
      return {id:item.id,series};
    });
    focusTerminalIndicators.current=()=>{const points=indicatorState.current.flatMap(item=>item.points).filter(point=>Number.isFinite(point.value));if(points.length){const start=Math.min(...points.map(point=>point.ts)),end=Math.max(...points.map(point=>point.ts));chart.timeScale().setVisibleRange({from:stamp(start-60000),to:stamp(end+60000)});}};
    updateTerminalIndicators.current=studies=>{for(const entry of indicatorSeries){const item=studies.find(study=>study.id===entry.id);entry.series.setData(item?terminalIndicatorSeries(item).map(point=>({...point,time:point.time as UTCTimestamp})):[]);}};
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
    chart.subscribeCrosshairMove(event=>{
      const readings:Record<string,string>={};for(const entry of indicatorSeries){const value=event.seriesData.get(entry.series);const item=indicatorState.current.find(study=>study.id===entry.id);if(value&&"value" in value&&item)readings[entry.id]=Number(value.value).toLocaleString(undefined,{maximumFractionDigits:5})+" "+item.units;}setIndicatorReadings(readings);
      const c=event.seriesData.get(candles);if(c&&"open" in c&&typeof event.time==="number"){
      const ts=event.time*1000,original=formingState.current?.ts===ts?formingState.current:data.find(item=>item.ts===ts);
      if(original)setCandleDetail({ts,open:c.open,high:c.high,low:c.low,close:c.close,volume:original.volume,live:formingState.current?.ts===ts});
    }});
    let frame = 0, prior = "", firstFrame=true, hiddenSincePaint=false;
    let previousWidth = chart.chartElement().clientWidth, previousRange = chart.timeScale().getVisibleLogicalRange();
    const render = () => {
      const width = chart.chartElement().clientWidth, height = chart.panes()[0]?.getHeight() ?? 0;
      // Terminal keeps this pane mounted while another tab is shown. A hidden
      // zero-width ResizeObserver pass must not overwrite the user's viewport.
      if(width<=0||height<=0){hiddenSincePaint=true;frame=requestAnimationFrame(render);return;}
      if(hiddenSincePaint&&!firstFrame&&previousRange){
        chart.timeScale().setVisibleLogicalRange(previousRange);
        const saved=viewport.current;if(saved?.key===viewportKey&&!saved.autoScale&&saved.price)chart.priceScale("right").setVisibleRange(saved.price);
        previousWidth=width;
      }
      hiddenSincePaint=false;
      if(firstFrame&&width>0){
        const saved=viewport.current;
        if(saved?.key===viewportKey&&saved.logical){
          const anchorIndex=viewportIdentity&&saved.anchor?data.findIndex(c=>c.ts===saved.anchor!.ts):-1;
          const shift=anchorIndex>=0?anchorIndex-saved.anchor!.index:0;
          chart.timeScale().setVisibleLogicalRange({from:saved.logical.from+shift,to:saved.logical.to+shift});
          if(!saved.autoScale&&saved.price)chart.priceScale("right").setVisibleRange(saved.price);
        }else resetView();
        firstFrame=false;previousWidth=width;previousRange=chart.timeScale().getVisibleLogicalRange();
      }
      // Auto-size preserves bar spacing, which adds blank history on a wider
      // viewport. Preserve the user's logical range, including a focused setup.
      if(width > 0 && width !== previousWidth && previousRange) chart.timeScale().setVisibleLogicalRange(previousRange);
      previousWidth = width; previousRange = chart.timeScale().getVisibleLogicalRange();
      const scale=chart.priceScale("right"),priceRange=scale.getVisibleRange();
      const anchorIndex=Math.max(0,Math.min(data.length-1,Math.floor(previousRange?.from??0)));
      viewport.current={key:viewportKey,logical:previousRange,price:priceRange,autoScale:scale.options().autoScale,anchor:{ts:data[anchorIndex].ts,index:anchorIndex}};
      if(ref.current){
        ref.current.dataset.viewportFrom=String(previousRange?.from??"");ref.current.dataset.viewportTo=String(previousRange?.to??"");
        ref.current.dataset.priceFrom=String(priceRange?.from??"");ref.current.dataset.priceTo=String(priceRange?.to??"");ref.current.dataset.priceAutoscale=String(scale.options().autoScale);
      }
      const historyEnd = chart.timeScale().timeToCoordinate(stamp(formingState.current?.ts??last.ts)), first = chart.timeScale().timeToCoordinate(stamp(data[0].ts));
      const signature = [width, height, historyEnd, first, candles.priceToCoordinate(last.close), candles.priceToCoordinate(data[0].low),selection.current,quoteState.current?.price??"",JSON.stringify(layerState.current)].join("/");
      if(signature!==prior&&width>0){prior=signature;
        const plotWidth=chart.timeScale().width(),right=plotWidth-145;
        // A projection cannot be placed beyond the viewport when the user pans
        // into older history. Keep the native candles usable at every zoom.
        const canShowMap=historyEnd!==null&&historyEnd>=8&&historyEnd+70<right;
        const quoteY=quoteState.current?candles.priceToCoordinate(quoteState.current.price):null;
        setOverlay({width,height,svg:themeGlobalChartSvg(globalChartAnnotations(report,{x:ts=>chart.timeScale().timeToCoordinate(stamp(ts)),y:price=>candles.priceToCoordinate(price),left:8,right:canShowMap?right:plotWidth-8,top:24,bottom:height-12,historyEnd:canShowMap?historyEnd!:Math.max(8,Math.min(plotWidth-8,historyEnd??plotWidth-8))},{layers:layerState.current,selectedPathId:selection.current,showScenarios:canShowMap,showQuoteMarker:false,showCloseLabel:false,priceBadgeAvoidYs:quoteY===null?[]:[quoteY]}),appearance)});
      }
      frame = requestAnimationFrame(render);
    }; frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); chart.remove(); reset.current = () => {};focus.current=()=>{};history.current=()=>{};updateLayers.current=()=>{};updateQuote.current=()=>{};updateForming.current=()=>{};updateTerminalIndicators.current=()=>{}; };
  }, [chartReport, pro,appearance,viewportIdentity,indicatorIdentity]);
  useEffect(()=>{updateTerminalIndicators.current(terminalIndicators);},[terminalIndicators]);
  useEffect(()=>{updateLayers.current(layers);},[layers]);
  useEffect(()=>{updateQuote.current(quote);},[quote?.price,quote?.ts,quote?.kind]);
  useEffect(()=>{updateForming.current(forming);},[forming?.ts,forming?.open,forming?.high,forming?.low,forming?.close,forming?.volume]);
  if (report.candles.length < 2) return <p>{globalLabel("chartUnavailable", report.lang)}</p>;
  const flowStudy=pro&&layers.footprint?globalOrderFlowStudy(report,660):null;
  // The phone overview uses the identical saved annotation renderer. Keep the
  // complete map visible; the native view remains available for candle inspection.
  const controls: Array<[keyof GlobalChartLayers, string]> = [["ema", "EMA 12 / 25"], ["vwapBands", report.lang==="zh"?"VWAP 偏差带":"VWAP bands"], ["range", report.lang==="zh"?"区间参考":"Range references"], ["waves", report.lang==="zh"?"波浪候选":"Wave hypotheses"], ["channel",report.lang==="zh"?"宽平行通道":"Broad parallel channel"],["localChannel",report.lang==="zh"?"局部平行通道":"Local parallel channel"],["channelMid",report.lang==="zh"?"通道中线":"Channel midlines"],["allSmas", "SMA 21/55/89/144/233"], ["regression", report.lang==="zh"?"120 根回归 ±2σ":"Regression 120 ±2σ"], ["fibonacci", "Fibonacci retracement"], ["vwap", report.lang==="zh"?"锚定 VWAP":"Anchored VWAP"], ["pivots", report.lang==="zh"?"已确认转折点":"Confirmed pivots"], ["atr", "ATR14"]];
  if(report.orderFlow){controls.splice(3,0,["volumeProfile",report.lang==="zh"?"成交量分布":"Volume profile"]);if(report.orderFlow.footprints.length)controls.splice(4,0,["footprint",report.lang==="zh"?"成交足迹":"Trade footprint"]);}
  return <><div className="global-chart-toolbar"><div><strong>{report.snapshot.instId.split("-")[0]} · {pro?(report.lang==="zh"?"Pro 结构与计划证据":"Pro structure and setup evidence"):(report.lang==="zh"?"Quick 波浪结构与后续走势":"Quick Elliott structure and next move")}</strong><small>{report.candles.length} {report.lang === "zh" ? "根完整 K 线" : "completed candles"} · {globalLabel(pro?"proDepth":"quickDepth",report.lang)}</small></div><button onClick={() => {setChartView("setup");reset.current();}}>{report.lang === "zh" ? "重置视图" : "Reset view"}</button><button onClick={()=>{setLayers(current=>({...current,studyScale:"context"}));setInspect(true);setChartView("history");history.current();}}>{report.lang==="zh"?"全部历史":"Full history"}</button><button onClick={()=>{setLayers(globalStructureChartLayers(report));setInspect(true);setChartView("structure");}}>{report.lang==="zh"?"结构视图":"Structure view"}</button><GlobalExportButton report={report} access={access} format="png" options={{layers,selectedPathId,structure:chartView==="structure",fullHistory:chartView==="history",fitFibonacci:chartView==="fibonacci"}} appearance={appearance}/></div>
    <p className="global-control-hint">{report.lang==="zh"?"拖动平移，滚轮或双指缩放，拖动价格轴调整价格比例。缩放保持不变；“重置视图”恢复默认时间窗口和自动价格比例，并保留所选指标。":"Drag to pan, scroll or pinch to zoom, and drag the price axis to adjust prices. Your zoom stays in place; Reset view restores the starting time window and automatic price scale, keeping selected studies."}</p>
    {pro && <><button onClick={()=>{setLayers(globalDefaultChartLayers(report));setChartView("setup");}}>{report.lang==="zh"?"入场视图":"Setup view"}</button><div className="global-chart-presets" role="group" aria-label={report.lang==="zh"?"图表视图":"Chart views"}><button aria-pressed={layers.studyScale==="context"} onClick={()=>setLayers(current=>({...current,studyScale:current.studyScale==="context"?"setup":"context"}))}>{report.lang==="zh"?"价值背景":"Value context"}</button><button onClick={()=>setLayers(globalDefaultChartLayers(report))}>{report.lang==="zh"?"恢复默认指标":"Reset studies"}</button><span>{report.lang==="zh"?"视图切换已保存的研究，保留平移和缩放。“恢复默认指标”只恢复指标选择。":"Views select saved studies while keeping your pan and zoom. Reset studies restores indicator choices."}</span></div><details className="global-study-options" open><summary>{report.lang==="zh"?"指标设置":"Indicator settings"}</summary><p className="global-control-hint">{report.lang==="zh"?"点按指标显示或隐藏；高亮表示已启用，灰色表示本报告不可用。开关只改变显示，已保存的 Entry、SL 和 TP 不变。":"Tap a study to show or hide it. Highlighted means enabled; dimmed means unavailable in this report. These controls change the display, keeping the saved Entry, SL and TP."}</p><div className="global-layer-controls">{controls.map(([key,label])=><button key={key} data-study-key={key} aria-pressed={Boolean(layers[key])} title={key==="channel"?globalChannelAvailability(report,"broad").reason:key==="localChannel"?globalChannelAvailability(report,"local").reason:undefined} disabled={key==="fibonacci"&&!fibAnchors||key==="ema"&&!report.indicators.ema?.some(e=>e.points.length)||key==="vwapBands"&&!report.indicators.vwap?.bands?.length||key==="range"&&!report.range&&!report.horizonContext?.zones.length&&!report.horizonContext?.ranges.length||key==="vwap"&&!report.indicators.vwap||key==="channel"&&!globalChannelAvailability(report,"broad").available||key==="localChannel"&&!globalChannelAvailability(report,"local").available||key==="channelMid"&&!report.indicators.channels?.length} onClick={()=>setLayers(current=>({...current,[key]:!current[key],...(key==="allSmas"?{sma:!current.allSmas}:{}),...(key==="vwapBands"&&!current.vwapBands?{vwap:true}:{})}))}>{label}</button>)}</div></details></>}
    <details className="global-chart-controls-help"><summary>{report.lang==="zh"?"视图控件说明":"View controls explained"}</summary><dl>
      {pro&&<><dt>{report.lang==="zh"?"入场视图":"Setup view"}</dt><dd>{report.lang==="zh"?"恢复本报告默认的趋势、价值与区间研究，选择入场导出视图，并保留实时图表的缩放。":"Restore the report’s default trend, value and range studies and choose the setup export view, keeping the live chart’s zoom."}</dd>
      <dt>{report.lang==="zh"?"价值背景":"Value context"}</dt><dd>{report.lang==="zh"?"自动价格比例纳入已启用价值研究的更完整范围。关闭时聚焦当前 K 线与计划附近；手动价格比例保持不变。":"Include the full extent of enabled saved value studies in automatic scaling. Turn off to focus near visible candles and the setup; a manual price scale stays in place."}</dd></>}
      <dt>{report.lang==="zh"?"结构视图":"Structure view"}</dt><dd>{report.lang==="zh"?"启用可用的通道、均线、回归、斐波那契和波浪研究，保持当前实时视窗。":"Enable available channels, moving averages, regression, Fibonacci and wave studies, keeping the current live viewport."}</dd>
      <dt>{report.lang==="zh"?"全部历史":"Full history"}</dt><dd>{report.lang==="zh"?"显示报告保存的全部 K 线并自动调整价格比例。在手机上同时打开 K 线检查视图。":"Fit every candle saved in this report and its automatic price scale. On phones this also opens candle inspection."}</dd>
    </dl></details>
    {pro&&!report.indicators.channels?.length&&<p className="global-meta">{globalChannelAvailability(report,"broad").reason}</p>}
    {pro&&layers.fibonacci&&fibAnchors&&<div className="global-fib-readings">{globalFibonacciDescription(report).map(line=><p key={line}>{line}</p>)}<button onClick={()=>{setChartView("fibonacci");fitFib.current();}}>{report.lang==="zh"?"查看斐波那契锚点":"Show measured swing"}</button></div>}
    <div className="global-candle-inspector" data-candle-live={Boolean(candleDetail?.live)} aria-label="Selected candle details">
      <div><strong>{candleDetail?.live?"● LIVE · forming candle":"Selected completed candle"}</strong><time>{candleDetail?new Date(candleDetail.ts).toISOString().slice(0,16).replace("T"," ")+" UTC":"Hover or tap a candle"}</time></div>
      {candleDetail&&<dl>{(["open","high","low","close","volume"] as const).map(key=><div key={key}><dt>{key==="volume"?"Volume":key[0].toUpperCase()+key.slice(1)}</dt><dd>{key==="volume"?candleDetail[key].toLocaleString(undefined,{maximumFractionDigits:4})+" "+report.snapshot.instId.split("-")[0]:globalPrice(report,candleDetail[key])}</dd></div>)}<div><dt>Change</dt><dd>{((candleDetail.close/candleDetail.open-1)*100).toFixed(2)}%</dd></div></dl>}
      <small>Hover or tap to inspect a candle. The live candle updates with the current quote; indicators and confirmation use completed candles.</small>
    </div>
    <div className="global-chart-readout">{readout || `${report.snapshot.venue} · ${report.snapshot.priceCurrency} · ${globalFrameReference(report.snapshot.timeframe)}`} · {report.decisionVersion==="decision-v5"?(report.lang==="zh"?"交易计划 · Entry / SL / TP":"Trade plan · Entry / SL / TP"):(report.lang === "zh" ? "条件走势 · 时间仅为示意" : "Conditional moves · timing is schematic")}</div>
    <p className="global-timeframe-label"><strong>{report.lang === "zh" ? "主图" : "Primary chart"}: {globalTimeframeLabel(report.snapshot.timeframe, report.lang)}</strong>{report.entryStudy&&<span>{report.lang==="zh"?"入场研究":"Entry study"}: {globalTimeframeLabel(report.entryStudy.timeframe,report.lang)} · {report.entryStudy.status==="available"?(report.lang==="zh"?"已完成 K 线":"completed candles"):(report.lang==="zh"?"不可用":"unavailable")}</span>}{pro && <span>{globalLabel("context", report.lang)}: {globalTimeframeLabel(report.context.timeframe ?? "—", report.lang)}</span>}</p>
    <p className="global-control-hint">{report.lang==="zh"?"主图决定计划周期；入场研究用于检查入场反应；背景图用于对照更高周期。K 线、最新报价和快照时间分别显示在图表时钟中，均按 UTC 标记。":"The primary chart sets the setup horizon; the entry study checks the entry reaction; context compares the higher timeframe. Candle, latest-quote and snapshot times are shown separately in the chart clock, in UTC."}</p>
    <div className="global-chart-quote-strip" data-chart-quote-kind={quote?.kind??"unavailable"} data-chart-quote-price={quote?.price} data-chart-quote-ts={quote?.ts}>
      <div><strong>{quote?(quote.kind==="current"?(report.lang==="zh"?"当前报价":"Current quote"):(report.lang==="zh"?"快照报价":"Snapshot quote")):(report.lang==="zh"?"当前报价不可用":"Current quote unavailable")}{quote?`: ${globalPrice(report,quote.price)} ${report.snapshot.priceCurrency}`:""}</strong>{quote&&<span>{new Date(quote.ts).toISOString().slice(0,19).replace("T"," ")} UTC{quote.source?` · ${quote.source}`:""}</span>}</div>
      <div data-chart-primary-close={report.candles.at(-1)!.close}><span>{report.lang==="zh"?"最后完整":"Last completed"} {globalFrameReference(report.snapshot.timeframe)} {report.lang==="zh"?"收盘":"close"}</span><strong>{globalPrice(report,report.candles.at(-1)!.close)} {report.snapshot.priceCurrency}</strong></div>
    </div>
    {pro&&layers.volumeProfile&&report.orderFlow&&<p className="global-chart-profile-coverage">{globalOrderFlowCoverageLabel(report)} · {report.lang==="zh"?"仅该成交窗口，不是主要周期的完整分布。":"These levels describe this execution window, not the full primary timeframe."}</p>}
    <div className={`global-mobile-overview ${inspect?"is-inspecting":""}`} dangerouslySetInnerHTML={{__html:overview}} />
    <div className="global-mobile-inspect"><button aria-pressed={inspect} onClick={()=>setInspect(!inspect)}>{inspect?(report.lang==="zh"?"显示完整走势":"Saved report map"):(report.lang==="zh"?"检查 K 线":"Inspect candles")}</button><small>{report.lang==="zh"?"原图可下载；详细视图支持滑动和缩放。":"Download the original PNG for full detail. Swipe and zoom in the detailed view."}</small></div>
    <div className={`global-chart-scroll ${inspect?"is-inspecting":""}`}><div className="global-chart-stage"><div ref={ref} style={{ height: chartHeight }} /><svg className="global-chart-overlay" style={{zIndex:5,width:overlay.width,height:overlay.height}} width={overlay.width} height={overlay.height} aria-label="Candles, saved setup indicators, range references, Entry, SL and TP" dangerouslySetInnerHTML={{ __html: overlay.svg }} />{pro&&<span className="global-rsi-label">RSI14 · {report.indicators.rsi.points.at(-1)?.value.toFixed(2)??"—"}</span>}</div></div>
    {terminalIndicators.length>0&&<section className="terminal-chart-indicator-key" aria-label="Applied chart indicators"><strong>Applied indicators / shared chart time axis</strong><button type="button" onClick={()=>{setInspect(true);focusTerminalIndicators.current();}}>Inspect execution window on chart</button>{terminalIndicators.map(item=><div key={item.id} data-chart-indicator={item.id}><b>{item.title}</b><span>{indicatorReadings[item.id]??"Hover the indicator pane for its value"}</span><small>{item.units} ? {item.status} coverage ? {new Date(item.windowStart).toISOString().slice(0,16).replace("T"," ")} ? {new Date(item.windowEnd).toISOString().slice(0,16).replace("T"," ")} UTC</small></div>)}<p>Indicator panes use execution timestamps and their own scales. Empty areas have no retained executions; they do not imply zero flow. Zoom to the recent execution window to inspect microstructure on a daily or weekly chart.</p></section>}
    <GlobalChartClock report={report}/>
    <p className="global-sma-readings">{[...report.indicators.sma.filter(s=>layers.sma!==false&&(pro&&layers.allSmas?[21,55,89,144,233]:[55]).includes(s.period)).map(s=>`SMA${s.period} ${globalPrice(report,s.points.at(-1)?.value)}`),...globalSetupStudyReadings(report,layers).map(s=>`${s.name} ${globalPrice(report,s.value)}`)].join(" · ")}</p>{pro&&layers.vwap&&globalVwapContextLine(report)&&<p className="global-meta">{globalVwapContextLine(report)}</p>}{pro&&globalChannelLines(report).map(line=><p key={line} className="global-meta">{line}</p>)}{pro&&<ContextChart report={report}/>}{report.entryStudy&&<div className="global-entry-detail" aria-label="Entry study candles" dangerouslySetInnerHTML={{__html:themeGlobalChartSvg(globalEntryStudySvg(report,660,selectedPathId)??"",appearance)}}/>}
    {pro&&report.orderFlow&&globalOrderFlowLines(report).map(line=><p className="global-meta" key={line}>{line}</p>)}
    {flowStudy&&<div className="global-entry-detail global-footprint-detail" aria-label="Executed trade footprint" dangerouslySetInnerHTML={{__html:themeGlobalChartSvg(flowStudy.svg,appearance)}}/>}
    <details className="global-chart-help"><summary>{report.lang==="zh"?"如何阅读此图":"How to read this chart"}</summary>
      <p>{report.lang==="zh"?"先读买卖方向、证据及入场条件，再对照 Entry、SL、固定 Hard SL 与 TP 区间。绿色和红色用于区分 K 线、支撑阻力及目标风险区域；做空计划的绿色止盈也可位于入场下方。":"Read the side, evidence and entry condition first, then compare Entry, SL, fixed Hard SL and TP zones. Green and red distinguish candles, support/resistance and target/risk areas; a green target can be below entry in a short setup."}</p>
      <p>{report.lang==="zh"?"入场研究展示其标注周期的已完成 K 线。必须按计划要求形成新的反应和确认；过去触及价位、当前报价或确认收盘价，均不自动等于实际成交。":"The entry study shows completed candles on its labeled timeframe. Follow the plan’s required new reaction and confirmation; a past level touch, current quote or confirmation close does not establish a fill."}</p>
      <p>{report.lang==="zh"?"缩放与指标显示不会重新生成分析。PNG 导出使用所选视图和指标的完整报告图；TXT 保留完整文本。点击下载后，在预览窗口保存或分享。":"Zoom and study controls do not regenerate the analysis. PNG exports the full report map for the selected view and studies; TXT keeps the complete text. Choose Download, then Save or Share from the preview."}</p>
      <a href="/docs#docs-global-chart">{report.lang==="zh"?"图表控件、指标与计划完整指南":"Full guide: chart controls, indicators and setup reading"}</a>
    </details></>;
}
