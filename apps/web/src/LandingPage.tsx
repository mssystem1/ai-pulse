import { useEffect, useState } from "react";
import { AppearancePicker } from "./AppearancePicker";
import { applyAppearance, readAppearance, type AppearanceId } from "./appearancePreference";
import { applicationLink } from "./siteRouting";
import { PublicActivityBreakdown, ResearchCount, usePublicActivity } from "./PublicActivity";
import { WEB_NETWORKS } from "./networks";
import "./landing.css";

function PulseMark() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" stroke="currentColor" opacity=".35"/><path d="M5 21h7l4-10 6 20 5-15 3 5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function SignalSculpture() {
  return <figure className="landing-sculpture" aria-label="PULSE connects market intelligence with wallet-approved Spot or independently configured Autopilot">
    <div className="sculpture-caption"><span className="landing-dot"/> MANY SIGNALS. YOUR DIRECTION.</div>
    <svg viewBox="0 0 600 440" role="img" aria-labelledby="signal-sculpture-title">
      <title id="signal-sculpture-title">Market signals enter PULSE. Spot requires wallet approval; Autopilot uses its own approved policy.</title>
      <defs><linearGradient id="signal-line"><stop stopColor="var(--mint)"/><stop offset="1" stopColor="var(--cyan)"/></linearGradient><radialGradient id="signal-glow"><stop stopColor="var(--mint)" stopOpacity=".18"/><stop offset="1" stopColor="var(--mint)" stopOpacity="0"/></radialGradient></defs>
      <circle cx="300" cy="205" r="170" fill="url(#signal-glow)"/>
      {[100,140,180].map(r=><ellipse key={r} cx="300" cy="205" rx={r} ry={r*.53} fill="none" stroke="currentColor" opacity=".12"/>)}
      <g className="signal-strands" fill="none" stroke="url(#signal-line)" strokeWidth="1.5">
        <path d="M20 125C130 125 130 205 248 205"/><path d="M20 205H248"/><path d="M20 285C130 285 130 205 248 205"/>
        <path d="M352 205C430 205 440 125 580 125"/><path d="M352 205C430 205 440 285 580 285"/>
      </g>
      <g fill="var(--landing-surface)" stroke="var(--mint)"><rect x="248" y="153" width="104" height="104" rx="29"/><circle cx="300" cy="205" r="39" opacity=".25"/></g>
      <path d="M268 207h14l8-22 13 40 10-30 7 12h14" fill="none" stroke="url(#signal-line)" strokeWidth="3" strokeLinejoin="round"/>
      <g fill="var(--mint)">{[[20,125],[20,205],[20,285],[580,125],[580,285]].map(([cx,cy])=><circle className="signal-node" key={`${cx}:${cy}`} cx={cx} cy={cy} r="4"/>)}</g>
      <g fill="currentColor" fontFamily="system-ui, sans-serif" fontSize="12"><text x="24" y="104">GLOBAL MARKETS</text><text x="24" y="184">TOKEN EVIDENCE</text><text x="24" y="316">PREDICTION MARKETS</text><text x="574" y="103" textAnchor="end">SPOT</text><text x="574" y="309" textAnchor="end">AUTOPILOT</text><text x="300" y="282" textAnchor="middle" letterSpacing="5">PULSE</text></g>
    </svg>
    <figcaption><span>Spot <b>You review & sign</b></span><span>Autopilot <b>Your rules. Autonomous execution.</b></span></figcaption>
  </figure>;
}

