import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { globalDecision, globalSetupAdmission, globalPriceBandText, globalPriceZonePayoff, globalSetupEvidenceLines, globalStrategyMixLines, globalTradeCards, type GlobalReport } from "@pulse/domain";
import type { GlobalLiveCandle } from "./globalLiveCandle";
import { GlobalMarketChart } from "./GlobalMarketChart";
import { createWalletPaidFetch, getInjectedProvider } from "./wallet";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";
import { terminalUsdAtomic } from "./terminalPricing";
import type { Lang } from "./i18n";
import type { PulseTab } from "./navigation";
import { terminalClockAnchor, terminalPassTime, type TerminalClockAnchor, type TerminalPassTime } from "./terminalAccessClock";
import {
  TERMINAL_FRAMES, TerminalApiError, authorizeTerminal, clearTerminalSession, terminalFrameRoles,
  terminalAskBinding, terminalExecutionTime, terminalFollowRestriction, terminalFollowReview, terminalFollowReviewMatches, terminalLabel, terminalPassPrice, terminalPrice, terminalReceiptComplete, terminalReceiptRequestId, terminalRequest, terminalSession, terminalUtc, terminalWorkspaceUpdate, terminalSetupReferences,
  type TerminalCatalog, type TerminalDuration, type TerminalEvent, type TerminalMarket, type TerminalPlan,
  type TerminalAskContext, type TerminalFollowReview, type TerminalPosition, type TerminalTimeframe, type TerminalToolStatus, type TerminalWorkspace,
} from "./terminalClient";
import { TerminalMarketSelector } from "./TerminalMarketSelector";
import { terminalCoverageLabel, terminalPricePrecision } from "./terminalTradeReading";
import { terminalMarketId } from "./terminalMarkets";
import { terminalAcceptLiveQuote, type TerminalLiveQuote } from "./terminalLiveQuote";
import { TerminalTelegramPanel } from "./TerminalTelegramPanel";
import { TerminalRadarPlanner, type TerminalRadarDraft } from "./TerminalRadarPlanner";
import { TerminalRadarProgress } from "./TerminalRadarProgress";
import { TerminalPositionForm } from "./TerminalPositionForm";
import { AskPulseButton } from "./AskPulseButton";
import { TerminalIndicatorMarket } from "./TerminalIndicatorMarket";
import type {TerminalChartIndicator} from "./terminalIndicatorChart";
import { TerminalRetainedMarketTools } from "./TerminalRetainedMarketTools";
import "./tradingTerminal.css";
import "./terminalExperience.css";

export type TradingTerminalWorkspaceProps = {
  networkKey: WebNetworkKey; wallet: string | null; lang?: Lang;
  onNavigate?: (tab: PulseTab) => void; onNeedWallet?: () => void;
};
type View = "market" | "tools" | "radar" | "creator" | "indicators" | "positions" | "activity";
const TERMINAL_SECTIONS:ReadonlyArray<{id:View;title:string;description:string}>=[{id:"market",title:"Trading Terminal",description:"Price chart, setup and applied indicators"},{id:"tools",title:"Market tools",description:"Value, flow, footprint and liquidity"},{id:"radar",title:"Market Radar",description:"Create and follow market-event sequences"},{id:"creator",title:"Create indicator",description:"Compile, preview and publish a formula"},{id:"indicators",title:"Indicator Market",description:"Discover, install and share indicators"},{id:"positions",title:"My open positions",description:"Record fills and monitor protection"},{id:"activity",title:"Alerts & activity",description:"Telegram, watches and your event log"}];
const frameName = (frame: string) => frame.replace("utc", "");
const messageOf = (error: unknown) => error instanceof Error ? error.message : "This request could not be completed. Retry when the connection returns.";
const errorIgnored = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const statusClass = (value: string) => /confirmed|completed|satisfied|available|active|sent/.test(value) && !/unavailable|inactive/.test(value) ? "positive" : /fail|invalid|expired|stale|reject/.test(value) ? "negative" : "waiting";
const freshId = () => crypto.randomUUID();

