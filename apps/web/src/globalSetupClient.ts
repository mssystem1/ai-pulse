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
  const titles={no_trade:zh?"不交易":"NO TRADE",invalidated:zh?"已失效":"INVALIDATED",expired:zh?"已过期":"EXPIRED",waiting_confirmation:zh?"等待完成确认":"WAIT · completed confirmation",waiting_retest:zh?"等待后续回测":"WAIT · subsequent retest",technical_valid:zh?"技术条件有效 · 检查报价":"TECHNICAL SETUP VALID · check quote"};
  return titles[a.state];
}
