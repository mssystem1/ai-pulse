import type {GlobalReport} from "@pulse/schemas";
import {globalPlanCandidates} from "./globalTradePlan.js";
import {globalContextRelation,globalFrameReference} from "./globalContext.js";
import {globalTradePlan} from "./globalTradePlan.js";

export function globalEntryCondition(report:GlobalReport,p:NonNullable<GlobalReport["tradePlan"]>){
  const zh=report.lang==="zh",frame=globalFrameReference(p.entryTimeframe??report.snapshot.timeframe),value=report.levels.find(l=>l.id===p.triggerLevelId)?.price;
  const price=value?.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision})??"—";
  if(p.method==="structure-v5"){
    const primary=globalFrameReference(report.snapshot.timeframe);
    return p.evidenceKind==="follow_through"?(zh?`${primary} 在 ${price} 测试${p.side==="long"?"支撑并收盘守住":"阻力并收盘回落"}；然后 ${frame} 新反应及后续收盘${p.side==="long"?"高于该反应高点":"低于该反应低点"}`:`${primary} ${p.side==="long"?"support test and close holding":"resistance test and close rejecting"} ${price}; then a new ${frame} reaction and a later close ${p.side==="long"?"above its high":"below its low"}`):(zh?`${primary} 完整收盘${p.side==="long"?"高于":"低于"} ${price}；随后 ${frame} 在该价位回测守住`:`Completed ${primary} close ${p.side==="long"?"above":"below"} ${price}; then a later ${frame} retest holding that level`);
  }
  if(p.method==="structure-v4"){
    const primary=globalFrameReference(report.snapshot.timeframe),name=report.strategy?.name??"Strategy";
    return p.evidenceKind==="follow_through"?(zh?`${name}：${primary} 在 ${price} ${p.side==="long"?"测试支撑并收盘守住":"测试阻力并收盘回落"}；之后 ${frame} 新反应及后续收盘${p.side==="long"?"高于反应高点":"低于反应低点"}`:`${name}: completed ${primary} ${p.side==="long"?"support hold":"resistance rejection"} at ${price}; then a new ${frame} reaction and later close ${p.side==="long"?"above its high":"below its low"}`):(zh?`${name}：${primary} 完整收盘${p.side==="long"?"高于":"低于"} ${price}，之后另一根 ${frame} 回测守住`:`${name}: completed ${primary} close ${p.side==="long"?"above":"below"} ${price}, followed by a later ${frame} held retest`);
  }
  if(!p.method&&p.condition==="rejection")return zh?`${frame} 在 ${price} 阻力反应后再次收复失败`:`${frame} resistance rejection at ${price}, then a later failed reclaim`;
  if(!p.method&&p.condition==="support_hold")return zh?`${frame} 在 ${price} 支撑反应后另一根回测守住`:`${frame} support reaction at ${price}, then a later held retest`;
  return p.evidenceKind==="follow_through"?(zh?`${frame} 在 ${price} 测试后守住，随后另一根完整收盘${p.side==="long"?"高于测试 K 线高点":"低于测试 K 线低点"}`:`${frame} ${p.side==="long"?"support reaction":"resistance rejection"} at ${price}, then a later completed close ${p.side==="long"?"above its high":"below its low"}`):(zh?`${frame} 完整收盘${p.side==="long"?"高于":"低于"} ${price}，随后另一根回测守住`:`completed ${frame} close ${p.side==="long"?"above":"below"} ${price}, then a later held retest`);
}

/** Symmetric entry evidence, separate from the primary horizon's market view.
 * Kept inspectable even when neither direction supplies an entry. */
export function globalScenarioEvidence(report:GlobalReport){
  const zh=report.lang==="zh";
  const selected=globalTradePlan(report);
  return globalPlanCandidates(report).filter(p=>p.side!=="none"&&(report.decisionVersion!=="decision-v5"||p.pathId===selected.pathId&&p.side===selected.side)).map(p=>{
    const side=p.side==="long"?"BUY / LONG":"SELL / SHORT";
    const family=p.family?.startsWith("range_")?zh?"区间边缘":"range edge":report.range?zh?"区间内部价位":"internal range level":zh?"摆动价位":"swing level";
    const condition=globalEntryCondition(report,p);
    const risk=p.firstObstacleRewardRisk??p.grossRewardRisk;
    if(p.method==="structure-v5"){
      const reason=p.blockers.includes("reward")?`R:R to TP1 ${risk?.toFixed(2)??"—"}; minimum 1.50 before costs`:p.state==="confirmed"?"Entry signal observed; review quote and costs":"Entry confirmation required";
      return {plan:p,side,family,condition,reason,context:globalContextRelation(report,p.side),line:`${side} · ${condition}. ${reason}.`};
    }
    const reason=p.blockers.includes("reward")?(zh?`最近关口收益 ${risk?.toFixed(2)??"—"}R，低于 1.50R；须新结构`:`nearest-checkpoint reward ${risk?.toFixed(2)??"—"}R, below 1.50R; needs new structure`):p.failure?(zh?"先前测试已结束；须新的测试":"earlier test ended; needs a new reaction"):p.retestTs?(zh?"已观察测试；复核剩余条件和报价":"test observed; review remaining conditions and quote"):(zh?"尚未观察本策略入场确认":"strategy entry confirmation not yet observed");
    const context=globalContextRelation(report,p.side);
    return {plan:p,side,family,condition,reason,context,line:`${side} · ${family}: ${condition}. ${reason}.${context==="opposing"?(zh?" 与高周期方向相反。":" Opposes higher-timeframe evidence."):""}`};
  });
}
