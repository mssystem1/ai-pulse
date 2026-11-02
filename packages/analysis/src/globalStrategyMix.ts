import {candleCloseTime,candleTimeframeMs,GlobalMarketEvidenceSchema,GlobalStrategyMixSchema,type GlobalCandle,type GlobalMarketEvidence,type GlobalReport,type GlobalStrategyMix,type GlobalStrategyMixCandidate} from "@pulse/schemas";

type Side="long"|"short";
type Source=NonNullable<GlobalStrategyMixCandidate["source"]>;
type Event=NonNullable<GlobalStrategyMixCandidate["event"]>;
type Observed={side:Side;source:Source;event:Event};
const frameKey=(tf:string)=>tf.replace(/utc$/i,"");
const policy={"15m":{entry:"5m",profileAge:86400000},"1H":{entry:"15m",profileAge:129600000},"4H":{entry:"1H",profileAge:604800000},"1D":{entry:"4H",profileAge:3024000000},"1W":{entry:"1Dutc",profileAge:8640000000}} as const;
const sign=(side:Side)=>side==="long"?1:-1;

/** Preserve a provider's unavailable sentinel instead of treating aggregate
 * zero funding/mark price as a measurement. No provider request is made. */
export function normalizeGlobalFunding(input:{provider:string;aggregated:boolean;rate:number|null;markPrice:number|null}){
  return input.provider.toLowerCase()==="mmt"&&input.aggregated?{rate:null,markPrice:null}:{rate:input.rate,markPrice:input.markPrice};
}

/** Adapt only the report's actual, reconciled executed-trade payload. An older
 * completed profile may remain useful context but is not current flow. */
export function globalNativeMarketEvidence(report:GlobalReport):GlobalMarketEvidence[]{
  const flow=report.orderFlow;if(!flow)return [];
  const p=flow.profile,baseAsset=report.snapshot.instId.split("-")[0],market={venue:report.snapshot.venue,instrument:flow.instId,baseAsset,quoteCurrency:flow.priceCurrency,marketType:flow.marketType};
  const common={version:"market-evidence-v1" as const,provider:flow.source,market,aggregation:"single_venue" as const,members:[market],provenance:"executed_trades" as const,coverage:{start:p.start,end:p.end,knownAt:p.knownAt,capturedAt:Date.parse(flow.capturedAt),complete:flow.coverage.complete,gaps:[]}};
  return [
    {...common,id:`${flow.source}:${flow.instId}:profile:${p.start}:${p.end}`,data:{kind:"executed_profile" as const,rowSize:p.rowSize,valueFraction:p.valueFraction,val:p.val,poc:p.poc,vah:p.vah,quantityUnit:flow.quantityUnit,session:{timezone:/utc$/i.test(p.timeframe)?"UTC":/^[0-9]+[DWM]$/i.test(p.timeframe)?"UTC+08:00":"UTC",anchor:`fixed:${p.start}:${p.end}`,completed:true as const}}},
    {...common,id:`${flow.source}:${flow.instId}:delta:${p.start}:${p.end}`,data:{kind:"traded_flow" as const,quantityUnit:flow.quantityUnit,buy:p.buy,sell:p.sell,delta:p.delta,resetAt:p.start}},
  ].flatMap(e=>{const parsed=GlobalMarketEvidenceSchema.safeParse(e);return parsed.success?[parsed.data]:[];});
}

