import {useEffect,useMemo,useRef} from "react";
import {createChart,createSeriesMarkers,LineSeries,HistogramSeries,ColorType,type UTCTimestamp,type Time} from "lightweight-charts";
import {IndicatorRuntimeBadge} from "./IndicatorRuntimeBadge";
import {useGlobalChartAppearance} from "./useGlobalChartAppearance";
import {globalChartColor} from "./globalChartTheme";
import {terminalUtc,terminalPrice} from "./terminalClient";
import {terminalExecutionViewportKey,terminalIndicatorSeries,terminalIndicatorEvents,terminalIndicatorPriceFormat,type TerminalChartIndicator} from "./terminalIndicatorChart";

const colors=["#ffcb76","#b790ff","#59c2ee","#e593c2","#71969b"];
const stamp=(ts:number)=>Math.floor(ts/1000) as UTCTimestamp;
/** Execution bars cannot share a daily/week candle axis without collapsing
 * into a dot. Keep their actual clock visible by default, below the primary
 * chart; price-based indicators remain aligned with the primary candles. */
export function TerminalExecutionStudies({studies,instId,timeframe}:{studies:TerminalChartIndicator[];instId:string;timeframe:string}){
 const appearance=useGlobalChartAppearance();
 const ref=useRef<HTMLDivElement>(null),labels=useRef<Record<string,HTMLDivElement|null>>({});
 const viewport=useRef<{key:string;range:{from:Time;to:Time}|null}|null>(null);
 const groups=useMemo(()=>[...new Set(studies.filter(item=>item.points.some(point=>Number.isFinite(point.value))).map(item=>item.group??item.id))],[studies]);
 const height=180+groups.length*150;
 const identity=terminalExecutionViewportKey(instId,timeframe,studies);
 useEffect(()=>{
  if(!ref.current||!groups.length)return;
  const paint=(color:string)=>globalChartColor(color,appearance);
  const chart=createChart(ref.current,{autoSize:true,height,layout:{background:{type:ColorType.Solid,color:appearance==="light"?"#f8fbff":"#0d1420"},textColor:paint("#8d9cb3"),fontSize:11},grid:{vertLines:{visible:false},horzLines:{color:appearance==="light"?"#cbd5e4":"#263142",style:2}},rightPriceScale:{borderVisible:false},timeScale:{timeVisible:true,secondsVisible:studies.some(study=>(study.bucketMs??60_000)<60_000),borderVisible:false},localization:{timeFormatter:(time:Time)=>typeof time==="number"?new Date(time*1000).toISOString().slice(0,19).replace("T"," ")+" UTC":String(time)}});
  const price=studies.find(item=>item.priceContext?.points.length)?.priceContext;
  if(price)chart.addSeries(LineSeries,{color:paint("#ffcb76"),lineWidth:2,priceLineVisible:false,lastValueVisible:true,priceFormat:{type:"price",precision:2,minMove:.01}},0).setData(price.points.map(point=>({time:stamp(point.ts),value:point.value})));
  for(const [index,item]of studies.entries()){
   const group=item.group??item.id,pane=groups.indexOf(group)+1;if(pane<1)continue;
   const common={color:paint(item.color??colors[index%colors.length]),priceLineVisible:false,lastValueVisible:true,priceFormat:terminalIndicatorPriceFormat(item.units)};
   const series=item.plot==="histogram"?chart.addSeries(HistogramSeries,{...common,base:0},pane):chart.addSeries(LineSeries,{...common,lineWidth:2,pointMarkersVisible:item.points.filter(point=>Number.isFinite(point.value)).length===1},pane);
   series.setData(terminalIndicatorSeries(item).map(point=>({...point,time:point.time as UTCTimestamp})));
   if(item.condition)series.createPriceLine({price:item.condition.threshold,title:item.condition.label,color:paint("#ffcb76"),lineStyle:2,lineWidth:1,axisLabelVisible:true});
   createSeriesMarkers(series,terminalIndicatorEvents(item).map(point=>({time:stamp(point.ts),position:"aboveBar",shape:"circle",color:paint(item.color??colors[index%colors.length])})));
  }
  chart.panes().forEach((pane,index)=>pane.setStretchFactor(index===0?180:150));
  const restored=viewport.current?.key===identity&&viewport.current.range;
  if(restored)chart.timeScale().setVisibleRange(viewport.current!.range!);else chart.timeScale().fitContent();
  const positionLabels=()=>{if(!ref.current)return;const top=ref.current.getBoundingClientRect().top;groups.forEach((group,index)=>{const label=labels.current[group],pane=chart.panes()[index+1]?.getHTMLElement();if(label&&pane)label.style.top=`${pane.getBoundingClientRect().top-top+4}px`;});const range=chart.timeScale().getVisibleRange();if(range){ref.current.dataset.visibleStart=String(range.from);ref.current.dataset.visibleEnd=String(range.to);}};
  let fittedAfterResize=Boolean(restored);
  const resize=new ResizeObserver(()=>{positionLabels();if(!fittedAfterResize){fittedAfterResize=true;chart.timeScale().fitContent();positionLabels();}});resize.observe(ref.current);positionLabels();
  return()=>{viewport.current={key:identity,range:chart.timeScale().getVisibleRange()};resize.disconnect();chart.remove();};
 },[studies,groups,appearance,identity,height]);
 if(!studies.length)return null;
 return <section className="terminal-execution-studies" aria-label="Executed-flow indicators" data-execution-studies data-source-timeframe={timeframe}>
  <header><h3>Executed-flow indicators</h3><p>{instId} · {timeframe.replace("utc","")} workspace. Price above uses {timeframe.replace("utc","")} candles; these indicators use the actual execution-bar clock shown here.</p><p role="status">{studies[0].sourceNote}</p><small>Captured Spot execution price · {terminalUtc(Math.min(...studies.map(item=>item.windowStart)))} → {terminalUtc(Math.max(...studies.map(item=>item.windowEnd)))}</small></header>
  {groups.length>0&&<div className="terminal-execution-chart"><div ref={ref} style={{height}}/>{groups.map(group=>{const items=studies.filter(item=>(item.group??item.id)===group);return <div key={group} ref={node=>{labels.current[group]=node;}} className="terminal-indicator-pane-label"><b>{items.map(item=>item.title).join(" / ")}</b><span>Publisher: {items[0]?.publisher??"PULSE"}</span></div>;})}</div>}
  <div className="terminal-chart-indicator-key" aria-label="Applied execution indicators">{studies.map(item=>{const points=item.points.filter(point=>Number.isFinite(point.value)),latest=points.at(-1),values=points.map(point=>point.value!),series=terminalIndicatorSeries(item);return <div key={item.id} data-chart-indicator={item.id} data-source-timeframe={timeframe} data-plotted-points={points.length} data-plotted-series-points={series.filter(point=>Number.isFinite(point.value)).length} data-first-ts={points[0]?.ts??""} data-last-ts={points.at(-1)?.ts??""} data-min-value={values.length?Math.min(...values):""} data-max-value={values.length?Math.max(...values):""} data-latest-value={latest?.value??""} data-plotted-units={item.units}><b>{item.title}</b><IndicatorRuntimeBadge calculation={item.calculation} compact/><span>{latest?.value===undefined?"Waiting for complete source bars":`${terminalPrice(latest.value,4)} ${item.units}`}</span><small>Publisher: {item.publisher??"PULSE"} · {points.length} plotted values · {item.bucketMs?`${item.bucketMs/1000}s source bars`:"Source interval not supplied"} · {item.status} coverage</small>{!points.length&&<p className="terminal-warning">This calculation has not completed its warm-up. Missing execution intervals are unknown; the calculation resumes after enough contiguous complete bars arrive.</p>}</div>;})}</div>
 </section>;
}