function SourceDetail({ source }: { source: TerminalToolStatus }) {
  return <details className="terminal-source"><summary>Source &amp; coverage <span className={`terminal-status ${statusClass(source.status)}`}>{terminalCoverageLabel(source)}</span></summary><dl>
    <div><dt>Source</dt><dd>{source.source}</dd></div>
    {source.units && <div><dt>Units</dt><dd>{source.units}</dd></div>}
    <div><dt>Window</dt><dd>{terminalUtc(source.windowStart)} → {terminalUtc(source.windowEnd)}</dd></div>
    <div><dt>Known at</dt><dd>{terminalUtc(source.knownAt)}</dd></div>
  </dl>{source.reason && <p>{source.reason}</p>}</details>;
}
function ToolUnavailable({ source }: { source: TerminalToolStatus }) {
  return <div className="terminal-empty"><strong>{terminalLabel(source.status)}</strong><p>{source.reason || "This measurement is not supplied by the current source."}</p><p>Missing observations remain unknown. They do not confirm or reject the setup.</p></div>;
}
function ToolMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="terminal-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function useTerminalPassTime(workspace: TerminalWorkspace | null): TerminalPassTime {
  const received = useRef<{ workspace: TerminalWorkspace | null; anchor: TerminalClockAnchor | null }>({ workspace: null, anchor: null });
  const [tick, setTick] = useState(() => performance.now());
  if (received.current.workspace !== workspace) {
    received.current = { workspace, anchor: workspace ? terminalClockAnchor(received.current.anchor, workspace, performance.now(), Date.now()) : null };
  }
  const time = terminalPassTime(workspace, received.current.anchor, Math.max(tick, received.current.anchor?.monotonicAt ?? 0));
  useEffect(() => {
    const update = () => setTick(performance.now()), timer = window.setInterval(update, 1000);
    const visible = () => { if (document.visibilityState === "visible") update(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    if (time.remainingMs === null || time.remainingMs <= 0 || time.remainingMs > 1000) return;
    const timer = window.setTimeout(() => setTick(performance.now()), time.remainingMs + 1);
    return () => window.clearTimeout(timer);
  }, [time.remainingMs]);
  return time;
}

function PassCountdown({ time, lang = "en" }: { time: TerminalPassTime; lang?: Lang }) {
  const zh = lang === "zh", duration = time.runningDuration;
  const running = duration ? zh ? `${duration === "24h" ? "24 小时" : duration === "7d" ? "7 天" : "30 天"}通行证` : `${duration === "24h" ? "24-hour" : duration === "7d" ? "7-day" : "30-day"} pass` : zh ? "已购买的访问权限" : "Purchased access";
  return <div className="terminal-access-countdown" data-terminal-pass-active={String(time.active)}><span>{zh ? "剩余访问时间" : "Access time left"}</span><strong role="timer" aria-live="off" aria-label={zh ? "通行证剩余时间" : "Terminal pass time remaining"} data-remaining-seconds={time.seconds ?? "unknown"}>{time.text}</strong><small>{time.remainingMs === 0 ? zh ? "通行证已到期" : "Pass expired" : running}{time.queuedRenewals > 0 && (zh ? ` · 包含 ${time.queuedRenewals} 次已购买续期的连续访问` : ` · continuous access includes ${time.queuedRenewals} queued renewal${time.queuedRenewals === 1 ? "" : "s"}`)}</small></div>;
}

function SetupCard({ report, onFollow, onAsk, canFollow }: { report: GlobalReport; onFollow: () => void; onAsk: (question: string) => void; canFollow: boolean }) {
  const card = globalTradeCards(report)[0], decision = globalDecision(report), references = terminalSetupReferences(report);
  const payoff = globalPriceZonePayoff(report), admission = globalSetupAdmission(report);
  const followRestriction = terminalFollowRestriction(report);
  return <section className="terminal-panel terminal-setup" aria-labelledby="terminal-setup-heading"><div className="terminal-section-heading"><div><span className="terminal-eyebrow">One plan · distinct entry conditions</span><h3 id="terminal-setup-heading">{card?.direction ? `${card.direction} plan` : "Conditional setup"} · {decision.marketView}</h3><p>{card?.state ?? decision.heading}</p><span className={`terminal-status ${admission.geometryEligible ? "waiting" : "negative"}`} data-setup-admission={admission.state}>{admission.geometryEligible ? "Conditional plan · entry review required" : "WAIT · this setup is not qualified"}</span></div><AskPulseButton onClick={() => onAsk("Why this side? Give supporting evidence, opposing evidence and what would change the view.")}>Why this side?</AskPulseButton></div>
    {card ? <>{!admission.geometryEligible && <div className="terminal-admission-warning" role="status"><b>Do not treat these targets as an entry signal.</b>{admission.reasons.map(reason=><p key={reason}>{reason}</p>)}<p>The saved plan remains visible for review. A new plan must satisfy its own entry, protection and nearest-obstacle rules.</p></div>}<div className="terminal-metrics"><ToolMetric label="Entry area" value={card.entry} /><ToolMetric label="Protection area" value={card.stop} note={references.hardStop === null ? "No fixed hard stop supplied" : `Fixed hard SL ${terminalPrice(references.hardStop, report.snapshot.pricePrecision)}`} /><ToolMetric label="First target" value={report.discretionaryPlan?.priceZones?.targets[0] ? globalPriceBandText(report, report.discretionaryPlan.priceZones.targets[0]) : card.targets[0] ? terminalPrice(card.targets[0].price, report.snapshot.pricePrecision) : "—"} note={payoff ? `Least-favorable fill: ${payoff.worstToTP1.toFixed(2)}R to TP1 / ${payoff.worstToObstacle.toFixed(2)}R to nearest obstacle` : undefined} /></div>
      <div className="terminal-next"><b>What must happen</b><p>{card.condition}</p></div>
      {report.discretionaryPlan?.barriers.length ? <p><b>Nearest opposing area:</b> {report.discretionaryPlan.barriers.slice(0, 3).map(barrier => `${frameName(barrier.timeframe)} ${terminalPrice(barrier.price, report.snapshot.pricePrecision)}`).join(" · ")}</p> : null}
      <p className="terminal-hint">This is a {frameName(report.snapshot.timeframe)} scenario. A higher-timeframe recovery plan and a shorter-timeframe pullback plan can point in opposite directions; each requires its own entry conditions and invalidation. Targets are conditional objectives.</p><div className="terminal-evidence"><div><h4>Selected setup evidence</h4>{references.lines.map((line, i) => <p key={i}>{line}</p>)}</div><div><h4>Primary trend &amp; opposing conditions</h4><p>{decision.marketView}. The selected setup response is assessed separately from the primary trend.</p><p>{decision.contextLine}</p><p>{decision.relationship}</p><p>{decision.changeView}</p>{payoff && payoff.worstToObstacle < 1 && <p className="terminal-warning">The nearest obstacle offers less than the full stop risk at the least-favorable fill. Distant targets do not remove that obstacle.</p>}</div></div>
      {globalSetupEvidenceLines(report).length > 0 && <details><summary>Full direction, source and risk notes</summary>{globalSetupEvidenceLines(report).map((line, i) => <p key={i}>{line}</p>)}</details>}
      {globalStrategyMixLines(report).length > 0 && <details><summary>Strategy mix and selection</summary>{globalStrategyMixLines(report).map((line, i) => <p key={i}>{line}</p>)}</details>}
      <div className="terminal-actions"><button type="button" className="terminal-primary" disabled={!canFollow || Boolean(followRestriction)} onClick={onFollow}>Follow this setup</button><AskPulseButton onClick={() => onAsk("Explain the Entry, fixed hard SL, target zones and nearest obstacle for this exact setup.")}>Explain Entry / SL / TP</AskPulseButton></div><p className="terminal-hint">{followRestriction ?? "Save this plan's conditions and receive state changes. Following does not place an order or record a fill."}</p>
    </> : <div className="terminal-empty"><p>{decision.reason}</p><p>{decision.nextCondition}</p></div>}
  </section>;
}

function ActivityList({ events, onOpen }: { events: TerminalEvent[]; onOpen?: (event: TerminalEvent) => void }) {
  return events.length ? <ol className="terminal-timeline">{events.map((event, i) => <li key={event.id ?? i}><div><span className={`terminal-status ${statusClass(event.kind)}`}>{terminalLabel(event.kind)}</span><time>{terminalUtc(event.at ?? event.createdAt)}</time></div><p>{event.message ?? event.reason ?? terminalLabel(event.kind)}</p>{event.sourceAt && <small>Market observation {terminalUtc(event.sourceAt)}</small>}{event.instId && <small>{event.instId}{event.timeframe ? ` · ${frameName(event.timeframe)}` : ""}</small>}{onOpen && <small>Telegram: {event.delivery || "No delivery recorded for this event"}</small>}{!onOpen && event.delivery && <small>Telegram: {event.delivery}</small>}{onOpen && event.subjectId && event.subjectId !== "telegram" && event.instId && <button type="button" className="terminal-event-open" onClick={() => onOpen(event)}>Open related item</button>}</li>)}</ol> : <div className="terminal-empty"><strong>Your activity starts here</strong><p>Follow a setup, create a Radar or record a position. This log will explain its changes and notification delivery.</p></div>;
}

export function TradingTerminalWorkspace(props: TradingTerminalWorkspaceProps) {
  return <TradingTerminalContent key={props.wallet?.toLowerCase() ?? "disconnected"} {...props} />;
}
function TradingTerminalContent({ wallet, networkKey, lang = "en", onNavigate, onNeedWallet }: TradingTerminalWorkspaceProps) {
  const [catalog, setCatalog] = useState<TerminalCatalog | null>(null);
  const [workspace, setWorkspace] = useState<TerminalWorkspace | null>(null);
  const [token, setToken] = useState(() => terminalSession(wallet)?.token ?? "");
  const [view, setView] = useState<View>(()=>{const requested=new URLSearchParams(location.search).get("terminalSection");return TERMINAL_SECTIONS.some(item=>item.id===requested)?requested as View:"market";});
  const [indicatorMarket,setIndicatorMarket]=useState<TerminalMarket|null>(null);
  const [chartIndicators,setChartIndicators]=useState<TerminalChartIndicator[]>([]);
  const updateIndicatorMarket=useCallback((value:TerminalMarket)=>setIndicatorMarket(value),[]);
  const openChart=useCallback(()=>{setView("market");const url=new URL(location.href);url.searchParams.set("terminalSection","market");history.replaceState(null,"",url);window.setTimeout(()=>{const chart=document.querySelector(".terminal-chart");chart?.scrollIntoView({block:"start",behavior:"smooth"});(chart?.querySelector(".terminal-chart-indicator-key button") as HTMLButtonElement|null)?.click();},200);},[]);
  const [instId, setInstId] = useState("BTC-USDT"), [marketInput, setMarketInput] = useState("BTC-USDT");
  const [timeframe, setTimeframe] = useState<TerminalTimeframe>("1H");
  const [currentCandle,setCurrentCandle] = useState<GlobalLiveCandle>();
  const [liveQuote, setLiveQuote] = useState<TerminalLiveQuote | null>(null), [quoteError, setQuoteError] = useState("");
  const quoteClock = useRef<number | null>(null);
  const [market, setMarket] = useState<TerminalMarket | null>(null), [marketError, setMarketError] = useState("");
  const [busy, setBusy] = useState(""), [marketBusy, setMarketBusy] = useState(false), [message, setMessage] = useState("");
  const [reviewPass, setReviewPass] = useState<TerminalPlan | null>(null), [reviewFollow, setReviewFollow] = useState<TerminalFollowReview | null>(null), [watchTelegram, setWatchTelegram] = useState(false), [showPasses, setShowPasses] = useState(false);
  const [radarOpen, setRadarOpen] = useState(false), [radarDetector, setRadarDetector] = useState("sweep_reclaim"), [radarBoundary, setRadarBoundary] = useState("");
  const [radarSide, setRadarSide] = useState<"above" | "below">("below"), [radarHours, setRadarHours] = useState("24"), [radarTelegram, setRadarTelegram] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false), [positionEdit, setPositionEdit] = useState<TerminalPosition | null>(null), [positionEventKind, setPositionEventKind] = useState<"add" | "close" | "protection">("close");
  const [aiOpen, setAiOpen] = useState(false), [question, setQuestion] = useState(""), [answers, setAnswers] = useState<Array<{ instId: string; timeframe: string; question: string; answer: string; sources: unknown[]; at: string; model?: string }>>([]);
  const [aiContext, setAiContext] = useState<TerminalAskContext>({});
  const [activityFilter, setActivityFilter] = useState("all");
  const [recoveryTransactions, setRecoveryTransactions] = useState<Record<string, string>>({});
  const [replay, setReplay] = useState<{ radarId: string; events: TerminalEvent[] } | null>(null);
  const deepLinkOpened=useRef("");
  useEffect(()=>{
    const subject=new URLSearchParams(window.location.search).get("subject");
    if(!workspace||!subject||!/^[-a-zA-Z0-9_]{1,160}$/.test(subject))return;
    const identity=workspace.owner+":"+subject;if(deepLinkOpened.current===identity)return;
    const position=workspace.positions.some(item=>item.id===subject),found=position||workspace.radars.some(item=>item.id===subject)||workspace.watches.some(item=>item.id===subject);
    if(!found)return;deepLinkOpened.current=identity;setView(position?"positions":"activity");
    const timer=window.setTimeout(()=>{const element=document.getElementById("terminal-subject-"+subject);if(!element)return;element.scrollIntoView({block:"center"});element.setAttribute("tabindex","-1");element.focus({preventScroll:true});},100);
    return()=>window.clearTimeout(timer);
  },[workspace?.owner,workspace?.revision]);
  const alive = useRef(true), abort = useRef(new AbortController()), marketGeneration = useRef(0), pendingMutation = useRef(false), currentView = useRef(view), journalRequests = useRef(new Map<string, string>());
  const radarRequests = useRef(new Map<string, { requestId: string; expiresAt: string }>());
  currentView.current = view;
  const passTime = useTerminalPassTime(workspace);
  quoteClock.current = passTime.now;
  const network = WEB_NETWORKS[networkKey], active = passTime.active, zh = lang === "zh";
  const paymentSupported = Boolean(catalog?.paymentNetworks?.some(item => item.key === networkKey));
  useEffect(() => { alive.current = true; const controller = new AbortController(); abort.current = controller; return () => { alive.current = false; controller.abort(); abort.current.abort(); }; }, []);
  useEffect(() => { setRadarHours(String(({ "15m": 6, "1H": 24, "4H": 120, "1Dutc": 720, "1Wutc": 2160 })[timeframe])); setRadarOpen(false); }, [timeframe]);
  useEffect(() => {
    if (!reviewPass && !reviewFollow && !positionEdit) return;
    const previous = document.activeElement as HTMLElement | null, dialog = document.querySelector<HTMLElement>(".trading-terminal [role='dialog']");
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']") ?? []);
    focusable()[0]?.focus(); const priorOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingMutation.current) { setReviewPass(null); setReviewFollow(null); setPositionEdit(null); }
      if (event.key !== "Tab") return; const items = focusable(); if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = priorOverflow; previous?.focus(); };
  }, [reviewPass, reviewFollow, positionEdit]);
  const receiveWorkspace = useCallback((data: TerminalWorkspace) => {
    if (!alive.current) return;
    if (typeof data?.owner !== "string" || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error("The private workspace response is incomplete. Retry opening your workspace.");
    setWorkspace(current => terminalWorkspaceUpdate(current, data, wallet));
  }, [wallet]);
  const lockWorkspace = useCallback(() => {
    abort.current.abort(); abort.current = new AbortController(); marketGeneration.current += 1;
    clearTerminalSession(); setToken(""); setWorkspace(null); setMarket(null); setAnswers([]);
    setAiOpen(false); setReplay(null); setReviewFollow(null); setRecordOpen(false); setPositionEdit(null);
  }, []);
  const request = useCallback(<T,>(path: string, method = "GET", body?: unknown) => terminalRequest<T>(path, { token, method, body, signal: abort.current.signal }), [token]);
  const syncWorkspace = useCallback(async (authorization = token, monitor = false) => {
    if (!authorization) return;
    const data = await terminalRequest<TerminalWorkspace>(monitor ? "refresh" : "workspace", { token: authorization, ...(monitor ? { method: "POST" } : {}), signal: abort.current.signal });
    receiveWorkspace(data);
  }, [token, receiveWorkspace]);
  const refreshCatalog = useCallback(async () => {
    const data = await terminalRequest<TerminalCatalog>("catalog", { signal: abort.current.signal });
    if (alive.current) setCatalog(data); return data;
  }, []);
  useEffect(() => { void refreshCatalog().catch(error => { if (alive.current && !errorIgnored(error)) setMessage(messageOf(error)); }); }, [refreshCatalog]);
  useEffect(() => {
    if (!token) return;
    const refresh = (monitor = active) => { if (document.visibilityState === "visible") void syncWorkspace(token, monitor).catch(error => {
      if (!alive.current || errorIgnored(error)) return;
      if (error instanceof TerminalApiError && error.status === 401) lockWorkspace();
      setMessage(messageOf(error));
    }); };
    const visible = () => refresh(false);
    refresh(); const timer = window.setInterval(() => refresh(), 30_000);
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [token, syncWorkspace, active, lockWorkspace]);
  useEffect(() => {
    setLiveQuote(previous => previous?.instId === instId ? previous : null); setQuoteError("");
    if (!token || !active) return;
    let cancelled = false, pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const quote = await terminalRequest<TerminalLiveQuote>("quote?instId=" + encodeURIComponent(instId), { token, signal: abort.current.signal });
        if (cancelled) return;
        const now = quoteClock.current ?? quote.observedAt;
        if (!terminalAcceptLiveQuote(null, quote, instId, now)) throw new Error("The current quote is unavailable or stale. Saved analysis prices are shown separately.");
        setLiveQuote(previous => terminalAcceptLiveQuote(previous, quote, instId, now)); setQuoteError("");
      } catch (error) { if (!cancelled && !errorIgnored(error)) setQuoteError(messageOf(error)); }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 10_000);
    const foreground = () => { void refresh(); }; document.addEventListener("visibilitychange", foreground);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", foreground); };
  }, [token, active, instId]);
  useEffect(()=>{
    setCurrentCandle(undefined);if(!token||!active)return;
    let cancelled=false,pending=false;
    const refresh=async()=>{if(pending||document.visibilityState!=="visible")return;pending=true;
      try{const value=await terminalRequest<GlobalLiveCandle>("live-candle?instId="+encodeURIComponent(instId)+"&timeframe="+encodeURIComponent(timeframe),{token,signal:abort.current.signal});
        if(!cancelled&&value.instId===instId&&value.timeframe===timeframe)setCurrentCandle(previous=>!previous||value.observedAt>=previous.observedAt?value:previous);
      }catch{/* Saved candles remain readable; never manufacture a forming OHLC. */}finally{pending=false;}};
    void refresh();const timer=window.setInterval(()=>void refresh(),5000);document.addEventListener("visibilitychange",refresh);
    return()=>{cancelled=true;window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[token,active,instId,timeframe]);
  const refreshMarket = useCallback(async (manual = false) => {
    if (!token || !active) return;
    const generation = ++marketGeneration.current;
    setMarketBusy(true); if (manual) setMarketError("");
    try {
      const data = await terminalRequest<TerminalMarket>(`market?instId=${encodeURIComponent(instId)}&timeframe=${encodeURIComponent(timeframe)}&lang=${lang}`, { token, signal: abort.current.signal });
      if (!alive.current || generation !== marketGeneration.current) return;
      if (data.instId !== instId || data.timeframe !== timeframe || !data.report?.candles?.length) throw new Error("Market evidence did not match the selected instrument and timeframe. Retry this view.");
      setMarket(data); setMarketError("");
    } catch (error) { if (alive.current && generation === marketGeneration.current && !errorIgnored(error)) setMarketError(messageOf(error)); }
    finally { if (alive.current && generation === marketGeneration.current) setMarketBusy(false); }
  }, [token, active, instId, timeframe, lang]);
  useEffect(() => {
    marketGeneration.current += 1; setMarket(null); setMarketError(""); setReviewFollow(null);
    if (!active || !token) { setMarketBusy(false); return; }
    void refreshMarket();
    const refresh = () => { if (document.visibilityState === "visible" && !["positions","activity"].includes(currentView.current)) void refreshMarket(); };
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.clearInterval(timer); marketGeneration.current += 1; };
  }, [token, active, instId, timeframe, lang]);
  async function run(name: string, operation: () => Promise<void>) {
    if (pendingMutation.current) return;
    pendingMutation.current = true; setBusy(name); setMessage("");
    try { await operation(); }
    catch (error) { if (alive.current && !errorIgnored(error)) { setMessage(messageOf(error)); if (error instanceof TerminalApiError && error.status === 401) lockWorkspace(); } }
    finally { pendingMutation.current = false; if (alive.current) setBusy(""); }
  }
  async function signIn(): Promise<string> {
    if (!wallet) { onNeedWallet?.(); throw new Error("Connect your wallet in the PULSE header, then open Terminal access."); }
    const provider = getInjectedProvider();
    if (!provider) throw new Error("Open PULSE in your wallet browser or connect a wallet that supports message signing.");
    const session = await authorizeTerminal(wallet, async text => {
      const accounts = await provider.request({ method: "eth_accounts" });
      if (!Array.isArray(accounts) || !accounts.some(account => String(account).toLowerCase() === wallet.toLowerCase())) throw new Error("The connected wallet changed. Reconnect the owner wallet before signing.");
      const signature = await provider.request({ method: "personal_sign", params: [text, wallet] });
      if (typeof signature !== "string") throw new Error("The wallet returned no Terminal authorization signature.");
      return signature;
    }, abort.current.signal);
    if (!alive.current) throw new DOMException("Canceled", "AbortError");
    setToken(session.token); await syncWorkspace(session.token); return session.token;
  }
  async function buyPass(plan: TerminalPlan) {
    if (!wallet) { onNeedWallet?.(); setReviewPass(null); return; }
    await run("purchase", async () => {
      const authorization = token || await signIn();
      const beforePurchase = await terminalRequest<TerminalWorkspace>("workspace", { token: authorization, signal: abort.current.signal });
      receiveWorkspace(beforePurchase);
      if (beforePurchase.pendingPurchases?.some(purchase => purchase.state !== "granted")) { setReviewPass(null); throw new Error("A previous payment needs recovery. Use Recover access below; do not approve another payment."); }
      const current = await refreshCatalog(), reviewed = current.plans.find(item => item.duration === plan.duration);
      if (!current.available || !reviewed) throw new Error(current.reason || "Terminal checkout is temporarily unavailable.");
      if (terminalUsdAtomic(reviewed.priceUsd) !== terminalUsdAtomic(plan.priceUsd)) { setReviewPass(reviewed); throw new Error("The published price changed. Review the updated amount before continuing."); }
      const paid = await createWalletPaidFetch(wallet, networkKey, { approvedAmounts: { [`/v1/terminal/pass/${plan.duration}`]: terminalUsdAtomic(plan.priceUsd) } });
      const requestId = terminalReceiptRequestId(wallet, networkKey, plan.duration, localStorage);
      try { await terminalRequest(`pass/${plan.duration}`, { token: authorization, method: "POST", body: { requestId }, fetcher: paid as typeof fetch, networkRoute: network.route, signal: abort.current.signal }); }
      catch (error) {
        try {
          const saved = await terminalRequest<TerminalWorkspace>("workspace", { token: authorization, signal: abort.current.signal });
          if (alive.current) { receiveWorkspace(saved); if (saved.pendingPurchases?.some(purchase => purchase.state !== "granted")) setReviewPass(null); }
        } catch { /* The same checkout identity is retained for later recovery. */ }
        if (error instanceof TerminalApiError && error.details?.transactionHash) setRecoveryTransactions(previous => ({ ...previous, [requestId]: error.details!.transactionHash! }));
        throw error;
      }
      await syncWorkspace(authorization);
      terminalReceiptComplete(wallet, networkKey, plan.duration, localStorage);
      setReviewPass(null); setShowPasses(false); setMessage("Your Terminal pass is recorded. The same wallet can recover access after reloading.");
    });
  }
  function ask(text: string, context: TerminalAskContext = {}) { setQuestion(text); setAiContext(terminalAskBinding(market?.instId === instId && market.timeframe === timeframe ? market : null, context)); setAiOpen(true); }
  async function submitQuestion(event: FormEvent) {
    event.preventDefault(); const text = question.trim(); if (!text || !active) return;
    await run("ask", async () => {
      const contextPosition = aiContext.positionId ? workspace?.positions.find(position => position.id === aiContext.positionId) : undefined;
      const askMarket = contextPosition?.instId ?? aiContext.instId ?? instId, askFrame = contextPosition?.timeframe ?? aiContext.timeframe ?? timeframe;
      const answer = await request<{ answer: string; sources: unknown[]; at: string; model?: string }>("ask", "POST", { instId: askMarket, timeframe: askFrame, question: text, ...aiContext });
      if (alive.current) { setAnswers(previous => [...previous, { instId: askMarket, timeframe: askFrame, question: text, ...answer }]); setQuestion(""); }
    });
  }
  async function followSetup() {
    if (!active) { setMessage("Your Terminal pass has expired. Renew access before following a setup."); return; }
    const reviewed = reviewFollow;
    if (!reviewed || !terminalFollowReviewMatches(reviewed, wallet, instId, timeframe)) { setReviewFollow(null); setMessage("The market or owner changed. Review the selected setup again before following."); return; }
    const restriction = terminalFollowRestriction(reviewed.report);
    if (restriction) { setMessage(restriction); return; }
    await run("follow", async () => {
      await request("watches", "POST", { instId: reviewed.instId, timeframe: reviewed.timeframe, setupVersionId: reviewed.setupVersionId, telegram: watchTelegram });
      await syncWorkspace(); setReviewFollow(null); setMessage("This exact setup is now followed. See its next required event in Alerts & activity."); setView("activity");
    });
  }
  async function createRadar(draft: TerminalRadarDraft) {
    if (!active) { setMessage("Your Terminal pass has expired. Renew access before starting a Radar."); return; }
    await run("radar", async () => {
      const { hours, ...rule } = draft;
      const key = JSON.stringify([instId, draft]), attempt = radarRequests.current.get(key) ?? { requestId: freshId(), expiresAt: new Date((quoteClock.current ?? Date.now()) + hours * 3_600_000).toISOString() };
      radarRequests.current.set(key, attempt);
      await request("radars", "POST", { instId, ...rule, ...attempt });
      await syncWorkspace(); radarRequests.current.delete(key); setRadarOpen(false); setView("activity"); setMessage("Radar is active. Its card shows each completed stage, the next candle check and Telegram status.");
    });
  }
  async function recordPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!active) { setMessage("Your Terminal pass has expired. Renew access before saving a journal event."); return; }
    const form = new FormData(event.currentTarget), quantity = Number(form.get("quantity")), price = Number(form.get("price")), hardStop = String(form.get("hardStop") ?? "").trim();
    const targets = form.getAll("target").map(value => String(value).trim()).filter(Boolean).map(Number);
    let executed: string; try { executed = terminalExecutionTime(String(form.get("executedAt") ?? "")); } catch (error) { setMessage(messageOf(error)); return; }
    if (!(quantity > 0 && price > 0) || targets.some(value => !Number.isFinite(value) || value <= 0) || hardStop && !(Number(hardStop) > 0)) { setMessage("Enter a positive actual quantity and fill price, valid time and positive protection references."); return; }
    const body = { instId: String(form.get("instId")).trim().toUpperCase(), timeframe, side: form.get("side"), instrumentType: form.get("instrumentType"), quantity, price, executedAt: executed, venue: String(form.get("venue") ?? "").trim() || undefined, ...(hardStop ? { hardStop: Number(hardStop) } : {}), ...(targets.length ? { targets } : {}) };
    const key = JSON.stringify(["position", body]), requestId = journalRequests.current.get(key) ?? freshId(); journalRequests.current.set(key, requestId);
    await run("record", async () => {
      const updated = await request<TerminalWorkspace>("positions", "POST", { ...body, requestId });
      journalRequests.current.delete(key);
      receiveWorkspace(updated); setRecordOpen(false); setMessage("Your manual fill is recorded. Protection references are journal records; exchange-order verification is separate.");
    });
  }
  async function savePositionEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!positionEdit) return;
    if (!active) { setMessage("Your Terminal pass has expired. Renew access before saving a journal event."); return; }
    const form = new FormData(event.currentTarget), hardStop = String(form.get("hardStop") ?? "").trim(), targets = String(form.get("targets") ?? "").split(",").map(value => value.trim()).filter(Boolean).map(Number);
    let executed: string; try { executed = terminalExecutionTime(String(form.get("executedAt") ?? "")); } catch (error) { setMessage(messageOf(error)); return; }
    if (targets.some(value => !Number.isFinite(value) || value <= 0) || hardStop && !(Number(hardStop) > 0) || positionEventKind !== "protection" && !(Number(form.get("quantity")) > 0 && Number(form.get("price")) > 0)) { setMessage("Enter valid positive fill/protection values."); return; }
    const values = { kind: positionEventKind, executedAt: executed, ...(positionEventKind === "protection" ? { hardStop: hardStop ? Number(hardStop) : null, targets } : { quantity: Number(form.get("quantity")), price: Number(form.get("price")) }) };
    const key = JSON.stringify([positionEdit.id, values]), requestId = journalRequests.current.get(key) ?? freshId(); journalRequests.current.set(key, requestId);
    await run("position-event", async () => { const updated = await request<TerminalWorkspace>(`positions/${encodeURIComponent(positionEdit.id)}/events`, "POST", { ...values, requestId }); journalRequests.current.delete(key); receiveWorkspace(updated); setPositionEdit(null); setMessage("Position history updated. No exchange order was sent."); });
  }
  async function pause(kind: "watches" | "radars" | "positions", id: string, paused: boolean) {
    await run(id, async () => { await request(`${kind}/${encodeURIComponent(id)}`, "PATCH", { paused }); await syncWorkspace(); });
  }
  async function notifications(kind: "watches" | "radars" | "positions", id: string, enabled: boolean) {
    await run(id, async () => { await request(`${kind}/${encodeURIComponent(id)}`, "PATCH", { telegram: enabled }); await syncWorkspace(); });
  }
  async function includeAllTelegram() {
    if (!workspace?.telegram.linked || !active) return;
    await run("telegram-items", async () => {
      try {
        for (const [kind, items] of [["watches", workspace.watches], ["radars", workspace.radars], ["positions", workspace.positions]] as const) for (const item of items) {
          if (item.telegram || item.paused || ["completed", "expired", "invalidated", "entry_observed", "failed", "closed"].includes(String(item.state ?? item.status ?? ""))) continue;
          await request(kind + "/" + encodeURIComponent(item.id), "PATCH", { telegram: true });
        }
        setMessage("All current active watches and positions are included. Use the main Telegram switch to enable or pause delivery.");
      } finally { await syncWorkspace(); }
    });
  }
  function openActivitySubject(event: TerminalEvent) {
    const id = event.subjectId ?? event.positionId ?? event.radarId ?? event.watchId;
    if (!id) return;
    setView(workspace?.positions.some(position => position.id === id) ? "positions" : "activity");
    window.setTimeout(() => document.getElementById("terminal-subject-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
  }
  async function inspectReplay(radarId: string) {
    await run(`replay:${radarId}`, async () => {
      const result = await request<{ historical: boolean; events: TerminalEvent[]; notificationsSent: boolean }>(`radars/${encodeURIComponent(radarId)}/replay`);
      if (!result.historical || result.notificationsSent) throw new Error("This retained sequence could not be verified as historical inspection.");
      setReplay({ radarId, events: result.events });
    });
  }
  async function recoverPurchase(requestId: string) {
    const transactionHash = (recoveryTransactions[requestId] ?? workspace?.pendingPurchases?.find(purchase => purchase.requestId === requestId)?.settlementTx)?.trim();
    if (transactionHash && !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) { setMessage("Enter the exact settlement transaction hash, or leave it blank when the service already confirmed settlement."); return; }
    await run(`recover:${requestId}`, async () => {
      await request("pass/recover", "POST", { requestId, ...(transactionHash ? { transactionHash } : {}) });
      await syncWorkspace(); setMessage("The existing payment has been recovered. No new payment was requested.");
    });
  }
  function chooseMarket(value: string) {
    const market = terminalMarketId(value);
    if (!market) { setMessage("Choose a listed market or enter an exact pair such as BTC-USDT. Zcash uses ZEC."); return; }
    setMarketInput(market); setInstId(market);
  }
  const selectedMarket = market?.instId === instId && market.timeframe === timeframe ? market : null;
  const currentQuote = liveQuote?.instId === instId && passTime.now !== null && passTime.now - liveQuote.ts <= 30000 && liveQuote.ts <= passTime.now + 5000 ? liveQuote : undefined;
  const roles = terminalFrameRoles[timeframe];
  const selectedCard = selectedMarket ? globalTradeCards(selectedMarket.report)[0] : null;
  const reviewedFollow = reviewFollow && terminalFollowReviewMatches(reviewFollow, wallet, instId, timeframe) ? reviewFollow : null;
  const reviewedFollowCard = reviewedFollow ? globalTradeCards(reviewedFollow.report)[0] : null;
  const reviewedFollowRestriction = reviewedFollow ? terminalFollowRestriction(reviewedFollow.report) : null;
  const activity = (workspace?.activity ?? []).map(event => ({ ...event, delivery: workspace?.deliveries?.filter(delivery => delivery.eventId === event.id).map(delivery => terminalLabel(delivery.state)).join(", ") || undefined }));
  const watches = (workspace?.watches ?? []).map(watch => ({ ...watch, events: activity.filter(event => event.subjectId === watch.id) }));
  const radars = (workspace?.radars ?? []).map(radar => {
    const component = radar.snapshot?.tapeout;
    return { ...radar, stage: radar.snapshot?.stage ?? radar.stage, events: radar.snapshot?.events ?? radar.events, provenance: component ? { version: component.version, chainId: component.chainId, processor: component.processor, circuitId: component.circuitId, blockNumber: component.blockNumber, blockHash: component.blockHash, codeHash: component.codeHash } : radar.provenance };
  });
  const positions = (workspace?.positions ?? []).slice().sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const events = activity.filter(event => activityFilter === "all" || activityFilter === "market" && event.instId === instId || activityFilter === "positions" && (Boolean(event.positionId) || positions.some(position => position.id === event.subjectId)) || activityFilter === "telegram" && (Boolean(event.delivery) || /telegram|notification|delivery/.test(event.kind))).slice().reverse();
  const aiPosition = aiContext.positionId ? positions.find(position => position.id === aiContext.positionId) : undefined;
  const aiInstId = aiPosition?.instId ?? aiContext.instId ?? instId, aiTimeframe = aiPosition?.timeframe ?? aiContext.timeframe ?? timeframe;
  const conversation = [...new Map([...(workspace?.answers ?? []), ...answers].filter(answer => answer.instId === aiInstId && answer.timeframe === aiTimeframe).map(answer => [`${answer.at}:${answer.question}`, answer])).values()];
  const pendingPurchases = workspace?.pendingPurchases?.filter(purchase => purchase.state !== "granted") ?? [];
  const defaultUtc = new Date(passTime.now ?? Date.now()).toISOString().slice(0, 23);
  return <div className="trading-terminal" data-no-localize>
    <header className="terminal-page-heading"><div><span className="terminal-eyebrow">Research · follow · monitor</span><h1>{zh ? "交易终端" : "Trading Terminal"}</h1><p>Understand the market. Follow the conditions. Keep your positions in view.</p></div><div className="terminal-access"><span className={`terminal-status ${active ? "positive" : "waiting"}`}>{active ? `Pass active until ${terminalUtc(workspace?.access.expiresAt)}` : token ? "No active Terminal pass" : "Wallet-owned workspace"}</span>{workspace?.access.expiresAt && <PassCountdown time={passTime} lang={lang} />}{wallet && <button type="button" disabled={Boolean(busy)} onClick={() => void run("sync", async () => { if (!token) await signIn(); else await syncWorkspace(); })}>{busy === "sync" ? "Opening…" : token ? "Sync workspace" : "Open my workspace"}</button>}{active && <button type="button" onClick={() => setShowPasses(value => !value)}>{showPasses ? "Hide pass options" : "Extend pass"}</button>}{!wallet && <button type="button" className="terminal-primary" onClick={onNeedWallet}>Connect wallet</button>}</div></header>
    {message && <div className="terminal-notice" role="status"><span>{message}</span><button type="button" aria-label="Dismiss message" onClick={() => setMessage("")}>×</button></div>}
    {catalog && !catalog.enabled && <div className="terminal-notice">Trading Terminal is not enabled on this service. Saved Global reports and existing trading workspaces remain available.</div>}
    {pendingPurchases.length > 0 && <section className="terminal-panel" aria-labelledby="terminal-recover-heading"><h2 id="terminal-recover-heading">Recover your existing payment</h2><p>A payment is awaiting reconciliation. Do not purchase again. Recover the saved request so the service can verify its exact original terms.</p>{pendingPurchases.map(purchase => <article className="terminal-watch" key={purchase.requestId}><h3>{purchase.duration} · {purchase.priceUsd} · {purchase.network}</h3><p>Status: {terminalLabel(purchase.state)} · started {terminalUtc(purchase.createdAt)}</p><label className="terminal-field">Settlement transaction hash{purchase.state === "authorizing" ? " · if acknowledgement was lost" : " · optional"}<input aria-label={`Settlement transaction hash ${purchase.duration}`} value={recoveryTransactions[purchase.requestId] ?? purchase.settlementTx ?? ""} placeholder="0x…" onChange={event => setRecoveryTransactions(previous => ({ ...previous, [purchase.requestId]: event.target.value }))} /></label><button type="button" className="terminal-primary" disabled={Boolean(busy)} onClick={() => void recoverPurchase(purchase.requestId)}>Recover access without a new payment</button><small>Request {purchase.requestId}</small></article>)}</section>}
    {(!active || showPasses) && <section className="terminal-panel terminal-introduction"><div className="terminal-section-heading"><div><span className="terminal-eyebrow">A separate workspace · no report purchase required</span><h2>From market evidence to a plan you can follow.</h2><p>Inspect value and executed flow, detect ordered events with Market Radar, and keep actual positions separate from conditional setups.</p></div></div><div className="terminal-feature-grid"><div><h3>Market tools</h3><p>VWAP, volume profile, footprint, executed buy/sell flow, positioning and current liquidity—with each source's coverage.</p></div><div><h3>Market Radar</h3><p>Track a sweep/reclaim, breakout acceptance or failure around your chosen boundary. Inspect each stage and what comes next.</p></div><div><h3>Your trading journal</h3><p>Record actual fills, inspect protection references and follow conditions. Optional Telegram alerts require your consent.</p></div></div>
      <div className="terminal-pass-plans" aria-label="Terminal access passes">{catalog?.plans.map(plan => <button type="button" key={plan.duration} className="terminal-pass-plan" disabled={!catalog.available || !paymentSupported || pendingPurchases.length > 0 || Boolean(busy)} onClick={() => setReviewPass(plan)}><b>{plan.duration === "24h" ? "24 hours" : plan.duration === "7d" ? "7 days" : "30 days"}</b><strong>${terminalPassPrice(plan.priceUsd)}</strong><span>Review pass · {network.payment.symbol}</span></button>) ?? <p>Loading published pass prices…</p>}</div>{catalog && !paymentSupported && <p className="terminal-warning">Choose a supported payment network in the existing header: {catalog.paymentNetworks?.map(item => `${item.key} · ${item.asset}`).join(", ") || "no payment routes currently listed"}.</p>}{catalog && !catalog.available && <p className="terminal-warning">{catalog.reason || "The service is not ready for checkout. No payment is requested."}</p>}{catalog?.limits && <details><summary>Included service limits</summary><dl>{Object.entries(catalog.limits).map(([key, value]) => <div key={key}><dt>{terminalLabel(key)}</dt><dd>{String(value)}</dd></div>)}</dl><p>These service limits are supplied with the current catalog. Source availability remains instrument-specific.</p></details>}<p className="terminal-hint">Prices come from the service catalog. Terminal and Autopilot passes are separate. On expiry your journal stays readable; a Terminal pass does not close trades or cancel exchange protection.</p></section>}
    <div className="terminal-workspace-shell"><nav className="terminal-workspace-nav" aria-label="Terminal views"><div className="terminal-nav-heading"><span className="terminal-eyebrow">Your trading workspace</span><strong>Trading Terminal</strong><small>One selected market. Dedicated tools.</small></div>{TERMINAL_SECTIONS.map((item,index)=><button type="button" aria-current={view===item.id?"page":undefined} key={item.id} onClick={()=>{setView(item.id);const url=new URL(location.href);url.searchParams.set("terminalSection",item.id);history.replaceState(null,"",url);}}><span className="terminal-nav-number">{String(index+1).padStart(2,"0")}</span><span><strong>{item.title}{item.id==="positions"&&positions.some(position=>position.status!=="closed")?` / ${positions.filter(position=>position.status!=="closed").length} open`:""}</strong><small>{item.description}</small></span><span aria-hidden="true">&rsaquo;</span></button>)}</nav><div className="terminal-workspace-content" id="terminal-workspace-content">

    <div className="terminal-market-pane" hidden={view === "positions" || view === "activity"}><section className="terminal-market-controls"><TerminalMarketSelector instId={instId} marketInput={marketInput} onInput={setMarketInput} onChoose={chooseMarket} disabled={Boolean(busy)} /><div><span className="terminal-field-label">Primary timeframe</span><div className="terminal-frames" role="group" aria-label="Primary timeframe">{TERMINAL_FRAMES.map(frame => <button type="button" key={frame} aria-pressed={timeframe === frame} onClick={() => setTimeframe(frame)}>{frameName(frame)}</button>)}</div></div><div className="terminal-frame-roles"><span>Execution <b>{roles.entry}</b></span><span>Context <b>{roles.context}</b></span><small>Value context: {roles.window} · UTC</small></div><button type="button" disabled={!active || marketBusy} onClick={() => void refreshMarket(true)}>{marketBusy ? "Checking sources…" : "Refresh evidence"}</button></section>
      {active && quoteError && <p className="terminal-hint" role="status">Current ticker: {quoteError}</p>}
      {marketError && <div className="terminal-notice terminal-error" role="alert"><p>{marketError}</p><button type="button" disabled={marketBusy} onClick={() => void refreshMarket(true)}>Retry market</button>{selectedMarket && <small>The displayed assessment is retained from {terminalUtc(selectedMarket.observedAt)}. New entry monitoring requires fresh evidence.</small>}</div>}
      {selectedMarket ? <><div className="terminal-market-clock"><strong>{instId} · {frameName(timeframe)}</strong><span>Assessment {terminalUtc(selectedMarket.observedAt)}</span><span><b>{currentQuote ? "Current quote" : "Saved quote at assessment"}</b> {terminalPrice(currentQuote?.price ?? selectedMarket.report.currentMarket?.quote?.price, terminalPricePrecision(currentQuote?.price ?? selectedMarket.report.currentMarket?.quote?.price))} · {terminalUtc(currentQuote?.ts ?? selectedMarket.report.currentMarket?.quote?.ts)}</span><span>Completed primary close {terminalPrice(selectedMarket.report.snapshot.price)}</span></div><div hidden={view!=="market"}><SetupCard report={selectedMarket.report} onFollow={() => { if (wallet) setReviewFollow(terminalFollowReview(selectedMarket, wallet)); }} onAsk={ask} canFollow={active && Boolean(selectedMarket.setupVersionId) && !busy && !marketBusy && !marketError} />
        <section className="global-chart-panel terminal-chart"><GlobalMarketChart report={selectedMarket.report} selectedPathId={selectedCard?.key ?? null} viewportIdentity={`terminal:${instId}:${timeframe}`} currentQuote={currentQuote} currentCandle={currentCandle} terminalIndicators={chartIndicators.filter(item=>item.instId===instId)} /></section></div>
        <div hidden={view!=="tools"}><TerminalRetainedMarketTools key={instId} onToolsChange={updateIndicatorMarket} token={token} active={active} market={selectedMarket} onAsk={ask} onRadar={(price, outside) => { setRadarBoundary(String(price)); setRadarSide(outside); setRadarDetector(outside === "below" ? "sweep_reclaim" : "breakout_acceptance"); setRadarOpen(true); setView("radar"); window.setTimeout(() => document.querySelector(".terminal-radar")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); }} /></div>
      </> : <section className="terminal-panel terminal-empty"><strong>{marketBusy ? `Loading ${instId} · ${frameName(timeframe)} evidence…` : active ? "Select a market to inspect" : "Market evidence opens with an active pass"}</strong><p>{active ? "Each timeframe uses its own structure, execution policy, value window and risk references." : "Your report purchases stay in Global Market. Terminal has its own market selection and ongoing workspace."}</p></section>}
      <section hidden={view!=="radar"} className="terminal-panel terminal-radar"><div className="terminal-section-heading"><div><span className="terminal-eyebrow">A market event · independent of a setup</span><h3>Market Radar</h3><p>Detect an ordered sequence around your level. See each stage, its timestamp, and the next required event.</p></div><button type="button" className="terminal-primary" disabled={!active || Boolean(busy)} onClick={() => { setRadarOpen(previous => !previous); if (!radarBoundary && selectedMarket) setRadarBoundary(String(selectedMarket.report.snapshot.price ?? "")); }}>Create Radar</button></div><div className="terminal-feature-grid"><div><h4>Sweep &amp; reclaim</h4><p>Move beyond a boundary → return inside → later hold. A wick alone does not finish the sequence.</p></div><div><h4>Breakout acceptance</h4><p>Completed break → later hold or retest. See acceptance separately from initial penetration.</p></div><div><h4>Breakout failure</h4><p>Break outside → return inside → later failed hold. Review its relevance to an existing position.</p></div></div>
        {radarOpen && <TerminalRadarPlanner key={timeframe + radarBoundary + radarDetector + radarSide} market={selectedMarket} initialFrame={timeframe} initialBoundary={radarBoundary} initialSide={radarSide} initialDetector={radarDetector} active={active} busy={Boolean(busy)} telegramLinked={Boolean(workspace?.telegram.linked)} telegramEnabled={Boolean(workspace?.telegram.enabled)} accessEndsAt={workspace?.access.expiresAt} serverNow={passTime.now} onCancel={() => setRadarOpen(false)} onCreate={draft => void createRadar(draft)} />}
        <details><summary>How event detection works</summary><p>PULSE supplies source measurements. Market Radar uses a versioned Tapeout/X Layer circuit component for the actual event logic and retains private stage history. Source gaps remain unknown; repeated polls do not create later confirmation. Open a Radar in Alerts &amp; activity to inspect its sequence and circuit provenance.</p></details>
      </section>
      {selectedMarket && view==="market" && <details className="terminal-panel"><summary>All source clocks and coverage</summary>{selectedMarket.sources.map(source => <SourceDetail key={source.id} source={source} />)}</details>}
      <TerminalIndicatorMarket assessmentMarket={selectedMarket} onOpenCreator={()=>{setView("creator");const url=new URL(location.href);url.searchParams.set("terminalSection","creator");history.replaceState(null,"",url);}} wallet={wallet} networkKey={networkKey} market={indicatorMarket?.instId===instId&&indicatorMarket.timeframe===timeframe?indicatorMarket:selectedMarket} token={token} active={active} onAsk={ask} section={view==="creator"?"creator":view==="indicators"?"indicators":"hidden"} onChartChange={setChartIndicators} onOpenChart={openChart}/>
    </div>
    {view === "positions" && <section className="terminal-panel"><div className="terminal-section-heading"><div><span className="terminal-eyebrow">Actual fills · separate from a setup</span><h2>My positions</h2><p>{positions.filter(position => position.status !== "closed").length} open · {positions.length} total journal records.</p><p>Your actual cost basis and recorded protection. A touched chart level is never a filled trade.</p></div><button type="button" className="terminal-primary" disabled={!active || Boolean(busy)} onClick={() => setRecordOpen(previous => !previous)}>Record position</button></div>
      {recordOpen && <TerminalPositionForm market={instId} serverNow={passTime.now} active={active} busy={Boolean(busy)} onSubmit={recordPosition} onCancel={() => setRecordOpen(false)} />}
      {positions.length ? <div className="terminal-position-list">{positions.map(position => <article className="terminal-position" id={`terminal-subject-${position.id}`} data-position-id={position.id} data-position-state={position.status ?? "open"} key={position.id}><div className="terminal-section-heading"><div><h3>{position.instId} · {position.side.toUpperCase()}</h3><span className="terminal-status">{position.verified ? "Source-confirmed fill" : "Manual journal"} · {terminalLabel(position.status ?? "open")}</span></div><small>{position.venue || "Venue not specified"}</small></div><div className="terminal-metrics"><ToolMetric label="Actual average entry" value={terminalPrice(position.averageEntry ?? position.price)} /><ToolMetric label="Remaining base quantity" value={terminalPrice(position.remainingQuantity ?? position.quantity, 8)} /><ToolMetric label="Recorded hard stop" value={terminalPrice(position.hardStop)} note="Journal reference · exchange status unverified" /><ToolMetric label="Gross realized journal result" value={position.realizedPnl === undefined ? "—" : `${terminalPrice(position.realizedPnl, 6)} ${position.pnlCurrency ?? position.instId.split("-").at(-1)}`} note="User-reported fills · funding and fees not supplied" /></div>{position.lastMark && <p className="terminal-hint">Current {terminalLabel(position.lastMark.kind)}: {terminalPrice(position.lastMark.price)} · {terminalUtc(position.lastMark.at)} · {position.lastMark.source}{!position.lastMark.venueMatches && " · differs from recorded venue"}. This reference does not verify your cost basis or exchange orders.</p>}{position.targets?.length ? <p>Recorded targets: {position.targets.map(target => terminalPrice(target)).join(" → ")}</p> : null}<div className="terminal-actions">{(["add", "close", "protection"] as const).map(kind => <button type="button" key={kind} disabled={!active || Boolean(busy) || position.status === "closed" && kind !== "protection"} onClick={() => { setPositionEdit(position); setPositionEventKind(kind); }}>{kind === "add" ? "Record another fill" : kind === "close" ? "Record partial / full close" : "Update journal protection"}</button>)}<AskPulseButton disabled={!active} onClick={() => ask(`Review my ${position.instId} ${position.side} position. Explain the available evidence and risks without claiming journal protection is an exchange order.`, { positionId: position.id })}>Review position</AskPulseButton></div><div className="terminal-actions"><button type="button" disabled={Boolean(busy) || !active && Boolean(position.paused)} onClick={() => void pause("positions", position.id, !position.paused)}>{position.paused ? "Resume monitoring" : "Pause monitoring"}</button><button type="button" disabled={Boolean(busy) || !workspace?.telegram.linked || !active && !position.telegram} onClick={() => void run(position.id, async () => { await request(`positions/${encodeURIComponent(position.id)}`, "PATCH", { telegram: !position.telegram }); await syncWorkspace(); })}>{position.telegram ? "Disable position Telegram" : "Enable position Telegram"}</button></div><details><summary>Recorded events</summary>{position.events?.map(event => <p key={event.id}>{terminalUtc(event.executedAt)} · {terminalLabel(event.kind)} · {terminalPrice(event.quantity, 8)} @ {terminalPrice(event.price)}</p>) ?? <p>Opened {terminalUtc(position.executedAt ?? position.createdAt)}</p>}</details></article>)}</div> : <div className="terminal-empty"><strong>{token ? "No positions recorded" : "Open your wallet workspace to view positions"}</strong><p>Record actual fills. Following a plan and completing Radar conditions never creates a position.</p></div>}
      <p className="terminal-hint">Verified source imports and signed execution appear only when supported by the service. No order is sent by this journal. Use existing Spot Trading or Autopilot for their separately reviewed execution workflows.</p>
    </section>}
    {view === "activity" && <><section className="terminal-panel"><div className="terminal-section-heading"><div><span className="terminal-eyebrow">Last event · next required event · expiry</span><h2>Followed setups &amp; Radar</h2><p>A saved watch keeps its original version. Completed, invalidated or expired plans are not revived by refreshing.</p></div><button type="button" disabled={!active || Boolean(busy)} onClick={() => void run("refresh-monitoring", () => syncWorkspace(token, true))}>Refresh conditions</button></div>{!watches.length && !radars.length && <div className="terminal-empty"><p>No conditions are being followed yet. Start from a setup or create an independent Market Radar.</p><button type="button" onClick={() => setView("market")}>Explore market</button></div>}
      <div className="terminal-watch-list">{watches.map(watch => <article className="terminal-watch" id={`terminal-subject-${watch.id}`} key={watch.id}><div className="terminal-section-heading"><div><h3>{watch.instId} · {frameName(watch.timeframe)} · Setup watch</h3><span className={`terminal-status ${statusClass(watch.state)}`}>{watch.paused ? "Paused" : terminalLabel(watch.state)}</span></div><button type="button" disabled={Boolean(busy) || !active && Boolean(watch.paused)} onClick={() => void pause("watches", watch.id, !watch.paused)}>{watch.paused ? "Resume" : "Pause"}</button></div><dl><div><dt>Last event</dt><dd>{watch.lastEvent ?? watch.reason ?? "Watching for the first eligible event."}</dd></div><div><dt>Next required event</dt><dd>{watch.nextEvent ?? "Inspect the saved entry conditions."}</dd></div><div><dt>Expires</dt><dd>{terminalUtc(watch.expiresAt)}</dd></div></dl><div className="terminal-actions"><button type="button" disabled={Boolean(busy) || !watch.telegram && (!active || !workspace?.telegram.linked)} onClick={() => void notifications("watches", watch.id, !watch.telegram)}>{watch.telegram ? "Disable watch Telegram" : "Enable watch Telegram"}</button></div><small>Telegram {watch.telegram ? "selected" : "off"}{watch.telegram && !workspace?.telegram.enabled ? " · global delivery is paused" : ""} · setup {watch.setupVersionId}</small>{watch.events?.length ? <details><summary>Observation history</summary><ActivityList events={watch.events} /></details> : null}</article>)}
      {radars.map(radar => <article className="terminal-watch terminal-radar-watch" id={`terminal-subject-${radar.id}`} key={radar.id}><div className="terminal-section-heading"><div><h3>{radar.instId} · {frameName(radar.timeframe)} · {terminalLabel(radar.detector)}</h3><span className={`terminal-status ${statusClass(radar.state)}`}>{radar.paused ? "Paused" : terminalLabel(radar.state)}</span></div><button type="button" disabled={Boolean(busy) || !active && Boolean(radar.paused)} onClick={() => void pause("radars", radar.id, !radar.paused)}>{radar.paused ? "Resume" : "Pause"}</button></div><TerminalRadarProgress radar={radar} /><div className="terminal-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void inspectReplay(radar.id)}>Inspect retained sequence</button><button type="button" disabled={Boolean(busy) || !radar.telegram && (!active || !workspace?.telegram.linked)} onClick={() => void notifications("radars", radar.id, !radar.telegram)}>{radar.telegram ? "Disable Radar Telegram" : "Enable Radar Telegram"}</button></div>{radar.telegram && !workspace?.telegram.enabled && <p className="terminal-hint">Telegram is selected for this Radar; global delivery is paused.</p>}{radar.events?.length ? <details><summary>Stages &amp; source observations</summary><ActivityList events={radar.events} /></details> : null}{radar.provenance && <details><summary>Circuit and source provenance</summary><dl>{Object.entries(radar.provenance).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => <div key={key}><dt>{terminalLabel(key)}</dt><dd>{String(value)}</dd></div>)}</dl></details>}</article>)}</div></section>
      <TerminalTelegramPanel workspace={workspace} active={active} busy={Boolean(busy)} onSync={() => void run("telegram-link", () => syncWorkspace())} onSave={(enabled, events) => void run("telegram", async () => { const updated = await request<TerminalWorkspace>("telegram", "POST", { enabled, events }); receiveWorkspace(updated); setMessage(enabled ? "Telegram notifications enabled for your linked wallet. Only included items and selected new events are sent." : "Telegram delivery paused. Monitoring continues."); })} onIncludeAll={() => void includeAllTelegram()} />
      <section className="terminal-panel"><div className="terminal-section-heading"><div><h3>Activity timeline</h3><p>Your monitoring log: what changed, which item it belongs to, and whether Telegram delivery was recorded.</p></div><label className="terminal-field">Show<select value={activityFilter} onChange={event => setActivityFilter(event.target.value)}><option value="all">All activity</option><option value="market">Selected market</option><option value="positions">Position records</option><option value="telegram">Telegram delivery</option></select></label></div><div className="terminal-activity-guide"><div><b>Market events</b><p>Setup conditions and Radar stages, with the source time. Open the item to see its next condition.</p></div><div><b>Position events</b><p>Your recorded fills and price touches at saved stop/target references. Price touches do not record a close.</p></div><div><b>Service &amp; Telegram</b><p>Pass changes, exact data issues and message delivery. Paused alerts do not stop monitoring.</p></div></div><ActivityList events={events} onOpen={openActivitySubject} /></section>
    </>}
    {replay && view === "activity" && <section className="terminal-panel terminal-replay"><div className="terminal-section-heading"><div><h3>Retained Radar sequence</h3><p>Historical inspection of saved observations. Opening this view sends no new signal or notification.</p></div><button type="button" onClick={() => setReplay(null)}>Close sequence</button></div><ActivityList events={replay.events} /></section>}
    </div></div>
    {active && catalog?.features?.ai !== false && <button type="button" className="terminal-ai-launch" aria-expanded={aiOpen} onClick={() => { if (aiOpen) setAiOpen(false); else ask(""); }}>✦ Ask PULSE</button>}
    {aiOpen && <aside className="terminal-ai-drawer" aria-labelledby="terminal-ai-title"><div className="terminal-section-heading"><div><span className="terminal-eyebrow">{aiInstId} · {frameName(aiTimeframe)}</span><h2 id="terminal-ai-title">Ask PULSE</h2></div><button type="button" aria-label="Close Ask PULSE" onClick={() => setAiOpen(false)}>×</button></div><p>Ask about source evidence, opposing conditions or a position. Numeric levels remain tied to the saved assessment. Model: {catalog?.aiModel ?? "reported with each answer"}.</p>{catalog?.features?.ai === false && <p className="terminal-warning">Contextual AI is not configured on this service. Deterministic tools and monitoring remain available.</p>}<div className="terminal-ai-answers" aria-live="polite">{conversation.map((answer, i) => <article key={i}><h3>{answer.question}</h3><p>{answer.answer}</p><small>{terminalUtc(answer.at)} ? {answer.model ?? "Model not recorded"}</small>{answer.sources?.length > 0 && <details><summary>Sources used</summary>{answer.sources.map((source, j) => <p key={j}>{typeof source === "string" ? source : JSON.stringify(source)}</p>)}</details>}</article>)}</div><form onSubmit={submitQuestion}><label htmlFor="terminal-question">Your question</label><textarea id="terminal-question" rows={3} maxLength={1500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="What supports this setup, and what contradicts it?" /><button type="submit" className="terminal-primary" disabled={!active || catalog?.features?.ai === false || question.trim().length < 3 || Boolean(busy)}>{busy === "ask" ? "Reviewing evidence…" : "Ask"}</button></form><small>AI explains available evidence. It cannot submit orders or silently change your conditions.</small></aside>}
    {reviewPass && <div className="terminal-modal-backdrop"><section className="terminal-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-pass-review"><h2 id="terminal-pass-review">Review Terminal pass</h2>{message && <p className="terminal-warning" role="alert">{message}</p>}<dl><div><dt>Duration</dt><dd>{reviewPass.duration}</dd></div><div><dt>Amount</dt><dd>{reviewPass.priceUsd} {network.payment.symbol}</dd></div><div><dt>Payment network</dt><dd>{network.label}</dd></div><div><dt>Owner</dt><dd>{wallet ?? "Connect your wallet first"}</dd></div></dl><p>Terminal is separate from Global reports and Autopilot. Review the wallet's exact payment request before approving.</p><p>Access expiry and receipt are recorded by the service. Renewals are explicit. Journal records remain readable after access expires.</p><div className="terminal-actions"><button type="button" className="terminal-primary" disabled={Boolean(busy) || !catalog?.available || !paymentSupported || pendingPurchases.length > 0} onClick={() => void buyPass(reviewPass)}>{busy === "purchase" ? "Waiting for wallet / service…" : wallet ? `Approve ${reviewPass.priceUsd} ${network.payment.symbol}` : "Connect wallet"}</button><button type="button" disabled={Boolean(busy)} onClick={() => setReviewPass(null)}>Cancel</button></div></section></div>}
    {reviewedFollow && <div className="terminal-modal-backdrop"><section className="terminal-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-follow-review"><h2 id="terminal-follow-review">Follow this exact setup</h2>{message && <p className="terminal-warning" role="alert">{message}</p>}{reviewedFollowRestriction && <p className="terminal-warning" role="status">{reviewedFollowRestriction}</p>}<p>{reviewedFollow.instId} · {frameName(reviewedFollow.timeframe)} · execution {terminalFrameRoles[reviewedFollow.timeframe as TerminalTimeframe].entry}</p><p><b>{reviewedFollowCard?.direction}</b> · Entry {reviewedFollowCard?.entry} · protection {reviewedFollowCard?.stop}</p><p>{reviewedFollowCard?.condition}</p><small>Reviewed assessment {terminalUtc(reviewedFollow.observedAt)} · setup {reviewedFollow.setupVersionId}. Market refreshes do not replace this reviewed version.</small><p>The service rechecks eligibility before saving. Old touches, expired plans and target-before-entry events cannot become a new entry. A completed confirmation outside the entry range still needs an eligible return.</p><label className="terminal-checkbox"><input type="checkbox" checked={watchTelegram} disabled={!workspace?.telegram.linked} onChange={event => setWatchTelegram(event.target.checked)} /> Telegram state changes{!workspace?.telegram.linked && " · link your recipient first"}</label>{watchTelegram && !workspace?.telegram.enabled && <p className="terminal-hint">Telegram delivery is currently paused. Enable it in Alerts &amp; activity after saving this watch.</p>}<div className="terminal-actions"><button type="button" className="terminal-primary" disabled={!active || Boolean(busy) || Boolean(reviewedFollowRestriction)} onClick={() => void followSetup()}>Start following</button><button type="button" disabled={Boolean(busy)} onClick={() => setReviewFollow(null)}>Cancel</button></div><small>This saves a condition watch. Record an actual trade separately.</small></section></div>}
    {positionEdit && <div className="terminal-modal-backdrop"><section className="terminal-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-position-edit"><h2 id="terminal-position-edit">{terminalLabel(positionEventKind)} · {positionEdit.instId}</h2>{message && <p className="terminal-warning" role="alert">{message}</p>}<form className="terminal-form" onSubmit={savePositionEvent}><div className="terminal-form-grid">{positionEventKind === "protection" ? <><label>Recorded hard stop<input type="number" name="hardStop" min="0" step="any" defaultValue={positionEdit.hardStop ?? undefined} /></label><label>Recorded targets<input name="targets" defaultValue={positionEdit.targets?.join(", ")} /></label></> : <><label>Base asset quantity<input type="number" name="quantity" min="0" step="any" max={positionEventKind === "close" ? positionEdit.remainingQuantity ?? positionEdit.quantity : undefined} required /></label><label>Actual fill price<input type="number" name="price" min="0" step="any" required /></label></>}<label>Time · UTC<input type="datetime-local" step="0.001" name="executedAt" required defaultValue={defaultUtc} /></label></div><p>Save a manual journal event in base-asset units. Convert linear contract counts first. This does not place, cancel or amend an exchange order.</p><div className="terminal-actions"><button type="submit" className="terminal-primary" disabled={!active || Boolean(busy)}>Save record</button><button type="button" onClick={() => setPositionEdit(null)} disabled={Boolean(busy)}>Cancel</button></div></form></section></div>}
    <footer className="terminal-footer"><p>Market evidence and journal monitoring · manual execution decisions remain yours.</p><a className="terminal-text-button" href="/docs#docs-trading-terminal">Trading Terminal guide</a>{token && <button type="button" className="terminal-text-button" onClick={lockWorkspace}>Lock private workspace</button>}</footer>
  </div>;
}

/** Portfolio shows only data already authorized in this tab. It never opens a signature prompt on mount. */
export function TerminalPortfolioCard({ wallet, onNavigate, onNeedWallet, lang = "en" }: TradingTerminalWorkspaceProps) {
  const [record, setState] = useState<TerminalWorkspace | null>(null), [error, setError] = useState("");
  const state = record?.owner.toLowerCase() === wallet?.toLowerCase() ? record : null;
  const passTime = useTerminalPassTime(state);
  useEffect(() => {
    setState(null); setError(""); const session = terminalSession(wallet); if (!session) return;
    const controller = new AbortController();
    const sync = () => { if (document.visibilityState === "visible") void terminalRequest<TerminalWorkspace>("workspace", { token: session.token, signal: controller.signal }).then(data => { if (!controller.signal.aborted && data.owner.toLowerCase() === wallet?.toLowerCase()) setState(current => terminalWorkspaceUpdate(current, data, wallet)); }).catch(reason => { if (!controller.signal.aborted) setError(messageOf(reason)); }); };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { controller.abort(); document.removeEventListener("visibilitychange", sync); };
  }, [wallet]);
  return <section className="terminal-portfolio-card"><div className="terminal-section-heading"><div><span className="terminal-eyebrow">Evidence · conditions · positions</span><h2>Trading Terminal</h2><p>Market tools, Radar events and your wallet-owned trading journal.</p></div><button type="button" className="terminal-primary" onClick={() => onNavigate?.("terminal")}>Open Terminal →</button></div><div className="terminal-metrics"><ToolMetric label="Terminal pass" value={state ? passTime.active ? "Active" : "Inactive" : "—"} note={state?.access.expiresAt ? `Until ${terminalUtc(state.access.expiresAt)}` : "Separate from Autopilot"} /><ToolMetric label="Open journal positions" value={state ? String(state.positions.filter(position => position.status !== "closed").length) : "—"} note={state ? `${state.positions.length} total journal records` : undefined} /><ToolMetric label="Saved setup / Radar watches" value={state ? String(state.watches.length + state.radars.length) : "—"} /></div>{state?.access.expiresAt && <PassCountdown time={passTime} lang={lang} />}{!state && <p className="terminal-hint">{error || (wallet ? "Open Terminal and authorize this wallet to recover its private journal and followed conditions." : "Connect your wallet to open its private Terminal workspace.")}</p>}{!wallet && <button type="button" onClick={onNeedWallet}>Connect wallet</button>}</section>;
}
