import {candleCloseTime,candleLevelTouchedAfter,type GlobalReport} from "@pulse/schemas";
import {selectGlobalSetupContext} from "./globalSetupContext.js";
import {applyGlobalPriceZones} from "./globalPriceZones.js";
import {globalRouteObstacles} from "./globalRouteObstacles.js";

/** A complete conditional scenario when an observed signal is not established.
 * It does not change the canonical signal, history or execution permission. */
export function applyGlobalDiscretionaryPlan(report:GlobalReport){
  if(report.decisionVersion!=="decision-v5"||report.strategy?.targetPolicy!=="active-zones-v1")return;
  delete report.discretionaryPlan;
  const canonical=report.tradePlan;
  if(canonical?.state==="confirmed"&&canonical.referenceEntry&&canonical.referenceStop!==null)return;
  const study=report.entryStudy?.status==="available"?report.entryStudy:null,bars=study?.candles??report.candles,timeframe=study?.timeframe??report.snapshot.timeframe,last=bars.at(-1),prior=bars.at(-2);
  const primaryLast=report.candles.at(-1),primaryTimeframe=report.snapshot.timeframe;
  if(!last||!prior||!primaryLast)return;
  const completedAt=candleCloseTime(last.ts,timeframe),cutoff=Date.parse(report.snapshot.observedAt);
  const primaryClosed=candleCloseTime(primaryLast.ts,primaryTimeframe);
  if(completedAt===null||completedAt>cutoff||primaryClosed===null||primaryClosed>cutoff)return;
  const lower=report.entryStudy?.source===report.snapshot.source?report.entryStudy:null,lowerLast=lower?.candles.at(-1),lowerClosed=lowerLast?candleCloseTime(lowerLast.ts,lower!.timeframe):null;
  const reference=lowerLast&&lowerClosed!==null&&lowerClosed>=completedAt&&lowerClosed<=cutoff?{timeframe:lower!.timeframe,candleTs:lowerLast.ts,completedAt:lowerClosed,price:lowerLast.close}:{timeframe,candleTs:last.ts,completedAt,price:last.close};
  let entry=last.close;
  const atr=(study?.atr??report.indicators.atr.points).at(-1)?.value??Math.max(last.high-last.low,entry*.001),tick=10**-report.snapshot.pricePrecision;
  const round=(p:number)=>Number(p.toPrecision(12));
  const sources=[{bars,pivots:study?.pivots??report.indicators.pivots,timeframe},...(study?[{bars:report.candles,pivots:report.indicators.pivots,timeframe:report.snapshot.timeframe}]:[])];
  const known=sources.flatMap(source=>source.pivots.flatMap(a=>{
    const knownAt=a.confirmedAt===null?null:candleCloseTime(a.confirmedAt,source.timeframe);
    if(knownAt===null||knownAt>cutoff||source.bars.some(c=>c.ts>=knownAt&&(a.kind==="high"?c.close>a.price:c.close<a.price)))return [];
    return [{price:a.price,anchorTs:a.ts,knownAt,timeframe:source.timeframe,kind:a.kind,basis:"confirmed_swing" as const}];
  }));
  const primaryAtr=report.indicators.atr.points.at(-1)?.value??atr;
  const {side,family,entryBasis,evidence}=selectGlobalSetupContext(report,{bars,timeframe,completedAt,primaryClosed,primaryAtr,cutoff});
  const sign=side==="long"?1:-1;entry=entryBasis.price;
  const vwap=report.indicators.vwap,band=(multiple:number,edge:"upper"|"lower")=>vwap?.bands?.find(b=>b.multiple===multiple)?.[edge].at(-1)?.value;
  const protection=known.filter(a=>a.timeframe===primaryTimeframe&&a.kind===(side==="long"?"low":"high")&&sign*(entry-a.price)>tick).sort((a,b)=>b.anchorTs-a.anchorTs)[0];
  const recent=report.candles.slice(-3),extreme=recent.reduce((a,b)=>side==="long"?(b.low<a.low?b:a):(b.high>a.high?b:a));
  const rangeBreak=report.range&&family==="breakout_retest"&&entryBasis.kind==="range_edge";
  let stopBasis:NonNullable<GlobalReport["discretionaryPlan"]>["stopBasis"]=report.range&&family==="range_rotation"?{price:side==="long"?report.range.lower[0]:report.range.upper[1],timeframe:primaryTimeframe,anchorTs:report.range.startTs,knownAt:primaryClosed}:rangeBreak?{price:side==="long"?report.range!.upper[0]:report.range!.lower[1],timeframe:primaryTimeframe,anchorTs:report.range!.startTs,knownAt:primaryClosed}:protection??{price:side==="long"?extreme.low:extreme.high,anchorTs:extreme.ts,knownAt:candleCloseTime(extreme.ts,primaryTimeframe)!,timeframe:primaryTimeframe};
  if(entryBasis.kind==="structure_zone"){
    const zone=report.horizonContext!.zones.find(z=>z.role===(side==="long"?"support":"resistance")&&(side==="long"?z.upper:z.lower)===entry)!;
    stopBasis={price:side==="long"?zone.lower:zone.upper,timeframe:primaryTimeframe,anchorTs:zone.startTs,knownAt:zone.knownAt};
  }
  if(evidence?.kind==="primary_reclaim"){
    const zone=report.horizonContext?.zones.find(z=>entry>=z.lower-primaryAtr&&entry<=z.upper+primaryAtr&&(side==="long"?z.lower<evidence.extreme:z.upper>evidence.extreme));
    const observed=report.candles.slice(-3).filter(c=>side==="long"?c.low<=evidence.extreme:c.high>=evidence.extreme).at(-1);
    if(zone)stopBasis={price:side==="long"?zone.lower:zone.upper,timeframe:primaryTimeframe,anchorTs:zone.startTs,knownAt:zone.knownAt};
    else if(observed)stopBasis={price:side==="long"?observed.low:observed.high,timeframe:primaryTimeframe,anchorTs:observed.ts,knownAt:candleCloseTime(observed.ts,primaryTimeframe)!};
  }
  if(report.strategy.id==="fast"&&(family==="ema_pullback"||evidence?.kind==="local_reclaim")){
    // Fast protection follows a completed primary reaction and a later break
    // of its high/low. An old session extreme cannot override that newer test.
    const recent=report.candles.slice(-12),reaction=recent.flatMap((c,i)=>{
      const level=side==="long"?c.low:c.high,later=recent.slice(i+1);
      if(sign*(entry-level)<=tick||!later.some(b=>side==="long"?b.close>c.high:b.close<c.low)||later.some(b=>side==="long"?b.low<=level:b.high>=level))return [];
      return [{price:level,timeframe:primaryTimeframe,anchorTs:c.ts,knownAt:candleCloseTime(c.ts,primaryTimeframe)!}];
    }).at(-1);
    if(reaction&&reaction.anchorTs>stopBasis.anchorTs)stopBasis=reaction;
  }
  let stop=round(side==="long"?Math.max(tick,Math.min(entry-primaryAtr*.5,stopBasis.price-primaryAtr*.2)):Math.max(entry+primaryAtr*.5,stopBasis.price+primaryAtr*.2));
  if(family==="vwap_reversion"){const outer=band(3,side==="long"?"lower":"upper");if(outer!==undefined&&outer>tick){stop=round(side==="long"?Math.max(tick,Math.min(outer,primaryLast.low)-primaryAtr*.2):Math.max(outer,primaryLast.high)+primaryAtr*.2);stopBasis={price:outer,timeframe:primaryTimeframe,anchorTs:vwap?.anchorTs??report.candles[0].ts,knownAt:primaryClosed};}}
  if(!(stop>0)||sign*(entry-stop)<=0)return;
  const targetSources=[...sources,...(!study&&lower?[{bars:lower.candles,timeframe:lower.timeframe}]:[]),...(report.currentMarket?.frames.map(f=>({bars:f.candles,timeframe:f.timeframe}))??[])];
  const latest=targetSources.flatMap(s=>{const c=s.bars.at(-1);return c?[{price:c.close,at:candleCloseTime(c.ts,s.timeframe)??0}]:[];}).sort((a,b)=>b.at-a.at)[0]?.price??reference.price;
  const currentPrice=report.currentMarket?.quote?.price??latest;
  const forward=(price:number)=>sign*(price-entry)>tick&&sign*(price-currentPrice)>tick;
  const unplayed=(price:number,knownAt:number)=>!targetSources.some(source=>candleLevelTouchedAfter(source.bars,source.timeframe,price,side,knownAt,cutoff));
  const horizonStart=report.candles.at(-Math.min(report.strategy.lookbackBars,report.candles.length))!.ts;
  const candidates:NonNullable<GlobalReport["discretionaryPlan"]>["targets"]=known.filter(a=>a.timeframe===primaryTimeframe&&a.anchorTs>=horizonStart&&a.kind===(side==="long"?"high":"low")&&forward(a.price)&&unplayed(a.price,a.knownAt)).map(a=>({price:a.price,timeframe:a.timeframe,anchorTs:a.anchorTs,knownAt:a.knownAt,basis:a.basis}));
  for(const zone of report.horizonContext?.zones??[]){const price=side==="long"?zone.lower:zone.upper;if(zone.role===(side==="long"?"resistance":"support")&&forward(price)&&unplayed(price,zone.knownAt)&&!candidates.some(c=>c.price===price))candidates.push({price,timeframe:primaryTimeframe,anchorTs:zone.startTs,knownAt:zone.knownAt,basis:"structure_zone"});}
  // The latest primary swing extreme is a nearer objective even before a
  // multi-candle pivot confirms it. Keep its observed, unconfirmed basis.
  const objective=report.candles.slice(-20).reduce((a,b)=>side==="long"?(b.high>a.high?b:a):(b.low<a.low?b:a));
  const observedPrice=side==="long"?objective.high:objective.low,observedAt=candleCloseTime(objective.ts,primaryTimeframe)!;
  if(forward(observedPrice)&&unplayed(observedPrice,observedAt)&&!candidates.some(a=>a.price===observedPrice))candidates.push({price:observedPrice,timeframe:primaryTimeframe,anchorTs:objective.ts,knownAt:observedAt,basis:"observed_extreme"});
  candidates.sort((a,b)=>sign*(a.price-b.price));
  const targets:NonNullable<GlobalReport["discretionaryPlan"]>["targets"]=[];
  if(family==="range_rotation"&&report.range){
    const low=report.range.lower[1],high=report.range.upper[0],span=high-low;
    for(const [price,basis] of [[low+span*.5,"range_midpoint"],[low+span*(side==="long"?.75:.25),"range_quartile"],[side==="long"?high:low,"range_boundary"]] as const){
      if(forward(price)&&(!targets.length||Math.abs(price-targets.at(-1)!.price)>tick))targets.push({price,timeframe:primaryTimeframe,anchorTs:report.range.startTs,knownAt:primaryClosed,basis});
    }
  }
  if(family==="vwap_reversion"&&vwap){
    for(const [price,multiple] of [[band(1,side==="long"?"lower":"upper"),side==="long"?-1:1],[vwap.points.at(-1)?.value,0]] as const)if(price!==undefined&&forward(price))targets.push({price,timeframe:primaryTimeframe,anchorTs:vwap.anchorTs??report.candles[0].ts,knownAt:primaryClosed,basis:"vwap_band",bandMultiple:multiple});
  }
  for(const a of candidates)if(!targets.length||Math.abs(a.price-targets.at(-1)!.price)>Math.max(tick,primaryAtr*.3)){
    if(family==="vwap_reversion"||family==="range_rotation"&&targets.length)break;
    targets.push(a);if(targets.length===3)break;
  }
  // A range objective remains within its established opposite edge. Nearby
  // entry-frame obstacles are retained separately, never silently skipped.
  if(report.range&&entry>=report.range.lower[0]&&entry<=report.range.upper[1]&&!rangeBreak){const boundary=side==="long"?report.range.upper[0]:report.range.lower[1];
    for(let i=targets.length-1;i>=0;i--)if(sign*(targets[i].price-boundary)>tick)targets.splice(i,1);
    if(!targets.length&&forward(boundary))targets.push({price:boundary,timeframe:report.snapshot.timeframe,anchorTs:report.range.startTs,knownAt:candleCloseTime(report.candles.at(-1)!.ts,report.snapshot.timeframe)!,basis:"range_boundary"});
  }
  if(!targets.length){
    const measured=Math.max(primaryAtr,Math.max(...report.candles.slice(-20).map(c=>c.high))-Math.min(...report.candles.slice(-20).map(c=>c.low))),price=round((sign*(currentPrice-entry)>0?currentPrice:entry)+sign*measured);
    if(price>0)targets.push({price,anchorTs:report.candles.at(-Math.min(20,report.candles.length))!.ts,knownAt:candleCloseTime(report.candles.at(-1)!.ts,report.snapshot.timeframe)!,timeframe:report.snapshot.timeframe,basis:"measured_projection"});
  }
  if(!targets.length)return;
  const barriers=globalRouteObstacles(report,side).filter(a=>sign*(a.price-entry)>tick&&sign*(targets[0].price-a.price)>tick).sort((a,b)=>sign*(a.price-b.price)).slice(0,5);
  report.discretionaryPlan={family,entryBasis,...(evidence?{evidence}:{}),objectiveTimeframe:primaryTimeframe,barriers,version:"discretionary-plan-v5",requiresNewTestAfter:cutoff,side,entry,stop,reference,stopBasis:{price:stopBasis.price,timeframe:stopBasis.timeframe,anchorTs:stopBasis.anchorTs,knownAt:stopBasis.knownAt},targets};
  applyGlobalPriceZones(report);
}
