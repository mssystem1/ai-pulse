import type {GlobalReport} from "@pulse/schemas";
import {globalChannelBounds} from "./globalChannels.js";
import {globalFrameReference} from "./globalContext.js";
import {globalSetupStudySeries} from "./globalSetupStudies.js";

export type GlobalStructuralLayers={studyScale?:"setup"|"context";channel?:boolean;localChannel?:boolean;regression?:boolean;fibonacci?:boolean;range?:boolean;ema?:boolean;vwap?:boolean;vwapBands?:boolean;volumeProfile?:boolean;footprint?:boolean};
export function globalDefaultChartLayers(report:GlobalReport){
  if(report.tier==="pro"&&report.decisionVersion==="decision-v5"&&report.strategy?.targetPolicy==="active-zones-v1"&&report.indicators.ema?.some(e=>e.points.length))return {
    studyScale:"context" as const,channel:false,localChannel:false,allSmas:false,sma:false,regression:false,fibonacci:false,waves:false,
    ema:true,vwap:Boolean(report.indicators.vwap),vwapBands:true,range:Boolean(report.range||report.horizonContext?.zones.length||report.horizonContext?.ranges.length),volumeProfile:Boolean(report.orderFlow),footprint:Boolean(report.orderFlow?.footprints.length),
  };
  return globalStructureChartLayers(report);
}
export function globalStructureChartLayers(report:GlobalReport){
  const pro=report.tier==="pro";
  return {studyScale:"context" as const,channel:true,localChannel:true,allSmas:pro,sma:true,regression:pro,fibonacci:pro&&globalMeasuredFib(report)!==null,waves:true,ema:false,vwap:false,vwapBands:false,range:false};
}
export function globalMeasuredFib(report:GlobalReport){
  const levels=report.indicators.fibonacci,ids=levels[0]?.anchorIds,anchors=[...report.indicators.pivots,...report.waveCount.anchors];
  if(!ids)return null;
  const a=anchors.find(p=>p.id===ids[0]),b=anchors.find(p=>p.id===ids[1]);
  if(!a||!b||a.confirmedAt===null||b.confirmedAt===null||a.ts>=b.ts||a.price===b.price)return null;
  const tolerance=Math.max(10**-report.snapshot.pricePrecision,Math.abs(b.price)*1e-8);
  if(levels.some(l=>l.anchorIds[0]!==a.id||l.anchorIds[1]!==b.id||Math.abs(l.price-(b.price-(b.price-a.price)*l.ratio))>tolerance))return null;
  return {a,b};
}
/** Fit the evidence that defines this structure, rather than cropping to its
 * last two labels. Full history / Fib anchors remain explicit larger views. */
export function globalStructuralWindow(report:GlobalReport,fitFib=false){
  const count=report.candles.length,minimum=report.strategy?Math.min(260,report.strategy.lookbackBars):/[WM]/.test(report.snapshot.timeframe)?120:/D/.test(report.snapshot.timeframe)?90:96;
  const times=[...(report.indicators.channels??[]).map(c=>c.startTs),...report.waveCount.anchors.map(a=>a.ts),...(report.range?[report.range.startTs]:[])];
  if(fitFib){const fib=globalMeasuredFib(report);if(fib)times.push(fib.a.ts,fib.b.ts);}
  const earliest=Math.min(...times),index=report.candles.findIndex(c=>c.ts>=earliest),needed=index<0?minimum:count-index+6;
  return Math.min(count,fitFib?count:260,Math.max(minimum,needed));
}
/** Shared with the native chart: an enabled rail participates in autoscale. */
export function globalStructuralScaleValues(report:GlobalReport,start:number,layers:GlobalStructuralLayers){
  const last=report.candles.at(-1);if(!last)return [];
  const values:number[]=[];
  const prices=report.candles.filter(c=>c.ts>=start).flatMap(c=>[c.low,c.high]),planned=report.discretionaryPlan;
  if(planned)prices.push(planned.entry,planned.stop,...planned.targets.map(t=>t.price));
  const lo=Math.min(...prices),hi=Math.max(...prices),pad=(hi-lo)*.15;
  for(const study of globalSetupStudySeries(report,layers))values.push(...study.points.filter(p=>p.ts>=start&&p.value>0&&(layers.studyScale!=="setup"||p.value>=lo-pad&&p.value<=hi+pad)).map(p=>p.value));
  if(layers.range&&report.range)values.push(...report.range.lower,...report.range.upper);
  if(layers.range&&report.horizonContext)values.push(...report.horizonContext.zones.flatMap(z=>[z.lower,z.upper]),...report.horizonContext.ranges.flatMap(r=>[r.lower,r.upper]));
  if(layers.volumeProfile&&report.orderFlow)values.push(report.orderFlow.profile.rows[0].low,report.orderFlow.profile.rows.at(-1)!.high);
  for(const channel of report.indicators.channels??[]){
    if(channel.scope==="broad"?layers.channel===false:report.tier!=="pro"||layers.localChannel===false)continue;
    const first=report.candles.find(c=>c.ts>=Math.max(start,channel.startTs));
    for(const ts of [first?.ts,last.ts]){if(ts===undefined)continue;const b=globalChannelBounds(report,channel,ts);if(b)values.push(b.lower,b.upper);}
  }
  if(layers.regression&&report.tier==="pro")for(const rail of [report.indicators.regression?.lower,report.indicators.regression?.upper])values.push(...(rail??[]).filter(p=>p.ts>=start).map(p=>p.value));
  if(layers.fibonacci){const fib=globalMeasuredFib(report);if(fib&&fib.a.ts>=start)values.push(fib.a.price,fib.b.price);}
  return values;
}
export function globalFibonacciDescription(report:GlobalReport):string[]{
  const fib=globalMeasuredFib(report);if(!fib)return [];
  if(report.decisionVersion==="decision-v5")return [`Fibonacci · ${globalFrameReference(report.snapshot.timeframe)} · ${report.lang==="zh"?"已测量摆动":"measured swing"} ${new Date(fib.a.ts).toISOString().slice(0,10)} → ${new Date(fib.b.ts).toISOString().slice(0,10)}.`];
  const zh=report.lang==="zh",format=(p:typeof fib.a)=>`${p.price.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision})} · ${new Date(p.ts).toISOString().slice(0,16).replace("T"," ")} UTC`;
  const offscreen=fib.a.ts<(report.candles.at(-globalStructuralWindow(report))?.ts??0);
  return [`Fibonacci · ${globalFrameReference(report.snapshot.timeframe)} · Fib A ${format(fib.a)} → Fib B ${format(fib.b)}.`,zh?"0 = Fib B，1 = Fib A；与波浪字母标签不同。":"0 = Fib B, 1 = Fib A; these are separate from Elliott letter labels.",...(offscreen?[zh?"宏观摆动锚点在默认视图之外；使用斐波那契锚点视图查看。":"Macro swing anchors extend beyond the default view; use Fit Fibonacci anchors to inspect them."]:[])];
}
export function globalChannelAvailability(report:GlobalReport,scope:"broad"|"local"){
  const available=(report.indicators.channels??[]).some(c=>c.scope===scope);
  return {available,reason:available?"":report.lang==="zh"?"此快照没有满足平行度、跨度、双侧触及和收盘容纳规则的平行通道。":"No parallel channel meets this snapshot's span, two-sided touch and close-containment rules. Regression is a separate study."};
}
