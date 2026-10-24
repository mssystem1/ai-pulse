import {createHash} from "node:crypto";
import {inflateRawSync} from "node:zlib";
import type {MarketTradeCapture,MarketTradePrint} from "./orderFlow.js";

const DAY=86_400_000,OFFSET=8*3_600_000;
const HEADER=["instrument_name","trade_id","side","price","size","created_time","source"];
const decimal=/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const checksumTable=Uint32Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes)crc=checksumTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function identity(instId:string){if(!/^[A-Z0-9]{1,20}-[A-Z0-9]{1,12}$/.test(instId))throw Error("Trade archive requires an exact Spot instrument");}
function dateWindow(date:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("Invalid archive date");
  const utc=Date.parse(date+"T00:00:00Z");if(!Number.isSafeInteger(utc)||new Date(utc).toISOString().slice(0,10)!==date)throw Error("Invalid archive date");
  return {start:utc-OFFSET,end:utc-OFFSET+DAY};
}
export function okxTradeArchiveDates(start:number,end:number){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>DAY)throw Error("Trade capture must cover at most one complete day");
  const dates:string[]=[];for(let at=Math.floor((start+OFFSET)/DAY)*DAY-OFFSET;at<end;at+=DAY)dates.push(new Date(at+OFFSET).toISOString().slice(0,10));return dates;
}
export function latestCompleteOkxUtcTradeDay(now:number){
  if(!Number.isSafeInteger(now)||now<2*DAY)throw Error("Invalid trade archive clock");
  const sourceBoundary=Math.floor((now+OFFSET)/DAY)*DAY-OFFSET,end=Math.floor(sourceBoundary/DAY)*DAY;return {start:end-DAY,end};
}

