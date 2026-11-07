import {createHash,randomUUID} from "node:crypto";
import {gzipSync,gunzipSync} from "node:zlib";
import type {AppConfig} from "@pulse/config";
import type {TerminalHistoryBar,TerminalHistoryTotals,TerminalHistoryRow,TerminalHistoryInterval,TerminalSessionHistory,TerminalLiquidityHistory,TerminalBookHistoryFrame} from "@pulse/domain";
import {OkxTradeHistoryClient,loadOkxBookArchive,loadOkxSessionTradeArchive,type OkxHistoryBatch,type MarketTradePrint} from "@pulse/market";
import {StoreRedis} from "./storeRedis.js";
const DAY=86400000,HOUR=3600000,MINUTE=60000;
type Revisioned={revision:number};
type HistoryFence={key:string;token:string};
type HistoryLease=string|HistoryFence;
class HistoryLeaseLostError extends Error {constructor(){super("The public-history collector lease changed; stale work was discarded");}}
export interface TerminalHistoryStorage{
 get<T>(key:string):Promise<T|null>;put(key:string,value:unknown,ttl:number):Promise<void>;
 cas(key:string,revision:number,value:Revisioned,ttl:number,fence?:HistoryFence):Promise<boolean>;
 acquire(key:string,token:string,seconds:number):Promise<boolean>;release(key:string,token:string):Promise<void>;
}
export class MemoryTerminalHistoryStorage implements TerminalHistoryStorage{
 private data=new Map<string,{value:unknown;expires:number}>();constructor(private now=Date.now){}
 async get<T>(key:string){const old=this.data.get(key);return old&&old.expires>this.now()?structuredClone(old.value) as T:null;}
 async put(key:string,value:unknown,ttl:number){this.data.set(key,{value:structuredClone(value),expires:this.now()+ttl*1000});}
 async cas(key:string,revision:number,value:Revisioned,ttl:number,fence?:HistoryFence){const lease=fence?this.data.get(fence.key):null;if(fence&&(!lease||lease.expires<=this.now()||lease.value!==fence.token))return false;const old=this.data.get(key),valid=old&&old.expires>this.now()?old.value as Revisioned:null;if((valid?.revision??0)!==revision)return false;this.data.set(key,{value:structuredClone(value),expires:this.now()+ttl*1000});return true;}
 async acquire(key:string,token:string,seconds:number){const old=this.data.get(key);if(old&&old.expires>this.now())return false;this.data.set(key,{value:token,expires:this.now()+seconds*1000});return true;}
 async release(key:string,token:string){if(this.data.get(key)?.value===token)this.data.delete(key);}
}
class RedisTerminalHistoryStorage implements TerminalHistoryStorage{
 constructor(private redis:StoreRedis){}
 get<T>(key:string){return this.redis.get<T>(key);}async put(key:string,value:unknown,ttl:number){await this.redis.set(key,value,{ex:ttl});}
 async cas(key:string,revision:number,value:Revisioned,ttl:number,fence?:HistoryFence){return Number(await this.redis.eval("if ARGV[4]~='' and redis.call('GET',KEYS[2])~=ARGV[4] then return -1 end;local v=redis.call('GET',KEYS[1]);local r=0;if v then r=cjson.decode(v).revision end;if r~=tonumber(ARGV[1]) then return 0 end;redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);return 1",fence?[key,fence.key]:[key],[revision,JSON.stringify(value),ttl,fence?.token??""]))===1;}
 async acquire(key:string,token:string,seconds:number){return await this.redis.set(key,token,{nx:true,ex:seconds})==="OK";}
 async release(key:string,token:string){await this.redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",[key],[token]);}
}
type Chunk={step:number;bars:TerminalHistoryBar[];knownAt:number;hashes:string[]};
type Work={start:number;end:number;cursor?:string;refs:string[];oldest?:number;pages:number};
type DayState=Revisioned&{instId:string;marketType:"spot"|"perpetual";day:number;target:number;coveredEnd:number;refs:string[];work?:Work;retryAt?:number;error?:string;knownAt:number};
type BookHour=Revisioned&{frames:TerminalBookHistoryFrame[];source:string};
type Queue=Revisioned&{days:string[];books:string[];markets:string[];requestedMarkets?:string[];priorityDays?:string[];priorityCursor?:number;priorityUntil?:number;cursor?:number;bookCursor?:number;marketCursor?:number;liveBookCursor?:number;phaseCursor?:number};
type BookJob=Revisioned&{instId:string;day:number;state:"queued"|"complete"|"failed";retryAt?:number;error?:string;hash?:string;gaps?:{start:number;end:number;reason:string}[];knownAt?:number};
type Options={storage:TerminalHistoryStorage;namespace?:string;now?:()=>number;client?:OkxTradeHistoryClient;fetchTrades?:(input:{instId:string;start:number;end:number;afterId?:string;afterAt?:number;maxPages?:number})=>Promise<OkxHistoryBatch>;fetchBook?:(instId:string,depth:number)=>Promise<TerminalBookHistoryFrame>;tradeArchive?:(input:{instId:string;start:number;end:number})=>Promise<OkxHistoryBatch>;bookArchive?:(input:{instId:string;date:string;sampleMs:number;depth:number})=>Promise<{frames:TerminalBookHistoryFrame[];gaps:{start:number;end:number;reason:string}[];sha256?:string}>;retentionDays?:number;bookRetentionDays?:number;sampleMs?:number;depth?:number;maxPages?:number;markets?:string[]};
const round=(n:number)=>Number(n.toPrecision(14)),hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const priceIndex=(price:number,step:number)=>{const q=price/step,nearest=Math.round(q);return Math.abs(q-nearest)<=8*Number.EPSILON*Math.max(1,Math.abs(q))?nearest:Math.floor(q);};
const exact=(id:string)=>/^[A-Z0-9]{2,20}-(USDT|USDC|USD)$/.test(id);
function sourceFailure(error:unknown,kind:"executions"|"archive"){
 const detail=error instanceof Error?error.message:"";
 if(/not yet available/.test(detail))return "The exchange has not published this exact dated archive yet.";
 const status=detail.match(/(?:HTTP|exchange error) (\d{3,8})/);
 if(status)return `The public exchange source returned ${status[1]}; collection will retry.`;
 if(/timeout|aborted|fetch failed/i.test(detail))return "The public exchange request timed out or could not connect; collection will retry.";
 if(/gap|cursor|chronology|timestamp|checksum|integrity|Truncated|CRC|check/i.test(detail))return `The ${kind==="archive"?"dated archive":"execution chain"} failed source validation; no missing interval was assumed complete.`;
 return kind==="archive"?"The exact dated exchange archive is unavailable or failed validation.":"Exchange history is unavailable or its execution chain could not be verified.";
}
function mergeTotals(a:TerminalHistoryTotals|null,b:TerminalHistoryTotals):TerminalHistoryTotals{
 if(!a)return{...b};const first=a.firstTradeAt<b.firstTradeAt||a.firstTradeAt===b.firstTradeAt&&BigInt(a.firstTradeId??"0")<=BigInt(b.firstTradeId??"0")?a:b,last=a.lastTradeAt>b.lastTradeAt||a.lastTradeAt===b.lastTradeAt&&BigInt(a.lastTradeId??"0")>=BigInt(b.lastTradeId??"0")?a:b;return{buy:a.buy+b.buy,sell:a.sell+b.sell,trades:a.trades+b.trades,notional:a.notional+b.notional,squaredNotional:a.squaredNotional+b.squaredNotional,open:first.open,close:last.close,high:Math.max(a.high,b.high),low:Math.min(a.low,b.low),firstTradeAt:first.firstTradeAt,lastTradeAt:last.lastTradeAt,firstTradeId:first.firstTradeId,lastTradeId:last.lastTradeId};
}
function mergeRows(rows:TerminalHistoryRow[],step:number){const map=new Map<number,TerminalHistoryRow>();for(const r of rows){const key=priceIndex(r.low,step),old=map.get(key)??{low:round(key*step),high:round((key+1)*step),buy:0,sell:0,trades:0};old.buy+=r.buy;old.sell+=r.sell;old.trades+=r.trades;map.set(key,old);}return[...map.values()].sort((a,b)=>a.low-b.low);}
function aggregate(trades:readonly MarketTradePrint[],step?:number):Chunk{
 const size=step??10**Math.ceil(Math.log10((trades[0]?.price??1)*1e-4)),bars=new Map<number,TerminalHistoryBar>(),priceRows=new Map<number,Map<number,TerminalHistoryRow>>();
 for(const t of trades){const at=Math.floor(t.ts/MINUTE)*MINUTE,prior=bars.get(at),single={buy:t.side==="buy"?t.size:0,sell:t.side==="sell"?t.size:0,trades:1,notional:t.price*t.size,squaredNotional:t.price*t.price*t.size,open:t.price,high:t.price,low:t.price,close:t.price,firstTradeAt:t.ts,lastTradeAt:t.ts,firstTradeId:t.id,lastTradeId:t.id},totals=mergeTotals(prior??null,single),low=round(priceIndex(t.price,size)*size),rows=priceRows.get(at)??new Map<number,TerminalHistoryRow>(),row=rows.get(low)??{low,high:round(low+size),buy:0,sell:0,trades:0};row.buy+=single.buy;row.sell+=single.sell;row.trades++;rows.set(low,row);priceRows.set(at,rows);bars.set(at,{...totals,start:at,end:at+MINUTE,rows:[]});}
 for(const bar of bars.values())bar.rows=[...priceRows.get(bar.start)!.values()].sort((a,b)=>a.low-b.low);
 return{step:size,bars:[...bars.values()].sort((a,b)=>a.start-b.start),knownAt:0,hashes:[]};
}
function intervals(parts:TerminalHistoryInterval[],start:number,end:number){const merged:TerminalHistoryInterval[]=[];for(const p of parts.map(p=>({start:Math.max(start,p.start),end:Math.min(end,p.end)})).filter(p=>p.end>p.start).sort((a,b)=>a.start-b.start)){const last=merged.at(-1);if(last&&p.start<=last.end)last.end=Math.max(last.end,p.end);else merged.push({...p});}return merged;}
function missing(parts:TerminalHistoryInterval[],start:number,end:number){let cursor=start;const gaps:{start:number;end:number;reason:string}[]=[];for(const p of parts){if(p.start>cursor)gaps.push({start:cursor,end:p.start,reason:"Executed history is still being backfilled"});cursor=Math.max(cursor,p.end);}if(cursor<end)gaps.push({start:cursor,end,reason:"Executed history is still being backfilled"});return gaps;}
export class TerminalMarketHistory{
 readonly now:()=>number;readonly storage:TerminalHistoryStorage;private client:OkxTradeHistoryClient;private bookClient:OkxTradeHistoryClient;private ns:string;private days:number;private bookDays:number;readonly sampleMs:number;readonly depth:number;private seededDay?:number;
 private decoded=new Map<string,{chunk:Chunk;bytes:number}>();private decodedBytes=0;
 constructor(readonly options:Options){this.now=options.now??Date.now;this.storage=options.storage;this.client=options.client??new OkxTradeHistoryClient({now:this.now});this.bookClient=options.client??new OkxTradeHistoryClient({now:this.now});this.ns=(options.namespace??"pulse")+":terminal-public-history:v1";this.days=options.retentionDays??45;this.bookDays=options.bookRetentionDays??7;this.sampleMs=options.sampleMs??60000;this.depth=options.depth??50;}
 private key(kind:string,id=""){return`${this.ns}:${kind}:${id}`;}
 private ttl(){return(this.days+1)*86400;}
 private fence(token:HistoryLease){return typeof token==="string"?{key:this.key("collector-lease"),token}:token;}
 private async assertLease(token:HistoryLease){const fence=this.fence(token);if(await this.storage.get<string>(fence.key)!==fence.token)throw new HistoryLeaseLostError();}
 private async mutate<T extends Revisioned>(key:string,create:()=>T,change:(v:T)=>void|boolean,ttl=this.ttl(),token?:HistoryLease){
  for(let i=0;i<12;i++){if(token)await this.assertLease(token);const existing=await this.storage.get<T>(key),v=existing??create(),revision=v.revision;if(change(v)===false&&existing)return v;v.revision++;if(await this.storage.cas(key,revision,v,ttl,token?this.fence(token):undefined))return v;}throw Error("Public history changed concurrently; retry");
 }
 private validate(instId:string,start:number,end:number,book=false){if(!exact(instId)||![start,end].every(Number.isSafeInteger)||start<0||start%MINUTE||end%MINUTE||end<=start||end>this.now()||end-start>31*DAY||start<this.now()-(book?this.bookDays:this.days)*DAY-DAY)throw Error("Choose whole UTC minutes within configured history retention");}
 async ensure(input:{instId:string;start:number;end:number;priority?:boolean}){
  this.validate(input.instId,input.start,input.end);const dayKeys:string[]=[],bookKeys:string[]=[];
  for(let day=Math.floor(input.start/DAY)*DAY;day<input.end;day+=DAY){
   for(const marketType of ["spot","perpetual"] as const){const id=`${input.instId}:${marketType}:${day}`,key=this.key("day",id),target=Math.min(day+DAY,input.end);await this.mutate<DayState>(key,()=>({revision:0,instId:input.instId,marketType,day,target,coveredEnd:day,refs:[],knownAt:0}),v=>{if(v.target>=target)return false;v.target=target;});dayKeys.push(id);}
   if(day+DAY<=this.now()-2*DAY&&day>=this.now()-this.bookDays*DAY-DAY){const id=`${input.instId}:${day}`;await this.mutate<BookJob>(this.key("book-job",id),()=>({revision:0,instId:input.instId,day,state:"queued"}),()=>false);bookKeys.push(id);}
  }
  const priorityDays=[...dayKeys].sort((a,b)=>Number(b.slice(b.lastIndexOf(":")+1))-Number(a.slice(a.lastIndexOf(":")+1)));
  await this.mutate<Queue>(this.key("queue"),()=>({revision:0,days:[],books:[],markets:[]}),v=>{if(!v.markets.includes(input.instId)&&v.markets.length>=32)throw Error("Public history market capacity reached");
   const changed=!v.markets.includes(input.instId)||dayKeys.some(id=>!v.days.includes(id))||bookKeys.some(id=>!v.books.includes(id)),priorityChanged=input.priority!==false&&(JSON.stringify(v.priorityDays)!==JSON.stringify(priorityDays)||(v.priorityUntil??0)<this.now()+4*MINUTE);
   if(!changed&&!priorityChanged)return false;
   v.days=[...new Set([...v.days,...dayKeys])].slice(-32*46*2);v.books=[...new Set([...v.books,...bookKeys])].slice(-32*32);v.markets=[...new Set([...v.markets,input.instId])];
   if(input.priority!==false){v.requestedMarkets=[...(v.requestedMarkets??[]).filter(id=>id!==input.instId),input.instId].slice(-32);if(JSON.stringify(v.priorityDays)!==JSON.stringify(priorityDays))v.priorityCursor=0;v.priorityDays=priorityDays;v.priorityUntil=this.now()+5*MINUTE;}
  });
 }
 /** Seed usable UTC presets on startup/day rollover, without needing an open browser. */
 async ensureBackground(){
  const end=Math.floor(this.now()/MINUTE)*MINUTE,today=Math.floor(end/DAY)*DAY;if(this.seededDay===today)return;
  const queue=await this.storage.get<Queue>(this.key("queue")),markets=queue?.requestedMarkets?.length?queue.requestedMarkets.slice(-2):(this.options.markets??[]).slice(0,1);
  // Seed a bounded recent window, not every asset's entire retention. A chosen
  // week/month/custom request queues its own exact window with priority below.
  const start=Math.max(today-this.days*DAY,end-31*DAY,today-Math.max(7,this.bookDays)*DAY);
  for(const instId of markets)if(end>start)await this.ensure({instId,start,end,priority:false});
  this.seededDay=today;
 }
 /** An independent live sampler: a slow archive must never hold this lease. */
 async collectLiveBooks(input:{maxWorkMs?:number}={}){
  const token=randomUUID(),lease=this.key("live-book-collector-lease"),fence={key:lease,token};
  if(!await this.storage.acquire(lease,token,300))return{alreadyRunning:true,books:0};
  let books=0,attempted=0;const deadline=Date.now()+(input.maxWorkMs??20000);
  try{
   const queue=await this.storage.get<Queue>(this.key("queue"))??{revision:0,days:[],books:[],markets:[]},markets=[...new Set([...(this.options.markets??[]),...queue.markets])],offset=(queue.liveBookCursor??0)%Math.max(1,markets.length),ordered=[...markets.slice(offset),...markets.slice(0,offset)];
   for(const instId of ordered){if(Date.now()>deadline)break;attempted++;try{const frame=await(this.options.fetchBook??((id,depth)=>this.bookClient.book(id,depth)))(instId,this.depth);await this.appendBooks(instId,[frame],"okx-public-spot-book-snapshots",fence);books++;}catch(error){if(error instanceof HistoryLeaseLostError)throw error;}}
   await this.mutate<Queue>(this.key("queue"),()=>queue,v=>{v.liveBookCursor=(offset+attempted)%Math.max(1,markets.length);},this.ttl(),fence);
   return{alreadyRunning:false,books};
  }finally{await this.storage.release(lease,token);}
 }
 private cacheChunk(id:string,chunk:Chunk,bytes:number){if(bytes>32000000)return;const previous=this.decoded.get(id);if(previous)this.decodedBytes-=previous.bytes;this.decoded.delete(id);while(this.decoded.size>=128||this.decodedBytes+bytes>32000000){const first=this.decoded.keys().next().value;if(first===undefined)break;this.decodedBytes-=this.decoded.get(first)!.bytes;this.decoded.delete(first);}this.decoded.set(id,{chunk,bytes});this.decodedBytes+=bytes;}
 private async saveChunk(chunk:Chunk){const raw=JSON.stringify(chunk),id=hash(raw);await this.storage.put(this.key("chunk",id),{sha256:id,gzip:gzipSync(raw).toString("base64")},this.ttl());this.cacheChunk(id,chunk,Buffer.byteLength(raw));return id;}
 private async saveChunks(chunk:Chunk){const refs:string[]=[];let bars:TerminalHistoryBar[]=[],bytes=0,hour=-1;const flush=async()=>{if(bars.length)refs.push(await this.saveChunk({...chunk,bars}));bars=[];bytes=0;};for(const bar of chunk.bars){const nextHour=Math.floor(bar.start/HOUR),size=Buffer.byteLength(JSON.stringify(bar));if(bars.length&&(nextHour!==hour||bytes+size>1000000))await flush();bars.push(bar);bytes+=size;hour=nextHour;}await flush();return refs;}
 private async chunk(id:string){const cached=this.decoded.get(id);if(cached){this.decoded.delete(id);this.decoded.set(id,cached);return cached.chunk;}const raw=await this.storage.get<{sha256:string;gzip:string}>(this.key("chunk",id));if(!raw)throw Error("Retained execution chunk expired or is missing");const text=gunzipSync(Buffer.from(raw.gzip,"base64"),{maxOutputLength:32000000}).toString("utf8");if(raw.sha256!==id||hash(text)!==id)throw Error("Retained execution chunk failed integrity validation");const chunk=JSON.parse(text) as Chunk;this.cacheChunk(id,chunk,Buffer.byteLength(text));return chunk;}
 private async compactDay(key:string,state:DayState,token:string){if(state.work||state.coveredEnd<state.day+DAY||state.refs.length<=24)return;const sourceRefs=[...state.refs],chunks:Chunk[]=[];for(const ref of sourceRefs)chunks.push(await this.chunk(ref));const step=Math.max(...chunks.map(c=>c.step)),bars=new Map<number,TerminalHistoryBar>();for(const chunk of chunks)for(const bar of chunk.bars){const old=bars.get(bar.start);bars.set(bar.start,{...mergeTotals(old??null,bar),start:bar.start,end:bar.end,rows:mergeRows([...(old?.rows??[]),...bar.rows],step)});}await this.assertLease(token);const refs=await this.saveChunks({step,bars:[...bars.values()].sort((a,b)=>a.start-b.start),knownAt:state.knownAt,hashes:[...new Set(chunks.flatMap(c=>c.hashes))]});await this.mutate<DayState>(key,()=>state,v=>{if(v.work||JSON.stringify(v.refs)!==JSON.stringify(sourceRefs))throw Error("Completed history changed before compaction");v.refs=refs;},this.ttl(),token);}
 private async collectDay(id:string,maxPages:number,token:string){
  const key=this.key("day",id),old=await this.storage.get<DayState>(key);if(!old||old.retryAt&&old.retryAt>this.now()||!old.work&&old.coveredEnd>=old.target)return false;
  const work=old.work??{start:old.coveredEnd,end:old.target,refs:[],pages:0};
  await this.mutate<DayState>(key,()=>old,v=>{v.work??=structuredClone(work);},this.ttl(),token);
  const instId=old.instId+(old.marketType==="perpetual"?"-SWAP":"");let result:OkxHistoryBatch;
  try{
   if(!work.cursor&&!work.refs.length&&work.end-work.start===DAY&&work.end<=this.now()-2*DAY){try{result=await(this.options.tradeArchive??(input=>loadOkxSessionTradeArchive(this.client,{...input,now:this.now})) )({instId,start:work.start,end:work.end});}catch{result=await(this.options.fetchTrades??(input=>this.client.fetchBatch(input)))({instId,start:work.start,end:work.end,maxPages});}}
   else result=await(this.options.fetchTrades??(input=>this.client.fetchBatch(input)))({instId,start:work.start,end:work.end,afterId:work.cursor,afterAt:work.oldest,maxPages});
   if(!result.reachedStart&&!result.nextAfterId)throw Error("Missing resumable history cursor");
   await this.assertLease(token);const chunk=aggregate(result.trades),refs=result.trades.length?await this.saveChunks({...chunk,knownAt:result.knownAt,hashes:result.pageHashes}):[];
   const saved=await this.mutate<DayState>(key,()=>old,v=>{if(v.work?.cursor!==work.cursor||v.work?.end!==work.end)throw Error("History checkpoint changed");for(const ref of refs)if(!v.work.refs.includes(ref))v.work.refs.push(ref);v.work.pages+=result.pages;v.work.oldest=result.oldestAt??result.trades[0]?.ts??v.work.oldest;v.work.cursor=result.nextAfterId;v.knownAt=result.knownAt;delete v.error;delete v.retryAt;
    if(result.reachedStart){v.refs.push(...v.work.refs);v.coveredEnd=v.work.end;delete v.work;}
   },this.ttl(),token);await this.compactDay(key,saved,token);return true;
  }catch(error){if(error instanceof HistoryLeaseLostError)throw error;await this.mutate<DayState>(key,()=>old,v=>{v.error=sourceFailure(error,"executions");v.retryAt=this.now()+60000;},this.ttl(),token);return false;}
 }
 async readSession(input:{instId:string;marketType:"spot"|"perpetual";start:number;end:number;barMs?:number;maxBars?:number}):Promise<TerminalSessionHistory>{
  this.validate(input.instId,input.start,input.end);const chunks:Chunk[]=[],parts:TerminalHistoryInterval[]=[];let pages=0,knownAt=0,error:string|undefined;
  for(let day=Math.floor(input.start/DAY)*DAY;day<input.end;day+=DAY){const state=await this.storage.get<DayState>(this.key("day",`${input.instId}:${input.marketType}:${day}`));if(!state)continue;
   if(state.coveredEnd>day)parts.push({start:day,end:state.coveredEnd});if(state.work?.oldest!==undefined)parts.push({start:Math.max(state.work.start,state.work.oldest+1),end:state.work.end});
   for(const ref of [...state.refs,...state.work?.refs??[]])chunks.push(await this.chunk(ref));pages+=state.work?.pages??0;knownAt=Math.max(knownAt,state.knownAt);error??=state.error;
  }
  const covered=intervals(parts,input.start,input.end),gaps=missing(covered,input.start,input.end),complete=!gaps.length,step=chunks.reduce((n,c)=>Math.max(n,c.step),0)||1;
  if(input.barMs!==undefined&&(!Number.isSafeInteger(input.barMs)||input.barMs<MINUTE||input.barMs%MINUTE)||input.maxBars!==undefined&&(!Number.isSafeInteger(input.maxBars)||input.maxBars<1||input.maxBars>4096))throw Error("Choose bounded whole-minute session display bars");
  const requestedBar=Math.max(MINUTE,input.barMs??MINUTE),barMs=requestedBar*Math.max(1,Math.ceil((input.end-input.start)/requestedBar/(input.maxBars??512))),bars=new Map<number,TerminalHistoryBar>();
  for(const chunk of chunks)for(const bar of chunk.bars){if(bar.start<input.start||bar.end>input.end)continue;const start=input.start+Math.floor((bar.start-input.start)/barMs)*barMs,old=bars.get(start),totals=mergeTotals(old??null,bar);bars.set(start,{...totals,start,end:Math.min(start+barMs,input.end),rows:[...(old?.rows??[]),...bar.rows]});}
  const selected=[...bars.values()].sort((a,b)=>a.start-b.start);let totals:TerminalHistoryTotals|null=null;const rows:TerminalHistoryRow[]=[];for(const bar of selected){bar.rows=mergeRows(bar.rows,step);totals=mergeTotals(totals,bar);for(const row of bar.rows)rows.push(row);}
  return{version:"terminal-session-history-v1",instId:input.instId,marketType:input.marketType,quantityUnit:input.marketType==="spot"?"base":"contracts",source:"okx-retained-executions",requestedStart:input.start,requestedEnd:input.end,knownAt,status:complete?"available":totals?"partial":"collecting",priceStep:step,complete,intervals:covered,gaps,totals,rows:mergeRows(rows,step),bars:selected,barMs,proofHashes:[...new Set(chunks.flatMap(c=>c.hashes))],backfill:{state:complete?"complete":error?"failed":"backfilling",pages,message:complete?"Every requested execution interval is retained.":error??"Background collection is filling this session. Uncollected intervals remain unknown."}};
 }
 private validateBook(instId:string,frame:TerminalBookHistoryFrame){
  const at=this.now(),validSide=(rows:TerminalBookHistoryFrame["bids"],bid:boolean)=>Array.isArray(rows)&&rows.length>0&&rows.length<=400&&rows.every((r,i)=>Number.isFinite(r.price)&&r.price>0&&Number.isFinite(r.size)&&r.size>0&&(i===0||(bid?r.price<rows[i-1].price:r.price>rows[i-1].price)));
  const hasClock=[frame.exchangeClockOffsetMs,frame.exchangeClockUncertaintyMs,frame.exchangeClockVerifiedAt].some(v=>v!==undefined),validClock=Number.isFinite(frame.exchangeClockOffsetMs)&&Math.abs(frame.exchangeClockOffsetMs!)<=30000&&Number.isFinite(frame.exchangeClockUncertaintyMs)&&frame.exchangeClockUncertaintyMs!>=500&&frame.exchangeClockUncertaintyMs!<=1500&&Number.isSafeInteger(frame.exchangeClockVerifiedAt)&&frame.exchangeClockVerifiedAt!>=0&&frame.exchangeClockVerifiedAt!<=frame.knownAt&&frame.knownAt-frame.exchangeClockVerifiedAt!<=5000;
  if(hasClock&&!validClock)throw Error("Invalid real book clock calibration");
  const lead=validClock?frame.exchangeClockOffsetMs!+frame.exchangeClockUncertaintyMs!:0;
  if(!exact(instId)||!Number.isSafeInteger(frame.ts)||frame.ts<0||frame.ts>at+lead+5000||!Number.isSafeInteger(frame.knownAt)||frame.knownAt<0||frame.knownAt>at+5000||frame.knownAt+lead+5000<frame.ts||!validSide(frame.bids,true)||!validSide(frame.asks,false)||frame.bids[0].price>=frame.asks[0].price)throw Error("Invalid real book observation");
 }
 private async appendBooks(instId:string,frames:TerminalBookHistoryFrame[],source:string,token?:HistoryLease){
  const hours=new Map<number,TerminalBookHistoryFrame[]>();for(const frame of frames){this.validateBook(instId,frame);const hour=Math.floor(frame.ts/HOUR)*HOUR,rows=hours.get(hour)??[];rows.push(frame);hours.set(hour,rows);}
  // One CAS per hour, not one network round trip per sampled minute.
  for(const[hour,rows]of hours)await this.mutate<BookHour>(this.key("book-hour",`${instId}:${hour}`),()=>({revision:0,frames:[],source}),v=>{const buckets=new Map(v.frames.map(frame=>[Math.floor(frame.ts/this.sampleMs),frame]));for(const frame of rows){const bucket=Math.floor(frame.ts/this.sampleMs),old=buckets.get(bucket);if(!old||old.ts<frame.ts)buckets.set(bucket,{...frame,bids:frame.bids.slice(0,this.depth),asks:frame.asks.slice(0,this.depth)});}v.frames=[...buckets.values()].sort((a,b)=>a.ts-b.ts);v.source=source;},(this.bookDays+1)*86400,token);
 }
 async appendBook(instId:string,frame:TerminalBookHistoryFrame,source="okx-public-spot-book-snapshots"){return this.appendBooks(instId,[frame],source);}
 private async collectBookArchive(id:string,token:string){const key=this.key("book-job",id),job=await this.storage.get<BookJob>(key);if(!job||job.state==="complete"||job.retryAt&&job.retryAt>this.now())return false;
  try{const result=await(this.options.bookArchive??(input=>loadOkxBookArchive(this.client,{...input,now:this.now})))({instId:job.instId,date:new Date(job.day).toISOString().slice(0,10),sampleMs:this.sampleMs,depth:this.depth});
   if(!Array.isArray(result.frames)||!result.frames.length||result.frames.some(f=>f.ts<job.day||f.ts>=job.day+DAY)||!Array.isArray(result.gaps)||result.gaps.some(g=>!Number.isSafeInteger(g.start)||!Number.isSafeInteger(g.end)||g.start<job.day||g.end>job.day+DAY||g.end<=g.start))throw Error("The book archive does not match its exact dated window");
   await this.mutate<BookJob>(key,()=>job,v=>{v.gaps=structuredClone(result.gaps);v.knownAt=Math.max(...result.frames.map(f=>f.knownAt));},this.ttl(),token);
   await this.appendBooks(job.instId,result.frames,"okx-public-orderbook-archive-and-retained-snapshots",token);
   await this.mutate<BookJob>(key,()=>job,v=>{v.state="complete";v.hash=result.sha256;delete v.error;delete v.retryAt;},this.ttl(),token);return true;
  }catch(error){if(error instanceof HistoryLeaseLostError)throw error;await this.mutate<BookJob>(key,()=>job,v=>{v.state="failed";v.error=sourceFailure(error,"archive");v.retryAt=this.now()+HOUR;},this.ttl(),token);return false;}
 }
 async readLiquidity(input:{instId:string;start:number;end:number;maxSamples?:number}):Promise<TerminalLiquidityHistory>{
  this.validate(input.instId,input.start,input.end,true);if(input.maxSamples!==undefined&&(!Number.isSafeInteger(input.maxSamples)||input.maxSamples<1||input.maxSamples>4096))throw Error("Choose a bounded number of real book samples");let all:TerminalBookHistoryFrame[]=[];const sources=new Set<string>();for(let at=Math.floor(input.start/HOUR)*HOUR;at<input.end;at+=HOUR){const hour=await this.storage.get<BookHour>(this.key("book-hour",`${input.instId}:${at}`));if(hour){all.push(...hour.frames.filter(f=>f.ts>=input.start&&f.ts<input.end));sources.add(hour.source);}}
  all.sort((a,b)=>a.ts-b.ts);const gaps:{start:number;end:number;reason:string}[]=[];let cursor=input.start;for(const f of all){const begin=Math.floor(f.ts/this.sampleMs)*this.sampleMs;if(begin>cursor)gaps.push({start:cursor,end:begin,reason:"No retained order-book observation for this interval"});cursor=Math.max(cursor,begin+this.sampleMs);}if(cursor<input.end)gaps.push({start:cursor,end:input.end,reason:"No retained order-book observation for this interval"});
  const jobs=new Map<number,BookJob>();
  for(let day=Math.floor(input.start/DAY)*DAY;day<input.end;day+=DAY){const job=await this.storage.get<BookJob>(this.key("book-job",`${input.instId}:${day}`));if(job)jobs.set(day,job);for(const gap of job?.gaps??[]){const start=Math.max(input.start,gap.start),end=Math.min(input.end,gap.end);if(end>start)gaps.push({start,end,reason:gap.reason});}}
  const described:typeof gaps=[];
  for(const gap of gaps){if(gap.reason!=="No retained order-book observation for this interval"){described.push(gap);continue;}
   for(let start=gap.start;start<gap.end;){const day=Math.floor(start/DAY)*DAY,end=Math.min(gap.end,day+DAY),job=jobs.get(day),published=day+DAY<=this.now()-2*DAY;
    const reason=job?.state==="failed"?`${job.error??"Dated archive backfill failed."}${job.retryAt?` Next retry after ${new Date(job.retryAt).toISOString()}.`:""}`:published?"No retained order-book observation; exact dated archive backfill is queued or in progress.":"No retained live order-book observation; the exchange has not yet published this dated archive.";
    described.push({start,end,reason});start=end;
   }
  }
  gaps.splice(0,gaps.length,...described);
  gaps.sort((a,b)=>a.start-b.start||a.end-b.end);const mergedGaps:typeof gaps=[];for(const gap of gaps){const last=mergedGaps.at(-1);if(last&&gap.start<=last.end){last.end=Math.max(last.end,gap.end);if(!last.reason.includes(gap.reason))last.reason+="; "+gap.reason;}else mergedGaps.push({...gap});}
  const maximum=input.maxSamples??720,stride=Math.max(1,Math.ceil(all.length/maximum)),frames=all.length<=maximum?all:maximum===1?[all[all.length-1]]:Array.from({length:maximum},(_,i)=>all[Math.round(i*(all.length-1)/(maximum-1))]),quote=frames.at(-1)?.bids[0]?.price??1,observedAt=this.now(),expected=Math.ceil((input.end-input.start)/this.sampleMs),failed=[...jobs.values()].filter(job=>job.state==="failed").length;
  const count=`${all.length} of ${expected} expected ${this.sampleMs/1000}s observation slots retained; ${frames.length} actual observations displayed.`;
  return{version:"terminal-liquidity-history-v1",source:[...sources].join(" + ")||"okx-public-orderbook-history",instrumentId:input.instId,marketType:"spot",quantityUnit:"base",requestedStart:input.start,requestedEnd:input.end,observedAt,status:!frames.length?"collecting":mergedGaps.length?"partial":"available",sampleIntervalMs:this.sampleMs*stride,priceStep:10**Math.floor(Math.log10(quote*1e-5)),depthLevels:this.depth,frames,gaps:mergedGaps,retainedFrom:all[0]?.ts,retainedTo:all.at(-1)?.ts,backfill:{state:!mergedGaps.length?"complete":failed?"failed":"collecting",pages:0,message:`${count} ${!mergedGaps.length?"Requested sampled history is retained; changes between samples are not implied.":failed?`${failed} dated archive job(s) need retry. Missing intervals stay unknown; see their exact source/retry reasons.`:"The server collects live books continuously and backfills dated archives after publication (normally T+3). Missing intervals stay unknown; current depth is not projected into them."}`}};
 }
 async collect(input:{instId?:string;maxPages?:number;maxWorkMs?:number;maxJobs?:number;captureBooks?:boolean}={}){
  const token=randomUUID(),lease=this.key("collector-lease");if(!await this.storage.acquire(lease,token,300))return{alreadyRunning:true,trades:0,books:0,archives:0};const deadline=Date.now()+(input.maxWorkMs??20000);let trades=0,books=0,archives=0;
  try{let queue=await this.storage.get<Queue>(this.key("queue"))??{revision:0,days:[],books:[],markets:[]};const markets=input.instId?[input.instId]:[...new Set([...(this.options.markets??[]),...queue.markets])];
   const end=Math.floor(this.now()/MINUTE)*MINUTE,start=Math.floor(end/DAY)*DAY;if(end>start)for(const instId of markets)await this.ensure({instId,start,end,priority:false});
   queue=await this.storage.get<Queue>(this.key("queue"))??queue;
   const marketOffset=(queue.marketCursor??0)%Math.max(1,markets.length),orderedMarkets=[...markets.slice(marketOffset),...markets.slice(0,marketOffset)];let marketAttempts=0;
   const captureBooks=async()=>{for(const instId of orderedMarkets){if(Date.now()>deadline)break;marketAttempts++;try{const frame=await(this.options.fetchBook??((id,depth)=>this.client.book(id,depth)))(instId,this.depth);await this.appendBooks(instId,[frame],"okx-public-spot-book-snapshots",token);books++;}catch(error){if(error instanceof HistoryLeaseLostError)throw error;/* The next read exposes the actual missing observation. */}}};
   const bookIds=queue.books.filter(id=>!input.instId||id.startsWith(input.instId+":")),bookOffset=(queue.bookCursor??0)%Math.max(1,bookIds.length),orderedBooks=[...bookIds.slice(bookOffset),...bookIds.slice(0,bookOffset)];let bookAttempts=0;
   const backfillBooks=async()=>{for(const id of orderedBooks){if(Date.now()>deadline||archives>=1||bookAttempts>=64)break;bookAttempts++;if(await this.collectBookArchive(id,token))archives++;}};
   const days=queue.days.filter(id=>!input.instId||id.startsWith(input.instId+":")),offset=(queue.cursor??0)%Math.max(1,days.length),priority=(queue.priorityUntil??0)>this.now()?(queue.priorityDays??[]).filter(id=>days.includes(id)):[],priorityId=priority.length?priority[(queue.priorityCursor??0)%priority.length]:undefined,ordered=[...(priorityId?[priorityId]:[]),...[...days.slice(offset),...days.slice(0,offset)].filter(id=>id!==priorityId)];let attempted=0,regularAttempts=0;
   const backfillTrades=async()=>{for(const id of ordered){if(Date.now()>deadline||trades>=(input.maxJobs??8)||attempted>=64)break;attempted++;if(id!==priorityId)regularAttempts++;if(await this.collectDay(id,input.maxPages??this.options.maxPages??20,token))trades++;}};
   // Slow archives must not consume every cycle before execution history gets a turn.
   const phases=input.captureBooks===false?[backfillBooks,backfillTrades]:[captureBooks,backfillBooks,backfillTrades],phase=(queue.phaseCursor??0)%phases.length;for(let i=0;i<phases.length;i++)await phases[(phase+i)%phases.length]();
   await this.mutate<Queue>(this.key("queue"),()=>queue,v=>{v.cursor=(offset+regularAttempts)%Math.max(1,days.length);if(priorityId&&attempted&&JSON.stringify(v.priorityDays)===JSON.stringify(queue.priorityDays))v.priorityCursor=((queue.priorityCursor??0)+1)%priority.length;v.bookCursor=((queue.bookCursor??0)+bookAttempts)%Math.max(1,bookIds.length);if(marketAttempts)v.marketCursor=((queue.marketCursor??0)+marketAttempts)%Math.max(1,markets.length);v.phaseCursor=(phase+1)%phases.length;},this.ttl(),token);
   return{alreadyRunning:false,trades,books,archives};
  }finally{await this.storage.release(lease,token);}
 }
}
const shared=new Map<string,TerminalMarketHistory>();
export function createTerminalMarketHistory(cfg:AppConfig,options:Partial<Options>={}){
 const url=cfg.QUEUE_PROVIDER==="redis"?cfg.REDIS_URL:cfg.QUEUE_PROVIDER==="upstash_kv"?cfg.KV_REST_API_URL:"",key=cfg.PERSISTENCE_NAMESPACE+":"+url;
 if(!Object.keys(options).length&&shared.has(key))return shared.get(key)!;
 const storage=options.storage??(url?new RedisTerminalHistoryStorage(new StoreRedis(url,cfg.KV_REST_API_TOKEN)):process.env.NODE_ENV==="test"?new MemoryTerminalHistoryStorage(options.now):null);if(!storage)throw Error("Durable public-market history storage is required");
 const result=new TerminalMarketHistory({storage,namespace:cfg.PERSISTENCE_NAMESPACE,retentionDays:cfg.TERMINAL_HISTORY_RETENTION_DAYS,bookRetentionDays:cfg.TERMINAL_HISTORY_BOOK_RETENTION_DAYS,sampleMs:cfg.TERMINAL_HISTORY_BOOK_SAMPLE_MS,depth:cfg.TERMINAL_HISTORY_BOOK_LEVELS,maxPages:cfg.TERMINAL_HISTORY_PAGES_PER_BATCH,markets:cfg.TERMINAL_HISTORY_MARKETS.split(",").map(s=>s.trim()).filter(exact),...options});
 if(!Object.keys(options).length)shared.set(key,result);return result;
}
