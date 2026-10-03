import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";
import { AnalysisReport, PredictionAnalysisReport, SafetyPreflightReport } from "./Report";
import "./telegramExperience.css";

type TelegramApp = { initData: string; ready: () => void; expand: () => void; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void; openInvoice: (url: string, callback: (status: string) => void) => void; openLink: (url: string) => void; HapticFeedback?: { impactOccurred: (style: string) => void }; BackButton?: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void } };
const telegramApp = () => (window as unknown as { Telegram?: { WebApp?: TelegramApp } }).Telegram?.WebApp;
export const SERVICE_DESIGN = [
  { id: "global-quick", title: "Global Quick", stars: 10, label: "→ SPOT", icon: "globe", description: "A clear market view. Key levels, direction, and your next move.", detail: "Focused Global Market intelligence with support, resistance, invalidation and a Spot handoff.", kind: "global", tier: "QUICK" },
  { id: "risk-guard", title: "Risk Guard", stars: 15, label: "BEFORE YOU TRADE", icon: "shield", description: "Know the token. Check the risks before you commit.", detail: "Token contract, market, holder and project evidence. Choose the chain and exact contract address.", kind: "risk", tier: "GUARD" },
  { id: "prediction-quick", title: "Prediction Quick", stars: 10, label: "FIND YOUR EDGE", icon: "chart", description: "Read the probabilities. Understand what the market is pricing.", detail: "One selected prediction market, its probability evidence, fair value range and execution risks.", kind: "prediction", tier: "QUICK" },
  { id: "global-pro", title: "Global Pro", stars: 15, label: "→ SPOT", icon: "bolt", description: "Go deeper. Scenarios, wave structure, and a complete trade plan.", detail: "Deeper Global research, Elliott wave scenarios, invalidation, chart context and a Spot handoff.", kind: "global", tier: "PRO" },
  { id: "prediction-pro", title: "Prediction Pro", stars: 15, label: "THE BIGGER PICTURE", icon: "orbit", description: "More context. Stronger scenarios. A sharper prediction thesis.", detail: "Expanded prediction evidence and underlying Spot context when the selected question maps to a supported asset.", kind: "prediction", tier: "PRO" },
] as const;
type Service = { id: string; stars: number | null; enabled: boolean };
type Order = { id: string; serviceId: string; stars: number | null; source?: "wallet"; networkKey?: string; createdAt: number; status: string; hasReport: boolean };
type Result = { orderId: string; serviceId: string; status: string; source?: "wallet"; report?: Record<string, unknown> | null };
type BotStatus = { configured?: boolean; botUrl?: string | null; botUsername?: string | null };
function Icon({ name = "pulse" }: { name?: string }) {
  const paths: Record<string, React.ReactNode> = {
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5"/>, globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/></>,
    shield: <><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m8 12 3 3 5-6"/></>, chart: <><path d="M4 3v17h17M7 15l4-5 4 2 6-7"/><path d="M17 5h4v4"/></>,
    bolt: <path d="m14 2-9 12h6l-1 8 9-12h-6z"/>, orbit: <><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/><path d="M9 3c7-2 13 6 11 13M4 9c-2 7 5 13 11 12"/></>, library: <><path d="M4 5h4v15H4zM11 3h4v17h-4zM18 6l3-1 4 14-3 1z"/></>, wallet: <><path d="M20 8H4V5l13-2v5M4 8v12h17V8z"/><path d="M16 12h5v5h-5z"/></>, star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>,
  };
  return <svg viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.pulse}</svg>;
}
function Brand() { return <a className="tg-brand" href="/telegram"><span><Icon/></span>PULSE<small>TELEGRAM</small></a>; }
function useBotStatus(surface: "evm" | "ton" = "evm") {
  const [status, setStatus] = useState<BotStatus | null>(null);
  useEffect(() => { const controller = new AbortController(); void fetch(`${API_BASE}/v1/telegram/${surface === "ton" ? "ton/" : ""}status`, { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(setStatus).catch(() => {}); return () => controller.abort(); }, [surface]);
  return status;
}
function PhonePreview() {
  return <div className="tg-phone-wrap"><div className="tg-phone-halo"/><div className="tg-phone">
    <div className="tg-phone-top"><span>9:41</span><span>● ● ▰</span></div>
    <div className="tg-phone-bar"><span>‹</span><b>PULSE<small>@pulsemi_bot</small></b><span>•••</span></div>
    <div className="tg-phone-body">
      <div className="tg-phone-greeting"><span>YOUR MARKET COMPANION</span><b>Find your next<br/>move.</b><Icon name="orbit"/></div>
      <div className="tg-phone-wallet"><Icon name="star"/><div><b>Pay with Telegram Stars</b><small>Your report arrives in this chat</small></div><span>↗</span></div>
      <p className="tg-phone-caption">EXPLORE INTELLIGENCE <span>05 SERVICES</span></p>
      {SERVICE_DESIGN.slice(0,3).map(service => <div className="tg-phone-service" key={service.id}><span><Icon name={service.icon}/></span><div><b>{service.title}</b><small>{service.stars} STARS · {service.tier}</small></div><em>↗</em></div>)}
      <div className="tg-phone-pro"><Icon name="bolt"/><div><b>Global Pro · Prediction Pro</b><small>15 Stars per report</small></div><span>↗</span></div>
      <div className="tg-phone-miniapp"><Icon name="pulse"/><div><b>Open PULSE Mini App</b><small>TON research · TON Connect</small></div><span>↗</span></div>
      <div className="tg-phone-nav"><span className="active"><Icon name="library"/>My reports</span><span><Icon name="wallet"/>History wallet</span><span><Icon name="globe"/>Website</span></div>
    </div>
  </div><div className="tg-floating"><span>★</span><div><b>One bot. Your research, together.</b><small>Chat reports. TON Mini App. PULSE.</small></div></div></div>;
}
export function TelegramLanding() {
  const status = useBotStatus();
  const tonStatus = useBotStatus("ton");
  const tonBot = tonStatus?.configured && tonStatus.botUrl ? tonStatus.botUrl + "?startapp" : null;
  const bot = status?.configured && status.botUrl ? status.botUrl + "?start=pulse" : null;
  const website = "https://www.ai-pulse.tech";
  return <div className="tg-site">
    <header className="tg-site-header"><Brand/><nav><a href="#services">Services</a><a href="#telegram-modes">Chat & Mini App</a><a href={website}>PULSE website ↗</a></nav><a className="tg-button tg-button-small" href={bot || "#services"}>{bot ? "Open PULSE bot" : "Explore services"}<span>↗</span></a></header>
    <main>
      <section className="tg-hero"><div className="tg-hero-copy">
        <div className="tg-kicker"><i/> YOUR EDGE. NOW IN TELEGRAM.</div>
        <h1>The market<br/>moves fast.<br/><em>Keep your pulse.</em></h1>
        <p>Global intelligence. Prediction insights. Risk Guard.<br/>Five services in chat. Reports paid with Stars.<br/>One PULSE bot, with a TON Mini App built in.</p>
        <div className="tg-hero-actions"><a className="tg-button" href={bot || "#services"}>{bot ? "Open PULSE bot" : "Explore services"}<span>↗</span></a><a className="tg-text-link" href={tonBot || "/ton-miniapp"}>{tonBot ? "Open TON Mini App" : "Preview TON Mini App"} <span>↗</span></a></div>
        <div className="tg-hero-proof"><span><Icon name="star"/> From 10 Stars</span><span><Icon name="wallet"/> Persistent history wallet</span><span><Icon name="pulse"/> Reports in chat</span></div>
        <a className="tg-website-link" href={website}>Explore the full PULSE platform at www.ai-pulse.tech ↗</a>
        {status && !bot && <p className="tg-availability">Bot launch is unavailable right now. Explore the interface below.</p>}
      </div><PhonePreview/></section>
      <div className="tg-strip"><span>INTELLIGENCE → EXECUTION</span><b>GLOBAL MARKETS</b><i>✦</i><b>PREDICTION MARKETS</b><i>✦</i><b>RISK GUARD</b><i>✦</i><b>SPOT HANDOFF</b></div>
      <section className="tg-section" id="services">
        <div className="tg-section-heading"><div><span className="tg-kicker">THE PULSE TOOLKIT</span><h2>Five services.<br/><em>One clear next step.</em></h2></div><p>Start with a focused answer.<br/>Go Pro when you need the whole picture.</p></div>
        <div className="tg-service-grid">{SERVICE_DESIGN.map(service => <a href={bot ? status!.botUrl + "?start=" + service.id.replace(/-/g,"_") : "#how-it-works"} className={"tg-service-card" + (service.tier === "PRO" ? " pro" : "")} key={service.id}>
          <div className="tg-card-top"><span className="tg-icon-tile"><Icon name={service.icon}/></span><small>{service.tier}</small></div><span className="tg-card-label">{service.label}</span><h3>{service.title}</h3><p>{service.description}</p><div className="tg-card-bottom"><span><strong>★ {service.stars} Stars</strong> / REPORT</span><b>↗</b></div>
        </a>)}<div className="tg-service-note"><span>★</span><h3>A simpler way<br/>to get insight.</h3><p>One report. One Stars payment.<br/>A complete document in your chat.<br/>Return to My reports anytime.</p><a className="tg-text-link" href="#how-it-works">Understand the flow →</a></div></div>
      </section>
      <section className="tg-section tg-modes" id="telegram-modes">
        <span className="tg-kicker">ONE BOT. TWO WAYS TO EXPLORE.</span><h2>Your chat.<br/><em>Your Mini App.</em></h2>
        <div className="tg-mode-grid">
          <article className="tg-mode-card"><span className="tg-icon-tile"><Icon name="library"/></span><span className="tg-card-label">PULSE CHAT</span><h3>All five services, right here.</h3><p>Choose a service, send the market or token, and confirm the Stars invoice. Get a summary and the full report document in your private chat.</p><ul><li>Global Quick & Pro, Risk Guard, Prediction Quick & Pro</li><li>My reports includes your chat and Mini App purchases</li><li>Link your existing EVM history wallet once</li></ul><a className="tg-text-link" href={bot || "#services"}>{bot ? "Open PULSE chat" : "Explore chat services"} ↗</a></article>
          <article className="tg-mode-card tg-mode-ton"><span className="tg-icon-tile"><Icon name="pulse"/></span><span className="tg-card-label">PULSE TON MINI APP</span><h3>A focused TON workspace.</h3><p>Open the Mini App from this same bot. Explore TON-USDT with Global Quick or Pro, buy research with Stars, and connect a TON wallet with TON Connect.</p><ul><li>Global Quick · 10 Stars / Global Pro · 15 Stars</li><li>Optional TON wallet connection; Stars pay for reports</li><li>TON research library, with delivery to PULSE chat</li></ul><a className="tg-text-link" href={tonBot || "/ton-miniapp"}>{tonBot ? "Open TON Mini App" : "Preview TON Mini App"} ↗</a></article>
        </div>
      </section>
      <section className="tg-section tg-how" id="how-it-works"><span className="tg-kicker">BUILT FOR TELEGRAM</span><h2>Less setup.<br/><em>More signal.</em></h2><div className="tg-flow">{[["01","Open & explore","Start PULSE. Choose one of five services in chat, or open its TON Mini App."],["02","Choose & pay","Send the requested market or token input. Review the exact Stars price in Telegram checkout."],["03","Read & recover","Receive a summary and the full document in chat. Find your purchases in My reports on another Telegram device."],["04","Recover your history","Link your existing EVM wallet once to read your paid website history. The link stays until you change it."]].map(([n,title,copy]) => <article key={n}><span>{n}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
      <section className="tg-section tg-wallet-story"><div><span className="tg-icon-tile"><Icon name="wallet"/></span><span className="tg-kicker">A HISTORY WALLET THAT STAYS LINKED.</span><h2>One Telegram account.<br/><em>All your PULSE research.</em></h2><p>Verify your existing EVM wallet once in your browser, then confirm the exact address in PULSE chat. Your paid website and mobile wallet browser history stays linked until you explicitly change or unlink that wallet.</p><p>Closing Telegram or disconnecting your browser wallet keeps the association. Reading linked reports needs no transaction or chain switch. The TON wallet connection is managed separately inside the same bot's Mini App.</p><p className="tg-fine">Stars buy reports, not crypto or trading balances. A research purchase never authorizes a trade.</p></div><div className="tg-wallet-diagram"><div><Icon name="star"/><b>ONE PULSE ACCOUNT</b><span>Chat or TON Mini App → Stars → Chat report</span></div><span className="tg-diagram-arrow">↓ <small>MORE OF YOUR HISTORY</small></span><div><Icon name="wallet"/><b>EVM HISTORY WALLET</b><span>Prove ownership once → Confirm in chat → Read</span></div></div></section>
      <section className="tg-section tg-final-cta"><Icon/><span className="tg-kicker">THE NEXT MOVE IS YOURS</span><h2>Stay close to the market.</h2><a className="tg-button" href={bot || "#services"}>{bot ? "Open PULSE bot" : "Explore services"}<span>↗</span></a><a className="tg-text-link" href={website}>Discover the full PULSE platform ↗</a></section>
    </main>
    <footer className="tg-footer"><Brand/><p>Intelligence. Execution. Your control.<small>Research is not financial advice. Trading involves risk.</small></p><a href={website}>www.ai-pulse.tech ↗</a></footer>
  </div>;
}

function WalletLinkPanel({ signedIn, call, openBrowser, onLinked, onAssociation }: { signedIn: boolean; call: (path: string, body?: unknown) => Promise<any>; openBrowser: (token: string) => void; onLinked: () => void; onAssociation: (wallet: string) => void }) {
  const [association, setAssociation] = useState<{ wallet: string; linkedAt: string } | null>(null);
  const [pending, setPending] = useState<{ id: string; wallet?: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unlinkReview, setUnlinkReview] = useState(false);
  const walletRevision = useRef(0);
  useEffect(() => {
    if (!signedIn) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => { const revision=walletRevision.current; try { const data = await call("wallet"); if (active && revision===walletRevision.current) { setAssociation(data.association); setPending(data.pending); onAssociation(data.association?.wallet || ""); } } catch(reason) { if (active && revision===walletRevision.current) setError(reason instanceof Error ? reason.message : "Unable to check linked wallet"); } if (active) timer = setTimeout(refresh,4000); };
    void refresh(); return () => { active = false; clearTimeout(timer); };
  }, [signedIn]);
  const start = async () => { walletRevision.current += 1; setBusy(true); setError(""); try { const link = await call("wallet/link", {replaceWallet:Boolean(association)}); setPending({id:link.id,status:"issued"}); openBrowser(link.token); } catch(reason) { setError(reason instanceof Error ? reason.message : "Unable to start wallet link"); } finally { setBusy(false); } };
  const confirm = async () => { if(!pending) return; walletRevision.current += 1; setBusy(true); setError(""); try { const data = await call(`wallet/link/${pending.id}/confirm`,{}); setAssociation(data.association); onAssociation(data.association.wallet); setPending(null); onLinked(); } catch(reason) { setError(reason instanceof Error ? reason.message : "Wallet confirmation failed"); } finally { setBusy(false); } };
  const unlink = async () => { walletRevision.current += 1; setBusy(true); setError(""); try { await call("wallet/unlink",{}); setAssociation(null); onAssociation(""); setPending(null); setUnlinkReview(false); } catch(reason) { setError(reason instanceof Error ? reason.message : "Unlink failed"); } finally { setBusy(false); } };
  return <section className="tg-wallet-link-panel"><span className="tg-kicker">ONE ACCOUNT. ALL YOUR HISTORY.</span><h3>{association ? "Your wallet is linked ✓" : "Connect your existing PULSE history"}</h3><p>Link the wallet you use on the website or in your mobile wallet browser. Its paid reports will appear in My reports, alongside Stars purchases.</p>{error && <p role="alert" className="tg-mini-error">{error}</p>}{association && pending?.status === "signed" && pending.wallet && <div className="tg-report-handoff"><p>Confirm this replacement wallet. Your current association stays active until you confirm.</p><code>{pending.wallet}</code><button className="tg-button" disabled={busy} onClick={() => void confirm()}>Confirm new account wallet →</button></div>}{association ? <><code>{association.wallet}</code><p className="tg-fine">Saved to your Telegram account until you change or unlink it. Closing Telegram or disconnecting your browser wallet will not remove it. Every trade still needs wallet approval.</p>{unlinkReview ? <div><p>Unlinking removes this wallet’s history from Telegram. The original reports remain accessible through your wallet.</p><button className="tg-inline-button" disabled={busy} onClick={() => void unlink()}>Confirm unlink</button><button className="tg-inline-button" onClick={() => setUnlinkReview(false)}>Keep wallet linked</button></div> : <><button className="tg-inline-button" disabled={busy} onClick={() => void start()}>Change wallet</button><button className="tg-inline-button" onClick={() => setUnlinkReview(true)}>Unlink this wallet</button>{pending?.status === "issued" && <p className="tg-fine">Sign the replacement wallet in your browser, then return here to confirm. Your current wallet remains linked.</p>}</>}</> : pending?.status === "signed" && pending.wallet ? <><p>Ownership signature verified. Confirm this exact wallet for your Telegram account:</p><code>{pending.wallet}</code><button className="tg-button" disabled={busy} onClick={() => void confirm()}>Confirm wallet & sync reports →</button></> : <><button className="tg-button" disabled={busy || !signedIn} onClick={() => void start()}>{busy ? "Preparing secure link…" : pending ? "Restart link in browser ↗" : signedIn ? "Link wallet in browser ↗" : "Open in Telegram to link"}</button>{pending && <p className="tg-fine">Connect and sign in your browser, then return here to confirm. This link expires after 10 minutes.</p>}</>}</section>;
}

function useTelegramRuntime() {
  const [runtime, setRuntime] = useState<TelegramApp | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const initialize = () => { const app = telegramApp(); if (app?.initData) { app.ready(); app.expand(); app.setHeaderColor?.("#080f12"); app.setBackgroundColor?.("#080f12"); if (active) setRuntime(app); } if (active) setLoading(false); };
    let script = document.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]');
    const timer = setTimeout(initialize, 10000);
    if (telegramApp()) initialize();
    else { if (!script) { script = document.createElement("script"); script.src = "https://telegram.org/js/telegram-web-app.js"; script.async = true; document.head.append(script); } script.addEventListener("load", initialize); script.addEventListener("error", initialize); }
    return () => { active = false; clearTimeout(timer); script?.removeEventListener("load", initialize); script?.removeEventListener("error", initialize); };
  }, []);
  return { runtime, loading };
}
const readableStatus = (status: string) => ({ awaiting_payment: "Awaiting payment", payment_received: "Payment received", completed: "Ready to read", completed_partial: "Ready · partial evidence", failed_terminal: "Report failed · refund available", manual_reconciliation: "Needs review · refund available", refunded: "Refunded in Stars" }[status] || "Preparing your report");
export function TelegramMiniApp() {
  const params = new URLSearchParams(window.location.search);
  const { runtime, loading } = useTelegramRuntime();
  const bot = useBotStatus();
  const [view, setView] = useState(params.get("view") === "reports" ? "reports" : params.get("view") === "wallet" ? "wallet" : "explore");
  const [selected, setSelected] = useState(SERVICE_DESIGN.find(service => service.id === params.get("service"))?.id || "");
  const [services, setServices] = useState<Service[]>([]);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [name, setName] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [linkedWallet, setLinkedWallet] = useState("");
  const [market, setMarket] = useState("BTC-USDT");
  const [timeframe, setTimeframe] = useState("4H");
  const [prediction, setPrediction] = useState("");
  const [predictionQuery, setPredictionQuery] = useState("");
  const [predictionMarkets, setPredictionMarkets] = useState<Array<{ id: string; question: string; endDate?: string }>>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [token, setToken] = useState("");
  const [network, setNetwork] = useState("xlayer");
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeOrder, setActiveOrder] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pollRevision, setPollRevision] = useState(0);
  const service = SERVICE_DESIGN.find(item => item.id === selected);
  const price = services.find(item => item.id === selected);
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${API_BASE}/v1/telegram/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "PULSE-TELEGRAM-INIT-DATA": runtime?.initData || "" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", signal: AbortSignal.timeout(20000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "PULSE is temporarily unavailable. Please retry."); return data;
  };
  useEffect(() => { const controller = new AbortController(); void fetch(`${API_BASE}/v1/telegram/services`, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error("Service catalog unavailable"); return response.json(); }).then(data => { setServices(data.services || []); setCheckoutReady(Boolean(data.checkoutReady)); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }); return () => controller.abort(); }, []);
  useEffect(() => { if (!runtime) return; let active = true; void call("session").then(data => { if (active) { setName(data.user?.first_name || ""); setSignedIn(true); } }).catch(reason => { if (active) setError(reason.message); }); return () => { active = false; }; }, [runtime]);
  useEffect(() => { if(!signedIn) return; let active=true; void call("wallet").then(data => {if(active)setLinkedWallet(data.association?.wallet || "");}).catch(() => {}); return () => {active=false;}; },[signedIn,view]);
  useEffect(() => { if (!signedIn || view !== "reports") return; let active = true; void call("orders").then(data => { if (active) setOrders(data.orders); }).catch(reason => { if (active) setError(reason.message); }); return () => { active = false; }; }, [signedIn, view, activeOrder, result?.status]);
  useEffect(() => {
    if (!activeOrder || !signedIn) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const data = await call(`orders/${encodeURIComponent(activeOrder)}`) as Result; if (!active) return; setResult(data); setError(""); if (["completed", "completed_partial", "failed_terminal", "manual_reconciliation", "refunded"].includes(data.status)) return; } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Report status unavailable. Retry without paying again."); } if (active) timer = setTimeout(poll, 4000); };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [activeOrder, signedIn, pollRevision]);
  useEffect(() => { if (!runtime?.BackButton) return; const back = () => { setSelected(""); setActiveOrder(""); setResult(null); setView("explore"); }; if (selected || activeOrder || view !== "explore") runtime.BackButton.show(); else runtime.BackButton.hide(); runtime.BackButton.onClick(back); return () => runtime.BackButton?.offClick(back); }, [runtime, selected, activeOrder, view]);
  const buy = async () => {
    if (!runtime || !service || busy || !signedIn) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const input = service.kind === "global" ? { instId: market.trim().toUpperCase(), timeframe, lang: "en" } : service.kind === "prediction" ? { primaryMarketId: prediction.trim(), additionalMarketIds: [], lang: "en" } : { address: token.trim(), lang: "en" };
      const order = await call("orders", { serviceId: selected, input, networkKey: network });
      runtime.HapticFeedback?.impactOccurred("light");
      runtime.openInvoice(order.invoiceUrl, status => { setBusy(false); if (status === "cancelled" || status === "failed") { setNotice(status === "cancelled" ? "Checkout cancelled. No report was purchased." : "Payment could not be confirmed. Check My reports before retrying."); setView("reports"); setActiveOrder(order.orderId); return; } setNotice("Checking Telegram’s payment confirmation…"); setSelected(""); setView("reports"); setActiveOrder(order.orderId); });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Checkout failed"); setBusy(false); }
  };
  const browserLink = (path: string, pair?: string, share?: string, walletLink?: string) => {
    const origin = ["localhost", "127.0.0.1"].includes(window.location.hostname) ? window.location.origin : import.meta.env.VITE_APP_ORIGIN || "https://app.ai-pulse.tech";
    const url = new URL(path, origin); url.searchParams.set("source", "telegram-browser"); if (pair) url.searchParams.set("pair", pair);
    if(linkedWallet && ["/spot","/autopilot"].includes(path)) url.searchParams.set("expectedWallet",linkedWallet);
    if (share) url.hash = new URLSearchParams({ telegramReport: share }).toString();
    if (walletLink) url.hash = new URLSearchParams({ walletLink }).toString();
    if (runtime) runtime.openLink(url.href); else window.open(url.href, "_blank", "noopener,noreferrer");
  };
  const handoff = async () => { setBusy(true); setError(""); try { const data = await call(`orders/${activeOrder}/handoff`, {}); browserLink("/spot", String(result?.report?.instId || ""), data.shareToken); } catch(reason) { setError(reason instanceof Error ? reason.message : "Unable to open Spot context. Retry this report."); } finally { setBusy(false); } };
  const browseMarkets = async () => {
    setMarketLoading(true); setError("");
    try {
      const path = predictionQuery.trim() ? `/v1/polymarket/search?q=${encodeURIComponent(predictionQuery.trim())}&limit=30` : "/v1/polymarket/crypto?limit=30";
      const response = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(20000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Prediction markets are temporarily unavailable.");
      setPredictionMarkets((data.markets || []).filter((item: { endDate?: string }) => !item.endDate || Date.parse(item.endDate) > Date.now()));
    } catch(reason) { setError(reason instanceof Error ? reason.message : "Unable to load markets"); }
    finally { setMarketLoading(false); }
  };
  const refund = async () => { setBusy(true); setError(""); try { await call(`orders/${activeOrder}/refund`, {}); setResult(current => current ? { ...current, status: "refunded" } : current); setNotice("Your payment was refunded in Telegram Stars."); } catch(reason) { setError(reason instanceof Error ? reason.message : "Refund unavailable. Use /paysupport."); } finally { setBusy(false); } };
  const go = (next: string) => { setView(next); setSelected(""); setActiveOrder(""); setResult(null); setError(""); setNotice(""); };
  return <div className="tg-mini"><header className="tg-mini-header"><Brand/><span className="tg-mini-status"><i/>{signedIn ? "TELEGRAM CONNECTED" : "PREVIEW"}</span></header><main className="tg-mini-main">
    {!loading && !runtime && <div className="tg-mini-banner"><b>You’re exploring the Mini App preview.</b><span>Open from Telegram to sign in, buy with Stars, and recover reports.</span>{bot?.configured && bot.botUrl && <a href={`${bot.botUrl}?start=pulse`}>Open PULSE bot ↗</a>}</div>}
    {linkedWallet && <button className="tg-linked-account" onClick={() => go("wallet")}><Icon name="wallet"/><span>ACCOUNT WALLET<b>{linkedWallet.slice(0,6)}…{linkedWallet.slice(-4)}</b></span><small>Saved · Manage →</small></button>}{error && <div role="alert" className="tg-mini-error">{error}{activeOrder && <button onClick={() => setPollRevision(value => value+1)}>Retry this order</button>}</div>}{notice && <p role="status" className="tg-mini-notice">{notice}</p>}
    {view === "explore" && !service && <><div className="tg-mini-intro"><span className="tg-kicker">{name ? `WELCOME, ${name.toUpperCase()}` : "YOUR MARKET COMPANION"}</span><h1>Find your<br/><em>next move.</em></h1><p>Intelligence first. Execution on your terms.</p><Icon name="orbit"/></div><div className="tg-mini-stars"><span>★</span><div><b>Pay with Telegram Stars</b><p>All five research services. No wallet needed.</p></div></div><div className="tg-mini-section-title"><h2>Explore intelligence</h2><span>05 SERVICES</span></div><div className="tg-mini-services">{SERVICE_DESIGN.map(item => { const pricing = services.find(row => row.id === item.id); return <button key={item.id} className={`tg-mini-service ${item.tier === "PRO" ? "pro" : ""}`} onClick={() => { setSelected(item.id); setError(""); }}><span className="tg-icon-tile"><Icon name={item.icon}/></span><div><span className="tg-card-label">{item.label}</span><h3>{item.title}<small>{item.tier}</small></h3><p>{item.description}</p><span className="tg-mini-price">{pricing?.enabled && pricing.stars ? `★ ${pricing.stars} per report` : "Checkout coming soon"}</span></div><span>↗</span></button>; })}</div><div className="tg-mini-security"><Icon name="shield"/><p>Stars pay for intelligence.<br/>Only your wallet can approve a trade.</p></div></>}
    {view === "explore" && service && <section className="tg-checkout"><button className="tg-back" onClick={() => setSelected("")}>← All services</button><span className="tg-icon-tile"><Icon name={service.icon}/></span><span className="tg-kicker">{service.tier} INTELLIGENCE</span><h1>{service.title}</h1><p>{service.detail}</p><form onSubmit={event => { event.preventDefault(); void buy(); }}>
      {service.kind === "global" && <><label>Market pair<input required maxLength={32} pattern="[A-Za-z0-9]+-[A-Za-z0-9]+" value={market} onChange={event => setMarket(event.target.value)} placeholder="BTC-USDT" autoCapitalize="characters"/></label><label>Timeframe<select value={timeframe} onChange={event => setTimeframe(event.target.value)}>{["15m", "1H", "4H", "1D", "1W"].map(value => <option key={value}>{value}</option>)}</select></label></>}
      {service.kind === "prediction" && <div className="tg-prediction-picker"><label>Find a live prediction market<input value={predictionQuery} onChange={event => setPredictionQuery(event.target.value)} placeholder="Search BTC, ETH, SOL…" maxLength={128}/></label><button className="tg-inline-button" type="button" disabled={marketLoading} onClick={() => void browseMarkets()}>{marketLoading ? "Loading live questions…" : "Browse / search markets →"}</button><div className="tg-prediction-options">{predictionMarkets.map(item => <button type="button" key={item.id} className={prediction === item.id ? "selected" : ""} onClick={() => setPrediction(item.id)}><span>{item.question}</span><small>{prediction === item.id ? "Selected ✓" : "Select this market"}</small></button>)}</div><label>Selected market ID<input required maxLength={256} value={prediction} onChange={event => setPrediction(event.target.value)} placeholder="Select a question above or paste an ID"/><small>The report will analyze this exact question.</small></label></div>}
      {service.kind === "risk" && <><label>Network<select value={network} onChange={event => setNetwork(event.target.value)}><option value="xlayer">X Layer</option><option value="base">Base</option><option value="arbitrum">Arbitrum</option><option value="robinhood">Robinhood</option></select></label><label>Token contract address<input required pattern="0x[a-fA-F0-9]{40}" maxLength={42} value={token} onChange={event => setToken(event.target.value)} placeholder="0x…" autoCapitalize="none" spellCheck={false}/></label></>}
      <div className="tg-checkout-summary"><span>One {service.title} report</span><b>{price?.enabled && price.stars ? `★ ${price.stars}` : "Unavailable"}</b></div><p className="tg-fine">Review the price in Telegram’s checkout. This purchase includes research only. A failed report offers a Stars refund.</p><button className="tg-button" disabled={!signedIn || !checkoutReady || !price?.enabled || busy} type="submit">{busy ? "Opening checkout…" : !signedIn ? "Open in Telegram to buy" : !price?.enabled || !checkoutReady ? "Checkout unavailable" : `Pay ★ ${price.stars} & generate`}<span>↗</span></button>
    </form></section>}
    {view === "reports" && <section className="tg-mini-reports"><span className="tg-kicker">YOUR INTELLIGENCE LIBRARY</span><h1>My reports<span>.</span></h1><p>Same Telegram account. Any device. No second payment.</p>{!signedIn ? <div className="tg-empty"><Icon name="library"/><h3>Your reports will live here.</h3><p>Sign in by opening PULSE from Telegram.</p></div> : !activeOrder ? <>{!orders.length && <div className="tg-empty"><Icon name="library"/><h3>Your next insight starts here.</h3><p>Choose a service to create your first report.</p><button className="tg-button" onClick={() => go("explore")}>Explore services →</button></div>}{orders.map(order => <button className="tg-order-row" key={order.id} onClick={() => { setResult(null); setActiveOrder(order.id); }}><div><b>{SERVICE_DESIGN.find(item => item.id === order.serviceId)?.title || order.serviceId}</b><span>{readableStatus(order.status)}</span><small>{new Date(order.createdAt).toLocaleDateString()}</small></div><span>{order.source === "wallet" ? `${order.networkKey} · Wallet` : `★ ${order.stars}`} ↗</span></button>)}</> : <><button className="tg-back" onClick={() => { setActiveOrder(""); setResult(null); }}>← Report library</button><div className="tg-report-status"><Icon name={result?.report ? "shield" : "pulse"}/><b>{result ? readableStatus(result.status) : "Checking your order…"}</b><small>Order {activeOrder}</small></div>{result?.report ? <><div className="tg-mini-report-content">{result.serviceId === "risk-guard" ? <SafetyPreflightReport data={result.report}/> : result.serviceId.startsWith("prediction") ? <PredictionAnalysisReport data={result.report}/> : <AnalysisReport data={result.report} nfa="Research, not financial advice."/>}</div>{result.serviceId.startsWith("global") && <div className="tg-report-handoff"><h3>Your next step: Spot.</h3><p>Continue with {String(result.report.instId || "this market")} in your browser. Review the report’s levels and connect your wallet before placing an order.</p><button className="tg-button" disabled={busy} onClick={() => void handoff()}>Open Spot in browser ↗</button></div>}</> : result && ["failed_terminal", "manual_reconciliation"].includes(result.status) ? <div className="tg-empty"><h3>Your report could not be completed.</h3><p>{result.source === "wallet" ? "This report was paid onchain. Continue to your wallet report history to retry it without another payment." : "You can request your Stars back for this order."}</p><button className="tg-button" disabled={busy} onClick={() => result.source === "wallet" ? browserLink(result.serviceId.startsWith("prediction") ? "/prediction" : result.serviceId === "risk-guard" ? "/safety" : "/global") : void refund()}>{busy ? "Processing…" : result.source === "wallet" ? "Open wallet report recovery ↗" : "Refund this payment ★"}</button></div> : <p className="tg-fine">{result?.status === "awaiting_payment" ? "This invoice has not been confirmed as paid. Check Telegram’s payment receipt before trying another purchase." : result?.status === "refunded" ? "The Stars payment was refunded." : "Your order is saved. You can close the Mini App and return to My reports later."}</p>}</>}</section>}
    {view === "wallet" && <section className="tg-mini-wallet"><span className="tg-icon-tile"><Icon name="wallet"/></span><span className="tg-kicker">YOUR WALLET. YOUR CONTROL.</span><h1>Ready to<br/><em>make a move?</em></h1><p>Research stays in Telegram. Execution opens in your browser, where wallet connections work normally.</p><WalletLinkPanel signedIn={signedIn} call={call} onAssociation={setLinkedWallet} openBrowser={token => browserLink("/wallet-link", undefined, undefined, token)} onLinked={() => go("reports")}/><div className="tg-wallet-steps"><span>01 <b>Open your browser</b></span><span>02 <b>Connect your own wallet</b></span><span>03 <b>Review & sign your Spot order</b></span></div><button className="tg-button" onClick={() => browserLink("/spot")}>Open Spot in browser <span>↗</span></button><button className="tg-button tg-button-secondary" onClick={() => browserLink("/autopilot")}>Manage Autopilot ↗</button><p className="tg-fine">Stars cannot fund a trade. Wallet approval and trading balances are separate from research purchases.</p><div className="tg-mini-support"><h3>Payment support</h3><p>For failed reports, request a refund in My reports. For other issues, send /paysupport to the bot with your order ID.</p>{bot?.botUrl && <a href={`${bot.botUrl}?start=support`}>Open payment support ↗</a>}</div></section>}
  </main><nav className="tg-mini-nav" aria-label="Mini App navigation">{[["explore","globe","Explore"],["reports","library","Reports"],["wallet","wallet","Wallet"]].map(([next,icon,label]) => <button key={next} aria-current={view === next ? "page" : undefined} className={view === next ? "active" : ""} onClick={() => go(next)}><Icon name={icon}/><span>{label}</span></button>)}</nav></div>;
}
