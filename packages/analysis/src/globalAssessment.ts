import { candleCloseTime, GlobalAssessmentSchema, type GlobalAssessment, type GlobalReport } from "@pulse/schemas";
import type { SpotMarketContext } from "@pulse/market";
import { globalArtifactReference, globalConfirmationEvidence, globalTradePlan, globalRemoteLevels,globalContextRelation,globalContextRequired } from "@pulse/domain";
import { completedGlobalCandles, globalWilderIndicators, globalSma,globalFrameEvidence } from "./globalReport.js";
import {assessGlobalEntryReport} from "./globalEntryAssessment.js";

export function globalReportReference(report:GlobalReport):string {
  // Non-secret correlation ID, never an authorization capability.
  return globalArtifactReference(report);
}

/** Evaluate today's completed evidence against the purchased map. This does
 * not select new levels, relabel waves, call a model, or modify the report. */
export function assessGlobalReport(saved:GlobalReport, market:SpotMarketContext, context?:SpotMarketContext|null,entryMarket?:SpotMarketContext|null):GlobalAssessment {
  if(market.instId!==saved.snapshot.instId || market.bar!==saved.snapshot.timeframe || market.source!==saved.snapshot.source
    || (market.ticker.priceCurrency??market.instId.split("-").at(-1))!==saved.snapshot.priceCurrency)
    throw new Error("Recheck market identity does not match the purchased report");
  const fetched=Date.parse(market.fetchedAt),original=Date.parse(saved.snapshot.observedAt);
  if(!Number.isFinite(fetched)||fetched<original)throw new Error("Recheck evidence predates the saved report");
  if(saved.decisionVersion==="decision-v2")return assessGlobalEntryReport(saved,market,context,entryMarket);
  const fresh=completedGlobalCandles(market),last=fresh.at(-1);
  const overlapChanged=fresh.some(c=>{const old=saved.candles.find(o=>o.ts===c.ts);return old&&["open","high","low","close"].some(k=>old[k as "open"]!==c[k as "open"]);});
  const candles=[...new Map([...saved.candles,...fresh].map(c=>[c.ts,c])).values()].sort((a,b)=>a.ts-b.ts).slice(-520);
  const measured=globalWilderIndicators(candles),atr=measured.atr.at(-1)?.value;
  const report:GlobalReport={...saved,evaluationVersion:"completed-v2",candles,indicators:{...saved.indicators,atr:{period:14,points:measured.atr}},snapshot:{...saved.snapshot,observedAt:market.fetchedAt,lastCandleTs:last?.ts??null,price:last?.close??null}};
  const p=globalTradePlan(saved),level=(id:string|null)=>saved.levels.find(l=>l.id===id)?.price;
  const trigger=level(p.triggerLevelId),boundary=level(p.invalidationLevelId),targets=p.targetIds.flatMap(id=>level(id)??[]);
  const blockers:string[]=[],lines:string[]=[],zh=saved.lang==="zh",sign=p.side==="short"?-1:1;
  let agreement:GlobalAssessment["context"]="unknown";
  if(globalContextRequired(saved)&&context&&context.instId===market.instId&&context.bar===saved.context.timeframe&&context.source===market.source
    &&(context.ticker.priceCurrency??context.instId.split("-").at(-1))===saved.snapshot.priceCurrency){
    const contextCandles=completedGlobalCandles({...context,fetchedAt:market.fetchedAt}),mean=globalSma(contextCandles,55).at(-1)?.value,close=contextCandles.at(-1)?.close;
    const completed=contextCandles.at(-1),contextClose=completed?candleCloseTime(completed.ts,context.bar):null,next=contextClose?candleCloseTime(contextClose,context.bar):null;
    if(mean&&close&&next!==null&&fetched<=next+60_000){agreement=close>mean?"supports":close<mean?"conflicts":"neutral";
      report.context={...saved.context,status:"available",agreement,candles:contextCandles,sma55:globalSma(contextCandles,55)};
      if(saved.decisionVersion)report.hierarchy=[...(saved.hierarchy??[]).filter(r=>r.timeframe!==context.bar),globalFrameEvidence(context,market.fetchedAt)];
    }
  }
  if(agreement==="unknown")report.context={...report.context,status:"unavailable",agreement:"unknown"};
  const e=p.side!=="none"&&p.triggerLevelId&&p.invalidationLevelId?globalConfirmationEvidence(report,{...p,side:p.side,triggerLevelId:p.triggerLevelId,invalidationLevelId:p.invalidationLevelId}):null;
  const geometry=p.side!=="none"&&trigger!==undefined&&boundary!==undefined&&targets.length>0&&atr!==undefined;
  if(!geometry)blockers.push("structure");
  if(!last||last.ts<(saved.snapshot.lastCandleTs??0)||!atr||fresh.length<55)blockers.push("history");
  const latestClose=last?candleCloseTime(last.ts,market.bar):null,nextClose=latestClose?candleCloseTime(latestClose,market.bar):null;
  if(nextClose!==null&&fetched>nextClose+60_000)blockers.push("history");
  const recent=candles.slice(-64);
  if(recent.some((c,i)=>i>0&&candleCloseTime(recent[i-1].ts,market.bar)!==c.ts))blockers.push("history");
  // A report remains readable after a provider revision, but cannot attest a
  // trade from a map whose original evidence changed.
  if(overlapChanged)blockers.push("source_revised");
  if(geometry&&globalRemoteLevels(report).some(l=>p.targetIds.includes(l.id)))blockers.push("target_horizon");
  if(globalContextRequired(saved)&&["opposing","unavailable"].includes(globalContextRelation(report,p.side)))blockers.push("context");
  let stop:number|null=null,entry:GlobalAssessment["permittedEntry"]=null,rr:number|null=null;
  if(e?.retest&&geometry){
    const testAtr=measured.atr.find(point=>point.ts===e.retest!.ts)?.value;
    if(testAtr){
      // Protection clears BOTH the structural boundary and the observed test.
      // No stop tightening to improve the reward ratio.
      stop=p.side==="long"?Math.min(boundary!,e.retest.low)-testAtr*.2:Math.max(boundary!,e.retest.high)+testAtr*.2;
      const riskAtTrigger=sign*(trigger!-stop),reward=sign*(targets[0]-trigger!);
      rr=riskAtTrigger>0?reward/riskAtTrigger:null;
      const rewardBound=(targets[0]+1.5*stop)/2.5;
      entry=p.side==="long"?[trigger!,rewardBound]:[rewardBound,trigger!];
      if(entry[0]>entry[1]||stop<=0||rr===null||rr<1.5){entry=null;blockers.push("reward");}
      if(candles.some(c=>c.ts>e.retest!.ts&&(p.side==="long"?c.low<=stop!:c.high>=stop!)))blockers.push("stop_broken");
      if(candles.some(c=>c.ts>=e.retest!.ts&&(p.side==="long"?c.high>=targets[0]:c.low<=targets[0])))blockers.push("target_reached");
    }
  }
  if((rr??p.grossRewardRisk??0)<1.5)blockers.push("reward");
  if(!e?.confirmation)blockers.push("confirmation");
  if(!e?.retest)blockers.push("retest");
  if(e?.failure)blockers.push("invalidated");
  if(e?.expired)blockers.push("expired");
  let state:GlobalAssessment["state"]=blockers.some(b=>["structure","history","source_revised","target_horizon","reward"].includes(b))?"no_trade"
    :blockers.includes("invalidated")||blockers.includes("stop_broken")?"invalidated":blockers.includes("expired")||blockers.includes("target_reached")?"expired"
    :!e?.confirmation?"waiting_confirmation":!e.retest?"waiting_retest":blockers.includes("context")?"no_trade":"technical_valid";
  if(state!=="technical_valid"){entry=null;stop=null;}
  const price=(n:number)=>n.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:saved.snapshot.pricePrecision});
  lines.push(zh?`本次重新检查使用 ${market.fetchedAt} 的已完成 ${market.bar} K 线；原报告价格映射保持不变。`:`Rechecked completed ${market.bar} candles at ${market.fetchedAt}; the purchased price map is unchanged.`);
  if(nextClose!==null&&nextClose>fetched)lines.push(zh?`下一根 ${market.bar} K 线收盘时间：${new Date(nextClose).toISOString()}；当前未完成 K 线不能作为确认。`:`Next ${market.bar} candle closes ${new Date(nextClose).toISOString()}; the current unfinished candle cannot confirm the setup.`);
  if(blockers.includes("reward"))lines.push(zh?"等待：本次计划的最近目标收益不足。需要新的有效价格结构，仅增加确认无法解决。":"WAIT: skip this plan because first-objective reward is too small. A new supported structure is needed; confirmation alone cannot fix it.");
  if(e?.failure)lines.push(zh?`先前尝试失效：${new Date(candleCloseTime(e.failure.ts,market.bar)!).toISOString()}，${e.failureReason}。`:`Previous attempt invalidated at ${new Date(candleCloseTime(e.failure.ts,market.bar)!).toISOString()} (${e.failureReason==="floor"?"structural boundary breached":e.failureReason==="trigger"?"close failed the trigger":"protective stop breached"}).`);
  if(blockers.includes("history"))lines.push(zh?"完整 K 线过少、过期或存在缺口；不能验证新的入场。":"Completed candles are insufficient, stale or contain a gap; a fresh entry cannot be verified.");
  if(state==="expired")lines.push(zh?"先前入场窗口已结束。需要更晚的合格确认和后续回测。":"The previous entry window ended. A later qualifying confirmation and subsequent test are required.");
  if(blockers.includes("target_reached"))lines.push(zh?"回测当根或之后的 K 线已触及最近目标；不可把已完成的目标当作新的收益。需要重新评估映射。":"The retest bar or a later bar already touched the nearest target. A completed objective cannot be reused as fresh reward; reassess the map.");
  if(e?.disqualified&&!e.confirmation)lines.push(zh?`测试被排除：K 线收盘 ${new Date(candleCloseTime(e.disqualified.ts,market.bar)!).toISOString()}，触及结构边界或参考止损。`:`Disqualified test: bar closed ${new Date(candleCloseTime(e.disqualified.ts,market.bar)!).toISOString()}; it touched the structural boundary or reference stop.`);
  if(blockers.includes("confirmation")&&trigger!==undefined)lines.push(zh?`等待新的 ${market.bar} 完成确认，触发价 ${price(trigger)}；随后必须有另一根有效回测。`:`Wait for a fresh completed ${market.bar} ${p.condition==="support_hold"?"support test":p.condition==="rejection"?"rejection test":"crossing close"} at ${price(trigger)}, then a separate valid retest.`);
  if(e?.retestDeadline)lines.push(`${zh?"回测截止":"Retest deadline"}: ${new Date(e.retestDeadline).toISOString()}.`);
  if(e?.expiresAt)lines.push(`${zh?"入场窗口截止":"Entry window ends"}: ${new Date(e.expiresAt).toISOString()}.`);
  if(blockers.includes("context"))lines.push(zh?"独立高周期背景缺失或冲突；暂不进入订单复核。":"Independent higher-timeframe context is unavailable or conflicts; order review is blocked.");
  if(overlapChanged)lines.push(zh?"原始 K 线被数据源修订；需要新的价格映射。":"The provider revised original candles; a new map is required.");
  if(state==="technical_valid")lines.push(zh?`${p.side==="long"?"买入":"卖出"}条件已确认。选择金额并检查新报价、费用与余额后复核订单。`:`${p.side==="long"?"BUY":"SELL"} setup confirmed. Choose an amount and check a fresh quote, costs and balance before order review.`);
  if(p.side==="short")lines.push(zh?"做空仅为研究；应用只支持卖出已有现货，不会开杠杆空仓或复制做空保护。":"Short research only. The app can sell owned Spot inventory; it does not open a leveraged short or copy short protection.");
  const worst=entry?(p.side==="long"?entry[1]:entry[0]):null,distance=worst!==null&&stop!==null?Math.abs(worst-stop):null;
  return GlobalAssessmentSchema.parse({version:"pulse-global-assessment-v1",sourceRef:globalReportReference(saved),sourceObservedAt:saved.snapshot.observedAt,assessedAt:market.fetchedAt,instId:market.instId,timeframe:market.bar,priceCurrency:saved.snapshot.priceCurrency,state,side:p.side,pathId:p.pathId,lastCompletedClose:last?.close??null,lastCompletedAt:last?candleCloseTime(last.ts,market.bar):null,confirmationTs:e?.confirmation?.ts??null,retestTs:e?.retest?.ts??null,retestDeadline:e?.retestDeadline??null,expiresAt:e?.expiresAt??null,permittedEntry:entry,observedStop:stop,targets,grossRewardRisk:rr??p.grossRewardRisk,stopDistancePercent:distance!==null&&worst?distance/worst*100:null,stopDistanceAtr:distance!==null&&atr?distance/atr:null,context:agreement,blockers:[...new Set(blockers)],lines});
}
