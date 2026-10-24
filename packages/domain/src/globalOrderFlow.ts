import {candleCloseTime,type GlobalReport} from "@pulse/schemas";
import type {GlobalChartCoordinates} from "./globalChart.js";

const esc=(x:unknown)=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
const when=(ts:number)=>new Date(ts).toISOString().slice(0,16).replace("T"," ");
const amount=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:4});
export function globalOrderFlowLines(report:GlobalReport){
  const f=report.orderFlow;if(!f)return [];
  const p=f.profile,zh=report.lang==="zh",price=(v:number)=>v.toLocaleString(zh?"zh-CN":"en-US",{maximumFractionDigits:report.snapshot.pricePrecision}),unit=f.quantityUnit==="base"?report.snapshot.instId.split("-")[0]:zh?"合约":"contracts";
  return [`${report.snapshot.venue} · ${zh?"实际成交量分布":"Executed-volume profile"} · ${when(p.start)} → ${when(p.end)} UTC`,
    `POC ${price(p.poc)} · VAL ${price(p.val)} · VAH ${price(p.vah)} · ${zh?"价格档宽":"Row size"} ${price(p.rowSize)}`,
    `${zh?"成交量":"Volume"} ${amount(p.volume)} ${unit} · ${zh?"主动买入":"Taker buy"} ${amount(p.buy)} · ${zh?"主动卖出":"Taker sell"} ${amount(p.sell)} · Δ ${amount(p.delta)}`];
}

/** Genuine executed-volume rows; never infer resting liquidity from this map. */
export function globalOrderFlowAnnotations(report:GlobalReport,g:GlobalChartCoordinates){
  const f=report.orderFlow;if(!f||report.tier!=="pro")return "";
  const p=f.profile,width=Math.min(116,(g.historyEnd-g.left)*.19),edge=g.historyEnd-4,max=Math.max(...p.rows.map(r=>r.buy+r.sell));
  if(width<12||max<=0)return "";
  // A short profile window must not become a level across the entire macro
  // history. Map its source start to the containing primary candle. A window
  // newer than all completed primary bars remains compact recent context.
  const startBar=report.candles.find(c=>c.ts<=p.start&&(candleCloseTime(c.ts,report.snapshot.timeframe)??c.ts)>p.start)??report.candles.find(c=>c.ts>=p.start);
  const sourceX=startBar?g.x(startBar.ts):null,lastX=report.candles.length?g.x(report.candles.at(-1)!.ts):null;
  if(sourceX!==null&&sourceX>g.historyEnd+1||!startBar&&lastX!==null&&lastX>g.historyEnd+1)return "";
  const from=Math.max(g.left,Math.min(g.historyEnd,sourceX??edge-width)),labelLeft=Math.max(g.left,Math.min(from,edge-width));
  let svg=`<g data-order-flow-profile="executed_trades" data-profile-start="${p.start}" data-profile-end="${p.end}" data-profile-known-at="${p.knownAt}" data-profile-location="${startBar?"source_window":"recent_context"}">`;
  for(const r of p.rows){const top=g.y(r.high),bottom=g.y(r.low);if(top===null||bottom===null)continue;const y=Math.max(g.top,top),end=Math.min(g.bottom,bottom);if(end<=y)continue;
    const sell=width*r.sell/max,buy=width*r.buy/max;
    svg+=`<g data-profile-row="${r.low}" data-buy="${r.buy}" data-sell="${r.sell}"><rect x="${edge-sell-buy}" y="${y}" width="${sell}" height="${end-y}" fill="#ed819a" fill-opacity=".3"/><rect x="${edge-buy}" y="${y}" width="${buy}" height="${end-y}" fill="#53dabb" fill-opacity=".3"/></g>`;
  }
  const labels=([["POC",p.poc,"#f0c77a"],["VAL",p.val,"#66b8cb"],["VAH",p.vah,"#66b8cb"]] as const).flatMap(([name,value,color])=>{const y=g.y(value);return y!==null&&y>=g.top&&y<=g.bottom?[{name,value,color,y,labelY:y-4}]:[];}).sort((a,b)=>a.y-b.y);
  labels.forEach((l,i)=>l.labelY=Math.max(g.top+11,l.labelY,i?labels[i-1].labelY+12:g.top+11));
  const overflow=Math.max(0,(labels.at(-1)?.labelY??0)-(g.bottom-3));
  for(const {name,value,color,y,labelY:at} of labels){const labelY=at-overflow;
    svg+=`<g data-profile-level="${name}" data-price="${value}"><line x1="${from}" x2="${g.historyEnd}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="${name==="POC"?1.2:.8}" stroke-dasharray="${name==="POC"?"7 4":"2 5"}"/><path d="M ${from+2} ${y} L ${labelLeft+20} ${labelY-3}" stroke="${color}" stroke-width=".6" fill="none"/><text x="${labelLeft+23}" y="${labelY}" fill="${color}" font-size="9">${name} ${value}</text></g>`;
  }
  return svg+"</g>";
}

/** Compact price-by-bar footprint. Adjacent source rows are summed only for
 * display; raw rows remain saved, and displayed totals conserve every trade. */