function completedEntry(report:GlobalReport,cutoff:number){
  const configured=policy[frameKey(report.snapshot.timeframe) as keyof typeof policy],tf=report.entryStudy?.status==="available"?report.entryStudy.timeframe:configured?.entry;
  const raw=report.entryStudy?.status==="available"&&report.entryStudy.source===report.snapshot.source?report.entryStudy.candles:report.currentMarket?.source===report.snapshot.source?report.currentMarket.frames.find(f=>f.timeframe===tf)?.candles??[]:[];
  const bars=raw.filter(c=>c.confirmed&&(candleCloseTime(c.ts,tf??"")??Infinity)<=cutoff).sort((a,b)=>a.ts-b.ts);
  return {timeframe:tf??"",bars,profileAge:configured?.profileAge??0};
}
function recentValid(event:Observed,bars:GlobalCandle[],cutoff:number,eventDuration:number,maxEventBars:number,observations:ReadonlyArray<{price:number;completedAt:number}>=[]){
  return cutoff-event.event.completedAt<=eventDuration*maxEventBars&&bars.filter(c=>c.ts>=event.event.completedAt).every(c=>sign(event.side)*(c.close-event.source.price)>=0)&&observations.every(c=>c.completedAt<event.event.completedAt||sign(event.side)*(c.price-event.source.price)>=0);
}
function latestDistinct(events:Observed[]){
  const newest=events.sort((a,b)=>b.event.completedAt-a.event.completedAt)[0];
  return {newest,ambiguous:Boolean(newest&&events.some(e=>e.side!==newest.side&&e.event.completedAt===newest.event.completedAt))};
}
function unavailable(id:GlobalStrategyMixCandidate["id"],family:GlobalStrategyMixCandidate["family"],side:Side,missingInputs:string[],reason:string):GlobalStrategyMixCandidate{return {id,family,side,status:"unavailable",reason,missingInputs,conflicts:[],evidenceIds:[]};}

/** Distinct location, completed price event and real participation are retained
 * separately. Correlated price indicators never count as independent votes.
 * The function chooses no order, never assumes a historical fill and performs
 * no network/data purchase. Only eligible observed variants can replace core. */
