import {candleCloseTime,parseCandleTimeframe,type GlobalCandle,type GlobalReport} from "@pulse/schemas";
import {globalSetupStrategyProfile} from "@pulse/domain";

type PricedPlan=NonNullable<GlobalReport["discretionaryPlan"]>;
type Choice=Pick<PricedPlan,"side"|"family"|"entryBasis"|"evidence">;

/** Select a current conditional setup from location and retained structure.
 * These numerical conventions implement public methods, not private XO rules. */
export function selectGlobalSetupContext(report:GlobalReport,input:{bars:GlobalCandle[];timeframe:string;completedAt:number;primaryClosed:number;primaryAtr:number;cutoff:number}):Choice{
  const {bars,timeframe,completedAt,primaryClosed,primaryAtr,cutoff}=input;
  const last=bars.at(-1)!,primary=report.candles.at(-1)!,tf=report.snapshot.timeframe;
  const latest=[{timeframe,candles:bars},...(report.currentMarket?.frames??[])].flatMap(f=>{const c=f.candles.at(-1);return c?[{price:c.close,at:candleCloseTime(c.ts,f.timeframe)??0}]:[];}).sort((a,b)=>b.at-a.at)[0]!.price;
  const assessment=report.setupSelection?.assessment,regime=report.setupSelection?.regime;
  const macro=["week","month"].includes(parseCandleTimeframe(tf)?.unit??"");
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
    if(sign*(last.close-anchor.price)<=0||sign*(latest-anchor.price)<=0)return [];
    // An interior range rotation respects its location. A tiny local break
    // beside the opposite edge does not turn that edge into trend support.
    if(range&&regime==="range"&&rangeMid!==undefined&&(side==="long"?anchor.price>rangeMid:anchor.price<rangeMid))return [];
    // An opposing reclaim needs the newest local swing after the last opposite
    // extreme. A slow trend assessment cannot veto that actual recovery.
    if(regime!=="range"&&(assessment==="long"||assessment==="short")&&side!==assessment){
      if(macro)return [];
      const opposite=availablePivots.filter(a=>a.kind!==anchor.kind).at(-1);
      if(!opposite||anchor.ts<=opposite.ts)return [];
    }
    if(assessment==="sideways"&&!range){
      const opposite=availablePivots.filter(a=>a.kind!==anchor.kind).at(-1);
      if(!opposite||anchor.ts<=opposite.ts)return [];
    }
    return bars.flatMap((bar,index)=>{
      if(index<bars.length-6)return [];
      const previous=bars[index-1];
      if(!previous||knownAt>bar.ts||sign*(previous.close-anchor.price)>0||sign*(bar.close-anchor.price)<=0)return [];
      if(bars.slice(index+1).some(later=>sign*(later.close-anchor.price)<0))return [];
      return [{side,price:anchor.price,knownAt,at:bar.ts,extreme:side==="long"?Math.min(...bars.slice(index).map(c=>c.low)):Math.max(...bars.slice(index).map(c=>c.high))}];
    });
  }).sort((a,b)=>b.at-a.at||Math.abs(last.close-a.price)-Math.abs(last.close-b.price));
  const cross=crosses[0];
  const localChoice=cross?{...pick(cross.side,"breakout_retest","reclaimed_level",cross.price,timeframe,cross.knownAt),evidence:{kind:"local_reclaim" as const,timeframe,level:cross.price,testTs:cross.at,completedAt:candleCloseTime(cross.at,timeframe)!,extreme:cross.extreme}}:undefined;

  // A sweep/reclaim of a known primary level is a different opportunity from
  // continuing the older trend. Daily/weekly reports retain the newer hourly
  // recovery separately; it never becomes an invented completed daily candle.
  const recentSource=[{timeframe,candles:bars},...(report.currentMarket?.frames.filter(f=>f.timeframe==="1H")??[])].sort((a,b)=>(candleCloseTime(b.candles.at(-1)!.ts,b.timeframe)??0)-(candleCloseTime(a.candles.at(-1)!.ts,a.timeframe)??0))[0];
  const current=recentSource.candles.at(-1)!,horizonStart=report.candles.at(-Math.min(report.strategy?.lookbackBars??120,report.candles.length))!.ts;
  const reclaims=report.indicators.pivots.filter(a=>a.ts>=horizonStart&&a.confirmedAt!==null).flatMap(anchor=>{
    if(macro||regime==="range"||assessment==="sideways")return [];
    const knownAt=candleCloseTime(anchor.confirmedAt!,tf);if(knownAt===null||knownAt>cutoff)return [];
    const side:Choice["side"]=anchor.kind==="low"?"long":"short",sign=side==="long"?1:-1;
    if(side===assessment)return [];
    if(sign*(current.close-anchor.price)<=0||sign*(latest-anchor.price)<=0||Math.abs(current.close-anchor.price)>primaryAtr)return [];
    const recent=recentSource.candles.slice(-6);
    let tested=-1;recent.forEach((c,i)=>{if(c.ts>=knownAt&&(side==="long"?c.low<anchor.price:c.high>anchor.price))tested=i;});
    if(tested<0)return [];
    const recovery=recent.findIndex((c,i)=>i>=tested&&sign*(c.close-anchor.price)>0);
    if(recovery<0||recent.slice(recovery+1).some(c=>sign*(c.close-anchor.price)<0))return [];
    // A same-bar wick alone cannot oppose the trend: retain a later completed
    // hold, or a subsequent close through the rejection bar's directional edge.
    const recoveredAt=candleCloseTime(recent[recovery].ts,recentSource.timeframe)!;
    const later=(report.currentMarket?.frames??[]).flatMap(f=>f.candles.filter(c=>c.ts>=recoveredAt));
    if(recovery===recent.length-1&&assessment!==side&&(!later.length||later.some(c=>sign*(c.close-anchor.price)<0)))return [];
    return [{side,price:anchor.price,knownAt,test:recent[tested],completedAt:candleCloseTime(recent[recovery].ts,recentSource.timeframe)!,extreme:side==="long"?Math.min(...recent.slice(tested,recovery+1).map(c=>c.low)):Math.max(...recent.slice(tested,recovery+1).map(c=>c.high))}];
  }).sort((a,b)=>b.completedAt-a.completedAt||Math.abs(current.close-a.price)-Math.abs(current.close-b.price));
  const reclaim=reclaims[0];
  if(reclaim&&(!localChoice||reclaim.completedAt>localChoice.evidence.completedAt))return {...pick(reclaim.side,"breakout_retest","reclaimed_level",reclaim.price,tf,reclaim.knownAt),evidence:{kind:"primary_reclaim",timeframe:recentSource.timeframe,level:reclaim.price,testTs:reclaim.test.ts,completedAt:reclaim.completedAt,extreme:reclaim.extreme}};
  if(localChoice)return localChoice;

  if(range&&rangeMid!==undefined){
    const side=regime!=="range"&&(assessment==="long"||assessment==="short")?assessment:last.close<=rangeMid?"long":"short";
    return pick(side,"range_rotation","range_edge",side==="long"?range.lower[1]:range.upper[0],tf,primaryClosed);
  }
  // A mixed primary market has no trend to continue. Plan from its own
  // supported price location instead of letting EMA order manufacture a bias.
  if(assessment==="sideways"){
    const current=primary.close;
    const support=report.horizonContext?.zones.filter(z=>z.role==="support"&&z.upper<=current).sort((a,b)=>b.upper-a.upper)[0];
    const resistance=report.horizonContext?.zones.filter(z=>z.role==="resistance"&&z.lower>=current).sort((a,b)=>a.lower-b.lower)[0];
    if(support||resistance){
      // Prefer the completed primary reaction. A live quote crossing the
      // midpoint between two zones must not reverse a daily/weekly thesis.
      const held=Boolean(support&&primary.low<=support.upper&&primary.close>support.upper);
      const rejected=Boolean(resistance&&primary.high>=resistance.lower&&primary.close<resistance.lower);
      const side:Choice["side"]=held!==rejected?(held?"long":"short"):support&&(!resistance||current-support.upper<=resistance.lower-current)?"long":"short";
      const zone=side==="long"?support!:resistance!;
      return pick(side,"level_retest","structure_zone",side==="long"?zone.upper:zone.lower,tf,zone.knownAt);
    }
  }
  const recent=report.candles.slice(-20),mid=(Math.max(...recent.map(c=>c.high))+Math.min(...recent.map(c=>c.low)))/2;
  const side=assessment==="long"||assessment==="short"?assessment:fast!==undefined&&slow!==undefined&&fast!==slow?fast>slow?"long":"short":primary.close<=mid?"long":"short";
  if(fast!==undefined&&slow!==undefined)return pick(side,"ema_pullback","ema_ribbon",side==="long"?Math.max(fast,slow):Math.min(fast,slow),tf,primaryClosed);
  return pick(side,"ema_pullback","completed_close",last.close,timeframe,completedAt);
}
