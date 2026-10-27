import {themeGlobalChartSvg,type GlobalChartAppearance} from "./globalChartTheme";
import {globalArtifactTag,globalReportChartSvg,globalChartRasterSize,type GlobalReport,type GlobalChartOptions,type GlobalChartLayers} from "@pulse/domain";
export async function createGlobalChartFile(report:GlobalReport,layers:GlobalChartLayers,options:GlobalChartOptions={},appearance:GlobalChartAppearance="dark",signal?:AbortSignal):Promise<File>{
 const raw=globalReportChartSvg(report,{...options,layers});if(!raw)throw Error("This report has no chart to export");
 const url=URL.createObjectURL(new Blob([themeGlobalChartSvg(raw,appearance)],{type:"image/svg+xml;charset=utf-8"}));
 try{return await new Promise<File>((resolve,reject)=>{
  const image=new Image();
  const finish=(file?:File,error?:unknown)=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);image.onload=null;image.onerror=null;error?reject(error):resolve(file!);};
  const abort=()=>finish(undefined,new DOMException("Export canceled","AbortError"));
  const timer=setTimeout(()=>finish(undefined,new Error("Image preparation timed out. Try again.")),30_000);
  if(signal?.aborted){abort();return;}signal?.addEventListener("abort",abort,{once:true});
  image.onload=()=>{try{
   const size=globalChartRasterSize(image.naturalWidth||image.width,image.naturalHeight||image.height),canvas=document.createElement("canvas");canvas.width=size.width;canvas.height=size.height;
   const context=canvas.getContext("2d");if(!context)throw Error("Image saving is unavailable. Use the secure download instead.");
   context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";context.drawImage(image,0,0,canvas.width,canvas.height);
   canvas.toBlob(blob=>{canvas.width=0;canvas.height=0;if(signal?.aborted)return abort();if(!blob)return finish(undefined,new Error("The image could not be prepared. Try the secure download."));finish(new File([blob],"PULSE-Global-"+report.tier+"-"+report.snapshot.instId+"-"+report.snapshot.timeframe+"-"+globalArtifactTag(report)+".png",{type:"image/png"}));},"image/png");
  }catch(error){finish(undefined,error);}};
  image.onerror=()=>finish(undefined,new Error("The chart image could not be loaded. Try again."));image.src=url;
 });}finally{URL.revokeObjectURL(url);}
}