export function evaluateGlobalStrategyMix(report:GlobalReport,input:{evidence?:GlobalMarketEvidence[];cutoff?:number;maxEventBars?:number}={}):GlobalStrategyMix{
  const cutoff=input.cutoff??Date.parse(report.snapshot.observedAt),{timeframe,bars,profileAge}=completedEntry(report,cutoff),duration=candleTimeframeMs(timeframe),maxEventBars=input.maxEventBars??3;
  if(!Number.isSafeInteger(cutoff)||!Number.isInteger(maxEventBars)||maxEventBars<1||maxEventBars>96)throw Error("Invalid strategy-mix observation clock or event window");
  const core=report.discretionaryPlan,coreSide=core?.side??(report.setupSelection?.side!=="none"?report.setupSelection?.side:undefined),fallbackSide:Side=coreSide??"long",baseAsset=report.snapshot.instId.split("-")[0];
  const primary:GlobalStrategyMix["primary"]={family:core?.family??null,side:coreSide??"none",variant:"core",reason:core?"Retained core strategy; complementary methods require their own current admission event.":"Existing core selection remains available; additional methods require complete source and event evidence."};
  const byId=new Map<string,GlobalMarketEvidence>(),invalidIds=new Set<string>();
  for(const raw of [...globalNativeMarketEvidence(report),...(input.evidence??report.marketEvidence??[])]){
    const parsed=GlobalMarketEvidenceSchema.safeParse(raw);if(!parsed.success){invalidIds.add(raw.id);continue;}
    const e=parsed.data,c=e.coverage;if(c.knownAt>cutoff||c.capturedAt>cutoff||c.end>cutoff||!c.complete||c.gaps.length||e.market.baseAsset!==baseAsset||e.market.quoteCurrency!==report.snapshot.priceCurrency)continue;
    const previous=byId.get(e.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(e)){invalidIds.add(e.id);byId.delete(e.id);}else if(!invalidIds.has(e.id))byId.set(e.id,e);
  }
  const evidence=[...byId.values()],freshFlow=evidence.filter(e=>e.data.kind==="traded_flow"&&cutoff-e.coverage.end<=duration*2),profiles=evidence.filter(e=>e.data.kind==="executed_profile"&&e.market.venue===report.snapshot.venue&&e.market.instrument===report.snapshot.instId&&e.market.marketType==="spot"&&cutoff-e.coverage.end<=profileAge);
  const candidates:GlobalStrategyMixCandidate[]=[];
  const baseMissing=bars.length<2||!duration?["completed_entry_history"]:[];
  const observations=[{timeframe,candles:bars},...(report.currentMarket?.source===report.snapshot.source?report.currentMarket.frames:[])].flatMap(f=>f.candles.filter(c=>c.confirmed).map(c=>({price:c.close,completedAt:candleCloseTime(c.ts,f.timeframe)??Infinity}))).filter(c=>c.completedAt<=cutoff);
  const priceEvents:Observed[]=[];
  const levels=[
    ...(report.horizonContext?.zones??[]).flatMap(z=>[{price:z.lower,knownAt:z.knownAt,timeframe:report.snapshot.timeframe},{price:z.upper,knownAt:z.knownAt,timeframe:report.snapshot.timeframe}]),
    ...report.indicators.pivots.flatMap(p=>p.confirmedAt===null?[]:[{price:p.price,knownAt:candleCloseTime(p.confirmedAt,report.snapshot.timeframe)??Infinity,timeframe:report.snapshot.timeframe}]),
  ];
  const recent=bars.slice(-(maxEventBars+2));
  for(const level of levels)for(let i=0;i<recent.length-1;i++){
    const test=recent[i],held=recent[i+1],previous=bars.find(c=>c.ts===test.ts-duration);if(level.knownAt>test.ts||!previous||candleCloseTime(test.ts,timeframe)!==held.ts)continue;
    for(const side of ["long","short"] as const){
      const swept=side==="long"?test.low<level.price:test.high>level.price,s=sign(side);
      if(!swept||s*(previous.close-level.price)<=0||s*(test.close-level.price)<=0||s*(held.close-level.price)<=0||(side==="long"?held.close<=test.high||held.low<test.low:held.close>=test.low||held.high>test.high))continue;
      const event:Observed={side,source:{kind:"swept_level",price:level.price,lower:level.price,upper:level.price,timeframe:level.timeframe,knownAt:level.knownAt},event:{kind:"sweep_reclaim",timeframe,testTs:test.ts,completedAt:candleCloseTime(held.ts,timeframe)!,extreme:side==="long"?test.low:test.high}};
      if(recentValid(event,bars,cutoff,duration,maxEventBars,observations))priceEvents.push(event);
    }
  }
  const sweep=latestDistinct(priceEvents),sweepSide=sweep.newest?.side??fallbackSide;
  const sweepFlow=freshFlow.filter(e=>sweep.newest&&e.coverage.start<=sweep.newest.event.testTs&&e.coverage.end>=sweep.newest.event.completedAt),sweepConflicts=sweepFlow.filter(e=>e.market.marketType==="spot"&&e.data.kind==="traded_flow"&&sign(sweepSide)*e.data.delta<0).map(e=>`Opposing spot aggression: ${e.id}`);
  candidates.push(baseMissing.length?unavailable("sweep_reclaim","level_retest",sweepSide,baseMissing,"A sweep/reclaim requires completed entry candles."):{id:"sweep_reclaim",family:"level_retest",side:sweepSide,status:sweep.ambiguous||sweepConflicts.length?"conflicted":sweep.newest?"eligible":"awaiting_event",reason:sweep.newest?"A previously defended known level was swept and reclaimed; a later completed candle held it and broke the rejection candle's directional edge. Actual flow is optional supporting or opposing context.":"Wait for a sweep of a previously defended known level, reclaim and a later held reaction closing beyond the rejection candle's directional edge.",missingInputs:[],conflicts:[...(sweep.ambiguous?["Opposing price events completed at the same time."]:[]),...sweepConflicts],evidenceIds:sweepFlow.map(e=>e.id),...(sweep.newest?{source:sweep.newest.source,event:sweep.newest.event}:{})});

  const valueEvents:Array<Observed&{profile:GlobalMarketEvidence}>=[];
  const vwap=report.indicators.vwap;
  for(const p of profiles){if(p.data.kind!=="executed_profile")continue;const poc=p.data.poc;for(let i=0;i<recent.length-1;i++){
    const test=recent[i],held=recent[i+1],knownValue=vwap?.points.filter(v=>(candleCloseTime(v.ts,report.snapshot.timeframe)??Infinity)<=test.ts).at(-1);
    if(p.coverage.knownAt>test.ts||!knownValue||vwap?.knownAt!==undefined&&vwap.knownAt>test.ts||vwap?.selectedAt!==undefined&&vwap.selectedAt>test.ts||candleCloseTime(test.ts,timeframe)!==held.ts)continue;
    for(const side of ["long","short"] as const){const edge=side==="long"?p.data.val:p.data.vah,s=sign(side),touched=side==="long"?test.low<=edge:test.high>=edge;
      if(!touched||s*(test.close-edge)<=0||s*(held.close-edge)<=0||s*(p.data.poc-held.close)<=0||knownValue.value<p.data.val||knownValue.value>p.data.vah)continue;
      const event:Observed&{profile:GlobalMarketEvidence}={side,profile:p,source:{kind:"value_area",price:edge,lower:edge,upper:edge,timeframe:report.snapshot.timeframe,knownAt:p.coverage.knownAt},event:{kind:"value_rejection",timeframe,testTs:test.ts,completedAt:candleCloseTime(held.ts,timeframe)!,extreme:side==="long"?test.low:test.high}};
      const quote=report.currentMarket?.quote?.price;
      if(recentValid(event,bars,cutoff,duration,maxEventBars,observations)&&!(quote!==undefined&&sign(side)*(quote-poc)>=0)&&!bars.some(c=>c.ts>=test.ts&&(side==="long"?c.high>=poc:c.low<=poc)))valueEvents.push(event);
    }
  }}
  const balanced=report.setupSelection?.regime==="range"||report.setupSelection?.regime==="transition"||report.setupSelection?.assessment==="sideways";
  const value=latestDistinct(valueEvents),valueMissing=[...baseMissing,...(!profiles.length?["fresh_completed_executed_profile"]:[]),...(!vwap?.points.length?["anchored_value"]:[]),...(!balanced?["balanced_primary_regime"]:[])],valueSide=value.newest?.side??fallbackSide;
  const profile=valueEvents.find(e=>e===value.newest)?.profile;
  candidates.push(valueMissing.length?unavailable("value_area_rotation","range_rotation",valueSide,valueMissing,"Completed value-area rotation needs genuine current profile coverage and anchored value."):{id:"value_area_rotation",family:"range_rotation",side:valueSide,status:value.ambiguous?"conflicted":value.newest?"eligible":"awaiting_event",reason:value.newest?"A completed value edge was rejected and a later candle held inside value with the POC still ahead.":"Wait for an observed value-edge rejection and held return inside completed value.",missingInputs:[],conflicts:value.ambiguous?["Opposing value reactions completed at the same time."]:[],evidenceIds:profile?[profile.id]:[],...(value.newest?{source:value.newest.source,event:value.newest.event}:{})});

  const rangeKnown=report.range?.anchorIds.map(id=>report.indicators.pivots.find(p=>p.id===id)).map(p=>p?.confirmedAt===null||p?.confirmedAt===undefined?Infinity:candleCloseTime(p.confirmedAt,report.snapshot.timeframe)??Infinity),rangeKnownAt=rangeKnown?.length?Math.max(...rangeKnown):Infinity;
  const boundaries=[...(report.range?[{side:"long" as const,price:report.range.upper[1],knownAt:rangeKnownAt},{side:"short" as const,price:report.range.lower[0],knownAt:rangeKnownAt}]:[]),...levels.flatMap(l=>[{...l,side:"long" as const},{...l,side:"short" as const}])];
  const acceptance:Observed[]=[];
  for(const boundary of boundaries)for(let i=1;i<recent.length-1;i++){
    const before=recent[i-1],accepted=recent[i],test=recent[i+1],s=sign(boundary.side);
    if(boundary.knownAt>accepted.ts||candleCloseTime(before.ts,timeframe)!==accepted.ts||candleCloseTime(accepted.ts,timeframe)!==test.ts||s*(before.close-boundary.price)>0||s*(accepted.close-boundary.price)<=0||s*(test.close-boundary.price)<=0||(boundary.side==="long"?test.low>boundary.price:test.high<boundary.price))continue;
    const event:Observed={side:boundary.side,source:{kind:"broken_boundary",price:boundary.price,lower:boundary.price,upper:boundary.price,timeframe:report.snapshot.timeframe,knownAt:boundary.knownAt},event:{kind:"accepted_retest",timeframe,testTs:test.ts,completedAt:candleCloseTime(test.ts,timeframe)!,extreme:boundary.side==="long"?test.low:test.high}};
    if(recentValid(event,bars,cutoff,duration,maxEventBars,observations))acceptance.push(event);
  }
  const accepted=latestDistinct(acceptance),acceptedSide=accepted.newest?.side??fallbackSide;
  const flowAtEvent=freshFlow.filter(e=>!accepted.newest||e.coverage.start<=accepted.newest.event.testTs&&e.coverage.end>=accepted.newest.event.completedAt),spot=flowAtEvent.filter(e=>e.market.marketType==="spot"),perpetual=flowAtEvent.filter(e=>e.market.marketType==="perpetual");
  const acceptedMissing=[...baseMissing,...(!spot.length?["fresh_spot_executed_flow"]:[]),...(!perpetual.length?["fresh_perpetual_executed_flow"]:[])],acceptedConflicts=flowAtEvent.filter(e=>e.data.kind==="traded_flow"&&sign(acceptedSide)*e.data.delta<=0).map(e=>`Unsupportive ${e.market.marketType} aggression: ${e.id}`);
  candidates.push(acceptedMissing.length?unavailable("accepted_breakout_retest","breakout_retest",acceptedSide,acceptedMissing,"Participation-backed continuation requires separate, current spot and perpetual executions."):{id:"accepted_breakout_retest",family:"breakout_retest",side:acceptedSide,status:accepted.ambiguous||acceptedConflicts.length?"conflicted":accepted.newest?"eligible":"awaiting_event",reason:accepted.newest?"Price accepted beyond a known boundary and defended the later retest with separate supporting spot/perpetual aggression.":"Wait for completed acceptance and a defended retest of the actual boundary.",missingInputs:[],conflicts:[...(accepted.ambiguous?["Opposing acceptance events completed at the same time."]:[]),...acceptedConflicts],evidenceIds:flowAtEvent.map(e=>e.id),...(accepted.newest?{source:accepted.newest.source,event:accepted.newest.event}:{})});
  const macro=frameKey(report.snapshot.timeframe)==="1W",assessment=report.setupSelection?.assessment;
  // A daily timing reaction can admit the macro thesis; it cannot by itself
  // turn an intact completed weekly trend/recovery into its opposite strategy.
  for(const c of candidates)if(macro&&(assessment==="long"||assessment==="short")&&c.side!==assessment&&c.status==="eligible"){
    c.status="conflicted";c.conflicts.push(`Completed weekly assessment remains ${assessment}; an opposing daily reaction needs a primary structural turn before it can replace the macro setup.`);
  }
  const eligible=candidates.filter(c=>c.status==="eligible").sort((a,b)=>(b.event!.completedAt-a.event!.completedAt)||Number(b.id==="accepted_breakout_retest")-Number(a.id==="accepted_breakout_retest")||Number(b.side===coreSide)-Number(a.side===coreSide));
  const selected=eligible[0],groups:GlobalStrategyMix["evidenceGroups"]=["price_structure"];
  if(freshFlow.length)groups.push("executed_flow");
  if(evidence.some(e=>(e.data.kind==="open_interest"||e.data.kind==="funding"||e.data.kind==="liquidations")&&cutoff-e.coverage.end<=duration*2))groups.push("derivatives_positioning");
  if(evidence.some(e=>e.data.kind==="resting_liquidity"&&cutoff-e.coverage.end<=duration))groups.push("resting_liquidity");
  return GlobalStrategyMixSchema.parse({version:"global-strategy-mix-v1",primary,candidates,...(selected?{selectedVariant:selected.id}:{}),evidenceGroups:groups,exposurePolicy:"one_primary_exposure"});
}

