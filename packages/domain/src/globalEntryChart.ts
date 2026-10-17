import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalTradePlan} from "./globalTradePlan.js";
import {globalFrameReference} from "./globalContext.js";
import {globalDecision} from "./globalDecision.js";

const esc=(x:unknown)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
/** The lower-frame signal is marked on its actual bar, never as a larger-frame close. */
export function globalEntryStudySvg(report:GlobalReport,width=660):string|null{
  const study=report.entryStudy;if(!study)return null;
  const zh=report.lang==="zh",height=225,left=18,right=width-100,top=47,bottom=174,p=globalTradePlan(report),d=globalDecision(report);
  const txt=(x:number,y:number,s:unknown,color="#a5b7cd",size=11)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}">${esc(s)}</text>`;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-entry-study="${esc(study.timeframe)}"><rect x="1" y="1" width="${width-2}" height="${height-2}" rx="8" fill="#121f30" stroke="#34465e"/><g font-family="Inter, Noto Sans SC, Arial, sans-serif">`;
  svg+=txt(15,22,`${zh?"入场研究":"ENTRY STUDY"} · ${globalFrameReference(study.timeframe)} · ${zh?"主图":"analysis"} ${globalFrameReference(report.snapshot.timeframe)}`,"#d2e3f3",12);
  if(study.status!=="available"||study.candles.length<2)return svg+txt(18,90,zh?"此周期的完整入场证据不可用。":"Completed evidence for this entry timeframe is unavailable.")+"</g></svg>";
  const bars=study.candles.slice(-32),atr=study.atr.at(-1)?.value??0,last=bars.at(-1)!;
  const rawLow=Math.min(...bars.map(c=>c.low)),rawHigh=Math.max(...bars.map(c=>c.high));
  const refs=d.planningValid?[...(p.referenceEntry??[]),...(p.referenceStop?[p.referenceStop]:[])].filter(n=>n>=rawLow-atr&&n<=rawHigh+atr):[];
  const low=Math.min(rawLow,...refs),high=Math.max(rawHigh,...refs),pad=Math.max(high-low,high*.001)*.12,min=low-pad,max=high+pad;
  const y=(price:number)=>top+(max-price)/(max-min)*(bottom-top),x=(i:number)=>left+(i+.5)/bars.length*(right-left);
  const price=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  for(let i=0;i<3;i++){const n=min+(max-min)*i/2,py=y(n);svg+=`<line x1="${left}" y1="${py}" x2="${right}" y2="${py}" stroke="#2c4055" stroke-dasharray="2 4"/>`+txt(right+8,py+4,price(n));}
  bars.forEach((c,i)=>{const color=c.close>=c.open?"#35d0aa":"#ef6b85",cx=x(i),w=Math.min(9,(right-left)/bars.length*.65);svg+=`<line x1="${cx}" y1="${y(c.high)}" x2="${cx}" y2="${y(c.low)}" stroke="${color}"/><rect x="${cx-w/2}" y="${Math.min(y(c.open),y(c.close))}" width="${w}" height="${Math.max(1,Math.abs(y(c.open)-y(c.close)))}" fill="${color}"/>`;
    if(d.signalObserved&&c.ts===p.retestTs)svg+=`<g data-entry-signal="${p.evidenceKind??"held_retest"}"><circle cx="${cx}" cy="${y(c.close)}" r="5" fill="none" stroke="#ffcb76" stroke-width="2"/>`+txt(Math.min(right-85,Math.max(left,cx-40)),top-6,zh?"信号收盘":"Signal close","#ffcb76",10)+"</g>";
  });
  for(const value of [p.referenceEntry?.[0],p.referenceStop])if(d.planningValid&&value&&value>=min&&value<=max)svg+=`<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#829ab4" stroke-dasharray="4 5" opacity=".55"/>`;
  const closed=candleCloseTime(last.ts,study.timeframe),date=(ts:number)=>new Date(ts).toISOString().slice(5,16).replace("T"," ");
  svg+=txt(left,193,`${date(bars[0].ts)} → ${closed?date(closed):"—"} UTC · ${zh?"最后收盘":"last close"} ${price(last.close)}`,"#a5b7cd",10);
  const note=d.qualified?zh?"信号已确认；执行前复核报价与费用，尚非成交。":"Signal confirmed; recheck quote and costs before execution. No fill implied.":zh?"计划入场条件尚未全部完成；虚线仅为计划。":"Entry conditions are incomplete; dashed levels describe the plan.";
  return svg+txt(left,213,note,"#c4d4e5",10)+"</g></svg>";
}
