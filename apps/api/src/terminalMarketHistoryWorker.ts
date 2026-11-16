import type {AppConfig} from "@pulse/config";
import {createTerminalMarketHistory} from "./terminalMarketHistory.js";

export async function runTerminalMarketHistoryCycle(cfg:AppConfig,options:{includeBooks?:boolean}={}){
 if(!cfg.FEATURE_TRADING_TERMINAL||!cfg.TERMINAL_HISTORY_ENABLED||cfg.TERMINAL_BACKGROUND_PAUSED)return{disabled:true};
 const history=createTerminalMarketHistory(cfg),backfill=async()=>{await history.ensureBackground();return history.collect({captureBooks:false,maxWorkMs:cfg.TERMINAL_HISTORY_WORK_MS,maxPages:cfg.TERMINAL_HISTORY_PAGES_PER_BATCH});};
 if(options.includeBooks===false)return backfill();
 // Cron/serverless invocations still collect live depth, concurrently with any
 // archive work. The long-lived worker gives each task its own timer below.
 const [retained,live]=await Promise.all([backfill(),history.collectLiveBooks({maxWorkMs:cfg.TERMINAL_HISTORY_WORK_MS})]);return{...retained,books:live.books};
}
export async function runTerminalLiveBookCycle(cfg:AppConfig){
 if(!cfg.FEATURE_TRADING_TERMINAL||!cfg.TERMINAL_HISTORY_ENABLED||cfg.TERMINAL_BACKGROUND_PAUSED)return{disabled:true};
 return createTerminalMarketHistory(cfg).collectLiveBooks({maxWorkMs:cfg.TERMINAL_HISTORY_WORK_MS});
}
type WorkerTasks={history:()=>Promise<unknown>;books:()=>Promise<unknown>};
export function startTerminalMarketHistoryWorker(cfg:AppConfig,tasks:WorkerTasks={history:()=>runTerminalMarketHistoryCycle(cfg,{includeBooks:false}),books:()=>runTerminalLiveBookCycle(cfg)}){
 // Public-data acquisition is independent of trading/Telegram automation and
 // never needs a browser to keep sending collection requests.
 if(!cfg.FEATURE_TRADING_TERMINAL||!cfg.TERMINAL_HISTORY_ENABLED||cfg.TERMINAL_BACKGROUND_PAUSED)return()=>{};
 let stopped=false;
 const loop=(task:()=>Promise<unknown>,label:string,interval:number)=>{
  let running=false,failures=0,retryAt=0;const tick=async()=>{if(stopped||running||Date.now()<retryAt)return;running=true;try{await task();failures=0;}catch{failures++;retryAt=Date.now()+Math.min(900000,interval*2**Math.min(failures,5));console.warn(`Terminal ${label} collector is unavailable; retained coverage stays explicit.`);}finally{running=false;}};
  void tick();const timer=setInterval(()=>void tick(),interval);timer.unref();return timer;
 };
 const books=loop(tasks.books,"live order-book",Math.max(cfg.TERMINAL_HISTORY_POLL_MS,cfg.TERMINAL_HISTORY_BOOK_SAMPLE_MS));
 const history=loop(tasks.history,"execution/archive history",cfg.TERMINAL_HISTORY_POLL_MS);
 return()=>{stopped=true;clearInterval(books);clearInterval(history);};
}
