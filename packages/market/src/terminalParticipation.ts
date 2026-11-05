import {createHash} from "node:crypto";
import {decodeOkxTradePrint,type MarketTradeCapture} from "./orderFlow.js";

type Fetch = typeof fetch;
export type TerminalParticipation = {
  capture:MarketTradeCapture|null;perpetualCapture?:MarketTradeCapture|null;reason?:string;
  derivatives:{instId:string;knownAt:number;openInterest?:number;openInterestUsd?:number;openInterestAt?:number;fundingRate?:number;fundingTime?:number;fundingObservedAt?:number;markPrice?:number;markPriceAt?:number;reason?:string};
  liquidity:{knownAt:number;bids?:{price:number;size:number}[];asks?:{price:number;size:number}[];sequence?:number;reason?:string};
};
const validInstrument=(id:string)=>/^[A-Z0-9]{2,20}-(USDT|USDC|USD)$/.test(id);
const numeric=(v:unknown)=>typeof v==="string"&&v.trim()&&Number.isFinite(Number(v))?Number(v):undefined;

/** Bounded public reads. A returned tail is labelled partial unless the paging
 * cursor actually crossed the requested start. Never synthesize tape from OHLCV. */
export async function loadTerminalParticipation(input:{instId:string;start:number;end:number;fetchImpl?:Fetch;timeoutMs?:number}):Promise<TerminalParticipation>{
  if(!validInstrument(input.instId)||!Number.isSafeInteger(input.start)||!Number.isSafeInteger(input.end)||input.start>=input.end)throw Error("Invalid Terminal participation window");
  const fetchImpl=input.fetchImpl??fetch,deadline=Date.now()+(input.timeoutMs??12000);
  async function get(path:string):Promise<Record<string,unknown>[]> {
    const remaining=deadline-Date.now();if(remaining<=0)throw Error("Participation source deadline exceeded");
    const response=await fetchImpl(`https://www.okx.com${path}`,{signal:AbortSignal.timeout(Math.min(remaining,6000))});
    if(!response.ok)throw Error(`Market source HTTP ${response.status}`);
    const text=await response.text();if(text.length>512000)throw Error("Market source response exceeds bound");
    const body=JSON.parse(text);if(body?.code!=="0"||!Array.isArray(body.data))throw Error("Market source rejected request");return body.data;
  }
  const swap=`${input.instId}-SWAP`;
  const trades=async(instId=input.instId,marketType:"spot"|"perpetual"="spot")=>{
    const retained=new Map<string,ReturnType<typeof decodeOkxTradePrint>>();let cursor:string|undefined,crossed=false;
    for(let page=0;page<6;page++){
      const rows=await get(`/api/v5/market/history-trades?instId=${instId}&limit=100${cursor?`&after=${cursor}`:""}`);
      if(!rows.length)break;
      let oldest=Infinity,next:string|undefined;
      for(const raw of rows){const t=decodeOkxTradePrint(raw as never,instId);oldest=Math.min(oldest,t.ts);next=t.id;
        const previous=retained.get(t.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(t))throw Error("Trade identity changed across pages");retained.set(t.id,t);}
      if(oldest<input.start){crossed=true;break;}if(!next||next===cursor)break;cursor=next;
    }
    const all=[...retained.values()].sort((a,b)=>a.ts-b.ts||a.id.localeCompare(b.id)),knownAt=Date.now();
    // Page boundaries may cut a millisecond containing multiple executions.
    // Exclude cut boundary timestamps; the interior is the captured interval.
    const start=crossed?input.start:(all[0]?.ts??input.start)+1,end=Math.min(input.end,all.at(-1)?.ts??input.end);
    const selected=all.filter(t=>t.ts>=start&&t.ts<end);
    if(!selected.length)return null;
    return {source:"okx-public-history-trades",instId,priceCurrency:input.instId.split("-").at(-1)!,marketType,quantityUnit:marketType==="spot"?"base" as const:"contracts" as const,
      capturedAt:new Date(knownAt).toISOString(),coverage:{start,end,knownAt,complete:true,sha256:[createHash("sha256").update(JSON.stringify(selected)).digest("hex")]},trades:selected} satisfies MarketTradeCapture;
  };
  const [t,oi,funding,book,perp,mark]=await Promise.allSettled([
    trades(),get(`/api/v5/public/open-interest?instType=SWAP&instId=${swap}`),get(`/api/v5/public/funding-rate?instId=${swap}`),get(`/api/v5/market/books?instId=${input.instId}&sz=50`),trades(swap,"perpetual"),get(`/api/v5/public/mark-price?instType=SWAP&instId=${swap}`),
  ]);
  const o=oi.status==="fulfilled"?oi.value.find(r=>r.instId===swap):undefined,f=funding.status==="fulfilled"?funding.value.find(r=>r.instId===swap):undefined,m=mark.status==="fulfilled"?mark.value.find(r=>r.instId===swap):undefined;
  const derivatives:TerminalParticipation["derivatives"]={instId:swap,knownAt:Math.max(numeric(o?.ts)??0,numeric(f?.ts)??0,numeric(m?.ts)??0),...(o?{openInterest:numeric(o.oi),openInterestUsd:numeric(o.oiUsd),openInterestAt:numeric(o.ts)}:{}),...(f?{fundingRate:numeric(f.fundingRate),fundingTime:numeric(f.fundingTime),fundingObservedAt:numeric(f.ts)}:{}),...(m?{markPrice:numeric(m.markPx),markPriceAt:numeric(m.ts)}:{})};
  if(!o&&!f&&!m)derivatives.reason="No current perpetual OI/funding/mark source supplied for this instrument.";
  const b=book.status==="fulfilled"?book.value[0]:undefined;
  const levels=(raw:unknown)=>{if(!Array.isArray(raw)||raw.length>50)throw Error("Invalid depth bound");return raw.map(row=>{const price=numeric(row?.[0]),size=numeric(row?.[1]);if(!price||size===undefined||size<0)throw Error("Invalid depth level");return {price,size};});};
  let liquidity:TerminalParticipation["liquidity"]={knownAt:0,reason:"Current depth source unavailable."};
  if(b)try{const bids=levels(b.bids),asks=levels(b.asks),knownAt=numeric(b.ts)??0;if(!bids.length||!asks.length||bids[0].price>=asks[0].price)throw Error("Crossed/empty depth");liquidity={knownAt,bids,asks,...(numeric(b.seqId)!==undefined?{sequence:numeric(b.seqId)}:{})};}catch{/* invalid depth remains unknown */}
  return {capture:t.status==="fulfilled"?t.value:null,perpetualCapture:perp.status==="fulfilled"?perp.value:null,...(t.status==="rejected"?{reason:"Executed trade source unavailable; candles are not substituted."}:{}),derivatives,liquidity};
}
