import {globalSetupAdmission} from "@pulse/domain";
import type {GlobalExecutionSettings} from "./globalExecutionPolicy.js";
import {applyGlobalStrategyMix,globalStrategyMixObjectives} from "./globalStrategyMix.js";
import {candleCloseTime,candleLevelTouchedAfter,type GlobalReport} from "@pulse/schemas";
import {globalTwoSidedStructureChoices,selectGlobalSetupContext} from "./globalSetupContext.js";
import {applyGlobalPriceZones} from "./globalPriceZones.js";
import {globalEntryStudyObstacles,globalRouteObstacles} from "./globalRouteObstacles.js";
import {globalEntryReactions,type GlobalEntryReaction} from "./globalEntryReaction.js";

type Choice=Pick<NonNullable<GlobalReport["discretionaryPlan"]>,"side"|"family"|"entryBasis"|"evidence"|"entryReaction">;
const reactionChoice=(r:GlobalEntryReaction):Choice=>({side:r.side,family:"level_retest",entryBasis:{kind:"entry_reaction",timeframe:r.timeframe,knownAt:r.knownAt,price:r.entry},entryReaction:{version:"entry-reaction-v1",kind:r.kind,timeframe:r.timeframe,anchorTs:r.anchorTs,previousTs:r.previousTs,knownAt:r.knownAt,atrTs:r.atr.ts,atrKnownAt:r.atr.knownAt,atrValue:r.atr.value,expiresAt:r.expiresAt,...(r.level?{level:r.level}:{})}});

/** A complete conditional scenario when an observed signal is not established.
 * It does not change the canonical signal, history or execution permission. */
