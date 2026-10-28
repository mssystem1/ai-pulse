import type {GlobalReport} from "@pulse/schemas";
export type GlobalPriceBand={lower:number;upper:number};
export function globalPriceBandText(report:GlobalReport,band:GlobalPriceBand){
  const price=(n:number)=>n.toLocaleString(report.lang==="zh"?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision});
  return band.lower===band.upper?price(band.lower):`${price(band.lower)}–${price(band.upper)}`;
}
export function globalTargetReference(report:GlobalReport,index:number){
  const p=report.discretionaryPlan,t=p?.targets[index],zone=p?.priceZones?.targets[index];
  return zone?(p!.side==="long"?zone.lower:zone.upper):t?.price;
}
/** Retained opposing primary zones remain an obstacle when Entry touches them. */
export function globalOpposingEntryZones(report:GlobalReport){
  const p=report.discretionaryPlan,entry=p?.priceZones?.entry,context=report.horizonContext;
  if(!p||!entry||context?.timeframe!==report.snapshot.timeframe)return [];
  const cutoff=Date.parse(report.snapshot.observedAt),role=p.side==="long"?"resistance":"support";
  return context.zones.filter(zone=>zone.role===role&&zone.knownAt<=cutoff&&zone.lower<=entry.upper&&zone.upper>=entry.lower);
}
export function globalPriceZonePayoff(report:GlobalReport){
  const p=report.discretionaryPlan,z=p?.priceZones;if(!p||!z)return null;
  const sign=p.side==="long"?1:-1,worst=p.side==="long"?z.entry.upper:z.entry.lower,best=p.side==="long"?z.entry.lower:z.entry.upper;
  const first=globalTargetReference(report,0)!,obstacle=p.barriers[0]?.price??first;
  const overlaps=globalOpposingEntryZones(report),bestRisk=Math.abs(best-p.stop);
  const bestToObstacle=Math.min(sign*(obstacle-best)/bestRisk,...overlaps.map(zone=>best>=zone.lower&&best<=zone.upper?0:sign*((p.side==="long"?zone.lower:zone.upper)-best)/bestRisk));
  return {worstToTP1:sign*(first-worst)/Math.abs(worst-p.stop),bestToTP1:sign*(first-best)/bestRisk,worstToObstacle:overlaps.length?0:sign*(obstacle-worst)/Math.abs(worst-p.stop),bestToObstacle};
}
