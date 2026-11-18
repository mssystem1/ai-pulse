import { candleCloseTime } from "@pulse/domain";
import type { IndicatorManifest, IndicatorResult, TerminalFlowTool } from "@pulse/domain";

/** Executed-volume indicators use their own pane and units, never the asset-price scale. */
export type TerminalChartIndicator = {
  id: string; title: string; units: string; status: string; source: string; instId?:string; timeframe?:string; sourceKind?:"completed-ohlcv"|"executed-flow";
  calculation?:"nand"|"hybrid"|"host"; publisher?:string; pane?:"price"|"indicator"; group?:string; color?:string; parentId?:string;sourceNote?:string;
  windowStart: number; windowEnd: number; bucketMs?: number; plot?: "line"|"histogram";
  condition?: { kind:string; threshold:number; label:string };
  priceContext?: {source:string;bucketMs?:number;points:Array<{ts:number;value:number}>};
  points: Array<{ ts: number; value?: number; signal?:boolean; partial?:boolean; reset?:boolean }>;
};
export type TerminalIndicatorPlotInfo = { units: string; points: number; firstTs?: number; lastTs?: number };
/** A short live capture and retained history may contain the same studies.
 * Their different clocks need a fresh fit instead of inheriting a minute-wide
 * viewport on a month of hourly bars. Polling the same source preserves zoom. */
