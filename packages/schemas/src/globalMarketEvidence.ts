import {z} from "zod";
import {candleCloseTime} from "./candleTimeframe.js";

const time=z.number().int().nonnegative(),positive=z.number().finite().positive(),nonnegative=z.number().finite().nonnegative();
const market=z.object({venue:z.string().min(1),instrument:z.string().min(1),baseAsset:z.string().min(1),quoteCurrency:z.string().min(1),marketType:z.enum(["spot","perpetual"])}).strict();
const profile=z.object({kind:z.literal("executed_profile"),rowSize:positive,valueFraction:positive.max(1),val:positive,poc:positive,vah:positive,quantityUnit:z.enum(["base","quote","contracts"]),session:z.object({timezone:z.string().min(1),anchor:z.string().min(1),completed:z.literal(true)}).strict()}).strict();
const flow=z.object({kind:z.literal("traded_flow"),quantityUnit:z.enum(["base","quote","contracts"]),buy:nonnegative,sell:nonnegative,delta:z.number().finite(),resetAt:time}).strict();
const oi=z.object({kind:z.literal("open_interest"),quantityUnit:z.enum(["base","quote","contracts"]),startValue:nonnegative,endValue:nonnegative}).strict();
const funding=z.object({kind:z.literal("funding"),rate:z.number().finite().nullable(),intervalMs:positive,markPrice:positive.nullable()}).strict();
const resting=z.object({kind:z.literal("resting_liquidity"),quantityUnit:z.enum(["base","quote","contracts"]),bid:nonnegative,ask:nonnegative,snapshots:z.number().int().positive()}).strict();
const liquidations=z.object({kind:z.literal("liquidations"),quantityUnit:z.enum(["base","quote","contracts"]),longLiquidated:nonnegative,shortLiquidated:nonnegative}).strict();

/** Optional real-feed observations. Missing coverage stays missing; this is not
 * a way to infer executions, book orders or liquidations from candle volume. */
export const GlobalMarketEvidenceSchema=z.object({
  version:z.literal("market-evidence-v1"),id:z.string().min(1),provider:z.string().min(1),market,
  aggregation:z.enum(["single_venue","multi_venue"]),members:z.array(market).min(1),
  provenance:z.enum(["executed_trades","exchange_statistics","order_book_snapshots","position_derived","modelled"]),
  coverage:z.object({start:time,end:time,knownAt:time,capturedAt:time,complete:z.boolean(),gaps:z.array(z.object({start:time,end:time}).strict())}).strict(),
  data:z.discriminatedUnion("kind",[profile,flow,oi,funding,resting,liquidations]),
}).strict().superRefine((e,ctx)=>{
  const c=e.coverage,bad=(message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,message});
  if(c.start>=c.end||c.knownAt<c.end||c.capturedAt<c.knownAt||c.gaps.some(g=>g.start>=g.end||g.start<c.start||g.end>c.end)||c.complete&&c.gaps.length)bad("Evidence requires chronological known-at coverage and explicit gaps");
  const keys=e.members.map(m=>`${m.venue}:${m.instrument}:${m.marketType}`);
  if(new Set(keys).size!==keys.length||e.aggregation==="single_venue"&&(e.members.length!==1||JSON.stringify(e.members[0])!==JSON.stringify(e.market)))bad("Evidence must preserve its actual venue and instrument membership");
  if(!e.members.some(m=>m.venue===e.market.venue&&m.instrument===e.market.instrument&&m.marketType===e.market.marketType))bad("The evidence reference market must be an actual member of its venue scope");
  if(e.members.some(m=>m.baseAsset!==e.market.baseAsset||m.quoteCurrency!==e.market.quoteCurrency||m.marketType!==e.market.marketType))bad("Spot/perpetual and quote-currency observations require separate evidence; implicit normalization is not allowed");
  if(e.market.marketType==="spot"&&"quantityUnit" in e.data&&e.data.quantityUnit==="contracts")bad("Spot quantity must use base or quote units, not perpetual contract counts");
  if(e.aggregation==="multi_venue"&&"quantityUnit" in e.data&&e.data.quantityUnit==="contracts")bad("Different venue contracts cannot be aggregated without explicit conversion to a shared base or quote unit");
  if((e.data.kind==="executed_profile"||e.data.kind==="traded_flow")&&e.provenance!=="executed_trades")bad("Profiles and traded delta require actual executed trades");
  if(e.data.kind==="resting_liquidity"&&e.provenance!=="order_book_snapshots")bad("Resting liquidity requires actual book snapshots");
  if(e.data.kind==="executed_profile"&&(e.data.val>e.data.poc||e.data.poc>e.data.vah))bad("Completed profile must have VAL <= POC <= VAH");
  if(e.data.kind==="traded_flow"&&(e.data.resetAt>c.start||Math.abs(e.data.delta-(e.data.buy-e.data.sell))>1e-8*Math.max(1,e.data.buy+e.data.sell)))bad("Traded delta must reconcile to buy minus sell in a retained reset window");
  if(e.data.kind==="funding"&&e.market.marketType!=="perpetual")bad("Funding belongs to an identified perpetual contract");
  if(e.provider.toLowerCase()==="mmt"&&e.aggregation==="multi_venue"&&e.data.kind==="funding"&&(e.data.rate!==null||e.data.markPrice!==null))bad("MMT aggregate funding and mark-price zero sentinels mean unavailable, not neutral values");
  if(e.data.kind==="liquidations"&&e.market.marketType!=="perpetual")bad("Liquidation evidence requires a perpetual contract");
  if(e.data.kind==="liquidations"&&!["executed_trades","exchange_statistics"].includes(e.provenance))bad("Liquidated volume requires executed events; modeled or position-derived levels are not liquidations");
});
export type GlobalMarketEvidence=z.infer<typeof GlobalMarketEvidenceSchema>;

