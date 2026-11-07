import { useEffect, useState } from "react";
import { API_BASE } from "./api";
import type { Lang } from "./i18n";
import { parseTerminalPlans, type TerminalPublishedPlan } from "./terminalPricing";
import "./terminalProduct.css";

export function useTerminalProductCatalog() {
  const [state, setState] = useState<{ status:"loading"|"ready"|"unavailable"; available:boolean; plans:TerminalPublishedPlan[] }>({status:"loading",available:false,plans:[]});
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    void fetch(`${API_BASE}/v1/terminal/catalog`, {signal:controller.signal,cache:"no-store",headers:{Accept:"application/json"}}).then(async response => {
      if (!response.ok) throw new Error("Catalog unavailable");
      const body = await response.json() as { enabled?:boolean; available?:boolean; plans?:unknown };
      const plans = parseTerminalPlans(body.plans);
      if (mounted) setState({status:plans.length===3?"ready":"unavailable",available:body.enabled===true&&body.available===true,plans});
    }).catch(() => {if(mounted)setState({status:"unavailable",available:false,plans:[]});}).finally(()=>window.clearTimeout(timer));
    return () => {mounted=false;controller.abort();window.clearTimeout(timer);};
  }, []);
  return state;
}

export function TerminalPassPrices({ lang="en" }: {lang?:Lang}) {
  const catalog = useTerminalProductCatalog();
  return <div className="terminal-published-prices" aria-label={lang==="zh"?"交易终端通行证价格":"Published Terminal pass prices"}>
    {catalog.status==="loading"?<p role="status">{lang==="zh"?"正在读取通行证价格…":"Loading current pass prices…"}</p>:catalog.status==="ready"?<>
      <dl>{catalog.plans.map(plan=><div key={plan.duration}><dt>{({"24h":lang==="zh"?"24 小时":"24 hours","7d":lang==="zh"?"7 天":"7 days","30d":lang==="zh"?"30 天":"30 days"})[plan.duration]}</dt><dd>{Number(plan.priceUsd).toLocaleString(lang==="zh"?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:6})}<small> USDT / USDC</small></dd></div>)}</dl>
      {!catalog.available&&<p role="status">{lang==="zh"?"显示已配置价格；当前暂不可购买。":"Configured prices shown; purchases are currently unavailable."}</p>}
    </>:<p>{lang==="zh"?"当前无法读取价格。请在终端中查看报价后再付款。":"Current prices are unavailable. Open Terminal to review its quote before paying."}</p>}
  </div>;
}

export function TerminalLandingSection({ href, guideHref }: {href:string;guideHref:string}) {
  return <section id="trading-terminal" className="landing-width landing-section landing-terminal" aria-labelledby="landing-terminal-title">
    <div className="landing-section-heading"><p className="landing-kicker">PULSE TRADING TERMINAL</p><h2 id="landing-terminal-title">Read the move.<br/><span>Follow your plan.</span></h2><p>Explore value, executed buy/sell flow, liquidity and portable indicators. Detect developing market events, follow setup conditions, and track your positions with Telegram alerts.</p></div>
    <div className="landing-terminal-services">
      <article><span>01 / MARKET TOOLS</span><h3>Read the session. Watch liquidity change.</h3><p>Choose a UTC session for volume profiles, VWAP, buy/sell flow and footprints. Inspect real bids and offers over time in the liquidity heatmap, with coverage and missing intervals visible. Add, create and share portable CVD and buyer-participation packages through PULSE Indicator Market.</p></article>
      <article><span>02 / MARKET RADAR</span><h3>Follow the response at your level.</h3><p>Start from a value-area edge or your own price. Follow the three candle stages and get Telegram updates naming the market, boundary, observed price and next required step.</p></article>
      <article><span>03 / POSITIONS & ALERTS</span><h3>Keep your trade in view.</h3><p>Add your entry and size in coins, position value or futures margin. Link your wallet to the PULSE bot and choose the changes you want to receive.</p></article>
    </div>
    <TerminalPassPrices/>
    <div className="landing-actions"><a className="landing-button primary" href={href}>Explore Trading Terminal <span aria-hidden>↗</span></a><a className="landing-text-link" href={guideHref}>See how it works <span aria-hidden>↗</span></a></div>
    <p className="landing-terminal-note">Terminal passes are separate from Global reports and Autopilot Entry Passes. See your remaining access in the app and renew when you choose; there is no automatic renewal. Following a setup records conditions; actual executions are recorded separately. Source coverage and supported payments are shown in Terminal.</p>
  </section>;
}

