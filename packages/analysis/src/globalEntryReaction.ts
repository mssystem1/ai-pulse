import {candleCloseTime,candleTimeframeMs,type GlobalReport} from "@pulse/schemas";

export type GlobalEntryReaction = {
  kind:"completed_rejection"|"completed_sweep"|"completed_break";
  side:"long"|"short";
  timeframe:string;
  anchorTs:number;
  previousTs:number;
  knownAt:number;
  entry:number;
  invalidation:number;
  stop:number;
  atr:{ts:number;knownAt:number;value:number};
  referencePrice:number;
  expiresAt:number;
  level?:{id:string;kind:"high"|"low";anchorTs:number;confirmedAt:number;knownAt:number;price:number};
};

/** Causal execution-frame locations, independent of payoff or later prices.
 * A completed lower high/lower close supplies a sell-limit reference at its
 * bearish body edge; the reflected higher-low pattern supplies a buy limit.
 * This is a resting-order candidate, not an observed exchange fill. */
export function globalEntryReactions(report:GlobalReport):GlobalEntryReaction[]{
  const study=report.entryStudy,cutoff=Date.parse(report.snapshot.observedAt);
  if(study?.status!=="available"||study.source!==report.snapshot.source||study.observedAt!==report.snapshot.observedAt||!Number.isFinite(cutoff))return [];
  const duration=candleTimeframeMs(study.timeframe);
  if(!duration)return [];
  const bars=study.candles.filter(c=>c.confirmed&&(candleCloseTime(c.ts,study.timeframe)??Infinity)<=cutoff);
  if(bars.some(c=>![c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)))return [];
  const last=bars.at(-1);
  if(!last||bars.length<2)return [];
  const quote=report.currentMarket?.quote;
  const referencePrice=quote&&quote.price>0&&quote.ts<=cutoff&&quote.ts>=cutoff-60_000?quote.price:last.close;
  const tick=10**-report.snapshot.pricePrecision,result:GlobalEntryReaction[]=[];
  // Use the existing structural-policy lifetime, tied to the source event.
  // Reprinting an old source must not renew an unfilled order indefinitely.
  const lifetimeBars=16;
  for(let i=Math.max(1,bars.length-lifetimeBars);i<bars.length;i++){
    const source=bars[i],previous=bars[i-1],knownAt=candleCloseTime(source.ts,study.timeframe)!;
    // Freeze volatility with the same completed reaction. A report refresh
    // cannot widen an old source's fixed stop using a later ATR reading.
    const atr=study.atr.find(p=>p.ts===source.ts&&p.value>0);
    if(!atr)continue;
    if(source.ts-previous.ts!==duration||bars.slice(i+1).some((c,j)=>c.ts!==source.ts+(j+1)*duration))continue;
    const shortRejection=source.close<source.open&&source.close<previous.close&&source.high<previous.high;
    const longRejection=source.close>source.open&&source.close>previous.close&&source.low>previous.low;
    const shortSweep=source.close<source.open&&source.close<previous.close&&source.high>previous.high&&source.close<previous.high;
    const longSweep=source.close>source.open&&source.close>previous.close&&source.low<previous.low&&source.close>previous.low;
    const entries:Array<Pick<GlobalEntryReaction,"kind"|"side"|"entry"|"invalidation"|"level">>=[];
    if(shortRejection||shortSweep)entries.push({kind:shortSweep?"completed_sweep":"completed_rejection",side:"short",entry:Math.max(source.open,source.close),invalidation:source.high});
    if(longRejection||longSweep)entries.push({kind:longSweep?"completed_sweep":"completed_rejection",side:"long",entry:Math.min(source.open,source.close),invalidation:source.low});
    // A completed break prices a retest of the actual known broken boundary,
    // not the remote open/high of a large impulse candle. It can invalidate
    // the execution direction while the slower primary trend still lags.
    for(const pivot of study.pivots??[]){
      const levelKnownAt=pivot.confirmedAt===null?null:candleCloseTime(pivot.confirmedAt,study.timeframe);
      if(levelKnownAt===null||levelKnownAt>source.ts)continue;
      const short=pivot.kind==="low"&&previous.close>=pivot.price&&source.close<pivot.price;
      const long=pivot.kind==="high"&&previous.close<=pivot.price&&source.close>pivot.price;
      if(!short&&!long)continue;
      entries.push({kind:"completed_break",side:long?"long":"short",entry:pivot.price,invalidation:pivot.price,level:{id:pivot.id,kind:pivot.kind,anchorTs:pivot.ts,confirmedAt:pivot.confirmedAt!,knownAt:levelKnownAt,price:pivot.price}});
    }
    for(const candidate of entries){
      const long=candidate.side==="long",sign=long?1:-1,invalidation=candidate.invalidation,entry=Number(candidate.entry.toPrecision(12));
      const stop=Number((long?Math.min(invalidation-atr.value*.2,entry-atr.value*.5):Math.max(invalidation+atr.value*.2,entry+atr.value*.5)).toPrecision(12));
      const expiresAt=knownAt+duration*lifetimeBars;
      if(stop<=0||sign*(entry-stop)<=tick||sign*(referencePrice-entry)<0||cutoff>=expiresAt)continue;
      // A failed source cannot be revived merely because its entry is nearby.
      if(bars.slice(i+1).some(c=>long?c.close<invalidation||c.low<=stop:c.close>invalidation||c.high>=stop))continue;
      result.push({...candidate,entry,timeframe:study.timeframe,anchorTs:source.ts,previousTs:previous.ts,knownAt,stop,atr:{ts:atr.ts,knownAt:candleCloseTime(atr.ts,study.timeframe)!,value:atr.value},referencePrice,expiresAt});
    }
  }
  return result.sort((a,b)=>b.knownAt-a.knownAt||Number(b.kind==="completed_break")-Number(a.kind==="completed_break")||Math.abs(a.entry-referencePrice)-Math.abs(b.entry-referencePrice));
}