export function terminalExecutionViewportKey(instId:string,timeframe:string,studies:readonly TerminalChartIndicator[]){
  return JSON.stringify([instId,timeframe,studies.map(item=>[item.id,item.source,item.bucketMs??null])]);
}
export function terminalIndicatorPriceFormat(units: string) {
  return { type: "custom" as const, formatter: (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + units, minMove: .0001 };
}
/** Summarize the values actually handed back by the chart series, excluding
 * gap whitespace. This makes the visible legend useful when a pane is empty. */
export function terminalIndicatorPlotInfo(units: string, data: readonly { time: unknown; value?: number }[]): TerminalIndicatorPlotInfo {
  const resolved = data.filter((point): point is { time: number; value: number } => typeof point.time === "number" && Number.isFinite(point.value));
  return { units, points: resolved.length, ...(resolved.length ? { firstTs: resolved[0].time * 1000, lastTs: resolved.at(-1)!.time * 1000 } : {}) };
}
export function terminalChartIndicator(manifest: IndicatorManifest, result: IndicatorResult, instId: string, stream: "spot" | "perpetual", bucketMs?: number): TerminalChartIndicator {
  const baseAsset=instId.split("-")[0];
  const output = manifest.kernel === "formula-v1" ? manifest.formula.output : undefined;
  const studyPercent=manifest.format==="pulse-indicator-v3"&&output?.unit==="bps";
  const units = manifest.kernel === "executed-cvd-v1" ? stream === "spot" ? baseAsset : "contracts" : manifest.kernel === "buy-participation-v1"||studyPercent ? "%" : output?.unit === "volume" ? stream === "spot" ? baseAsset : "contracts" : output?.unit ?? "scalar";
  return { calculation:"nand", id: `${manifest.id}@${manifest.version}`, title: manifest.title, publisher:manifest.author, instId, units, status: result.status, source: result.provenance.source,
    windowStart: result.provenance.windowStart, windowEnd: result.provenance.windowEnd, bucketMs,...(manifest.format==="pulse-indicator-v3"?{plot:manifest.study.plot}:{}),
    ...(manifest.format==="pulse-indicator-v3"&&manifest.study.signal?{condition:{...manifest.study.signal,threshold:manifest.study.signal.threshold/(studyPercent?100:1),label:indicatorConditionText(manifest.study.signal.kind,manifest.study.signal.threshold/(studyPercent?100:1),units)}}:{}),
    points: result.points.map(point => ({ ts: point.ts,signal:point.signal,partial:point.partial,reset:point.reset, value: manifest.kernel === "executed-cvd-v1" ? point.cvd : manifest.kernel === "buy-participation-v1" ? point.participationBps === undefined ? undefined : point.participationBps / 100 : studyPercent?point.value===undefined?undefined:point.value/100:point.value })) };
}
/** Graph plots preserve their own placement and units. Price overlays share the
 * existing price axis; compatible outputs from one tool share one study pane. */
export function terminalChartIndicators(manifest:IndicatorManifest,result:IndicatorResult,instId:string,stream:"spot"|"perpetual",bucketMs?:number):TerminalChartIndicator[]{
  if(manifest.format!=="pulse-indicator-v4")return [terminalChartIndicator(manifest,result,instId,stream,bucketMs)];
  return (result.outputs??[]).map(({plot,points,quantityUnits})=>{
    const units=plot.unit==="price"?(instId.split("-")[1]??"USDT"):plot.unit==="percent"?"%":plot.unit==="volume"?(quantityUnits==="base"?instId.split("-")[0]:quantityUnits==="contracts"?"contracts":stream==="spot"?instId.split("-")[0]:"contracts"):"scalar";
    return {calculation:manifest.graph.nodes.some(node=>node.kind==="kernel")?"hybrid":"host",id:`${manifest.id}@${manifest.version}:${plot.id}`,parentId:`${manifest.id}@${manifest.version}`,title:plot.label,publisher:manifest.author,instId,units,status:result.status,source:result.provenance.source,windowStart:result.provenance.windowStart,windowEnd:result.provenance.windowEnd,bucketMs:result.provenance.graph?.sourceIntervalMs??bucketMs,plot:plot.style,pane:plot.pane,group:`${manifest.id}@${manifest.version}:${units}`,color:plot.color,points:points.map(point=>({...point}))};
  });
}

/** Repeated above/below observations are one condition episode. Mark only a
 * newly true episode; partial/unknown bars and resets never fabricate a cross. */
export function terminalIndicatorEvents(study:TerminalChartIndicator){
  let previous=false;
  return study.points.flatMap(point=>{if(point.value===undefined||point.partial){previous=false;return [];}const hit=Boolean(point.signal),event=hit&&(!previous||point.reset);previous=hit;return event?[point]:[];});
}
export function indicatorConditionText(kind:string,threshold:number,units:string){
  const verb=({above:"Above",below:"Below","cross-above":"Cross above","cross-below":"Cross below"} as Record<string,string>)[kind]??kind;
  return `${verb} ${threshold.toLocaleString(undefined,{maximumFractionDigits:4})} ${units}`;
}
/** Price remains Spot even when a separate study uses Futures quantities.
 * These are captured execution-bucket closes, never fabricated primary candles. */
export function terminalIndicatorSpotPriceContext(flow:TerminalFlowTool):TerminalChartIndicator["priceContext"]{
  const {windowStart,windowEnd}=flow;
  if(typeof windowStart!=="number"||typeof windowEnd!=="number"||!Number.isFinite(windowStart)||!Number.isFinite(windowEnd)||windowEnd<=windowStart)return;
  const candidates=(flow.displayPoints??[]).filter(point=>point.tradeCount>0&&point.ts<windowEnd&&point.end>windowStart&&point.ts<=flow.knownAt&&Number.isFinite(point.priceClose)&&point.priceClose>0&&!(flow.missingIntervals??[]).some(gap=>gap.start<point.end&&gap.end>point.ts)).map(point=>({ts:Math.max(point.ts,windowStart),value:point.priceClose}));
  const points=[...new Map(candidates.map(point=>[point.ts,point])).values()].sort((a,b)=>a.ts-b.ts);
  return points.length?{source:flow.source,bucketMs:flow.displayBucketMs,points}:undefined;
}
/** Preserve source time; insert whitespace at gaps rather than connecting unknown intervals. */
export function terminalIndicatorSeries(study: TerminalChartIndicator): Array<{ time: number; value?: number; color?:string }> {
  const points = new Map<number, { time: number; value?: number; color?:string }>();
  study.points.forEach((point, index) => {
    const previous = study.points[index - 1];
    if (previous && study.bucketMs && point.ts - previous.ts > study.bucketMs) {
      const time = Math.floor((previous.ts + study.bucketMs) / 1000);
      if (time < Math.floor(point.ts / 1000)) points.set(time, { time });
    }
    const time = Math.floor(point.ts / 1000);
    points.set(time, { time, ...(Number.isFinite(point.value) ? { value: point.value,...(study.plot==="histogram"?{color:point.value!>=0?"#00b99c":"#ed6384"}:{}) } : {}) });
  });
  return [...points.values()].sort((a, b) => a.time - b.time);
}

/** The overview samples the last actual reading in each primary candle slot.
 * It does not aggregate flow, manufacture OHLC or add microsecond/minute slots
 * to the candle axis. Inspect mode retains the original execution clock. */
export function terminalIndicatorPrimaryClock(study: TerminalChartIndicator, candles: readonly {ts:number}[], timeframe:string): TerminalChartIndicator {
  if(!candles.length)return {...study,points:[]};
  const slots=candles.map(c=>({start:c.ts,end:candleCloseTime(c.ts,timeframe)})).filter((s):s is {start:number;end:number}=>s.end!==null);
  const last=slots.at(-1);if(last){const end=candleCloseTime(last.end,timeframe);if(end!==null)slots.push({start:last.end,end});}
  const sampled=new Map<number,TerminalChartIndicator["points"][number]>();let index=0;
  for(const point of study.points){while(index<slots.length&&point.ts>=slots[index].end)index++;const slot=slots[index];if(slot&&point.ts>=slot.start&&point.ts<slot.end)sampled.set(slot.start,{...point,ts:slot.start});}
  return {...study,bucketMs:undefined,points:[...sampled.values()]};
}
