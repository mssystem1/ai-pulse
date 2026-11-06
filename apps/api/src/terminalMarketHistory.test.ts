import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {TerminalMarketHistory,MemoryTerminalHistoryStorage} from "./terminalMarketHistory.js";
import type {TerminalBookHistoryFrame} from "@pulse/domain";
import type {OkxHistoryBatch} from "@pulse/market";
const day=Date.UTC(2026,10,5),end=day+3*60000,sha="a".repeat(64);
function source(){let call=0;return async(input:{instId:string;afterId?:string}):Promise<OkxHistoryBatch>=>{call++;return input.afterId?{trades:[{id:"1",ts:day+1000,price:100.1,size:1,side:"buy"}],knownAt:end,reachedStart:true,nextAfterId:"1",pages:1,pageHashes:[sha],oldestAt:day-1}:{trades:[{id:"2",ts:day+61000,price:101.2,size:2,side:"sell"}],knownAt:end,reachedStart:false,nextAfterId:"2",pages:1,pageHashes:[sha],oldestAt:day+61000};};}
const book=async()=>({ts:end-1000,knownAt:end,bids:[{price:100,size:2}],asks:[{price:102,size:3}],sequenceVerified:false});
test("session backfill survives process restart, preserves exact moments and never marks a tail complete",async()=>{
 const storage=new MemoryTerminalHistoryStorage(()=>end),fetchTrades=source(),options={storage,now:()=>end,fetchTrades,fetchBook:book,namespace:"session-restart"};
 const first=new TerminalMarketHistory(options);await first.ensure({instId:"BTC-USDT",start:day,end});await first.collect({instId:"BTC-USDT",maxJobs:1,maxPages:1});
 const partial=await first.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end});assert.equal(partial.complete,false);assert.ok(partial.gaps.length);assert.equal(partial.totals?.trades,1);
 const second=new TerminalMarketHistory(options);await second.collect({instId:"BTC-USDT",maxJobs:2,maxPages:1});
 const complete=await second.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end});assert.equal(complete.complete,true);assert.equal(complete.totals?.buy,1);assert.equal(complete.totals?.sell,2);assert.equal(complete.totals?.trades,2);assert.ok(Math.abs(complete.totals!.notional-302.5)<1e-10);
 await assert.rejects(second.readSession({instId:"BTC-USDT",marketType:"spot",start:day+1,end}));
});
test("book history retains real changes, separates missing time and rejects crossed observations",async()=>{
 const storage=new MemoryTerminalHistoryStorage(()=>end),history=new TerminalMarketHistory({storage,now:()=>end,fetchTrades:source(),fetchBook:book});
 await history.appendBook("BTC-USDT",{ts:day+1000,knownAt:end,bids:[{price:100,size:2}],asks:[{price:102,size:3}]});
 await history.appendBook("BTC-USDT",{ts:day+2000,knownAt:end,bids:[{price:100,size:5}],asks:[{price:102,size:3}]});
 await history.appendBook("BTC-USDT",{ts:day+121000,knownAt:end,bids:[{price:99,size:8}],asks:[{price:101,size:2}]});
 const result=await history.readLiquidity({instId:"BTC-USDT",start:day,end});assert.equal(result.frames.length,2);assert.equal(result.frames[0].bids[0].size,5);assert.equal(result.status,"partial");assert.deepEqual(result.gaps.map(g=>[g.start,g.end]),[[day+60000,day+120000]]);
 await assert.rejects(history.appendBook("BTC-USDT",{ts:day,knownAt:end,bids:[{price:103,size:1}],asks:[{price:102,size:1}]}));
});
test("collector lease prevents parallel work and market quantities remain separate",async()=>{
 const storage=new MemoryTerminalHistoryStorage(()=>end),fetchTrades=source(),history=new TerminalMarketHistory({storage,now:()=>end,fetchTrades,fetchBook:book,namespace:"lease"});
 await history.ensure({instId:"BTC-USDT",start:day,end});const results=await Promise.all([history.collect({instId:"BTC-USDT",maxJobs:1}),history.collect({instId:"BTC-USDT",maxJobs:1})]);assert.equal(results.filter(r=>r.alreadyRunning).length,1);
 const spot=await history.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end}),perp=await history.readSession({instId:"BTC-USDT",marketType:"perpetual",start:day,end});assert.equal(spot.quantityUnit,"base");assert.equal(perp.quantityUnit,"contracts");assert.equal(perp.totals,null);
});

