import {Router,type RequestHandler} from "express";
import {createHash} from "node:crypto";
import {z} from "zod";
import {terminalSessionWindow,terminalToolsFromSession} from "@pulse/analysis";
import {terminalFrameProfile,type TerminalMarketTools} from "@pulse/domain";
import {candleTimeframeMs} from "@pulse/schemas";
import type {TerminalRuntime} from "./terminalRuntime.js";
import {createTerminalMarketHistory,type TerminalMarketHistory} from "./terminalMarketHistory.js";
import type {TerminalInspectionEvidence} from "./terminalAiContext.js";
const wrap=(fn:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const market=z.string().regex(/^[A-Z0-9]{2,20}-(USDT|USDC|USD)$/),stamp=z.coerce.number().int().nonnegative();
export function createTerminalHistoryRoutes(runtime:TerminalRuntime,getHistory:()=>TerminalMarketHistory=()=>createTerminalMarketHistory(runtime.cfg)){
 const router=Router();
 router.get("/v1/terminal/history/session",wrap(async(req,res)=>{
  const parsed=z.object({instId:market,timeframe:z.enum(["15m","1H","4H","1Dutc","1Wutc"]),session:z.enum(["day","previous-day","week","month","custom"]).default("day"),start:stamp.optional(),end:stamp.optional(),evidenceSnapshotId:z.string().regex(/^tes_[\da-f]{32}$/).optional()}).strict().safeParse(req.query);
  if(!parsed.success)return res.status(400).json({error:"Choose an exact market and a UTC session of at most 31 days",code:"terminal_history_window"});
  const input=parsed.data,now=runtime.now(),owner=res.locals.terminalOwner;let window;
  if((input.session==="custom")!==(input.start!==undefined&&input.end!==undefined)||input.session!=="custom"&&(input.start!==undefined||input.end!==undefined))return res.status(400).json({error:"Custom UTC ranges require both start and end; presets choose their own range"});
  try{window=terminalSessionWindow(input.session,now,input.start!==undefined&&input.end!==undefined?{start:input.start,end:input.end}:undefined);}catch(error){return res.status(400).json({error:error instanceof Error?error.message:"Invalid session window"});}
  if(!runtime.cfg.TERMINAL_HISTORY_ENABLED)return res.status(503).json({error:"Retained market history is disabled by the service",code:"terminal_history_disabled"});
  if(window.start<Math.floor(now/86400000)*86400000-runtime.cfg.TERMINAL_HISTORY_RETENTION_DAYS*86400000||window.end>Math.floor(now/60000)*60000)return res.status(400).json({error:"Choose a retained range ending at a completed UTC minute"});
  let base:TerminalInspectionEvidence|null=null;
  if(input.evidenceSnapshotId){base=await runtime.store.storage.read<TerminalInspectionEvidence>(runtime.store.key("evidence",`${owner}:${input.evidenceSnapshotId}`));if(!base||base.instId!==input.instId||base.timeframe!==input.timeframe)return res.status(409).json({error:"The reviewed tool capture expired or does not match this market. Refresh evidence and retry.",code:"terminal_history_evidence_expired"});}
  let history:TerminalMarketHistory;try{history=getHistory();}catch{return res.status(503).json({error:"Durable market-history storage is unavailable",code:"terminal_history_storage"});}
  try{
   await history.ensure({instId:input.instId,start:window.start,end:window.end});
   const frame=terminalFrameProfile(input.timeframe),request={instId:input.instId,start:window.start,end:window.end,barMs:candleTimeframeMs(frame.execution)};
   const [session,perpetualSession]=await Promise.all([history.readSession({...request,marketType:"spot"}),history.readSession({...request,marketType:"perpetual"})]);
   const spot=terminalToolsFromSession(session,input.timeframe),perpetual=terminalToolsFromSession(perpetualSession,input.timeframe),tools={...spot,perpetualFlow:{...perpetual.flow,id:"perpetual-flow",label:"Futures session flow"}};
   let evidenceSnapshotId:string|undefined,setupVersionId:string|undefined;
   if(base){
    const evidence:TerminalInspectionEvidence={...base,observedAt:now,tools:{...base.tools,...tools} as TerminalMarketTools};setupVersionId=base.setupVersionId;evidenceSnapshotId="tes_"+createHash("sha256").update(JSON.stringify(evidence)).digest("hex").slice(0,32);await runtime.store.storage.write(runtime.store.key("evidence",`${owner}:${evidenceSnapshotId}`),evidence,3600);
   }
   return res.json({window,session,perpetualSession,tools,evidenceSnapshotId,setupVersionId,observedAt:now});
  }catch{return res.status(503).json({error:"Retained session history could not be verified. Existing report prices are unchanged.",code:"terminal_history_unavailable"});}
 }));
 router.get("/v1/terminal/history/liquidity",wrap(async(req,res)=>{
  const parsed=z.object({instId:market,hours:z.coerce.number().refine(v=>[1,6,24,168].includes(v)).default(1),start:stamp.optional(),end:stamp.optional()}).strict().safeParse(req.query);
  if(!parsed.success)return res.status(400).json({error:"Choose 1h, 6h, 24h or 7d of retained liquidity",code:"terminal_liquidity_window"});
  if(!runtime.cfg.TERMINAL_HISTORY_ENABLED)return res.status(503).json({error:"Retained market history is disabled",code:"terminal_history_disabled"});
  const {instId,hours}=parsed.data,end=parsed.data.end??Math.floor(runtime.now()/60000)*60000,start=parsed.data.start??end-hours*3600000;
  if(end<=start||end>runtime.now()||start%60000||end%60000)return res.status(400).json({error:"Choose an ordered UTC range ending at a completed minute"});
  if(start<Math.floor(runtime.now()/86400000)*86400000-runtime.cfg.TERMINAL_HISTORY_BOOK_RETENTION_DAYS*86400000)return res.status(400).json({error:"Requested book observations are outside configured retention"});
  if(end-start>runtime.cfg.TERMINAL_HISTORY_BOOK_RETENTION_DAYS*86400000)return res.status(400).json({error:"Requested book history exceeds configured retention"});
  try{const history=getHistory();await history.ensure({instId,start,end});return res.json(await history.readLiquidity({instId,start,end,maxSamples:720}));}
  catch{return res.status(503).json({error:"Retained order-book history is unavailable; a current snapshot is not a substitute",code:"terminal_liquidity_history_unavailable"});}
 }));
 router.post("/v1/terminal/history/collect",wrap(async(req,res)=>{
  const parsed=z.object({instId:market}).strict().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Choose the market to collect"});
  if(!runtime.cfg.TERMINAL_HISTORY_ENABLED)return res.status(503).json({error:"Retained market history is disabled"});
  try{return res.json(await getHistory().collect({instId:parsed.data.instId,maxWorkMs:runtime.cfg.TERMINAL_HISTORY_WORK_MS,maxPages:runtime.cfg.TERMINAL_HISTORY_PAGES_PER_BATCH,maxJobs:4}));}
  catch{return res.status(503).json({error:"Market collection could not complete. Retained checkpoints are preserved for retry."});}
 }));return router;
}
