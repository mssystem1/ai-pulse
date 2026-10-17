import {candleCloseTime,GlobalAssessmentSchema,type GlobalReport} from "@pulse/schemas";
import type {SpotMarketContext} from "@pulse/market";
import {deriveGlobalEntryPlan,globalArtifactReference,globalContextRelation,globalEntryCondition,globalFrameReference} from "@pulse/domain";
import {completedGlobalCandles,globalConfirmedPivots,globalFrameEvidence,globalSma,globalWilderIndicators} from "./globalReport.js";

export function assessGlobalEntryReport(saved:GlobalReport,market:SpotMarketContext,context:SpotMarketContext|null|undefined,entry:SpotMarketContext|null|undefined){
  const at=market.fetchedAt,cutoff=Date.parse(at),expected=saved.entryStudy!.timeframe;
  const identity=(m:SpotMarketContext|undefined|null,frame:string)=>!!m&&m.instId===saved.snapshot.instId&&m.bar===frame&&m.source===saved.snapshot.source&&(m.ticker.priceCurrency??m.instId.split("-").at(-1))===saved.snapshot.priceCurrency;
  const source=expected===market.bar?market:entry;
  const candles=identity(source,expected)?completedGlobalCandles({...source!,fetchedAt:at}):[];
  const measured=globalWilderIndicators(candles),last=candles.at(-1),closed=last?candleCloseTime(last.ts,expected):null,next=closed===null?null:candleCloseTime(closed,expected);
  const fresh=candles.length>=55&&next!==null&&cutoff<=next+60000;
  const report:GlobalReport={...saved,snapshot:{...saved.snapshot,observedAt:at},entryStudy:{timeframe:expected,source:identity(source,expected)?source!.source:null,status:fresh?"available":"unavailable",observedAt:at,candles,pivots:globalConfirmedPivots(candles),atr:measured.atr}};
  if(identity(context,saved.context.timeframe??"")){
    const bars=completedGlobalCandles({...context!,fetchedAt:at}),sma=globalSma(bars,55),frame=globalFrameEvidence(context!,at);
    report.context={...saved.context,status:frame.status,candles:bars,sma55:sma,agreement:frame.bias==="up"?"supports":frame.bias==="down"?"conflicts":"neutral"};
    report.hierarchy=[...(saved.hierarchy??[]).filter(r=>r.timeframe!==context!.bar),frame];
  }else report.context={...saved.context,status:"unavailable",agreement:"unknown"};
  const original=saved.tradePlan??deriveGlobalEntryPlan(saved),plan=deriveGlobalEntryPlan(report,original.pathId??undefined,original.side==="none"?undefined:original.side);
  const blockers:string[]=[...plan.blockers];
  const primaryBars=completedGlobalCandles(market),primaryClosed=primaryBars.length?candleCloseTime(primaryBars.at(-1)!.ts,market.bar):null,primaryNext=primaryClosed===null?null:candleCloseTime(primaryClosed,market.bar);
  if(primaryBars.length<55||primaryNext===null||cutoff>primaryNext+60000)blockers.push("history");
  if(["unavailable","opposing"].includes(globalContextRelation(report,plan.side)))blockers.push("context");
  const revised=(before:GlobalReport["candles"],after:GlobalReport["candles"])=>after.some(c=>{const old=before.find(o=>o.ts===c.ts);return old&&["open","high","low","close"].some(k=>old[k as "open"]!==c[k as "open"]);});
  if(revised(saved.candles,completedGlobalCandles(market))||revised(saved.entryStudy!.candles,candles))blockers.push("source_revised");
  if(candles.slice(-64).some((c,i,tail)=>i>0&&candleCloseTime(tail[i-1].ts,expected)!==c.ts))blockers.push("history");
  const state=blockers.some(b=>["history","levels","reward","source_revised"].includes(b))?"no_trade":blockers.includes("cancelled")?"invalidated":blockers.includes("expired")?"expired":!plan.confirmationTs?"waiting_confirmation":!plan.retestTs?"waiting_retest":blockers.includes("context")||blockers.includes("entry_price")?"no_trade":"technical_valid";
  const qualified=state==="technical_valid",targets=plan.targetIds.flatMap(id=>saved.levels.find(l=>l.id===id)?.price??[]);
  const entryZone=qualified?plan.referenceEntry:null,stop=qualified?plan.referenceStop:null,atr=measured.atr.at(-1)?.value;
  const worst=entryZone?(plan.side==="long"?entryZone[1]:entryZone[0]):null,distance=worst!==null&&stop!==null?Math.abs(worst-stop):null;
  const zh=saved.lang==="zh",verb=plan.side==="short"?"SELL":"BUY",trigger=saved.levels.find(l=>l.id===plan.triggerLevelId)?.price;
  const lines=[zh?`主图 ${globalFrameReference(saved.snapshot.timeframe)}；入场证据 ${globalFrameReference(expected)}，重新检查时间 ${at}。`:`Analysis ${globalFrameReference(saved.snapshot.timeframe)}; entry evidence ${globalFrameReference(expected)}, rechecked ${at}.`,
    qualified?`${verb} ${zh?"信号已确认；需金额对应的新报价。":"signal confirmed; review an amount-specific fresh quote."}`:blockers.includes("reward")?(zh?"本次入场的首目标收益不足；需要新的有依据结构。":"Entry needs better reward to the first objective; a new supported structure is required."):blockers.includes("context")?(zh?"高周期背景缺失或与本次方向相反。":"Higher-timeframe evidence is unavailable or opposes this setup."):blockers.includes("entry_price")?(zh?"当前入场收盘已离开有依据区间；报价须回到同一区间。":"The entry-study close is outside the supported zone; the quote must be inside that same zone."):(zh?`需要在 ${trigger??"—"} 形成新的 ${globalFrameReference(expected)} 入场证据。`:`A new ${globalFrameReference(expected)} ${plan.family==="breakout_retest"?"break and held retest":"rejection and follow-through"} is needed at ${trigger??"—"}.`),
    zh?"主图价位保持不变；计划、重新检查和报价使用同一入场算法。":"The purchased price map is unchanged. Report, recheck and quote review use the same entry calculation."];
  if(!qualified)lines.push(globalEntryCondition(saved,plan));
  if(next!==null)lines.push(zh?`入场证据须于下一次 ${globalFrameReference(expected)} 收盘后刷新：${new Date(next).toISOString()}。`:`Refresh entry evidence after the next ${globalFrameReference(expected)} close: ${new Date(next).toISOString()}.`);
  if(plan.failure)lines.push(zh?`先前测试结束于 ${new Date(candleCloseTime(plan.failure.ts,expected)!).toISOString()}。`:`An earlier test ended at the ${new Date(candleCloseTime(plan.failure.ts,expected)!).toISOString()} close.`);
  return GlobalAssessmentSchema.parse({version:"pulse-global-assessment-v1",sourceRef:globalArtifactReference(saved),sourceObservedAt:saved.snapshot.observedAt,assessedAt:at,instId:saved.snapshot.instId,priceCurrency:saved.snapshot.priceCurrency,timeframe:saved.snapshot.timeframe,analysisTimeframe:saved.snapshot.timeframe,entryTimeframe:expected,family:plan.family,state,side:plan.side,pathId:plan.pathId,lastCompletedClose:last?.close??null,lastCompletedAt:closed,confirmationTs:plan.confirmationTs,retestTs:plan.retestTs,retestDeadline:null,expiresAt:plan.signalExpiresAt??null,permittedEntry:entryZone,observedStop:stop,targets,grossRewardRisk:plan.grossRewardRisk,stopDistancePercent:distance!==null&&worst?distance/worst*100:null,stopDistanceAtr:distance!==null&&atr?distance/atr:null,context:report.context.agreement,blockers:[...new Set(blockers)],lines});
}
