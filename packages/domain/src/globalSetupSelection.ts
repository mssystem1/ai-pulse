import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {deriveGlobalEntryPlan} from "./globalEntryPlan.js";
import {globalContextRelation} from "./globalContext.js";

type Plan=NonNullable<GlobalReport["tradePlan"]>;
export type GlobalSetupSelection={
  version:"single-setup-v4";assessment:"long"|"short"|"sideways";
  regime:"trend"|"recovery"|"range"|"transition";
  rule:"trend_continuation"|"structural_reversal"|"structure_break"|"range_reaction"|"none";
  pathId:string|null;side:"long"|"short"|"none";evidence:string[];limitations:string[];
};

/** An old ABC label is context, not a perpetual forecast of a falling C leg. */
export function globalWavePhase(report:GlobalReport){
  const w=report.waveCount,b=w.anchors.find(a=>a.label==="B"),c=w.anchors.find(a=>a.label?.startsWith("C")),last=report.candles.at(-1);
  const recovered=w.status==="candidate"&&w.structure==="abc_correction"&&b&&c&&last&&last.ts>c.ts&&(w.direction==="up"?last.close>b.price:last.close<b.price);
  return {recovered:Boolean(recovered),b,c,direction:w.direction,phase:recovered?"post_c_recovery":w.structure==="abc_correction"?"historical_abc":"candidate"};
}

/** Select a strategy first, then its entry. R:R or proximity cannot choose the
 * market direction. These explicit research rules are not profitability claims. */
