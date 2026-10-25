import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalFrameReference,globalContextLine} from "./globalContext.js";

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
  if(selection?.rule==="trend_continuation")for(const kind of ["high","low"] as const){
    const anchors=report.indicators.pivots.filter(a=>a.kind===kind&&a.confirmedAt!==null&&candleCloseTime(a.confirmedAt,report.snapshot.timeframe)!<=Date.parse(report.snapshot.observedAt)).slice(-2);
    if(anchors.length===2)lines.push(zh?`${tf} 已确认${kind==="high"?'高点':'低点'}：${anchors.map(a=>`${price(a.price)} (${at(a.ts)})`).join(' → ')}。`:`${tf} confirmed swing ${kind==='high'?'highs':'lows'}: ${anchors.map(a=>`${price(a.price)} (${at(a.ts)})`).join(' → ')}.`);
  }
  if(selection?.regime==="recovery"){
    const rsi=report.indicators.rsi.points.at(-1)?.value;if(rsi!==undefined)lines.push(`${tf} RSI14: ${rsi.toFixed(2)}.`);
  }
  lines.push(zh?'本快照之后仍需新的入场反应；主周期方向本身不构成入场信号。':'A new entry reaction after this snapshot is still required; the primary direction alone is not an entry signal.');
  const kind=d.entryBasis.kind,source=globalFrameReference(d.entryBasis.timeframe);
  if(kind==="ema_ribbon")lines.push(zh?`入场依据：${source} EMA 区域 ${price(d.entry)}，截至 ${at(d.entryBasis.knownAt)}；尚需新的回测反应。`:`Entry basis: ${source} EMA ribbon ${price(d.entry)}, as of ${at(d.entryBasis.knownAt)}; a new retest reaction is still required.`);
  if(kind==="structure_zone"){
    const zone=report.horizonContext?.zones.find(z=>z.role===(d.side==="long"?'support':'resistance')&&(d.side==="long"?z.upper:z.lower)===d.entry);
    if(zone)lines.push(zh?`入场依据：${tf} ${d.side==="long"?'支撑':'阻力'} ${price(zone.lower)}–${price(zone.upper)}；等待新的回测。`:`Entry basis: ${tf} ${d.side==="long"?'support':'resistance'} ${price(zone.lower)}–${price(zone.upper)}; await a new held or rejected retest.`);
  }
  lines.push(zh?`止损依据：${tf} 失效价 ${price(d.stopBasis.price)}，时间 ${at(d.stopBasis.anchorTs)}；止损 ${price(d.stop)} 位于其外侧。`:`Protection basis: ${tf} invalidation ${price(d.stopBasis.price)}, dated ${at(d.stopBasis.anchorTs)}; SL ${price(d.stop)} is beyond it.`);
  const sign=d.side==="long"?1:-1,risk=Math.abs(d.entry-d.stop),rr=sign*(d.targets[0].price-d.entry)/risk,barrier=d.barriers[0];
  if(current!==null&&sign*(current-d.entry)>0)lines.push(zh?`当前价格与入场相差 ${price(Math.abs(current-d.entry))}；只有价格重新回测入场区域时本计划才适用，当前价格不代表入场。`:`Price is ${price(Math.abs(current-d.entry))} beyond entry; this plan applies only if price returns to the entry area and reacts. The current quote is not an entry fill.`);
  if(barrier)lines.push(zh?`最近障碍 ${globalFrameReference(barrier.timeframe)} ${price(barrier.price)}：${(sign*(barrier.price-d.entry)/risk).toFixed(2)}R；TP1 ${rr.toFixed(2)}R。`:`Nearest obstacle: ${globalFrameReference(barrier.timeframe)} ${price(barrier.price)} offers ${(sign*(barrier.price-d.entry)/risk).toFixed(2)}R; TP1 offers ${rr.toFixed(2)}R.`);
  if(rr<1)lines.push(zh?`TP1 仅提供 ${rr.toFixed(2)}R，低于完整止损风险；这些价位不构成具备收益优势的结论。`:`TP1 offers ${rr.toFixed(2)}R, less than the full stop risk; these levels do not establish a favorable payoff.`);
  return lines;
}