function ResearchIllustration({ service }: { service: number }) {
  return <svg className="landing-research-illustration" viewBox="0 0 320 100" role="img" aria-label={['Global research connects market context, scenarios and invalidation','Prediction research considers alternative outcomes to one question','Risk Guard separates observed evidence from missing information'][service]}>
    <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".3"><path d="M0 80H320M0 50H320M0 20H320"/></g>
    {service===0 ? <g fill="none" stroke="var(--mint)" strokeWidth="2"><path d="M10 62L47 42L83 54L121 25L158 46L196 36"/><path d="M196 36L242 17L305 17M196 36L242 66L305 66" strokeDasharray="4 5"/><circle cx="196" cy="36" r="5" fill="var(--landing-surface)"/></g> : service===1 ? <g fill="none" stroke="var(--mint)" strokeWidth="1.5"><rect x="14" y="30" width="66" height="40" rx="12"/><path d="M80 50H142C171 50 171 20 207 20H266M142 50C171 50 171 80 207 80H266"/><circle cx="282" cy="20" r="13"/><circle cx="282" cy="80" r="13"/><text x="47" y="57" textAnchor="middle" fill="currentColor" stroke="none" fontSize="22">?</text></g> : <g fill="none" stroke="var(--mint)" strokeWidth="1.5"><path d="M160 9L193 21V48C193 70 176 82 160 91C144 82 127 70 127 48V21Z"/><path d="M143 49L155 61L179 37"/><path d="M38 24H108M38 50H108M38 76H108M212 24H282M212 50H282M212 76H282" strokeDasharray="4 5"/><circle cx="24" cy="24" r="5"/><circle cx="24" cy="50" r="5"/><circle cx="24" cy="76" r="5"/><circle cx="296" cy="24" r="5"/><circle cx="296" cy="50" r="5"/><circle cx="296" cy="76" r="5"/></g>}
  </svg>;
}

const research = [
  { label: "Global Market", title: "A market view with a plan.", text: "Explore live markets, understand the setup, and review entry scenarios, targets and invalidation.", route: "/global", code: "01 / GLOBAL", points: ["Market & technical context", "Entry scenarios and invalidation", "Optional handoff to Spot"] },
  { label: "Prediction Market", title: "One question. A clearer perspective.", text: "Examine a live prediction question with evidence, scenarios and probability analysis. Research, not an automatic bet.", route: "/prediction", code: "02 / PREDICTION", points: ["One explicitly selected question", "Evidence and alternative scenarios", "Risks behind the probability"] },
  { label: "Risk Guard", title: "Look beneath the token.", text: "Inspect contract and market evidence before committing capital. Missing information stays visible—not disguised as safety.", route: "/safety", code: "03 / RISK GUARD", points: ["Market and contract evidence", "Source coverage and limitations", "Unknowns clearly identified"] },
];

