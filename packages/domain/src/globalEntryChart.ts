import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import {globalTradePlan} from "./globalTradePlan.js";
import {globalFrameReference} from "./globalContext.js";
import {globalDecision} from "./globalDecision.js";
import {globalTradeCards} from "./globalTradeDisplay.js";

const esc=(x:unknown)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
/** The lower-frame signal is marked on its actual bar, never as a larger-frame close. */
export function globalEntryStudySvg(report:GlobalReport,width=660,selectedPathId?:string|null):string|null{
  const study=report.entryStudy;if(!study)return null;
  const cards=report.decisionVersion==="decision-v5"?globalTradeCards(report):[],card=cards.find(c=>c.key===selectedPathId||c.pathId===selectedPathId)??cards.find(c=>c.selected)??cards[0];
  const zh=report.lang==="zh",height=225,left=18,right=width-100,top=47,bottom=174,p=card?.plan??globalTradePlan(report),d=globalDecision(report),signal=card?card.confirmed:d.signalObserved;
  const txt=(x:number,y:number,s:unknown,color="#a5b7cd",size=11)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}">${esc(s)}</text>`;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-entry-study="${esc(study.timeframe)}"><rect x="1" y="1" width="${width-2}" height="${height-2}" rx="8" fill="#121f30" stroke="#34465e"/><g font-family="Inter, Noto Sans SC, Arial, sans-serif">`;
  svg+=txt(15,22,`${zh?"入场研究":"ENTRY STUDY"} · ${globalFrameReference(study.timeframe)} · ${zh?"主图":"analysis"} ${globalFrameReference(report.snapshot.timeframe)}`,"#d2e3f3",12);
  if(study.status!=="available"||study.candles.length<2)return svg+txt(18,90,zh?"此周期的完整入场证据不可用。":"Completed evidence for this entry timeframe is unavailable.")+"</g></svg>";
  const bars=study.candles.slice(-32),atr=study.atr.at(-1)?.value??0,last=bars.at(-1)!;
  const rawLow=Math.min(...bars.map(c=>c.low)),rawHigh=Math.max(...bars.map(c=>c.high));
  const tradeView=report.decisionVersion==="decision-v5",showPlan=tradeView||d.planningValid;
  // Execution detail retains its own source-candle scale. Distant primary
  // protection/objectives stay on the main chart and its full price ledger.
  const refs=showPlan?[...(p.referenceEntry??[]),...(p.referenceStop?[p.referenceStop]:[]),...(tradeView?card?card.targets.slice(0,1).map(t=>t.price):p.targetIds.slice(0,1).flatMap(id=>report.levels.find(l=>l.id===id)?.price??[]):[])].filter(n=>n>=rawLow-atr&&n<=rawHigh+atr):[];
  const low=Math.min(rawLow,...refs),high=Math.max(rawHigh,...refs),pad=Math.max(high-low,high*.001)*.12,min=low-pad,max=high+pad;
  const y=(price:number)=>top+(max-price)/(max-min)*(bottom-top),x=(i:number)=>left+(i+.5)/bars.length*(right-left);
  const price=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:report.snapshot.pricePrecision});
  for(let i=0;i<3;i++){const n=min+(max-min)*i/2,py=y(n);svg+=`<line x1="${left}" y1="${py}" x2="${right}" y2="${py}" stroke="#2c4055" stroke-dasharray="2 4"/>`+txt(right+8,py+4,price(n));}
  bars.forEach((c,i)=>{const color=c.close>=c.open?"#35d0aa":"#ef6b85",cx=x(i),w=Math.min(9,(right-left)/bars.length*.65);svg+=`<line x1="${cx}" y1="${y(c.high)}" x2="${cx}" y2="${y(c.low)}" stroke="${color}"/><rect x="${cx-w/2}" y="${Math.min(y(c.open),y(c.close))}" width="${w}" height="${Math.max(1,Math.abs(y(c.open)-y(c.close)))}" fill="${color}"/>`;
    if(signal&&c.ts===p.retestTs)svg+=`<g data-entry-signal="${p.evidenceKind??"held_retest"}"><circle cx="${cx}" cy="${y(c.close)}" r="5" fill="none" stroke="#ffcb76" stroke-width="2"/>`+txt(Math.min(right-85,Math.max(left,cx-40)),top-6,zh?"信号收盘":"Signal close","#ffcb76",10)+"</g>";
  });
  const priceRows=tradeView?[{role:"Entry",value:p.referenceEntry?.[p.side==="long"?1:0],color:"#ffcb76"},{role:"SL",value:p.referenceStop,color:"#f0738c"},{role:"TP1",value:card?.targets[0]?.price??report.levels.find(l=>l.id===p.targetIds[0])?.price,color:"#53dabb"}]:[{role:"",value:p.referenceEntry?.[0],color:"#829ab4"},{role:"",value:p.referenceStop,color:"#829ab4"}];
  const outside=showPlan?priceRows.filter(row=>row.value!==undefined&&row.value!==null&&(row.value<min||row.value>max)):[];
  svg+=`<metadata data-entry-local-scale="true" data-entry-offscale-levels="${esc(outside.map(row=>row.role).join(","))}"/>`;
  for(const [i,row] of priceRows.entries())if(showPlan&&row.value&&row.value>=min&&row.value<=max){svg+=`<g data-entry-price-role="${row.role}" data-price="${row.value}"><line x1="${left}" y1="${y(row.value)}" x2="${right}" y2="${y(row.value)}" stroke="${row.color}" stroke-dasharray="4 5" opacity=".8"/>`+(tradeView?txt(left+5+i*90,y(row.value)-4,`${row.role} ${price(row.value)}`,row.color,9):"")+"</g>";}

  const closed=candleCloseTime(last.ts,study.timeframe),date=(ts:number)=>new Date(ts).toISOString().slice(5,16).replace("T"," ");
  svg+=txt(left,193,`${date(bars[0].ts)} → ${closed?date(closed):"—"} UTC · ${zh?"最后收盘":"last close"} ${price(last.close)}`,"#a5b7cd",10);
  const note=report.discretionaryPlan?(zh?"入场、止损与目标见图中水平。交易前检查当前报价。":"Entry, SL and targets are shown. Review the current quote before execution."):(card?signal:d.qualified)?zh?"信号已确认；执行前复核报价与费用，尚非成交。":"Signal confirmed; recheck quote and costs before execution. No fill implied.":!cards.length&&tradeView?zh?"暂无有效入场；须实际反应与有依据的保护。":"No validated entry; an observed reaction and supported protection are required.":card?`${card.state}. ${zh?"虚线是条件价位，价格可能不再回到该位。":"Dashed levels are conditional; price may never revisit them."}`:zh?"计划入场条件尚未全部完成；虚线仅为计划。":"Entry conditions are incomplete; dashed levels describe the plan.";
  const scaleNote=outside.length?(zh?"入场细节使用本周期价格尺度；完整入场、止损和目标保留在主图。":"Entry detail uses its own scale. Full Entry, SL and targets remain on the main chart."):note;
  return svg+txt(left,213,scaleNote,"#c4d4e5",10)+"</g></svg>";
}
