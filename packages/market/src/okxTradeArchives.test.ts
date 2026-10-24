import test from "node:test";
import assert from "node:assert/strict";
import {deflateRawSync} from "node:zlib";
import {decodeOkxTradeArchive,latestCompleteOkxUtcTradeDay,okxTradeArchiveDates,OkxTradeArchiveClient as ArchiveClient,reconcileOkxDailyTradeCapture} from "./okxTradeArchives.js";
class OkxTradeArchiveClient extends ArchiveClient{constructor(options:ConstructorParameters<typeof ArchiveClient>[0]={}){super({catalogueSpacingMs:0,...options});}}

const DAY=86_400_000,day=Date.UTC(2026,6,5),now=Date.UTC(2026,9,24,18),capturedAt=new Date(now).toISOString(),header="instrument_name,trade_id,side,price,size,created_time,source\n";
function crc(bytes:Buffer){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;}
function zip(text:string,{name="trades.csv",method=8}={}){
  const bytes=Buffer.from(text),packed=method===8?deflateRawSync(bytes):bytes,n=Buffer.from(name),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22),sum=crc(bytes);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(sum,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(n.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);central.writeUInt32LE(sum,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(n.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(local.length+n.length+packed.length,16);return Buffer.concat([local,n,packed,central,n,end]);
}
function csv(instId="HYPE-USDT",later=false,gap=false){
  const rows=later?[[gap?14:13,"sell",68,3,day+16*3_600_000],[gap?15:14,"buy",70,4,day+DAY-1],[gap?16:15,"buy",72,5,day+DAY+3_600_000]]:[[10,"sell",65,1,day-4*3_600_000],[11,"buy",69,1,day],[12,"sell",71,2,day+16*3_600_000-1]];
  return header+rows.map(r=>[instId,...r,"exchange"].join(",")).join("\n")+"\n";
}
function mock(options:{instId?:string;badUrl?:boolean;gap?:boolean;oversize?:boolean;failure?:boolean}={}){
  const state={calls:[] as {url:string;init:RequestInit|undefined}[],cancelled:false},instId=options.instId??"HYPE-USDT";
  const fetchImpl=(async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=String(input);state.calls.push({url,init});assert.equal(init?.redirect,"error");
    if(options.failure)return new Response("rate limited",{status:429});
    if(url.startsWith("https://www.okx.com/priapi/")){
      const request=JSON.parse(String(init?.body)),date=new Date(Number(request.dateQuery.begin)).toISOString().slice(0,10),file=instId+"-trades-"+date+".zip";
      assert.equal(request.module,"1");assert.equal(request.instType,"SPOT");assert.deepEqual(request.instQueryParam.instIdList,[instId]);
      return Response.json({code:"0",data:{details:[{instId,instType:"SPOT",groupDetails:[{dateTs:String(Date.parse(date+"T00:00:00Z")-8*3_600_000),filename:file,sizeMB:"0",url:(options.badUrl?"https://example.org":"https://static.okx.com")+"/cdn/okex/traderecords/trades/daily/"+date.replaceAll("-","")+"/"+file}]}]}});
    }
    if(options.oversize)return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(101));},cancel(){state.cancelled=true;}}));
    return new Response(zip(csv(instId,url.includes("2026-07-06"),!!options.gap)));
  }) as typeof fetch;return {state,fetchImpl};
}
const input={instId:"HYPE-USDT",date:"2026-07-05",capturedAt};
test("UTC trade days require two adjacent UTC+8 archives and exclude still-developing source days",()=>{
  assert.deepEqual(okxTradeArchiveDates(day,day+DAY),["2026-07-05","2026-07-06"]);
  assert.deepEqual(okxTradeArchiveDates(day-8*3_600_000,day+16*3_600_000),["2026-07-05"]);
  assert.deepEqual(latestCompleteOkxUtcTradeDay(Date.UTC(2026,6,6,6)),{start:day-DAY,end:day});
  assert.deepEqual(latestCompleteOkxUtcTradeDay(Date.UTC(2026,6,6,18)),{start:day,end:day+DAY});
  assert.throws(()=>okxTradeArchiveDates(day,day+DAY+1));assert.throws(()=>okxTradeArchiveDates(NaN,day));
});
test("ZIP decoder retains actual trades, source CRC and IDs beyond the JS integer range",()=>{
  const text='\ufeff'+header+'"HYPE-USDT","9007199254740993","buy","69.5","1.25","'+day+'","exchange"\r\nHYPE-USDT,9007199254740994,sell,70,2,'+(day+1)+',exchange\n';
  for(const method of [0,8]){const r=decodeOkxTradeArchive(zip(text,{method}),input);assert.equal(r.trades.length,2);assert.equal(r.trades[0].id,"9007199254740993");assert.equal(r.proof.crcVerified,true);assert.equal(r.proof.rows,2);assert.equal(r.proof.sha256.length,64);assert.equal(r.trades[0].size,1.25);}
});
test("ZIP corruption, expansion bounds, multiple members and unsafe names cannot supply coverage",()=>{
  const good=zip(csv());const crcBad=Buffer.from(good);crcBad.writeUInt32LE(0,good.readUInt32LE(good.length-6)+16);
  assert.throws(()=>decodeOkxTradeArchive(crcBad,input),/CRC/);
  assert.throws(()=>decodeOkxTradeArchive(good,{...input,maxOutputBytes:4}),/oversized/);
  const countBad=Buffer.from(good);countBad.writeUInt16LE(2,countBad.length-12);assert.throws(()=>decodeOkxTradeArchive(countBad,input),/one ordinary/);
  assert.throws(()=>decodeOkxTradeArchive(zip(csv(),{name:"../trades.csv"}),input),/member/);
  assert.throws(()=>decodeOkxTradeArchive(Buffer.from("not a zip"),input));
});
test("wrong instruments, malformed fields and missing or reversed prints fail closed",()=>{
  const good=csv(),mutations=[good.replaceAll("HYPE-USDT","BTC-USDT"),good.replace(",buy,",",unknown,"),good.replace(",69,",",0x45,"),good.replace(",69,",",NaN,"),good.replace(",69,1,",",69,-1,"),good.replace("HYPE-USDT,11,","HYPE-USDT,13,"),good.replace(String(day)," "),good.replace(String(day+16*3_600_000-1),String(day-5*3_600_000)),header];
  for(const text of mutations)assert.throws(()=>decodeOkxTradeArchive(zip(text),input));
  assert.throws(()=>decodeOkxTradeArchive(zip(good),{...input,maxRows:1}),/row bound/);
});
test("client joins the actual UTC window and preserves cached knowledge times",async()=>{
  const {fetchImpl,state}=mock();let clock=now;const client=new OkxTradeArchiveClient({fetchImpl,now:()=>clock});
  const r=await client.capture("HYPE-USDT",day,day+DAY);assert.equal(state.calls.length,4);assert.deepEqual(r.capture.trades.map(t=>t.id),["11","12","13","14"]);assert.equal(r.capture.coverage.start,day);assert.equal(r.capture.coverage.end,day+DAY);assert.equal(r.capture.coverage.knownAt,now);assert.equal(r.archives.length,2);
  clock+=60_000;const cached=await client.capture("HYPE-USDT",day,day+DAY);assert.equal(state.calls.length,4);assert.equal(cached.capture.coverage.knownAt,now);assert.throws(()=>{(cached.capture.trades[0] as {price:number}).price=1});assert.equal(r.capture.trades[0].price,69);
});
test("concurrent identical captures share bounded work and a complete immutable result",async()=>{
  const {fetchImpl,state}=mock(),client=new OkxTradeArchiveClient({fetchImpl,now:()=>now});const [a,b]=await Promise.all([client.capture("HYPE-USDT",day,day+DAY),client.capture("HYPE-USDT",day,day+DAY)]);assert.equal(state.calls.length,4);assert.equal(a,b);assert.ok(Object.isFrozen(a.capture.coverage.sha256));
});
test("archive sequence gaps and source HTTP errors are retained as failures and allow later retry",async()=>{
  const options={gap:true},m=mock(options),client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>now});await assert.rejects(client.capture("HYPE-USDT",day,day+DAY),/complete sequence/);options.gap=false;assert.equal((await client.capture("HYPE-USDT",day,day+DAY)).capture.trades.length,4);assert.equal(m.state.calls.length,6);
  const failure={failure:true},n=mock(failure);let clock=now;const retry=new OkxTradeArchiveClient({fetchImpl:n.fetchImpl,now:()=>clock});await assert.rejects(retry.capture("HYPE-USDT",day,day+DAY),/HTTP 429/);failure.failure=false;await assert.rejects(retry.capture("HYPE-USDT",day,day+DAY),/HTTP 429/);assert.equal(n.state.calls.length,1);clock+=60_000;assert.equal((await retry.capture("HYPE-USDT",day,day+DAY)).capture.trades.length,4);
});
test("catalogue substitutions never send an archive request to a different host",async()=>{
  const m=mock({badUrl:true}),client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>now});await assert.rejects(client.capture("HYPE-USDT",day,day+DAY),/selection/);assert.equal(m.state.calls.length,1);
});
test("unadvertised oversized response bodies are cancelled before decoding",async()=>{
  const m=mock({oversize:true}),client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>now,maxCompressedBytes:100});await assert.rejects(client.capture("HYPE-USDT",day,day+DAY),/size bound/);assert.equal(m.state.cancelled,true);
});
test("capture bounds and unfinished UTC+8 archives cannot be bypassed by a completed UTC date",async()=>{
  const m=mock(),client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>day+DAY+2*3_600_000});await assert.rejects(client.capture("HYPE-USDT",day,day+DAY),/still developing/);assert.equal(m.state.calls.length,0);
  const limited=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>now,maxCaptureTrades:3});await assert.rejects(limited.capture("HYPE-USDT",day,day+DAY),/capture row bound/);assert.throws(()=>new OkxTradeArchiveClient({maxOutputBytes:-1}));await assert.rejects(limited.capture("HYPE-USDT-SWAP",day,day+DAY),/Spot instrument/);
});
test("expired raw cache entries acquire new capture knowledge instead of backdating a new download",async()=>{
  const m=mock();let clock=now;const client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>clock,cacheAgeMs:100});await client.capture("HYPE-USDT",day,day+DAY);clock+=100;const r=await client.capture("HYPE-USDT",day,day+DAY);assert.equal(m.state.calls.length,8);assert.equal(r.capture.coverage.knownAt,clock);
});
test("all six Spot identities retain their own units, symbols and source windows",async()=>{
  for(const asset of ["BTC","ETH","HYPE","SOL","BNB","XRP"]){const instId=asset+"-USDT",m=mock({instId}),client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>now});const r=await client.capture(instId,day,day+DAY);assert.equal(r.capture.instId,instId);assert.equal(r.capture.quantityUnit,"base");assert.equal(r.capture.marketType,"spot");}
});
test("daily OHLC/volume reconciliation is required even for a weekly context profile",async()=>{
  const m=mock(),client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>now}),{capture}=await client.capture("HYPE-USDT",day,day+DAY),reference={source:"okx-public-spot",instId:"HYPE-USDT",bar:"1Dutc",fetchedAt:capturedAt,candle:{ts:day,open:69,high:71,low:68,close:70,volume:10,confirmed:true}};
  assert.equal(reconcileOkxDailyTradeCapture(capture,reference).volume,10);
  for(const r of [{...reference,source:"other-venue"},{...reference,instId:"BTC-USDT"},{...reference,bar:"1Wutc"},{...reference,candle:{...reference.candle,confirmed:false}},{...reference,candle:{...reference.candle,volume:11}},{...reference,fetchedAt:new Date(now-1).toISOString()}])assert.throws(()=>reconcileOkxDailyTradeCapture(capture,r));
  const malformed=structuredClone(capture);malformed.coverage.knownAt=NaN;assert.throws(()=>reconcileOkxDailyTradeCapture(malformed,reference));
});
test("publication delays select the newest fully available pair and retain its actual dates",async()=>{
  const calls:string[]=[];
  const fetchImpl=(async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=String(input);calls.push(url);
    if(url.includes('/priapi/')){
      const date=new Date(Number(JSON.parse(String(init?.body)).dateQuery.begin)).toISOString().slice(0,10),file='HYPE-USDT-trades-'+date+'.zip';
      return Response.json({code:'0',data:{details:date==='2026-07-06'?[]:[{instId:'HYPE-USDT',instType:'SPOT',groupDetails:[{dateTs:String(Date.parse(date+'T00:00:00Z')-8*3_600_000),filename:file,sizeMB:'0',url:'https://static.okx.com/cdn/okex/traderecords/trades/daily/'+date.replaceAll('-','')+'/'+file}]}]}});
    }
    const date=/trades-(\d{4}-\d{2}-\d{2})/.exec(url)![1],start=Date.parse(date+'T00:00:00Z')-8*3_600_000,base=100000+(Date.parse(date+'T00:00:00Z')-day)/DAY*3;
    return new Response(zip(header+[0,1,2].map(i=>'HYPE-USDT,'+(base+i)+',buy,69,1,'+(start+[1,12*3_600_000,23*3_600_000][i])+',exchange').join('\n')+'\n'));
  }) as typeof fetch;
  const client=new OkxTradeArchiveClient({fetchImpl,now:()=>day+DAY+18*3_600_000}),r=await client.captureRecentUtcDay('HYPE-USDT');
  assert.equal(r.capture.coverage.start,day-DAY);assert.equal(r.capture.coverage.end,day);assert.deepEqual(r.archives.map(a=>a.date),['2026-07-04','2026-07-05']);assert.equal(calls.length,5);assert.equal(r.capture.trades.length,3);
});
test("rate limits do not trigger repeated queries for older archive days",async()=>{
  const m=mock({failure:true}),client=new OkxTradeArchiveClient({fetchImpl:m.fetchImpl,now:()=>now});await assert.rejects(client.captureRecentUtcDay('HYPE-USDT'),/HTTP 429/);assert.equal(m.state.calls.length,1);await assert.rejects(client.captureRecentUtcDay('HYPE-USDT',8),/lookback/);
});
test("catalogue calls are paced without changing retained source knowledge",async()=>{
  const m=mock();let clock=now;const waits:number[]=[];const client=new ArchiveClient({fetchImpl:m.fetchImpl,now:()=>clock,catalogueSpacingMs:1200,wait:async ms=>{waits.push(ms);clock+=ms;}}),r=await client.capture('HYPE-USDT',day,day+DAY);assert.deepEqual(waits,[1200]);assert.equal(r.capture.coverage.knownAt,now+1200);assert.equal(m.state.calls.length,4);
});
test("server Retry-After suppresses new requests until the declared cooldown",async()=>{
  let clock=now,calls=0;const client=new OkxTradeArchiveClient({now:()=>clock,fetchImpl:(async()=>{calls++;return new Response('rate limited',{status:429,headers:{'Retry-After':'90'}});}) as typeof fetch});await assert.rejects(client.capture('HYPE-USDT',day,day+DAY),/HTTP 429/);clock+=60_000;await assert.rejects(client.capture('HYPE-USDT',day,day+DAY),/HTTP 429/);assert.equal(calls,1);clock+=30_000;await assert.rejects(client.capture('HYPE-USDT',day,day+DAY),/HTTP 429/);assert.equal(calls,2);
});
