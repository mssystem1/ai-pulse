import {globalScenarioLines} from "./globalExecutionInstructions.js";
import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalFrameReference,globalContextLine} from "./globalContext.js";
import {globalPriceBandText,globalTargetReference,globalPriceZonePayoff,globalOpposingEntryZones} from "./globalPriceZones.js";
import {globalSetupAdmission} from "./globalSetupAdmission.js";

/** Explain saved evidence without converting a conditional level into a signal. */
export function globalSetupRationale(report:GlobalReport,current:number|null):string[]{
  const d=report.discretionaryPlan;if(!d)return [];
  const zh=report.lang==="zh",price=(v:number)=>v.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  const at=(ts:number)=>new Date(ts).toISOString().slice(0,16).replace("T"," ")+" UTC",tf=globalFrameReference(report.snapshot.timeframe);
  const selection=report.setupSelection,lines:string[]=[];
  if(selection?.assessment==="sideways")lines.push(zh?`${tf} 的结构与趋势方向混合；本计划根据主周期价位位置选择方向。`:`${tf} structure and trend are mixed; this plan uses primary price location rather than an established directional trend.`);
  else if(selection){
    const period=selection.regime==="recovery"?21:55,points=report.indicators.sma.find(s=>s.period===period)?.points,sma=points?.at(-1)?.value,previous=points?.at(-11)?.value;
    if(sma!==undefined)lines.push(zh?`${tf} 方向依据：已完成收盘 ${price(report.snapshot.price!)} ${report.snapshot.price!>sma?'高于':'低于'} SMA${period} ${price(sma)}。`:`${tf} direction basis: completed close ${price(report.snapshot.price!)} is ${report.snapshot.price!>sma?'above':'below'} ${previous===undefined?'':sma>previous?'rising ':sma<previous?'falling ':''}SMA${period} ${price(sma)}.`);
    if(selection.regime==="recovery")lines.push(zh?'这是反转假设；SMA55 尚未确认趋势转变。':`This is a ${selection.assessment==='long'?'recovery':'downward reversal'} hypothesis; SMA55 has not confirmed the trend turn.`);
    else if(selection.rule==="trend_continuation")lines.push(zh?'主周期摆动结构与趋势方向一致；入场仍需单独确认。':`${selection.assessment==="long"?'Higher highs and higher lows':'Lower highs and lower lows'} support the primary trend; entry still needs its own reaction.`);
  }
  lines.push(globalContextLine(report,d.side));
  if(d.entryReaction){
    const reaction=d.entryReaction,entryTf=globalFrameReference(reaction.timeframe);
    if(reaction.kind==="completed_break"){
      const boundary=reaction.level?.price??d.entry,levelKind=reaction.level?.kind??(d.side==="short"?"low":"high");
      lines.push(zh?`入场依据：${entryTf} 已完成收盘跌破/突破已确认摆动${levelKind==="low"?"低点":"高点"} ${price(boundary)}；被动限价在该边界回测入场，无需等待未来 K 线确认。价格返回只是条件入场，不是泵升或砸盘预测。`:`Entry basis: a completed ${entryTf} close broke confirmed swing ${levelKind} ${price(boundary)}. The passive limit retests that boundary; no future candle confirmation is required. A price return is a conditional entry, not a pump/dump forecast.`);
      const tp1=d.targets[0]?.timeframe??report.snapshot.timeframe;
      lines.push(zh?`固定止损至少位于已突破边界外 0.5×${entryTf} ATR。TP1 使用 ${globalFrameReference(tp1)}；后续止盈目标仍依据主周期 ${tf}。`:`Fixed SL is at least 0.5× ${entryTf} ATR beyond the broken boundary. TP1 uses ${globalFrameReference(tp1)}; later targets remain on the primary ${tf} timeframe.`);
    }else{
      const event=reaction.kind==="completed_sweep"?(zh?"已完成扫荡":"completed sweep"):(zh?"已完成拒绝":"completed rejection");
      lines.push(zh?`入场依据：入场研究周期 ${entryTf} 出现${event}；被动限价位于来源 K 线实体边缘 ${price(d.entry)}。无需等待未来 K 线确认；价格返回只是条件入场，不是泵升或砸盘预测。`:`Entry basis: a ${event} in the declared ${entryTf} entry study. The passive limit sits at the source candle body edge ${price(d.entry)}; no future candle confirmation is required. A price return is a conditional entry, not a pump/dump forecast.`);
      lines.push(zh?`固定止损依据来源 K 线影线 ${price(d.stopBasis.price)}，在影线外侧留出 0.2×来源周期 ATR 缓冲；入场至止损距离至少为 0.5×该 ATR。TP1 使用 ${globalFrameReference(d.targets[0]?.timeframe??report.snapshot.timeframe)}；后续止盈目标仍依据主周期 ${tf}。`:`Fixed SL is set 0.2× source ATR beyond the source candle wick ${price(d.stopBasis.price)}, with at least 0.5× source ATR between entry and SL. TP1 uses ${globalFrameReference(d.targets[0]?.timeframe??report.snapshot.timeframe)}; later targets remain on the primary ${tf} timeframe.`);
    }
  }
  if(selection?.rule==="trend_continuation")for(const kind of ["high","low"] as const){
    const anchors=report.indicators.pivots.filter(a=>a.kind===kind&&a.confirmedAt!==null&&candleCloseTime(a.confirmedAt,report.snapshot.timeframe)!<=Date.parse(report.snapshot.observedAt)).slice(-2);
    if(anchors.length===2)lines.push(zh?`${tf} 已确认${kind==="high"?'高点':'低点'}：${anchors.map(a=>`${price(a.price)} (${at(a.ts)})`).join(' → ')}。`:`${tf} confirmed swing ${kind==='high'?'highs':'lows'}: ${anchors.map(a=>`${price(a.price)} (${at(a.ts)})`).join(' → ')}.`);
  }
  if(selection?.regime==="recovery"){
    const rsi=report.indicators.rsi.points.at(-1)?.value;if(rsi!==undefined)lines.push(`${tf} RSI14: ${rsi.toFixed(2)}.`);
  }
  lines.push(zh?'本快照之后仍需新的入场反应；主周期方向本身不构成入场信号。':'A new entry reaction after this snapshot is still required; the primary direction alone is not an entry signal.');
  if(d.executionPolicy){lines.pop();lines.push(...globalScenarioLines(report));}
  const kind=d.entryBasis.kind,source=globalFrameReference(d.entryBasis.timeframe),sourcePrice=d.priceZones?.entry.sourcePrice??d.entry;
  if(kind==="ema_ribbon")lines.push(zh?`入场依据：${source} EMA 区域 ${price(d.entry)}，截至 ${at(d.entryBasis.knownAt)}；尚需新的回测反应。`:`Entry basis: ${source} EMA ribbon ${price(sourcePrice)}, as of ${at(d.entryBasis.knownAt)}; a new retest reaction is still required.`);
  if(kind==="structure_zone"){
    const zone=report.horizonContext?.zones.find(z=>z.role===(d.side==="long"?'support':'resistance')&&(d.side==="long"?z.upper:z.lower)===sourcePrice);
    if(zone)lines.push(zh?`入场依据：${tf} ${d.side==="long"?'支撑':'阻力'} ${price(zone.lower)}–${price(zone.upper)}；等待新的回测。`:`Entry basis: ${tf} ${d.side==="long"?'support':'resistance'} ${price(zone.lower)}–${price(zone.upper)}; await a new held or rejected retest.`);
  }
  if(!d.entryReaction)lines.push(zh?`止损依据：${tf} 失效价 ${price(d.stopBasis.price)}，时间 ${at(d.stopBasis.anchorTs)}；止损 ${price(d.stop)} 位于其外侧。`:`Protection basis: ${tf} invalidation ${price(d.stopBasis.price)}, dated ${at(d.stopBasis.anchorTs)}; SL ${price(d.stop)} is beyond it.`);
  const sign=d.side==="long"?1:-1,risk=Math.abs(d.entry-d.stop),rr=sign*(globalTargetReference(report,0)!-d.entry)/risk,barrier=d.barriers[0];
  const staged=d.entryReaction&&d.priceZones?.payoffPolicy==="staged-weighted-v1"?globalSetupAdmission(report):null;
  const allocations=d.executionPolicy?.targetAllocations;
  const payoff=globalPriceZonePayoff(report);
  const opposingZones=globalOpposingEntryZones(report);
  for(const zone of opposingZones)lines.push(zh?`入场区与主周期 ${tf} ${d.side==="long"?"阻力":"支撑"}区 ${globalPriceBandText(report,zone)} 重叠。入场前须${d.side==="long"?"完整收复该阻力区并回测守住":"完整跌破该支撑区并回测受阻"}；重叠未解决时，最不利入场至最近障碍为 0.00R。`:`Entry overlaps the primary ${tf} ${d.side==="long"?"resistance":"support"} zone ${globalPriceBandText(report,zone)}. A completed ${d.side==="long"?"reclaim and held retest of that resistance zone":"break and rejected retest of that support zone"} is required before entry; while the overlap remains, the least favorable fill offers 0.00R to the nearest obstacle.`);
  if(d.priceZones&&payoff)lines.push(zh?`入场区 ${globalPriceBandText(report,d.priceZones.entry)}；止损区 ${globalPriceBandText(report,d.priceZones.stop)}，硬止损 ${price(d.stop)}。按最不利入场计算，最近障碍 ${payoff.worstToObstacle.toFixed(2)}R。`:`Entry zone ${globalPriceBandText(report,d.priceZones.entry)}; SL zone ${globalPriceBandText(report,d.priceZones.stop)}, hard SL ${price(d.stop)}. At the least favorable fill, the nearest obstacle offers ${payoff.worstToObstacle.toFixed(2)}R.`);
  if(current!==null&&sign*(current-d.entry)>0)lines.push(zh?`当前价格与入场相差 ${price(Math.abs(current-d.entry))}；只有价格重新回测入场区域时本计划才适用，当前价格不代表入场。`:`Price is ${price(Math.abs(current-d.entry))} beyond entry; this plan applies only if price returns to the entry area and reacts. The current quote is not an entry fill.`);
  if(barrier)lines.push(zh?`${opposingZones.length?"更远的已标注障碍":"最近障碍"} ${globalFrameReference(barrier.timeframe)} ${price(barrier.price)}：${(sign*(barrier.price-d.entry)/risk).toFixed(2)}R；TP1 ${rr.toFixed(2)}R。`:`${opposingZones.length?"Further plotted obstacle":"Nearest obstacle"}: ${globalFrameReference(barrier.timeframe)} ${price(barrier.price)} offers ${(sign*(barrier.price-d.entry)/risk).toFixed(2)}R; TP1 offers ${rr.toFixed(2)}R.`);
  if(staged&&allocations?.length===d.targets.length){
    const exits=d.targets.map((t,i)=>`${zh?`TP${i+1} ${globalFrameReference(t.timeframe)} ${Math.round(allocations[i]*100)}% ${price(globalTargetReference(report,i)!)}`:`TP${i+1} (${globalFrameReference(t.timeframe)}) ${Math.round(allocations[i]*100)}% at ${price(globalTargetReference(report,i)!)}`}`).join(zh?"；":"; ");
    lines.push(zh?`分段退出计划：${exits}。TP1 为 ${rr.toFixed(2)}R；按已保存比例加权计划收益为 ${staged.plannedWeightedRewardRisk?.toFixed(2)??"—"}R（未计成本）。未退出仓位仍暴露于固定止损 ${price(d.stop)}；这是计划收益风险比，不是预期利润。`:`Staged exits: ${exits}. TP1 is ${rr.toFixed(2)}R; planned weighted payoff is ${staged.plannedWeightedRewardRisk?.toFixed(2)??"—"}R before costs. Any remaining position stays exposed to the fixed SL ${price(d.stop)}. This is planned payoff, not expected profit.`);
  }else if(rr<1)lines.push(zh?`TP1 仅提供 ${rr.toFixed(2)}R，低于完整止损风险；这些价位不构成具备收益优势的结论。`:`TP1 offers ${rr.toFixed(2)}R, less than the full stop risk; these levels do not establish a favorable payoff.`);
  if(d.executionPolicy)return lines.map(line=>line
    .replace("entry still needs its own reaction.",d.executionPolicy!.mode==="passive_limit"?"the saved passive limit defines entry separately from this trend assessment.":"entry follows its saved reaction policy.")
    .replace("a new retest reaction is still required.",d.executionPolicy!.mode==="passive_limit"?"the saved limit policy applies to this sourced region.":"use the saved event and entry policy.")
    .replace("await a new held or rejected retest.",d.executionPolicy!.mode==="passive_limit"?"the sourced region defines the passive limit plan.":"use the saved defended-retest policy.")
    .replace("this plan applies only if price returns to the entry area and reacts.","this plan applies only within its saved Entry area and execution policy; it does not predict a required return.")
    .replace("\u5c1a\u9700\u65b0\u7684\u56de\u6d4b\u53cd\u5e94", "\u6309\u6240\u793a\u6267\u884c\u89c4\u5219\u590d\u6838")
    .replace("\u7b49\u5f85\u65b0\u7684\u56de\u6d4b", "\u6309\u6240\u793a\u6267\u884c\u89c4\u5219\u590d\u6838"));
  return lines;
}
