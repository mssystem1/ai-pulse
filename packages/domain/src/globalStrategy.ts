import type {GlobalReport} from "@pulse/schemas";
import {globalFrameReference} from "./globalContext.js";
import {globalSetupFamilyName} from "./globalSetupStrategies.js";

/** Product strategy profiles requested by the owner. ATR settings measure
 * structural scale; they are not backtested performance claims. */
export function globalStrategyProfile(timeframe:string){
  const frame=timeframe.replace(/utc$/i,"");
  const profiles={
    "15m":{id:"fast",name:"Fast",holding:"minutes to hours",entryTimeframe:"5m",lookbackBars:96,majorSwingAtr:.5,minimumObjectiveAtr:.5},
    "1H":{id:"intraday",name:"Intraday",holding:"hours / current session",entryTimeframe:"15m",lookbackBars:120,majorSwingAtr:1,minimumObjectiveAtr:.75},
    "4H":{id:"swing",name:"Swing",holding:"days to weeks",entryTimeframe:"1H",lookbackBars:180,majorSwingAtr:1.5,minimumObjectiveAtr:1.5},
    "1D":{id:"position",name:"Position",holding:"weeks to months",entryTimeframe:"4H",lookbackBars:260,majorSwingAtr:2,minimumObjectiveAtr:1.5},
    "1W":{id:"macro",name:"Macro",holding:"months and longer",entryTimeframe:"1Dutc",lookbackBars:520,majorSwingAtr:3,minimumObjectiveAtr:1.5},
  } as const;
  return profiles[frame as keyof typeof profiles]??null;
}
export function globalStrategyName(report:GlobalReport){return report.strategy?.name??globalStrategyProfile(report.snapshot.timeframe)?.name??"Structure";}
export function globalStrategyLines(report:GlobalReport):string[]{
  const s=report.strategy;if(!s)return [];
  const zh=report.lang==="zh",price=(id:string)=>report.levels.find(l=>l.id===id)?.price.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision})??"—";
  if(report.discretionaryPlan){const p=report.discretionaryPlan;return [`${s.name.toUpperCase()} · ${globalFrameReference(report.snapshot.timeframe)} · ${s.holding}`,`${zh?"所选策略":"Selected strategy"}: ${globalSetupFamilyName(p.family,report.lang)}`,`${globalFrameReference(p.objectiveTimeframe)} ${zh?"目标":"objectives"} · ${globalFrameReference(p.reference.timeframe)} ${zh?"入场执行研究":"entry execution study"}`];}
  if(report.setupSelection){
    const selected=report.setupSelection,names={trend_continuation:zh?"趋势延续":"Trend continuation",structural_reversal:zh?"结构恢复 / 反转":"Structural recovery / reversal",range_reaction:zh?"区间边界反应":"Range-edge reaction",none:zh?"尚无有效入场":"No validated entry"};
    return [`${s.name.toUpperCase()} · ${globalFrameReference(report.snapshot.timeframe)} · ${s.holding}`,`${zh?"所选策略":"Selected strategy"}: ${selected.rule==="structure_break"?(zh?"确认结构突破":"Confirmed structure break"):names[selected.rule]}`,...selected.evidence,...selected.limitations,zh?`${globalFrameReference(s.entryTimeframe)} 确认入场并确定交易 SL。`:`${globalFrameReference(s.entryTimeframe)} confirms entry and establishes the trade SL.`];
  }
  if(s.version==="horizon-v2")return [`${s.name.toUpperCase()} · ${globalFrameReference(report.snapshot.timeframe)} · ${s.holding}`,zh?`主图分析方向；${globalFrameReference(s.entryTimeframe)} 确认入场并确定实际止损。`:`${globalFrameReference(report.snapshot.timeframe)} frames the market; ${globalFrameReference(s.entryTimeframe)} confirms entry and establishes the trade SL.`];
  return [`${s.name.toUpperCase()} · ${globalFrameReference(report.snapshot.timeframe)} · ${s.holding}`,
    zh?`主图周期决定结构、保护与目标；${globalFrameReference(s.entryTimeframe)} 仅用于入场时机。`:`${globalFrameReference(report.snapshot.timeframe)} determines structure, protection and objectives; ${globalFrameReference(s.entryTimeframe)} refines entry timing.`,
    ...s.routes.map(r=>`${r.side==="long"?"BUY":"SELL"} · ${r.objectiveIds.length?`${zh?"策略目标":"Strategy objectives"}: ${r.objectiveIds.map(price).join(" → ")}`:zh?"尚无有依据的本策略目标":"A supported objective for this strategy is not yet mapped"}${r.checkpointIds.length?` · ${zh?"沿途关口":"Intervening checkpoints"}: ${r.checkpointIds.map(price).join(" → ")}`:""}`),
    zh?"沿途关口与策略止盈分开。入场前须有到下一关口的收益空间；更远目标不会消除眼前阻力或支撑。":"Checkpoints are separate from strategy take-profits. Entry needs room before the next checkpoint; a farther objective does not remove that obstacle."];
}
export function globalStrategyRoute(report:GlobalReport,pathId:string,side:"long"|"short"){return report.strategy?.routes.find(r=>r.pathId===pathId&&r.side===side);}
