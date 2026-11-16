/** Sequential, visibility-aware polling. Failures back off to fifteen minutes;
 * success restores the normal cadence. Foreground events never overlap work. */
export function startTerminalPolling(task:()=>Promise<unknown>, intervalMs:number, visible=()=>document.visibilityState==="visible") {
  let stopped=false,running=false,failures=0,retryAt=0,timer:ReturnType<typeof setTimeout>|undefined;
  const schedule=()=>{if(!stopped)timer=setTimeout(()=>void run(),Math.max(retryAt-Date.now(),Math.min(900_000,intervalMs*2**Math.min(failures,5))));};
  const run=async()=>{if(stopped||running||Date.now()<retryAt)return;if(timer)clearTimeout(timer);if(!visible()){schedule();return;}running=true;try{await task();failures=0;retryAt=0;}catch(error){failures++;const retry=Number((error as {details?:{retryAfterSeconds?:number}})?.details?.retryAfterSeconds);if(Number.isFinite(retry)&&retry>0)retryAt=Date.now()+Math.min(3600,retry)*1000;}finally{running=false;schedule();}};
  void run();return {refresh:()=>{if(!running)void run();},stop:()=>{stopped=true;if(timer)clearTimeout(timer);}};
}
