import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {TerminalSessionHistory,TerminalLiquidityHistory as BookHistory,TerminalMarketTools as Tools} from "@pulse/domain";
import type {TerminalMarket,TerminalAskContext} from "./terminalClient";
import {terminalRequest,terminalUtc} from "./terminalClient";
import {TerminalMarketTools} from "./TerminalMarketTools";
import {TerminalLiquidityHistory} from "./TerminalLiquidityHistory";
import {TERMINAL_HISTORY_PREFERENCE_PREFIX,terminalCustomHistoryRange,terminalHistoryDefaults,terminalHistoryPreferences,terminalHistorySelection,terminalSessionEvidenceMatches} from "./terminalHistorySelection";
import type {TerminalHistorySessionSelection,TerminalLiquidityWindowSelection} from "./terminalHistorySelection";
import {terminalRetainedToolSource} from "./terminalRetainedToolSource";
import "./terminalHistory.css";

type Response={session:TerminalSessionHistory;perpetualSession:TerminalSessionHistory;tools:Pick<Tools,"value"|"flow"|"perpetualFlow">;evidenceSnapshotId?:string;setupVersionId?:string;observedAt:number};
type Props={market:TerminalMarket;token:string;active:boolean;onAsk:(question:string,context?:TerminalAskContext)=>void;onRadar:(price:number,side:"above"|"below")=>void;onToolsChange?:(market:TerminalMarket,scope:"assessment"|"session")=>void};

/** One request per selection at a time. A late success, error or finally from an
 * old owner/asset/window can never change the current selection's state. */
function useRetainedRead<T>(key:string,active:boolean,read:(signal:AbortSignal)=>Promise<T>){
 const latest=useRef(read),currentKey=useRef(key);latest.current=read;currentKey.current=key;
 const [state,setState]=useState<{key:string;value:T|null;busy:boolean;error:string}>({key,value:null,busy:false,error:""});
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 useEffect(()=>{
  if(!active)return;
  const controller=new AbortController();let pending=false,closed=false;
  const current=()=>!closed&&!controller.signal.aborted&&currentKey.current===key;
  const load=async()=>{
   if(pending||!current())return;pending=true;
   setState(previous=>({key,value:previous.key===key?previous.value:null,busy:true,error:previous.key===key?previous.error:""}));
   try{
    const value=await latest.current(controller.signal);
    if(current())setState({key,value,busy:false,error:""});
   }catch(error){
    if(current())setState(previous=>({key,value:previous.key===key?previous.value:null,busy:false,error:error instanceof Error?error.message:"Retained history could not be loaded."}));
   }finally{
    pending=false;
    if(current())setState(previous=>previous.key===key?{...previous,busy:false}:previous);
   }
  };
  refreshRef.current=load;void load();
  const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},15_000);
  return()=>{closed=true;controller.abort();window.clearInterval(timer);if(refreshRef.current===load)refreshRef.current=async()=>{};};
 },[key,active]);
 const refresh=useCallback(()=>refreshRef.current(),[]);
 return{value:state.key===key?state.value:null,busy:state.key===key?state.busy:false,error:state.key===key?state.error:"",refresh};
}

