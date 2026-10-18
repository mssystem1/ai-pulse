import {useEffect,useRef,useState} from "react";
import {reportProgressModel,reportSteps,reportStageLabel,type ReportProgressState} from "./reportProgress";
import "./reportProgress.css";

export function PaidReportProgress({job,lang,onRecover,recovering,error}:{job:ReportProgressState;lang:"en"|"zh";onRecover:()=>void;recovering:boolean;error:string|null}) {
  const [now,setNow]=useState(Date.now),activeRef=useRef<HTMLLIElement>(null),listRef=useRef<HTMLOListElement>(null);
  const model=reportProgressModel(job,now),zh=lang==="zh";
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const list=listRef.current,row=activeRef.current;if(!list||!row)return;
    const rowBox=row.getBoundingClientRect(),listBox=list.getBoundingClientRect();
    list.scrollTo({top:Math.max(0,list.scrollTop+rowBox.top-listBox.top-list.clientHeight/2+rowBox.height/2),behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
  },[model.active]);
  const duration=(seconds:number)=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
  return <section className="paid-report-progress" aria-label={zh?"报告生成进度":"Report generation progress"}>
    <div className="report-progress-heading"><span className="report-progress-beacon" aria-hidden="true"/><div><small>{model.resuming?(zh?"正在恢复已付款的报告":"Resuming your paid report"):(zh?"已付款的报告":"Your paid report")}</small><h3 role="status">{reportStageLabel(job.stage,lang)}</h3></div></div>
    <div className="report-progress-track" aria-hidden="true"><i/></div>
    <ol ref={listRef}>{reportSteps.map((step,index)=><li key={step.en} ref={index===model.active?activeRef:undefined} data-state={index===model.active?"active":index<model.active?"done":"pending"} aria-current={index===model.active?"step":undefined}><span aria-hidden="true">{index<model.active?"✓":index+1}</span><div>{step[lang]}{index===model.active&&<small>{zh?"当前步骤":"Current step"}</small>}</div>{index===model.active&&<i className="report-progress-dots" aria-hidden="true"><b/><b/><b/></i>}</li>)}</ol>
    <div className="report-progress-timing"><span>{zh?"已用时间":"Elapsed"} <b>{duration(model.elapsed)}</b></span><span>{zh?"本步骤":"This step"} <b>{duration(model.inStage)}</b></span></div>
    <p>{model.slow?(zh?"此步骤耗时较长。付款凭据已保存；可免费恢复。":"This step is taking longer than usual. Your payment receipt is saved; recovery is free."):(zh?"完成后报告会自动打开。无需再次付款。":"Your report opens automatically when ready. No further payment is needed.")}</p>
    <small className="report-progress-check">{job.lastCheckedAt?(zh?`最近检查：${new Date(job.lastCheckedAt).toLocaleTimeString()}`:`Last checked: ${new Date(job.lastCheckedAt).toLocaleTimeString()}`):(zh?"正在连接报告服务…":"Connecting to report service…")}</small>
    {error&&<p className="recovery-error" role="status">{error}</p>}
    <button type="button" className="btn btn-soft" disabled={recovering} onClick={onRecover}>{recovering?(zh?"正在恢复…":"Recovering…"):(zh?"免费恢复报告":"Recover report · no payment")}</button>
  </section>;
}
