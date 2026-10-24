import {z} from "zod";
const positive=z.number().finite().positive(),nonnegative=z.number().finite().nonnegative(),time=z.number().int().nonnegative();
const row=z.object({low:nonnegative,high:positive,buy:nonnegative,sell:nonnegative,trades:z.number().int().positive()});
const totals={buy:nonnegative,sell:nonnegative,volume:positive,delta:z.number().finite(),trades:z.number().int().positive()};
const prices={open:positive,high:positive,low:positive,close:positive};
export const GlobalOrderFlowSchema=z.object({
  version:z.literal("trade-flow-v1"),source:z.string(),instId:z.string(),priceCurrency:z.string(),marketType:z.enum(["spot","perpetual"]),quantityUnit:z.enum(["base","contracts"]),capturedAt:z.string().datetime(),
  coverage:z.object({start:time,end:time,knownAt:time,complete:z.literal(true),sha256:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1)}),
  profile:z.object({timeframe:z.string(),start:time,end:time,knownAt:time,rowSize:positive,valueFraction:z.number().positive().max(1),poc:positive,val:nonnegative,vah:positive,...prices,...totals,rows:z.array(row).min(1).max(400)}),
  footprints:z.array(z.object({start:time,end:time,knownAt:time,...prices,...totals,rows:z.array(row).min(1).max(400)})).max(32),
}).superRefine((flow,ctx)=>{
  const check=(item:{open:number;high:number;low:number;close:number;buy:number;sell:number;volume:number;delta:number;trades:number;rows:Array<z.infer<typeof row>>})=>{
    const buy=item.rows.reduce((s,r)=>s+r.buy,0),sell=item.rows.reduce((s,r)=>s+r.sell,0),near=(a:number,b:number)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
    return item.high>=Math.max(item.open,item.close)&&item.low<=Math.min(item.open,item.close)&&item.rows[0].low<=item.low&&item.rows.at(-1)!.high>=item.high&&near(item.buy,buy)&&near(item.sell,sell)&&near(item.volume,buy+sell)&&near(item.delta,buy-sell)&&item.trades===item.rows.reduce((s,r)=>s+r.trades,0)&&item.rows.every((r,i)=>r.high>r.low&&r.buy+r.sell>0&&(i===0||r.low>=item.rows[i-1].high));
  };
  const p=flow.profile,c=flow.coverage;
  const near=(a:number,b:number)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
  const poc=p.rows.find(r=>near((r.low+r.high)/2,p.poc));
  if(c.start>=c.end||c.knownAt<c.end||c.knownAt>Date.parse(flow.capturedAt)||p.start<c.start||p.end>c.end||p.start>=p.end||p.knownAt<Math.max(p.end,c.knownAt)||p.val>p.poc||p.vah<p.poc||!poc||p.rows.some(r=>!near(r.high-r.low,p.rowSize)||r.buy+r.sell>poc.buy+poc.sell+1e-9*Math.max(1,p.volume))||!check(p))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Trade profile requires complete chronological coverage and reconciled price rows"});
  if(flow.footprints.some((f,i)=>f.start<p.start||f.end>p.end||f.start>=f.end||f.knownAt<Math.max(f.end,c.knownAt)||i>0&&f.start<flow.footprints[i-1].end||!check(f)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Footprints require completed ordered bars and reconciled executed volume"});
});
export type GlobalOrderFlow=z.infer<typeof GlobalOrderFlowSchema>;
