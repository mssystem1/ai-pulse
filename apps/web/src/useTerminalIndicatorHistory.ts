import {useEffect,useRef,useState} from "react";
import type {TerminalSessionHistory,TerminalMarketTools,TerminalFlowTool} from "@pulse/domain";
import {terminalRequest,type TerminalMarket} from "./terminalClient";
import {terminalHistoryDefaults,terminalSessionEvidenceMatches} from "./terminalHistorySelection";
import {startTerminalPolling} from "./terminalPolling";

type SessionIdentity=Pick<TerminalSessionHistory,"instId"|"marketType"|"requestedStart"|"requestedEnd">;
type History={session:SessionIdentity;perpetualSession:SessionIdentity;tools:Pick<TerminalMarketTools,"flow"|"perpetualFlow">;observedAt:number;evidenceSnapshotId?:string;setupVersionId?:string};

/** Number of complete contiguous bars, not the length of an incomplete session. */
export function terminalFlowWarmupBars(flow:TerminalFlowTool|undefined):number{
 let run=0,best=0,priorEnd:number|undefined;
 for(const point of flow?.displayPoints??[]){
  const complete=Boolean(flow?.displayBucketMs&&point.end-point.ts===flow.displayBucketMs&&point.end<=flow.knownAt&&!(flow.missingIntervals??[]).some(gap=>gap.start<point.end&&gap.end>point.ts));
  if(!complete){run=0;priorEnd=point.end;continue;}
  run=priorEnd===point.ts?run+1:1;best=Math.max(best,run);priorEnd=point.end;
 }
 return best;
}

/** Load study history while Terminal is open, independently of the Tools page.
 * Selection keys and cancellation prevent old timeframe data being published. */
export function useTerminalIndicatorHistory(source:TerminalMarket|null,token:string,active:boolean,stream:"spot"|"perpetual"){
 const key=JSON.stringify([token,source?.instId,source?.timeframe,source?.evidenceSnapshotId,source?.setupVersionId]);
 const sourceRef=useRef(source);sourceRef.current=source;
 const [state,setState]=useState<{key:string;history:History|null;error:string;loading:boolean}>({key,history:null,error:"",loading:false});
 useEffect(()=>{
  const selected=sourceRef.current;if(!selected||!active||!token)return;
  const controller=new AbortController();let closed=false;
  const load=async()=>{
   if(closed)return;
   setState(previous=>({key,history:previous.key===key?previous.history:null,error:"",loading:true}));
   try{
    const params=new URLSearchParams({instId:selected.instId,timeframe:selected.timeframe,session:terminalHistoryDefaults(selected.timeframe).session,purpose:"indicators",...(selected.evidenceSnapshotId?{evidenceSnapshotId:selected.evidenceSnapshotId}:{})});
    const history=await terminalRequest<History>("history/session?"+params,{token,signal:controller.signal});
    if(!terminalSessionEvidenceMatches(history,selected))throw Error("Indicator history did not match the selected market and timeframe.");
    if(!closed)setState({key,history,error:"",loading:false});
   }catch(error){if(!closed)setState(previous=>({key,history:previous.key===key?previous.history:null,error:error instanceof Error?error.message:"Indicator history unavailable",loading:false}));}
  };
  const poll=startTerminalPolling(load,60_000);
  return()=>{closed=true;controller.abort();poll.stop();};
 },[key,active,token]);
 const history=state.key===key?state.history:null;
 const flow=stream==="spot"?history?.tools.flow:history?.tools.perpetualFlow;
 // An incomplete historical bucket must not replace a usable current tape.
 // 32 complete bars support the built-in twenty-bar rolling studies; custom
 // studies with longer warm-up continue to show their exact missing inputs.
 const usable=terminalFlowWarmupBars(flow)>=32;
 const market=source&&history&&usable?{...source,observedAt:history.observedAt,tools:{...source.tools,...history.tools},evidenceSnapshotId:history.evidenceSnapshotId??source.evidenceSnapshotId}:source;
 const note=usable?"Retained execution history. These study bars use their own printed interval; the primary price candles keep the selected timeframe.":state.key===key&&state.error?`Retained execution history could not load: ${state.error}. Showing only the captured execution sample.`:state.key===key&&state.loading?"Loading retained execution history. The captured execution sample remains visible.":"The retained session does not yet contain 32 contiguous complete study bars. Showing the captured execution sample; its times and interval are printed below.";
 return{market,note};
}
