import { useEffect, useState } from "react";
import { globalPrice, type GlobalReport, type GlobalAssessment } from "@pulse/domain";
import { assessmentTitle, recheckGlobalSetup, type GlobalAssessmentAccess, type GlobalReportAccess } from "./globalSetupClient";
import type { ReportTradeIntent } from "./Report";

export function GlobalSetupAssessment({report,access,onTrade}:{report:GlobalReport;access?:GlobalAssessmentAccess;onTrade?:(intent:ReportTradeIntent)=>void}) {
  const [assessment,setAssessment]=useState<GlobalAssessment|null>(null),[resolved,setResolved]=useState<GlobalReportAccess|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{setAssessment(null);setResolved(null);setError("");},[report]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const zh=report.lang==="zh",fresh=assessment&&now-Date.parse(assessment.assessedAt)<60_000&&assessment.expiresAt!==null&&now<assessment.expiresAt;
  const recheck=async()=>{
    if(!access||busy)return;setBusy(true);setError("");
    try{const capability=typeof access==="function"?await access():access;
      if("assessment" in capability){setResolved(null);setAssessment(capability.assessment);}else{const result=await recheckGlobalSetup(capability);setResolved(capability);setAssessment(result.assessment);}setNow(Date.now());}
    catch(reason){setError(reason instanceof Error?reason.message:"Recheck failed");}finally{setBusy(false);}
  };
  const open=(orderType:"market"|"limit")=>{
    if(!assessment||!fresh||assessment.side!=="long"||assessment.state!=="technical_valid"||!assessment.permittedEntry||assessment.observedStop===null||!resolved)return;
    const reference=assessment.lastCompletedClose,entry=reference!==null&&reference>=assessment.permittedEntry[0]&&reference<=assessment.permittedEntry[1]?reference:assessment.permittedEntry[0];
    onTrade?.({pair:report.snapshot.instId,timeframe:report.snapshot.timeframe,side:"buy",orderType,entryPrice:entry,observedPrice:assessment.lastCompletedClose??undefined,takeProfit:assessment.targets[0],stopLoss:assessment.observedStop,sourceTier:report.tier,reportSetupMode:"assessment",reportAccess:resolved,assessment,rationale:"Fresh completed entry signal and observed structural protection. Choose an amount and check the current route, balance and modeled net reward before order review."});
  };
  return <section className="global-fresh-assessment" data-assessment-state={assessment?.state??"not_checked"}>
    <h3>{zh?"下一步 · 重新检查交易条件":"Your next step · recheck setup"}</h3>
    <p>{zh?"原报告不会随时间自动更新。此操作只检查新完成的 K 线，不收取新报告费用，也不下单。":"The purchased snapshot does not update with time. Recheck uses new completed candles, requires no new report payment and places no order."}</p>
    <button disabled={!access||busy} onClick={()=>void recheck()}>{busy?(zh?"正在检查…":"Checking completed candles…"):(zh?"重新检查条件":"Recheck setup")}</button>
    {!access&&<p>{zh?"请通过已购报告历史或原始分享链接打开，以便验证访问权限。":"Open this report through paid report history or its original share link to authorize a recheck."}</p>}
    {error&&<p role="alert">{error}</p>}
    {assessment&&<><h4>{assessmentTitle(assessment,zh)}</h4><p>{zh?"独立评估":"Separate assessment"} · {assessment.assessedAt} · #{assessment.sourceRef}</p>{assessment.lines.map((line,i)=><p key={i}>{line}</p>)}
      {assessment.permittedEntry&&assessment.observedStop!==null&&<><p>{zh?"信号已观察 · 允许入场范围":"Signal observed · permitted entry range"}: {assessment.permittedEntry.map(n=>globalPrice(report,n)).join("–")} · SL {globalPrice(report,assessment.observedStop)} · TP1 {globalPrice(report,assessment.targets[0])}</p><p>{zh?"最不利允许入场价至止损距离":"Stop distance at the least favorable permitted entry"}: {assessment.stopDistancePercent?.toFixed(2)}% · {assessment.stopDistanceAtr?.toFixed(2)} × {assessment.entryTimeframe??assessment.timeframe} ATR14</p></>}
      {assessment.state==="technical_valid"&&!fresh&&<p role="status">{zh?"评估已过期；请重新检查。":"Assessment is stale; recheck before continuing."}</p>}
      {onTrade&&resolved&&assessment.state==="technical_valid"&&assessment.side==="long"&&<div className="global-trade-actions">{(["market","limit"] as const).map(type=><button key={type} disabled={!fresh} onClick={()=>open(type)}>{zh?`检查 ${type} 报价`:`Check ${type==="market"?"Market":"Limit"} quote with observed TP/SL`}</button>)}</div>}
    </>}
  </section>;
}
