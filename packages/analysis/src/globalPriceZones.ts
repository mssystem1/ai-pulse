import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalEntryOpposition,globalRouteObstacles} from "./globalRouteObstacles.js";
import {deriveGlobalExecutionPolicy,type GlobalExecutionSettings} from "./globalExecutionPolicy.js";

type Plan=NonNullable<GlobalReport["discretionaryPlan"]>;
type Band={lower:number;upper:number};
const band=(a:number,b:number):Band=>({lower:Math.min(a,b),upper:Math.max(a,b)});

/** Source-backed execution intervals are fixed before measuring payoff. The
 * structural stop, first obstacle and genuine target bands remain unchanged. */
export function applyGlobalPriceZones(report:GlobalReport,settings:Partial<GlobalExecutionSettings>={}){
  const original=report.discretionaryPlan;if(!original)return;
  const tf=report.snapshot.timeframe,tick=10**-report.snapshot.pricePrecision;
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
    // A candle body may straddle a future entry while its actual swing high/
    // low remains ahead. Keep that exact objective as a point; do not shift
    // Entry, invent a partial wick interval or skip to a farther objective.
    if(["confirmed_swing","observed_extreme"].includes(t.basis)&&(p.side==="long"?result.lower<=p.entryBasis.price:result.upper>=p.entryBasis.price))return band(t.price,t.price);
    return result;
  };
  function fit(p:Plan){
    const sign=p.side==="long"?1:-1,source=sourceBand(p),kept:Plan["targets"]=[],targets:Band[]=[];
    for(const t of p.targets){const z=targetBand(p,t),prior=targets.at(-1);if(prior&&(p.side==="long"?z.lower<=prior.upper:z.upper>=prior.lower))continue;kept.push(t);targets.push(z);}
    if(!targets.length)return null;
    const near=p.side==="long"?targets[0].lower:targets[0].upper;
    p.targets=kept;
    let {entry,policy}=deriveGlobalExecutionPolicy(report,p,source,settings);
    const valid=(z:Band)=>z.lower<=z.upper&&sign*((p.side==="long"?z.lower:z.upper)-p.stop)>tick&&sign*(near-(p.side==="long"?z.upper:z.lower))>tick;
    if(!valid(entry)){
      // A complete passive interval cannot cross its structural stop or an
      // existing objective. A distinct defended-boundary retest is coherent
      // at the genuine source price; no reward/risk threshold selects it.
      ({entry,policy}=deriveGlobalExecutionPolicy(report,p,source,{...settings,boundaryRetest:true}));
    }
    const rawBarriers=globalRouteObstacles(report,p.side);
    const obstacles=rawBarriers.filter(b=>sign*(near-b.price)>tick&&sign*(b.price-(p.side==="long"?source.lower:source.upper))>tick).sort((a,b)=>sign*(a.price-b.price));
    const worst=p.side==="long"?entry.upper:entry.lower;
    if(entry.lower>entry.upper||sign*((p.side==="long"?entry.lower:entry.upper)-p.stop)<=0||sign*(worst-p.stop)<=tick||sign*(near-worst)<=tick)return null;
    const barriers=obstacles.filter(b=>sign*(b.price-worst)>tick).filter((b,i,all)=>all.findIndex(a=>a.price===b.price&&a.timeframe===b.timeframe)===i).slice(0,5);
    const firstActual=barriers[0]?.price??near,rr=globalEntryOpposition(report,p.side,entry).length?0:sign*(firstActual-worst)/Math.abs(worst-p.stop);
    const sourcePrice=p.entryBasis.price;
    p.entry=Number(worst.toPrecision(12));p.targets=kept;p.barriers=barriers;
    p.version="discretionary-plan-v8";
    p.executionPolicy=policy;
    delete p.requiresNewTestAfter;
    p.priceZones={version:"price-zones-v1",entry:{lower:Number(entry.lower.toPrecision(12)),upper:Number(entry.upper.toPrecision(12)),sourceLower:source.lower,sourceUpper:source.upper,sourcePrice},stop:band(p.stop,p.stopBasis.price),targets,payoffFloor:1,payoffLimited:rr<1-1e-9};
    return {p,rr};
  }
  // Poor clearance remains visible. It cannot move a bid/offer to a deeper
  // historical zone, change its family or borrow a different invalidation.
  const selected=fit(structuredClone(original));
  if(selected)report.discretionaryPlan=selected.p;
}