/** One bounded CSV member; never extracts a filename onto the filesystem. */
function unzipTradeCsv(bytes:Buffer,maxOutputBytes:number){
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65_557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==1||bytes.readUInt16LE(end+10)!==1)throw Error("Trade archive must contain one ordinary ZIP member");
  const size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
  if(offset+size>end||offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw Error("Invalid trade ZIP directory");
  const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16),compressed=bytes.readUInt32LE(offset+20),expanded=bytes.readUInt32LE(offset+24),nameSize=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
  if(flags&1||![0,8].includes(method)||expanded>maxOutputBytes||expanded===0||compressed===0||46+nameSize+extra+comment!==size||offset+46+nameSize>bytes.length||local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw Error("Unsupported or oversized trade ZIP");
  const name=bytes.subarray(offset+46,offset+46+nameSize).toString("utf8");
  if(!/^[A-Za-z0-9_.-]+\.csv$/.test(name)||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)!==flags)throw Error("Invalid trade ZIP member");
  const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),start=local+30+localName+localExtra;
  if(start+compressed>offset||bytes.subarray(local+30,local+30+localName).toString("utf8")!==name)throw Error("Invalid trade ZIP data bounds");
  const packed=bytes.subarray(start,start+compressed),csv=method===8?inflateRawSync(packed,{maxOutputLength:maxOutputBytes}):packed;
  if(csv.length!==expanded||crc32(csv)!==crc)throw Error("Trade ZIP CRC or size mismatch");
  return {csv,name};
}
function columns(line:string){
  const fields:string[]=[];let value="",quoted=false,closed=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];if(quoted){if(c==='"'){if(line[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;}
    else if(c===","){fields.push(value);value="";closed=false;}
    else if(c==='"'){if(value||closed)throw Error("Malformed trade CSV quotation");quoted=true;}
    else{if(closed)throw Error("Malformed trade CSV quotation");value+=c;}
  }
  if(quoted)throw Error("Unterminated trade CSV quotation");fields.push(value);return fields;
}
export type OkxTradeArchiveProof={date:string;start:number;end:number;filename:string;sha256:string;bytes:number;crcVerified:true;rows:number;firstId:string;lastId:string;firstTs:number;lastTs:number;capturedAt:string;url?:string};
export function decodeOkxTradeArchive(bytes:Buffer,input:{instId:string;date:string;capturedAt:string;start?:number;end?:number;maxOutputBytes?:number;maxRows?:number}){
  identity(input.instId);const window=dateWindow(input.date),knownAt=Date.parse(input.capturedAt),from=input.start??window.start,to=input.end??window.end;
  if(!Number.isSafeInteger(knownAt)||knownAt<window.end||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||to<=from)throw Error("Unavailable trade archive window");
  const maxBytes=input.maxOutputBytes??128_000_000,maxRows=input.maxRows??1_500_000;
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxRows)||maxRows<1)throw Error("Invalid trade decoder bounds");
  const {csv,name}=unzipTradeCsv(bytes,maxBytes),decoder=new TextDecoder("utf-8",{fatal:true}),trades:MarketTradePrint[]=[];
  let position=0,lineNumber=0,count=0,previousId:bigint|null=null,previousTs=-1,firstId="",lastId="",firstTs=-1;
  while(position<csv.length){
    const newline=csv.indexOf(10,position),end=newline<0?csv.length:newline;if(end-position>1024)throw Error("Trade CSV record exceeds bound");
    let line=decoder.decode(csv.subarray(position,end));position=end+1;if(line.endsWith("\r"))line=line.slice(0,-1);if(lineNumber++===0){if(line.charCodeAt(0)===0xfeff)line=line.slice(1);if(JSON.stringify(columns(line))!==JSON.stringify(HEADER))throw Error("Unexpected trade CSV header");continue;}
    if(!line)continue;const row=columns(line);if(row.length!==7||row[0]!==input.instId||!/^\d+$/.test(row[1])||!/^\d+$/.test(row[5])||!decimal.test(row[3])||!decimal.test(row[4])||!["buy","sell"].includes(row[2]))throw Error("Invalid trade CSV identity or fields");
    const id=BigInt(row[1]),ts=Number(row[5]),price=Number(row[3]),size=Number(row[4]);
    if(!Number.isSafeInteger(ts)||ts<window.start||ts>=window.end||ts<previousTs||previousId!==null&&id!==previousId+1n||!Number.isFinite(price)||price<=0||!Number.isFinite(size)||size<=0)throw Error("Incomplete or invalid trade archive chronology");
    if(++count>maxRows)throw Error("Trade archive row bound exceeded");if(!firstId){firstId=row[1];firstTs=ts;}lastId=row[1];previousId=id;previousTs=ts;
    if(ts>=from&&ts<to)trades.push(Object.freeze({id:row[1],ts,price,size,side:row[2] as "buy"|"sell"}));
  }
  if(!count)throw Error("Empty trade archive");
  const proof:OkxTradeArchiveProof={date:input.date,...window,filename:name,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,crcVerified:true,rows:count,firstId,lastId,firstTs,lastTs:previousTs,capturedAt:input.capturedAt};
  return {trades,proof};
}

export type OkxTradeArchiveResult={capture:MarketTradeCapture;archives:OkxTradeArchiveProof[]};
export class OkxTradeArchiveUnavailable extends Error{}
export class OkxTradeArchiveRateLimit extends Error{constructor(readonly retryAt:number){super(`Public trade archive HTTP 429; retry after ${new Date(retryAt).toISOString()}`);this.name="OkxTradeArchiveRateLimit";}}
type CachedArchive={bytes:Buffer;capturedAt:string;url:string;cachedAt:number};
type ClientOptions={fetchImpl?:typeof fetch;now?:()=>number;wait?:(ms:number)=>Promise<void>;catalogueSpacingMs?:number;maxCompressedBytes?:number;maxOutputBytes?:number;maxArchiveRows?:number;maxCaptureTrades?:number;maxCacheBytes?:number;cacheAgeMs?:number;requestTimeoutMs?:number};
/** Public, unsigned downloads. Captured bytes keep their actual knowledge time;
 * catalogue exportTime does not establish historical publication availability. */
