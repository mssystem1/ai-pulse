import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "./api";
import { AnalysisReport, PredictionAnalysisReport } from "./Report";
import type { JobRecoveryHandle, JobRecoveryScope } from "./jobRecovery";

/** Open the exact selected local handle, never the latest report in that scope. */
export function SavedResearchDialog({ handle, restoredReport, scope, onClose }: { handle?: JobRecoveryHandle; restoredReport?: Record<string,unknown>; scope: JobRecoveryScope; onClose: () => void }) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [report,setReport]=useState<Record<string,unknown>|null>(null);
  const [error,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{const focus=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";dialog.current?.showModal();return()=>{document.body.style.overflow=overflow;if(focus?.isConnected)focus.focus();};},[]);
  useEffect(()=>{
    if (restoredReport) { setReport(restoredReport); setError(""); return; }
    if (!handle) { setError("No saved report selected."); return; }
    const controller=new AbortController();let active=true;
    const timer=setTimeout(()=>controller.abort(),20_000);setReport(null);setError("");
    void fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(handle.jobId)}/report`,{signal:controller.signal,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",headers:{"PULSE-RECOVERY-TOKEN":handle.recoveryToken}}).then(async response=>{
      if(!response.ok)throw new Error(response.status===409?"This report is still processing. Retry this report without paying again.":response.status===403?"This saved report could not be authorized. Use wallet-owned report history to recover it; do not repurchase.":"This report is temporarily unavailable. Retry without paying again.");
      const body=await response.json() as {report?:Record<string,unknown>};
      if(!body.report||typeof body.report!=="object"||Array.isArray(body.report))throw new Error("The report response is incomplete. Retry without paying again.");
      if(active)setReport(body.report);
    }).catch(cause=>{if(active)setError(controller.signal.aborted?"Loading timed out. Retry this report without paying again.":cause.message);}).finally(()=>clearTimeout(timer));
    return()=>{active=false;controller.abort();clearTimeout(timer);};
  },[handle?.jobId,handle?.recoveryToken,restoredReport,attempt]);
  return createPortal(<dialog ref={dialog} className="saved-research-dialog" aria-label="Saved research report" onCancel={onClose}><header><div><small>{scope==="spot"?"GLOBAL MARKET":"PREDICTION MARKET"} · SAVED RESEARCH</small><h2>{handle?.label||"Your report"}</h2></div><button type="button" autoFocus aria-label="Close saved report" onClick={onClose}>×</button></header><p className="saved-research-note">Read-only. Opening this report does not create a payment or trade.</p>{error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry this report</button></div>:report?(scope==="spot"?<AnalysisReport data={report} nfa="Research, not financial advice. Scenarios are not guarantees."/>:<PredictionAnalysisReport data={report}/>):<p role="status">Opening your selected report…</p>}</dialog>,document.body);
}
