import type {GlobalReport} from "@pulse/schemas";
import {globalFrameReference} from "./globalContext.js";
import {globalSetupFamilyName} from "./globalSetupStrategies.js";
import {globalSetupEvidenceLines,globalCurrentMarketPrice} from "./globalMarketNow.js";

/** Render a saved, priced setup without promoting it to an observed fill. */
export function globalDiscretionaryCard(report:GlobalReport){
  const d=report.discretionaryPlan;if(!d)return null;
  const zh=report.lang==="zh",price=(p:number)=>p.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision});
  const key="priced-setup",sign=d.side==="long"?1:-1,risk=sign*(d.entry-d.stop),rr=sign*(d.targets[0].price-d.entry)/risk;
  const targets=d.targets.map((t,i)=>({id:`${key}-tp${i+1}`,price:t.price,movePercent:(t.price/d.entry-1)*100,
    source:`${globalFrameReference(t.timeframe)} · ${t.basis==="confirmed_swing"?(zh?"确认摆动":"confirmed swing"):t.basis==="vwap_band"?`VWAP ${t.bandMultiple??0}σ`:t.basis==="range_boundary"?(zh?"区间边界":"range boundary"):t.basis==="range_midpoint"?(zh?"区间几何中点":"geometric range midpoint"):t.basis==="range_quartile"?(zh?"区间四分位":"range quartile"):t.basis==="structure_zone"?(zh?"主周期结构区间":"primary structural zone"):t.basis==="observed_extreme"?(zh?"已观察极值":"observed extreme"):(zh?"测量幅度投影":"measured range projection")} · ${new Date(t.anchorTs).toISOString().slice(0,10)}`}));
  const trigger=globalSetupFamilyName(d.family,report.lang),current=globalCurrentMarketPrice(report)??d.reference.price,needsReclaim=d.side==="long"?current<d.entry:current>d.entry;
  const condition=zh?`${trigger}：${needsReclaim?`${globalFrameReference(d.reference.timeframe)} 先${d.side==="long"?"收复并守住":"跌破并确认阻力"}`:`在 ${globalFrameReference(d.reference.timeframe)} 观察`}${price(d.entry)} ${d.side==="long"?"支撑测试守住后买入":"反弹测试被拒后卖出"}；保护止损 ${price(d.stop)}。`:`${trigger}: ${needsReclaim?`${globalFrameReference(d.reference.timeframe)} must first ${d.side==="long"?"reclaim":"break below"} ${price(d.entry)}, then ${d.side==="long"?"buy a held retest":"sell a rejected retest"}`:`${d.side==="long"?"buy if a support test holds":"sell if a resistance test rejects"} ${price(d.entry)} on ${globalFrameReference(d.reference.timeframe)}`}; protective SL ${price(d.stop)}.`;
  const fresh=d.requiresNewTestAfter!==undefined?(zh?'仅使用本快照之后形成的新测试，之前的触及不构成本次入场。':'Use a new test formed after this snapshot; an earlier touch is not this entry.') : '';
  const entryCondition=[condition,fresh].filter(Boolean).join(' ');
  const location=`${globalFrameReference(d.reference.timeframe)} · ${zh?"入场参考收盘":"entry reference close"} ${price(d.reference.price)} · ${new Date(d.reference.completedAt).toISOString().slice(0,16).replace("T"," ")} UTC. ${zh?"参考价不代表已成交。":"Reference price; no fill implied."}`;
  const p:NonNullable<GlobalReport["tradePlan"]>={side:d.side,pathId:key,state:"conditional",condition:d.side==="long"?"support_hold":"rejection",triggerLevelId:`${key}-entry`,invalidationLevelId:`${key}-stop`,targetIds:targets.map(t=>t.id),referenceEntry:[d.entry,d.entry],referenceStop:d.stop,grossRewardRisk:rr,stopBufferAtr:.2,confirmationTs:null,retestTs:null,blockers:["confirmation"],method:"structure-v5",strategyId:report.strategy?.id,checkpointIds:[],firstObstacleRewardRisk:rr,entryTimeframe:d.reference.timeframe,zone:[d.entry,d.entry],family:d.family==="range_rotation"?(d.side==="long"?"range_buy":"range_sell"):(d.side==="long"?"support_bounce":"resistance_rejection")};
  const firstBarrier=d.barriers[0];if(firstBarrier){p.entryObstacle=firstBarrier;p.firstObstacleRewardRisk=sign*(firstBarrier.price-d.entry)/risk;}
  const direction=d.side==="long"?"LONG / BUY":"SHORT / SELL",state=trigger;
  const lines=[`${direction} · ${state}`,`Entry: ${price(d.entry)} · SL: ${price(d.stop)}`,targets.map((t,i)=>`TP${i+1} ${price(t.price)} (${t.movePercent>=0?"+":""}${t.movePercent.toFixed(2)}%)`).join(" → "),...targets.map((t,i)=>`TP${i+1} ${zh?"依据":"basis"}: ${t.source}`),...globalSetupEvidenceLines(report),entryCondition,location,...d.barriers.map(b=>`${globalFrameReference(b.timeframe)} ${zh?"途中障碍":"intermediate barrier"}: ${price(b.price)}`),`R:R → TP1: ${rr.toFixed(2)} · Entry–SL: ${(risk/d.entry*100).toFixed(2)}%`];
  return {key,pathId:key,side:d.side,direction,state,confirmed:false,selected:true,entry:price(d.entry),stop:price(d.stop),targets,condition:entryCondition,location,riskPercent:risk/d.entry*100,rr,plan:p,lines};
}
