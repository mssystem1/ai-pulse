import type {GlobalReport,GlobalAnchor,GlobalCandle} from "@pulse/schemas";
import {globalStrategyProfile} from "@pulse/domain";

export function globalStrategyPivots(candles:GlobalCandle[],pivots:GlobalAnchor[],atr:Array<{ts:number;value:number}>,timeframe:string){
  const profile=globalStrategyProfile(timeframe);if(!profile)return pivots;
  const first=candles.at(-profile.lookbackBars)?.ts??candles[0]?.ts??0,atrAt=new Map(atr.map(p=>[p.ts,p.value])),swings:GlobalAnchor[]=[];
  for(const a of pivots.filter(p=>p.ts>=first&&p.confirmedAt!==null)){
    const previous=swings.at(-1);
    if(previous?.kind===a.kind){if(a.kind==="high"?a.price>previous.price:a.price<previous.price)swings[swings.length-1]=a;}
    else if(!previous||Math.abs(a.price-previous.price)>=profile.majorSwingAtr*(atrAt.get(a.confirmedAt!)??Infinity))swings.push(a);
  }
  return swings;
}

/** Strategy objectives come from confirmed primary-frame major swings.
 * Nearby levels remain checkpoints and never disappear from entry risk. */
export function applyGlobalStrategyMap(report:GlobalReport){
  const profile=globalStrategyProfile(report.snapshot.timeframe);if(!profile)return;
  report.strategy={version:"horizon-v1",...profile,routes:[]};
  // Older local stress branches are not objectives for a different horizon.
  for(const path of report.paths)delete path.stress;
  const bars=report.candles,atr=report.indicators.atr.points.at(-1)?.value;if(!bars.length||!atr)return;
  const swings=globalStrategyPivots(bars,report.indicators.pivots,report.indicators.atr.points,report.snapshot.timeframe);
  const majorIds=new Set<string>();
  for(const a of swings){
    let level=report.levels.find(l=>l.basis==="swing"&&Math.abs(l.price-a.price)<=atr*.12);
    if(!level){level={id:`strategy-${a.id}`,price:a.price,role:a.price<(report.snapshot.price??a.price)?"support":"resistance",basis:"swing",anchorIds:[a.id]};report.levels.push(level);}
    else if(!level.anchorIds.includes(a.id))level.anchorIds.push(a.id);
    majorIds.add(level.id);
  }
  const routes:NonNullable<GlobalReport["strategy"]>["routes"]=[];
  for(const path of report.paths.filter(p=>p.kind!=="recount"))for(const side of path.direction==="range"?["long","short"] as const:[path.direction==="down"?"short":"long"] as const){
    const sign=side==="long"?1:-1;
    const trigger=report.levels.find(l=>l.id===(path.direction==="range"&&side==="short"?path.targetIds[0]:path.triggerLevelId));if(!trigger)continue;
    const far=path.direction==="range"?report.levels.find(l=>l.id===(side==="long"?path.targetIds[0]:path.triggerLevelId))?.price:undefined;
    const candidates=report.levels.filter(l=>majorIds.has(l.id)&&sign*(l.price-trigger.price)>=profile.minimumObjectiveAtr*atr&&(far===undefined||sign*(far-l.price)>=0)).sort((a,b)=>sign*(a.price-b.price));
    if(far!==undefined&&sign*(far-trigger.price)>=profile.minimumObjectiveAtr*atr){const edge=report.levels.find(l=>l.price===far);if(edge&&!candidates.some(l=>l.price===far))candidates.push(edge);candidates.sort((a,b)=>sign*(a.price-b.price));}
    const objectives=candidates.slice(0,2),end=objectives.at(-1)?.price;
    const checkpoints=report.levels.filter(l=>l.basis==="swing"&&l.anchorIds.some(id=>report.indicators.pivots.some(a=>a.id===id&&a.confirmedAt!==null))&&sign*(l.price-trigger.price)>0&&(end===undefined?Math.abs(l.price-trigger.price)<=4*atr:sign*(end-l.price)>0)&&!objectives.some(t=>t.price===l.price)).sort((a,b)=>sign*(a.price-b.price)).filter((l,i,all)=>i===0||l.price!==all[i-1].price);
    const protection=swings.filter(a=>a.kind===(side==="long"?"low":"high")&&sign*(trigger.price-a.price)>0).at(-1);
    const protectionLevelId=protection?report.levels.find(l=>majorIds.has(l.id)&&l.anchorIds.includes(protection.id))?.id??null:null;
    routes.push({pathId:path.id,side,protectionLevelId,objectiveIds:objectives.map(l=>l.id),checkpointIds:checkpoints.map(l=>l.id)});
  }
  report.strategy={version:"horizon-v1",...profile,routes};
  for(const path of report.paths){const route=routes.find(r=>r.pathId===path.id);if(route&&path.direction!=="range"){path.targetIds=route.objectiveIds;if(route.protectionLevelId)path.invalidationLevelId=route.protectionLevelId;}}
}
