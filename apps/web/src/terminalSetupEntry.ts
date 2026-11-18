import {globalSetupAdmission, type GlobalSetupAdmission} from "@pulse/domain";
import type {GlobalReport} from "@pulse/schemas";

export type TerminalSetupEntryState="qualified"|"unqualified"|"expired";
export type TerminalSetupEntryNotice={
  state:TerminalSetupEntryState;
  admission:GlobalSetupAdmission;
  entry:{lower:number;upper:number};
  quote:{price:number;ts:number;fresh:boolean}|null;
  distancePercent:number|null;
  direction:"below"|"above"|"inside"|null;
  executionMode:"passive_limit"|"confirmed_retest"|"unspecified";
  eventTimeframe:string;
  objectiveTimeframe:string;
  expiresAt:number|null;
  title:string;
  lines:string[];
};

type Options={now?:number;quote?:{price:number;ts:number}|null};
const endedStates=new Set(["expired","invalidated","completed","entry_observed"]);

/** Describe a saved setup as a conditional plan, using the same admission gate
 * the trade card uses. The quote is context; distance never promotes an entry. */
export function terminalSetupEntryNotice(report:GlobalReport,options:Options={}):TerminalSetupEntryNotice|null{
  const plan=report.discretionaryPlan;if(!plan)return null;
  const now=options.now??Date.now(),admission=globalSetupAdmission(report),policy=plan.executionPolicy;
  const savedQuote=report.currentMarket?.quote,quote=options.quote===undefined?(savedQuote?{price:savedQuote.price,ts:savedQuote.ts}:null):options.quote;
  const fresh=Boolean(quote&&Number.isFinite(quote.price)&&quote.price>0&&Number.isFinite(quote.ts)&&quote.ts<=now+5000&&now-quote.ts<=30000);
  const usableQuote=quote&&Number.isFinite(quote.price)&&quote.price>0?{...quote,fresh}:null;
  const entry=plan.priceZones?.entry??{lower:plan.entry,upper:plan.entry};
  const direction:TerminalSetupEntryNotice["direction"]=usableQuote?usableQuote.price<entry.lower?"below":usableQuote.price>entry.upper?"above":"inside":null;
  const edge=direction==="below"?entry.lower:direction==="above"?entry.upper:null;
  const distancePercent=edge!==null&&usableQuote?(Math.abs(edge-usableQuote.price)/usableQuote.price)*100:direction==="inside"?0:null;
  const expiresAt=policy?.expiresAt??report.scenario?.expiresAt??null;
  const expired=report.scenario?.state==="expired"||Boolean(expiresAt!==null&&now>=expiresAt);
  const state:TerminalSetupEntryState=expired?"expired":endedStates.has(report.scenario?.state??"")||!admission.geometryEligible?"unqualified":"qualified";
  const executionMode=policy?.mode??"unspecified",eventTimeframe=policy?.eventTimeframe??plan.reference.timeframe,objectiveTimeframe=plan.objectiveTimeframe;
  const zh=report.lang==="zh",fmt=(n:number)=>n.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:Math.min(2,report.snapshot.pricePrecision),maximumFractionDigits:report.snapshot.pricePrecision});
  const band=entry.lower===entry.upper?fmt(entry.lower):`${fmt(entry.lower)}–${fmt(entry.upper)}`;
  const title=state==="qualified"&&executionMode==="passive_limit"?(zh?"可准备被动限价计划":"Passive limit ready for preparation"):
    state==="expired"?(zh?"入场计划已过期":"Expired · do not reuse this entry plan"):
    state==="unqualified"?(zh?"当前计划未通过入场资格":"Unqualified · no new entry from this plan"):
    (zh?"有条件的入场计划":"Qualified geometry · conditional entry only");
  const lines:string[]=[];
  if(state==="unqualified")lines.push(...admission.reasons);
  if(state==="expired")lines.push(zh?"计划的执行窗口已结束；这些价格仅供复核。":"The execution window has ended; saved prices are for review only.");
  lines.push(zh?`Entry 区间 ${band}；此计划属于 ${report.snapshot.timeframe}，目标依据周期为 ${objectiveTimeframe}。`:`Entry zone ${band}. This is a ${report.snapshot.timeframe} setup with ${objectiveTimeframe} objectives.`);
  if(usableQuote){
    const label=fresh?(zh?"最新报价":"Latest quote"):(zh?"快照报价":"Quote at snapshot");
    if(direction==="inside")lines.push(`${label} ${fmt(usableQuote.price)} ${zh?"位于 Entry 区间内":"is inside the entry zone"}. ${zh?"仍须满足计划中的入场条件；不代表成交。":"The saved execution policy still applies; this does not imply a fill."}`);
    else if(direction&&edge!==null)lines.push(zh?`${label} ${fmt(usableQuote.price)}；Entry 区间在其${direction==="below"?"上方":"下方"} ${distancePercent!.toFixed(2)}%。这只描述价格距离，不预测价格会回到该区间。`:`${label} ${fmt(usableQuote.price)}; the entry zone is ${distancePercent!.toFixed(2)}% ${direction==="below"?"above":"below"} it. This is a price gap, not a prediction that price will return.`);
    if(!fresh)lines.push(zh?"该报价不是实时新报价。":"This quote is not fresh.");
  }else lines.push(zh?"没有可用报价，无法计算 Entry 距离。":"No usable quote is available to measure distance to Entry.");
  if(executionMode==="passive_limit")lines.push(zh?`执行方式：${eventTimeframe} 条件限价区间；仍须满足上方列出的入场条件，限价触及不代表已成交。`:`${state==="qualified"?"Execution policy":"Saved policy for review"}: passive limit at the saved entry price. No extra candle confirmation is required. A limit touch does not confirm a venue fill.`);
  else if(executionMode==="confirmed_retest")lines.push(zh?`执行方式：须按 ${eventTimeframe} 回测确认后再评估入场。`:`${state==="qualified"?"Execution policy":"Saved policy for review"}: wait for the stated ${eventTimeframe} retest confirmation before reassessing entry.`);
  else lines.push(zh?"执行确认方式未记录；仅按已列条件复核。":"Execution mode is not recorded; follow only the conditions stated in the saved plan.");
  lines.push(zh?"此计划不是即时下单指令，不表示价格必然回到 Entry，也不代表成交。":"This is not an immediate order instruction. The plan does not predict a return to Entry, and no fill is implied.");
  return {state,admission,entry,quote:usableQuote,distancePercent,direction,executionMode,eventTimeframe,objectiveTimeframe,expiresAt,title,lines};
}
