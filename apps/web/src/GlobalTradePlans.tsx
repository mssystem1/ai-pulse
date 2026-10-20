import {globalTradeCards,globalFrameReference,type GlobalReport} from "@pulse/domain";

export function GlobalTradePlans({report,onSelect}:{report:GlobalReport;onSelect:(key:string)=>void}){
  const cards=globalTradeCards(report),zh=report.lang==="zh";
  const study=report.entryStudy,last=study?.candles.at(-1);
  return <section className="global-trade-plans"><h3>{zh?"单一入场计划 · Entry / SL / TP":"Selected setup · Entry / SL / TP"}</h3>
    <p className="global-meta">{zh?"标为 planned 的价格是条件计划；须入场信号确认并复核新报价。":"Prices marked planned form a conditional setup. Confirm the entry signal and review a fresh quote before an order."}</p>
    {last&&<p className="global-meta">{globalFrameReference(study!.timeframe)} {zh?"最近已完成收盘":"last completed close"}: {last.close.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})}. {zh?"与主图参考收盘时间不同；均不是实时报价。":"Its closing time can differ from the main chart reference. Neither is a live quote."}</p>}
    {!cards.length&&<article className="global-trade-plan-card" data-setup-unavailable="true"><strong>{zh?"暂无有效入场":"No validated entry"}</strong><p>{report.setupSelection?.limitations[0]??(zh?"需要有依据的结构与入场证据。":"Supported structure and entry evidence are required.")}</p></article>}
    <div className="global-trade-plan-grid" style={{gridTemplateColumns:"minmax(0,1fr)"}}>{cards.map(c=><article className={`global-trade-plan-card is-${c.side}`} key={c.key} data-trade-card={c.key}>
      <header><strong>{c.direction}</strong><span>{c.state}</span></header>
      <dl><dt>Entry{c.confirmed?"":" (planned)"}</dt><dd>{c.entry}</dd><dt>SL{c.confirmed?"":" (planned)"}</dt><dd>{c.stop}</dd>{c.targets.map((t,i)=><div className="global-trade-target" key={t.id}><dt>TP{i+1}</dt><dd>{t.price.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})}{t.movePercent!==null&&<> ({t.movePercent>=0?"+":""}{t.movePercent.toFixed(2)}%)</>}<small className="global-meta" style={{display:"block"}}>{t.source}</small></dd></div>)}</dl>
      <p><b>{zh?"触发条件":"Trigger"}:</b> {c.condition}</p>
      {c.location&&<p>{c.location}</p>}
      <p>R:R → TP1: {c.rr?.toFixed(2)??"—"}{c.riskPercent===null?"":` · Entry–SL: ${c.riskPercent.toFixed(2)}%`}</p>
      <p className="global-meta">{zh?"主图":"Analysis"}: {globalFrameReference(report.snapshot.timeframe)} · {zh?"入场":"Entry"}: {globalFrameReference(report.entryStudy?.timeframe??report.snapshot.timeframe)}</p>
      <button onClick={()=>onSelect(c.key)}>{zh?"在图表上查看此计划":"Show this plan on chart"}</button>
    </article>)}</div>
  </section>;
}
