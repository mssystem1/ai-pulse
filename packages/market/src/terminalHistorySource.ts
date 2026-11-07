import {createHash} from "node:crypto";
import {Readable} from "node:stream";
import {createGunzip} from "node:zlib";
import {decodeOkxTradePrint,type MarketTradePrint} from "./orderFlow.js";
import {decodeOkxArchiveBookRecord,MarketOrderBook} from "./orderBook.js";
import {decodeOkxTradeArchive,okxTradeArchiveDates} from "./okxTradeArchives.js";
const DAY=86400000;
const valid=(id:string)=>/^[A-Z0-9]{2,20}-(USDT|USDC|USD)(-SWAP)?$/.test(id);
export type OkxHistoryBatch={trades:MarketTradePrint[];knownAt:number;nextAfterId?:string;reachedStart:boolean;pages:number;pageHashes:string[];oldestAt?:number};
type ExchangeClock={exchangeClockOffsetMs:number;exchangeClockUncertaintyMs:number;exchangeClockVerifiedAt:number};
export type OkxHistoryBookFrame={ts:number;knownAt:number;bids:{price:number;size:number}[];asks:{price:number;size:number}[];sequenceVerified?:boolean}&Partial<ExchangeClock>;
export class OkxTradeHistoryClient{
 private tail:Promise<unknown>=Promise.resolve();private last=0;
 constructor(readonly options:{fetchImpl?:typeof fetch;now?:()=>number;wait?:(ms:number)=>Promise<void>;spacingMs?:number}={}){if(options.spacingMs!==undefined&&(!Number.isSafeInteger(options.spacingMs)||options.spacingMs<0))throw Error("Invalid public history request cadence");}
 private async get(path:string){
  const task=this.tail.then(async()=>{const clock=this.options.now??Date.now,wait=this.options.wait??(ms=>new Promise(r=>setTimeout(r,ms)));
   // Catalogue publication is limited to 5 requests/2s; trade history allows
   // 20/2s. The serialized queue must respect the slower endpoint separately.
   // Zero cadence is only for a fully injected, network-free clock fixture.
   const fixture=this.options.spacingMs===0&&this.options.fetchImpl&&this.options.now&&this.options.wait,minimum=path.startsWith("/api/v5/public/market-data-history?")?450:150,spacing=fixture?0:Math.max(minimum,this.options.spacingMs??minimum),delay=this.last+spacing-clock();if(delay>0)await wait(delay);this.last=clock();
   const requestStarted=clock(),response=await(this.options.fetchImpl??fetch)("https://www.okx.com"+path,{signal:AbortSignal.timeout(12000),redirect:"error",cache:"no-store",headers:{"Cache-Control":"no-cache","Pragma":"no-cache"}} as RequestInit&{cache:"no-store"});
   if(!response.ok){await response.body?.cancel();throw Error(`Public history HTTP ${response.status}`);}const reader=response.body?.getReader();if(!reader)throw Error("Public history response is empty");const chunks:Uint8Array[]=[];let bytes=0;
   try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1000000)throw Error("History response exceeds bound");chunks.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
   const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(body.code!=="0")throw Error(typeof body.code==="string"&&/^\d{1,8}$/.test(body.code)?`Public history exchange error ${body.code}`:"Public history unavailable");if(!Array.isArray(body.data))throw Error("Public history response has invalid data");
   const completed=clock(),httpDate=Date.parse(response.headers.get("date")??""),roundTrip=completed-requestStarted,offset=httpDate+500-(requestStarted+completed)/2;
   // HTTP Date has one-second precision. Retain local knownAt and record the
   // bounded calibration separately; it does not advance completed-bar cutoffs.
   const exchangeClock:ExchangeClock|undefined=Number.isSafeInteger(requestStarted)&&requestStarted>=0&&Number.isSafeInteger(completed)&&completed>=0&&roundTrip>=0&&roundTrip<=2000&&Number.isFinite(httpDate)&&Math.abs(offset)<=30000?{exchangeClockOffsetMs:offset,exchangeClockUncertaintyMs:500+roundTrip/2,exchangeClockVerifiedAt:completed}:undefined;
   return{data:body.data as Record<string,unknown>[],exchangeClock};
  });this.tail=task.catch(()=>{});return task;
 }
 async fetchBatch(input:{instId:string;start:number;end:number;afterId?:string;afterAt?:number;maxPages?:number}):Promise<OkxHistoryBatch>{
  const now=this.options.now??Date.now;
  const clock=now(),date=new Date(clock),month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-3,1),lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-2,0)).getUTCDate(),oldest=Date.UTC(new Date(month).getUTCFullYear(),new Date(month).getUTCMonth(),Math.min(date.getUTCDate(),lastDay),date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds());
  if(!valid(input.instId)||![clock,input.start,input.end].every(Number.isSafeInteger)||input.start<0||input.end<=input.start||input.end>clock||input.start<oldest||input.afterId!==undefined&&!/^[1-9]\d{0,29}$/.test(input.afterId)||input.afterAt!==undefined&&(!Number.isSafeInteger(input.afterAt)||input.afterAt>=input.end||!input.afterId))throw Error("Invalid executed-history window");
  const maximum=input.maxPages??20;if(!Number.isInteger(maximum)||maximum<1||maximum>200)throw Error("Invalid history page bound");
  const kept=new Map<string,MarketTradePrint>(),hashes:string[]=[];let cursor=input.afterId,reachedStart=false,pages=0,oldestAt:number|undefined,priorTs=input.afterAt??Infinity;
  for(;pages<maximum;){
   const {data:rows}=await this.get(`/api/v5/market/history-trades?instId=${input.instId}&limit=100&type=${cursor?1:2}&after=${cursor??input.end}`);pages++;
   if(!rows.length)throw Error("Executed history ended before the requested start was verified");
   if(rows.length>100)throw Error("History page exceeds requested limit");hashes.push(createHash("sha256").update(JSON.stringify(rows)).digest("hex"));
   let previous=cursor?BigInt(cursor):null,next=cursor;
   for(const row of rows){const t=decodeOkxTradePrint(row as never,input.instId),id=BigInt(t.id);
    if(previous!==null&&id>=previous)throw Error("Executed-history cursor repeated or moved forward");
    if(previous!==null&&id!==previous-1n)throw Error("Executed-history trade-ID gap");
    if(t.ts>priorTs||t.ts>=input.end)throw Error("Executed-history timestamp moved outside its window");
    previous=id;priorTs=t.ts;next=t.id;oldestAt=t.ts;
    if(t.ts<input.start)reachedStart=true;else kept.set(t.id,t);
   }
   if(!next||next===cursor)throw Error("Executed-history cursor stalled");cursor=next;if(reachedStart)break;
  }
  const knownAt=now();if(!Number.isSafeInteger(knownAt)||knownAt<clock||knownAt<input.end)throw Error("Executed-history retrieval clock moved backward");
  return{trades:[...kept.values()].sort((a,b)=>a.ts-b.ts||(BigInt(a.id)<BigInt(b.id)?-1:1)),knownAt,nextAfterId:cursor,reachedStart,pages,pageHashes:hashes,oldestAt};
 }
 async archiveFile(input:{instId:string;date:string;module:"1"|"4"}){
  if(!valid(input.instId)||!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw Error("Invalid archive identity");
  const at=Date.parse(input.date+"T00:00:00Z"),swap=input.instId.endsWith("-SWAP");if(!Number.isSafeInteger(at)||new Date(at).toISOString().slice(0,10)!==input.date)throw Error("Invalid archive date");
  const params=new URLSearchParams({module:input.module,instType:swap?"SWAP":"SPOT",dateAggrType:"daily",begin:String(at),end:String(at),[swap?"instFamilyList":"instIdList"]:swap?input.instId.slice(0,-5):input.instId});
  const {data}=await this.get("/api/v5/public/market-data-history?"+params),name=`${input.instId}-${input.module==="4"?"L2orderbook-400lv":"trades"}-${input.date}.${input.module==="4"?"tar.gz":"zip"}`;
  const groups=data.flatMap(item=>Array.isArray(item.details)?item.details:[]).filter((item:any)=>swap?item.instType==="SWAP"&&item.instFamily===input.instId.slice(0,-5):item.instId===input.instId&&item.instType==="SPOT").flatMap((item:any)=>Array.isArray(item.groupDetails)?item.groupDetails:[]);
  const matches=groups.filter((group:any)=>group.filename===name);if(matches.length!==1)throw Error("The exact public archive is not yet available");
  const selected=matches[0],url=new URL(selected.url),size=Number(selected.sizeMB)*1048576;
  const expectedPath=input.module==="4"?`/cdn/okx/match/orderbook/pro/L2/400lv/daily/${input.date.replaceAll("-","")}/${name}`:`/cdn/okex/traderecords/trades/daily/${input.date.replaceAll("-","")}/${name}`,sourceAt=at-(input.module==="1"?8*3600000:0),stamp=Number(selected.dateTs??selected.dataTs);
  if(url.protocol!=="https:"||url.hostname!=="static.okx.com"||url.port||url.username||url.password||url.hash||url.pathname!==expectedPath||[...url.searchParams].some(([key,value])=>key!=="v"||!/^\d+$/.test(value))||stamp!==sourceAt||!Number.isFinite(size)||size<=0||size>160000000)throw Error("Invalid or oversized official archive");
  return{url:url.href,filename:name,estimatedBytes:size,date:input.date,instId:input.instId};
 }
 async book(instId:string,depth=50):Promise<OkxHistoryBookFrame>{
  if(!valid(instId)||!Number.isInteger(depth)||depth<1||depth>400)throw Error("Invalid book identity/depth");
  const {data:[raw],exchangeClock}=await this.get(`/api/v5/market/books?instId=${instId}&sz=${depth}`),ts=Number(raw?.ts),knownAt=(this.options.now??Date.now)();
  const levels=(v:unknown,bid:boolean)=>{if(!Array.isArray(v)||!v.length||v.length>depth)throw Error("Invalid book levels");let prior=bid?Infinity:-Infinity;return v.map(row=>{if(!Array.isArray(row)||row.length!==4||row.some(value=>typeof value!=="string"||!value.trim()))throw Error("Invalid book level format");const price=Number(row[0]),size=Number(row[1]),orders=Number(row[3]);if(!Number.isFinite(price)||price<=0||!Number.isFinite(size)||size<=0||!Number.isSafeInteger(orders)||orders<0||(bid?price>=prior:price<=prior))throw Error("Invalid or unordered book level");prior=price;return{price,size};});};
  const bids=levels(raw?.bids,true),asks=levels(raw?.asks,false);if(!Number.isSafeInteger(knownAt)||knownAt<0||!Number.isSafeInteger(ts)||ts<0)throw Error("Invalid order-book source clock");
  const calibrated=exchangeClock&&knownAt>=exchangeClock.exchangeClockVerifiedAt&&knownAt-exchangeClock.exchangeClockVerifiedAt<=5000?exchangeClock:undefined,sourceNow=knownAt+(calibrated?.exchangeClockOffsetMs??0),uncertainty=calibrated?.exchangeClockUncertaintyMs??0;
  if(ts>sourceNow+uncertainty+5000)throw Error("Exchange order-book clock is ahead of collection clock");
  if(sourceNow+uncertainty-ts>15000)throw Error("Stale order-book snapshot");
  if(bids[0].price>=asks[0].price)throw Error("Crossed order-book snapshot");
  return{ts,knownAt,bids,asks,sequenceVerified:false,...calibrated};
 }
}

