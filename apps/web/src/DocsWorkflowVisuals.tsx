import { useState } from "react";
import "./docsWorkflowVisuals.css";

const workflows = [
  {
    name: "Research & Spot", title: "Research informs. Your wallet executes.",
    intro: "Global Quick and Pro are complete research services. Their trade plans can prefill a Spot ticket; buying a report never places an order.",
    steps: [
      ["Explore", "Choose a market", "View live market data and chart context without placing a trade."],
      ["Research", "Global Quick or Pro", "Pay for your chosen report. Review evidence, scenarios and invalidation."],
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
      <p className="docs-flow-note">{workflow.note}</p>
    </figure>
  </section>;
}