export function globalOrderFlowStudy(report:GlobalReport,width=1250):{svg:string;height:number}|null{
  const f=report.orderFlow;if(!f||!f.footprints.length||report.tier!=="pro")return null;
  const bars=f.footprints.slice(-4),rows=[...f.profile.rows,...bars.flatMap(b=>b.rows)],base=Math.min(...rows.map(r=>r.low)),high=Math.max(...rows.map(r=>r.high)),sourceStep=f.profile.rowSize;
  const multiple=Math.max(1,Math.ceil((high-base)/sourceStep/20-1e-9)),step=sourceStep*multiple,count=Math.ceil((high-base)/step-1e-9),rowHeight=17,top=85,height=top+count*rowHeight+54;
  const grouped=(source:typeof rows)=>{const bins=Array.from({length:count},()=>({buy:0,sell:0}));for(const r of source){const i=Math.min(count-1,Math.max(0,Math.floor((r.low-base)/step+1e-8)));bins[i].buy+=r.buy;bins[i].sell+=r.sell;}return bins;};
  const zh=report.lang==="zh",cols=bars.map(b=>grouped(b.rows)),profile=grouped(f.profile.rows),profileWidth=Math.min(250,width*.25),profileMax=Math.max(...profile.map(r=>r.buy+r.sell)),left=130+profileWidth,colWidth=(width-left-18)/bars.length;
  const text=(x:number,y:number,value:unknown,color="#a5b7cd",size=11,anchor="start")=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}">${esc(value)}</text>`;
  const price=(n:number)=>n.toLocaleString("en-US",{maximumFractionDigits:report.snapshot.pricePrecision}),compact=(n:number)=>n.toLocaleString("en-US",{notation:"compact",maximumFractionDigits:1});
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-executed-footprint="${esc(f.profile.timeframe)}"><rect x="1" y="1" width="${width-2}" height="${height-2}" rx="8" fill="#121f30" stroke="#34465e"/><g font-family="Inter, Noto Sans SC, Arial, sans-serif">`;
  svg+=text(15,22,`${zh?"成交足迹":"EXECUTED FOOTPRINT"} · ${f.profile.timeframe.replace(/utc$/," (UTC)")} · ${zh?"价格 × 主动卖出 / 买入":"Price × taker sell / buy"}`,"#d2e3f3",12);
  svg+=text(15,42,`${report.snapshot.venue} · ${zh?"显示价格档宽":"Display row size"} ${price(step)} ${report.snapshot.priceCurrency} · ${when(f.profile.start)} → ${when(f.profile.end)} UTC`);
  svg+=text(130+profileWidth*.5,63,zh?"区间成交量分布":"Window profile","#b9c6d8",10,"middle");
  svg+=text(130+profileWidth*.5,78,"POC / VAL / VAH","#8298b5",10,"middle");
  bars.forEach((b,i)=>{const x=left+colWidth*(i+.5);svg+=text(x,63,when(b.start).slice(5),"#b9c6d8",10,"middle");svg+=text(x,78,zh?"主动卖出 | 主动买入":"Sell | Buy","#8298b5",10,"middle");});
  for(let row=count-1;row>=0;row--){const y=top+(count-1-row)*rowHeight,low=base+row*step;
    svg+=text(15,y+12,`${price(low)}–${price(low+step)}`,"#a5b7cd",10);
    const p=profile[row],sell=(profileWidth-10)*p.sell/profileMax,buy=(profileWidth-10)*p.buy/profileMax;
    svg+=`<g data-footprint-profile-row="${row}" data-buy="${p.buy}" data-sell="${p.sell}"><rect x="130" y="${y}" width="${sell}" height="${rowHeight-1}" fill="#ed819a" fill-opacity=".5"/><rect x="${130+sell}" y="${y}" width="${buy}" height="${rowHeight-1}" fill="#53dabb" fill-opacity=".5"/></g>`;
    const markers=([["POC",f.profile.poc],["VAL",f.profile.val],["VAH",f.profile.vah]] as const).filter(([,value])=>value>=low-1e-8&&value<low+step-1e-8).map(([name])=>name).join(" / ");
    if(markers)svg+=text(left-5,y+11,markers,markers.includes("POC")?"#f0c77a":"#66b8cb",9,"end");
    cols.forEach((bins,i)=>{const b=bins[row],x=left+i*colWidth,total=b.buy+b.sell,color=b.buy>=b.sell?"#53dabb":"#ed819a";
      svg+=`<g data-footprint-cell="${i}:${row}" data-buy="${b.buy}" data-sell="${b.sell}"><rect x="${x+2}" y="${y}" width="${colWidth-4}" height="${rowHeight-1}" fill="${total?color:"#24364b"}" fill-opacity="${total ? .12 : .05}"/>`+text(x+colWidth*.5-9,y+12,compact(b.sell),"#ed819a",10,"end")+text(x+colWidth*.5+9,y+12,compact(b.buy),"#53dabb",10)+"</g>";
    });
  }
  bars.forEach((b,i)=>{const x=left+colWidth*(i+.5),y=top+count*rowHeight;svg+=text(x,y+15,`${zh?"成交量":"Volume"} ${bars.length===1?amount(b.volume):compact(b.volume)}`,"#b9c6d8",10,"middle")+text(x,y+29,`Δ ${bars.length===1?amount(b.delta):compact(b.delta)}`,"#b9c6d8",10,"middle");});
  svg+=text(15,height-13,zh?"相邻价格档仅为显示而合并，保留全部成交量。":"Adjacent display rows are summed; all executed volume is retained.","#8298b5",10);
  return {svg:svg+"</g></svg>",height};
}