/** Stream one gzip/tar data member. Apply every archive update before sampling;
 * no file is extracted and no today's book is projected into historical time. */
export async function decodeOkxBookArchive(stream:AsyncIterable<Buffer|Uint8Array>,input:{instId:string;date:string;knownAt:number;sampleMs?:number;depth?:number;maxExpandedBytes?:number}){
 const start=Date.parse(input.date+"T00:00:00Z"),end=start+DAY,sampleMs=input.sampleMs??60000,depth=input.depth??50;
 const maximum=input.maxExpandedBytes??2000000000;
 if(!valid(input.instId)||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isSafeInteger(start)||new Date(start).toISOString().slice(0,10)!==input.date||!Number.isSafeInteger(input.knownAt)||input.knownAt<end||!Number.isSafeInteger(sampleMs)||sampleMs<1000||sampleMs>DAY||!Number.isSafeInteger(depth)||depth<1||depth>400||!Number.isSafeInteger(maximum)||maximum<1||maximum>2000000000)throw Error("Invalid book-archive request");
 const book=new MarketOrderBook(input.instId),frames:OkxHistoryBookFrame[]=[],gaps:{start:number;end:number;reason:string}[]=[];
 let pending=Buffer.alloc(0),remaining=0,padding=0,member=false,found=false,expanded=0,text="",last=-1,bucket=-1,records=0,zeroHeaders=0;
 const expected=`${input.instId}-L2orderbook-400lv-${input.date}.data`;
 const line=(s:string)=>{if(s.length>1000000)throw Error("Archive book record exceeds bound");if(!s.trim())return;const record=decodeOkxArchiveBookRecord(JSON.parse(s),input.instId);if(record.ts<start||record.ts>=end||record.ts<last)throw Error("Archive book chronology mismatch");
  if(last>=0&&record.ts-last>5000)gaps.push({start:last+5000,end:record.ts,reason:"Archive source observation gap"});
  book.apply(record);last=record.ts;records++;const bin=Math.floor(record.ts/sampleMs);
  if(bin!==bucket){if(frames.length>=10000)throw Error("Sampled archive frame bound exceeded");bucket=bin;const frame=book.snapshot(depth);frames.push({ts:frame.ts,knownAt:input.knownAt,bids:frame.bids.map(({price,size})=>({price,size})),asks:frame.asks.map(({price,size})=>({price,size})),sequenceVerified:false});}
 };
 for await(const part of stream){expanded+=part.byteLength;if(expanded>maximum)throw Error("Expanded order-book archive exceeds bound");pending=Buffer.concat([pending,part]);
  while(pending.length){
   if(!remaining&&padding){const size=Math.min(padding,pending.length);pending=pending.subarray(size);padding-=size;continue;}
   if(remaining){const size=Math.min(remaining,pending.length),chunk=pending.subarray(0,size);pending=pending.subarray(size);remaining-=size;
    if(member){text+=chunk.toString("utf8");let pos;while((pos=text.indexOf("\n"))>=0){line(text.slice(0,pos));text=text.slice(pos+1);}if(text.length>1000000)throw Error("Archive book record exceeds bound");}
    if(!remaining&&member&&text){line(text);text="";}continue;}
   if(pending.length<512)break;const header=pending.subarray(0,512);pending=pending.subarray(512);
   if(header.every(b=>b===0)){zeroHeaders++;continue;}
   if(zeroHeaders)throw Error("Unexpected tar member after archive terminator");
   const name=header.subarray(0,100).toString("utf8").split("\0")[0],sizeText=header.subarray(124,136).toString("ascii").replace(/\0/g,"").trim(),checksumText=header.subarray(148,156).toString("ascii").replace(/\0/g,"").trim(),size=parseInt(sizeText,8),checksum=parseInt(checksumText,8);
   let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];
   if(!/^[0-7]+$/.test(sizeText)||!/^[0-7]+$/.test(checksumText)||sum!==checksum||!Number.isSafeInteger(size)||size<0||size>maximum||header.subarray(345,500).some(byte=>byte!==0)||!['0','\0'].includes(String.fromCharCode(header[156]))||name!==expected||found)throw Error("Invalid order-book tar member");
   member=true;found=true;remaining=size;padding=(512-size%512)%512;
  }
 }
 if(remaining||pending.length||!found||zeroHeaders<2||!records||!frames.length)throw Error("Truncated/empty book archive");
 if(frames[0].ts>start+5000)gaps.unshift({start,end:frames[0].ts,reason:"Archive begins after session open"});
 if(last<end-5000)gaps.push({start:last+1,end,reason:"Archive ends before session close"});
 return{frames,gaps,start,end,records,knownAt:input.knownAt,sequenceVerified:false as const};
}
export async function loadOkxBookArchive(client:OkxTradeHistoryClient,input:{instId:string;date:string;sampleMs?:number;depth?:number;fetchImpl?:typeof fetch;now?:()=>number}){
 const clock=input.now??Date.now,started=clock();if(!Number.isSafeInteger(started))throw Error("Invalid book archive clock");
 const file=await client.archiveFile({...input,module:"4"}),response=await(input.fetchImpl??fetch)(file.url,{redirect:"error",signal:AbortSignal.timeout(180000)});
 if(!response.ok||!response.body||Number(response.headers.get("content-length"))>180000000){await response.body?.cancel();throw Error("Public book archive download failed or exceeds bound");}
 const hash=createHash("sha256"),source=Readable.fromWeb(response.body as never);let bytes=0;
 source.on("data",chunk=>{bytes+=chunk.length;hash.update(chunk);if(bytes>180000000)source.destroy(Error("Compressed book archive exceeds bound"));});
 const unzip=createGunzip(),decoded=source.pipe(unzip);source.on("error",error=>unzip.destroy(error));
 try{const result=await decodeOkxBookArchive(decoded,{...input,knownAt:started}),knownAt=clock();if(!Number.isSafeInteger(knownAt)||knownAt<started)throw Error("Book archive capture clock moved backward");return{...result,knownAt,frames:result.frames.map(frame=>({...frame,knownAt})),sha256:hash.digest("hex"),bytes,url:file.url};}
 finally{source.destroy();unzip.destroy();}
}
export async function loadOkxSessionTradeArchive(client:OkxTradeHistoryClient,input:{instId:string;start:number;end:number;fetchImpl?:typeof fetch;now?:()=>number}){
 const clock=input.now??Date.now,started=clock();if(!valid(input.instId)||!Number.isSafeInteger(started)||input.end>started)throw Error("Trade archive window is not complete");
 const selected=new Map<string,MarketTradePrint>(),proofs:string[]=[];let lastId:bigint|null=null,priorProof:ReturnType<typeof decodeOkxTradeArchive>["proof"]|undefined,lastKnownAt=started;
 for(const date of okxTradeArchiveDates(input.start,input.end)){
  const file=await client.archiveFile({instId:input.instId,date,module:"1"}),response=await(input.fetchImpl??fetch)(file.url,{redirect:"error",signal:AbortSignal.timeout(45000)});
  if(!response.ok||!response.body||Number(response.headers.get("content-length"))>32000000){await response.body?.cancel();throw Error("Trade archive download exceeds bound or is unavailable");}
  const chunks:Buffer[]=[];let bytes=0;const reader=response.body.getReader();
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>32000000)throw Error("Trade archive download exceeds bound");chunks.push(Buffer.from(part.value));}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
  const knownAt=clock();if(!Number.isSafeInteger(knownAt)||knownAt<lastKnownAt)throw Error("Trade archive capture clock moved backward");lastKnownAt=knownAt;
  const decoded=decodeOkxTradeArchive(Buffer.concat(chunks,bytes),{instId:input.instId,date,capturedAt:new Date(knownAt).toISOString(),start:input.start,end:input.end,maxRows:3000000,maxOutputBytes:256000000});
  if(priorProof&&(priorProof.end!==decoded.proof.start||BigInt(decoded.proof.firstId)!==BigInt(priorProof.lastId)+1n||decoded.proof.firstTs<priorProof.lastTs))throw Error("Trade archive boundary has an execution gap");priorProof=decoded.proof;
  proofs.push(decoded.proof.sha256);
  for(const t of decoded.trades){if(selected.has(t.id)||lastId!==null&&BigInt(t.id)!==lastId+1n)throw Error("Trade archive boundary has an execution gap");selected.set(t.id,t);lastId=BigInt(t.id);}
 }
 const knownAt=clock();if(!Number.isSafeInteger(knownAt)||knownAt<lastKnownAt)throw Error("Trade archive capture clock moved backward");return{trades:[...selected.values()],knownAt,pageHashes:proofs,reachedStart:true,pages:0} satisfies OkxHistoryBatch;
}
