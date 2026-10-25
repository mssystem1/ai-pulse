import {candleCloseTime,candleLevelTouchedAfter,type GlobalReport} from "@pulse/schemas";

type Plan=NonNullable<GlobalReport["discretionaryPlan"]>;
type Band={lower:number;upper:number};
const band=(a:number,b:number):Band=>({lower:Math.min(a,b),upper:Math.max(a,b)});

/** Price intervals retain actual source bounds. The stop remains a hard cap;
 * favorable entry selection never moves protection or skips a nearer obstacle. */
export function applyGlobalPriceZones(report:GlobalReport){
  const original=report.discretionaryPlan;if(!original)return;
  const tf=report.snapshot.timeframe,cutoff=Date.parse(report.snapshot.observedAt),tick=10**-report.snapshot.pricePrecision;
  const atr=report.indicators.atr.points.at(-1)?.value??0;
  const sources=[{timeframe:tf,candles:report.candles,pivots:report.indicators.pivots},...(report.entryStudy?[report.entryStudy]:[])];
  const latest=[...sources,...(report.currentMarket?.frames??[])].flatMap(s=>{const c=s.candles.at(-1);return c?[{price:c.close,end:candleCloseTime(c.ts,s.timeframe)??0}]:[];}).sort((a,b)=>b.end-a.end)[0]?.price??original.reference.price;
  const current=report.currentMarket?.quote?.price??latest;
  const sourceBand=(p:Plan):Band=>{
    const price=p.entryBasis.price;
    if(p.entryBasis.kind==="structure_zone"){
      const z=report.horizonContext?.zones.find(z=>z.role===(p.side==="long"?"support":"resistance")&&(p.side==="long"?z.upper:z.lower)===price);
      if(z)return {lower:z.lower,upper:z.upper};
    }
    if(p.entryBasis.kind==="ema_ribbon"){
      const values=report.indicators.ema?.filter(e=>e.period===12||e.period===25).flatMap(e=>e.points.at(-1)?.value??[])??[];
      if(values.length===2)return band(values[0],values[1]);
    }
    if(p.entryBasis.kind==="range_edge"&&report.range){const z=p.side==="long"?(p.family==="range_rotation"?report.range.lower:report.range.upper):(p.family==="range_rotation"?report.range.upper:report.range.lower);return band(z[0],z[1]);}
    if(p.entryBasis.kind==="vwap_band"){
      const edge=p.side==="long"?"lower":"upper",outer=report.indicators.vwap?.bands?.find(b=>b.multiple===3)?.[edge].at(-1)?.value;
      if(outer!==undefined&&outer>0)return band(price,outer);
    }
    if(p.evidence){const e=p.evidence,test=[...sources,...(report.currentMarket?.frames??[])].find(s=>s.timeframe===e.timeframe)?.candles.find(c=>c.ts===e.testTs);if(test)return band(price,test.close);}
    return band(price,price);
  };
  const targetBand=(p:Plan,t:Plan["targets"][number]):Band=>{
    let result=band(t.price,t.price);
    if(t.basis==="structure_zone"){
      const z=report.horizonContext?.zones.find(z=>z.startTs===t.anchorTs&&z.knownAt===t.knownAt&&z.role===(p.side==="long"?"resistance":"support")&&(p.side==="long"?z.lower:z.upper)===t.price);
      if(z)result={lower:z.lower,upper:z.upper};
    }else if(t.basis==="confirmed_swing"||t.basis==="observed_extreme"){
      const c=report.candles.find(c=>c.ts===t.anchorTs);
      if(c)result=p.side==="long"?band(Math.max(c.open,c.close),c.high):band(c.low,Math.min(c.open,c.close));
    }
    // A partially traversed source wick cannot create reward behind today's
    // quote. Its remaining exact reference stays a point, with no fake width.
    if(p.side==="long"?result.lower<=current:result.upper>=current)return band(t.price,t.price);
    return result;
  };
  function fit(p:Plan){
    const sign=p.side==="long"?1:-1,source=sourceBand(p),kept:Plan["targets"]=[],targets:Band[]=[];
    for(const t of p.targets){const z=targetBand(p,t),prior=targets.at(-1);if(prior&&(p.side==="long"?z.lower<=prior.upper:z.upper>=prior.lower))continue;kept.push(t);targets.push(z);}
    if(!targets.length)return null;
    const near=p.side==="long"?targets[0].lower:targets[0].upper;
    const rawBarriers:Plan["barriers"]=[...p.barriers,...sources.flatMap(s=>s.pivots.flatMap(a=>{
      const knownAt=a.confirmedAt===null?null:candleCloseTime(a.confirmedAt,s.timeframe);
      if(knownAt===null||knownAt>cutoff||a.kind!==(p.side==="long"?"high":"low")||s.candles.some(c=>c.ts>=knownAt&&(p.side==="long"?c.close>a.price:c.close<a.price)))return [];
      if([...sources,...(report.currentMarket?.frames??[])].some(s=>candleLevelTouchedAfter(s.candles,s.timeframe,a.price,p.side,knownAt,cutoff)))return [];
      return [{price:a.price,timeframe:s.timeframe,anchorTs:a.ts,knownAt}];
    }))];
    for(const z of report.horizonContext?.zones??[])if(z.role===(p.side==="long"?"resistance":"support"))rawBarriers.push({price:p.side==="long"?z.lower:z.upper,timeframe:tf,anchorTs:z.startTs,knownAt:z.knownAt});
    const obstacles=rawBarriers.filter(b=>sign*(b.price-current)>tick&&sign*(near-b.price)>tick&&sign*(b.price-(p.side==="long"?source.lower:source.upper))>tick).sort((a,b)=>sign*(a.price-b.price));
    const first=obstacles[0]?.price??near;
    // At least equal potential reward and full hard-stop risk, calculated
    // at the least favorable fill and the first real obstacle, before costs.
    const limit=(first+p.stop)/2;
    const admissible={lower:p.side==="long"?Math.max(source.lower,p.stopBasis.price):source.lower,upper:p.side==="short"?Math.min(source.upper,p.stopBasis.price):source.upper};
    const entry={...admissible};
    if(p.side==="long")entry.upper=Math.min(entry.upper,Math.floor((limit+tick*1e-5)/tick)*tick);
    else entry.lower=Math.max(entry.lower,Math.ceil((limit-tick*1e-5)/tick)*tick);
    const fits=entry.lower<=entry.upper&&sign*((p.side==="long"?entry.lower:entry.upper)-p.stop)>tick;
    if(!fits){entry.lower=admissible.lower;entry.upper=admissible.upper;}
    const worst=p.side==="long"?entry.upper:entry.lower;
    if(entry.lower>entry.upper||sign*((p.side==="long"?entry.lower:entry.upper)-p.stop)<=0||sign*(worst-p.stop)<=tick||sign*(near-worst)<=tick)return null;
    const barriers=obstacles.filter(b=>sign*(b.price-worst)>tick).filter((b,i,all)=>all.findIndex(a=>a.price===b.price&&a.timeframe===b.timeframe)===i).slice(0,5);
    const firstActual=barriers[0]?.price??near,rr=sign*(firstActual-worst)/Math.abs(worst-p.stop);
    const sourcePrice=p.entryBasis.price;
    p.entry=Number(worst.toPrecision(12));p.entryBasis.price=p.entry;p.targets=kept;p.barriers=barriers;
    p.version="discretionary-plan-v6";
    p.priceZones={version:"price-zones-v1",entry:{lower:Number(entry.lower.toPrecision(12)),upper:Number(entry.upper.toPrecision(12)),sourceLower:source.lower,sourceUpper:source.upper,sourcePrice},stop:band(p.stop,p.stopBasis.price),targets,payoffFloor:1,payoffLimited:rr<1-1e-9};
    return {p,rr};
  }
  let selected=fit(structuredClone(original));
  if(!selected||selected.p.priceZones!.payoffLimited){
    // A narrow crossed level may have no viable entry interval. Evaluate an
    // evidenced primary retest on the same side, rather than extending targets.
    const zones=(report.horizonContext?.zones??[]).filter(z=>z.role===(original.side==="long"?"support":"resistance")).sort((a,b)=>Math.abs((a.lower+a.upper)/2-current)-Math.abs((b.lower+b.upper)/2-current));
    for(const z of zones){
      const p=structuredClone(original);p.family="level_retest";p.entry=p.side==="long"?z.upper:z.lower;p.entryBasis={kind:"structure_zone",price:p.entry,timeframe:tf,knownAt:z.knownAt};
      p.stopBasis={price:p.side==="long"?z.lower:z.upper,timeframe:tf,anchorTs:z.startTs,knownAt:z.knownAt};
      p.stop=p.side==="long"?Math.max(tick,Math.min(p.entry-atr*.5,z.lower-atr*.2)):Math.max(p.entry+atr*.5,z.upper+atr*.2);
      p.stop=Number(p.stop.toPrecision(12));
      const alternative=fit(p);if(alternative&&(!selected||alternative.rr>selected.rr)){selected=alternative;if(!alternative.p.priceZones!.payoffLimited)break;}
    }
  }
  if(selected)report.discretionaryPlan=selected.p;
}