export class OkxTradeArchiveClient{
  private readonly options:Required<ClientOptions>;
  private readonly cache=new Map<string,CachedArchive>();private cacheSize=0;
  private readonly inFlight=new Map<string,Promise<OkxTradeArchiveResult>>();private tail:Promise<void>=Promise.resolve();private catalogueAt=0;private retryAt=0;
  constructor(options:ClientOptions={}){
    this.options={fetchImpl:fetch,now:Date.now,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),catalogueSpacingMs:1200,maxCompressedBytes:16_000_000,maxOutputBytes:128_000_000,maxArchiveRows:1_500_000,maxCaptureTrades:1_000_000,maxCacheBytes:32_000_000,cacheAgeMs:6*3_600_000,requestTimeoutMs:15_000,...options};
    for(const k of ["maxCompressedBytes","maxOutputBytes","maxArchiveRows","maxCaptureTrades","maxCacheBytes","cacheAgeMs","requestTimeoutMs"] as const)if(!Number.isSafeInteger(this.options[k])||this.options[k]<1)throw Error("Invalid trade archive client bound");
    if(!Number.isSafeInteger(this.options.catalogueSpacingMs)||this.options.catalogueSpacingMs<0)throw Error("Invalid archive catalogue spacing");
  }
  private async bounded(response:Response,max:number){
    if(!response.ok){await response.body?.cancel();if(response.status===429){const now=this.options.now(),header=response.headers.get("retry-after"),specified=header&&/^\d+(?:\.\d+)?$/.test(header)?now+Number(header)*1000:header?Date.parse(header):NaN;this.retryAt=Math.max(now+1000,Number.isFinite(specified)&&specified>now?specified:now+60_000);throw new OkxTradeArchiveRateLimit(this.retryAt);}throw Error(`Public trade archive HTTP ${response.status}`);}
    if(Number(response.headers.get("content-length"))>max){await response.body?.cancel();throw Error("Trade response exceeds size bound");}
    const reader=response.body?.getReader();if(!reader)throw Error("Empty trade response");const chunks:Buffer[]=[];let length=0;
    try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>max)throw Error("Trade response exceeds size bound");chunks.push(Buffer.from(part.value));}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    return Buffer.concat(chunks,length);
  }
  private async archive(instId:string,date:string):Promise<CachedArchive>{
    const key=instId+":"+date,now=this.options.now(),old=this.cache.get(key);
    if(old&&now>=old.cachedAt&&now-old.cachedAt<this.options.cacheAgeMs){this.cache.delete(key);this.cache.set(key,old);return old;}
    if(old){this.cache.delete(key);this.cacheSize-=old.bytes.length;}
    const window=dateWindow(date);if(!Number.isSafeInteger(now)||now<window.end)throw Error("Source trade archive is still developing");
    const utc=window.start+OFFSET,request={module:"1",instType:"SPOT",instQueryParam:{instIdList:[instId]},dateQuery:{dateAggrType:"daily",begin:String(utc),end:String(utc)}};
    const delay=this.catalogueAt-this.options.now();if(delay>0)await this.options.wait(delay);if(this.options.now()<this.retryAt)throw new OkxTradeArchiveRateLimit(this.retryAt);this.catalogueAt=Math.max(this.options.now(),this.catalogueAt)+this.options.catalogueSpacingMs;
    const response=await this.options.fetchImpl("https://www.okx.com/priapi/v5/broker/public/trade-data/download-link",{method:"POST",headers:{"Content-Type":"application/json",Referer:"https://www.okx.com/historical-data"},body:JSON.stringify(request),redirect:"error",signal:AbortSignal.timeout(this.options.requestTimeoutMs)});
    const catalogue=JSON.parse((await this.bounded(response,256_000)).toString("utf8"));if(catalogue.code!=="0"||!Array.isArray(catalogue.data?.details))throw Error("Public trade archive catalogue unavailable");
    const details=catalogue.data.details.filter((d:any)=>d.instId===instId&&d.instType==="SPOT"),matches=details.flatMap((d:any)=>Array.isArray(d.groupDetails)?d.groupDetails.filter((g:any)=>Number(g.dateTs)===window.start):[]);
    if(matches.length===0)throw new OkxTradeArchiveUnavailable("Exact daily trade archive unavailable");if(matches.length!==1)throw Error("Ambiguous daily trade archive");const selected=matches[0],expected=`${instId}-trades-${date}.zip`,url=new URL(selected.url),pathname=`/cdn/okex/traderecords/trades/daily/${date.replaceAll("-","")}/${expected}`;
    if(selected.filename!==expected||url.protocol!=="https:"||url.hostname!=="static.okx.com"||url.port||url.username||url.password||url.hash||url.pathname!==pathname||!/^\d+(?:\.\d+)?$/.test(selected.sizeMB)||!Number.isFinite(Number(selected.sizeMB))||Number(selected.sizeMB)*1_048_576>this.options.maxCompressedBytes)throw Error("Invalid or oversized public trade archive selection");
    const data=await this.options.fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(this.options.requestTimeoutMs)}),bytes=await this.bounded(data,this.options.maxCompressedBytes),captured=this.options.now();if(!Number.isSafeInteger(captured)||captured<now)throw Error("Invalid archive capture clock");
    return {bytes,capturedAt:new Date(captured).toISOString(),url:url.href,cachedAt:captured};
  }
  private remember(key:string,archive:CachedArchive){
    if(archive.bytes.length>this.options.maxCacheBytes)return;const old=this.cache.get(key);if(old)this.cacheSize-=old.bytes.length;this.cache.delete(key);
    while(this.cacheSize+archive.bytes.length>this.options.maxCacheBytes){const first=this.cache.keys().next().value;if(first===undefined)break;this.cacheSize-=this.cache.get(first)!.bytes.length;this.cache.delete(first);}
    this.cache.set(key,archive);this.cacheSize+=archive.bytes.length;
  }
  async capture(instId:string,start:number,end:number):Promise<OkxTradeArchiveResult>{
    identity(instId);const dates=okxTradeArchiveDates(start,end),now=this.options.now();if(!Number.isSafeInteger(now)||end>now)throw Error("Trade archive window is not complete");
    if(now<this.retryAt)throw new OkxTradeArchiveRateLimit(this.retryAt);
    if(dates.some(date=>dateWindow(date).end>now))throw Error("Source trade archive is still developing");
    const key=JSON.stringify([instId,start,end]),existing=this.inFlight.get(key);if(existing)return existing;
    const run=this.tail.then(async()=>{
      const trades:MarketTradePrint[]=[],archives:OkxTradeArchiveProof[]=[];let knownAt=0;
      for(const date of dates){
        const raw=await this.archive(instId,date),decoded=decodeOkxTradeArchive(raw.bytes,{instId,date,capturedAt:raw.capturedAt,start,end,maxOutputBytes:this.options.maxOutputBytes,maxRows:this.options.maxArchiveRows}),prior=archives.at(-1);
        if(prior&&(prior.end!==decoded.proof.start||BigInt(decoded.proof.firstId)!==BigInt(prior.lastId)+1n||decoded.proof.firstTs<prior.lastTs))throw Error("Trade archives do not form a complete sequence");
        if(trades.length+decoded.trades.length>this.options.maxCaptureTrades)throw Error("Trade capture row bound exceeded");
        for(const t of decoded.trades)trades.push(t);archives.push(Object.freeze({...decoded.proof,url:raw.url}));knownAt=Math.max(knownAt,Date.parse(raw.capturedAt));this.remember(instId+":"+date,raw);
      }
      const capture:MarketTradeCapture={source:"okx-public-spot",instId,priceCurrency:instId.split("-")[1],marketType:"spot",quantityUnit:"base",capturedAt:new Date(knownAt).toISOString(),coverage:{start,end,knownAt,complete:true,sha256:archives.map(a=>a.sha256)},trades};
      Object.freeze(capture.coverage.sha256);Object.freeze(capture.coverage);Object.freeze(trades);Object.freeze(capture);Object.freeze(archives);return Object.freeze({capture,archives});
    });
    this.inFlight.set(key,run);this.tail=run.then(()=>{},()=>{});try{return await run;}finally{this.inFlight.delete(key);}
  }
  /** Select by source publication availability only. Never substitute a
   * partial file, a different venue or a price-driven reference window. */
  async captureRecentUtcDay(instId:string,maxLookbackDays=3){
    if(!Number.isSafeInteger(maxLookbackDays)||maxLookbackDays<1||maxLookbackDays>7)throw Error("Invalid archive publication lookback");
    const newest=latestCompleteOkxUtcTradeDay(this.options.now());let unavailable:unknown;
    for(let lag=0;lag<maxLookbackDays;lag++)try{return await this.capture(instId,newest.start-lag*DAY,newest.end-lag*DAY);}catch(error){if(!(error instanceof OkxTradeArchiveUnavailable))throw error;unavailable=error;}
    throw unavailable;
  }
}

