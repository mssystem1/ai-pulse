import type {TerminalSessionHistory} from "@pulse/domain";

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