export function TerminalRetainedMarketTools({market,token,active,onAsk,onRadar,onToolsChange}:Props){
 const preferenceKey=TERMINAL_HISTORY_PREFERENCE_PREFIX+market.instId;
 const [preferences]=useState(()=>{try{return terminalHistoryPreferences(sessionStorage.getItem(preferenceKey));}catch{return terminalHistoryPreferences(null);}});
 const [sessionSelection,setSessionSelection]=useState<TerminalHistorySessionSelection>(preferences.sessionSelection);
 const [liquiditySelection,setLiquiditySelection]=useState<TerminalLiquidityWindowSelection>(preferences.liquiditySelection);
 const defaults=terminalHistoryDefaults(market.timeframe);
 const {preset,hours}=terminalHistorySelection(market.timeframe,sessionSelection,liquiditySelection);
 const [custom,setCustom]=useState(preferences.custom),[applied,setApplied]=useState<{start:number;end:number}|null>(preferences.applied),[rangeError,setRangeError]=useState("");
 useEffect(()=>{try{sessionStorage.setItem(preferenceKey,JSON.stringify({sessionSelection,liquiditySelection,custom,applied}));}catch{/* Browsers may disable storage; in-view controls still work. */}},[preferenceKey,sessionSelection,liquiditySelection,custom,applied]);
 const accessKey=JSON.stringify([token,active,market.instId]);
 const sessionKey=JSON.stringify([accessKey,market.timeframe,market.evidenceSnapshotId,market.setupVersionId,preset,preset==="custom"?applied:null]);
 const bookKey=JSON.stringify([accessKey,hours]);
 const readSession=useRetainedRead(sessionKey,active&&(preset!=="custom"||applied!==null),async(signal)=>{
  const source=market;
  const params=new URLSearchParams({instId:source.instId,timeframe:source.timeframe,session:preset,...(source.evidenceSnapshotId?{evidenceSnapshotId:source.evidenceSnapshotId}:{}),...(preset==="custom"&&applied?{start:String(applied.start),end:String(applied.end)}:{})});
  const result=await terminalRequest<Response>("history/session?"+params,{token,signal});
  if(!terminalSessionEvidenceMatches(result,source,preset==="custom"?applied??undefined:undefined))throw Error("Retained history did not match the reviewed market, UTC range or setup. Refresh the selected evidence.");
  return{source,result};
 });
 const readBook=useRetainedRead(bookKey,active,async(signal)=>{
  const result=await terminalRequest<BookHistory>("history/liquidity?instId="+encodeURIComponent(market.instId)+"&hours="+hours,{token,signal});
  if(result.instrumentId!==market.instId||result.requestedEnd-result.requestedStart!==hours*3600000)throw Error("Liquidity history did not match the selected market and window.");
  return result;
 });
 const currentAccess=useRef(accessKey);currentAccess.current=accessKey;
 const refreshReaders=useRef({session:readSession.refresh,book:readBook.refresh});refreshReaders.current={session:readSession.refresh,book:readBook.refresh};
 const collectRef=useRef<()=>Promise<void>>(async()=>{});
 const [collection,setCollection]=useState({key:accessKey,busy:false,message:"",error:false});
 useEffect(()=>{
  if(!active)return;
  const controller=new AbortController();let pending=false,closed=false;
  const current=()=>!closed&&!controller.signal.aborted&&currentAccess.current===accessKey;
  const collect=async()=>{
   if(pending||!current())return;pending=true;
   setCollection({key:accessKey,busy:true,message:"Updating market history: saving new executions and order-book snapshots, then requesting available missing history. Coverage refreshes while collection runs.",error:false});
   try{
    await terminalRequest("history/collect",{token,method:"POST",body:{instId:market.instId},signal:controller.signal,timeoutMs:210_000});
    if(current()){
     setCollection({key:accessKey,busy:false,message:"History update checked. The session and liquidity views below show what was saved and which intervals still need data. Collection continues automatically while this view is active.",error:false});
     await Promise.all([refreshReaders.current.session(),refreshReaders.current.book()]);
    }
   }catch(error){
    if(current()){
     const uncertain=error instanceof Error&&["TimeoutError","AbortError"].includes(error.name);
     setCollection({key:accessKey,busy:false,message:uncertain?"The collection response was not confirmed. The worker may still be running; retained coverage continues to refresh.":"Collection was interrupted: "+(error instanceof Error?error.message:"Source unavailable")+". Retained checkpoints remain available for retry.",error:!uncertain});
     void refreshReaders.current.session();void refreshReaders.current.book();
    }
   }finally{pending=false;if(current())setCollection(previous=>previous.key===accessKey?{...previous,busy:false}:previous);}
  };
  collectRef.current=collect;void collect();
  const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void collect();},30_000);
  return()=>{closed=true;controller.abort();window.clearInterval(timer);if(collectRef.current===collect)collectRef.current=async()=>{};};
 },[accessKey,active,token,market.instId]);
 const record=readSession.value,result=record?.result;
 // Retained measurements belong to the exact source/report that requested them,
 // including its setup version. A subsequent parent refresh is a new selection.
 // Empty/backfilling history must not remove the independently captured tools.
 // Keep the whole assessment source and its evidence ID together until retained
 // executions exist; never attach fallback measurements to a different snapshot.
 const {market:displayed,scope:executionScope}=useMemo(()=>terminalRetainedToolSource(market,record),[market,record]);
 // Publish the exact measurements displayed below to sibling indicators. A
 // parent's callback identity alone must not republish or trigger a render loop.
 const publishTools=useRef(onToolsChange);publishTools.current=onToolsChange;
 useEffect(()=>{publishTools.current?.(displayed,executionScope);},[displayed,executionScope]);
 const retainedHasExecutions=executionScope==="session";
 const collecting=collection.key===accessKey&&collection.busy;
 return <div className="terminal-retained-tools">
  <div className="terminal-session-control" data-session-selection={sessionSelection} data-session-preset={preset}><label>Market-tools execution window<select aria-label="Market-tools execution window" disabled={!active} value={sessionSelection} onChange={event=>{setRangeError("");setSessionSelection(event.target.value as TerminalHistorySessionSelection);}}><option value="timeframe">Follow chart timeframe · {defaults.label}</option><option value="day">Today · UTC</option><option value="previous-day">Previous day · UTC</option><option value="week">This week · UTC</option><option value="month">This month · UTC</option><option value="custom">Custom UTC range…</option></select></label>
   {preset==="custom"&&<><label>From · UTC<input disabled={!active} type="datetime-local" value={custom.start} onChange={event=>setCustom(value=>({...value,start:event.target.value}))}/></label><label>Until · UTC<input disabled={!active} type="datetime-local" value={custom.end} onChange={event=>setCustom(value=>({...value,end:event.target.value}))}/></label><button type="button" disabled={!active||!custom.start||!custom.end} onClick={()=>{try{const next=terminalCustomHistoryRange(custom);setRangeError("");setApplied(next);}catch(error){setRangeError(error instanceof Error?error.message:"Choose a valid UTC range.");}}}>Apply range</button></>}
   <p>{sessionSelection==="timeframe"?`Following ${market.timeframe.replace("utc", "")} chart: ${defaults.label.toLowerCase()}. `:"Manual window: kept when you change the chart timeframe. Choose Follow chart timeframe to restore automatic windows. "}This is the time range of real trades used for VWAP, POC, value area, buy/sell flow and footprint. A shorter range shows recent participation; a longer range shows broader value. Current sessions end at the latest completed UTC minute. {market.timeframe==="1Wutc"&&sessionSelection==="timeframe"?"Weekly charts use the available monthly execution window, not a full-cycle profile. ":""}Chart candles, saved entry/SL/TP and current order-book/OI/funding timestamps stay independent.</p>
  </div>
  {rangeError&&<p className="terminal-warning" role="alert">{rangeError}</p>}
  {!active&&<p className="terminal-history-coverage" role="status">History refresh and collection are paused. An active Terminal pass is required.</p>}
  {collection.key===accessKey&&collection.message&&active&&<p className={collection.error?"terminal-warning":"terminal-hint"} role={collection.error?"alert":"status"}>{collection.message}</p>}
  {readSession.error&&<div className="terminal-warning terminal-session-error" role="alert"><p>{readSession.error} {retainedHasExecutions?"The last matching retained measurements remain below with their original source times.":"The assessment's independently captured tools remain available below; the requested UTC session has not replaced them."}</p><button type="button" disabled={!active||readSession.busy} onClick={()=>void readSession.refresh()}>{readSession.busy?"Retrying session…":"Retry session history"}</button></div>}
  {result&&<div className="terminal-session-progress" data-session-market={result.session.instId} data-session-start={result.session.requestedStart} data-session-end={result.session.requestedEnd}><b>{result.session.complete?"Full requested Spot session retained":result.session.backfill.state==="failed"?"Session history update needs a retry":"Session history is still filling"}</b><p>{result.session.totals?.trades.toLocaleString()??0} executions · {terminalUtc(result.session.requestedStart)} → {terminalUtc(result.session.requestedEnd)} · {result.session.gaps.length} missing interval(s). Futures: {result.perpetualSession.complete?"complete":"collecting separately"}.</p><p>{result.session.backfill.message} Missing intervals are excluded from profile and flow calculations until genuine exchange records are retained.</p>{!result.session.complete&&<button type="button" disabled={!active||collecting} onClick={()=>void collectRef.current()}>{collecting?"Updating history…":"Update missing session history"}</button>}</div>}
  {!result&&active&&<p role="status">{preset==="custom"&&!applied?"Choose and apply a valid UTC range to open its retained executions.":readSession.busy?"Opening retained session history… The assessment tools remain usable below.":"The selected UTC session is not available yet. The assessment tools and saved setup keep their own captured data."}</p>}
  <TerminalMarketTools market={displayed} executionScope={executionScope} onAsk={(question,context)=>onAsk(question,{...context,instId:displayed.instId,timeframe:displayed.timeframe,setupVersionId:displayed.setupVersionId,evidenceSnapshotId:displayed.evidenceSnapshotId})} onRadar={onRadar}/>
  <section className="terminal-panel"><TerminalLiquidityHistory history={readBook.value} selectedHours={hours} onWindowChange={value=>setLiquiditySelection(value as TerminalLiquidityWindowSelection)} followsTimeframe={liquiditySelection==="timeframe"} onFollowTimeframe={()=>setLiquiditySelection("timeframe")} timeframe={market.timeframe} busy={readBook.busy} collecting={collecting} disabled={!active} error={readBook.error} onCollect={()=>void collectRef.current()}/></section>
 </div>;
}
