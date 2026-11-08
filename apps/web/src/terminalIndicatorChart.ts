import type { IndicatorManifest, IndicatorResult, TerminalFlowTool } from "@pulse/domain";

/** Executed-volume indicators use their own pane and units, never the asset-price scale. */
export type TerminalChartIndicator = {
  id: string; title: string; units: string; status: string; source: string; instId?:string;
  windowStart: number; windowEnd: number; bucketMs?: number; plot?: "line"|"histogram";
  condition?: { kind:string; threshold:number; label:string };
  priceContext?: {source:string;bucketMs?:number;points:Array<{ts:number;value:number}>};
  points: Array<{ ts: number; value?: number; signal?:boolean; partial?:boolean; reset?:boolean }>;
};
export type TerminalIndicatorPlotInfo = { units: string; points: number; firstTs?: number; lastTs?: number };
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
  return { id: `${manifest.id}@${manifest.version}`, title: manifest.title, instId, units, status: result.status, source: result.provenance.source,
    windowStart: result.provenance.windowStart, windowEnd: result.provenance.windowEnd, bucketMs,...(manifest.format==="pulse-indicator-v3"?{plot:manifest.study.plot}:{}),
    ...(manifest.format==="pulse-indicator-v3"&&manifest.study.signal?{condition:{...manifest.study.signal,threshold:manifest.study.signal.threshold/(studyPercent?100:1),label:indicatorConditionText(manifest.study.signal.kind,manifest.study.signal.threshold/(studyPercent?100:1),units)}}:{}),
    points: result.points.map(point => ({ ts: point.ts,signal:point.signal,partial:point.partial,reset:point.reset, value: manifest.kernel === "executed-cvd-v1" ? point.cvd : manifest.kernel === "buy-participation-v1" ? point.participationBps === undefined ? undefined : point.participationBps / 100 : studyPercent?point.value===undefined?undefined:point.value/100:point.value })) };
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
  const candidates=(flow.displayPoints??[]).filter(point=>point.ts<windowEnd&&point.end>windowStart&&point.ts<=flow.knownAt&&Number.isFinite(point.priceClose)&&point.priceClose>0&&!(flow.missingIntervals??[]).some(gap=>gap.start<point.end&&gap.end>point.ts)).map(point=>({ts:Math.max(point.ts,windowStart),value:point.priceClose}));
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