export default function LandingPage() {
  const [theme, setTheme] = useState<AppearanceId>(() => { try { return readAppearance(localStorage); } catch { return readAppearance(); } });
  const [motion, setMotion] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [mode, setMode] = useState<"spot" | "autopilot">("spot");
  const activity = usePublicActivity();
  useEffect(() => { applyAppearance(theme); }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.pulseSurface = "landing";
    document.title = "PULSE — Read the market. Trade your way.";
    return () => { delete document.documentElement.dataset.pulseSurface; };
  }, []);
  const link = (path = "/portfolio") => applicationLink(window.location.href, path, theme, import.meta.env.VITE_APP_ORIGIN);
  return <div className="landing-page" data-motion={motion ? "on" : "off"}>
    <a className="landing-skip" href="#landing-main">Skip to content</a>
    <header className="landing-header">
      <a className="landing-brand" href="#" aria-label="PULSE home"><PulseMark/><span>PULSE</span></a>
      <nav aria-label="Public navigation"><a href="#product">Product</a><a href={link("/docs")}>Docs</a></nav>
      <div className="landing-header-actions"><AppearancePicker value={theme} onChange={setTheme} lang="en"/><a className="landing-button primary small" href={link()}>Launch app <span aria-hidden>↗</span></a></div>
    </header>
    <main id="landing-main" tabIndex={-1}>
      <section className="landing-hero landing-width">
        <div className="landing-hero-copy"><p className="landing-kicker">INTELLIGENCE. EXECUTION. YOUR CONTROL.</p><h1>Read the market.<br/><em>Trade your way.</em></h1>
          <p className="landing-lead">Research the markets. Trade with your wallet. Or let Autopilot execute within your chosen limits.</p>
          <div className="landing-actions"><a className="landing-button primary" href={link()}>Launch PULSE <span aria-hidden>↗</span></a><a className="landing-text-link" href="#product">Explore the platform <span aria-hidden>↓</span></a></div>
          <p className="landing-hero-note">Global & prediction intelligence · Wallet-approved Spot · Autonomous Autopilot</p>
        </div><SignalSculpture/>
        <div className="landing-network-line"><span>Networks</span><b>X Layer</b><b>Base</b><b>Arbitrum</b><b>Robinhood</b><b>Arc Mainnet</b><button type="button" aria-pressed={motion} onClick={()=>setMotion(!motion)}>Motion {motion ? "on" : "off"} <span aria-hidden>{motion ? "Ⅱ" : "▷"}</span></button></div>
      </section>

      <section className="landing-platform-strip" aria-label="Platform capabilities, not usage statistics"><div className="landing-width">
        <div><strong>One platform.<br/>Different ways forward.</strong><p>Start with a question, a trade, or a strategy.</p></div>
        <dl><div><dt>Mainnet integrations</dt><dd>{String(Object.keys(WEB_NETWORKS).length).padStart(2, "0")}</dd></div><div><dt>Ways to trade</dt><dd>02</dd></div><div><dt>Research workspaces</dt><dd>03</dd></div></dl>
      </div></section>

      <section id="product" className="landing-width landing-section landing-trading">
        <div className="landing-section-heading"><p className="landing-kicker">TWO WAYS TO TRADE</p><h2>Hands-on when you want.<br/><span>Autonomous when you choose.</span></h2><p>Different workflows. The same clear boundary: your capital, your authorization.</p></div>
        <div className="landing-trading-grid">
          <div className="landing-mode-copy"><div className="landing-mode-switch" role="group" aria-label="Explore trading modes"><button aria-pressed={mode==="spot"} onClick={()=>setMode("spot")}>Spot trading</button><button aria-pressed={mode==="autopilot"} onClick={()=>setMode("autopilot")}>Autopilot</button></div>
            <h3>{mode==="spot" ? "Your decision. Your wallet." : "Your strategy. Working autonomously."}</h3>
            <p>{mode==="spot" ? "Choose a pair directly or bring a plan from Global Market. Review a Market or Limit order, then approve it in your wallet." : "Configure an account, market, strategy and risk limits. After activation, PULSE monitors conditions and can trade within your approved policy."}</p>
            <ul>{(mode==="spot" ? ["Market and Limit orders where enabled", "Free market previews", "No research purchase required"] : ["Independent of Global reports", "Prepaid AI Entry Pass; no auto-renewal", "Owner pause and withdrawal controls"]).map(text=><li key={text}>{text}</li>)}</ul>
            <p>Availability depends on the selected network, live routes and execution readiness. A network integration does not mean every trading feature is active.</p>
            <a className="landing-text-link" href={link(mode==="spot"?"/spot":"/autopilot")}>{mode==="spot"?"Explore Spot":"Explore Autopilot"} <span aria-hidden>↗</span></a>
          </div>
          <div className="landing-execution-figure" role="img" aria-label={mode==="spot" ? "Spot workflow: choose pair, review order, sign with wallet" : "Autopilot workflow: configure policy, activate, monitor and execute when rules pass"}>
            <div className="landing-figure-top"><span>{mode==="spot"?"WALLET-APPROVED":"POLICY-CONTROLLED"}</span><PulseMark/></div>
            <div className="landing-flow">{(mode==="spot" ? [["01","Choose","Pair & market context"],["02","Review","Order, amount & route"],["03","Sign","Your wallet approves"]] : [["01","Configure","Capital & risk policy"],["02","Activate","Owner approval & pass"],["03","Monitor","Trade only when rules pass"]]).map(([n,title,caption])=><div key={n}><span>{n}</span><strong>{title}</strong><small>{caption}</small></div>)}</div>
            <p className="landing-figure-foot">{mode==="spot" ? "A report never places an order." : "A rising market alone does not authorize a Buy."}</p>
          </div>
        </div>
      </section>

      <section className="landing-research-band"><div className="landing-width landing-section">
        <div className="landing-section-heading"><p className="landing-kicker">RESEARCH BEFORE COMMITMENT</p><h2>More context.<br/><span>Fewer blind spots.</span></h2></div>
        <div className="landing-research-services">{research.map((item, index) => <article key={item.route}><p className="landing-kicker">{item.code}</p><ResearchIllustration service={index}/><h3>{item.title}</h3><p>{item.text}</p><ul>{item.points.map(point => <li key={point}>{point}</li>)}</ul><ResearchCount service={(["global", "prediction", "risk"] as const)[index]} data={activity.data} loading={activity.loading}/><a className="landing-text-link" href={link(item.route)}>Open {item.label} <span aria-hidden>↗</span></a></article>)}</div>
      </div></section>

      <section className="landing-width landing-section landing-control">
        <div className="landing-section-heading"><p className="landing-kicker">BUILT AROUND YOUR CONTROL</p><h2>Autonomy needs<br/><span>clear boundaries.</span></h2><p>See what is allowed, what happened, and what needs your attention.</p><a className="landing-text-link" href={link("/docs")}>Understand the safeguards <span aria-hidden>↗</span></a></div>
        <figure className="landing-control-account"><figcaption>ILLUSTRATED CONTROLS · NOT A LIVE ACCOUNT</figcaption><div className="landing-account-title"><PulseMark/><div><small>OWNER-AUTHORIZED</small><h3>Your Autopilot account</h3></div></div><dl><div><dt>Capital</dt><dd>Only what you approve</dd></div><div><dt>Risk policy</dt><dd>Your signed limits</dd></div><div><dt>AI Entry Pass</dt><dd>Prepaid. No auto-renewal.</dd></div></dl><div className="landing-account-controls"><span>Pause trading<small>Hold remaining pass time</small></span><span>Withdraw funds<small>Owner authorization</small></span></div><p>Follow decisions → confirmed fills → transaction records.<br/>Missing evidence stays visible.</p></figure>
      </section>

      <PublicActivityBreakdown {...activity}/>

      <section className="landing-width landing-section landing-faq"><div><p className="landing-kicker">BEFORE YOU BEGIN</p><h2>A few things<br/><span>worth knowing.</span></h2></div><div>{[
        ["Is Spot trading autonomous?","No. You review and approve Spot orders in your wallet. Autopilot is the separate autonomous-trading workflow, activated under your approved strategy and limits."],
        ["Do I need to buy research before trading?","No. Spot supports direct pair selection. Global reports can help prepare a trade, but are optional. Autopilot is configured independently and uses its own AI Entry Pass."],
        ["What does PULSE cost?","Global and Prediction Quick reports cost $0.20; Pro reports cost $0.30. Risk Guard costs $0.20. Autopilot Entry Passes are $1.50 for 24 hours, $10.50 for 7 days or $45 for 30 days. Network gas and execution costs are separate. Review the quoted payment before signing."],
        ["What happens when an Entry Pass ends?","Expiry or exhausted AI confirmations blocks new AI entries. Authorized deterministic protection can continue on an unpaused account. Manually pausing the vault stops strategy trading and freezes remaining paid time."],
        ["Which networks can I use?","PULSE integrates X Layer, Base, Arbitrum, Robinhood and Arc mainnets. Arc uses USDC for gas and trading, with Circle Gateway USDC for research payments. Robinhood uses USDG for settlement and ETH for gas. Each feature checks verified contracts, live routes and market data before execution; selecting a network does not guarantee every market or feature is available."],
        ["Does PULSE guarantee a profit?","No. Research, risk checks and automation do not eliminate market, liquidity, contract or execution risk. Review the evidence and only authorize capital and risks you understand."],
      ].map(([q,a])=><details key={q}><summary>{q}<span aria-hidden>+</span></summary><p>{a}</p></details>)}</div></section>

      <section className="landing-final"><div className="landing-width"><PulseMark/><p className="landing-kicker">YOUR NEXT MOVE STARTS WITH CONTEXT.</p><h2>Find your PULSE.</h2><a className="landing-button primary" href={link()}>Launch app <span aria-hidden>↗</span></a><p>Explore first. Connect your wallet when you’re ready.</p></div></section>
    </main>
    <footer className="landing-footer landing-width"><a className="landing-brand" href="#"><PulseMark/><span>PULSE</span></a><p>Intelligence. Execution. Your control.<small>Trading involves risk. No guaranteed returns.</small></p><nav aria-label="Footer"><a href={link("/docs")}>Docs</a><a href={link("/telegram")}>Telegram</a><a href={link()}>Application ↗</a></nav><small>© {new Date().getFullYear()} PULSE</small></footer>
  </div>;
}
