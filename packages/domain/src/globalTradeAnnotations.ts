import type {GlobalReport} from "@pulse/schemas";
import type {GlobalChartCoordinates,GlobalChartOptions} from "./globalChart.js";
import {globalTradeCards} from "./globalTradeDisplay.js";

const escape=(s:unknown)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
/** One position drawing and one conditional route through saved entry/target
 * prices. Future horizontal spacing is illustrative, never a target date. */
export function globalTradeAnnotations(report:GlobalReport,g:GlobalChartCoordinates,options:GlobalChartOptions){
  const cards=globalTradeCards(report),card=cards.find(c=>c.key===options.selectedPathId||c.pathId===options.selectedPathId)??cards.find(c=>c.selected)??cards[0];
  const zh=report.lang==="zh",future=g.right-g.historyEnd,price=(n:number)=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision});
  const txt=(x:number,y:number,s:unknown,color="#c9d8e9",size=10,anchor="start")=>`<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-size="${size}">${escape(s)}</text>`;
  const p=card?.plan;
  if(!card||!p?.referenceEntry||p.referenceStop===null){
    const range=report.range,trigger=report.levels.find(l=>l.id===card?.plan.triggerLevelId),lines=[zh?"暂无有效入场":"NO VALIDATED ENTRY",zh?"Entry / SL：等待实际反应":"Entry / SL: await observed reaction",...(range?[`${zh?"支撑参考":"Support"}: ${range.lower.map(price).join('–')}`,`${zh?"阻力参考":"Resistance"}: ${range.upper.map(price).join('–')}`]:trigger?[`${zh?"观察位":"Watch level"}: ${price(trigger.price)}`]:[]),zh?"须新的反应与后续确认":"Fresh reaction + later confirmation",zh?"参考价位不预测下一步走势":"References do not predict the next move"];
    return `<g data-setup-status="unavailable">${lines.map((l,i)=>txt(g.historyEnd+12,g.top+36+i*21,l,i===0?"#ffcb76":"#a5b7cd",i===0?11:9)).join('')}</g>`;
  }
  const entry=card.side==="long"?p.referenceEntry[1]:p.referenceEntry[0];
  const rows=[{role:"Entry",price:entry,color:"#ffcb76"},{role:"SL",price:p.referenceStop,color:"#f0738c"},...card.targets.map((t,i)=>({role:`TP${i+1}`,price:t.price,color:"#53dabb"}))];
  let svg=`<g data-trade-plan="${escape(card.key)}" data-confirmed="${card.confirmed}" data-price-labels="exact">`;
  // Start at the conditional entry. Connecting today's close to a remote entry
  // invents an unsupported pullback/rebound forecast, even with a dashed line.
  const projectionColor=card.side==="long"?"#53dabb":"#f0738c";
  const projection=[{x:g.historyEnd+future*.18,y:g.y(entry)},...card.targets.map((t,i)=>({x:g.historyEnd+future*(.43+i*.19),y:g.y(t.price)}))].filter((p):p is {x:number;y:number}=>p.y!==null&&p.y>=g.top&&p.y<=g.bottom);
  if(card.confirmed&&options.showScenarios!==false&&projection.length>=2){
    const end=projection.at(-1)!,prior=projection.at(-2)!,angle=Math.atan2(end.y-prior.y,end.x-prior.x);
    const arrow=[end,{x:end.x-10*Math.cos(angle)+4*Math.sin(angle),y:end.y-10*Math.sin(angle)-4*Math.cos(angle)},{x:end.x-10*Math.cos(angle)-4*Math.sin(angle),y:end.y-10*Math.sin(angle)+4*Math.cos(angle)}];
    svg+=`<g data-scenario-projection="conditional" data-projection-origin="entry" data-projection-side="${card.side}" data-projection-path="${escape(card.pathId)}"><path d="${projection.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')}" fill="none" stroke="${projectionColor}" stroke-width="2.3" stroke-dasharray="7 5"/><polygon points="${arrow.map(p=>`${p.x},${p.y}`).join(' ')}" fill="${projectionColor}"/>${txt(g.historyEnd+12,g.top+24,zh?"仅入场后 · 时间为示意":"ONLY AFTER ENTRY · TIMING SCHEMATIC",projectionColor,8)}</g>`;
  }
  const entryY=g.y(entry),stopY=g.y(p.referenceStop),targetY=g.y(card.targets[0]?.price??entry);
  if(entryY!==null&&stopY!==null&&targetY!==null){
    for(const [a,b,color,kind] of [[entryY,stopY,"#f0738c","risk"],[entryY,targetY,"#53dabb","reward"]] as const){
      const top=Math.max(g.top,Math.min(a,b)),bottom=Math.min(g.bottom,Math.max(a,b));
      if(bottom>top)svg+=`<rect data-trade-box="${kind}" x="${g.historyEnd+4}" y="${top}" width="${future*.48}" height="${bottom-top}" fill="${color}" fill-opacity=".10"/>`;
    }
  }
  const labeled:number[]=[];
  rows.forEach((row,i)=>{
    const y=g.y(row.price);if(y===null||y<g.top||y>g.bottom)return;
    svg+=`<g data-trade-role="${row.role}" data-price="${row.price}"><line x1="${g.historyEnd+4}" x2="${g.right+7}" y1="${y}" y2="${y}" stroke="${row.color}" stroke-width="${row.role==="SL"?1.5:1.1}"${card.confirmed?"":' stroke-dasharray="5 4"'}/>`;
    // Stagger role tags horizontally, never move a numeric price vertically.
    svg+=txt(g.historyEnd+8+(i%4)*future*.21,y-5,row.role,row.color,10);
    if(labeled.every(prior=>Math.abs(prior-y)>=17)){
      labeled.push(y);svg+=`<rect x="${g.right+8}" y="${y-10}" width="132" height="18" rx="3" fill="${row.color}" fill-opacity=".12"/>`+txt(g.right+132,y+3,price(row.price),row.color,11,"end");
    }
    svg+="</g>";
  });
  const ledgerHeight=44+rows.length*18,mean=rows.reduce((s,r)=>s+(g.y(r.price)??g.bottom),0)/rows.length;
  const ledgerY=mean>(g.top+g.bottom)/2?g.top+42:g.bottom-ledgerHeight-14,lx=g.historyEnd+14,lw=Math.max(100,future-30);
  svg+=`<g data-trade-price-ledger="${escape(card.key)}"><rect x="${lx}" y="${ledgerY}" width="${lw}" height="${ledgerHeight}" rx="5" fill="#0f1c2b" fill-opacity=".96" stroke="#3b4c60"/>`;
  svg+=txt(lx+10,ledgerY+17,`${card.side==="long"?"LONG / BUY":"SHORT / SELL"}${report.discretionaryPlan?"":` · ${card.confirmed?zh?"已确认":"signal confirmed":zh?"计划":"planned"}`}`,card.side==="long"?"#53dabb":"#f0738c",11);
  rows.forEach((row,i)=>{svg+=txt(lx+10,ledgerY+37+i*18,row.role,row.color,10)+txt(lx+lw-9,ledgerY+37+i*18,row.role==="Entry"?card.entry:price(row.price),row.color,10,"end");});
  svg+="</g>";
  const alternative=cards.find(c=>c.key!==card.key&&c.side!==card.side);
  if(alternative)svg+=txt(g.historyEnd+14,g.bottom-4,zh?"反向计划的 Entry / SL / TP 见下表。":"Other side: Entry / SL / TP in the plan below.","#9eafc5",8);
  return svg+"</g>";
}
