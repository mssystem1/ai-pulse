import type {GlobalReport} from "@pulse/schemas";
import {deriveGlobalEntryPlan} from "./globalEntryPlan.js";
import {globalTradePlan} from "./globalTradePlan.js";
import {globalEntryCondition} from "./globalScenarioEvidence.js";
import {globalContextRelation,globalContextRequired,globalFrameReference} from "./globalContext.js";
import {globalDiscretionaryCard} from "./globalDiscretionaryPlan.js";

export function globalTradeCandidateCards(report:GlobalReport,only?:{pathId:string;side:"long"|"short"}){
  const zh=report.lang==="zh",selected=globalTradePlan(report),routes=report.strategy?.routes.filter(r=>report.view.pathIds.includes(r.pathId))??[];
  const rangeSelected=report.setupSelection?report.setupSelection.regime==="range":Boolean(report.range);
  const shown=rangeSelected?routes.filter(r=>report.paths.find(p=>p.id===r.pathId)?.kind==="range"):routes;
  const price=(n:number)=>n.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision});
  return shown.filter(route=>!only||route.pathId===only.pathId&&route.side===only.side).map(route=>{
    const p=selected.pathId===route.pathId&&selected.side===route.side?selected:deriveGlobalEntryPlan(report,route.pathId,route.side),direction=route.side==="long"?"LONG / BUY":"SHORT / SELL";
    const context=globalContextRelation(report,route.side),contextBlocked=globalContextRequired(report)&&["opposing","unavailable"].includes(context);
    const confirmed=p.state==="confirmed"&&!contextBlocked;
    const latest=report.entryStudy?.status==="available"?report.entryStudy.candles.at(-1):undefined;
    const outside=Boolean(latest&&p.referenceEntry&&(latest.close<p.referenceEntry[0]||latest.close>p.referenceEntry[1]));
    const pullback=Boolean(latest&&p.referenceEntry&&(route.side==="long"?latest.close>p.referenceEntry[1]:latest.close<p.referenceEntry[0]));
    const state=confirmed?zh?"入场信号已确认":"Entry signal confirmed":p.watchOnly?zh?"仅观察结构；尚无入场与止损":"Watch structure · Entry and SL not established":p.blockers.includes("reward")?zh?"最近障碍的收益空间不足":"Insufficient reward to nearest barrier":p.side==="none"?zh?"需要新的入场结构":"Entry structure needed":p.blockers.includes("cancelled")?zh?"先前计划失效；须新反应":"Prior setup invalidated; new reaction needed":p.blockers.includes("expired")?zh?"先前计划已结束；须新反应":"Prior setup ended; new reaction needed":contextBlocked?zh?"高周期背景阻止入场":"Entry blocked by higher timeframe":outside?pullback?route.side==="long"?(zh?"仅观察；等待回调":"Watch only · pullback required"):(zh?"仅观察；等待反弹":"Watch only · rebound required"):route.side==="long"?(zh?"仅观察；等待收复":"Watch only · reclaim required"):(zh?"仅观察；等待跌破":"Watch only · breakdown required"):zh?"入场确认条件":"Entry confirmation required";
    const entry=p.referenceEntry?`${price(p.referenceEntry[0])}–${price(p.referenceEntry[1])}`:zh?"实际反应后确定":"After a new price reaction";
    const stop=p.referenceStop===null?zh?"实际反应后确定":"After a new price reaction":price(p.referenceStop);
    const entryReference=p.referenceEntry?.[route.side==="long"?1:0]??null;
    const targets=(p.side==="none"?route.objectiveIds:p.targetIds).flatMap(id=>{
      const l=report.levels.find(l=>l.id===id);if(!l)return [];
      const anchor=report.indicators.pivots.filter(a=>l.anchorIds.includes(a.id)&&a.confirmedAt!==null).sort((a,b)=>b.ts-a.ts)[0];
      const source=`${globalFrameReference(report.snapshot.timeframe)} · ${anchor?zh?"已确认摆动":"confirmed swing":zh?"支撑 / 阻力":"support / resistance"}${anchor?` · ${new Date(anchor.ts).toISOString().slice(0,10)}`:""}`;
      const movePercent=entryReference===null?null:(l.price/entryReference-1)*100;
      return [{id,price:l.price,source,movePercent}];
    });
    const condition=p.side==="none"?zh?"新测试须先建立入场与止损。":"A new test must establish Entry and SL.":globalEntryCondition(report,p);
    const risk=p.referenceEntry&&p.referenceStop?Math.abs((route.side==="long"?p.referenceEntry[1]:p.referenceEntry[0])-p.referenceStop):null;
    const riskPercent=risk!==null&&p.referenceEntry?risk/(route.side==="long"?p.referenceEntry[1]:p.referenceEntry[0])*100:null;
    const distance=latest&&p.referenceEntry?((route.side==="long"?p.referenceEntry[1]:p.referenceEntry[0])/latest.close-1)*100:null;
    const sign=route.side==="long"?1:-1,currentRisk=latest&&p.referenceStop!==null?sign*(latest.close-p.referenceStop):null,currentReward=latest&&targets[0]?sign*(targets[0].price-latest.close):null;
    const currentRewardRisk=currentRisk!==null&&currentRisk>0&&currentReward!==null&&currentReward>0?currentReward/currentRisk:null;
    const currentRewardLine=outside&&currentRewardRisk!==null?zh?` 按该收盘价及同一 SL/TP1 计算，扣费前仅 ${currentRewardRisk.toFixed(2)}R（门槛 1.50R）。`:` At that close, the same SL/TP1 gives ${currentRewardRisk.toFixed(2)}R before costs (minimum 1.50R).`:"";
    const location=(latest&&distance!==null?zh?`${globalFrameReference(report.entryStudy!.timeframe)} 最近完整收盘 ${price(latest.close)}；计划入场${distance<0?"低于":"高于"}该收盘 ${Math.abs(distance).toFixed(2)}%。${outside?"须重新进入该区间并完成所列确认；价格可能不再回到该位。":"仍须满足全部入场条件。"}`:`${globalFrameReference(report.entryStudy!.timeframe)} last completed close ${price(latest.close)}; planned entry is ${Math.abs(distance).toFixed(2)}% ${distance<0?"below":"above"} it. ${outside?"Price must revisit the zone and satisfy the stated confirmation; it may never return.":"All entry conditions must still be met."}`:"")+currentRewardLine;
    const lines=[`${direction} · ${state}`,`${zh?"计划入场":"Entry"}${confirmed?"":" (planned)"}: ${entry} · SL${confirmed?"":" (planned)"}: ${stop}`,
      targets.length?targets.map((t,i)=>`TP${i+1} ${price(t.price)}${t.movePercent===null?"":` (${t.movePercent>=0?"+":""}${t.movePercent.toFixed(2)}%)`}`).join(" → "):zh?"尚无有依据的 TP":"TP: a supported target is not available",
      ...(report.strategy?.targetPolicy==="active-zones-v1"&&targets.length>0&&targets.length<3?[zh?`TP${targets.length+1}${targets.length===1?" / TP3":""}：本快照无更多有依据的目标`:`TP${targets.length+1}${targets.length===1?" / TP3":""}: no further supported target in this snapshot`]:[]),
      ...targets.map((t,i)=>`TP${i+1} ${zh?"依据":"basis"}: ${t.source}`),
      ...(location?[location]:[]),...(p.entryObstacle?[zh?`最近入场周期障碍：${globalFrameReference(p.entryObstacle.timeframe)} ${price(p.entryObstacle.price)}；收益风险比 ${p.firstObstacleRewardRisk?.toFixed(2)??"—"}R。`:`Nearest entry-frame barrier: ${globalFrameReference(p.entryObstacle.timeframe)} ${price(p.entryObstacle.price)}; reward/risk ${p.firstObstacleRewardRisk?.toFixed(2)??"—"}R.`]:[]),`${zh?"触发条件":"Trigger"}: ${condition}`,
      `${zh?"TP1 收益风险比":"R:R to TP1"}: ${p.grossRewardRisk?.toFixed(2)??"—"}${riskPercent===null?"":` · ${zh?"到止损距离":"Entry–SL"}: ${riskPercent.toFixed(2)}%`}. ${confirmed?zh?"复核当前报价和费用，尚非成交。":"Review a fresh quote and costs; no fill implied.":p.retestTs&&!p.failure?zh?"已观察到回测，但当前入场条件尚未全部满足。":"Retest observed; current entry conditions are not all satisfied.":zh?"仅为观察参考，入场信号尚未确认。":"Observation references; entry signal is not confirmed."}`,
      ...(contextBlocked?[zh?"高周期背景缺失或与方向相反，入场尚未确认。":"Higher-timeframe evidence is unavailable or opposes this entry."]:[])];
    return {key:`${route.pathId}-${route.side}`,pathId:route.pathId,side:route.side,direction,state,confirmed,selected:p.pathId===selected.pathId&&p.side===selected.side,entry,stop,targets,condition,location,riskPercent,rr:p.grossRewardRisk,plan:p,lines};
  });
}

