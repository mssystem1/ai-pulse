import {candleCloseTime,type GlobalReport,type GlobalAnchor} from "@pulse/schemas";

/** A confirmed swing is an observation, not automatically a current exit level.
 * A close through its zone consumes that role. A later confirmed same-side
 * pivot can establish a new zone; merely crossing back does not revive it.
 * The 0.20 ATR grouping is a disclosed PULSE noise setting, not a TV rule.
 */
export function activeGlobalTargetZones(report:GlobalReport,side:"long"|"short",trigger:number,first:number){
  const sign=side==="long"?1:-1,tick=10**-report.snapshot.pricePrecision;
  const atr=report.indicators.atr.points.at(-1)?.value??0,width=Math.max(tick*2,atr*.2);
  const anchors=report.indicators.pivots.filter(a=>{
    if(a.confirmedAt===null||a.ts<first||a.kind!==(side==="long"?"high":"low")||sign*(a.price-trigger)<=0)return false;
    const knownAt=candleCloseTime(a.confirmedAt,report.snapshot.timeframe)??Infinity;
    if(knownAt>Date.parse(report.snapshot.observedAt))return false;
    return !report.candles.some(c=>c.ts>=knownAt&&sign*(c.close-a.price)>tick*.5);
  });
  const sorted=[...anchors].sort((a,b)=>sign*(a.price-b.price)),zones:GlobalAnchor[][]=[];
  for(const a of sorted){const zone=zones.at(-1);if(zone&&Math.abs(a.price-zone[0].price)<=width)zone.push(a);else zones.push([a]);}
  return zones.flatMap(zone=>{
    const knownAt=Math.max(...zone.map(a=>candleCloseTime(a.confirmedAt!,report.snapshot.timeframe)??Infinity));
    // A confirmed unconsumed swing remains a real barrier when also used as a
    // Fibonacci measurement endpoint. Do not skip it for a farther reward.
    // Derived Fibonacci prices without a confirmed swing never enter this list.
    return [{price:zone[0].price,anchors:zone,knownAt}];
  });
}
