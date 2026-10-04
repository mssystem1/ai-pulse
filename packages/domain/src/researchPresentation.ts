/** Public research content shared by Telegram messages, downloads and the Mini App.
 * Explicit fields keep provider payloads, candle arrays and payment metadata out of exports.
 */
type RecordValue = Record<string, unknown>;
export type ResearchContext = { serviceId?: string; input?: unknown; networkKey?: string; createdAt?: number | string };
export type ResearchIdentity = { serviceId: string; serviceTitle: string; subject: string; timeframe?: string; label: string };
export type ResearchSection = { title: string; lines: string[]; featured?: boolean };
export type ResearchPresentation = ResearchIdentity & { headline: string; summary: string; generatedAt?: string; sections: ResearchSection[]; disclaimer: string };
export const researchRecord = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const items = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
const words = (value: unknown) => text(value).replaceAll("_", " ");
export const researchNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const result = Number(value); return Number.isFinite(result) ? result : undefined;
};
const num = (value: unknown, suffix = "") => { const n = researchNumber(value); return n === undefined ? "" : `${n.toLocaleString("en-US", { maximumFractionDigits: 8 })}${suffix}`; };
const usd = (value: unknown) => { const result = num(value); return result ? `$${result}` : ""; };
const row = (label: string, value: unknown) => text(value) ? `${label}: ${text(value)}` : "";
const joined = (...values: unknown[]) => values.map(text).filter(Boolean).join(" · ");
const strings = (value: unknown) => items(value).map(text).filter(Boolean);
export function researchServiceTitle(id: string) {
  return ({ "global-quick": "Global Quick", "global-pro": "Global Pro", "risk-guard": "Risk Guard", "prediction-quick": "Prediction Quick", "prediction-pro": "Prediction Pro" } as Record<string,string>)[id] || "Research";
}
export function researchIdentity(context: ResearchContext = {}, report?: unknown): ResearchIdentity {
  const data = researchRecord(report), input = researchRecord(context.input), execution = researchRecord(data.executionPlan);
  const primary = researchRecord(items(researchRecord(data.predictionContext).markets)[0]);
  const market = researchRecord(primary.market), token = researchRecord(data.token);
  const service = text(data.service).toLowerCase();
  const pro = data.tier === "premium" || service.includes("premium");
  const mode = service.includes("prediction") || data.predictionContext ? "prediction" : service.includes("risk") || data.token || data.overallScore !== undefined ? "risk" : "global";
  const serviceId = context.serviceId || (mode === "risk" ? "risk-guard" : `${mode}-${pro ? "pro" : "quick"}`);
  let subject: string, timeframe: string | undefined;
  if (serviceId.startsWith("global")) {
    subject = text(input.instId || execution.pair || data.instId) || "Global market";
    timeframe = text(input.timeframe || execution.timeframe || data.timeframe) || undefined;
  } else if (serviceId.startsWith("prediction")) {
    subject = text(market.question || input.primaryMarketId || data.primaryMarketId || market.id) || "Prediction market";
  } else {
    const address = text(input.address || token.address || data.address);
    subject = joined(token.symbol || data.symbol || (address ? `${address.slice(0,6)}…${address.slice(-4)}` : "Token"), context.networkKey || data.network);
  }
  return { serviceId, serviceTitle: researchServiceTitle(serviceId), subject, ...(timeframe ? { timeframe } : {}), label: joined(subject, timeframe, researchServiceTitle(serviceId)) };
}
export function researchStatus(status: string) {
  return ({completed:"Ready",completed_partial:"Ready · partial evidence",awaiting_payment:"Awaiting payment",payment_received:"Payment received",queued:"Queued",running:"Generating",failed_retriable:"Retrying",failed_terminal:"Failed",manual_reconciliation:"Needs support",refunded:"Refunded"} as Record<string,string>)[status] || words(status);
}
export function researchDate(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "";
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().replace("T", " ").slice(0,16) + " UTC";
}
export function presentResearch(report: unknown, context: ResearchContext = {}): ResearchPresentation {
  const data = researchRecord(report), a = researchRecord(data.analysis), identity = researchIdentity(context, report);
  const sections: ResearchSection[] = [];
  const add = (title: string, lines: unknown[], featured = false) => {
    const clean = [...new Set(lines.map(text).filter(Boolean))];
    if (clean.length) sections.push({title,lines:clean,...(featured ? {featured:true} : {})});
  };
  const list = (title: string, value: unknown, featured = false) => add(title, strings(value), featured);
  const confidence = num(a.confidence ?? data.confidence, "%");
  if (identity.serviceId.startsWith("global")) {
    const execution = researchRecord(data.executionPlan), recommendation = researchRecord(execution.recommendation), buy = researchRecord(execution.buy);
    const technical = researchRecord(data.technical), pivots = researchRecord(technical.pivots), deterministic = researchRecord(technical.elliott), wave = researchRecord(a.elliottWave);
    const paths = items(wave.paths).length ? items(wave.paths) : items(deterministic.paths);
    add("Outlook", [row("Bias",words(a.bias)),row("Confidence",confidence)], true);
    add("Conditional trade setup", [text(recommendation.label), row("Action",words(recommendation.action)),text(recommendation.reason),row("Observed price",num(execution.observedPrice)),row("Entry / trigger",joined(num(buy.trigger),words(buy.orderType))),row("Take profit",num(buy.takeProfit)),row("Stop loss",num(buy.stopLoss)),row("Risk / reward",num(buy.riskReward))], true);
    const invalidation = researchRecord(a.invalidation);
    add("Invalidation", [typeof a.invalidation === "object" ? joined(num(invalidation.price),invalidation.condition) : text(a.invalidation)], true);
    add("Price targets", items(a.targets).map(item => {const target=researchRecord(item);return joined(row(text(target.label)||"Target",num(target.price)),target.rationale);}), true);
    const levels = researchRecord(a.keyLevels);
    add("Key levels", [row("Support",strings(levels.support).join(" · ")),row("Resistance",strings(levels.resistance).join(" · "))], true);
    add("Elliott-wave next paths", paths.flatMap(item => {const path=researchRecord(item);return [joined(path.label || words(path.type),row("Target",num(path.target))),text(path.thesis),row("Sequence",strings(path.sequence).join(" → "))];}),true);
    if (!paths.length) add("Legacy report paths",items(a.scenarios).map(item=>{const s=researchRecord(item);return joined(s.name||s.label,row("Target",num(s.target)),s.reason||s.thesis);}));
    add("Technical structure", [row("Pivot",num(pivots.pivot)),row("S1 / R1",joined(num(pivots.s1),num(pivots.r1))),row("Current wave",words(wave.currentWave||deterministic.currentWave||deterministic.phase)),row("Structure",words(wave.structure||deterministic.direction)),row("Count invalidation",num(wave.invalidation??deterministic.invalidation)),text(deterministic.explanation)]);
    const defi=researchRecord(data.defi);
    add("DeFi evidence",[joined(defi.requestedAsset||defi.asset,defi.network,words(defi.status)),text(defi.explanation),row("Verified token",defi.tokenAddress),...items(defi.opportunities).map(item=>{const o=researchRecord(item);return joined(o.protocol,o.productGroup,row("Score",num(o.score)),row("Observed APY",num(o.apyPercent,"%")),row("TVL",usd(o.tvlUsd)),typeof o.investable==="boolean"?(o.investable?"Investable":"Not currently investable"):"",typeof o.redeemable==="boolean"?(o.redeemable?"Redeem supported":"Redeem not confirmed"):"",strings(o.riskFlags).join(" · "));})]);
    list("Agent checklist",a.agentChecklist);
    list("Risks",a.riskNotes,true); list("Limitations",a.limitations,true);
  } else if (identity.serviceId.startsWith("prediction")) {
    const decision=researchRecord(a.decision),fair=researchRecord(a.fairProbabilityRange),prediction=researchRecord(data.predictionContext);
    const primary=researchRecord(items(prediction.markets)[0]),market=researchRecord(primary.market);
    const low=num(fair.low),high=num(fair.high);
    add("Decision framework",[row("Action",words(decision.action)),row("Stance",words(a.stance)),row("Confidence",confidence),row("Market probability",num(a.marketProbabilityPct,"%")),row("Fair probability range",low&&high?`${low}–${high}% (estimate, not a guarantee)`:""),text(decision.rationale)],true);
    list("Entry conditions",a.entryConditions,true);list("No-trade conditions",a.noTradeConditions,true);
    list("What would invalidate this report",a.invalidationConditions,true);
    list("Supports the lean",a.evidenceDrivers);list("Challenges the lean",a.counterEvidence);
    list("Catalysts toward YES",a.catalystsForYes);list("Catalysts toward NO",a.catalystsForNo);
    add("Market snapshot",[text(market.question),...items(primary.outcomes).map(item=>{const outcome=researchRecord(item),f=researchRecord(outcome.features),p=researchNumber(f.midpointProbability),bid=researchNumber(f.bestBid),ask=researchNumber(f.bestAsk);return joined(outcome.name,row("Probability",p===undefined?"Unavailable":num(p*100,"%")),row("Bid",bid===undefined?"":num(bid*100,"%")),row("Ask",ask===undefined?"":num(ask*100,"%")),f.spreadQuality?`${words(f.spreadQuality)} spread`:"",f.liquidityQuality?`${words(f.liquidityQuality)} liquidity`:"",f.stale===true?"Stale evidence":"");}),row("Liquidity",usd(market.liquidityUsd)),row("Volume",usd(market.volumeUsd)),row("Open interest",usd(primary.openInterest)),row("Ends",researchDate(market.endDate))]);
    const underlying=researchRecord(data.underlyingSpot);
    add("Underlying asset · 4H",[joined(underlying.instId,words(underlying.status)),text(underlying.explanation)]);
    const underlyingTechnical=researchRecord(underlying.technical),underlyingWave=researchRecord(underlyingTechnical.elliott);
    add("Underlying 4H structure",[row("Current wave",words(underlyingWave.currentWave||underlyingWave.phase)),row("Direction",words(underlyingWave.direction)),row("Count invalidation",num(underlyingWave.invalidation)),text(underlyingWave.explanation),...items(underlyingWave.paths).map(item=>{const path=researchRecord(item);return joined(path.label||words(path.type),row("Target",num(path.target)),path.thesis);})]);
    add("Evidence",[prediction.partial===true?"Partial evidence. Review unavailable sources before acting.":"",...strings(prediction.missingSources).map(source=>`Unavailable source: ${source}`)],true);
    list("Risks and limitations",a.limitations,true);list("Execution checklist",a.executionRisks,true);
  } else {
    const intelligence=researchRecord(data.intelligence),token=researchRecord(data.token),provider=researchRecord(token.providerAssessment);
    add("Risk assessment",[row("PULSE score",num(data.overallScore," / 100")),row("Grade",data.grade),row("Verdict",words(data.verdict)),row("Assessment confidence",confidence),row("Evidence coverage",num(intelligence.evidenceCoverage,"%")),"Higher score means lower observed risk. Incomplete evidence cannot establish safety."],true);
    add("Token",[joined(token.symbol,token.name),row("Contract",token.address||data.address),row("Liquidity",usd(token.liquidityUsd)),row("Market capitalization",usd(token.marketCapUsd)),row("Estimated holders",num(token.holdersEstimate)),row("Pair age",num(token.contractAgeDays," days")),typeof token.isVerified==="boolean"?(token.isVerified?"Source verified":"Source unverified"):""]);
    add("Provider market evidence",[text(provider.source),row("Provider score (separate from PULSE)",num(provider.score," / 100")),typeof provider.metadataVerified==="boolean"?(provider.metadataVerified?"Provider metadata verified; this is not a contract audit.":"Provider metadata not verified."):""]);
    add("Source coverage",items(data.sourceCoverage).map(item=>{const source=researchRecord(item);return joined(source.name,words(source.status),source.detail);}));
    list("Critical risks",intelligence.criticalRisks,true);list("Positive signals",intelligence.positiveSignals);list("Unknowns",intelligence.unknowns,true);
    add("Most likely loss scenario",[text(data.mostLikelyLossScenario)],true);
    add("Project and promotion",[row("Project / website",intelligence.projectAssessment),row("Social / promotion",intelligence.promotionAssessment)]);
    add("Checklist",items(data.checklist).map(item=>{const check=researchRecord(item);return joined(check.title,words(check.status),check.detail);}));
    list("Recommendations",data.recommendations,true);
    add("Evidence-backed risk breakdown",[row("Token score",num(token.riskScore," / 100")),row("Token verdict",words(token.verdict)),...strings(token.flags),...items(token.components).map(item=>{const component=researchRecord(item);return joined(component.label,row("Score",num(component.score)),component.reason);})]);
    list("Limitations",[...strings(data.limitations),...strings(token.limitations)],true);
  }
  const generatedAt = researchDate(data.generatedAt || context.createdAt);
  return {...identity,headline:text(a.headline||data.headline)||"PULSE research report",summary:text(a.summary||data.summary),...(generatedAt?{generatedAt}:{}),sections,disclaimer:text(a.disclaimer||data.disclaimer)||"Research only · not financial advice. Report levels and scenarios are conditional; verify current evidence before acting."};
}
export function researchText(presentation: ResearchPresentation): string {
  return ["PULSE research report",presentation.label,presentation.generatedAt||"","",presentation.headline,presentation.summary,"",...presentation.sections.flatMap(section=>[section.title.toUpperCase(),...section.lines.map(line=>`• ${line}`),""]),"DISCLAIMER",presentation.disclaimer].filter((line,index,lines)=>line||lines[index-1]!=="").join("\n").trim();
}
