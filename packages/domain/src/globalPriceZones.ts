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
export function globalPriceZonePayoff(report:GlobalReport){
  const p=report.discretionaryPlan,z=p?.priceZones;if(!p||!z)return null;
  const sign=p.side==="long"?1:-1,worst=p.side==="long"?z.entry.upper:z.entry.lower,best=p.side==="long"?z.entry.lower:z.entry.upper;
  const first=globalTargetReference(report,0)!,obstacle=p.barriers[0]?.price??first;
  return {worstToTP1:sign*(first-worst)/Math.abs(worst-p.stop),bestToTP1:sign*(first-best)/Math.abs(best-p.stop),worstToObstacle:sign*(obstacle-worst)/Math.abs(worst-p.stop),bestToObstacle:sign*(obstacle-best)/Math.abs(best-p.stop)};
}
