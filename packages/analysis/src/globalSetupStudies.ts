import {candleCloseTime,parseCandleTimeframe, type GlobalAnchor, type GlobalCandle, type GlobalReport} from "@pulse/schemas";
import {applyGlobalHorizonContext} from "./globalHorizonContext.js";

type Point = {ts:number;value:number};
const rounded=(value:number)=>Number(value.toPrecision(12));

/** Display studies only. Selecting a study never changes the canonical trade
 * plan or supplies an execution signal. A data gap resets the EMA warmup. */
export function globalSetupEmas(candles:readonly GlobalCandle[],timeframe:string):NonNullable<GlobalReport["indicators"]["ema"]>{
  return [12,25].map(period=>{
    const points:Point[]=[];let mean=0,warm=0;
    candles.forEach((c,i)=>{
      if(i===0||candleCloseTime(candles[i-1].ts,timeframe)!==c.ts){mean=c.close;warm=0;}
      mean+=(c.close-mean)*2/(period+1);
      if(++warm>=period)points.push({ts:c.ts,value:rounded(mean)});
    });
    return {period,points};
  });
}

/** Anchored, volume-weighted HLC3 and population deviation of those source
 * candle prices. This is not a trade-level volume profile or XO's unknown
 * drawing settings. Preserve when the anchor first became observable. */
export function globalSetupVwap(candles:readonly GlobalCandle[],anchor:Pick<GlobalAnchor,"id"|"ts"|"confirmedAt">|undefined,timeframe:string):GlobalReport["indicators"]["vwap"]{
  if(!anchor||anchor.confirmedAt===null)return null;
  const knownAt=candleCloseTime(anchor.confirmedAt,timeframe),last=candles.at(-1),through=last?candleCloseTime(last.ts,timeframe):null;
  if(knownAt===null||through===null||knownAt>through||!candles.some(c=>c.ts===anchor.ts))return null;
  const source=candles.filter(c=>c.ts>=anchor.ts);
  // A missing segment makes the anchor's cumulative calculation incomplete.
  if(source.some((c,i)=>i>0&&candleCloseTime(source[i-1].ts,timeframe)!==c.ts))return null;
  const points:Point[]=[],bands=([1,2,3] as const).map(multiple=>({multiple,upper:[] as Point[],lower:[] as Point[]}));
  let total=0,mean=0,m2=0;
  for(const c of source){
    if(c.volume>0){
      const price=(c.high+c.low+c.close)/3,next=total+c.volume,delta=price-mean;
      if(total===0){mean=price;m2=0;}else{mean+=delta*c.volume/next;m2+=c.volume*delta*(price-mean);}
      total=next;
    }
    if(!total)continue;
    const sd=Math.sqrt(Math.max(0,m2/total));
    if(![mean,sd,total,m2].every(Number.isFinite))return null;
    points.push({ts:c.ts,value:rounded(mean)});
    for(const band of bands){band.upper.push({ts:c.ts,value:rounded(mean+band.multiple*sd)});band.lower.push({ts:c.ts,value:rounded(mean-band.multiple*sd)});}
  }
  return points.length?{anchorId:anchor.id,anchorTs:anchor.ts,knownAt,basis:"primary_hlc3_volume",points,bands}:null;
}

/** Different horizons answer different location questions. Calendar VWAP is
 * used intraday; position/macro value starts at a confirmed dominant extreme. */
export function globalHorizonVwap(candles:readonly GlobalCandle[],pivots:readonly GlobalAnchor[],timeframe:string){
  const last=candles.at(-1),frame=parseCandleTimeframe(timeframe);if(!last||!frame)return null;
  const closed=candleCloseTime(last.ts,timeframe)!;
  let anchor:Pick<GlobalAnchor,"id"|"ts"|"confirmedAt">|undefined,reason:NonNullable<GlobalReport["indicators"]["vwap"]>["anchorReason"];
  if(frame.unit==="minute"||frame.unit==="hour"&&frame.count===1){
    const d=new Date(last.ts),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()),start=frame.unit==="minute"?day:day-(d.getUTCDay()+6)%7*86400000;
    const first=candles.find(c=>c.ts===start);if(first){anchor={id:`${frame.unit==="minute"?"session":"week"}-open-${start}`,ts:start,confirmedAt:start};reason=frame.unit==="minute"?"session_open":"week_open";}
  }
  if(!anchor){
    const window=frame.unit==="week"?260:frame.unit==="day"?260:180,first=candles.at(-Math.min(window,candles.length))!.ts;
    const known=pivots.filter(a=>a.ts>=first&&a.confirmedAt!==null&&(candleCloseTime(a.confirmedAt,timeframe)??Infinity)<=closed);
    const low=known.filter(a=>a.kind==="low").sort((a,b)=>a.price-b.price||b.ts-a.ts)[0],high=known.filter(a=>a.kind==="high").sort((a,b)=>b.price-a.price||b.ts-a.ts)[0];
    const kind=low&&high&&last.close<(low.price+high.price)/2?"high":"low";anchor=kind==="low"?low??high:high??low;
    reason=frame.unit==="week"?(anchor===low?"cycle_low":"cycle_high"):(anchor===low?"swing_low":"swing_high");
  }
  const vwap=globalSetupVwap(candles,anchor,timeframe);return vwap?{...vwap,anchorReason:reason!,selectedAt:closed}:null;
}

/** Enrich a separate technical review using only its saved source candles.
 * Resolve the original anchor before considering the saved structure fallback. */
export function restoreGlobalSetupStudies(report:GlobalReport){
  report.indicators.ema??=globalSetupEmas(report.candles,report.snapshot.timeframe);
  if(!report.horizonContext&&report.decisionVersion==="decision-v5"&&report.strategy?.targetPolicy==="active-zones-v1"){
    report.indicators.vwap=globalHorizonVwap(report.candles,report.indicators.pivots,report.snapshot.timeframe);applyGlobalHorizonContext(report);
  }else if(!report.indicators.vwap?.bands?.length){
    const original=report.indicators.vwap,anchors=[...report.waveCount.anchors,...report.indicators.pivots];
    const calendar=original?.anchorTs!==undefined&&(original.anchorReason==="session_open"||original.anchorReason==="week_open")?{id:original.anchorId,ts:original.anchorTs,confirmedAt:original.anchorTs}:undefined;
    const anchor=calendar??(original?anchors.find(a=>a.id===original.anchorId||a.ts===original.anchorTs):report.waveCount.anchors[0]??report.indicators.pivots.at(-2));
    const reconstructed=globalSetupVwap(report.candles,anchor,report.snapshot.timeframe);
    if(reconstructed)report.indicators.vwap={...reconstructed,...(original?.anchorReason?{anchorReason:original.anchorReason}:{}),...(original?.selectedAt!==undefined?{selectedAt:original.selectedAt}:{})};
  }
  if(report.tier==="pro"&&report.indicators.ema.some(e=>e.points.length)){
    report.view.smaPeriods=[];
    report.view.defaultLayers=["ema","vwap","vwapBands","range","rsi","context"];
  }
}
