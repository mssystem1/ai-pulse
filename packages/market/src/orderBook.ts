/** Historical OKX 400-level archive rows use price, base size and order count.
 * This format does not expose WebSocket sequence IDs or message checksums. */
export type MarketBookLevel={price:number;size:number;orders:number};
export type MarketBookRecord={instId:string;action:"snapshot"|"update";ts:number;asks:MarketBookLevel[];bids:MarketBookLevel[]};
export function decodeOkxArchiveBookRecord(raw:{instId:string;action:string;ts:string;asks:string[][];bids:string[][]},instId:string):MarketBookRecord{
  if(raw.instId!==instId||!["snapshot","update"].includes(raw.action)||!/^\d+$/.test(raw.ts)||!Number.isSafeInteger(Number(raw.ts)))throw Error("Invalid historical book identity or timestamp");
  const levels=(rows:string[][])=>{
    if(!Array.isArray(rows)||rows.length>2000)throw Error("Invalid historical book side");
    const seen=new Set<number>();
    return rows.map(row=>{
      if(!Array.isArray(row)||row.length!==3||row.some(value=>typeof value!=="string"||!value.trim()))throw Error("Invalid historical book row format");
      const [price,size,orders]=row.map(Number);
      if(!Number.isFinite(price)||price<=0||!Number.isFinite(size)||size<0||!Number.isSafeInteger(orders)||orders<0||seen.has(price))throw Error("Invalid or duplicate historical book level");
      seen.add(price);return {price,size,orders};
    });
  };
  return {instId,action:raw.action as MarketBookRecord["action"],ts:Number(raw.ts),asks:levels(raw.asks),bids:levels(raw.bids)};
}

class BookSide{
  prices:number[]=[];
  levels=new Map<number,MarketBookLevel>();
  constructor(private readonly bid:boolean,private readonly depth:number){}
  clear(){this.prices=[];this.levels.clear();}
  update(rows:MarketBookLevel[]){
    for(const row of rows){
      let lo=0,hi=this.prices.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.prices[mid]<row.price)lo=mid+1;else hi=mid;}
      const exists=this.levels.has(row.price);
      if(row.size===0){if(exists){this.levels.delete(row.price);this.prices.splice(lo,1);}continue;}
      if(!exists)this.prices.splice(lo,0,row.price);
      this.levels.set(row.price,{...row});
    }
    // Archive deltas can contain simultaneous deletes and replacements at the
    // depth boundary. Trim after the complete side update, never mid-message.
    const excess=this.prices.length-this.depth;
    if(excess>0){const removed=this.bid?this.prices.splice(0,excess):this.prices.splice(this.depth);for(const price of removed)this.levels.delete(price);}
  }
  best(){return this.bid?this.prices.at(-1):this.prices[0];}
  snapshot(depth:number){const prices=this.bid?this.prices.slice(-depth).reverse():this.prices.slice(0,depth);return prices.map(price=>({...this.levels.get(price)!}));}
}

/** Causal depth reconstruction with bounded state. Chronology is checked;
 * publisher sequence continuity cannot be asserted from this archive format. */
export class MarketOrderBook{
  private readonly asks:BookSide;
  private readonly bids:BookSide;
  private ready=false;
  private at=-1;
  constructor(readonly instId:string,readonly depth=400){
    if(!Number.isSafeInteger(depth)||depth<1||depth>400)throw Error("Unsupported archive book depth");
    this.asks=new BookSide(false,depth);this.bids=new BookSide(true,depth);
  }
  apply(record:MarketBookRecord){
    if(record.instId!==this.instId||!Number.isSafeInteger(record.ts)||record.ts<this.at)throw Error("Book identity or chronology mismatch");
    if(record.action==="snapshot"){this.ready=false;this.asks.clear();this.bids.clear();}
    else if(!this.ready)throw Error("Book update requires a valid snapshot");
    this.asks.update(record.asks);this.bids.update(record.bids);this.at=record.ts;
    const bid=this.bids.best(),ask=this.asks.best();
    if(bid===undefined||ask===undefined||bid>=ask){this.ready=false;throw Error("Empty or crossed historical book; require a fresh snapshot");}
    this.ready=true;
  }
  get timestamp(){return this.ready?this.at:null;}
  get bestBid(){return this.ready?this.bids.best()??null:null;}
  get bestAsk(){return this.ready?this.asks.best()??null:null;}
  snapshot(depth=this.depth){
    if(!this.ready)throw Error("Historical book is not valid");
    if(!Number.isSafeInteger(depth)||depth<1||depth>this.depth)throw Error("Snapshot depth exceeds retained history");
    const bids=this.bids.snapshot(depth),asks=this.asks.snapshot(depth);
    return {instId:this.instId,ts:this.at,bids,asks,bestBid:bids[0].price,bestAsk:asks[0].price,sequenceVerified:false as const};
  }
}
