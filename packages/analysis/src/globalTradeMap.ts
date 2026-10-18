import type {GlobalReport,GlobalLevel,GlobalAnchor} from "@pulse/schemas";
import {globalStrategyProfile} from "@pulse/domain";
import {globalStrategyPivots} from "./globalStrategyMap.js";

/** Current trade targets and historical context are separate. A style changes
 * the analysis horizon; it never permits skipping the nearest exit barrier. */
export function applyGlobalTradeMap(report:GlobalReport){
  const profile=globalStrategyProfile(report.snapshot.timeframe);if(!profile)return;
  const atr=report.indicators.atr.points.at(-1)?.value??0;
  const first=report.candles.at(-profile.lookbackBars)?.ts??report.candles[0]?.ts??0;
  const pivots=report.indicators.pivots.filter(a=>a.confirmedAt!==null&&a.ts>=first);
  const add=(anchor:GlobalAnchor)=>{
    let level=report.levels.find(l=>l.basis==="swing"&&l.anchorIds.includes(anchor.id));
    if(!level){level={id:`trade-${anchor.id}`,price:anchor.price,basis:"swing",role:anchor.price<(report.snapshot.price??anchor.price)?"support":"resistance",anchorIds:[anchor.id]};report.levels.push(level);}
    return level;
  };
  // Keep confirmed older major swings available as historical S/R, without
  // turning an archive high into the next TP or an execution stop.
  const major=globalStrategyPivots(report.candles,pivots,report.indicators.atr.points,report.snapshot.timeframe);
  [...major,...pivots.slice(-24)].forEach(add);
  const confirmed=new Set(pivots.map(a=>a.id));
  const routes:NonNullable<GlobalReport["strategy"]>["routes"]=[];
  for(const path of report.paths.filter(p=>p.kind!=="recount")){
    delete path.stress;
    const originalTargets=[...path.targetIds];
    for(const side of path.direction==="range"?["long","short"] as const:[path.direction==="down"?"short":"long"] as const){
      const sign=side==="long"?1:-1;
      const trigger=report.levels.find(l=>l.id===(path.direction==="range"&&side==="short"?originalTargets[0]:path.triggerLevelId));if(!trigger)continue;
      const edge=path.direction==="range"?report.levels.find(l=>l.id===(side==="long"?originalTargets[0]:path.triggerLevelId)):undefined;
      const candidates=report.levels.filter(l=>l.basis==="swing"&&l.anchorIds.some(id=>confirmed.has(id))&&sign*(l.price-trigger.price)>0&&(!edge||sign*(edge.price-l.price)>=0)).sort((a,b)=>sign*(a.price-b.price));
      if(edge&&!candidates.some(l=>l.id===edge.id))candidates.push(edge);
      candidates.sort((a,b)=>sign*(a.price-b.price));
      const targets:GlobalLevel[]=[];
      // One TP per nearby S/R zone, always retaining its nearest price edge.
      // This consolidates noise; it does not move TP1 farther away for R:R.
      const zoneWidth=Math.max(10**-report.snapshot.pricePrecision*2,atr*.2);
      for(const l of candidates)if(!targets.length||Math.abs(l.price-targets.at(-1)!.price)>zoneWidth){targets.push(l);if(targets.length===3)break;}
      let protectionLevelId=path.invalidationLevelId;
      if(path.direction==="range"){
        const anchor=pivots.filter(a=>a.kind===(side==="long"?"low":"high")&&sign*(trigger.price-a.price)>0).at(-1);
        protectionLevelId=anchor?add(anchor).id:trigger.id;
      }
      if(protectionLevelId===trigger.id){
        const protective=report.levels.filter(l=>l.basis==="swing"&&l.anchorIds.some(id=>confirmed.has(id))&&sign*(trigger.price-l.price)>0).sort((a,b)=>sign*(b.price-a.price))[0];
        protectionLevelId=protective?.id??null;
        if(path.direction!=="range"&&protectionLevelId)path.invalidationLevelId=protectionLevelId;
      }
      routes.push({pathId:path.id,side,protectionLevelId,objectiveIds:targets.map(l=>l.id),checkpointIds:[]});
      if(path.direction!=="range")path.targetIds=targets.map(l=>l.id);
    }
  }
  const tradeIds=new Set(routes.flatMap(r=>[...r.objectiveIds,...(r.protectionLevelId?[r.protectionLevelId]:[])]));
  report.strategy={version:"horizon-v2",...profile,minimumObjectiveAtr:0,routes,contextLevelIds:report.levels.filter(l=>!tradeIds.has(l.id)).map(l=>l.id)};
}
