/** Shared Ask PULSE navigation model. Keep these keys stable for the terminal UI. */
export const terminalSections = ["terminal", "market-tools", "radar", "create-indicator", "market", "my-indicators", "positions", "alerts"] as const;
export type TerminalSection = typeof terminalSections[number];

const sectionGuidance: Record<TerminalSection, { label: string; focus: string; prompts: string[] }> = {
  terminal: { label: "Terminal", focus: "Explain the current market and setup, its eligibility and limitations.", prompts: ["What is the market doing now?", "What would invalidate this setup?"] },
  "market-tools": { label: "Market tools", focus: "Explain the selected value, flow, footprint, derivatives or liquidity tool and its source window.", prompts: ["What does this tool show?", "Which evidence is missing or stale?"] },
  radar: { label: "Radar", focus: "Explain the selected radar's boundary, detector, stage and next condition using its recorded evidence.", prompts: ["What stage is this radar at?", "What event would complete or fail it?"] },
  "create-indicator": { label: "Create indicator", focus: "Guide the user through describing a study, previewing it, applying it to the chart and publishing it manually when ready. Indicator generation uses the dedicated Studio copilot flow; general Ask PULSE should explain the workflow and supported concepts.", prompts: ["How do I preview a new indicator?", "What can the Studio copilot build?"] },
  market: { label: "Indicator Market", focus: "Guide the user through indicator discovery and publishing: explain free versus paid access, exact indicator version identity, supported payment networks and purchase receipts. Do not claim a current price, listing, network or receipt unless supplied in the context.", prompts: ["How do I discover indicators?", "How do free and paid indicators differ?", "How do version identity and receipts work?"] },
  "my-indicators": { label: "My indicators", focus: "Help interpret the selected local indicator, its input requirements, plots and preview.", prompts: ["Explain this indicator's plots", "Why might this preview have gaps?"] },
  positions: { label: "Positions", focus: "Explain only supplied user-recorded position facts and protection status; never infer venue fills or authorize orders.", prompts: ["Summarize my recorded position", "What protection information is missing?"] },
  alerts: { label: "Alerts", focus: "Explain selected watch/radar/position alert conditions, delivery state and source limits.", prompts: ["What triggers this alert?", "Why has this alert not fired?"] },
};

export function terminalAskSection(section: TerminalSection) { return sectionGuidance[section]; }
