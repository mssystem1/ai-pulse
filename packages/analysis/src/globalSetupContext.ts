import {candleCloseTime,type GlobalCandle,type GlobalReport} from "@pulse/schemas";
import {globalSetupStrategyProfile} from "@pulse/domain";

type PricedPlan=NonNullable<GlobalReport["discretionaryPlan"]>;
type Choice=Pick<PricedPlan,"side"|"family"|"entryBasis">;

/** Select a current conditional setup from location and retained structure.
 * These numerical conventions implement public methods, not private XO rules. */
export function selectGlobalSetupContext(report:GlobalReport,input:{bars:GlobalCandle[];timeframe:string;completedAt:number;primaryClosed:number;primaryAtr:number;cutoff:number}):Choice{
  const {bars,timeframe,completedAt,primaryClosed,primaryAtr,cutoff}=input;
  const last=bars.at(-1)!,primary=report.candles.at(-1)!,tf=report.snapshot.timeframe;
  const assessment=report.setupSelection?.assessment,regime=report.setupSelection?.regime;
  const fast=report.indicators.ema?.find(e=>e.period===12)?.points.at(-1)?.value;
  const slow=report.indicators.ema?.find(e=>e.period===25)?.points.at(-1)?.value;
  const range=report.range;
  const rangeMid=range?(range.lower[1]+range.upper[0])/2:undefined;
  const pick=(side:Choice["side"],family:Choice["family"],kind:Choice["entryBasis"]["kind"],price:number,sourceTf:string,knownAt:number):Choice=>({side,family,entryBasis:{kind,price,timeframe:sourceTf,knownAt}});
  const vwap=report.indicators.vwap,band=(multiple:number,edge:"upper"|"lower")=>vwap?.bands?.find(b=>b.multiple===multiple)?.[edge].at(-1)?.value;
  const balanced=regime==="range"||Boolean(fast!==undefined&&slow!==undefined&&Math.abs(fast-slow)<=primaryAtr*.25);
  const upper=band(2,"upper"),lower=band(2,"lower");
  const upperReject=upper!==undefined&&lower!==undefined&&upper>lower&&primary.high>=upper&&primary.close<upper;
  const lowerReject=lower!==undefined&&upper!==undefined&&upper>lower&&lower>0&&primary.low<=lower&&primary.close>lower;
  const first=band(1,upperReject?"upper":"lower"),unplayedValue=first!==undefined&&(upperReject?last.close>first:last.close<first);
  if(globalSetupStrategyProfile(tf)?.families.some(f=>f==="vwap_reversion")&&balanced&&upperReject!==lowerReject&&unplayedValue){
    return pick(upperReject?"short":"long","vwap_reversion","vwap_band",upperReject?upper!:lower!,tf,primaryClosed);
  }

  // A range escape proposes a retest of the broken boundary. Its targets and
  // invalidation must not remain trapped inside the former balance.
  if(range&&last.close>range.upper[1])return pick("long","breakout_retest","range_edge",range.upper[1],tf,primaryClosed);
  if(range&&last.close<range.lower[0])return pick("short","breakout_retest","range_edge",range.lower[0],tf,primaryClosed);

  const pivots=report.entryStudy?.status==="available"?report.entryStudy.pivots:report.indicators.pivots;
  // Use the current local sequence, not every repeatedly crossed historical
  // pivot. A distant obsolete low must not override a fresh reclaim above it.
  const availablePivots=pivots.filter(a=>{const at=a.confirmedAt===null?null:candleCloseTime(a.confirmedAt,timeframe);return at!==null&&at<=cutoff;});
  const localPivots=[...availablePivots.filter(a=>a.kind==="high").slice(-2),...availablePivots.filter(a=>a.kind==="low").slice(-2)];
  const crosses=localPivots.flatMap(anchor=>{
    const knownAt=anchor.confirmedAt===null?null:candleCloseTime(anchor.confirmedAt,timeframe);
    if(knownAt===null||knownAt>cutoff||Math.abs(last.close-anchor.price)>primaryAtr)return [];
    const side:Choice["side"]=anchor.kind==="high"?"long":"short",sign=side==="long"?1:-1;
    if(sign*(last.close-anchor.price)<0)return [];
    // An interior range rotation respects its location. A tiny local break
    // beside the opposite edge does not turn that edge into trend support.
    if(range&&regime==="range"&&rangeMid!==undefined&&(side==="long"?anchor.price>rangeMid:anchor.price<rangeMid))return [];
    if(regime!=="range"&&(assessment==="long"||assessment==="short")&&side!==assessment)return [];
    return bars.flatMap((bar,index)=>{
      if(index<bars.length-6)return [];
      const previous=bars[index-1];
      if(!previous||knownAt>bar.ts||sign*(previous.close-anchor.price)>0||sign*(bar.close-anchor.price)<=0)return [];
      if(bars.slice(index+1).some(later=>sign*(later.close-anchor.price)<0))return [];
      return [{side,price:anchor.price,knownAt,at:bar.ts}];
    });
  }).sort((a,b)=>b.at-a.at||Math.abs(last.close-a.price)-Math.abs(last.close-b.price));
  const cross=crosses[0];
  if(cross)return pick(cross.side,"breakout_retest","reclaimed_level",cross.price,timeframe,cross.knownAt);

  if(range&&rangeMid!==undefined){
    const side=regime!=="range"&&(assessment==="long"||assessment==="short")?assessment:last.close<=rangeMid?"long":"short";
    return pick(side,"range_rotation","range_edge",side==="long"?range.lower[1]:range.upper[0],tf,primaryClosed);
  }
  const recent=report.candles.slice(-20),mid=(Math.max(...recent.map(c=>c.high))+Math.min(...recent.map(c=>c.low)))/2;
  const side=assessment==="long"||assessment==="short"?assessment:fast!==undefined&&slow!==undefined&&fast!==slow?fast>slow?"long":"short":primary.close<=mid?"long":"short";
  if(fast!==undefined&&slow!==undefined)return pick(side,"ema_pullback","ema_ribbon",side==="long"?Math.max(fast,slow):Math.min(fast,slow),tf,primaryClosed);
  return pick(side,"ema_pullback","completed_close",last.close,timeframe,completedAt);
}
