import {candleCloseTime,parseCandleTimeframe,GlobalOrderFlowSchema,type GlobalOrderFlow} from "@pulse/schemas";
import type {MarketTradeCapture,MarketTradePrint} from "@pulse/market";

type Row=GlobalOrderFlow["profile"]["rows"][number];
const round=(value:number)=>Number(value.toPrecision(14));
function bucket(price:number,step:number){const n=price/step,nearest=Math.round(n);return Math.abs(n-nearest)<=8*Number.EPSILON*Math.max(1,Math.abs(n))?nearest:Math.floor(n);}
function rowsFor(trades:readonly MarketTradePrint[],step:number){
  const rows=new Map<number,Row>();
  for(const t of trades){const key=bucket(t.price,step);let r=rows.get(key);if(!r){r={low:round(key*step),high:round((key+1)*step),buy:0,sell:0,trades:0};rows.set(key,r);}r[t.side]+=t.size;r.trades++;}
  if(rows.size>400)throw Error("Trade profile exceeds 400 price rows");
  return [...rows].sort(([a],[b])=>a-b).map(([,r])=>({...r,buy:round(r.buy),sell:round(r.sell)}));
}
function totals(rows:Row[]){const buy=round(rows.reduce((s,r)=>s+r.buy,0)),sell=round(rows.reduce((s,r)=>s+r.sell,0));return {buy,sell,volume:round(buy+sell),delta:round(buy-sell),trades:rows.reduce((s,r)=>s+r.trades,0)};}
function prices(trades:readonly MarketTradePrint[]){return {open:trades[0].price,close:trades.at(-1)!.price,high:trades.reduce((hi,t)=>Math.max(hi,t.price),-Infinity),low:trades.reduce((lo,t)=>Math.min(lo,t.price),Infinity)};}
function barStart(ts:number,timeframe:string){
  const frame=parseCandleTimeframe(timeframe);if(!frame||!["minute","hour","day","week"].includes(frame.unit)||(frame.unit==="day"||frame.unit==="week")&&frame.count!==1)throw Error("Unsupported trade-profile timeframe");
  const offset=(frame.unit==="day"||frame.unit==="week")&&!frame.utc?8*3600000:0,shifted=ts+offset;
  if(frame.unit==="week"){const d=new Date(shifted),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());return day-(d.getUTCDay()+6)%7*86400000-offset;}
  const size=frame.count*(frame.unit==="day"?86400000:frame.unit==="hour"?3600000:60000);
  return Math.floor(shifted/size)*size-offset;
}

/** Aggregate complete trade coverage, preserving actual taker buy/sell volume.
 * The value-area expansion follows the documented no-overshoot convention.
 * Session anchors and row size are explicit inputs, not inferred XO settings. */
export function buildGlobalOrderFlow(capture:MarketTradeCapture,input:{timeframe:string;start:number;end:number;asOf:number;rowSize:number;valueFraction?:number}):GlobalOrderFlow|null{
  const {start,end,asOf,rowSize,timeframe}=input,valueFraction=input.valueFraction??.7,c=capture.coverage;
  if(![start,end,asOf].every(Number.isSafeInteger)||start<0||end<=start||!Number.isFinite(rowSize)||rowSize<=0||!(valueFraction>0&&valueFraction<=1))throw Error("Invalid trade-profile window");
  if(!c.complete||start<c.start||end>c.end||c.knownAt>asOf||end>asOf)return null;
  const ids=new Set<string>();let previous=-1;
  for(const t of capture.trades){
    if(!t.id||ids.has(t.id)||!Number.isSafeInteger(t.ts)||t.ts<previous||t.ts<c.start||t.ts>=c.end||!Number.isFinite(t.price)||t.price<=0||!Number.isFinite(t.size)||t.size<=0||!["buy","sell"].includes(t.side))throw Error("Incomplete, duplicate or unordered trade capture");
    ids.add(t.id);previous=t.ts;
  }
  const trades=capture.trades.filter(t=>t.ts>=start&&t.ts<end);if(!trades.length)return null;
  const rows=rowsFor(trades,rowSize),summary=totals(rows),low=rows[0].low,high=rows.at(-1)!.high,mid=(low+high)/2;
  let poc=0;for(let i=1;i<rows.length;i++){const v=rows[i].buy+rows[i].sell,b=rows[poc].buy+rows[poc].sell;if(v>b||v===b&&Math.abs((rows[i].low+rows[i].high)/2-mid)<Math.abs((rows[poc].low+rows[poc].high)/2-mid))poc=i;}
  // Include empty price bins in value-area comparisons without inventing volume.
  const first=bucket(low,rowSize),last=bucket(high-rowSize*.5,rowSize);if(last-first>399)throw Error("Trade profile price span exceeds 400 rows");
  const weights=new Map(rows.map(r=>[bucket(r.low,rowSize),r.buy+r.sell])),center=bucket(rows[poc].low,rowSize);
  let bottom=center,top=center,covered=weights.get(center)!,target=summary.volume*valueFraction;
  while(covered<target-1e-12*Math.max(1,summary.volume)&&(bottom>first||top<last)){
    const up=top<last?weights.get(top+1)??0:-Infinity,down=bottom>first?weights.get(bottom-1)??0:-Infinity;
    const takeUp=up===down?top-center<=center-bottom:up>down,addition=takeUp?up:down;
    if(covered+addition>target+1e-12*Math.max(1,summary.volume))break;
    if(takeUp)top++;else bottom--;covered+=addition;
  }
  const grouped=new Map<number,MarketTradePrint[]>();for(const t of trades){const at=barStart(t.ts,timeframe);if(at<start||(candleCloseTime(at,timeframe)??Infinity)>end)continue;const group=grouped.get(at)??[];group.push(t);grouped.set(at,group);}
  const footprints=[...grouped].slice(-32).map(([at,group])=>{const rows=rowsFor(group,rowSize),end=candleCloseTime(at,timeframe)!;return {start:at,end,knownAt:Math.max(end,c.knownAt),...prices(group),...totals(rows),rows};});
  return GlobalOrderFlowSchema.parse({version:"trade-flow-v1",source:capture.source,instId:capture.instId,priceCurrency:capture.priceCurrency,marketType:capture.marketType,quantityUnit:capture.quantityUnit,capturedAt:capture.capturedAt,coverage:{...c,complete:true},profile:{timeframe,start,end,knownAt:Math.max(end,c.knownAt),rowSize,valueFraction,poc:round((rows[poc].low+rows[poc].high)/2),val:round(bottom*rowSize),vah:round((top+1)*rowSize),...prices(trades),...summary,rows},footprints});
}
