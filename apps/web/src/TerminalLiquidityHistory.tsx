import {useEffect,useMemo,useRef,useState} from "react";
import type {TerminalLiquidityHistory as History} from "@pulse/domain";
import {terminalLiquidityModel,terminalLiquidityCell,terminalLiquidityIntensity} from "./terminalLiquidityVisual";
import {terminalPrice,terminalUtc} from "./terminalClient";
import "./terminalHistory.css";

type Props={history:History|null;busy?:boolean;collecting?:boolean;disabled?:boolean;error?:string;selectedHours:number;onWindowChange:(hours:number)=>void;onCollect:()=>void};
export function TerminalLiquidityHistory({history,busy,collecting=busy,disabled,error,selectedHours,onWindowChange,onCollect}:Props){
 const ref=useRef<HTMLCanvasElement>(null);
 const model=useMemo(()=>history?terminalLiquidityModel(history):null,[history]);
 const [log,setLog]=useState(true),[selection,setSelection]=useState<{column:number;row:number;at?:number}|null>(null);
 const cell=model&&selection?terminalLiquidityCell(model,selection.column,selection.row,selection.at):null;
 useEffect(()=>{setSelection(null);},[history?.instrumentId,selectedHours]);
 useEffect(()=>{
  const canvas=ref.current;if(!canvas||!model)return;const ctx=canvas.getContext("2d");if(!ctx)return;
  const width=960,height=360;canvas.width=width;canvas.height=height;
  const x=(at:number)=>(at-model.start)/(model.end-model.start)*width,rh=height/model.rowCount;
  ctx.clearRect(0,0,width,height);
  // Start unknown. Draw only genuine sampled intervals; explicit gaps and time
  // before a column's first observation retain the hatch underneath.
  ctx.fillStyle="rgba(120,135,155,.13)";ctx.fillRect(0,0,width,height);
  ctx.strokeStyle="rgba(120,135,155,.32)";ctx.lineWidth=.6;
  for(let offset=-height;offset<width;offset+=18){ctx.beginPath();ctx.moveTo(offset,0);ctx.lineTo(offset+height,height);ctx.stroke();}
  for(const sample of model.samples){
   const left=x(sample.start),sw=x(sample.end)-left;
   ctx.clearRect(left,0,sw,height);
   for(let row=0;row<model.rowCount;row++){
    const bid=sample.bids[row],ask=sample.asks[row],top=height-(row+1)*rh;
    const bidStrength=terminalLiquidityIntensity(bid,model.maxSize,log),askStrength=terminalLiquidityIntensity(ask,model.maxSize,log);
    if(bidStrength){ctx.fillStyle="rgba(0,175,139,"+(.15+bidStrength*.85)+")";ctx.fillRect(left,top+(askStrength?rh/2:0),sw,askStrength?rh/2:rh);}
    if(askStrength){ctx.fillStyle="rgba(229,66,111,"+(.15+askStrength*.85)+")";ctx.fillRect(left,top,sw,bidStrength?rh/2:rh);}
   }
  }
  ctx.strokeStyle="#c89414";ctx.lineWidth=2;
  for(const segment of model.midSegments){
   ctx.beginPath();segment.forEach((point,index)=>{const px=x(point.at),py=height-(point.price-model.low)/(model.high-model.low)*height;index?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();
   if(segment.length===1){const point=segment[0];ctx.beginPath();ctx.arc(x(point.at),height-(point.price-model.low)/(model.high-model.low)*height,1.5,0,Math.PI*2);ctx.fillStyle="#c89414";ctx.fill();}
  }
 },[model,log]);
 const inspect=(px:number,py:number)=>{
  const r=ref.current?.getBoundingClientRect();if(!r||!model||!r.width||!r.height)return;
  const fraction=Math.max(0,Math.min(1-Number.EPSILON,(px-r.left)/r.width));
  setSelection({column:Math.min(model.columns.length-1,Math.floor(fraction*model.columns.length)),row:Math.max(0,Math.min(model.rowCount-1,model.rowCount-1-Math.floor((py-r.top)/r.height*model.rowCount))),at:model.start+fraction*(model.end-model.start)});
 };
 const unit=history?.quantityUnit==="contracts"?"contracts":history?.instrumentId.split("-")[0]??"base";
 return <section className="terminal-history-heatmap" aria-labelledby="liquidity-history-heading" data-history-market={history?.instrumentId??""}>
  <div className="terminal-section-heading"><div><h4 id="liquidity-history-heading">Liquidity over time</h4><p>Where displayed bids and offers persisted, moved or disappeared in retained exchange observations.</p></div><label>History window<select value={selectedHours} onChange={e=>{setSelection(null);onWindowChange(Number(e.target.value));}}>{[[1,"Last hour"],[6,"Last 6 hours"],[24,"Last 24 hours"],[168,"Last 7 days"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
  <div className="terminal-history-legend"><span><i className="bid"/>Bids</span><span><i className="ask"/>Offers</span><span><i className="unknown"/>No observation</span><label><input type="checkbox" checked={log} onChange={e=>setLog(e.target.checked)}/>Log intensity</label></div>
  {history&&<p className="terminal-hint">{history.source} · {history.depthLevels} levels per side · {Math.round(history.sampleIntervalMs/1000)}s returned sampling · {model?.frameCount??0} real observations · {terminalUtc(history.requestedStart)} → {terminalUtc(history.requestedEnd)}</p>}
  {history&&<p className="terminal-history-coverage" role="status" data-history-coverage={history.status}>{history.gaps.length?history.gaps.length+" missing interval(s). Hatched time has no retained observation.":model?"Requested sampled observations are retained; changes between samples remain unknown.":"No usable retained observations in this range yet."}</p>}
  {error&&<p role="alert">{error}</p>}{busy&&!history&&<p>Loading retained liquidity…</p>}
  {model?<>
   <div className="terminal-heatmap-plot"><div className="terminal-heatmap-axis"><span>{terminalPrice(model.high)}</span><span>{terminalPrice(model.low)}</span></div>
    <canvas ref={ref} role="img" tabIndex={0} aria-label="Historical bid and offer liquidity. Hover or tap for price and source time; arrow keys inspect samples." onPointerMove={e=>inspect(e.clientX,e.clientY)} onClick={e=>inspect(e.clientX,e.clientY)} onKeyDown={e=>{
     if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;e.preventDefault();
     setSelection(s=>({column:Math.max(0,Math.min(model.columns.length-1,(s?.column??0)+(e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0))),row:Math.max(0,Math.min(model.rowCount-1,(s?.row??0)+(e.key==="ArrowUp"?1:e.key==="ArrowDown"?-1:0)))}));
    }}/>
   </div>
   <div className="terminal-history-axis"><span>{terminalUtc(model.start)}</span><span>{terminalUtc(model.end)}</span></div>
   <div className="terminal-heatmap-inspector" aria-live="polite" data-source-at={cell?.sourceAt??""}>{cell?<>
    <b>{terminalPrice(cell.low)}–{terminalPrice(cell.high)}</b>
    <span>{cell.sourceAt===null?"No retained observation at the selected time":"Source "+terminalUtc(cell.sourceAt)}</span>
    {cell.knownAt!==null&&<span>Retrieved {terminalUtc(cell.knownAt)}</span>}
    <span>{cell.bid===null?"Bids unknown outside retained coverage":"Bids "+terminalPrice(cell.bid,6)+" "+unit} · {cell.ask===null?"Offers unknown outside retained coverage":"Offers "+terminalPrice(cell.ask,6)+" "+unit}</span>
    {cell.gaps.length>0&&<span>Source gap in this display bucket: {cell.gaps.map(gap=>gap.reason).filter((value,index,all)=>all.indexOf(value)===index).join("; ")}</span>}
   </>:"Hover or tap a cell to see its actual source time, price band and displayed quantities."}</div>
  </>:<div className="terminal-empty"><b>Building genuine liquidity history</b><p>Historical exchange archives and new retained observations populate this view. Current depth is never copied into missing time.</p></div>}
  <p className="terminal-hint">{history?.backfill.message??"Enable the market-history collector to retain observations."} Color intensity represents resting size in one snapshot, not traded volume or liquidation prices. The plot uses actual sample times; missing time and depth beyond the returned ladder stay unknown.</p>
  {history?.gaps.length?<details><summary>Missing source intervals · {history.gaps.length}</summary><ul>{history.gaps.slice(0,12).map((gap,index)=><li key={index}>{terminalUtc(gap.start)} → {terminalUtc(gap.end)} · {gap.reason}</li>)}</ul>{history.gaps.length>12&&<p>More intervals are retained in the source response.</p>}</details>:null}
  <button type="button" disabled={disabled||collecting} onClick={onCollect}>{collecting?"Collecting…":"Collect / backfill this market"}</button>{disabled&&<p className="terminal-hint">An active Terminal pass is required to collect or refresh market history.</p>}
 </section>;
}
