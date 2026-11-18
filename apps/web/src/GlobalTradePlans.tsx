import {globalPriceBandText,globalSetupEvidenceLines,globalTradeCards,globalFrameReference,globalNextSetupLines,type GlobalReport} from "@pulse/domain";

export function GlobalTradePlans({report,onSelect}:{report:GlobalReport;onSelect:(key:string)=>void}){
  const cards=globalTradeCards(report),zh=report.lang==="zh";
  const study=report.entryStudy,last=study?.candles.at(-1);
  return <section className="global-trade-plans"><h3>{zh?"单一入场计划 · Entry / SL / TP":"Selected setup · Entry / SL / TP"}</h3>
    {report.discretionaryPlan?.priceZones&&<p>{zh?"Entry 与 TP 显示有来源的价格区间。涨跌幅与收益风险比采用目标的首次触及边界和最不利入场；SL 区域表示失效区域，Hard SL 是固定的外侧止损价。":"Entry and TP show sourced price ranges. Percentages and reward/risk use the target's first-touch boundary and the least favorable entry. The SL zone marks invalidation; Hard SL is the fixed outer stop."}</p>}
    <p className="global-meta">{zh?"方向判断不代表入场。须核对实际反应、保护、最近障碍及新报价费用。":"A direction assessment does not establish entry. Check the saved execution policy, protection, nearest barrier and fresh quote costs. Passive limits do not require an extra confirmation candle."}</p>
    {last&&<p className="global-meta">{globalFrameReference(study!.timeframe)} {zh?"最近已完成收盘":"last completed close"}: {last.close.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})}. {zh?"与主图参考收盘时间不同；均不是实时报价。":"Its closing time can differ from the main chart reference. Neither is a live quote."}</p>}
    {!cards.length&&<article className="global-trade-plan-card" data-setup-unavailable="true"><strong>{zh?"计划依据":"Setup evidence"}</strong>{globalNextSetupLines(report).map(line=><p key={line}>{line}</p>)}</article>}
    <div className="global-trade-plan-grid" style={{gridTemplateColumns:"minmax(0,1fr)"}}>{cards.map(c=>{
      const alternate=c.key==="alternate-priced-setup";
      const shown=alternate&&report.alternatePlan?{...report,discretionaryPlan:report.alternatePlan,alternatePlan:undefined,alternatePlanReason:undefined,scenario:undefined,strategyMix:undefined}:report;
      const plan=shown.discretionaryPlan;
      return <article className={`global-trade-plan-card is-${c.side}`} key={c.key} data-trade-card={c.key}>
      {report.alternatePlan&&<p className="global-kicker">{alternate?(zh?"反向备选计划":"Opposing alternate"):(zh?"所选计划":"Selected plan")}</p>}
      <header><strong>{c.direction}</strong><span>{c.state}</span></header>
      <dl><dt>Entry{c.confirmed||report.discretionaryPlan?"":" (planned)"}</dt><dd>{c.entry}</dd><dt>SL{c.confirmed||report.discretionaryPlan?"":" (planned)"}</dt><dd>{c.stop}</dd>{c.targets.map((t,i)=><div className="global-trade-target" key={t.id}><dt>TP{i+1}</dt><dd>{plan?.priceZones?globalPriceBandText(shown,plan.priceZones.targets[i]):t.price.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})}{t.movePercent!==null&&<> ({t.movePercent>=0?"+":""}{t.movePercent.toFixed(2)}%)</>}<small className="global-meta" style={{display:"block"}}>{t.source}</small></dd></div>)}</dl>
      {plan?.priceZones&&<p>Hard SL: {plan.stop.toLocaleString(zh?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:report.snapshot.pricePrecision})}</p>}
      {globalSetupEvidenceLines(shown).map(line=><p key={line}>{line}</p>)}
      <p><b>{zh?"触发条件":"Trigger"}:</b> {c.condition}</p>
      {c.location&&<p>{c.location}</p>}
      {c.plan.entryObstacle&&<p>{zh?"最近途中障碍":"Nearest intervening level"}: {globalFrameReference(c.plan.entryObstacle.timeframe)} {c.plan.entryObstacle.price.toLocaleString("en-US",{maximumFractionDigits:report.snapshot.pricePrecision})} · {c.plan.firstObstacleRewardRisk?.toFixed(2)??"—"}R</p>}
      <p>R:R → TP1: {c.rr?.toFixed(2)??"—"}{c.riskPercent===null?"":` · Entry–SL: ${c.riskPercent.toFixed(2)}%`}</p>
      <p className="global-meta">{zh?"主图":"Analysis"}: {globalFrameReference(report.snapshot.timeframe)} · {zh?"入场":"Entry"}: {globalFrameReference(report.entryStudy?.timeframe??report.snapshot.timeframe)}</p>
      {!alternate&&<button onClick={()=>onSelect(c.key)}>{zh?"在图表上查看此计划":"Show this plan on chart"}</button>}
      {alternate&&<p className="global-meta">{report.alternatePlanReason} {zh?"主图显示所选计划；一个计划执行后应重新评估另一个计划。":"The chart shows the selected plan. Reassess the opposing plan if one executes; these are separate orders, not a predicted price sequence."}</p>}
    </article>;})}</div>
  </section>;
}