/** Daily source reconciliation also protects a weekly chart whose one-day
 * profile has no completed weekly footprint to check against the main chart. */
export function reconcileOkxDailyTradeCapture(capture:MarketTradeCapture,reference:{source:string;instId:string;bar:string;fetchedAt:string;candle:{ts:number;open:number;high:number;low:number;close:number;volume:number;confirmed?:boolean}}){
  const c=reference.candle,start=capture.coverage.start,end=capture.coverage.end,observed=Date.parse(reference.fetchedAt);
  const capturedAt=Date.parse(capture.capturedAt);
  if(reference.source!=="okx-public-spot"||capture.source!==reference.source||reference.instId!==capture.instId||reference.bar!=="1Dutc"||capture.marketType!=="spot"||capture.quantityUnit!=="base"||!capture.coverage.complete||c.confirmed!==true||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start%DAY||end-start!==DAY||c.ts!==start||!Number.isSafeInteger(observed)||observed<end||!Number.isSafeInteger(capturedAt)||!Number.isSafeInteger(capture.coverage.knownAt)||capture.coverage.knownAt<Math.max(end,capturedAt)||capture.coverage.knownAt>observed||!(c.volume>0)||!capture.trades.length)throw Error("Daily trade capture has no matching available Spot candle");
  let low=Infinity,high=-Infinity,volume=0,error=0,previous=-1;const ids=new Set<string>();
  for(const t of capture.trades){if(!Number.isSafeInteger(t.ts)||t.ts<start||t.ts>=end||t.ts<previous||!/^\d+$/.test(t.id)||ids.has(t.id)||!["buy","sell"].includes(t.side)||![t.price,t.size].every(v=>Number.isFinite(v)&&v>0))throw Error("Invalid daily trade capture");ids.add(t.id);previous=t.ts;low=Math.min(low,t.price);high=Math.max(high,t.price);const adjusted=t.size-error,total=volume+adjusted;error=(total-volume)-adjusted;volume=total;}
  const actual={open:capture.trades[0].price,high,low,close:capture.trades.at(-1)!.price,volume};
  for(const k of ["open","high","low","close","volume"] as const){const expected=c[k],tolerance=k==="volume"?Math.max(1e-9,Math.abs(expected)*1e-12):Math.max(1e-10,Math.abs(expected)*1e-12);if(!Number.isFinite(expected)||Math.abs(actual[k]-expected)>tolerance)throw Error("Trade capture does not reconcile with the source daily candle");}
  return {source:capture.source,instId:capture.instId,start,end,knownAt:capture.coverage.knownAt,...actual};
}