const minute=60000,fullDay=86400000;
function emptyBatch(knownAt:number):OkxHistoryBatch{return{trades:[],knownAt,reachedStart:true,pages:1,pageHashes:[sha]};}
function frame(ts:number,knownAt:number):TerminalBookHistoryFrame{return{ts,knownAt,bids:[{price:100,size:2}],asks:[{price:102,size:3}]};}
class CountingStorage extends MemoryTerminalHistoryStorage{
 chunkReads=0;bookWrites=0;writes=0;
 override async get<T>(key:string){if(key.includes(":chunk:"))this.chunkReads++;return super.get<T>(key);}
 override async cas(...args:Parameters<MemoryTerminalHistoryStorage["cas"]>){this.writes++;if(args[0].includes(":book-hour:"))this.bookWrites++;return super.cas(...args);}
}

test("real book clock skew is bounded, invalid ladders fail, and display sample limits are exact",async()=>{
 const history=new TerminalMarketHistory({storage:new MemoryTerminalHistoryStorage(()=>end),now:()=>end});
 await history.appendBook("BTC-USDT",frame(end+4500,end));
 await assert.rejects(history.appendBook("BTC-USDT",frame(end+5001,end)),/Invalid real book/);
 await assert.rejects(history.appendBook("BTC-USDT",frame(Number.NaN,end)),/Invalid real book/);
 await assert.rejects(history.appendBook("BTC-USDT",{...frame(day,end),bids:[{price:99,size:1},{price:100,size:1}]}),/Invalid real book/);
 await history.appendBook("BTC-USDT",frame(day+1000,end));
 await history.appendBook("BTC-USDT",frame(day+minute+1000,end));
 const single=await history.readLiquidity({instId:"BTC-USDT",start:day,end,maxSamples:1});
 assert.equal(single.frames.length,1);assert.equal(single.frames[0].ts,day+minute+1000);
 await assert.rejects(history.readLiquidity({instId:"BTC-USDT",start:day,end,maxSamples:0}));
});

test("archive source gaps survive complete minute sampling and archive storage writes are batched by hour",async()=>{
 const now=day+4*fullDay+3*minute,storage=new CountingStorage(()=>now),gap={start:day+15000,end:day+20000,reason:"Exchange archive lost sequence coverage"};
 const history=new TerminalMarketHistory({storage,now:()=>now,namespace:"archive-gaps",fetchTrades:async()=>emptyBatch(now),tradeArchive:async()=>emptyBatch(now),fetchBook:async()=>frame(now-1000,now),bookArchive:async()=>({frames:Array.from({length:1440},(_,i)=>frame(day+i*minute+1000,now)),gaps:[gap],sha256:sha})});
 await history.ensure({instId:"BTC-USDT",start:day,end:day+fullDay});
 await history.collect({instId:"BTC-USDT",maxJobs:1});
 const retained=await history.readLiquidity({instId:"BTC-USDT",start:day,end:day+fullDay,maxSamples:1440});
 assert.equal(retained.frames.length,1440);assert.equal(retained.status,"partial");assert.deepEqual(retained.gaps,[gap]);
 assert.equal(storage.bookWrites,25,"one current observation plus 24 hourly archive writes");
});

