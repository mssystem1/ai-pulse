/** Sequential, visibility-aware polling. Failures back off to fifteen minutes;
 * success restores the normal cadence. Foreground events never overlap work. */
export function startTerminalPolling(task:()=>Promise<unknown>, intervalMs:number, visible=()=>document.visibilityState==="visible") {
  let stopped=false,running=false,failures=0,timer:ReturnType<typeof setTimeout>|undefined;
  const schedule=()=>{if(!stopped)timer=setTimeout(()=>void run(),Math.min(900_000,intervalMs*2**Math.min(failures,5)));};
  const run=async()=>{if(stopped||running)return;if(timer)clearTimeout(timer);if(!visible()){schedule();return;}running=true;try{await task();failures=0;}catch{failures++;}finally{running=false;schedule();}};
  void run();return {refresh:()=>{if(!running)void run();},stop:()=>{stopped=true;if(timer)clearTimeout(timer);}};
}
