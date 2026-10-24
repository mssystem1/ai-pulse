import {candleCloseTime,parseCandleTimeframe,type GlobalReport,type GlobalAnchor} from "@pulse/schemas";

/** Context uses actual primary-candle wicks and confirmed anchors. It neither
 * pads zones for appearance nor turns a recovery leg into a balanced market. */
export function applyGlobalHorizonContext(report:GlobalReport){
  const bars=report.candles,last=bars.at(-1),frame=parseCandleTimeframe(report.snapshot.timeframe);if(!last||!frame)return;
  const knownAt=candleCloseTime(last.ts,report.snapshot.timeframe)!;
  const reading=frame.unit==="week"?"macro":frame.unit==="day"?"position":frame.unit==="hour"&&frame.count>=4?"swing":frame.unit==="hour"?"intraday":"session";
  const count=reading==="macro"||reading==="position"?260:reading==="swing"?180:120,first=bars.at(-Math.min(count,bars.length))!.ts;
  const pivots=report.indicators.pivots.filter(a=>a.ts>=first&&a.confirmedAt!==null&&(candleCloseTime(a.confirmedAt,report.snapshot.timeframe)??Infinity)<=knownAt);
  const atr=report.indicators.atr.points.at(-1)?.value??0;
  const zones:NonNullable<GlobalReport["horizonContext"]>["zones"]=[];
  for(const a of pivots){
    const c=bars.find(c=>c.ts===a.ts);if(!c)continue;
    const lower=a.kind==="low"?c.low:Math.max(c.open,c.close),upper=a.kind==="low"?Math.min(c.open,c.close):c.high;
    // An unresolved wick through the current price is not a clear support or
    // resistance zone. Keep the visible zones on their evidenced price side.
    if(last.close>lower&&last.close<upper)continue;
    const role=last.close>=upper?"support":"resistance";
    const overlap=zones.find(z=>z.role===role&&lower<=z.upper&&upper>=z.lower&&Math.max(z.upper,upper)-Math.min(z.lower,lower)<=atr*2);
    if(overlap){overlap.lower=Math.min(overlap.lower,lower);overlap.upper=Math.max(overlap.upper,upper);overlap.startTs=Math.min(overlap.startTs,a.ts);overlap.anchorIds.push(a.id);}
    else zones.push({id:`context-${a.id}`,role,lower,upper,startTs:a.ts,knownAt,anchorIds:[a.id],basis:"confirmed_pivot_wicks"});
  }
  const distance=(z:typeof zones[number])=>Math.max(z.lower-last.close,last.close-z.upper,0);
  const selected=(["support","resistance"] as const).flatMap(role=>zones.filter(z=>z.role===role).sort((a,b)=>distance(a)-distance(b)||b.anchorIds.length-a.anchorIds.length).slice(0,reading==="session"?1:2));
  const ranges:NonNullable<GlobalReport["horizonContext"]>["ranges"]=[];
  const addLeg=(anchors:GlobalAnchor[],cycle=false)=>{
    const low=anchors.filter(a=>a.kind==="low").sort((a,b)=>a.price-b.price)[0];if(!low)return;
    const high=anchors.filter(a=>a.kind==="high").sort((a,b)=>b.price-a.price)[0];if(!high||high.price<=low.price||high.ts===low.ts)return;
    const kind=cycle?"cycle":low.ts<high.ts?"recovery_leg":"decline_leg";
    if(!ranges.some(r=>r.lower===low.price&&r.upper===high.price&&r.startTs===Math.min(low.ts,high.ts)&&r.endTs===Math.max(low.ts,high.ts)))ranges.push({id:`${kind}-${low.id}-${high.id}`,kind,lower:low.price,upper:high.price,startTs:Math.min(low.ts,high.ts),endTs:Math.max(low.ts,high.ts),knownAt,anchorIds:[low.id,high.id]});
    return {low,high};
  };
  if(reading==="macro"){
    addLeg(pivots,true);const recent=bars.at(-Math.min(78,bars.length))!.ts,anchors=pivots.filter(a=>a.ts>=recent),leg=addLeg(anchors);
    // Retain the recovery following a major decline (and the converse) rather
    // than losing either move inside the broad cycle envelope.
    if(leg)addLeg(anchors.filter(a=>a.ts>=Math.max(leg.low.ts,leg.high.ts)));
  }
  else if(reading==="position")addLeg(pivots);
  else if(reading==="session"||reading==="intraday"){
    const d=new Date(last.ts),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()),start=reading==="session"?day:day-(d.getUTCDay()+6)%7*86400000,session=bars.filter(c=>c.ts>=start);
    const lower=Math.min(...session.map(c=>c.low)),upper=Math.max(...session.map(c=>c.high));
    if(session[0]?.ts===start&&upper>lower)ranges.push({id:`session-${start}`,kind:"session",lower,upper,startTs:start,endTs:last.ts,knownAt,anchorIds:[]});
  }
  if(report.range&&ranges.length<(reading==="macro"?3:2))ranges.push({id:"active-balance",kind:"balance",lower:report.range.lower[0],upper:report.range.upper[1],startTs:report.range.startTs,endTs:last.ts,knownAt,anchorIds:report.range.anchorIds});
  report.horizonContext={version:"horizon-context-v1",timeframe:report.snapshot.timeframe,reading,knownAt,zones:selected,ranges};
}
