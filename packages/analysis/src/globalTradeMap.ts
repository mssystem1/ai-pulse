import {GlobalReportSchema,type GlobalReport,type GlobalLevel,type GlobalAnchor} from "@pulse/schemas";
import {globalStrategyProfile,globalArtifactReference,selectGlobalTradePlan,globalDecision,selectSingleGlobalSetup} from "@pulse/domain";
import {globalStrategyPivots} from "./globalStrategyMap.js";
import {activeGlobalTargetZones} from "./globalTargetZones.js";
import {rebuildSavedGlobalCandidates} from "./globalReport.js";

/** Current trade targets and historical context are separate. A style changes
 * the analysis horizon; it never permits skipping the nearest exit barrier. */
export function applyGlobalTradeMap(report:GlobalReport,targetPolicy:"active-zones-v1"|"legacy-pivots-v1"="active-zones-v1"){
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
      // A display/strategy lookback does not expire an unconsumed price barrier.
      // Search all saved completed history, retaining the nearest obstacle.
      const candidates=targetPolicy==="legacy-pivots-v1"?report.levels.filter(l=>l.basis==="swing"&&l.anchorIds.some(id=>confirmed.has(id))&&sign*(l.price-trigger.price)>0&&(!edge||sign*(edge.price-l.price)>=0)).sort((a,b)=>sign*(a.price-b.price)):activeGlobalTargetZones(report,side,trigger.price,first).filter(z=>!edge||sign*(edge.price-z.price)>=0).map(z=>{
        const id=`target-zone-${side}-${z.anchors.map(a=>a.id).join("-")}`;
        let level=report.levels.find(l=>l.id===id);
        if(!level){level={id,price:z.price,basis:"swing",role:side==="long"?"resistance":"support",anchorIds:z.anchors.map(a=>a.id)};report.levels.push(level);}
        return level;
      });
      if(targetPolicy==="legacy-pivots-v1"&&edge&&!candidates.some(l=>l.id===edge.id))candidates.push(edge);
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
  report.strategy={version:"horizon-v2",...(targetPolicy==="active-zones-v1"?{targetPolicy}:{}),...profile,minimumObjectiveAtr:0,routes,contextLevelIds:report.levels.filter(l=>!tradeIds.has(l.id)).map(l=>l.id)};
}

/** Explicit, free technical correction. Stored reports and original model prose
 * remain untouched; a review has its own artifact reference and provenance. */
export function reviewGlobalTargetReport(saved:GlobalReport):GlobalReport {
  if(saved.decisionVersion!=="decision-v5"||saved.strategy?.targetPolicy==="active-zones-v1"&&saved.setupSelection?.version==="single-setup-v3")return saved;
  const report=rebuildSavedGlobalCandidates(saved),sourceRef=globalArtifactReference(saved);
  report.targetReviewOf=sourceRef;
  applyGlobalTradeMap(report);
  report.view.levelIds=[...new Set([...report.view.levelIds,...report.strategy!.routes.flatMap(r=>[r.protectionLevelId,...r.objectiveIds]).filter((id):id is string=>id!==null)])];
  applySingleGlobalSetup(report);
  const d=globalDecision(report),zh=report.lang==="zh";
  report.narrative={headline:`${report.snapshot.instId} · ${d.heading}`,summary:`${d.entryInstruction} ${d.route}`,reasons:[],riskNotes:[],limitations:[zh?"原始快照技术复核；使用相同已保存 K 线，未调用新的 AI 分析。已排除被后续收盘突破的历史价位；没有依据的后续 TP 不会生成。":"Technical review of the original snapshot, using the same saved candles and no new AI analysis. Consumed historical levels are excluded; unsupported later TPs are not invented."],disclaimer:saved.narrative.disclaimer};
  return GlobalReportSchema.parse(report);
}

/** Persist one strategy and one setup; discarded candidates are not a second
 * recommendation hidden elsewhere in the report or model prompt. */
export function applySingleGlobalSetup(report:GlobalReport){
  report.view.pathIds=report.paths.filter(p=>p.kind!=="recount").map(p=>p.id);
  const selected=selectSingleGlobalSetup(report);report.setupSelection=selected.selection;report.tradePlan=selected.plan;
  report.paths=report.paths.filter(p=>p.id===selected.selection.pathId).map(p=>({...p,role:"main"}));
  report.strategy!.routes=report.strategy!.routes.filter(r=>r.pathId===selected.selection.pathId&&r.side===selected.selection.side);
  report.view.pathIds=report.paths.map(p=>p.id);
  const active=new Set(report.strategy!.routes.flatMap(r=>[r.protectionLevelId,...r.objectiveIds]));
  report.view.levelIds=[...new Set([...report.view.levelIds,...[...active].filter((id):id is string=>id!==null)])];
  report.strategy!.contextLevelIds=report.levels.filter(l=>!active.has(l.id)).map(l=>l.id);
}
