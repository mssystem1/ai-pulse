import type {GlobalAssessmentAccess} from "./globalSetupClient";
export type ReportExportAccess=GlobalAssessmentAccess|{kind:"telegram";id:string;token:string;surface:"pulse"|"ton"};
export type TelegramDownloads={initData?:string;isVersionAtLeast?:(version:string)=>boolean;downloadFile?:(params:{url:string;file_name:string},callback?:(accepted:boolean)=>void)=>void;openLink?:(url:string,options?:{try_instant_view:boolean})=>void};
export function telegramDownloads():TelegramDownloads|undefined{
  if(typeof window==="undefined")return;
  const app=(window as unknown as {Telegram?:{WebApp?:TelegramDownloads}}).Telegram?.WebApp;
  return app?.initData?app:undefined;
}
export function requestTelegramDownload(app:TelegramDownloads|undefined,url:string,filename:string,callback:(accepted:boolean)=>void){
  if(!url.startsWith("https://")||!app?.downloadFile||app.isVersionAtLeast?.("8.0")===false)return false;
  app.downloadFile({url,file_name:filename},callback);return true;
}
export function canShareReport(file:File,nav:Partial<Pick<Navigator,"share"|"canShare">>=navigator){
  try{return Boolean(nav.share&&nav.canShare?.({files:[file]}));}catch{return false;}
}
type ReportSaveNavigator=Partial<Pick<Navigator,"userAgent"|"platform"|"maxTouchPoints"|"share"|"canShare">>&{userAgentData?:{mobile?:boolean}};
/** Mobile browsers may need their native sheet to save a prepared local file.
 * Desktop Web Share support (including touchscreen PCs) must never turn Save
 * into Share. The separate Share button remains available on either platform. */
export function shouldShareReportOnSave(file:File,nav:ReportSaveNavigator=navigator){
  const mobile=Boolean(nav.userAgentData?.mobile)||/Android|iPhone|iPad|iPod/i.test(nav.userAgent??"")||(nav.platform==="MacIntel"&&(nav.maxTouchPoints??0)>1);
  return mobile&&canShareReport(file,nav);
}
/** Invoke directly from the final Save/Share click, after preparation. */
export function shareReport(file:File,nav:Partial<Pick<Navigator,"share"|"canShare">>=navigator){
  if(typeof nav.share!=="function"||!canShareReport(file,nav))throw new Error("File sharing is unavailable in this browser");
  return nav.share({files:[file],title:file.name});
}
export function saveReportLink(url:string,filename:string){
  const link=document.createElement("a");link.href=url;link.download=filename;link.target="_blank";link.rel="noopener noreferrer";link.referrerPolicy="no-referrer";
  document.body.appendChild(link);link.click();link.remove();
}
export function releaseReportPreview(url:string){setTimeout(()=>URL.revokeObjectURL(url),60_000);}
