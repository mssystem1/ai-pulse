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
    <div className="landing-section-heading"><p className="landing-kicker">PULSE TRADING TERMINAL</p><h2 id="landing-terminal-title">Read the move.<br/><span>Follow your plan.</span></h2><p>Explore value, executed buy/sell flow and liquidity. Detect developing market events, follow setup conditions, and track your positions with Telegram alerts.</p></div>
    <div className="landing-terminal-services">
      <article><span>01 / MARKET TOOLS</span><h3>Read the session. Watch liquidity change.</h3><p>Choose a UTC session for volume profiles, VWAP, buy/sell flow and footprints. Inspect real bids and offers over time in the liquidity heatmap, with coverage and missing intervals visible.</p></article>
      <article><span>02 / MARKET RADAR</span><h3>Follow the response at your level.</h3><p>Start from a value-area edge or your own price. Follow the three candle stages and get Telegram updates naming the market, boundary, observed price and next required step.</p></article>
      <article><span>03 / POSITIONS & ALERTS</span><h3>Keep your trade in view.</h3><p>Add your entry and size in coins, position value or futures margin. Link your wallet to the PULSE bot and choose the changes you want to receive.</p></article>
    </div>
    <TerminalPassPrices/>
    <div className="landing-actions"><a className="landing-button primary" href={href}>Explore Trading Terminal <span aria-hidden>↗</span></a><a className="landing-text-link" href={guideHref}>See how it works <span aria-hidden>↗</span></a></div>
    <p className="landing-terminal-note">Terminal passes are separate from Global reports and Autopilot Entry Passes. See your remaining access in the app and renew when you choose; there is no automatic renewal. Following a setup records conditions; actual executions are recorded separately. Source coverage and supported payments are shown in Terminal.</p>
  </section>;
}
