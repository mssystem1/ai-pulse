import {buildGlobalOrderFlow,type GlobalPreparationMarket} from "@pulse/analysis";
import type {MarketTradeCapture} from "@pulse/market";
import type {GlobalOrderFlow} from "@pulse/schemas";

type DailyReference={source:string;instId:string;bar:string;fetchedAt:string;candle:{ts:number;open:number;high:number;low:number;close:number;volume:number;confirmed?:boolean}};
type Options={capture:(instId:string)=>Promise<{capture:MarketTradeCapture}>;dailyReference:(instId:string,start:number,end:number)=>Promise<DailyReference>;reconcile:(capture:MarketTradeCapture,reference:DailyReference)=>unknown;now?:()=>number;cacheMs?:number;maxProfileAgeMs?:number;maxEntries?:number;maxPending?:number};
type CachedFlow={availableAt:number;expiresAt:number;end:number;flows:Map<string,GlobalOrderFlow>};
const DAY=86_400_000,FRAMES=["15m","1H","4H","1Dutc","1Wutc"];
const near=(a:number,b:number)=>Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-10);

/** Assemble the optional source feed before fetching a new report's candles.
 * attach() never changes an existing market's observation time or prices. */
export function createGlobalOrderFlowFeed(options:Options){
  const now=options.now??Date.now,cacheMs=options.cacheMs??3_600_000,maxAge=options.maxProfileAgeMs??4*DAY,maxEntries=options.maxEntries??12,maxPending=options.maxPending??12;
  if(![cacheMs,maxAge,maxEntries,maxPending].every(v=>Number.isSafeInteger(v)&&v>0))throw Error("Invalid order-flow feed bound");
  const cache=new Map<string,CachedFlow>(),pending=new Map<string,Promise<void>>();let tail:Promise<void>=Promise.resolve();
  async function warm(instId:string){
    if(!/^[A-Z0-9]{1,20}-[A-Z0-9]{1,12}$/.test(instId))return;
    const clock=now();if(!Number.isSafeInteger(clock))throw Error("Invalid order-flow feed clock");const old=cache.get(instId);
    if(old&&old.availableAt<=clock&&old.expiresAt>clock&&clock-old.end<=maxAge){cache.delete(instId);cache.set(instId,old);return;}
    const existing=pending.get(instId);if(existing)return existing;if(pending.size>=maxPending)throw Error("Order-flow feed queue is full");
    const task=tail.then(async()=>{
      const result=await options.capture(instId),capture=result.capture,c=capture.coverage,clock=now(),capturedAt=Date.parse(capture.capturedAt);
      if(capture.source!=="okx-public-spot"||capture.instId!==instId||capture.priceCurrency!==instId.split("-")[1]||capture.marketType!=="spot"||capture.quantityUnit!=="base"||!c.complete||!Number.isSafeInteger(clock)||!Number.isSafeInteger(c.start)||!Number.isSafeInteger(c.end)||c.start%DAY||c.end-c.start!==DAY||!Number.isSafeInteger(c.knownAt)||!Number.isSafeInteger(capturedAt)||c.knownAt<Math.max(c.end,capturedAt)||c.knownAt>clock||clock-c.end>maxAge||!capture.trades.length)throw Error("Incomplete, unavailable or mismatched trade capture");
      const reference=await options.dailyReference(instId,c.start,c.end),referenceAt=Date.parse(reference.fetchedAt);
      if(reference.instId!==instId||reference.source!==capture.source||reference.bar!=="1Dutc"||reference.candle.ts!==c.start||reference.candle.confirmed!==true||!Number.isSafeInteger(referenceAt)||referenceAt<c.end||referenceAt>now())throw Error("Unavailable daily trade reconciliation");
      await options.reconcile(capture,reference);
      let minimum=capture.trades[0].price,maximum=minimum;
      for(const t of capture.trades){minimum=Math.min(minimum,t.price);maximum=Math.max(maximum,t.price);}
      const span=Math.max(maximum-minimum,maximum*1e-8,Number.MIN_VALUE*128),rowSize=10**Math.ceil(Math.log10(span/128)),verifiedAt=Math.max(c.knownAt,referenceAt),flows=new Map<string,GlobalOrderFlow>();
      // Keep the original trade capture clock. The cache's later availability
      // also includes source reconciliation and completed aggregation.
      for(const timeframe of FRAMES){const flow=buildGlobalOrderFlow(capture,{timeframe,start:c.start,end:c.end,asOf:now(),rowSize});if(!flow)throw Error("Verified trade window could not be aggregated");flows.set(timeframe,flow);}
      const availableAt=now();if(!Number.isSafeInteger(availableAt)||availableAt<verifiedAt)throw Error("Invalid flow availability clock");
      cache.delete(instId);while(cache.size>=maxEntries)cache.delete(cache.keys().next().value!);cache.set(instId,{availableAt,expiresAt:availableAt+cacheMs,end:c.end,flows});
    });
    pending.set(instId,task);tail=task.then(()=>{},()=>{});try{await task;}finally{pending.delete(instId);}
  }
  function attach<T extends GlobalPreparationMarket>(market:T):T&{orderFlow?:GlobalOrderFlow}{
    if(market.source!=="okx-public-spot"||market.orderFlow)return market;
    const entry=cache.get(market.instId),observed=Date.parse(market.fetchedAt),flow=entry?.flows.get(market.bar);
    if(!entry||!flow||!Number.isSafeInteger(observed)||observed<entry.availableAt||observed-flow.profile.end>maxAge||flow.profile.knownAt>observed||flow.priceCurrency!==(market.ticker.priceCurrency??market.instId.split("-")[1]))return market;
    const candles=new Map(market.candles.map(c=>[c.ts,c])),copy=structuredClone(flow);copy.footprints=copy.footprints.filter(f=>candles.has(f.start));
    for(const footprint of copy.footprints){const c=candles.get(footprint.start)!;if(c.confirmed!==true||!(["open","high","low","close","volume"] as const).every(k=>near(footprint[k],c[k])))return market;}
    return {...market,orderFlow:copy};
  }
  return {warm,attach};
}