test("an expired collector cannot commit source data after a replacement collector takes the lease",async()=>{
 let now=end,started!:()=>void,release!:()=>void;const startedPromise=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 const storage=new MemoryTerminalHistoryStorage(()=>now),options={storage,now:()=>now,namespace:"expired-lease",fetchBook:async()=>frame(now-1000,now)};
 const stale=new TerminalMarketHistory({...options,fetchTrades:async()=>{started();await held;return{...emptyBatch(now),trades:[{id:"2",ts:day+1000,price:999,size:99,side:"buy" as const}]};}});
 await stale.ensure({instId:"BTC-USDT",start:day,end});const staleRun=stale.collect({instId:"BTC-USDT",maxJobs:1});await startedPromise;
 now+=301000;const replacement=new TerminalMarketHistory({...options,fetchTrades:async()=>({...emptyBatch(now),trades:[{id:"1",ts:day+1000,price:100,size:1,side:"buy" as const}]})});
 await replacement.collect({instId:"BTC-USDT",maxJobs:1});release();await assert.rejects(staleRun,/lease changed/);
 const retained=await replacement.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end});
 assert.equal(retained.totals?.trades,1);assert.equal(retained.totals?.buy,1);assert.equal(retained.totals?.close,100);assert.equal(retained.backfill.state,"complete");
});

test("resumed history passes the oldest clock and same-millisecond trade IDs determine OHLC",async()=>{
 const storage=new MemoryTerminalHistoryStorage(()=>end),inputs:{afterId?:string;afterAt?:number}[]=[];
 const fetchTrades=async(input:{instId:string;afterId?:string;afterAt?:number}):Promise<OkxHistoryBatch>=>{inputs.push(input);return input.afterId?{...emptyBatch(end),trades:[{id:"9",ts:day+1000,price:100,size:1,side:"buy"}],oldestAt:day-1}:{...emptyBatch(end),trades:[{id:"10",ts:day+1000,price:102,size:2,side:"sell"}],reachedStart:false,nextAfterId:"10",oldestAt:day+1000};};
 const options={storage,now:()=>end,fetchTrades,fetchBook:book,namespace:"tie-clock"},first=new TerminalMarketHistory(options);
 await first.ensure({instId:"BTC-USDT",start:day,end});await first.collect({instId:"BTC-USDT",maxJobs:1});
 const restarted=new TerminalMarketHistory(options);await restarted.collect({instId:"BTC-USDT",maxJobs:2});
 const spot=await restarted.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end});
 assert.equal(inputs.find(input=>input.afterId==="10")?.afterAt,day+1000);assert.equal(spot.totals?.open,100);assert.equal(spot.totals?.close,102);assert.equal(spot.totals?.trades,2);assert.equal(spot.totals?.squaredNotional,30808);
});

test("completed-day compaction preserves quantities while restart reads use bounded cached shards",async()=>{
 const now=day+fullDay+minute,storage=new CountingStorage(()=>now);let nextId=33;
 const fetchTrades=async(input:{instId:string;start:number;end:number}):Promise<OkxHistoryBatch>=>{
  if(input.instId!=="BTC-USDT"||input.start!==day||input.end!==day+fullDay)return emptyBatch(now);
  const id=nextId--;return{trades:[{id:String(id),ts:day+(id-1)*minute+1000,price:100+id,size:1,side:"buy"}],knownAt:now,reachedStart:id===1,nextAfterId:String(id),pages:1,pageHashes:[sha],oldestAt:id===1?day-1:day+(id-1)*minute+1000};
 };
 const options={storage,now:()=>now,fetchTrades,fetchBook:async()=>frame(now-1000,now),namespace:"compact-day"},history=new TerminalMarketHistory(options);
 await history.ensure({instId:"BTC-USDT",start:day,end:day+fullDay});
 for(let cycle=0;cycle<140&&nextId>0;cycle++)await history.collect({instId:"BTC-USDT",maxJobs:1});
 assert.equal(nextId,0);storage.chunkReads=0;const restarted=new TerminalMarketHistory(options),result=await restarted.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end:day+fullDay});
 assert.equal(result.complete,true);assert.equal(result.totals?.trades,33);assert.equal(result.totals?.buy,33);assert.equal(result.totals?.open,101);assert.equal(result.totals?.close,133);assert.ok(storage.chunkReads<=2,"33 backwards pages compact into one retained hour shard");
 const reads=storage.chunkReads;await restarted.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end:day+fullDay});assert.equal(storage.chunkReads,reads,"decoded immutable chunks are reused");
});

