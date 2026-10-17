import {candleCloseTime,type GlobalReport,type GlobalCandle} from "@pulse/schemas";

type Plan=NonNullable<GlobalReport["tradePlan"]>;
export function globalEntryTimeframe(frame:string):string {
  const name=frame.replace(/utc$/i,"");
  return ({"1H":"15m","4H":"1H","1D":"4H","1W":"1Dutc"} as Record<string,string>)[name]??frame;
}
/** One geometry calculation for the saved plan, recheck and order-review band.
 * R:R constrains a measured setup zone; it never creates an entry by itself. */
export function globalEntryGeometry(side:"long"|"short",zone:[number,number],stop:number,target:number,tick=0) {
  const sign=side==="long"?1:-1;
  const bound=(target+1.5*stop)/2.5;
  const entry:[number,number]=side==="long"?[zone[0],Math.min(zone[1],bound)]:[Math.max(zone[0],bound),zone[1]];
  if(tick>0){entry[0]=Number((Math.ceil((entry[0]-tick*1e-8)/tick)*tick).toPrecision(12));entry[1]=Number((Math.floor((entry[1]+tick*1e-8)/tick)*tick).toPrecision(12));}
  const band=entry[0]<=entry[1]?entry:zone;
  const worst=side==="long"?band[1]:band[0],risk=sign*(worst-stop),reward=sign*(target-worst);
  const rr=risk>0?Math.max(0,reward/risk):null;
  return {entry:entry[0]<=entry[1]&&risk>0&&reward>0?entry:null,rr:rr!==null&&Math.abs(rr-1.5)<1e-9?1.5:rr};
}

/** Structure-v2 is a documented research profile, not a calibrated profit claim.
 * Breakouts require a later held retest; bounces/rejections require a later
 * close beyond the reaction bar. Market structure ends attempts, not a shared
 * arbitrary two-bar entry deadline. Quote/evidence freshness remains separate. */
