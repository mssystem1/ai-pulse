import {candleTimeframeMs,GlobalOrderFlowSchema,type GlobalOrderFlow} from "@pulse/schemas";
import {terminalFrameProfile,type TerminalSessionHistory,type TerminalSessionPreset,type TerminalSessionWindow,type TerminalHistoryRow,type TerminalMarketTools,type TerminalHistoryInterval,type TerminalHistoryTotals} from "@pulse/domain";
const DAY=86400000,minute=60000,round=(v:number)=>Number(v.toPrecision(14));
export function terminalSessionWindow(preset:TerminalSessionPreset,asOf:number,custom?:{start:number;end:number}):TerminalSessionWindow{
 if(!Number.isSafeInteger(asOf))throw Error("Invalid session clock");const d=new Date(asOf),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
 const start=preset==="day"?day:preset==="previous-day"?day-DAY:preset==="week"?day-(d.getUTCDay()+6)%7*DAY:preset==="month"?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1):custom?.start;
 const end=preset==="custom"?custom?.end:preset==="previous-day"?day:Math.floor(asOf/minute)*minute;
 if(typeof start!=="number"||typeof end!=="number"||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start%minute||end%minute||end<=start||end>Math.floor(asOf/minute)*minute||end-start>31*DAY)throw Error("Choose a valid session in whole UTC minutes, at most 31 days. The current minute must complete first.");
 return{preset,start:start!,end:end!};
}
export function terminalCovered(intervals:TerminalHistoryInterval[],start:number,end:number){let cursor=start;for(const p of [...intervals].sort((a,b)=>a.start-b.start)){if(p.end<=cursor)continue;if(p.start>cursor)return false;cursor=Math.max(cursor,p.end);if(cursor>=end)return true;}return cursor>=end;}
const near=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-12,1e-9*Math.max(Math.abs(a),Math.abs(b)));
function validateTotals(t:TerminalHistoryTotals,start:number,end:number){
 const volume=t.buy+t.sell;
 if(![t.buy,t.sell,t.notional,t.squaredNotional,t.open,t.high,t.low,t.close,volume].every(Number.isFinite)||t.buy<0||t.sell<0||volume<=0||t.notional<=0||t.squaredNotional<=0||!Number.isSafeInteger(t.trades)||t.trades<1||![t.firstTradeAt,t.lastTradeAt].every(Number.isSafeInteger)||t.firstTradeAt<start||t.lastTradeAt>=end||t.firstTradeAt>t.lastTradeAt||t.low<=0||t.low>Math.min(t.open,t.close)||t.high<Math.max(t.open,t.close))throw Error("Invalid retained session aggregate");
 const mean=t.notional/volume,moment=t.squaredNotional/volume,tolerance=1e-9*Math.max(moment,mean*mean,t.high*t.high);
 if(mean<t.low-Math.max(1e-12,t.high*1e-12)||mean>t.high+Math.max(1e-12,t.high*1e-12)||moment<mean*mean-tolerance||moment<t.low*t.low-tolerance||moment>t.high*t.high+tolerance)throw Error("Retained execution moments do not match their price bounds");
}
function validateRows(rows:TerminalHistoryRow[],totals:TerminalHistoryTotals,step:number){
 if(!rows.length||rows.some((r,i)=>![r.low,r.high,r.buy,r.sell].every(Number.isFinite)||r.low<0||r.high<=r.low||r.buy<0||r.sell<0||r.buy+r.sell<=0||!Number.isSafeInteger(r.trades)||r.trades<1||Math.abs(r.high-r.low-step)>Math.max(1e-12,step*1e-8)||Math.abs(r.low/step-Math.round(r.low/step))>8*Number.EPSILON*Math.max(1,Math.abs(r.low/step))||i>0&&r.low<rows[i-1].high-Math.max(1e-12,step*1e-8)))throw Error("Invalid or overlapping retained execution price rows");
 if(!near(rows.reduce((n,r)=>n+r.buy,0),totals.buy)||!near(rows.reduce((n,r)=>n+r.sell,0),totals.sell)||rows.reduce((n,r)=>n+r.trades,0)!==totals.trades||rows[0].low>totals.low||rows.at(-1)!.high<totals.high)throw Error("Retained session totals do not reconcile with price rows");
}
function rebin(rows:TerminalHistoryRow[],step:number){const map=new Map<number,TerminalHistoryRow>();for(const r of rows){const quotient=r.low/step,integer=Math.round(quotient),at=Math.abs(quotient-integer)<=8*Number.EPSILON*Math.max(1,Math.abs(quotient))?integer:Math.floor(quotient),row=map.get(at)??{low:round(at*step),high:round((at+1)*step),buy:0,sell:0,trades:0};row.buy+=r.buy;row.sell+=r.sell;row.trades+=r.trades;map.set(at,row);}return[...map.values()].sort((a,b)=>a.low-b.low).map(r=>({...r,buy:round(r.buy),sell:round(r.sell)}));}
function profile(rows:TerminalHistoryRow[],totals:NonNullable<TerminalSessionHistory["totals"]>,step:number,start:number,end:number,knownAt:number,timeframe:string){
 const rebinned=rebin(rows,step),volume=totals.buy+totals.sell;if(!rebinned.length||!(volume>0))return null;
 if(!near(rebinned.reduce((n,r)=>n+r.buy,0),totals.buy)||!near(rebinned.reduce((n,r)=>n+r.sell,0),totals.sell)||rebinned.reduce((n,r)=>n+r.trades,0)!==totals.trades)throw Error("Retained session totals do not reconcile with price rows");
 let poc=0;for(let i=1;i<rebinned.length;i++)if(rebinned[i].buy+rebinned[i].sell>rebinned[poc].buy+rebinned[poc].sell)poc=i;
 const first=Math.round(rebinned[0].low/step),last=Math.round(rebinned.at(-1)!.low/step),center=Math.round(rebinned[poc].low/step),weights=new Map(rebinned.map(r=>[Math.round(r.low/step),r.buy+r.sell]));
 let bottom=center,top=center,covered=weights.get(center)!,target=volume*.7;
 while(covered<target&&(bottom>first||top<last)){const up=top<last?weights.get(top+1)??0:-1,down=bottom>first?weights.get(bottom-1)??0:-1;if(up>=down){top++;covered+=up;}else{bottom--;covered+=down;}}
 return{timeframe,start,end,knownAt,rowSize:step,valueFraction:.7,poc:round((rebinned[poc].low+rebinned[poc].high)/2),val:round(bottom*step),vah:round((top+1)*step),open:totals.open,high:totals.high,low:totals.low,close:totals.close,buy:round(totals.buy),sell:round(totals.sell),volume:round(volume),delta:round(totals.buy-totals.sell),trades:totals.trades,rows:rebinned};
}
/** Consume exact execution aggregates, not artificial prints reconstructed from
 * candles or bin midpoints. The profile can be developing while missing time
 * stays explicit; only fully covered sessions enter the complete flow schema. */
