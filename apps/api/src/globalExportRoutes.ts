import {Router,type Request} from "express";
import {z} from "zod";
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import type {AppConfig} from "@pulse/config";
import {readGlobalReport,globalArtifactTag,globalReportChartSvg,themeGlobalChartSvg,presentResearch,researchText} from "@pulse/domain";
import {reviewGlobalTargetReport} from "@pulse/analysis";
import {GlobalAccessSchema} from "./globalReportAccess.js";
import {asyncRoute} from "./httpResilience.js";
import {renderResearchPng} from "./researchPng.js";

const flag=z.boolean().optional();
const Layers=z.object({studyScale:z.enum(["setup","context"]).optional(),allSmas:flag,sma:flag,ema:flag,vwapBands:flag,range:flag,volumeProfile:flag,footprint:flag,waves:flag,regression:flag,fibonacci:flag,vwap:flag,pivots:flag,atr:flag,channel:flag,localChannel:flag,channelMid:flag}).strict();
const ExportAccess=z.union([GlobalAccessSchema,z.object({kind:z.literal("telegram"),id:z.string().min(1).max(200),token:z.string().min(1).max(16384),surface:z.enum(["pulse","ton"])}).strict()]);
const ExportRequest=z.object({access:ExportAccess,format:z.enum(["png","txt"]),appearance:z.enum(["light","dark"]).default("dark"),lang:z.enum(["en","zh"]),review:z.boolean().default(false),options:z.object({layers:Layers.optional(),selectedPathId:z.string().max(150).nullable().optional(),structure:z.boolean().optional(),fullHistory:z.boolean().optional(),fitFibonacci:z.boolean().optional()}).strict().optional()}).strict();
const Ticket=z.object({purpose:z.literal("global-export-v1"),expiresAt:z.number().int().positive(),request:ExportRequest}).strict();
type Resolve=(access:z.infer<typeof ExportAccess>,req:Request)=>Promise<unknown>;

/** Short-lived encrypted download capabilities. Original access never enters
 * a URL, file, log or public share; download rechecks its existing authority. */
export function createGlobalExportRouter(cfg:AppConfig,deps:{resolveReport:Resolve;now?:()=>number;path?:string}){
  const router=Router(),now=deps.now??Date.now,path=deps.path??"/v1/global/export";
  const secret=cfg.REPORT_ENCRYPTION_KEY||randomBytes(32).toString("base64url");
  const key=createHash("sha256").update("pulse-global-export-v1:"+secret).digest();
  const seal=(payload:z.infer<typeof Ticket>)=>{const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from(path));const body=Buffer.concat([cipher.update(JSON.stringify(payload),"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString("base64url");};
  const open=(token:string)=>{if(!/^[\w-]{64,24000}$/.test(token))throw Error("Invalid export");const data=Buffer.from(token,"base64url"),decipher=createDecipheriv("aes-256-gcm",key,data.subarray(0,12));decipher.setAAD(Buffer.from(path));decipher.setAuthTag(data.subarray(12,28));return Ticket.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8")));};
  router.use(path,(_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Content-Type-Options","nosniff");next();});
  const resolve=async(input:z.infer<typeof ExportRequest>,req:Request)=>{
    const original=readGlobalReport(await deps.resolveReport(input.access,req));if(!original)return null;
    const report=input.review?reviewGlobalTargetReport(original):original;return {...report,lang:input.lang};
  };
  router.post(path,asyncRoute(async(req,res)=>{
    const parsed=ExportRequest.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Valid report access and export options are required"});
    const report=await resolve(parsed.data,req);if(!report)return res.status(404).json({error:"An accessible saved Global report is required"});
    const expiresAt=now()+5*60_000,token=seal({purpose:"global-export-v1",expiresAt,request:parsed.data});
    const filename=`PULSE-Global-${report.tier}-${report.snapshot.instId}-${report.snapshot.timeframe}-${globalArtifactTag(report)}.${parsed.data.format}`;
    return res.json({path:`${path}/file/${token}`,url:`${cfg.BASE_URL.replace(/\/$/,"")}${path}/file/${token}`,filename,expiresAt,paymentRequired:false,modelCalls:0});
  }));
  router.get(`${path}/file/:ticket`,asyncRoute(async(req,res)=>{
    if(!req.get("Origin")||req.get("Origin")==="https://web.telegram.org"){res.setHeader("Access-Control-Allow-Origin","https://web.telegram.org");res.vary("Origin");}
    let ticket:z.infer<typeof Ticket>;try{ticket=open(String(req.params.ticket));}catch{return res.status(404).json({error:"This export link is unavailable"});}
    if(ticket.expiresAt<=now())return res.status(410).json({error:"This export link expired. Open Download again."});
    const input=ticket.request,report=await resolve(input,req);if(!report)return res.status(404).json({error:"This report is no longer accessible"});
    const filename=`PULSE-Global-${report.tier}-${report.snapshot.instId}-${report.snapshot.timeframe}-${globalArtifactTag(report)}.${input.format}`;
    let body:Buffer;
    if(input.format==="png"){
      const svg=globalReportChartSvg(report,input.options);if(!svg)return res.status(422).json({error:"This report has no chart to export"});
      body=Buffer.from(renderResearchPng(themeGlobalChartSvg(svg,input.appearance)));
    }else body=Buffer.from(researchText(presentResearch({global:report})),"utf8");
    res.setHeader("Content-Disposition",`attachment; filename="${filename.replace(/[^\w.-]/g,"-")}"`);
    res.setHeader("Content-Type",input.format==="png"?"image/png":"text/plain; charset=utf-8");
    return res.send(body);
  }));
  return router;
}
