import {candleCloseTime,type GlobalAnchor,type GlobalCandle,type GlobalChannel,type GlobalRange} from "@pulse/schemas";

/** Explicit research-profile tolerances. These measure construction quality;
 * they are not probabilities or claims about trading performance. */
export function globalPriceStructures(candles:GlobalCandle[],pivots:GlobalAnchor[],atr:number,timeframe:string) {
  const channels:GlobalChannel[]=[];
  if(!candles.length||!atr)return {channels,range:null as GlobalRange|null};
  const index=new Map(candles.map((c,i)=>[c.ts,i])),last=candles.at(-1)!;
  const known=(a:GlobalAnchor)=>a.confirmedAt===null?Infinity:candleCloseTime(a.confirmedAt,timeframe)??Infinity;
  const tolerance=atr*.3;
  for(const [scope,window,minSpan] of [["broad",180,40],["local",64,12]] as const){
    const first=Math.max(0,candles.length-window),anchors=pivots.filter(p=>(index.get(p.ts)??-1)>=first&&known(p)<=candleCloseTime(last.ts,timeframe)!);
    const candidates:Array<{channel:GlobalChannel;score:number}>=[];
    for(const kind of ["low","high"] as const){
      const same=anchors.filter(a=>a.kind===kind).slice(-10),other=anchors.filter(a=>a.kind!==kind);
      for(let i=0;i<same.length-1;i++)for(let j=i+1;j<same.length;j++){
        const a=same[i],b=same[j],ia=index.get(a.ts)!,ib=index.get(b.ts)!,span=ib-ia;if(span<minSpan)continue;
        const slope=(b.price-a.price)/span,base=(n:number)=>a.price+slope*(n-ia);
        const opposite=other.filter(c=>c.ts>=a.ts&&c.ts<=b.ts).sort((x,y)=>kind==="low"?(y.price-base(index.get(y.ts)!))-(x.price-base(index.get(x.ts)!)):(x.price-base(index.get(x.ts)!))-(y.price-base(index.get(y.ts)!)))[0];
        if(!opposite)continue;
        const offset=opposite.price-base(index.get(opposite.ts)!);
        if(kind==="low"?offset<2*atr:offset>-2*atr)continue;
        const lower=(n:number)=>base(n)+Math.min(0,offset),upper=(n:number)=>base(n)+Math.max(0,offset);
        const touches={lower:0,upper:0};
        for(const p of anchors.filter(p=>p.ts>=a.ts)){const n=index.get(p.ts)!;if(p.kind==="low"&&Math.abs(p.price-lower(n))<=tolerance){touches.lower++;}if(p.kind==="high"&&Math.abs(p.price-upper(n))<=tolerance){touches.upper++;}}
        if(touches.lower<2||touches.upper<2)continue;
        const tail=candles.slice(ia),violations=tail.filter((c,k)=>c.close<lower(ia+k)-tolerance||c.close>upper(ia+k)+tolerance).length;
        if(violations>Math.max(1,Math.floor(tail.length*.05))||last.close<lower(candles.length-1)-tolerance||last.close>upper(candles.length-1)+tolerance)continue;
        const channel:GlobalChannel={id:`${scope}-${a.id}-${b.id}`,type:"parallel",scope,timeframe,scale:"linear",base:[a,b],opposite,offset,knownAt:candleCloseTime(last.ts,timeframe)!,startTs:a.ts,endTs:last.ts,touches,closeViolations:violations};
        candidates.push({channel,score:(touches.lower+touches.upper)*4+span/window*5-violations*3-(candles.length-1-ib)/window});
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    const chosen=candidates.find(c=>channels.every(old=>old.base[0].id!==c.channel.base[0].id||old.base[1].id!==c.channel.base[1].id));
    if(chosen)channels.push(chosen.channel);
  }
  return {channels,range:globalPriceRange(candles,pivots,atr,timeframe)};
}

export function globalPriceRange(candles:GlobalCandle[],pivots:GlobalAnchor[],atr:number,timeframe:string):GlobalRange|null{
  const last=candles.at(-1);if(!last||!atr)return null;
  const known=(a:GlobalAnchor)=>a.confirmedAt===null?Infinity:candleCloseTime(a.confirmedAt,timeframe)??Infinity,tolerance=atr*.3;
  for(const window of [32,48,64,96]){
    const tail=candles.slice(-window),first=tail[0]?.ts;if(first===undefined)continue;
    const recent=pivots.filter(p=>p.ts>=first&&known(p)<=candleCloseTime(last.ts,timeframe)!);
    const lows=recent.filter(p=>p.kind==="low"),highs=recent.filter(p=>p.kind==="high");if(lows.length<2||highs.length<2)continue;
    const floor=Math.min(...lows.map(p=>p.price)),ceiling=Math.max(...highs.map(p=>p.price));
    const lowTouches=lows.filter(p=>p.price-floor<=atr*.65),highTouches=highs.filter(p=>ceiling-p.price<=atr*.65);
    if(lowTouches.length<2||highTouches.length<2||ceiling-floor<atr*2||ceiling-floor>atr*10)continue;
    const lower:[number,number]=[floor,Math.max(...lowTouches.map(p=>p.price))],upper:[number,number]=[Math.min(...highTouches.map(p=>p.price)),ceiling];
    const containment=tail.filter(c=>c.close>=floor-tolerance&&c.close<=ceiling+tolerance).length/tail.length;
    const changes=(points:GlobalAnchor[])=>Math.abs(points.at(-1)!.price-points[0].price);
    if(containment<.9||last.close<floor-tolerance||last.close>ceiling+tolerance||changes(lowTouches)>atr*.65||changes(highTouches)>atr*.65)continue;
    return {lower,upper,anchorIds:[...lowTouches,...highTouches].map(p=>p.id),startTs:first,touches:lowTouches.length+highTouches.length};
  }
  return null;
}
