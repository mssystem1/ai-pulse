import {candleCloseTime,type GlobalReport} from "@pulse/schemas";

type Side="long"|"short";
type Barrier=NonNullable<GlobalReport["discretionaryPlan"]>["barriers"][number];

/** Route obstacles are not spent profit targets. A lower-frame wick does not
 * establish acceptance through a primary level, and today's quote does not
 * remove opposition from a future entry route. */
export function globalRouteObstacles(report:GlobalReport,side:Side):Barrier[]{
  const tf=report.snapshot.timeframe,cutoff=Date.parse(report.snapshot.observedAt);
  const sources=[{timeframe:tf,candles:report.candles,pivots:report.indicators.pivots},...(report.entryStudy?.status==="available"?[report.entryStudy]:[])];
  const result:Barrier[]=sources.flatMap(s=>{
    const last=s.candles.filter(c=>c.confirmed&&(candleCloseTime(c.ts,s.timeframe)??Infinity)<=cutoff).at(-1);
    if(!last)return [];
    return s.pivots.flatMap(a=>{
      const knownAt=a.confirmedAt===null?null:candleCloseTime(a.confirmedAt,s.timeframe);
      if(knownAt===null||knownAt>cutoff||a.kind!==(side==="long"?"high":"low")||(side==="long"?last.close>a.price:last.close<a.price))return [];
      return [{price:a.price,timeframe:s.timeframe,anchorTs:a.ts,knownAt}];
    });
  });
  // Preserve both genuine edges: an entry inside opposition must not lose
  // the zone just because its near boundary is already behind that entry.
  for(const z of report.horizonContext?.zones??[])if(z.role===(side==="long"?"resistance":"support")&&z.knownAt<=cutoff){
    for(const price of [z.lower,z.upper])result.push({price,timeframe:tf,anchorTs:z.startTs,knownAt:z.knownAt});
  }
  const study=report.entryStudy;
  if(study?.status==="available"){
    const bars=study.candles.filter(c=>c.confirmed&&(candleCloseTime(c.ts,study.timeframe)??Infinity)<=cutoff).slice(-20);
    if(bars.length){const c=bars.reduce((a,b)=>side==="long"?(b.high>a.high?b:a):(b.low<a.low?b:a));result.push({price:side==="long"?c.high:c.low,timeframe:study.timeframe,anchorTs:c.ts,knownAt:candleCloseTime(c.ts,study.timeframe)!});}
  }
  return result.filter((b,i,all)=>all.findIndex(a=>a.price===b.price&&a.timeframe===b.timeframe)===i);
}

export function globalEntryOpposition(report:GlobalReport,side:Side,entry:{lower:number;upper:number}){
  return (report.horizonContext?.zones??[]).filter(z=>z.role===(side==="long"?"resistance":"support")&&z.lower<=entry.upper&&z.upper>=entry.lower);
}
