import type {AppConfig} from "@pulse/config";
import {createTerminalMarketHistory} from "./terminalMarketHistory.js";
export async function runTerminalMarketHistoryCycle(cfg:AppConfig){if(!cfg.FEATURE_TRADING_TERMINAL||!cfg.TERMINAL_HISTORY_ENABLED)return{disabled:true};return createTerminalMarketHistory(cfg).collect({maxWorkMs:cfg.TERMINAL_HISTORY_WORK_MS,maxPages:cfg.TERMINAL_HISTORY_PAGES_PER_BATCH});}
export function startTerminalMarketHistoryWorker(cfg:AppConfig){
 if(!cfg.FEATURE_TRADING_TERMINAL||!cfg.TERMINAL_HISTORY_ENABLED||process.env.AUTOMATION_WORKER_ENABLED!=="1")return()=>{};
 let stopped=false,running=false;const tick=async()=>{if(stopped||running)return;running=true;try{await runTerminalMarketHistoryCycle(cfg);}catch{console.warn("Terminal public-market collector is unavailable; retained coverage stays explicit.");}finally{running=false;}};
 void tick();const timer=setInterval(()=>void tick(),cfg.TERMINAL_HISTORY_POLL_MS);timer.unref();return()=>{stopped=true;clearInterval(timer);};
}
