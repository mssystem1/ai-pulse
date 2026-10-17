import { GlobalAssessmentSchema, readGlobalReport, type GlobalAssessment, type GlobalOrderReview, type GlobalExecutionLevels } from "@pulse/domain";
import { API_BASE } from "./api";

/** Kept in view state only; never included in TXT, PNG or URL query strings. */
export type GlobalReportAccess={kind:"job"|"history";id:string;token:string}|{kind:"share";token:string};
export type GlobalAssessmentAccess=GlobalReportAccess|(()=>Promise<GlobalReportAccess|{assessment:GlobalAssessment}>);
export function withSetupAccess(report:Record<string,unknown>,access:GlobalReportAccess):Record<string,unknown>{
  return readGlobalReport(report)?{...report,_setupAccess:access}:report;
}
export async function recheckGlobalSetup(access:GlobalReportAccess,trade?:Record<string,unknown>):Promise<{assessment:GlobalAssessment;review?:GlobalOrderReview;executionLevels?:GlobalExecutionLevels}> {
  const response=await fetch(`${API_BASE}/v1/global/setup-assessment`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},cache:"no-store",referrerPolicy:"no-referrer",body:JSON.stringify({access,...(trade?{trade}:{})}),signal:AbortSignal.timeout(60_000)});
  const data=await response.json() as {assessment?:unknown;review?:GlobalOrderReview;executionLevels?:GlobalExecutionLevels;error?:string};
  if(!response.ok)throw new Error(data.error??"Setup recheck is unavailable. Your purchased report is unchanged.");
  return {assessment:GlobalAssessmentSchema.parse(data.assessment),review:data.review,executionLevels:data.executionLevels};
}
export function assessmentTitle(a:GlobalAssessment,zh=false):string {
  const side=a.side==="short"?zh?"卖出":"sell":zh?"买入":"buy";
  const direction=a.side==="short"?"SHORT / SELL":a.side==="long"?"LONG / BUY":zh?"入场研究":"ENTRY STUDY",tf=a.entryTimeframe??a.timeframe;
  const titles={no_trade:zh?`${direction} · ${a.blockers.includes("reward")?"需要更好的收益空间":"入场条件尚未完成"}`:`${direction} · ${a.blockers.includes("reward")?"Entry needs better reward":"Entry conditions incomplete"}`,invalidated:zh?`${direction} · 需要新的 ${tf} 测试`:`${direction} · New ${tf} test needed`,expired:zh?`${direction} · 更新 ${tf} 证据`:`${direction} · Refresh ${tf} evidence`,waiting_confirmation:zh?`${direction} · ${tf} 收盘确认条件`:`${direction} · ${tf} closing condition`,waiting_retest:zh?`${direction} · 需要后续 ${tf} ${a.family&&a.family!=="breakout_retest"?"顺势收盘":"回测"}`:`${direction} · Later ${tf} ${a.family&&a.family!=="breakout_retest"?"follow-through":"retest"} needed`,technical_valid:zh?`${direction} · 信号已确认 · 复核报价`:`${direction} · Signal confirmed · check quote`};
  return titles[a.state];
}
