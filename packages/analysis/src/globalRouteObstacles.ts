import {candleCloseTime,type GlobalReport} from "@pulse/schemas";

type Side="long"|"short";
type Barrier=NonNullable<GlobalReport["discretionaryPlan"]>["barriers"][number];

/** Entry-study exits include polarity-flipped wick zones, not just pivots
 * whose original high/low label happens to match today's support/resistance. */
export function globalEntryStudyObstacles(report:GlobalReport,side:Side):Array<Barrier&{basis:"confirmed_swing"|"structure_zone"|"observed_extreme"}>{
  const s=report.entryStudy,cutoff=Date.parse(report.snapshot.observedAt);
  if(s?.status!=="available"||s.source!==report.snapshot.source)return [];
  const bars=s.candles.filter(c=>c.confirmed&&(candleCloseTime(c.ts,s.timeframe)??Infinity)<=cutoff),last=bars.at(-1);
  if(!last)return [];
  const result:Array<Barrier&{basis:"confirmed_swing"|"structure_zone"|"observed_extreme"}>=[];
  const available=s.pivots.filter(a=>a.confirmedAt!==null&&(candleCloseTime(a.confirmedAt,s.timeframe)??Infinity)<=cutoff);
  for(const a of available)if(a.kind===(side==="long"?"high":"low")&&(side==="long"?last.close<=a.price:last.close>=a.price))result.push({price:a.price,timeframe:s.timeframe,anchorTs:a.ts,knownAt:candleCloseTime(a.confirmedAt!,s.timeframe)!,basis:"confirmed_swing"});
  for(const a of available){
    const c=bars.find(c=>c.ts===a.ts);if(!c)continue;
    const lower=a.kind==="low"?c.low:Math.max(c.open,c.close),upper=a.kind==="low"?Math.min(c.open,c.close):c.high;
    const role=last.close>=upper?"support":last.close<=lower?"resistance":null;
    if(role!==(side==="long"?"resistance":"support"))continue;
    for(const price of [lower,upper])result.push({price,timeframe:s.timeframe,anchorTs:a.ts,knownAt:candleCloseTime(last.ts,s.timeframe)!,basis:"structure_zone"});
  }
  const recent=bars.slice(-20),extreme=recent.reduce((a,b)=>side==="long"?(b.high>a.high?b:a):(b.low<a.low?b:a));
  result.push({price:side==="long"?extreme.high:extreme.low,timeframe:s.timeframe,anchorTs:extreme.ts,knownAt:candleCloseTime(extreme.ts,s.timeframe)!,basis:"observed_extreme"});
  return result;
}

/** Route obstacles are not spent profit targets. A lower-frame wick does not
 * establish acceptance through a primary level, and today's quote does not
 * remove opposition from a future entry route. */
export function globalRouteObstacles(report:GlobalReport,side:Side,includeEntryZones=false):Barrier[]{
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
  if(includeEntryZones)result.push(...globalEntryStudyObstacles(report,side));
  return result.filter((b,i,all)=>all.findIndex(a=>a.price===b.price&&a.timeframe===b.timeframe)===i);
}

export function globalEntryOpposition(report:GlobalReport,side:Side,entry:{lower:number;upper:number}){
  return (report.horizonContext?.zones??[]).filter(z=>z.role===(side==="long"?"resistance":"support")&&z.lower<=entry.upper&&z.upper>=entry.lower);
}
