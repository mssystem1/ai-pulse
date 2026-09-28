import { useState } from "react";
import "./docsWorkflowVisuals.css";

const workflows = [
  {
    name: "Research & Spot", title: "Research informs. Your wallet executes.",
    intro: "Global Quick and Pro are complete research services. Their trade plans can prefill a Spot ticket; buying a report never places an order.",
    steps: [
      ["Explore", "Choose a market", "Route available is selected by default. Filter by asset class or choose All assets for the broader catalog. Market data and the compact chart load automatically."],
      ["Optional research", "Global Quick or Pro", "Buy a report for evidence, scenarios and invalidation, or go directly to Spot without purchasing research."],
      ["Prepare", "Market or Limit ticket", "Load a report plan or configure a pair directly. Check amount, route and protection."],
      ["Authorize", "Review & sign", "Your wallet authorizes execution. Track confirmations and fills in the dashboard."],
    ],
    note: "Prediction Quick/Pro research prediction markets. Risk Guard assesses token evidence. These are separate paid services, not steps required to start Autopilot.",
  },
  {
    name: "Autopilot runtime", title: "An independent strategy, with a controlled AI budget.",
    intro: "Start from the six-step setup—not a Global report. Choose the vault, market, strategy, capital/risk and pass; then review and activate.",
    steps: [
      ["Observe", "Closed-candle check", "The strategy checks its technical entry conditions first. A rising market alone does not authorize a Buy."],
      ["Confirm", "Eligible compact AI", "Only a qualifying candidate can use a prepaid confirmation, subject to cooldown and budget limits."],
      ["Execute", "All entry rules pass", "A Buy requires the signed policy, available capital and a verified route. Otherwise the journal explains the Hold."],
      ["Protect", "Monitor & exit", "Deterministic TP/SL and structure exits do not need another AI report. After a full exit, the strategy can seek a new entry."],
    ],
    note: "Pass expired or confirmations used: no new entries, but authorized protection of an existing position continues. Owner pause is different: it stops strategy trading and holds the paid timer.",
  },
  {
    name: "Telegram", title: "A shortcut into PULSE—not a second trading interface.",
    intro: "Start the bot once and use its buttons. The profile's generic Open App button opens PULSE but does not, by itself, link report delivery to your chat.",
    steps: [
      ["Open", "Tap a bot button", "Global, Prediction, Spot, Autopilot or My reports opens the matching app page."],
      ["Choose", "Use the app", "Select the network, market and service. Free previews do not require payment."],
      ["Authorize", "Review in your wallet", "A report purchase is not a trade. Spot needs order approval; Autopilot needs its own setup and activation."],
      ["Return", "Read your report", "Supported Global and Prediction reports return to the linked chat. Saved research remains accessible in Portfolio and wallet-owned report history."],
    ],
    note: "If delivery fails, recover the existing report before considering another purchase. Never send wallet secrets to the bot. Opening a chat or an app page cannot start trading.",
  },
  {
    name: "Performance", title: "Transfers are cash flows. Fills determine trading results.",
    intro: "Spot and Autopilot have different accounting boundaries; their percentages must not be averaged together.",
    steps: [
      ["Verify", "Confirmed executions", "Market and Limit fills use receipt-backed token quantities and net settlement transfers. Pending orders and funding are not fills."],
      ["Match", "Average-cost inventory", "Buy 2 units for 200; sell 1 for 110. The matched cost is 100, realized profit is 10, and remaining cost is 100."],
      ["Value", "Open positions", "A current mark of 120 values the remaining unit at 120: open profit is 20. Missing marks or cost history stay unknown."],
      ["Separate", "Autopilot capital", "Vault P&L = current value + withdrawals − starting value − later deposits. Gas and Entry Pass fees are not included."],
    ],
    note: "Autopilot recovers cash flows from chain receipts in the background. PnL stays unavailable until coverage and valuation are verified; the checkpoint time can be older than live balances. This never pauses trading or requires another payment. B/S markers are confirmed fills for the selected pair and account—not recommendations or deposits. Expand the chart to browse Older/Newer, return to Latest, or select a fill to open its time window. History depends on provider availability; missing trades are never invented.",
  },
  {
    name: "Payment & recovery", title: "One purchase. A clear next action.",
    intro: "Read the price and selected network before signing. PULSE validates service inputs before asking for payment; report purchases never authorize trades.",
    steps: [
      ["Choose", "Service & network", "Select the report or the specific vault and its 24h, 7d or 30d pass."],
      ["Pay", "Review in your wallet", "Approve the quoted payment. Signing, settlement and delivery are distinct stages."],
      ["Deliver", "Report or paid time", "Reports generate as recoverable jobs. A paid pass adds time to that vault; it is not a capital deposit."],
      ["Continue", "Open report / Resume", "A paused vault prompts for Resume after pass payment. An already-running vault needs no extra resume transaction."],
    ],
    note: "If payment succeeds but you reject Resume, your paid time is retained. Use Resume—not another purchase. For a pending report, recover its existing job or history entry instead of paying again.",
  },
];

export function DocsWorkflowVisuals() {
  const [selected, setSelected] = useState(0);
  const workflow = workflows[selected];
  return <section id="docs-workflows" className="docs-flow-visual" aria-labelledby="docs-flow-title">
    <span className="eyebrow">WORKFLOW MAPS</span>
    <h3 id="docs-flow-title">See where each action leads</h3>
    <div className="docs-flow-picker" role="group" aria-label="Choose a workflow map">
      {workflows.map((item, index) => <button type="button" key={item.name} aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.name}</button>)}
    </div>
    <figure aria-label={workflow.title}>
      <figcaption><strong>{workflow.title}</strong><p>{workflow.intro}</p></figcaption>
      <ol className="docs-flow-steps">
        {workflow.steps.map(([stage, title, description], index) => <li key={title}>
          <span className="docs-flow-stage"><b>{index + 1}</b>{stage}</span>
          <h4>{title}</h4><p>{description}</p>
        </li>)}
      </ol>
      {selected === 1 && <div className="docs-pass-timeline" aria-label="Pass time example: running uses time, paused holds time, resumed uses time">
        <span><b>Running</b>Paid time counts down</span><i aria-hidden="true">→</i>
        <span><b>Owner pauses</b>Remaining time held</span><i aria-hidden="true">→</i>
        <span><b>Owner resumes</b>Countdown continues</span>
      </div>}
      {selected === 1 && <p className="docs-flow-note">Default AI budget: at most 3 fresh confirmations per vault per UTC day, at least 4 hours apart, and 3 confirmations per purchased 24h. Eligible shared results can be reused without charging a second confirmation. These are ceilings, not a schedule: a failed technical setup causes a Hold without asking Grok. Protection checks do not consume AI confirmations. Frequency alone cannot establish profitability.</p>}
      <p className="docs-flow-note">{workflow.note}</p>
      {selected === 3 && <p className="docs-flow-note">Market charts use free TradingView Lightweight Charts—not a TradingView subscription. Data comes from the selected market provider; Robinhood uses exact-token DEX history rather than substituting an exchange ticker or underlying stock. Expand to inspect O/H/L/C and volume, drag or pinch to navigate, and Reset view to restore readable spacing. Times are UTC. Green/red candles keep the same meaning in every theme. B/S arrows identify a fill's candle; execution prices remain in the fill list rather than changing the chart scale.</p>}
    </figure>
  </section>;
}