const family=z.enum(["range_rotation","ema_pullback","vwap_reversion","breakout_retest","level_retest"]),side=z.enum(["long","short"]);
export const GlobalStrategyMixCandidateSchema=z.object({
  id:z.enum(["value_area_rotation","accepted_breakout_retest","sweep_reclaim"]),family,side,
  status:z.enum(["eligible","awaiting_event","unavailable","conflicted"]),reason:z.string(),missingInputs:z.array(z.string()),conflicts:z.array(z.string()),evidenceIds:z.array(z.string()),
  source:z.object({kind:z.enum(["value_area","broken_boundary","swept_level"]),price:positive,lower:positive,upper:positive,timeframe:z.string(),knownAt:time}).optional(),
  event:z.object({kind:z.enum(["value_rejection","accepted_retest","sweep_reclaim"]),timeframe:z.string(),testTs:time,completedAt:time,extreme:positive}).optional(),
}).strict().superRefine((c,ctx)=>{
  if(c.source&&(c.source.lower>c.source.price||c.source.price>c.source.upper)||c.status==="eligible"&&(!c.source||!c.event||c.missingInputs.length||c.conflicts.length)||c.event&&((candleCloseTime(c.event.testTs,c.event.timeframe)??Infinity)>c.event.completedAt||c.source&&c.source.knownAt>c.event.testTs))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Eligible strategies require a causal known source and observed event without missing or contradictory admission inputs"});
});
export type GlobalStrategyMixCandidate=z.infer<typeof GlobalStrategyMixCandidateSchema>;
export const GlobalStrategyMixSchema=z.object({
  version:z.literal("global-strategy-mix-v1"),
  primary:z.object({family:family.nullable(),side:z.enum(["long","short","none"]),variant:z.literal("core"),reason:z.string()}),
  candidates:z.array(GlobalStrategyMixCandidateSchema).max(3),selectedVariant:z.enum(["value_area_rotation","accepted_breakout_retest","sweep_reclaim"]).optional(),
  evidenceGroups:z.array(z.enum(["price_structure","executed_flow","derivatives_positioning","resting_liquidity"])),
  exposurePolicy:z.literal("one_primary_exposure"),
}).strict().superRefine((mix,ctx)=>{
  if(new Set(mix.candidates.map(c=>c.id)).size!==mix.candidates.length||new Set(mix.evidenceGroups).size!==mix.evidenceGroups.length||mix.selectedVariant&&!mix.candidates.some(c=>c.id===mix.selectedVariant&&c.status==="eligible"))ctx.addIssue({code:z.ZodIssueCode.custom,message:"The selected mix variant must be one uniquely identified eligible candidate"});
});
export type GlobalStrategyMix=z.infer<typeof GlobalStrategyMixSchema>;
