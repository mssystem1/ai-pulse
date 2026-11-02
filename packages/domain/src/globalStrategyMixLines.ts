import type {GlobalReport,GlobalStrategyMixCandidate} from "@pulse/schemas";
import {globalFrameReference} from "./globalContext.js";
import {globalSetupFamilyName} from "./globalSetupStrategies.js";

export function globalStrategyVariantName(id:string,lang:"en"|"zh"="en"):string{
  const names:Record<string,[string,string]>={
    value_area_rotation:["Value-area rotation","价值区轮动"],
    accepted_breakout_retest:["Participation-backed breakout retest","成交参与支持的突破回测"],
    sweep_reclaim:["Sweep and reclaim","扫价收复"],
  };
  return names[id]?.[lang==="zh"?1:0]??(lang==="zh"?"补充方法":"Complementary method");
}

function missingName(key:string,zh:boolean){
  const names:Record<string,[string,string]>={
    completed_entry_history:["completed entry-timeframe candles","完整入场周期K线"],
    fresh_completed_executed_profile:["a current, complete executed-volume profile","当前完整的真实成交量分布"],
    anchored_value:["an available anchored VWAP","可用的锚定VWAP"],
    balanced_primary_regime:["a balanced primary market","主周期平衡市场条件"],
    fresh_spot_executed_flow:["current spot executions covering the event","覆盖事件的当前现货成交"],
    fresh_perpetual_executed_flow:["current perpetual executions covering the event","覆盖事件的当前永续成交"],
  };
  return names[key]?.[zh?1:0]??(zh?"所需来源覆盖":"required source coverage");
}

function conflictName(message:string,zh:boolean){
  if(/weekly assessment|macro|primary structural turn/i.test(message))return zh?"小周期反向反应与仍完整的周线依据冲突；尚未形成主周期转向。":"A lower-timeframe countertrend reaction conflicts with intact weekly structure; a primary turn is still absent.";
  if(/spot.*aggression/i.test(message))return zh?"现货主动成交未支持拟议方向。":"Spot executed aggression does not support the proposed direction.";
  if(/perpetual.*aggression/i.test(message))return zh?"永续主动成交未支持拟议方向。":"Perpetual executed aggression does not support the proposed direction.";
  if(/same time|opposing.*events/i.test(message))return zh?"同时完成的反向价格事件互相冲突。":"Opposing completed price events conflict at the same time.";
  if(/latest|current|lost|no longer|failed/i.test(message))return zh?"最新价格未守住所需收复或突破价位。":"The latest price no longer holds the required reclaimed or broken level.";
  return zh?"已记录的入场依据仍有冲突。":"Recorded admission evidence remains contradictory.";
}