export function applyGlobalStrategyMix(report:GlobalReport,evidence?:GlobalMarketEvidence[]){
  const mix=evaluateGlobalStrategyMix(report,{evidence});
  for(const c of mix.candidates)if(c.id==="value_area_rotation"&&c.status==="eligible"&&!globalStrategyMixObjectives(report,c,evidence).length){c.status="awaiting_event";c.reason="The completed value objective has already played or its exact source is unavailable; wait for a new complete value reaction.";}
  if(mix.selectedVariant&&!mix.candidates.some(c=>c.id===mix.selectedVariant&&c.status==="eligible"))mix.selectedVariant=mix.candidates.filter(c=>c.status==="eligible").sort((a,b)=>b.event!.completedAt-a.event!.completedAt)[0]?.id;
  const candidate=mix.candidates.find(c=>c.id===mix.selectedVariant);
  const choice=candidate?.source&&candidate.event?{side:candidate.side,family:candidate.family,entryBasis:{kind:"reclaimed_level" as const,price:candidate.source.price,timeframe:candidate.source.timeframe,knownAt:candidate.source.knownAt},evidence:{kind:candidate.source.timeframe===report.snapshot.timeframe?"primary_reclaim" as const:"local_reclaim" as const,timeframe:candidate.event.timeframe,level:candidate.source.price,testTs:candidate.event.testTs,completedAt:candidate.event.completedAt,extreme:candidate.event.extreme}}:undefined;
  return {mix,choice,candidate};
}

