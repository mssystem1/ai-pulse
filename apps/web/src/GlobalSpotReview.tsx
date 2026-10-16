import { useEffect, useRef, useState } from "react";
import type { GlobalAssessment, GlobalOrderReview, GlobalExecutionLevels } from "@pulse/domain";
import { assessmentTitle, recheckGlobalSetup } from "./globalSetupClient";
import type { ReportTradeIntent } from "./Report";

export function GlobalSpotReview({intent,trade,context,protectionEnabled,onProtection,onReview}:{
  intent:ReportTradeIntent;trade:Record<string,unknown>;context:string;protectionEnabled:boolean;
  onProtection:(assessment:GlobalAssessment,executionLevels?:GlobalExecutionLevels)=>void;
  onReview:(review:{expiresAt:number;setupExpiresAt:number;context:string}|null)=>void;
}){
  const [result,setResult]=useState<{assessment:GlobalAssessment;review?:GlobalOrderReview;executionLevels?:GlobalExecutionLevels}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [now,setNow]=useState(Date.now()),[riskBudget,setRiskBudget]=useState("");
  const latest=useRef(context);latest.current=context;
  const checked=useRef("");
  useEffect(()=>{onReview(null);},[context]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const review=result?.review,current=checked.current===context,fresh=current&&review&&now<review.expiresAt;
  const withinBudget=!(Number(riskBudget)>0)||review?.cashRisk!==null&&review?.cashRisk!==undefined&&review.cashRisk<=Number(riskBudget);
  const ready=fresh&&review.state==="ready_for_order_review"&&protectionEnabled&&withinBudget;
  const validUntil=ready?review.expiresAt:0;
  useEffect(()=>{onReview(validUntil&&result?.assessment.expiresAt?{expiresAt:validUntil,setupExpiresAt:result.assessment.expiresAt,context}:null);},[validUntil,context]);
  const check=async()=>{
    if(!intent.reportAccess||busy)return;const requestContext=context;setBusy(true);setError("");onReview(null);
    try{
      const next=await recheckGlobalSetup(intent.reportAccess,trade);
      if(latest.current!==requestContext)return;
      checked.current=requestContext;setResult(next);setNow(Date.now());
    }catch(reason){if(latest.current===requestContext)setError(reason instanceof Error?reason.message:"Report quote check failed");}finally{setBusy(false);}
  };
  if(!intent.reportAccess)return null;
  return <section className="global-fresh-assessment" data-order-review-state={ready?"ready_for_order_review":"blocked"}>
    <h3>Report conditions + size-specific quote</h3><p>The original report remains unchanged. This checks new completed candles, the actual route, observed protection, balance and modeled costs for your amount.</p>
    <button disabled={busy} onClick={()=>void check()}>{busy?"Checking conditions and route…":"Check report + quote for this amount"}</button>
    {error&&<p role="alert">{error}</p>}
    {result&&<><h4>{ready?"READY FOR ORDER REVIEW":!withinBudget?"NO TRADE · chosen risk budget exceeded":!current?"TICKET CHANGED · recheck":!fresh&&review?"REVIEW EXPIRED · recheck":assessmentTitle(result.assessment)}</h4>
      {result.assessment.lines.map((line,i)=><p key={i}>{line}</p>)}
      {result.assessment.state==="technical_valid"&&result.assessment.side==="long"&&<><button onClick={()=>onProtection(result.assessment,result.executionLevels)}>Load fresh observed entry, TP and SL{result.executionLevels?` in ${result.executionLevels.currency}`:""}</button>{result.executionLevels&&<p>Execution prices: {result.executionLevels.currency}. Research: {result.executionLevels.researchCurrency}. Conversion: 1 {result.executionLevels.currency} = {result.executionLevels.settlementToResearch} {result.executionLevels.researchCurrency}. Load the converted protection before review.</p>}</>}
      {review&&<><p>Modeled net R:R: {review.netRewardRisk?.toFixed(2)??"unavailable"} · cost budget: {review.costsBps?.toFixed(2)??"unavailable"} bps · cash risk: {review.cashRisk?.toFixed(2)??"unavailable"} {result.assessment.priceCurrency}</p>{review.lines.map((line,i)=><p key={i}>{line}</p>)}{review.expiresAt>0&&<p>Review ends {new Date(review.expiresAt).toISOString()}. Wallet approval is still required.</p>}</>}
      {!protectionEnabled&&<p>Enable TP/SL attachment before a report-based order review can qualify.</p>}
      <label>My maximum cash risk ({result.assessment.priceCurrency}) <input inputMode="decimal" type="number" min="0" step="any" value={riskBudget} onChange={event=>setRiskBudget(event.target.value)}/></label>
      {review?.cashRisk&&review.quantity>0&&Number(riskBudget)>0&&<p>At this quote and stop, this risk budget supports at most {(Number(riskBudget)/(review.cashRisk/review.quantity)).toLocaleString("en-US",{maximumSignificantDigits:8})} units before balance/liquidity limits. {Number(riskBudget)<review.cashRisk?"The current amount exceeds your chosen risk budget.":"The current modeled risk is within your chosen budget."} Stops do not guarantee fill prices.</p>}
    </>}
  </section>;
}
