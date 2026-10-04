import { researchIdentity, researchNumber, researchRecord, type ResearchContext } from "./researchPresentation.js";

const array = (value: unknown) => Array.isArray(value) ? value.map(researchRecord) : [];
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]!));
const short = (value: unknown, max = 48) => { const chars=Array.from(String(value??""));return chars.length>max?chars.slice(0,max-1).join("")+"…":chars.join(""); };
const price = (value: number) => value.toLocaleString("en-US",{maximumFractionDigits:8});
const colors: Record<string,string> = {wave_3_continuation:"#45e7a6",wave_5_continuation:"#20cfff",abc_correction:"#ffc857",wave_c_continuation:"#ff9d66",count_invalidation:"#ff6f86",recount:"#cbb6ff"};

/** Self-contained SVG of the purchased snapshot. No external URLs or live data. */
export function researchChartSvg(report: unknown, context: ResearchContext = {}): string | null {
  const data=researchRecord(report),identity=researchIdentity(context,report);
  const prediction=identity.serviceId.startsWith("prediction"),source=prediction?researchRecord(data.underlyingSpot):data;
  // Quick reports have no premium chart; never invent a prediction chart for an unmapped asset.
  if (!identity.serviceId.endsWith("pro") || source.status==="unmapped") return null;
  const candles=array(researchRecord(source.chart).candles).filter(c=>[c.close,c.low,c.high].every(v=>{const n=researchNumber(v);return n!==undefined&&n>0;})).slice(-1000);
  if(candles.length<2)return null;
  const technical=researchRecord(source.technical),deterministic=researchRecord(technical.elliott),a=prediction?{}:researchRecord(data.analysis),wave=researchRecord(a.elliottWave);
  const paths=(array(wave.paths).length?array(wave.paths):array(deterministic.paths)).filter(path=>{const n=researchNumber(path.target);return n!==undefined&&n>0;}).slice(0,6);
  const invalidation=researchNumber(wave.invalidation??researchRecord(a.invalidation).price??deterministic.invalidation);
  const values=[...candles.flatMap(c=>[Number(c.low),Number(c.high)]),...paths.map(p=>Number(p.target)),...(invalidation!==undefined&&invalidation>0?[invalidation]:[])];
  const rawMin=Math.min(...values),rawMax=Math.max(...values),margin=(rawMax-rawMin||rawMax*.02)*.12,min=rawMin-margin,max=rawMax+margin;
  const width=1200,height=680,top=115,bottom=480,left=82,historyEnd=775,right=1120;
  const x=(i:number)=>left+i/Math.max(1,candles.length-1)*(historyEnd-left),y=(n:number)=>top+(max-n)/(max-min)*(bottom-top);
  const points=candles.map((c,i)=>`${x(i).toFixed(2)},${y(Number(c.close)).toFixed(2)}`).join(" "),last=Number(candles.at(-1)!.close),lastY=y(last);
  const text=(px:number,py:number,value:unknown,size=15,color="#9caeba",anchor="start")=>`<text x="${px}" y="${py}" font-size="${size}" fill="${color}" text-anchor="${anchor}">${escape(value)}</text>`;
  const grid=Array.from({length:5},(_,i)=>{const n=max-i*(max-min)/4,py=y(n);return `<line x1="${left}" y1="${py}" x2="${right}" y2="${py}" stroke="#1d313b"/>${text(left-10,py+5,price(n),13,"#8296a5","end")}`;}).join("");
  const fibs=array(technical.fibonacci).filter(f=>{const n=researchNumber(f.price);return n!==undefined&&n>=min&&n<=max;}).slice(0,10).map(f=>`<line x1="${left}" x2="${historyEnd}" y1="${y(Number(f.price))}" y2="${y(Number(f.price))}" stroke="#24544d" stroke-dasharray="3 6"/>${text(historyEnd-6,y(Number(f.price))-5,`Fib ${String(f.ratio)} · ${price(Number(f.price))}`,12,"#63b6a5","end")}`).join("");
  const waves=array(deterministic.waves).slice(-12).map(w=>{const index=candles.findIndex(c=>Number(c.ts)===Number(w.ts)),n=researchNumber(w.price);if(index<0||n===undefined||n<min||n>max)return "";return `<circle cx="${x(index)}" cy="${y(n)}" r="10" fill="#0d151f" stroke="#cbb6ff"/>${text(x(index),y(n)+4,short(w.label,4),12,"#e8dcff","middle")}`;}).join("");
  const projections=paths.map((p,i)=>{const target=Number(p.target),color=colors[String(p.type)]||colors.recount;return `<path d="M ${historyEnd} ${lastY} Q ${historyEnd+120} ${(lastY+y(target))/2+(i%3-1)*30} ${right} ${y(target)}" fill="none" stroke="${color}" stroke-width="${i===0?3:2}" ${i>0?'stroke-dasharray="8 6"':""}/><circle cx="${right}" cy="${y(target)}" r="4" fill="${color}"/>${text(right+7,y(target)+5,price(target),12,color)}`;}).join("");
  const legend=paths.map((p,i)=>{const column=i%2,line=Math.floor(i/2),color=colors[String(p.type)]||colors.recount;return `<circle cx="${left+column*540}" cy="${540+line*26}" r="4" fill="${color}"/>${text(left+12+column*540,545+line*26,`${short(p.label||String(p.type||"Path").replaceAll("_"," "),42)} · ${price(Number(p.target))}`,14,color)}`;}).join("");
  const date=(value:unknown)=>{const n=researchNumber(value);if(n===undefined)return "";const d=new Date(n);return Number.isFinite(d.getTime())?d.toISOString().replace("T"," ").slice(0,16)+" UTC":"";};
  const pair=String(source.instId||researchRecord(source.executionPlan).pair||identity.subject),timeframe=prediction?"4H":identity.timeframe||"";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00dba8" stop-opacity=".25"/><stop offset="1" stop-color="#00dba8" stop-opacity="0"/></linearGradient></defs><rect width="${width}" height="${height}" rx="24" fill="#0b111b"/><g font-family="Inter, Arial, sans-serif">${text(32,42,"PULSE",25,"#00e5aa")}${text(width-32,42,identity.serviceTitle,16,"#b6c6d0","end")}${text(32,80,`${short(pair,50)} · ${timeframe} ${prediction?"underlying asset":""} · Elliott structure`,23,"#edf4f7")}${grid}${fibs}<line x1="${historyEnd+14}" x2="${historyEnd+14}" y1="${top}" y2="${bottom}" stroke="#375059" stroke-dasharray="5 5"/>${text(historyEnd+24,top-12,"CONDITIONAL NEXT PATHS",12,"#97acbb")}<polygon points="${left},${bottom} ${points} ${historyEnd},${bottom}" fill="url(#fill)"/><polyline points="${points}" fill="none" stroke="#00e5aa" stroke-width="2.5"/>${waves}${projections}${invalidation!==undefined&&invalidation>0?`<line x1="${left}" x2="${right}" y1="${y(invalidation)}" y2="${y(invalidation)}" stroke="#ff6f86" stroke-dasharray="6 6"/>${text(left+6,y(invalidation)-6,`Count invalidation · ${price(invalidation)}`,13,"#ff8b9c")}`:""}${text(left,bottom+24,date(candles[0].ts),12)}${text(historyEnd,bottom+24,date(candles.at(-1)!.ts),12,"#9caeba","end")}${legend}${text(32,642,`${candles.length} saved candles · Observed close ${price(last)} · Conditional scenarios, not guaranteed forecasts.`,14)}${text(32,664,"Original report snapshot · Not live prices · Research only / not financial advice",12,"#6f8796")}</g></svg>`;
}