test("custom session bars stay inside the requested window and source clocks do not refresh on reads",async()=>{
 let now=end;const storage=new MemoryTerminalHistoryStorage(()=>now),history=new TerminalMarketHistory({storage,now:()=>now,fetchTrades:async()=>({...emptyBatch(end),trades:Array.from({length:3},(_,i)=>({id:String(i+1),ts:day+i*minute+1000,price:100+i,size:1,side:"buy" as const}))}),fetchBook:book,namespace:"display-bounds"});
 await history.ensure({instId:"BTC-USDT",start:day,end});await history.collect({instId:"BTC-USDT",maxJobs:1});now+=minute;
 const result=await history.readSession({instId:"BTC-USDT",marketType:"spot",start:day+minute,end,maxBars:1});
 assert.equal(result.knownAt,end);assert.equal(result.bars.length,1);assert.equal(result.bars[0].start,day+minute);assert.equal(result.bars[0].end,end);assert.equal(result.totals?.trades,2);
});

test("work classes rotate so slow captures and archives cannot repeatedly starve execution history",async(t)=>{
 let wall=1000;const now=day+4*fullDay+3*minute;t.mock.method(Date,"now",()=>wall);
 const storage=new MemoryTerminalHistoryStorage(()=>now),history=new TerminalMarketHistory({storage,now:()=>now,namespace:"phase-fairness",fetchBook:async()=>{wall+=30;return frame(now-1000,now);},fetchTrades:async()=>{wall+=30;return emptyBatch(now);},tradeArchive:async()=>{wall+=30;return emptyBatch(now);},bookArchive:async()=>{wall+=30;return{frames:[frame(day+1000,now)],gaps:[]};}});
 await history.ensure({instId:"BTC-USDT",start:day,end:day+fullDay});const results=[];
 for(let cycle=0;cycle<3;cycle++)results.push(await history.collect({instId:"BTC-USDT",maxJobs:1,maxWorkMs:20}));
 assert.equal(results[0].books,1);assert.equal(results[0].trades,0);assert.equal(results[1].archives,1);assert.equal(results[1].trades,0);assert.equal(results[2].trades,1);
});

test("ensuring an unchanged public window is idempotent and a future minute is never treated as closed",async()=>{
 const storage=new CountingStorage(()=>end),history=new TerminalMarketHistory({storage,now:()=>end,namespace:"ensure-idempotent"});
 await history.ensure({instId:"BTC-USDT",start:day,end});const writes=storage.writes;await history.ensure({instId:"BTC-USDT",start:day,end});assert.equal(storage.writes,writes);
 const early=new TerminalMarketHistory({storage,now:()=>end-1000});await assert.rejects(early.ensure({instId:"BTC-USDT",start:day,end}),/whole UTC minutes/);
});

test("retained decimal price rows do not fall one tick below their exact grid during reaggregation",async()=>{
 const storage=new MemoryTerminalHistoryStorage(()=>end),ns="decimal-grid:terminal-public-history:v1",totals={buy:1,sell:0,trades:1,notional:80612.34,squaredNotional:80612.34**2,open:80612.34,high:80612.34,low:80612.34,close:80612.34,firstTradeAt:day+1000,lastTradeAt:day+1000,firstTradeId:"1",lastTradeId:"1"};
 const raw=JSON.stringify({step:.01,knownAt:end,hashes:[sha],bars:[{...totals,start:day,end:day+minute,rows:[{low:80612.339999999997,high:80612.35,buy:1,sell:0,trades:1}]}]}),id=createHash("sha256").update(raw).digest("hex");
 await storage.put(`${ns}:chunk:${id}`,{sha256:id,gzip:gzipSync(raw).toString("base64")},86400);
 await storage.put(`${ns}:day:BTC-USDT:spot:${day}`,{revision:1,instId:"BTC-USDT",marketType:"spot",day,target:day+minute,coveredEnd:day+minute,refs:[id],knownAt:end},86400);
 const history=new TerminalMarketHistory({storage,now:()=>end,namespace:"decimal-grid"}),result=await history.readSession({instId:"BTC-USDT",marketType:"spot",start:day,end:day+minute});
 assert.deepEqual(result.rows,[{low:80612.34,high:80612.35,buy:1,sell:0,trades:1}]);assert.equal(result.totals?.notional,80612.34);
});