export function applyGlobalDiscretionaryPlan(report:GlobalReport,settings:Partial<GlobalExecutionSettings>={},coreOnly=false,forcedChoice?:Choice){
  if(report.decisionVersion!=="decision-v5"||report.strategy?.targetPolicy!=="active-zones-v1")return;
  report.setupPolicyVersion="source-limits-v4";
  delete report.discretionaryPlan;
  delete report.scenario;
  delete report.alternatePlan;
  delete report.alternatePlanReason;
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
  const coreChoice=forcedChoice??selectGlobalSetupContext(report,{bars,timeframe,completedAt,primaryClosed,primaryAtr,cutoff});
  if(!coreChoice)return;
  let twoSided=!forcedChoice?globalTwoSidedStructureChoices(report,coreChoice,false):null;
  const mixed=applyGlobalStrategyMix(report,report.marketEvidence);
  if(coreOnly){mixed.choice=undefined;mixed.candidate=undefined;delete mixed.mix.selectedVariant;}
  // An admitted observed event retains its own source and defended region.
  // Neighboring passive zones must not erase an actual held reclaim.
  if(mixed.choice)twoSided=null;
  mixed.mix.primary={family:coreChoice.family,side:coreChoice.side,variant:"core",reason:"Core source selection retained alongside separately admitted complementary price events."};
  report.strategyMix=mixed.mix;
  const {side,family,entryBasis,evidence,entryReaction}=(mixed.choice??coreChoice) as Choice;
  const valueVariant=mixed.candidate?.id==="value_area_rotation";
  const sign=side==="long"?1:-1;entry=entryBasis.price;
  const vwap=report.indicators.vwap,band=(multiple:number,edge:"upper"|"lower")=>vwap?.bands?.find(b=>b.multiple===multiple)?.[edge].at(-1)?.value;
  const protection=known.filter(a=>a.timeframe===primaryTimeframe&&a.kind===(side==="long"?"low":"high")&&sign*(entry-a.price)>tick).sort((a,b)=>b.anchorTs-a.anchorTs)[0];
  const recent=report.candles.slice(-3),extreme=recent.reduce((a,b)=>side==="long"?(b.low<a.low?b:a):(b.high>a.high?b:a));
  const rangeBreak=report.range&&family==="breakout_retest"&&entryBasis.kind==="range_edge";
  let stopBasis:NonNullable<GlobalReport["discretionaryPlan"]>["stopBasis"]=report.range&&family==="range_rotation"&&!valueVariant?{price:side==="long"?report.range.lower[0]:report.range.upper[1],timeframe:primaryTimeframe,anchorTs:report.range.startTs,knownAt:primaryClosed}:rangeBreak?{price:side==="long"?report.range!.upper[0]:report.range!.lower[1],timeframe:primaryTimeframe,anchorTs:report.range!.startTs,knownAt:primaryClosed}:protection??{price:side==="long"?extreme.low:extreme.high,anchorTs:extreme.ts,knownAt:candleCloseTime(extreme.ts,primaryTimeframe)!,timeframe:primaryTimeframe};
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
  if(entryReaction){
    const source=study?.candles.find(c=>c.ts===entryReaction.anchorTs);
    if(!source)return;
    stopBasis={price:entryReaction.kind==="completed_break"?entryReaction.level!.price:side==="long"?source.low:source.high,timeframe:entryReaction.timeframe,anchorTs:source.ts,knownAt:entryReaction.knownAt};
    stop=round(side==="long"?Math.min(stopBasis.price-entryReaction.atrValue*.2,entry-entryReaction.atrValue*.5):Math.max(stopBasis.price+entryReaction.atrValue*.2,entry+entryReaction.atrValue*.5));
  }
  if(family==="vwap_reversion"){const outer=band(3,side==="long"?"lower":"upper");if(outer!==undefined&&outer>tick){stop=round(side==="long"?Math.max(tick,Math.min(outer,primaryLast.low)-primaryAtr*.2):Math.max(outer,primaryLast.high)+primaryAtr*.2);stopBasis={price:outer,timeframe:primaryTimeframe,anchorTs:vwap?.anchorTs??report.candles[0].ts,knownAt:primaryClosed};}}
  if(!(stop>0)||sign*(entry-stop)<=0)return;
  const targetSources=[...sources,...(!study&&lower?[{bars:lower.candles,timeframe:lower.timeframe}]:[]),...(report.currentMarket?.frames.map(f=>({bars:f.candles,timeframe:f.timeframe}))??[])];
  // Legacy event policies retain unconsumed objectives. Structural passive
  // limits below use the first active primary obstacle after their future entry;
  // a prior touch must not send that exit to a distant archive objective.
  const forward=(price:number)=>sign*(price-entry)>tick;
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
  const targets:NonNullable<GlobalReport["discretionaryPlan"]>["targets"]=mixed.candidate?.id==="value_area_rotation"?globalStrategyMixObjectives(report,mixed.candidate,report.marketEvidence):[];
  if(!valueVariant&&!targets.length&&family==="range_rotation"&&report.range){
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
  if(!valueVariant&&report.range&&entry>=report.range.lower[0]&&entry<=report.range.upper[1]&&!rangeBreak){const boundary=side==="long"?report.range.upper[0]:report.range.lower[1];
    for(let i=targets.length-1;i>=0;i--)if(sign*(targets[i].price-boundary)>tick)targets.splice(i,1);
    if(!targets.length&&forward(boundary))targets.push({price:boundary,timeframe:report.snapshot.timeframe,anchorTs:report.range.startTs,knownAt:candleCloseTime(report.candles.at(-1)!.ts,report.snapshot.timeframe)!,basis:"range_boundary"});
  }
  if(!targets.length){
    const measured=Math.max(primaryAtr,Math.max(...report.candles.slice(-20).map(c=>c.high))-Math.min(...report.candles.slice(-20).map(c=>c.low))),price=round(entry+sign*measured);
    if(price>0)targets.push({price,anchorTs:report.candles.at(-Math.min(20,report.candles.length))!.ts,knownAt:candleCloseTime(report.candles.at(-1)!.ts,report.snapshot.timeframe)!,timeframe:report.snapshot.timeframe,basis:"measured_projection"});
  }
  // A resting structural order exits at the first active PRIMARY obstacle.
  // Previously touched but still active structure is a valid future retouch
  // objective after entry; skipping it produced distant archive targets.
  if(family==="level_retest"&&(entryBasis.kind==="structure_zone"||entryReaction)&&!evidence){
    const source=entryBasis.kind==="structure_zone"?report.horizonContext!.zones.find(z=>z.role===(side==="long"?"support":"resistance")&&(side==="long"?z.upper:z.lower)===entry):undefined;
    const edge=source?(side==="long"?source.lower:source.upper):entry;
    const first=globalRouteObstacles(report,side).filter(a=>a.timeframe===primaryTimeframe&&sign*(a.price-edge)>tick).sort((a,b)=>sign*(a.price-b.price))[0];
    if(!first)return;
    if(first){
      const pivot=report.indicators.pivots.find(a=>a.ts===first.anchorTs&&a.price===first.price&&a.kind===(side==="long"?"high":"low")&&a.confirmedAt!==null&&candleCloseTime(a.confirmedAt,primaryTimeframe)===first.knownAt);
      const structural=[...globalRouteObstacles(report,side)]
        .filter(a=>a.timeframe===primaryTimeframe&&sign*(a.price-edge)>tick)
        .sort((a,b)=>sign*(a.price-b.price))
        .map(a=>({...a,basis:report.horizonContext?.zones.some(z=>z.startTs===a.anchorTs&&z.knownAt===a.knownAt&&(z.lower===a.price||z.upper===a.price))?"structure_zone" as const:"confirmed_swing" as const}));
      const distinct:typeof targets=[],targetBands:Array<{lower:number;upper:number}>=[];
      for(const obstacle of structural){
        const sourceZone=obstacle.basis==="structure_zone"?report.horizonContext?.zones.find(z=>z.startTs===obstacle.anchorTs&&z.knownAt===obstacle.knownAt&&(z.lower===obstacle.price||z.upper===obstacle.price)):undefined;
        const duplicates=distinct.some(t=>{
          if(t.price===obstacle.price)return true;
          const priorZone=report.horizonContext?.zones.find(z=>z.startTs===t.anchorTs&&z.knownAt===t.knownAt&&(z.lower===t.price||z.upper===t.price));
          return !!sourceZone&&!!priorZone&&sourceZone.lower<=priorZone.upper&&sourceZone.upper>=priorZone.lower;
        });
        if(duplicates)continue;
        const targetZone=report.horizonContext?.zones.find(z=>z.role===(side==="long"?"resistance":"support")&&z.startTs===obstacle.anchorTs&&z.knownAt===obstacle.knownAt&&(side==="long"?z.lower:z.upper)===obstacle.price);
        const candle=report.candles.find(c=>c.ts===obstacle.anchorTs);
        let targetBand=targetZone?{lower:targetZone.lower,upper:targetZone.upper}:candle?(side==="long"?{lower:Math.max(candle.open,candle.close),upper:candle.high}:{lower:candle.low,upper:Math.min(candle.open,candle.close)}):{lower:obstacle.price,upper:obstacle.price};
        if(candle&&(side==="long"?targetBand.lower<=entryBasis.price:targetBand.upper>=entryBasis.price))targetBand={lower:obstacle.price,upper:obstacle.price};
        if(targetBands.some(b=>targetBand.lower<=b.upper&&targetBand.upper>=b.lower))continue;
        distinct.push(obstacle);targetBands.push(targetBand);
        if(distinct.length===3)break;
      }
      if(distinct.length)distinct[0]={...distinct[0],basis:pivot?"confirmed_swing":"structure_zone"};
      targets.splice(0,targets.length,...distinct);
    }
  }
  if(!targets.length)return;
  if(entryReaction&&study){
    const first=globalEntryStudyObstacles(report,side).filter(a=>sign*(a.price-entry)>tick&&sign*(targets[0].price-a.price)>tick).sort((a,b)=>sign*(a.price-b.price))[0];
    if(first){
      targets.splice(0,targets.length,first,...targets.slice(0,2));
    }
  }
  const barriers=globalRouteObstacles(report,side,Boolean(entryReaction)).filter(a=>sign*(a.price-entry)>tick&&sign*(targets[0].price-a.price)>tick).sort((a,b)=>sign*(a.price-b.price)).slice(0,5);
  report.discretionaryPlan={family,entryBasis,...(entryReaction?{entryReaction}:{}),...(evidence?{evidence}:{}),objectiveTimeframe:primaryTimeframe,barriers,version:"discretionary-plan-v5",requiresNewTestAfter:cutoff,side,entry,stop,reference,stopBasis:{price:stopBasis.price,timeframe:stopBasis.timeframe,anchorTs:stopBasis.anchorTs,knownAt:stopBasis.knownAt},targets};
  applyGlobalPriceZones(report,settings);
  // A completed price event is not admission. A weak complementary event
  // cannot replace a supported core limit plan merely by being more recent.
  // Compare only these independently sourced plans; never move their prices.
  if(!coreOnly&&mixed.choice&&!globalSetupAdmission(report).geometryEligible){
    const alternate=structuredClone(report);applyGlobalDiscretionaryPlan(alternate,settings,true);
    if(alternate.discretionaryPlan&&globalSetupAdmission(alternate).geometryEligible){report.discretionaryPlan=alternate.discretionaryPlan;report.strategyMix=alternate.strategyMix;}
  }
  if(!coreOnly&&twoSided&&report.discretionaryPlan){
    const alternate=structuredClone(report);
    delete alternate.scenario;delete alternate.alternatePlan;delete alternate.alternatePlanReason;
    applyGlobalDiscretionaryPlan(alternate,settings,true,twoSided.alternate);
    if(alternate.discretionaryPlan){report.alternatePlan=alternate.discretionaryPlan;report.alternatePlanReason=twoSided.reason;}
  }
  // Daily and weekly objectives retain their horizon, while execution can use
  // the declared 4H/daily reaction. Enumerate fixed causal sources newest first;
  // admission may reject them, but may never move their entry or stop for R.
  // Explicit research overrides keep their registered legacy configuration.
  if(!coreOnly&&!forcedChoice&&!Object.keys(settings).length&&["1Dutc","1D","1Wutc","1W"].includes(primaryTimeframe)&&report.discretionaryPlan){
    const core=report.discretionaryPlan,reactions=globalEntryReactions(report);
    const latestBreak=reactions.find(c=>c.kind==="completed_break"&&c.knownAt>(core.evidence?.completedAt??0));
    const selectedSide=latestBreak?.side??core.side;
    // Build only the newest source on each side. This also prevents a failed
    // newer source from silently falling back to a more attractive older one.
    const newest=(["long","short"] as const).flatMap(side=>reactions.find(c=>c.side===side)??[]);
    const candidates=newest.flatMap(reaction=>{
      const candidate=structuredClone(report);
      applyGlobalDiscretionaryPlan(candidate,settings,true,reactionChoice(reaction));
      return candidate.discretionaryPlan?.version==="discretionary-plan-v8"?[candidate.discretionaryPlan]:[];
    });
    // Pick the source before measuring reward. Searching older sources until
    // one clears 1R recreates the distant, unfillable entries this fixes.
    const replaceFallback=Boolean(latestBreak)||!core.evidence&&(core.family==="ema_pullback"||core.family==="level_retest"&&core.entryBasis.kind==="structure_zone");
    const preferred=replaceFallback?candidates.find(c=>c.side===selectedSide):undefined;
    if(preferred){
      report.discretionaryPlan=preferred;
      if(report.alternatePlan?.side===preferred.side){
        if(core.side!==preferred.side){report.alternatePlan=core;report.alternatePlanReason="The primary-horizon plan is retained as the opposing alternative after a completed execution-frame break changed the selected execution direction. It retains its own source, entry and fixed stop.";}
        else{delete report.alternatePlan;delete report.alternatePlanReason;}
      }
      if(report.strategyMix){delete report.strategyMix.selectedVariant;report.strategyMix.primary={family:preferred.family,side:preferred.side,variant:"core",reason:latestBreak?"A surviving completed execution-frame structure break selects the execution direction separately from the slower primary trend. Entry and fixed protection are chosen before payoff.":"Newest surviving completed execution-frame reaction in the selected market direction. Entry and fixed protection are chosen before measuring payoff; objectives retain the primary horizon."};}
    }
    const opposing=candidates.find(c=>c.side!==selectedSide);
    if(opposing){report.alternatePlan=opposing;report.alternatePlanReason="Opposing completed execution-frame reaction, priced and assessed independently. It is an alternative if its own limit trades, not a second simultaneous recommendation.";}
  }
}
