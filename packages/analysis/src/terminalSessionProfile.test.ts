import test from "node:test";
import assert from "node:assert/strict";
import type {TerminalSessionHistory,TerminalHistoryTotals,TerminalHistoryRow} from "@pulse/domain";
import {terminalSessionWindow,terminalCovered,terminalToolsFromSession} from "./terminalSessionProfile.js";

const start=Date.UTC(2026,10,1),minute=60000;
type Print={price:number;size:number;side:"buy"|"sell";at?:number};
function session(prints:Print[],step=1):TerminalSessionHistory{
 const rows=new Map<number,TerminalHistoryRow>();
 for(const p of prints){const low=Math.floor((p.price+step*1e-10)/step)*step,row=rows.get(low)??{low,high:low+step,buy:0,sell:0,trades:0};row[p.side]+=p.size;row.trades++;rows.set(low,row);}
 const totals:TerminalHistoryTotals={buy:prints.filter(p=>p.side==="buy").reduce((n,p)=>n+p.size,0),sell:prints.filter(p=>p.side==="sell").reduce((n,p)=>n+p.size,0),trades:prints.length,notional:prints.reduce((n,p)=>n+p.price*p.size,0),squaredNotional:prints.reduce((n,p)=>n+p.price*p.price*p.size,0),open:prints[0].price,close:prints.at(-1)!.price,low:Math.min(...prints.map(p=>p.price)),high:Math.max(...prints.map(p=>p.price)),firstTradeAt:prints[0].at??start+1,lastTradeAt:prints.at(-1)!.at??start+2};
 const priceRows=[...rows.values()].sort((a,b)=>a.low-b.low),end=start+5*minute;
 return{version:"terminal-session-history-v1",instId:"BTC-USDT",marketType:"spot",quantityUnit:"base",source:"okx-retained-executions",requestedStart:start,requestedEnd:end,knownAt:end+1,status:"available",priceStep:step,complete:true,intervals:[{start,end}],gaps:[],totals,rows:priceRows,bars:[{...totals,start,end,rows:priceRows}],barMs:5*minute,proofHashes:["a".repeat(64)],backfill:{state:"complete",pages:1}};
}
const near=(actual:number|undefined,expected:number,epsilon=1e-8)=>assert.ok(actual!==undefined&&Math.abs(actual-expected)<epsilon,`${actual} differs from ${expected}`);

test("session VWAP and deviations use exact execution moments instead of profile row midpoints",()=>{
 const history=session([{price:100.1,size:1,side:"buy"},{price:100.9,size:3,side:"sell"}]),{value,flow}=terminalToolsFromSession(history,"15m");
 near(value.tradeVwap,100.7);near(value.sigma,Math.sqrt(.12));assert.equal(value.sessionProfile!.poc,100.5);
 assert.equal(value.status,"available");assert.equal(value.sessionFootprints!.length,1);assert.equal(value.orderFlow!.coverage.complete,true);
 assert.equal(flow.delta,-2);assert.equal(flow.displayPoints![0].cvd,-2);assert.equal(flow.displayPoints![0].priceClose,100.9);assert.equal(flow.displayPoints![0].tradeCount,2);
 assert.equal(value.sessionProfile!.rows[0].buy,1);assert.equal(value.sessionProfile!.rows[0].sell,3);
});

test("70% value area expands from POC through real bins, conserving volume across empty price rows",()=>{
 const {value}=terminalToolsFromSession(session([{price:100.2,size:1,side:"buy"},{price:102.2,size:5,side:"buy"},{price:103.2,size:3,side:"sell"},{price:105.2,size:2,side:"sell"}]),"15m"),p=value.sessionProfile!;
 assert.equal(p.poc,102.5);assert.equal(p.val,102);assert.equal(p.vah,104);assert.equal(p.valueFraction,.7);
 const included=p.rows.filter(r=>r.low>=p.val&&r.high<=p.vah).reduce((n,r)=>n+r.buy+r.sell,0);
 assert.equal(included,8);assert.ok(included>=p.volume*.7);assert.equal(p.rows.reduce((n,r)=>n+r.buy+r.sell,0),11);assert.equal(p.rows.length,4);
});

test("explicit source gaps preserve measured flow but exclude affected footprints and complete evidence",()=>{
 const history=session([{price:100.1,size:1,side:"buy"},{price:100.9,size:3,side:"sell"}]);history.gaps=[{start:start+minute,end:start+2*minute,reason:"Missing source interval"}];
 const {value,flow}=terminalToolsFromSession(history,"15m");assert.equal(value.status,"partial");assert.equal(value.orderFlow,undefined);assert.equal(value.sessionFootprints!.length,0);assert.equal(flow.sell,3);assert.equal(value.coverage!.completeRequestedWindow,false);
});