/** A value rotation exits toward its measured completed value, rather than
 * borrowing unrelated old swing targets. Any already played first objective
 * makes the rotation ineligible; farther value never conceals that touch. */
export function globalStrategyMixObjectives(report:GlobalReport,candidate:GlobalStrategyMixCandidate,evidence?:GlobalMarketEvidence[]){
  if(candidate.id!=="value_area_rotation"||candidate.status!=="eligible"||!candidate.source||!candidate.event)return [];
  const cutoff=Date.parse(report.snapshot.observedAt),{bars,timeframe}=completedEntry(report,cutoff),quote=report.currentMarket?.quote?.price;
  const profile=[...globalNativeMarketEvidence(report),...(evidence??report.marketEvidence??[])].flatMap(e=>{const parsed=GlobalMarketEvidenceSchema.safeParse(e);return parsed.success?[parsed.data]:[];}).find(e=>candidate.evidenceIds.includes(e.id)&&e.data.kind==="executed_profile"&&e.market.venue===report.snapshot.venue&&e.market.instrument===report.snapshot.instId&&e.market.quoteCurrency===report.snapshot.priceCurrency&&e.coverage.knownAt<=candidate.event!.testTs&&e.coverage.complete&&!e.coverage.gaps.length);
  if(!profile||profile.data.kind!=="executed_profile")return [];
  const prices=[profile.data.poc,candidate.side==="long"?profile.data.vah:profile.data.val],s=sign(candidate.side);
  const touched=(price:number)=>quote!==undefined&&s*(quote-price)>=0||bars.some(c=>c.ts>=candidate.event!.testTs&&(candidate.side==="long"?c.high>=price:c.low<=price));
  if(s*(prices[0]-candidate.source.price)<=0||touched(prices[0]))return [];
  return prices.filter((price,i)=>s*(price-candidate.source!.price)>0&&!touched(price)&&(i===0||price!==prices[0])).map(price=>({price,timeframe:report.snapshot.timeframe,anchorTs:profile.coverage.start,knownAt:profile.coverage.knownAt,basis:"executed_profile" as const}));
}
