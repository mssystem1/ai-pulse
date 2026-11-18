/** Shared Ask PULSE section help. Keep these keys stable for the terminal UI. */
export const terminalSections = ["terminal", "market-tools", "radar", "create-indicator", "market", "my-indicators", "positions", "alerts"] as const;
export type TerminalSection = typeof terminalSections[number];

const sectionGuidance: Record<TerminalSection, { label: string; focus: string; prompts: string[] }> = {
  terminal: { label: "Terminal", focus: "Explain what the chart and current setup show, which conditions still need to happen, and what could change the view.", prompts: ["What is the market doing now?", "What would invalidate this setup?"] },
  "market-tools": { label: "Market tools", focus: "Explain the selected market tool in plain language, including what its readings cover and whether its data is missing or out of date.", prompts: ["What does this tool show?", "Which evidence is missing or stale?"] },
  radar: { label: "Radar", focus: "Explain what this Radar is watching, which stage it has reached, and what event would move it forward or end it.", prompts: ["What stage is this Radar at?", "What event would complete or fail it?"] },
  "create-indicator": { label: "Create indicator", focus: "Help describe an indicator, preview it on the chart, and publish it when it is ready. Indicator creation happens in the Studio copilot; Ask PULSE can explain the steps and supported ideas.", prompts: ["How do I preview a new indicator?", "What can the Studio copilot build?"] },
  market: { label: "Indicator Market", focus: "Help find and publish indicators. Explain free and paid access, how indicator versions are identified, and how supported networks and purchase receipts work. Only state a price, listing, network, or receipt when it is included in the available details.", prompts: ["How do I discover indicators?", "How do free and paid indicators differ?", "How do version identity and receipts work?"] },
  "my-indicators": { label: "My indicators", focus: "Explain the selected indicator, what inputs it needs, what its chart lines mean, and why its preview may have gaps.", prompts: ["Explain this indicator's plots", "Why might this preview have gaps?"] },
  positions: { label: "Positions", focus: "Summarize only the position details recorded here and explain what protection information is available. A journal entry does not confirm an exchange fill or order.", prompts: ["Summarize my recorded position", "What protection information is missing?"] },
  alerts: { label: "Alerts", focus: "Explain what this watch, Radar, or position alert is waiting for, whether delivery is enabled, and which data sources it uses.", prompts: ["What triggers this alert?", "Why has this alert not fired?"] },
};

export function terminalAskSection(section: TerminalSection) { return sectionGuidance[section]; }
