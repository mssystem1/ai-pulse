import { terminalFrameRoles, terminalPrice, terminalUtc, type TerminalRadar, type TerminalTimeframe } from "./terminalClient";
import { TERMINAL_RADAR_STEPS, terminalNextRadarClose } from "./terminalTradeReading";
import "./terminalRadarExperience.css";

const executionMs: Record<string, number> = { "5m": 300000, "15m": 900000, "1H": 3600000, "4H": 14400000, "1D": 86400000, "1Dutc": 86400000 };
const sourceTime = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

export function TerminalRadarProgress({ radar }: { radar: TerminalRadar }) {
  const snapshot = radar.snapshot, stage = Math.max(0, Math.min(3, snapshot?.stage ?? radar.stage ?? 0));
  const frame = snapshot?.definition.timeframe ?? terminalFrameRoles[radar.timeframe as TerminalTimeframe]?.entry ?? radar.timeframe;
  const startedAt = snapshot?.definition.createdAt ?? sourceTime(radar.createdAt), lastAt = snapshot?.lastObservationAt;
  const firstClose = startedAt === null ? null : terminalNextRadarClose(frame, startedAt);
  const nextClose = typeof lastAt === "number" && executionMs[frame] ? lastAt + executionMs[frame] : firstClose;
  const events = snapshot?.events ?? radar.events ?? [], terminalState = ["completed", "failed", "expired"].includes(radar.state);
  const component = snapshot?.tapeout, provenance = component ?? radar.provenance;
  const processor = typeof provenance?.processor === "string" && /^0x[0-9a-fA-F]{40}$/.test(provenance.processor) ? provenance.processor : null;
  const steps = TERMINAL_RADAR_STEPS[radar.detector] ?? TERMINAL_RADAR_STEPS.sweep_reclaim;
  return <div className="terminal-radar-progress">
    <p className="terminal-radar-boundary"><b>Watching {terminalPrice(radar.boundary)}</b> · {frame.replace("utc", " UTC")} completed candles{snapshot?.definition.side ? ` · outside is ${snapshot.definition.side}` : ""}</p>
    <ol className="terminal-radar-stage-list" aria-label="Radar confirmation stages">{steps.map((label, index) => {
      const kind = index === 0 ? "first_stage" : index === 1 ? "second_stage" : "completed";
      const event = events.filter(row => row.kind === kind).at(-1), done = stage > index;
      const at = event ? sourceTime(event.at ?? ("createdAt" in event ? event.createdAt : undefined)) : null;
      return <li key={label} className={done ? "is-observed" : !terminalState && !radar.paused && stage === index ? "is-next" : ""}><span className="terminal-radar-stage-number" aria-hidden="true">{done ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{done && at !== null ? `Observed ${terminalUtc(at)}` : done ? "Observed in saved sequence" : !terminalState && stage === index ? radar.paused ? "Paused" : "Next required event" : "Waiting for the earlier stage"}</small></div></li>;
    })}</ol>
    <div className="terminal-radar-next"><strong>{radar.paused ? "Monitoring is paused" : radar.state === "completed" ? "Price sequence completed — review the trade plan" : radar.state === "failed" ? "This sequence failed — review the boundary" : radar.state === "expired" ? "This Radar expired" : radar.state === "data_needed" ? "Waiting for verified source data" : "What happens next"}</strong><p>{radar.paused ? "Resume this Radar to check later eligible observations. Pausing does not close an exchange position." : snapshot?.next ?? radar.nextEvent ?? radar.reason ?? "Waiting for a new eligible completed candle."}</p></div>
    <dl className="terminal-radar-clock"><div><dt>Monitoring started</dt><dd>{terminalUtc(startedAt ?? undefined)}</dd></div><div><dt>Latest eligible source candle</dt><dd>{typeof lastAt === "number" ? terminalUtc(lastAt) : "None since this Radar started"}</dd></div>{!terminalState && <div><dt>{typeof lastAt === "number" ? "Next expected source close" : "First eligible source close"}</dt><dd>{terminalUtc(nextClose ?? undefined)}</dd></div>}<div><dt>Expires</dt><dd>{terminalUtc(radar.expiresAt)}</dd></div></dl>
    <p className="terminal-radar-use">Use a completed sequence to review acceptance or rejection at your level alongside risk and the nearest target. Radar records a price event; your actual exchange fill belongs in My positions.</p>
    {provenance && <details className="terminal-radar-provenance"><summary>Tapeout logic on X Layer · technical details</summary><p>{component?.verified ? "PULSE verified this registered circuit at the recorded X Layer block and imported its logic for Radar’s condition checks." : "This saved Radar retains a reference to the X Layer circuit used by its evaluator."} Price data and private monitoring state are evaluated offchain.</p><dl>{processor && <div><dt>Processor</dt><dd><a href={`https://www.oklink.com/xlayer/address/${processor}`} target="_blank" rel="noopener noreferrer">{processor}</a></dd></div>}{provenance.circuitId !== undefined && <div><dt>Circuit ID</dt><dd>{String(provenance.circuitId)}</dd></div>}{provenance.blockNumber !== undefined && <div><dt>Verification block</dt><dd>{String(provenance.blockNumber)}</dd></div>}</dl><p>This integration supplies reusable event logic. It does not verify exchange prices onchain or predict a profitable trade.</p></details>}
  </div>;
}
