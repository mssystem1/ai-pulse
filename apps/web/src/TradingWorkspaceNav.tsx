export function TradingWorkspaceNav({ title, items, value, disabled, onChange }: {
  title: string; items: readonly { id: string; label: string; description: string }[];
  value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  return <nav className="trading-workspace-nav" aria-label={`${title} navigation`}>
    <div className="trading-nav-heading"><span className="eyebrow">YOUR WORKSPACE</span><strong>{title}</strong><span>Choose your next action</span></div>
    {items.map((item, index) => <button key={item.id} type="button" aria-label={item.label} aria-current={value === item.id ? "page" : undefined} disabled={disabled} onClick={() => onChange(item.id)}>
      <span className="trading-nav-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><span aria-hidden="true">↗</span>
    </button>)}
  </nav>;
}

export const SPOT_WORKSPACE_PAGES = [
  { id: "setup", label: "Trade setup", description: "Explore markets & prepare an order" },
  { id: "dashboard", label: "Dashboard", description: "Orders, positions & activity" },
] as const;
export const AUTOPILOT_WORKSPACE_PAGES = [
  { id: "create", label: "Create new Autopilot", description: "Choose a market & set your limits" },
  { id: "edit", label: "Edit Autopilot", description: "Select, review, save & restart" },
  { id: "dashboard", label: "Dashboard", description: "Manage capital & follow decisions" },
  { id: "activity", label: "On-chain activity", description: "Confirmations, fills & owner actions" },
] as const;
