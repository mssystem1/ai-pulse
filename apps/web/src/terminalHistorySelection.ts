import type {TerminalSessionHistory,TerminalSessionPreset} from "@pulse/domain";

export type TerminalHistorySessionSelection="timeframe"|TerminalSessionPreset;
export type TerminalLiquidityWindowSelection="timeframe"|1|6|24|168;
export type TerminalHistoryPreferences={sessionSelection:TerminalHistorySessionSelection;liquiditySelection:TerminalLiquidityWindowSelection;custom:{start:string;end:string};applied:{start:number;end:number}|null};
export const TERMINAL_HISTORY_PREFERENCE_PREFIX="pulse.terminal.history-window.v1:";

/** Browser preferences contain only window choices, never wallet/report data. */
export function terminalHistoryPreferences(raw:string|null):TerminalHistoryPreferences{
 const empty:TerminalHistoryPreferences={sessionSelection:"timeframe",liquiditySelection:"timeframe",custom:{start:"",end:""},applied:null};
 try{
  const value=JSON.parse(raw??"null");
  if(!value||typeof value!=="object")return empty;
  const sessionSelection=["timeframe","day","previous-day","week","month","custom"].includes(value.sessionSelection)?value.sessionSelection:"timeframe";
  const liquiditySelection=["timeframe",1,6,24,168].includes(value.liquiditySelection)?value.liquiditySelection:"timeframe";
  const custom={start:typeof value.custom?.start==="string"?value.custom.start:"",end:typeof value.custom?.end==="string"?value.custom.end:""};
  const range=value.applied;
  const applied=range&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)&&range.start>=0&&range.start%60_000===0&&range.end%60_000===0&&range.end>range.start&&range.end-range.start<=31*86400000?{start:range.start,end:range.end}:null;
  return{sessionSelection,liquiditySelection,custom,applied};
 }catch{return empty;}
}

/** Chart horizon selects the starting view; a trader's explicit window wins.
 * Weekly cycle research uses the largest supported UTC session (one month),
 * not a pretend full-cycle profile made from the recent execution sample. */
export function terminalHistoryDefaults(timeframe:string):{session:TerminalSessionPreset;hours:1|6|24|168;label:string}{
 switch(timeframe){
  case "15m":return{session:"day",hours:1,label:"Today · UTC"};
  case "1H":return{session:"week",hours:6,label:"This week · UTC"};
  case "4H":return{session:"week",hours:24,label:"This week · UTC"};
  case "1D":case "1Dutc":return{session:"month",hours:168,label:"This month · UTC"};
  case "1W":case "1Wutc":return{session:"month",hours:168,label:"This month · UTC"};
  default:throw Error("Unsupported Terminal timeframe");
 }
}

export function terminalHistorySelection(timeframe:string,session:TerminalHistorySessionSelection="timeframe",liquidity:TerminalLiquidityWindowSelection="timeframe"){
 const defaults=terminalHistoryDefaults(timeframe);
 return{preset:session==="timeframe"?defaults.session:session,hours:liquidity==="timeframe"?defaults.hours:liquidity};
}

export function terminalCustomHistoryRange(input:{start:string;end:string}):{start:number;end:number}{
 const parse=(value:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error("Choose complete UTC dates and minutes for both ends of the range.");
  const ts=Date.parse(value+"Z");
  if(!Number.isSafeInteger(ts)||ts<0||new Date(ts).toISOString().slice(0,16)!==value)throw Error("Choose valid UTC calendar dates.");
  return ts;
 };
 const start=parse(input.start),end=parse(input.end);
 if(end<=start)throw Error("The end of the UTC range must be later than its start.");
 if(end-start>31*86400000)throw Error("Choose a UTC range of at most 31 days.");
 return{start,end};
}

export function terminalSessionEvidenceMatches(response:{session:TerminalSessionHistory;perpetualSession:TerminalSessionHistory;setupVersionId?:string},source:{instId:string;setupVersionId?:string},custom?:{start:number;end:number}):boolean{
 const spot=response.session,futures=response.perpetualSession;
 return spot.instId===source.instId&&spot.marketType==="spot"&&futures.instId===source.instId&&futures.marketType==="perpetual"&&spot.requestedStart===futures.requestedStart&&spot.requestedEnd===futures.requestedEnd&&(!custom||spot.requestedStart===custom.start&&spot.requestedEnd===custom.end)&&(!response.setupVersionId||!source.setupVersionId||response.setupVersionId===source.setupVersionId);
}