export function IndicatorMarketLandingSection({ href, createHref, guideHref }: {href:string;createHref:string;guideHref:string}) {
  return <section id="indicator-market" className="landing-width landing-section landing-indicator-market" aria-labelledby="landing-indicator-title">
    <div className="landing-section-heading"><p className="landing-kicker">PULSE INDICATOR MARKET</p><h2 id="landing-indicator-title">Your tools.<br/><span>Beyond one chart.</span></h2><p>Discover trading indicators, apply them in Trading Terminal, or create a calculation of your own. Share an open portable package that compatible applications can run with their own market data.</p></div>
    <div className="landing-indicator-layout">
      <div className="landing-indicator-preview" role="img" aria-label="Illustration: a price chart with a separate cumulative delta indicator pane, followed by export to a compatible application">
        <div><span>BTC / USDT</span><strong>Price + your installed indicator</strong><small>ILLUSTRATED WORKFLOW · NOT LIVE DATA</small></div>
        <svg viewBox="0 0 600 270" aria-hidden="true"><g className="indicator-preview-grid"><path d="M25 55H575M25 100H575M25 145H575M25 195H575M25 240H575"/></g><path className="indicator-preview-price" d="M25 125L58 112L92 120L126 78L160 90L194 65L228 72L262 50L296 80L330 68L364 102L398 90L432 118L466 94L500 83L534 57L575 68"/><path className="indicator-preview-divider" d="M25 160H575"/><path className="indicator-preview-series" d="M25 225L58 220L92 228L126 212L160 216L194 198L228 206L262 190L296 210L330 200L364 220L398 213L432 228L466 205L500 198L534 183L575 188"/><text x="25" y="183">CUMULATIVE EXECUTED DELTA</text></svg>
        <footer><span>One calculation</span><span>Export package → Compatible host</span></footer>
      </div>
      <div className="landing-indicator-features"><article><span>FOR TRADERS</span><h3>Add evidence to the chart.</h3><p>Install an execution-based indicator on the chart’s shared time axis. Compare its readings with price, with input windows, units and missing data visible.</p></article><article><span>FOR CREATORS</span><h3>Create. Preview. Publish.</h3><p>Write a supported formula, test its output and publish a free tool or paid managed service. The publishing wallet, version, price and deployment status stay visible.</p></article><article><span>BUILT WITH TAPEOUT</span><h3>Take the calculation with you.</h3><p>Export an inspectable numerical circuit for a compatible host. PULSE’s CVD, buyer-participation and weighted-flow circuits have verified X Layer registrations.</p></article></div>
    </div>
    <div className="landing-actions"><a className="landing-button primary" href={href}>Explore Indicator Market <span aria-hidden>↗</span></a><a className="landing-button" href={createHref}>Create an indicator <span aria-hidden>↗</span></a><a className="landing-text-link" href={guideHref}>See examples <span aria-hidden>↗</span></a></div>
    <p className="landing-terminal-note">Indicator Market lives inside Trading Terminal. Review pass access and any creator service price separately. Supported creator checkout uses USDT0 on X Layer or native USDC on Base and Arbitrum One when enabled. Open formulas remain inspectable. Check each listing’s inputs, coverage and verified X Layer deployment status.</p>
  </section>;
}