export function terminalToolsFromSession(history:TerminalSessionHistory,timeframe:string):Pick<TerminalMarketTools,"value"|"flow">{
 const {requestedStart:start,requestedEnd:end,knownAt,totals}=history,frame=terminalFrameProfile(timeframe);
 // The requested session can extend beyond the last collector observation.
 // Missing time remains a gap; it is not a reason to discard the usable prefix
 // (or turn an empty, still-queued session into a service error).
 if(history.version!=="terminal-session-history-v1"||!history.source||!history.instId||![start,end,knownAt,history.barMs].every(Number.isSafeInteger)||start<0||knownAt<0||end<=start||history.barMs<1||!Number.isFinite(history.priceStep)||history.priceStep<=0||history.quantityUnit!==(history.marketType==="spot"?"base":"contracts")||!["spot","perpetual"].includes(history.marketType))throw Error("Invalid retained session identity, units or clock");
 const intervals=history.intervals.slice().sort((a,b)=>a.start-b.start);
 if([...intervals,...history.gaps].some(p=>![p.start,p.end].every(Number.isSafeInteger)||p.start<start||p.end>end||p.end<=p.start))throw Error("Invalid retained session coverage interval");
 const covered=terminalCovered(intervals,start,end)&&!history.gaps.length&&history.complete;
 if(history.complete&&end>knownAt||intervals.some(interval=>interval.end>knownAt)||totals&&totals.lastTradeAt>knownAt)throw Error("Retained coverage extends beyond its actual source observation");
 const meta={source:history.source,knownAt,windowStart:start,windowEnd:end,status:covered?"available" as const:totals?"partial" as const:"unavailable" as const,units:history.quantityUnit,reason:covered?undefined:history.backfill.message??"Session collection is incomplete. Gaps remain unknown.",coverage:totals?{requestedStart:start,requestedEnd:end,capturedStart:intervals[0]?.start??start,capturedEnd:intervals.at(-1)?.end??start,firstTradeAt:totals.firstTradeAt,lastTradeAt:totals.lastTradeAt,tradeCount:totals.trades,completeRequestedWindow:covered,completeCapturedInterval:covered,horizon:"selected-session"}:undefined};
 const value:TerminalMarketTools["value"]={...meta,id:"value",label:"Session VWAP & value"},flow:TerminalMarketTools["flow"]={...meta,id:"flow",label:"Session executed flow",marketType:history.marketType,points:[],missingIntervals:history.gaps.map(({start,end})=>({start,end}))};
 if(!totals){if(history.rows.length||history.bars.length)throw Error("Retained execution rows require their exact totals");return{value,flow};}
 validateTotals(totals,start,end);validateRows(history.rows,totals,history.priceStep);
 for(const [index,bar]of history.bars.entries()){
  if(![bar.start,bar.end].every(Number.isSafeInteger)||bar.end<=bar.start||bar.start>=end||bar.end<=start||bar.end>end||index>0&&bar.start<history.bars[index-1].end)throw Error("Retained execution bars are outside the selected session or overlap");
  validateTotals(bar,Math.max(start,bar.start),bar.end);validateRows(bar.rows,bar,history.priceStep);
 }
 for(const key of ["buy","sell","notional","squaredNotional","trades"]as const){const sum=history.bars.reduce((n,bar)=>n+bar[key],0);if(key==="trades"?sum!==totals[key]:!near(sum,totals[key]))throw Error("Retained execution bars do not reconcile with session totals");}
 const first=history.bars[0],last=history.bars.at(-1)!;
 if(!first||!last||!near(first.open,totals.open)||!near(last.close,totals.close)||!near(Math.min(...history.bars.map(bar=>bar.low)),totals.low)||!near(Math.max(...history.bars.map(bar=>bar.high)),totals.high)||first.firstTradeAt!==totals.firstTradeAt||last.lastTradeAt!==totals.lastTradeAt)throw Error("Retained session OHLC and trade clocks do not reconcile with execution bars");
 const combinedRows=rebin(history.bars.flatMap(bar=>bar.rows),history.priceStep);
 if(combinedRows.length!==history.rows.length||combinedRows.some((row,i)=>!near(row.low,history.rows[i].low)||!near(row.high,history.rows[i].high)||!near(row.buy,history.rows[i].buy)||!near(row.sell,history.rows[i].sell)||row.trades!==history.rows[i].trades))throw Error("Retained session profile does not reconcile with execution bars");
 if(covered&&(!history.proofHashes?.length||history.proofHashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash))))throw Error("A complete retained session requires its source proofs");
 const volume=totals.buy+totals.sell,vwap=totals.notional/volume,sigma=totals.high===totals.low?0:Math.sqrt(Math.max(0,totals.squaredNotional/volume-vwap*vwap));
 const low=history.rows[0].low,high=history.rows.at(-1)!.high,step=history.priceStep*Math.max(1,10**Math.ceil(Math.log10(Math.max(1,(high-low)/180/history.priceStep))));
 const p=profile(history.rows,totals,step,start,end,knownAt,frame.execution);if(!p)return{value,flow};
 value.tradeVwap=round(vwap);value.sigma=round(sigma);value.bands=[1,2,3].map(deviations=>({deviations,lower:round(Math.max(0,vwap-deviations*sigma)),upper:round(vwap+deviations*sigma)}));value.sessionProfile=p;
 const execMs=candleTimeframeMs(frame.execution),footprints:GlobalOrderFlow["footprints"]=history.bars.filter(bar=>bar.start>=start&&bar.end<=end&&bar.end-bar.start===execMs&&bar.start%execMs===0&&terminalCovered(intervals,bar.start,bar.end)&&!history.gaps.some(gap=>gap.start<bar.end&&gap.end>bar.start)).slice(-32).flatMap(bar=>{const p=profile(bar.rows,bar,step,bar.start,bar.end,knownAt,frame.execution);return p?[{start:bar.start,end:bar.end,knownAt,open:p.open,high:p.high,low:p.low,close:p.close,buy:p.buy,sell:p.sell,volume:p.volume,delta:p.delta,trades:p.trades,rows:p.rows}]:[];});
 value.sessionFootprints=footprints;
 if(covered&&history.proofHashes?.length)value.orderFlow=GlobalOrderFlowSchema.parse({version:"trade-flow-v1",source:history.source,instId:history.instId,priceCurrency:history.instId.split("-")[1],marketType:history.marketType,quantityUnit:history.quantityUnit,capturedAt:new Date(knownAt).toISOString(),coverage:{start,end,knownAt,complete:true,sha256:history.proofHashes},profile:p,footprints});
 let cvd=0;flow.buy=round(totals.buy);flow.sell=round(totals.sell);flow.delta=round(totals.buy-totals.sell);flow.displayBucketMs=history.barMs;
 flow.displayPoints=history.bars.map(bar=>({ts:Math.max(start,bar.start),end:bar.end,buy:round(bar.buy),sell:round(bar.sell),delta:round(bar.buy-bar.sell),cvd:round(cvd+=bar.buy-bar.sell),priceOpen:bar.open,priceHigh:bar.high,priceLow:bar.low,priceClose:bar.close,tradeCount:bar.trades}));
 flow.points=flow.displayPoints.map(({ts,buy,sell,delta,cvd})=>({ts,buy,sell,delta,cvd}));return{value,flow};
}