export function selectSingleGlobalSetup(report:GlobalReport):{selection:GlobalSetupSelection;plan:Plan}{
  const zh=report.lang==="zh",last=report.candles.at(-1),row=report.hierarchy?.find(r=>r.timeframe===report.snapshot.timeframe);
  const series=(period:number)=>report.indicators.sma.find(s=>s.period===period)?.points??[];
  const fast=series(21),slow=series(55),ma21=fast.at(-1)?.value,ma55=slow.at(-1)?.value;
  const slope21=fast.length>10?fast.at(-1)!.value-fast.at(-11)!.value:null,slope55=slow.length>10?slow.at(-1)!.value-slow.at(-11)!.value:null;
  const rsi=report.indicators.rsi.points.at(-1)?.value,previousRsi=report.indicators.rsi.points.at(-2)?.value;
  const pivots=report.indicators.pivots.filter(a=>a.confirmedAt!==null),lows=pivots.filter(a=>a.kind==="low").slice(-2),highs=pivots.filter(a=>a.kind==="high").slice(-2);
  const higherLow=lows.length===2&&lows[1].price>lows[0].price,lowerHigh=highs.length===2&&highs[1].price<highs[0].price;
  const wave=globalWavePhase(report),price=(n:number)=>n.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  const routes=(report.strategy?.routes??[]).filter(r=>report.view.pathIds.includes(r.pathId));
  const candidates=routes.map(route=>{let plan:Plan|undefined;return {route,path:report.paths.find(p=>p.id===route.pathId)!,get plan(){return plan??=deriveGlobalEntryPlan(report,route.pathId,route.side);}};}).filter(c=>c.path);
  const empty:Plan={side:"none",pathId:null,state:"none",condition:"close_retest",triggerLevelId:null,invalidationLevelId:null,targetIds:[],referenceEntry:null,referenceStop:null,grossRewardRisk:null,stopBufferAtr:.1,confirmationTs:null,retestTs:null,blockers:report.entryStudy?.status!=="available"||report.entryStudy.candles.length<55?["history"]:["levels"],method:"structure-v5",entryTimeframe:report.entryStudy?.timeframe??report.snapshot.timeframe};
  let assessment:GlobalSetupSelection["assessment"]="sideways",regime:GlobalSetupSelection["regime"]="transition",rule:GlobalSetupSelection["rule"]="none",side:"long"|"short"|"none"="none";
  const evidence:string[]=[],limitations:string[]=[];
  const say=(en:string,cn:string)=>zh?cn:en;
  const range=report.range,rangeAnchors=range?pivots.filter(a=>range.anchorIds.includes(a.id)):[];
  const rangeKnownAt=Math.max(0,...rangeAnchors.map(a=>candleCloseTime(a.confirmedAt!,report.snapshot.timeframe)??Infinity));
  const bounded=Boolean(range&&rangeAnchors.length>=4&&last&&last.close>=range.lower[0]&&last.close<=range.upper[1]&&!report.candles.some(c=>c.ts>=rangeKnownAt&&(c.close<range.lower[0]||c.close>range.upper[1])));
  const trendUp=Boolean(last&&ma55!==undefined&&slope55!==null&&row?.structure==="up"&&last.close>ma55&&slope55>0);
  const trendDown=Boolean(last&&ma55!==undefined&&slope55!==null&&row?.structure==="down"&&last.close<ma55&&slope55<0);
  const breakUp=Boolean(last&&ma55!==undefined&&slope55!==null&&rsi!==undefined&&highs.length===2&&last.close>Math.max(...highs.map(a=>a.price))&&last.close>ma55&&slope55>0&&rsi>50);
  const breakDown=Boolean(last&&ma55!==undefined&&slope55!==null&&rsi!==undefined&&lows.length===2&&last.close<Math.min(...lows.map(a=>a.price))&&last.close<ma55&&slope55<0&&rsi<50);
  if(bounded&&range&&last){
    regime="range";
    evidence.push(say(`Confirmed range ${price(range.lower[0])}–${price(range.upper[1])}; no later completed close has broken its boundaries.`,`已确认区间 ${price(range.lower[0])}–${price(range.upper[1])}；之后完整收盘未突破边界。`));
    // A primary range is context, not a veto of an observed directional reclaim.
    // All candidate families receive the same chronology/protection checks.
    const observed=candidates.filter(c=>c.plan.retestTs&&!c.plan.failure&&!c.plan.blockers.some(b=>["cancelled","expired","history","levels"].includes(b))).sort((a,b)=>Number(b.plan.state==="confirmed")-Number(a.plan.state==="confirmed")||(b.plan.retestTs??0)-(a.plan.retestTs??0));
    if(observed.length){
      side=observed[0].route.side;
      if(observed[0].path.direction!=="range"){
        regime="transition";rule="structural_reversal";
        evidence.push(say("The primary range remains context. A directional candidate has an observed later entry-frame retest; compare its protection and nearest barrier before entry.","主图区间仍为背景。方向候选已观察到后续入场周期回测；入场前须比较保护与最近障碍。"));
      }
    }
    else if(rsi!==undefined&&previousRsi!==undefined){
      const allowance=(report.indicators.atr.points.at(-1)?.value??0)*.1;
      if(last.low<=range.lower[1]+allowance&&last.close>range.lower[1]&&rsi>previousRsi)side="long";
      else if(last.high>=range.upper[0]-allowance&&last.close<range.upper[0]&&rsi<previousRsi)side="short";
    }
    // A nearer boundary is not evidence for choosing a trade. Keep the range
    // map, but do not manufacture a direction, entry, stop or R multiple.
    if(side==="none"){
      limitations.unshift(say("No entry selected: neither range edge has a qualified reaction. Distance to an old support or resistance does not predict the next move. Entry and stop must come from a new observed reaction.","未选择入场：区间两端均无合格反应。到旧支撑或阻力的距离不能预测下一步；入场和止损须来自新的实际反应。"));
      evidence.push(say(`Support reference ${price(range.lower[0])}–${price(range.lower[1])}; resistance reference ${price(range.upper[0])}–${price(range.upper[1])}. These are observation zones, not planned entries.`,`支撑参考 ${price(range.lower[0])}–${price(range.lower[1])}；阻力参考 ${price(range.upper[0])}–${price(range.upper[1])}。这些是观察区域，并非计划入场。`));
    }
    if(regime==="range")rule="range_reaction";
    if(side!=="none")evidence.push(say(`Observed ${side==="long"?"support-bounce":"resistance-rejection"} evidence; entry still needs protection and sufficient room to the nearest obstacle.`,`已观察到${side==="long"?"支撑反弹":"阻力回落"}证据；入场仍须保护与最近障碍的足够空间。`));
  }else if(trendUp||trendDown){
    side=trendUp?"long":"short";assessment=side;regime="trend";rule="trend_continuation";
    evidence.push(say(`${row!.structure==="up"?"Higher highs and higher lows":"Lower highs and lower lows"}; close ${price(last!.close)} is ${side==="long"?"above a rising":"below a falling"} SMA55 ${price(ma55!)}.`,`${row!.structure==="up"?"高点与低点抬升":"高点与低点下移"}；收盘 ${price(last!.close)} 位于${side==="long"?"上行 SMA55 上方":"下行 SMA55 下方"} ${price(ma55!)}。`));
  }else if(breakUp||breakDown){
    side=breakUp?"long":"short";assessment=side;regime="transition";rule="structure_break";
    evidence.push(say(`Completed close ${price(last!.close)} has broken both recent confirmed ${breakUp?"highs":"lows"}; price is ${breakUp?"above rising":"below falling"} SMA55 ${price(ma55!)}, with RSI14 ${rsi!.toFixed(2)}.`,`完整收盘 ${price(last!.close)} 已突破两个近期确认${breakUp?"高点":"低点"}；价格位于${breakUp?"上行 SMA55 上方":"下行 SMA55 下方"} ${price(ma55!)}，RSI14 ${rsi!.toFixed(2)}。`));
    limitations.push(say("The break changes the prior swing structure before a new opposite pivot sequence is confirmed. A later held retest is still required; a break is not an entry fill.","突破先于新反向摆动序列的确认；仍须后续回测守住，突破不代表入场成交。"));
    if(slope21!==null&&(breakUp?slope21<=0:slope21>=0))limitations.push(say("SMA21 has not turned with the break. Its lag is disclosed; follow-through and entry protection remain necessary.","SMA21 尚未随突破转向；均线滞后需披露，仍须后续确认及入场保护。"));
  }else if(last&&ma21!==undefined&&slope21!==null&&rsi!==undefined){
    const up=(row?.structure==="up"||higherLow&&highs.length===2&&last.close>Math.max(...highs.map(a=>a.price)))&&last.close>ma21&&slope21>0&&rsi>50;
    const down=(row?.structure==="down"||lowerHigh&&lows.length===2&&last.close<Math.min(...lows.map(a=>a.price)))&&last.close<ma21&&slope21<0&&rsi<50;
    if(up||down){
      side=up?"long":"short";assessment=side;regime="recovery";rule="structural_reversal";
      evidence.push(say(`Structural ${up?"recovery":"downward reversal"}; close ${price(last.close)} ${up?"above rising":"below falling"} SMA21 ${price(ma21)}, RSI14 ${rsi.toFixed(2)}.`,`结构${up?"恢复":"向下反转"}；收盘 ${price(last.close)} 位于${up?"上行 SMA21 上方":"下行 SMA21 下方"} ${price(ma21)}，RSI14 ${rsi.toFixed(2)}。`));
      if(wave.recovered)evidence.push(say(`Price has reclaimed the historical ABC B level ${price(wave.b!.price)} after candidate C. This supports a recovery hypothesis; the old C label is not a current opposite-side forecast.`,`候选 C 之后价格已收复历史 ABC 的 B 位 ${price(wave.b!.price)}，支持恢复假设；旧 C 标签不代表当前反向预测。`));
      if(ma55!==undefined&&slope55!==null&&(up?slope55<=0:slope55>=0))limitations.push(say("SMA55 has not turned with the recovery. This is a reversal hypothesis, not an established long-term trend.","SMA55 尚未随恢复转向；这是反转假设，并非已建立长期趋势。"));
    }
  }
  if(side==="none"&&regime!=="range")limitations.push(say("Structure and trend evidence do not establish a directional strategy. No simultaneous long/short setups are proposed.","结构与趋势证据尚未建立方向策略，不同时提出多空入场。"));
  if(report.waveCount.status==="candidate")limitations.push(say("Elliott labels are a swing-pattern hypothesis; internal subwaves remain unverified. Indicators derived from the same prices are not independent votes.","艾略特标签为摆动形态假设，内部子浪尚未验证；同源价格指标不是独立投票。"));
  if(report.entryStudy?.status==="available"){
    const study=report.entryStudy,latest=study.candles.at(-1),known=study.pivots.filter(a=>a.confirmedAt!==null&&(candleCloseTime(a.confirmedAt,study.timeframe)??Infinity)<=Date.parse(report.snapshot.observedAt));
    const recentLows=known.filter(a=>a.kind==="low").slice(-2),recentHighs=known.filter(a=>a.kind==="high").slice(-2);
    const localSupport=recentLows.at(-1),localResistance=recentHighs.at(-1);
    if(latest&&localSupport&&localResistance)evidence.push(say(`${study.timeframe} local structure: last close ${price(latest.close)}, confirmed low ${price(localSupport.price)}${recentLows.length===2&&localSupport.price>recentLows[0].price?" (higher low)":""}, confirmed high ${price(localResistance.price)}. A nearer reclaim/retest must be evaluated on its own evidence and nearest barrier; it is not ruled out by an older range-edge plan.`,`${study.timeframe} 局部结构：最近收盘 ${price(latest.close)}，确认低点 ${price(localSupport.price)}，确认高点 ${price(localResistance.price)}。更近的收复与回测须按自身证据和最近障碍评估，不能被旧区间边缘计划排除。`));
  }
  const mapped=candidates.filter(c=>c.route.side===side&&c.route.objectiveIds.length>0&&c.route.protectionLevelId!==null&&(regime==="range"?c.path.kind==="range":c.path.direction!=='range'));
  // Within the chosen direction prefer actual recent entry evidence, then the
  // newest confirmed structural trigger. Never pick a side by a larger R multiple.
  const known=(c:typeof candidates[number])=>Math.max(0,...pivots.filter(a=>report.levels.find(l=>l.id===c.path.triggerLevelId)?.anchorIds.includes(a.id)).map(a=>a.confirmedAt!));
  mapped.sort((a,b)=>Number(b.plan.state==="confirmed"&&!b.plan.failure)-Number(a.plan.state==="confirmed"&&!a.plan.failure)||(b.plan.retestTs??0)-(a.plan.retestTs??0)||known(b)-known(a)||a.path.id.localeCompare(b.path.id));
  const chosen=mapped[0];
  if(side!=="none"&&!chosen)limitations.unshift(say("No supported target/protection map is available for this direction. Entry is unavailable.","此方向没有受支持目标与保护映射，入场不可用。"));
  if(chosen&&["opposing","unavailable"].includes(globalContextRelation(report,side)))limitations.push(say("Higher-timeframe context blocks entry until it is available and compatible.","高周期背景缺失或相反，入场须等待背景可用且相容。"));
  return {selection:{version:"single-setup-v4",assessment,regime,rule:chosen?rule:"none",pathId:chosen?.path.id??null,side:chosen?.route.side??"none",evidence,limitations},plan:chosen?.plan??empty};
}