/** Every visible report has one setup. Archived maps retain their stored
 * candidates, but their saved selected entry is the only published setup. */
export function globalTradeCards(report:GlobalReport){
  const priced=globalDiscretionaryCard(report);if(priced)return [priced];
  const p=globalTradePlan(report),selection=report.setupSelection,pathId=selection?.pathId??p.pathId,side=selection?.side??p.side;
  return pathId&&side!=="none"?globalTradeCandidateCards(report,{pathId,side}).slice(0,1):[];
}

export function globalTradeCardLines(report:GlobalReport){return globalTradeCards(report).flatMap(c=>[...c.lines]);}

/** Keep distant archive prices in context without directing a trade at them. */
export function globalHistoricalLevelLines(report:GlobalReport){
  const close=report.entryStudy?.candles.at(-1)?.close??report.snapshot.price;if(close===null)return [];
  const active=new Set(report.strategy?.routes.flatMap(r=>[...r.objectiveIds,r.protectionLevelId])??[]);
  const priced=report.discretionaryPlan,usedPrices=new Set(priced?[priced.entry,priced.stop,...priced.targets.map(t=>t.price)]:[]);
  const levels=(report.strategy?.contextLevelIds??[]).flatMap(id=>{const l=report.levels.find(l=>l.id===id);return l&&!active.has(id)&&!usedPrices.has(l.price)&&l.basis==="swing"&&l.anchorIds.some(id=>report.indicators.pivots.some(a=>a.id===id&&a.confirmedAt!==null))?[l]:[];});
  const show=[...levels.filter(l=>l.price>close).sort((a,b)=>a.price-b.price).slice(0,3),...levels.filter(l=>l.price<close).sort((a,b)=>b.price-a.price).slice(0,3)];
  const extremes=[levels.reduce<typeof levels[number]|undefined>((a,b)=>!a||b.price>a.price?b:a,undefined)];
  for(const level of extremes)if(level&&!show.includes(level))show.push(level);
  return show.map(l=>`${l.price>close?report.lang==="zh"?"历史阻力":"Historical resistance":report.lang==="zh"?"历史支撑":"Historical support"} ${l.price.toLocaleString("en-US",{maximumFractionDigits:report.snapshot.pricePrecision})} · ${globalFrameReference(report.snapshot.timeframe)} · ${report.lang==="zh"?"背景价位，非本计划 TP":"context only; not a TP in this plan"}`);
}
