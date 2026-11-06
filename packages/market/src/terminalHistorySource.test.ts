import test from "node:test";
import assert from "node:assert/strict";
import {gzipSync} from "node:zlib";
import {OkxTradeHistoryClient,decodeOkxBookArchive,loadOkxBookArchive,loadOkxSessionTradeArchive} from "./terminalHistorySource.js";
const day=Date.UTC(2026,10,1),now=day+4*86400000;
const trade=(id:number,ts:number)=>({instId:"BTC-USDT",tradeId:String(id),ts:String(ts),px:"100.25",sz:"2",side:"buy"});
test("timestamp seek then ID pages retain executions sharing the same millisecond and resume exact cursors",async()=>{
 const requests:string[]=[];let call=0;const client=new OkxTradeHistoryClient({now:()=>now,wait:async()=>{},fetchImpl:async input=>{requests.push(String(input));return new Response(JSON.stringify({code:"0",data:call++===0?[trade(4,day+100),trade(3,day+100)]:[trade(2,day+100),trade(1,day+99)]}));}});
 const first=await client.fetchBatch({instId:"BTC-USDT",start:day+100,end:day+200,maxPages:1});assert.equal(first.reachedStart,false);assert.equal(first.nextAfterId,"3");
 const second=await client.fetchBatch({instId:"BTC-USDT",start:day+100,end:day+200,afterId:first.nextAfterId,maxPages:1});assert.equal(second.reachedStart,true);assert.deepEqual([...first.trades,...second.trades].map(t=>t.id).sort(),["2","3","4"]);assert.match(requests[0],/type=2/);assert.match(requests[1],/type=1&after=3/);
});
const clientFor=(pages:unknown[][],clock=now)=>{let call=0;return new OkxTradeHistoryClient({now:()=>clock,wait:async()=>{},fetchImpl:async()=>new Response(JSON.stringify({code:"0",data:pages[call++]??[]}))});};
test("empty pages, repeated IDs and timestamp reversal cannot declare a covered interval",async()=>{
 const request={instId:"BTC-USDT",start:day+100,end:day+200,maxPages:2};
 for(const pages of [[[]],[[trade(4,day+100)],[]],[[trade(4,day+100)],[{...trade(4,day+100),px:"200"}]],[[trade(4,day+101)],[trade(3,day+102)]]])await assert.rejects(clientFor(pages).fetchBatch(request));
 await assert.rejects(clientFor([[trade(3,day+102)]]).fetchBatch({...request,afterId:"4",afterAt:day+101}),/timestamp/);
});
test("three calendar months are accepted without a 90-day truncation and future windows are rejected",async()=>{
 const oldest=Date.UTC(2026,7,5),client=clientFor([[trade(2,oldest+1),trade(1,oldest-1)]]);
 assert.equal((await client.fetchBatch({instId:"BTC-USDT",start:oldest,end:oldest+100})).reachedStart,true);
 await assert.rejects(clientFor([[]]).fetchBatch({instId:"BTC-USDT",start:oldest-1,end:oldest+100}),/window/);
 await assert.rejects(clientFor([[]]).fetchBatch({instId:"BTC-USDT",start:now-100,end:now+1}),/window/);
});
function catalogue(module:"1"|"4",changes:Record<string,unknown>={},date="2026-11-01"){const name=`BTC-USDT-${module==="4"?"L2orderbook-400lv":"trades"}-${date}.${module==="4"?"tar.gz":"zip"}`,path=module==="4"?"okx/match/orderbook/pro/L2/400lv":"okex/traderecords/trades";return[{details:[{instType:"SPOT",instId:"BTC-USDT",groupDetails:[{filename:name,url:`https://static.okx.com/cdn/${path}/daily/${date.replaceAll("-","")}/${name}${module==="1"?"?v=1001":""}`,dateTs:String(Date.parse(date+"T00:00:00Z")-(module==="1"?8*3600000:0)),sizeMB:"1.38",...changes}]}]}];}
test("catalogue requests retain their slower provider cadence even around faster history reads",async()=>{
 for(const spacingMs of [undefined,1]){let clock=now;const waits:number[]=[],requests:{at:number;catalogue:boolean}[]=[];
  const client=new OkxTradeHistoryClient({spacingMs,now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},fetchImpl:async input=>{const isCatalogue=String(input).includes("/public/market-data-history?");requests.push({at:clock,catalogue:isCatalogue});return Response.json({code:"0",data:isCatalogue?catalogue("4"):[trade(2,day+100),trade(1,day+99)]});}}),input={instId:"BTC-USDT",date:"2026-11-01",module:"4" as const};
  await Promise.all([client.archiveFile(input),client.archiveFile(input)]);
  await client.fetchBatch({instId:"BTC-USDT",start:day+100,end:day+200,maxPages:1});await client.archiveFile(input);
  assert.deepEqual(waits,[450,150,450]);assert.deepEqual(requests.map(r=>r.at-now),[0,450,600,1050]);
  const stamps=requests.filter(r=>r.catalogue).map(r=>r.at);assert.ok(stamps.slice(1).every((stamp,i)=>stamp-stamps[i]>=450));
 }
});
test("only explicit fully injected fixtures can request zero cadence",async()=>{
 let waits=0;const client=new OkxTradeHistoryClient({spacingMs:0,now:()=>now,wait:async()=>{waits++;},fetchImpl:async()=>Response.json({code:"0",data:catalogue("4")})}),input={instId:"BTC-USDT",date:"2026-11-01",module:"4" as const};
 await client.archiveFile(input);await client.archiveFile(input);assert.equal(waits,0);
 for(const spacingMs of [NaN,-1,1.5])assert.throws(()=>new OkxTradeHistoryClient({spacingMs}),/cadence/);
});
test("official archive identity binds source path, UTC versus UTC+8 date and exact file metadata",async()=>{
 for(const module of ["1","4"]as const){const file=await clientFor([catalogue(module)]).archiveFile({instId:"BTC-USDT",date:"2026-11-01",module});assert.match(file.url,/static\.okx\.com\/cdn\//);}
 const base=(catalogue("4")[0].details[0].groupDetails[0]).url;
 for(const changes of [{url:base.replace("static.okx.com","example.com")},{url:base.replace("/400lv/","/5000lv/")},{url:base+"?redirect=elsewhere"},{url:base.replace("https://","https://user:pass@")},{dateTs:String(day-8*3600000)},{sizeMB:"1000"}])await assert.rejects(clientFor([catalogue("4",changes)]).archiveFile({instId:"BTC-USDT",date:"2026-11-01",module:"4"}),/official archive/);
 await assert.rejects(clientFor([catalogue("1",{dateTs:String(day)})]).archiveFile({instId:"BTC-USDT",date:"2026-11-01",module:"1"}),/official archive/);
});
test("REST depth refuses duplicate, unordered, crossed or stale levels",async()=>{
 const bid=["100","2","0","1"],ask=["102","3","0","1"],base={ts:String(now),bids:[bid],asks:[ask]};
 assert.equal((await clientFor([[base]]).book("BTC-USDT")).bids[0].price,100);
 for(const data of [{...base,bids:[bid,bid]},{...base,bids:[bid,["101","1","0","1"]]},{...base,asks:[["99","1","0","1"]]},{...base,ts:String(now-15001)},{...base,bids:[["100","2","0","0.5"]]}])await assert.rejects(clientFor([[data]]).book("BTC-USDT"));
});
test("missing trade IDs and foreign instrument responses fail closed",async()=>{
 for(const data of [[trade(4,day+100),trade(2,day+99)],[{...trade(4,day+100),instId:"ETH-USDT"}]]){
  const client=new OkxTradeHistoryClient({now:()=>now,fetchImpl:async()=>new Response(JSON.stringify({code:"0",data}))});await assert.rejects(client.fetchBatch({instId:"BTC-USDT",start:day,end:day+200,maxPages:1}));
 }
});
function archive(lines:unknown[]){const bytes=Buffer.from(lines.map(x=>JSON.stringify(x)).join("\n")+"\n"),header=Buffer.alloc(512);header.write("BTC-USDT-L2orderbook-400lv-2026-11-01.data");header.write(bytes.length.toString(8).padStart(11,"0")+"\0",124);header.fill(32,148,156);header[156]=48;const sum=header.reduce((n,b)=>n+b,0);header.write(sum.toString(8).padStart(6,"0")+"\0 ",148);return Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512+1024)]);}
async function* pieces(buffer:Buffer){for(let at=0;at<buffer.length;at+=83)yield buffer.subarray(at,at+83);}
const snapshot=(ts=day)=>({instId:"BTC-USDT",action:"snapshot",ts:String(ts),bids:[["100","2","1"]],asks:[["102","3","1"]]});
function checksum(bytes:Buffer){bytes.fill(32,148,156);const sum=bytes.subarray(0,512).reduce((n,b)=>n+b,0);bytes.write(sum.toString(8).padStart(6,"0")+"\0 ",148);return bytes;}
test("historical heatmap replays actual updates and samples real states without extending into source gaps",async()=>{
 const data=archive([{instId:"BTC-USDT",action:"snapshot",ts:String(day),bids:[["100","2","1"]],asks:[["102","3","1"]]},{instId:"BTC-USDT",action:"update",ts:String(day+60000),bids:[["100","5","1"]],asks:[]},{instId:"BTC-USDT",action:"update",ts:String(day+86400000-1),bids:[],asks:[]}]);
 const result=await decodeOkxBookArchive(pieces(data),{instId:"BTC-USDT",date:"2026-11-01",knownAt:now,depth:20});assert.equal(result.records,3);assert.equal(result.frames[1].bids[0].size,5);assert.equal(result.frames[1].ts,day+60000);assert.equal(result.sequenceVerified,false);assert.ok(result.gaps.length>0);
 await assert.rejects(decodeOkxBookArchive(pieces(data.subarray(0,data.length-512)),{instId:"BTC-USDT",date:"2026-11-01",knownAt:now}));
 const malformed=Buffer.from(data);malformed[0]=47;await assert.rejects(decodeOkxBookArchive(pieces(malformed),{instId:"BTC-USDT",date:"2026-11-01",knownAt:now}));
});
test("archive rejects invalid octal headers, alternate tar prefixes and bounded malformed records",async()=>{
 const valid=archive([snapshot()]),octal=Buffer.from(valid),prefix=Buffer.from(valid);octal.write("00000000999\0",124);prefix.write("alternate/",345);
 for(const bytes of [checksum(octal),checksum(prefix),valid.subarray(0,600),Buffer.concat([valid,Buffer.from("unexpected")])])await assert.rejects(decodeOkxBookArchive(pieces(bytes),{instId:"BTC-USDT",date:"2026-11-01",knownAt:now}));
 await assert.rejects(decodeOkxBookArchive(pieces(valid),{instId:"BTC-USDT",date:"2026-11-01",knownAt:now,maxExpandedBytes:600}),/bound|member/);
 for(const sampleMs of [NaN,1000.5,0])await assert.rejects(decodeOkxBookArchive(pieces(valid),{instId:"BTC-USDT",date:"2026-11-01",knownAt:now,sampleMs}),/request/);
 await assert.rejects(decodeOkxBookArchive(pieces(archive([{...snapshot(),padding:"x".repeat(1000001)}])),{instId:"BTC-USDT",date:"2026-11-01",knownAt:now}),/record exceeds bound/);
 await assert.rejects(decodeOkxBookArchive(pieces(valid),{instId:"BTC-USDT",date:"2026-02-30",knownAt:now}),/request/);
});
test("archive gzip CRC is verified at EOF and corrupt compressed history is never accepted",async()=>{
 const compressed=gzipSync(archive([snapshot()])),client=clientFor([catalogue("4")]);
 const loaded=await loadOkxBookArchive(client,{instId:"BTC-USDT",date:"2026-11-01",now:()=>now,fetchImpl:async()=>new Response(compressed)});assert.equal(loaded.frames.length,1);assert.equal(loaded.bytes,compressed.length);assert.match(loaded.sha256,/^[a-f0-9]{64}$/);
 const corrupt=Buffer.from(compressed);corrupt[corrupt.length-8]^=1;
 await assert.rejects(loadOkxBookArchive(clientFor([catalogue("4")]),{instId:"BTC-USDT",date:"2026-11-01",now:()=>now,fetchImpl:async()=>new Response(corrupt)}),/check|CRC|incorrect/i);
 let calls=0;await assert.rejects(loadOkxBookArchive(clientFor([catalogue("4")]),{instId:"BTC-USDT",date:"2026-11-01",now:()=>now-calls++,fetchImpl:async()=>new Response(compressed)}),/clock moved backward/);
});
function storedTradeZip(rows:[number,number][]){
 const text="instrument_name,trade_id,side,price,size,created_time,source\n"+rows.map(([id,at])=>`BTC-USDT,${id},buy,100,2,${at},exchange`).join("\n")+"\n",bytes=Buffer.from(text),name=Buffer.from("trades.csv"),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);let crc=0xffffffff;
 for(const b of bytes){crc^=b;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}crc=(crc^0xffffffff)>>>0;
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+bytes.length,16);return Buffer.concat([local,name,bytes,central,name,end]);
}
test("UTC day archive loading joins both UTC+8 files and validates even unselected boundary executions",async()=>{
 const catalogues=[catalogue("1"),catalogue("1",{},"2026-11-02")],first=storedTradeZip([[10,day-1],[11,day+1],[12,day+16*3600000-1]]),second=storedTradeZip([[13,day+16*3600000],[14,day+86400000-1],[15,day+86400000+1]]);
 let part=0;const result=await loadOkxSessionTradeArchive(clientFor(catalogues),{instId:"BTC-USDT",start:day,end:day+86400000,now:()=>now,fetchImpl:async()=>new Response([first,second][part++])});
 assert.deepEqual(result.trades.map(t=>t.id),["11","12","13","14"]);assert.equal(result.pageHashes.length,2);assert.equal(result.reachedStart,true);
 part=0;const missing=storedTradeZip([[10,day-1]]),later=storedTradeZip([[12,day+16*3600000]]);
 await assert.rejects(loadOkxSessionTradeArchive(clientFor(catalogues),{instId:"BTC-USDT",start:day,end:day+86400000,now:()=>now,fetchImpl:async()=>new Response([missing,later][part++])}),/boundary has an execution gap/);
});