/** Public evidence roles and coverage, without internal IDs or private tuning. */
export function globalStrategyMixLines(report:GlobalReport):string[]{
  const mix=report.strategyMix;if(!mix)return [];
  const zh=report.lang==="zh",lang=report.lang,plan=report.discretionaryPlan;
  const side=(value:string)=>value==="long"?"LONG":value==="short"?"SHORT":zh?"混合":"Mixed";
  const family=mix.primary.family?globalSetupFamilyName(mix.primary.family,lang):(zh?"未选定":"Unselected");
  const selected=mix.candidates.find(c=>c.id===mix.selectedVariant),selectedName=selected?globalStrategyVariantName(selected.id,lang):plan?globalSetupFamilyName(plan.family,lang):family;
  const assessment=side(report.setupSelection?.assessment??"none");
  const lines=[zh?`主周期判断：${assessment}。核心方法：${side(mix.primary.side)} · ${family}。所选计划：${side(plan?.side??selected?.side??mix.primary.side)} · ${selectedName}。`:`Primary assessment: ${assessment}. Core method: ${side(mix.primary.side)} · ${family}. Selected setup: ${side(plan?.side??selected?.side??mix.primary.side)} · ${selectedName}.`];
  const price=(value:number)=>value.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  const date=(at:number)=>new Date(at).toISOString().slice(0,16).replace("T"," ")+" UTC";
  if(selected?.source){const s=selected.source;lines.push(zh?`位置依据：${globalFrameReference(s.timeframe)} 来源价位 ${price(s.price)}，已知于 ${date(s.knownAt)}。`:`Location evidence: ${globalFrameReference(s.timeframe)} source level ${price(s.price)}, known at ${date(s.knownAt)}.`);}
  if(selected?.event){const e=selected.event;
    const eventNames:Record<NonNullable<GlobalStrategyMixCandidate["event"]>["kind"],[string,string]>={
      value_rejection:["value-edge rejection and a held return inside value","价值区边缘受阻并守住返回区间"],
      accepted_retest:["acceptance beyond the boundary and a defended retest","边界外接受及守住的回测"],
      sweep_reclaim:["a known-level sweep, reclaim and held recovery","已知价位扫价、收复及守住的恢复"],
    };
    lines.push(zh?`价格事件：${globalFrameReference(e.timeframe)} ${eventNames[e.kind][1]}；测试 ${date(e.testTs)}，价格事件完成于 ${date(e.completedAt)}。`:`Price event: ${globalFrameReference(e.timeframe)} ${eventNames[e.kind][0]}; test ${date(e.testTs)}, price event completed ${date(e.completedAt)}.`);
  }
  if(selected){
    const retained=(report.marketEvidence??[]).filter(e=>selected.evidenceIds.includes(e.id)),native=report.orderFlow;
    const nativeProfile=native&&selected.evidenceIds.includes(`${native.source}:${native.instId}:profile:${native.profile.start}:${native.profile.end}`);
    const nativeFlow=native&&selected.evidenceIds.includes(`${native.source}:${native.instId}:delta:${native.profile.start}:${native.profile.end}`);
    const nativeUsed=nativeProfile||nativeFlow;
    const flow=retained.filter(e=>e.data.kind==="traded_flow"),spot=flow.some(e=>e.market.marketType==="spot")||Boolean(nativeFlow&&native.marketType==="spot"),perp=flow.some(e=>e.market.marketType==="perpetual")||Boolean(nativeFlow&&native.marketType==="perpetual");
    if(spot||perp)lines.push(zh?`参与依据：保留了${spot?"现货":""}${spot&&perp?"及":""}${perp?"永续":""}真实主动成交，分别使用各自市场与时间窗口。`:`Participation evidence: retained ${spot?"spot":""}${spot&&perp?" and ":""}${perp?"perpetual":""} executions, each with its own market and coverage window.`);
    else lines.push(zh?"参与依据：该价格事件未声称得到实时现货及永续资金流共同确认。成交量柱本身不是成交足迹或挂单流动性。":"Participation evidence: this price event does not claim joint current spot/perpetual flow confirmation. Volume bars alone are not footprint or resting-liquidity evidence.");
    for(const e of retained)lines.push(zh?`来源覆盖：${e.market.venue} ${e.market.instrument} · ${e.market.marketType==="spot"?"现货":"永续"} · ${date(e.coverage.start)} → ${date(e.coverage.end)}。`:`Source coverage: ${e.market.venue} ${e.market.instrument} · ${e.market.marketType} · ${date(e.coverage.start)} → ${date(e.coverage.end)}.`);
    if(nativeUsed)lines.push(zh?`来源覆盖：${report.snapshot.venue} ${native.instId} · ${native.marketType==="spot"?"现货":"永续"} · ${date(native.profile.start)} → ${date(native.profile.end)}。`:`Source coverage: ${report.snapshot.venue} ${native.instId} · ${native.marketType} · ${date(native.profile.start)} → ${date(native.profile.end)}.`);
  }
  for(const candidate of mix.candidates){
    const name=globalStrategyVariantName(candidate.id,lang);
    if(candidate.status==="unavailable")lines.push(zh?`${name}：当前不可用于确认；需要${[...new Set(candidate.missingInputs.map(key=>missingName(key,zh)))].join("、")}。`:`${name}: unavailable for admission; needs ${[...new Set(candidate.missingInputs.map(key=>missingName(key,zh)))].join(", ")}.`);
    else if(candidate.status==="conflicted")lines.push(`${name}: ${candidate.conflicts.map(c=>conflictName(c,zh)).join(" ")}`);
    else if(candidate.status==="awaiting_event")lines.push(zh?`${name}：仍在等待自身完整价格事件。`:`${name}: awaiting its own completed price event.`);
    else if(candidate.id!==mix.selectedVariant)lines.push(zh?`${name}：已观察到合格事件；未作为另一笔同时交易选用。`:`${name}: an eligible event was observed; it is not selected as another simultaneous trade.`);
  }
  lines.push(zh?"只保留一个主要敞口；位置、价格事件与真实成交参与具有不同作用，相关价格指标不重复计为独立确认。":"One primary exposure is selected. Location, price events and actual participation have distinct roles; correlated price indicators are not independent confirmations.");
  return lines;
}
