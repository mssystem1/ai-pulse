import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalFrameReference} from "./globalContext.js";
import {globalScenarioEvidence,globalEntryCondition} from "./globalScenarioEvidence.js";
import {globalTradeCards} from "./globalTradeDisplay.js";

/** Direction and an exact entry sentence, independent of internal status codes. */
export function globalSetupLanguage(report:GlobalReport,p:NonNullable<GlobalReport["tradePlan"]>,qualified:boolean){
  const zh=report.lang==="zh",path=report.paths.find(path=>path.role==="main"),tf=p.entryTimeframe??report.snapshot.timeframe;
  const price=(value:number|undefined)=>value===undefined?"—":value.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:Math.min(2,report.snapshot.pricePrecision),maximumFractionDigits:report.snapshot.pricePrecision});
  const displayTf=globalFrameReference(tf);
  const trigger=report.levels.find(l=>l.id===p.triggerLevelId)?.price;
  const verb=p.side==="short"?zh?"卖出":"Sell":zh?"买入":"Buy";
  const signalObserved=p.retestTs!==null&&!p.failure&&!p.blockers.some(b=>["history","levels","cancelled","expired"].includes(b));
  const planningValid=p.side!=="none"&&!p.blockers.some(b=>["reward","history","levels"].includes(b));
  const primary=report.hierarchy?.find(r=>r.timeframe===report.snapshot.timeframe);
  if(report.decisionVersion==="decision-v5"){
    const cards=globalTradeCards(report),card=cards[0],selection=report.setupSelection;
    const direction=selection?.assessment==="sideways"?"SIDEWAYS":selection?.assessment==="long"?"LONG":selection?.assessment==="short"?"SHORT":p.side==="long"?"LONG":p.side==="short"?"SHORT":"SIDEWAYS";
    const label=qualified?(zh?"入场信号已确认":"Entry signal confirmed"):card?.state??(zh?"暂无有效入场":"No validated entry");
    const heading=`${report.strategy?.name.toUpperCase()??""} · ${zh?"观点":"BIAS"} ${direction} · ${label}`;
    const entryInstruction=qualified?(zh?"入场信号已确认；复核 Entry、SL、TP1 与新报价费用。":"Entry signal confirmed. Review Entry, SL, TP1 and fresh quote costs before an order."):card?.plan.blockers.includes("reward")?(zh?"所选策略到 TP1 的收益不足；需要新结构，不能仅靠再次确认。":"The selected setup needs better reward to TP1. A new supported structure is required; another confirmation alone does not qualify entry."):card?`${card.state}. ${card.condition}. ${card.location}`:(selection?.limitations[0]??(zh?"尚无有依据的单一入场策略。":"No supported entry strategy is available."));
    return {direction,heading,entryInstruction,planningValid,signalObserved,entryTimeframe:tf,structureTimeframe:report.snapshot.timeframe,scenarios:globalScenarioEvidence(report)};
  }
  const mixed=Boolean(report.decisionVersion)&&primary?.bias==="mixed"&&!qualified;
  const direction=(report.range||path?.direction==="range")&&!signalObserved?"RANGE":mixed?"BUY / SELL":p.side==="short"?"SHORT":p.side==="long"?"LONG":path?.direction==="down"?"SHORT":path?.direction==="up"?"LONG":"RANGE";
  let pattern=zh?"突破后回测":"the breakout retest";
  if(p.family==="range_buy"||p.family==="support_bounce"||p.condition==="support_hold")pattern=zh?"支撑回调":"the support pullback";
  if(p.family==="range_sell"||p.family==="resistance_rejection"||p.condition==="rejection")pattern=zh?"阻力反弹":"the resistance rebound";
  let entryInstruction=p.evidenceKind==="follow_through"
    ?zh?`${displayTf} 在 ${price(trigger)} 测试${p.side==="long"?"支撑并收回":"阻力并回落"}，随后另一根收盘${p.side==="long"?"突破拒绝 K 线高点后买入":"跌破拒绝 K 线低点后卖出"}。`:`${verb} after a ${displayTf} ${p.side==="long"?"support reaction":"resistance rejection"} at ${price(trigger)}, then a later close ${p.side==="long"?"above its high":"below its low"}.`
    :p.condition==="support_hold"
      ?zh?`${displayTf} 回调测试 ${price(trigger)} 并收盘守住，随后另一根回测守住后买入。`:`Buy after a ${displayTf} support test at ${price(trigger)} closes holding, then a later held retest.`
      :p.condition==="rejection"
        ?zh?`${displayTf} 在 ${price(trigger)} 反弹被拒绝，随后另一根测试无法收复时卖出。`:`Sell after a ${displayTf} ${p.side==="long"?"support reaction":"resistance rejection"} at ${price(trigger)} and a later failed reclaim.`
        :zh?`${displayTf} 完整收盘${p.side==="short"?"跌破":"收复"} ${price(trigger)}，随后另一根回测守住该方向后${p.side==="short"?"卖出":"买入"}。`:`${verb} after a completed ${displayTf} close ${p.side==="short"?"below":"above"} ${price(trigger)} and a later held retest.`;
  if(p.method?.startsWith("structure-"))entryInstruction=`${verb}: ${globalEntryCondition(report,p)}.`;
  if(p.blockers.includes("reward"))entryInstruction=zh?`${verb}入场需要更好的收益空间：首目标仅 ${(p.firstObstacleRewardRisk??p.grossRewardRisk)?.toFixed(2)??"—"}R；须新的有依据结构，不能仅靠再次确认。`:`${verb} entry needs better reward: ${(p.firstObstacleRewardRisk??p.grossRewardRisk)?.toFixed(2)??"—"}R to the first objective; a new supported structure is required.`;
  else if(p.side==="none")entryInstruction=zh?`缺少可用的 ${displayTf} 入场证据或有依据价位。`:`A supported entry needs available ${displayTf} evidence and mapped levels.`;
  else if(signalObserved){const ts=p.retestTs?candleCloseTime(p.retestTs,tf):null;entryInstruction=zh?`${verb}信号已于 ${displayTf} ${ts?new Date(ts).toISOString():""} 收盘观察到；${qualified?"复核新报价和费用":"其余入场条件见下方"}。`:`${verb} signal observed on ${displayTf}${ts?` at ${new Date(ts).toISOString()}`:""}; ${qualified?"review a fresh quote and costs":"complete the remaining entry conditions below"}.`;}
  if(p.strategyId&&p.blockers.includes("reward"))entryInstruction=zh?`${verb}入场到最近关口仅 ${(p.firstObstacleRewardRisk??p.grossRewardRisk)?.toFixed(2)??"—"}R；需要新的有依据结构。`:`${verb} entry has ${(p.firstObstacleRewardRisk??p.grossRewardRisk)?.toFixed(2)??"—"}R before the nearest checkpoint; a new supported structure is required.`;
  if(mixed&&!planningValid)entryInstruction=zh?"买卖两侧的参考均不满足入场要求；新反应须同时支持止损和首目标收益。":"Neither BUY nor SELL reference qualifies for entry; a new reaction must support both protection and first-obstacle reward.";
  const range=report.range;
  const heading=direction==="RANGE"?(range?`RANGE · ${price(range.lower[0])}–${price(range.upper[1])}`:zh?"RANGE · 支撑与阻力":"RANGE · Support and resistance")
    :mixed?zh?"BUY / SELL · 混合结构；入场条件见下方":"BUY / SELL · Mixed structure; entry conditions below"
    :`${direction}${planningValid?"":" SCENARIO"} · ${qualified?`${verb} ${zh?"信号已确认":"signal confirmed"}`:planningValid?`${verb} ${pattern}`:p.blockers.includes("reward")?zh?"入场收益不足":"Entry needs better reward":zh?"需要入场证据":"Entry evidence needed"}`;
  return {direction,heading:report.strategy?`${report.strategy.name.toUpperCase()} · ${heading}`:heading,entryInstruction,planningValid,signalObserved,entryTimeframe:tf,structureTimeframe:report.snapshot.timeframe,scenarios:globalScenarioEvidence(report)};
}