test("an empty uncollected session remains unavailable rather than throwing on its zero source clock",()=>{
 const history=session([{price:100.1,size:1,side:"buy"}]);
 Object.assign(history,{knownAt:0,complete:false,status:"collecting",intervals:[],totals:null,rows:[],bars:[],proofHashes:[],gaps:[{start:history.requestedStart,end:history.requestedEnd,reason:"Collection queued"}],backfill:{state:"queued",pages:0,message:"Collection queued"}});
 const {value,flow}=terminalToolsFromSession(history,"15m");
 assert.equal(value.status,"unavailable");assert.equal(value.knownAt,0);assert.equal(value.reason,"Collection queued");
 assert.equal(value.sessionProfile,undefined);assert.equal(flow.status,"unavailable");assert.deepEqual(flow.points,[]);
});

test("an incomplete session keeps measured executions when the requested end advances beyond collection",()=>{
 const history=session([{price:100.1,size:1,side:"buy"},{price:100.9,size:3,side:"sell"}]);
 const capturedEnd=history.requestedEnd;history.requestedEnd+=minute;history.complete=false;history.status="partial";
 history.gaps=[{start:capturedEnd,end:history.requestedEnd,reason:"Current tail still collecting"}];
 const {value,flow}=terminalToolsFromSession(history,"15m");
 assert.equal(value.status,"partial");assert.equal(value.knownAt,capturedEnd+1);near(value.tradeVwap,100.7);
 assert.equal(value.orderFlow,undefined);assert.equal(value.coverage!.completeRequestedWindow,false);assert.equal(flow.sell,3);
 const impossible=structuredClone(history);impossible.intervals[0].end=impossible.requestedEnd;
 assert.throws(()=>terminalToolsFromSession(impossible,"15m"),/actual source observation/);
});

test("a session clipped inside an execution bar never becomes a complete footprint",()=>{
 const history=session([{price:100.1,size:1,side:"buy",at:start+minute+1},{price:100.9,size:1,side:"sell",at:start+minute+2}]);history.requestedStart=start+minute;history.intervals=[{start:history.requestedStart,end:history.requestedEnd}];
 const {value,flow}=terminalToolsFromSession(history,"15m");assert.equal(value.status,"available");assert.equal(value.sessionFootprints!.length,0);assert.equal(flow.displayPoints![0].ts,history.requestedStart);
});

test("malformed retained totals, units, rows, source proof and future clocks fail closed",()=>{
 const valid=session([{price:100.1,size:1,side:"buy"},{price:100.9,size:3,side:"sell"}]);
 const cases=[
  (h:TerminalSessionHistory)=>{h.quantityUnit="contracts";},
  (h:TerminalSessionHistory)=>{h.knownAt=h.requestedEnd-1;},
  (h:TerminalSessionHistory)=>{h.rows[0].buy=-1;},
  (h:TerminalSessionHistory)=>{h.totals!.squaredNotional=1;},
  (h:TerminalSessionHistory)=>{h.bars[0].sell+=1;},
  (h:TerminalSessionHistory)=>{h.rows.push({...h.rows[0]});},
  (h:TerminalSessionHistory)=>{h.rows[0].low+=.1;h.rows[0].high+=.1;},
  (h:TerminalSessionHistory)=>{h.totals!.open=100.2;},
  (h:TerminalSessionHistory)=>{h.totals!.firstTradeAt+=1;},
  (h:TerminalSessionHistory)=>{h.proofHashes=[];},
  (h:TerminalSessionHistory)=>{h.intervals[0].end=h.requestedEnd+1;},
 ];
 for(const change of cases){const history=structuredClone(valid);change(history);assert.throws(()=>terminalToolsFromSession(history,"15m"));}
});

test("constant executed price has zero deviation even with a large price and fractional quantities",()=>{
 const {value}=terminalToolsFromSession(session([{price:80612.34567,size:.000013,side:"buy"},{price:80612.34567,size:.000037,side:"sell"}],.01),"15m");
 assert.equal(value.sigma,0);near(value.tradeVwap,80612.34567);for(const band of value.bands!)assert.equal(band.lower,band.upper);
});

test("adaptive profiles preserve a nondecimal source grid and all execution quantities",()=>{
 const {value}=terminalToolsFromSession(session([{price:100.2,size:1,side:"buy"},{price:1000.2,size:2,side:"sell"}],3),"15m"),p=value.sessionProfile!;
 assert.equal(p.rowSize,30);assert.deepEqual(p.rows.map(r=>[r.low,r.high]),[[90,120],[990,1020]]);assert.equal(p.volume,3);assert.equal(p.trades,2);
});

test("UTC session windows and merged coverage retain explicit time boundaries",()=>{
 const asOf=Date.UTC(2026,10,5,12,34,56),window=terminalSessionWindow("week",asOf);assert.equal(window.start,Date.UTC(2026,10,2));assert.equal(window.end,Date.UTC(2026,10,5,12,34));
 assert.equal(terminalCovered([{start:start+minute,end:start+2*minute},{start,end:start+minute}],start,start+2*minute),true);
 assert.equal(terminalCovered([{start,end:start+minute},{start:start+minute+1,end:start+2*minute}],start,start+2*minute),false);
 assert.throws(()=>terminalSessionWindow("custom",asOf,{start,end:asOf+minute}));
 assert.throws(()=>terminalSessionWindow("custom",start+2*minute-2,{start,end:start+2*minute}),/current minute must complete/);
});
