import type { GlobalAssessment } from "@pulse/schemas";

export type GlobalOrderReview = {
  state:"blocked"|"ready_for_order_review";
  sourceRef:string; assessedAt:string; expiresAt:number;
  entry:number|null; takeProfit:number|null; stopLoss:number|null;
  quantity:number; cashRisk:number|null; netRewardRisk:number|null; costsBps:number|null;
  blockers:string[]; lines:string[];
};
export type GlobalExecutionLevels = {currency:string;researchCurrency:string;settlementToResearch:number;entry:[number,number];referenceEntry:number;takeProfit:number;stopLoss:number};
export type GlobalQuoteEvidence = {
  observedAt:number; expiresAt:number; entry:number; quantity:number;
  roundTripLoss:number|null; networkFees:number|null; slippageBps:number;
  inputBalanceSufficient:boolean; representationVerified:boolean;
  /** Quote settlement and research currency conversion verified by server. */
  currencyVerified:boolean;
};

/** Quotes are supplied only by the server adapter. No client-provided fee can
 * declare readiness. All amounts use the report's quoted currency. */
export function reviewGlobalOrder(a:GlobalAssessment,q:GlobalQuoteEvidence,now:number):GlobalOrderReview {
  const blockers:string[]=[],target=a.targets[0]??null,stop=a.observedStop;
  if(a.state!=="technical_valid"||a.side!=="long"||!a.permittedEntry||stop===null)blockers.push("technical");
  if(a.side==="short")blockers.push("owned_spot_only");
  if(!Number.isFinite(Date.parse(a.assessedAt))||now-Date.parse(a.assessedAt)>60_000||Date.parse(a.assessedAt)>now+5_000)blockers.push("assessment_stale");
  if(!a.expiresAt||now>=a.expiresAt)blockers.push("attempt_expired");
  if(![q.observedAt,q.expiresAt].every(Number.isFinite)||q.observedAt>now+5_000||now-q.observedAt>30_000||q.expiresAt<=now)blockers.push("quote_stale");
  if(!Number.isFinite(q.entry)||!Number.isFinite(q.quantity)||q.entry<=0||q.quantity<=0)blockers.push("quote_invalid");
  if(!q.representationVerified||!q.currencyVerified)blockers.push("representation");
  if(!q.inputBalanceSufficient)blockers.push("balance");
  if(a.permittedEntry&&(q.entry<a.permittedEntry[0]||q.entry>a.permittedEntry[1]))blockers.push("entry_price");
  const costKnown=q.roundTripLoss!==null&&q.networkFees!==null&&[q.roundTripLoss,q.networkFees,q.slippageBps].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0);
  if(!costKnown)blockers.push("costs");
  const notional=q.entry*q.quantity,cost=costKnown?q.roundTripLoss!+q.networkFees!+notional*q.slippageBps/10_000:null;
  const risk=stop!==null?(q.entry-stop)*q.quantity:null,reward=target!==null?(target-q.entry)*q.quantity:null;
  const net=risk!==null&&risk>0&&reward!==null&&cost!==null?(reward-cost)/(risk+cost):null;
  if(net!==null&&(!Number.isFinite(net)||net<1.5))blockers.push("net_reward");
  if(risk===null||risk<=0||reward===null||reward<=0||target===null)blockers.push("protection");
  const explanations:Record<string,string>={technical:"A fresh observed long setup is required.",owned_spot_only:"Short research only supports a manual sell of owned Spot inventory.",assessment_stale:"Recheck technical evidence; the assessment is stale.",attempt_expired:"The observed entry window has expired.",quote_stale:"Refresh the size-specific quote; quotes last at most 30 seconds.",quote_invalid:"The route returned invalid amounts.",representation:"Token representation or research-currency conversion is unverified.",balance:"Available settlement-token balance is insufficient or unknown.",entry_price:"The fresh quote is outside the observed, reward-constrained entry range; do not chase.",costs:"Complete route/network cost evidence is unavailable; fees cannot be assumed zero.",net_reward:"Modeled net R:R to the nearest obstacle is below 1.50.",protection:"Observed protection and a correctly ordered nearest target are required."};
  return {state:blockers.length?"blocked":"ready_for_order_review",sourceRef:a.sourceRef,assessedAt:a.assessedAt,expiresAt:Math.min(q.expiresAt,a.expiresAt??q.expiresAt,Date.parse(a.assessedAt)+60_000),entry:Number.isFinite(q.entry)?q.entry:null,takeProfit:target,stopLoss:stop,quantity:q.quantity,cashRisk:risk!==null&&cost!==null?risk+cost:null,netRewardRisk:net,costsBps:cost!==null&&notional>0?cost/notional*10_000:null,blockers:[...new Set(blockers)],lines:[...new Set(blockers)].map(b=>explanations[b]).concat("Cost model: current entry/exit route loss + both network estimates + slippage budget. Future exit costs and stop fills can change. Review gas, account setup and protection in the wallet before approval.")};
}
