import {globalSetupEvidenceLines,globalTradeCards,globalFrameReference,globalNextSetupLines,type GlobalReport} from "@pulse/domain";

export function GlobalTradePlans({report,onSelect}:{report:GlobalReport;onSelect:(key:string)=>void}){
  const cards=globalTradeCards(report),zh=report.lang==="zh";
  const study=report.entryStudy,last=study?.candles.at(-1);
  return <section className="global-trade-plans"><h3>{zh?"单一入场计划 · Entry / SL / TP":"Selected setup · Entry / SL / TP"}</h3>
    <p className="global-meta">{zh?"方向判断不代表入场。须核对实际反应、保护、最近障碍及新报价费用。":"A direction assessment does not establish entry. Check the observed reaction, protection, nearest barrier and fresh quote costs."}</p>
    {last&&<p className="global-meta">{globalFrameReference(study!.timeframe)} {zh?"最近已完成收盘":"last completed close"}: {last.close.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})}. {zh?"与主图参考收盘时间不同；均不是实时报价。":"Its closing time can differ from the main chart reference. Neither is a live quote."}</p>}
    {!cards.length&&<article className="global-trade-plan-card" data-setup-unavailable="true"><strong>{zh?"暂无有效入场":"No validated entry"}</strong>{globalNextSetupLines(report).map(line=><p key={line}>{line}</p>)}</article>}
    <div className="global-trade-plan-grid" style={{gridTemplateColumns:"minmax(0,1fr)"}}>{cards.map(c=><article className={`global-trade-plan-card is-${c.side}`} key={c.key} data-trade-card={c.key}>
      <header><strong>{c.direction}</strong><span>{c.state}</span></header>
      <dl><dt>Entry{c.confirmed||report.discretionaryPlan?"":" (planned)"}</dt><dd>{c.entry}</dd><dt>SL{c.confirmed||report.discretionaryPlan?"":" (planned)"}</dt><dd>{c.stop}</dd>{c.targets.map((t,i)=><div className="global-trade-target" key={t.id}><dt>TP{i+1}</dt><dd>{t.price.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})}{t.movePercent!==null&&<> ({t.movePercent>=0?"+":""}{t.movePercent.toFixed(2)}%)</>}<small className="global-meta" style={{display:"block"}}>{t.source}</small></dd></div>)}</dl>
      {globalSetupEvidenceLines(report).map(line=><p key={line}>{line}</p>)}
      <p><b>{zh?"触发条件":"Trigger"}:</b> {c.condition}</p>
      {c.location&&<p>{c.location}</p>}
      {c.plan.entryObstacle&&<p>{zh?"最近途中障碍":"Nearest intervening level"}: {globalFrameReference(c.plan.entryObstacle.timeframe)} {c.plan.entryObstacle.price.toLocaleString("en-US",{maximumFractionDigits:report.snapshot.pricePrecision})} · {c.plan.firstObstacleRewardRisk?.toFixed(2)??"—"}R</p>}
      <p>R:R → TP1: {c.rr?.toFixed(2)??"—"}{c.riskPercent===null?"":` · Entry–SL: ${c.riskPercent.toFixed(2)}%`}</p>
      <p className="global-meta">{zh?"主图":"Analysis"}: {globalFrameReference(report.snapshot.timeframe)} · {zh?"入场":"Entry"}: {globalFrameReference(report.entryStudy?.timeframe??report.snapshot.timeframe)}</p>
      <button onClick={()=>onSelect(c.key)}>{zh?"在图表上查看此计划":"Show this plan on chart"}</button>
    </article>)}</div>
  </section>;
}
