import { useEffect, useState } from "react";
import { apiGet } from "./api";

export type Service = "global" | "prediction" | "risk";
type Count = { count: number; partial: number; firstAt: string; lastAt: string };
type Counts = Record<Service, Count | null>;
type ExecutionCount = { count: number; byChain: {count:number;firstAt:string;lastAt:string;amount:string;symbol:string;chain:string;label:string}[] };
export type PublicActivity = {
  version: 1; scope: "platform"; persistence: "durable"; asOf: string; stale: boolean;
  research: Counts;
  networks: { chain: string; label: string; environment: "mainnet" | "testnet"; research: Counts }[];
  execution?: { spot: ExecutionCount | null; autopilot: ExecutionCount | null };
};
const services: { key: Service; label: string }[] = [{ key: "global", label: "Global" }, { key: "prediction", label: "Prediction" }, { key: "risk", label: "Risk Guard" }];
function validCounts(value: unknown): value is Counts {
  if (!value || typeof value !== "object") return false;
  return services.every(({ key }) => {
    const count = (value as Counts)[key];
    return count === null || (count && Number.isSafeInteger(count.count) && count.count >= 0 && Number.isSafeInteger(count.partial)
      && count.partial >= 0 && count.partial <= count.count && Number.isFinite(Date.parse(count.firstAt)) && Number.isFinite(Date.parse(count.lastAt)) && Date.parse(count.firstAt) <= Date.parse(count.lastAt));
  });
}
export function parsePublicActivity(value: unknown): PublicActivity | null {
  if (!value || typeof value !== "object") return null;
  const data = value as PublicActivity;
  if (data.version !== 1 || data.scope !== "platform" || data.persistence !== "durable" || typeof data.stale !== "boolean" || !Number.isFinite(Date.parse(data.asOf)) || !validCounts(data.research)
    || !Array.isArray(data.networks) || data.networks.length > 30 || !data.networks.every(network => network && /^eip155:\d+$/.test(network.chain)
      && typeof network.label === "string" && network.label.length < 80 && ["mainnet", "testnet"].includes(network.environment) && validCounts(network.research))) return null;
  if (new Set(data.networks.map(network => network.chain)).size !== data.networks.length) return null;
  if (!services.every(({key}) => {
    const observed = data.networks.map(network => network.research[key]).filter((count): count is Count => count !== null);
    const total = data.research[key];
    return observed.length ? total && total.count === observed.reduce((sum,count) => sum + count.count,0) && total.partial === observed.reduce((sum,count) => sum + count.partial,0) : total === null;
  })) return null;
  if (data.execution && !(["spot", "autopilot"] as const).every(key => {
    const item = data.execution![key];
    return item === null || (item && Number.isSafeInteger(item.count) && item.count > 0 && Array.isArray(item.byChain) && item.byChain.length <= 30
      && new Set(item.byChain.map(chain => chain?.chain)).size === item.byChain.length
      && item.byChain.every(chain => chain && Number.isSafeInteger(chain.count) && chain.count > 0 && Number.isFinite(Date.parse(chain.firstAt)) && Number.isFinite(Date.parse(chain.lastAt)) && Date.parse(chain.firstAt) <= Date.parse(chain.lastAt)
        && /^\d+(\.\d+)?$/.test(chain.amount) && Number.isFinite(Number(chain.amount)) && typeof chain.symbol === "string" && chain.symbol.length < 30
        && typeof chain.label === "string" && chain.label.length < 80 && data.networks.some(network => network.chain === chain.chain && network.environment === "mainnet"))
      && item.count === item.byChain.reduce((sum,chain) => sum + chain.count,0));
  })) return null;
  return data;
}
export function usePublicActivity() {
  const [data, setData] = useState<PublicActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setAttempt(value => value + 1); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    void apiGet("/v1/public/activity", { signal: controller.signal }).then(result => {
      if (active) { setData(result.ok ? parsePublicActivity(result.data) : null); setLoading(false); }
    }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return { data, loading, retry: () => setAttempt(value => value + 1) };
}

export function ResearchCount({ service, data, loading }: { service: Service; data: PublicActivity | null; loading: boolean }) {
  const value = data?.research[service];
  return <div className="landing-research-count"><strong>{value ? value.count.toLocaleString() : "—"}</strong><span>{loading ? "Loading report activity" : value ? "observed reports delivered" : "Report count unavailable"}{value ? <small>{value.partial ? `${value.partial.toLocaleString()} partial · ` : ""}Across networks · <a href="#public-activity-heading">Coverage details</a></small> : null}</span></div>;
}

export function PublicActivityBreakdown({ data, loading, retry }: ReturnType<typeof usePublicActivity>) {
  return <section className="landing-width landing-section landing-public-activity" aria-labelledby="public-activity-heading">
    <div className="landing-section-heading"><p className="landing-kicker">PLATFORM-WIDE ACTIVITY</p><h2 id="public-activity-heading">Every network.<br/><span>Clear context.</span></h2><p>Global Market, Prediction Market and Risk Guard analyses across chains. Your selected app network does not filter these totals.</p></div>
    {data ? <>
      <p className="landing-data-status">{data.stale ? "Last available snapshot" : "Updated"} {new Date(data.asOf).toLocaleString()}. Observed deliveries, not a complete lifetime count.</p>
      <div className="landing-table-scroll" role="region" aria-label="Report delivery counts by network" tabIndex={0}><table className="landing-activity-table"><caption>Delivered research by network</caption><thead><tr><th scope="col">Network</th>{services.map(service => <th key={service.key} scope="col">{service.label}</th>)}</tr></thead><tbody>{data.networks.map(network => <tr key={network.chain}><th scope="row">{network.label}<small>{network.environment === "testnet" ? "Testnet analyses" : "Mainnet"}</small></th>{services.map(service => <td key={service.key}>{network.research[service.key]?.count.toLocaleString() ?? "—"}</td>)}</tr>)}</tbody><tfoot><tr><th scope="row">Observed total</th>{services.map(service => <td key={service.key}>{data.research[service.key]?.count.toLocaleString() ?? "—"}</td>)}</tr></tfoot></table></div>
      <details className="landing-stat-method"><summary>What these numbers include</summary><p>Successfully delivered reports, including genuine developer testing and Arc Testnet analyses. Partially completed reports count once and are identified in each service total. Recovery reads, retries, mock payments and synthetic reports do not add deliveries.</p><ul>{services.map(service => { const count = data.research[service.key]; return <li key={service.key}>{service.label}: {count ? `observed deliveries from ${new Date(count.firstAt).toLocaleDateString()} through ${new Date(count.lastAt).toLocaleDateString()}` : "no verified coverage yet"}.</li>; })}</ul><p>Older records may be missing. A dash means unavailable coverage, not zero activity. These are platform activity figures, not a count of independent customers. Testnet history remains labeled as testnet after a mainnet launch.</p></details>
    </> : <div className="landing-data-unavailable" role="status"><p>{loading ? "Loading cross-chain activity…" : "Activity figures are currently unavailable. No estimated or sample counts are shown."}</p>{!loading && <button className="landing-button small" onClick={retry}>Retry statistics</button>}</div>}
    <div className="landing-execution-stats">{(["spot", "autopilot"] as const).map(service => {
      const execution = data?.execution?.[service];
      return <article key={service}><p className="landing-kicker">{service === "spot" ? "SPOT · WALLET-APPROVED" : "AUTOPILOT · AUTONOMOUS"}</p><h3>{execution ? execution.count.toLocaleString() : "—"}<small>{loading ? "Loading execution activity" : execution ? "observed confirmed fills" : "Verified fill count unavailable"}</small></h3>{execution && <dl>{execution.byChain.map(chain => <div key={chain.chain}><dt>{chain.label}</dt><dd>{Number(chain.amount).toLocaleString(undefined,{maximumFractionDigits:6})} {chain.symbol}<small>settlement-asset volume</small></dd></div>)}</dl>}</article>;
    })}</div>
    <p className="landing-data-status">Execution figures cover observed, receipt-verified mainnet fills recorded in PULSE. Volume is shown in each chain’s settlement asset, not converted into a USD total. Report payments, deposits, withdrawals and testnet analyses are excluded. Older unverified history is not presented as complete.</p>
  </section>;
}
