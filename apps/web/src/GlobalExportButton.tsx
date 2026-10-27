import {useEffect,useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {globalArtifactTag,presentResearch,researchText,type GlobalReport,type GlobalChartOptions,type GlobalChartAppearance} from "@pulse/domain";
import {API_BASE} from "./api";
import type {ReportExportAccess} from "./reportDownload";
import {createGlobalChartFile} from "./globalChartDownload";
import {canShareReport,shareReport,saveReportLink,releaseReportPreview,telegramDownloads,requestTelegramDownload} from "./reportDownload";

type Prepared={file:File;preview:string;url?:string;expiresAt?:number;text?:string;note?:string};
export function GlobalExportButton({report,access,format,options,appearance="dark"}:{report:GlobalReport;access?:ReportExportAccess;format:"png"|"txt";options?:GlobalChartOptions;appearance?:GlobalChartAppearance}){
  const [open,setOpen]=useState(false),[prepared,setPrepared]=useState<Prepared|null>(null),[error,setError]=useState(""),[status,setStatus]=useState("");
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId(),zh=report.lang==="zh";
  const key=JSON.stringify([globalArtifactTag(report),report.lang,format,appearance,options,Boolean(report.targetReviewOf)]);
  const tr=(en:string,cn:string)=>zh?cn:en;
  useEffect(()=>{if(!open)return;dialog.current?.showModal();return()=>{dialog.current?.close();trigger.current?.focus();};},[open]);
  useEffect(()=>{
    if(!open)return;const controller=new AbortController(),signal=controller.signal;let preview:string|undefined;
    setPrepared(null);setError("");setStatus("");
    void(async()=>{
      try{
        const filename=`PULSE-Global-${report.tier}-${report.snapshot.instId}-${report.snapshot.timeframe}-${globalArtifactTag(report)}.${format}`;
        let file:File|undefined,url:string|undefined,expiresAt:number|undefined,note:string|undefined;
        // Assessment callbacks may sign or fetch fresh market data. Export only
        // an existing capability; otherwise prepare this saved report locally.
        const resolved=typeof access==="function"?undefined:access;
        if(resolved&&"kind" in resolved){
          const download=new AbortController(),cancel=()=>download.abort();
          signal.addEventListener("abort",cancel,{once:true});if(signal.aborted)cancel();
          const deadline=setTimeout(cancel,30_000);
          try{
            const exportPath=resolved.kind==="telegram"?`/v1/telegram${resolved.surface==="ton"?"/ton":""}/global-export`:"/v1/global/export";
            const response=await fetch(`${API_BASE}${exportPath}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access:resolved,format,appearance,lang:report.lang,review:Boolean(report.targetReviewOf),options}),cache:"no-store",referrerPolicy:"no-referrer",signal:download.signal});
            const ticket=await response.json();if(!response.ok)throw Error(ticket.error||"Download is unavailable");
            const api=new URL(API_BASE||window.location.origin,window.location.origin),parsed=new URL(ticket.path??ticket.url,api);
            if(parsed.origin!==api.origin||!/^https?:$/.test(parsed.protocol)||!/^\/v1\/(?:global\/export|telegram\/(?:ton\/)?global-export)\/file\//.test(parsed.pathname))throw Error("Unexpected download address");
            url=parsed.href;expiresAt=ticket.expiresAt;
            const image=await fetch(url,{cache:"no-store",referrerPolicy:"no-referrer",signal:download.signal});if(!image.ok)throw Error("The download could not be prepared");
            file=new File([await image.blob()],ticket.filename,{type:format==="png"?"image/png":"text/plain"});
          }catch(e){if(signal.aborted)throw e;url=undefined;note=tr("Secure download is unavailable. Use Share or save the preview.","安全下载暂不可用。请使用分享或保存预览。");}
          finally{clearTimeout(deadline);signal.removeEventListener("abort",cancel);}
        }
        if(!file)file=format==="png"?await createGlobalChartFile(report,options?.layers??{},options,appearance,signal):new File([researchText(presentResearch({global:report}))],filename,{type:"text/plain"});
        const text=format==="txt"?await file.text():undefined;if(signal.aborted)return;
        preview=URL.createObjectURL(file);setPrepared({file,preview,url,expiresAt,text,note});
      }catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:tr("Export failed. Try again.","导出失败，请重试。"));}
    })();
    return()=>{controller.abort();if(preview)releaseReportPreview(preview);};
  },[open,key]);
  const save=()=>{
    if(!prepared)return;setError("");
    if(prepared.expiresAt&&prepared.expiresAt<=Date.now()){setError(tr("This link expired. Close and reopen Download.","链接已过期。请关闭后重新打开下载。"));return;}
    const app=telegramDownloads();
    try{
      if(prepared.url&&requestTelegramDownload(app,prepared.url,prepared.file.name,accepted=>setStatus(accepted?tr("Download requested.","已请求下载。"):tr("Download canceled. You can try again.","下载已取消，可重试。"))))return;
      if(prepared.url&&app?.openLink){app.openLink(prepared.url,{try_instant_view:false});setStatus(tr("Opened in your browser. Save the file there.","已在浏览器中打开，请保存文件。"));return;}
      if(canShareReport(prepared.file)&&(!prepared.url||window.matchMedia("(pointer:coarse)").matches)){void share();return;}
      saveReportLink(prepared.preview,prepared.file.name);setStatus(tr("Download requested. You can also save or share the preview.","已请求下载。也可保存或分享预览。"));
    }catch{setError(tr("Use Share, or open the file in your browser.","请使用分享，或在浏览器打开文件。"));}
  };
  const share=async()=>{if(!prepared)return;setError("");try{await shareReport(prepared.file);setStatus(tr("File shared.","文件已分享。"));}catch(e){setStatus("");if(!(e instanceof DOMException&&e.name==="AbortError"))setError(tr("Sharing is unavailable. Use Save file or the preview.","分享不可用，请保存文件或使用预览。"));}};
  return <><button className="global-export-button" ref={trigger} data-global-export={format} onClick={()=>setOpen(true)}><svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4"/></svg><span>{format==="png"?tr("Download chart PNG","下载原图 PNG"):tr("Download report TXT","下载报告 TXT")}</span></button>{open&&createPortal(<dialog className="report-download-dialog" ref={dialog} aria-labelledby={id} onCancel={()=>setOpen(false)}>
    <div className="report-download-heading"><h2 id={id}>{format==="png"?tr("Save chart image","保存图表图片"):tr("Save report text","保存报告文本")}</h2><button onClick={()=>setOpen(false)}>{tr("Close","关闭")}</button></div>
    {!prepared&&!error&&<p role="status">{tr("Preparing your file…","正在准备文件…")}</p>}
    {prepared&&<><p className="report-download-filename">{prepared.file.name}</p><div className="report-download-actions"><button onClick={save} data-save-report>{tr("Save file","保存文件")}</button>{canShareReport(prepared.file)&&<button onClick={()=>void share()}>{tr("Share / Save to Files","分享 / 存储到文件")}</button>}{prepared.url&&<a href={prepared.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{tr("Open in browser","在浏览器打开")}</a>}</div>
    <p>{format==="png"?tr("On iPhone or Android, use Save/Share, or touch and hold the image to save it.","在iPhone或Android上可使用保存/分享，或长按图片保存。"):tr("Use Save/Share to keep the TXT file. The full text is also selectable below.","使用保存/分享存储TXT文件，也可选择下方完整文本。")}</p>
    {prepared.note&&<p role="status">{prepared.note}</p>}{format==="png"?<div className="report-download-preview"><img src={prepared.preview} alt={tr("Original report image preview","原始报告图片预览")}/></div>:<textarea readOnly aria-label={tr("Full report text","完整报告文本")} value={prepared.text} onFocus={event=>event.currentTarget.select()}/>}</>}
    {status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}
  </dialog>,document.body)}</>;
}