export function deriveGlobalEntryPlan(report:GlobalReport,pathId?:string,forcedSide?:"long"|"short"):Plan {
  const study=report.entryStudy,path=report.paths.find(p=>(pathId?p.id===pathId:p.role==="main")&&report.view.pathIds.includes(p.id));
  const empty:Plan={side:"none",pathId:null,state:"none",condition:"close_retest",triggerLevelId:null,invalidationLevelId:null,targetIds:[],referenceEntry:null,referenceStop:null,grossRewardRisk:null,stopBufferAtr:.1,confirmationTs:null,retestTs:null,blockers:[],method:"structure-v2",entryTimeframe:study?.timeframe??report.snapshot.timeframe};
  if(!study||study.status!=="available"||study.candles.length<55)return {...empty,blockers:["history"]};
  if(!path)return {...empty,blockers:["levels"]};
  const level=(id:string|null|undefined)=>report.levels.find(l=>l.id===id);
  let trigger=level(path.triggerLevelId),boundary=level(path.invalidationLevelId),targets=path.targetIds.flatMap(id=>level(id)??[]);
  const bars=study.candles,last=bars.at(-1)!,atr=study.atr.at(-1)?.value,tick=10**-report.snapshot.pricePrecision;
  if(!trigger||!boundary||!targets.length||!atr)return {...empty,blockers:["levels"]};
  let side:"long"|"short"=path.direction==="down"?"short":"long";
  if(path.direction==="range"){
    const bottom=trigger,top=targets[0];
    side=forcedSide??(last.close-bottom.price<=top.price-last.close?"long":"short");
    trigger=side==="long"?bottom:top;targets=[side==="long"?top:bottom];
    boundary=report.levels.filter(l=>side==="long"?l.price<bottom.price:l.price>top.price).sort((a,b)=>side==="long"?b.price-a.price:a.price-b.price)[0]??trigger;
  }
  const sign=side==="long"?1:-1;
  const family:NonNullable<Plan["family"]>=path.direction==="range"?side==="long"?"range_buy":"range_sell":path.confirmation==="support_hold"?"support_bounce":path.confirmation==="hold"?"resistance_rejection":"breakout_retest";
  const condition=family==="breakout_retest"?"close_retest":side==="long"?"support_hold":"rejection";
  const sourceAnchors=report.indicators.pivots.filter(a=>trigger!.anchorIds.includes(a.id)&&a.confirmedAt!==null);
  if(!sourceAnchors.length)return {...empty,blockers:["levels"]};
  const knownAt=Math.max(0,...sourceAnchors.map(a=>candleCloseTime(a.confirmedAt!,report.snapshot.timeframe)??Infinity));
  const rawPrices=sourceAnchors.map(a=>a.price).filter(p=>Math.abs(p-trigger!.price)<=atr*.5);
  const zone:[number,number]=[Math.min(trigger.price,...rawPrices),Math.max(trigger.price,...rawPrices)];
  const tolerance=Math.max(tick*2,atr*.1); // Profile's touch/noise allowance, disclosed in docs.
  const allowanceAt=(at:number)=>Math.max(tick*2,(study.atr.filter(p=>p.ts<=at).at(-1)?.value??atr)*.1);
  if(targets.some(l=>sign*(l.price-trigger!.price)<=0))return {...empty,blockers:["levels"]};
  const anchorBefore=(at:number)=>study.pivots.filter(a=>a.confirmedAt!==null&&(candleCloseTime(a.confirmedAt,study.timeframe)??Infinity)<=at&&(side==="long"?a.kind==="low"&&a.price<zone[0]:a.kind==="high"&&a.price>zone[1])).at(-1);
  const recentAnchorBefore=(at:number)=>{const a=anchorBefore(at);if(!a)return undefined;const index=bars.findIndex(c=>c.ts===a.ts),current=bars.findIndex(c=>c.ts===at);return index>=0&&index>=current-32?a:undefined;};
  const stopFor=(test:GlobalCandle|undefined,at:number)=>{
    const recent=recentAnchorBefore(at)?.price;
    const fallback=recent===undefined&&!test?boundary.price:undefined;
    const structural=side==="long"?Math.min(zone[0],test?.low??zone[0],recent??zone[0],fallback??zone[0]):Math.max(zone[1],test?.high??zone[1],recent??zone[1],fallback??zone[1]);
    const raw=structural-sign*allowanceAt(at);
    return Number(((side==="long"?Math.floor(raw/tick):Math.ceil(raw/tick))*tick).toPrecision(12));
  };
  let confirmation:GlobalCandle|undefined,signal:GlobalCandle|undefined,failure:Plan["failure"]=null,observedStop:number|undefined;
  let signalZone:[number,number]|undefined;
  for(let i=Math.max(1,bars.length-160);i<bars.length;i++){
    const c=bars[i],previous=bars[i-1],allowance=allowanceAt(c.ts);if(c.ts<knownAt)continue;
    if(confirmation){
      const broken=side==="long"?c.close<zone[0]-allowance:c.close>zone[1]+allowance;
      const structureBroken=boundary.id!==trigger.id&&(side==="long"?c.low<boundary.price:c.high>boundary.price);
      const stopped=signal&&observedStop!==undefined&&(side==="long"?c.low<=observedStop:c.high>=observedStop);
      const reached=signal&&(side==="long"?c.high>=targets[0].price:c.low<=targets[0].price);
      if(broken||structureBroken||stopped||reached){failure={ts:c.ts,reason:stopped?"stop":structureBroken?"structure":reached?"objective":"trigger"};confirmation=undefined;signal=undefined;signalZone=undefined;observedStop=undefined;continue;}
    }
    const touch=side==="long"?c.low<=zone[1]+allowance&&c.high>=zone[0]:c.high>=zone[0]-allowance&&c.low<=zone[1];
    const holds=side==="long"?c.close>=zone[1]:c.close<=zone[0];
    const starts=family==="breakout_retest"?sign*(previous.close-trigger.price)<=0&&sign*(c.close-trigger.price)>0:touch&&holds;
    if(!confirmation&&starts){confirmation=c;failure=null;continue;}
    if(confirmation&&!signal&&c.ts>confirmation.ts){
      const valid=family==="breakout_retest"?touch&&holds:side==="long"?c.close>confirmation.high:c.close<confirmation.low;
      if(valid){
        signal=c;observedStop=stopFor(family==="breakout_retest"?c:confirmation,c.ts);
        const edge=family==="breakout_retest"?trigger.price:side==="long"?confirmation.high:confirmation.low;
        signalZone=side==="long"?[edge,Math.max(edge,c.close)]:[Math.min(edge,c.close),edge];
        if(side==="long"?c.high>=targets[0].price:c.low<=targets[0].price){failure={ts:c.ts,reason:"objective"};confirmation=undefined;signal=undefined;signalZone=undefined;observedStop=undefined;}
      }
    }
  }
  const plannedZone:[number,number]=signalZone??[zone[0]-tolerance,zone[1]+tolerance];
  const reaction=family!=="breakout_retest"?confirmation:undefined;
  if(observedStop===undefined&&!reaction&&!recentAnchorBefore(last.ts)&&boundary.id===trigger.id)return {...empty,blockers:["levels"]};
  const stop=observedStop??stopFor(reaction,last.ts),geometry=globalEntryGeometry(side,plannedZone,stop,targets[0].price,tick);
  if(stop<=0||sign*((side==="long"?plannedZone[0]:plannedZone[1])-stop)<=0)return {...empty,blockers:["levels"]};
  if(!geometry.entry&&targets.some(l=>sign*(l.price-(side==="long"?plannedZone[1]:plannedZone[0]))<=0))return {...empty,blockers:["reward"]};
  const blockers:Plan["blockers"]=[];
  if(!confirmation)blockers.push("confirmation");if(!signal)blockers.push("retest");
  if(!geometry.entry||geometry.rr===null||geometry.rr<1.5)blockers.push("reward");
  if(failure)blockers.push(failure.reason==="objective"?"expired":"cancelled");
  const entry=geometry.entry??plannedZone;
  if(last.close<entry[0]||last.close>entry[1])blockers.push("entry_price");
  const closed=candleCloseTime(last.ts,study.timeframe),expires=closed===null?null:candleCloseTime(closed,study.timeframe);
  const stopBasis=signal?`${study.timeframe} ${side==="long"?"reaction low / support":"reaction high / resistance"} + signal-time touch allowance`:reaction?`${study.timeframe} observed reaction extreme + touch allowance`:recentAnchorBefore(last.ts)?`${study.timeframe} confirmed swing + touch allowance`:`${report.snapshot.timeframe} mapped boundary + ${study.timeframe} touch allowance`;
  return {...empty,side,pathId:path.id,state:blockers.some(b=>["reward","cancelled","expired"].includes(b))?"avoid":blockers.length?"conditional":"confirmed",family,condition,triggerLevelId:trigger.id,invalidationLevelId:boundary.id,targetIds:targets.map(l=>l.id),referenceEntry:entry,referenceStop:stop,grossRewardRisk:geometry.rr,confirmationTs:confirmation?.ts??null,retestTs:signal?.ts??null,blockers,zone,stopBasis,evidenceKind:family==="breakout_retest"?"held_retest":"follow_through",signalExpiresAt:expires,failure};
}
