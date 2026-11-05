import { useMemo, useState, type FormEvent } from "react";
import { TERMINAL_FRAMES, terminalLabel, terminalPrice, terminalUtc, type TerminalMarket, type TerminalTimeframe } from "./terminalClient";
import { TERMINAL_RADAR_STEPS, terminalNextRadarClose } from "./terminalTradeReading";
import "./terminalRadarExperience.css";

export type TerminalRadarDraft = {
  timeframe: TerminalTimeframe;
  detector: "sweep_reclaim" | "breakout_acceptance" | "breakout_failure";
  boundary: number;
  side: "above" | "below";
  tolerance: 0;
  hours: number;
  telegram: boolean;
};
type Props = {
  market: TerminalMarket | null; initialFrame: TerminalTimeframe; initialBoundary?: string;
  initialSide?: "above" | "below"; initialDetector?: string; active: boolean; busy: boolean;
  telegramLinked: boolean; telegramEnabled: boolean; accessEndsAt?: string | null; serverNow?: number | null; onCancel: () => void;
  onCreate: (draft: TerminalRadarDraft) => void;
};

const CADENCE: Record<TerminalTimeframe, { frame: string; ms: number; label: string; hours: number }> = {
  "15m": { frame: "5m", ms: 300000, label: "Fast · 5-minute candles", hours: 6 },
  "1H": { frame: "15m", ms: 900000, label: "Intraday · 15-minute candles", hours: 24 },
  "4H": { frame: "1H", ms: 3600000, label: "Swing · 1-hour candles", hours: 120 },
  "1Dutc": { frame: "4H", ms: 14400000, label: "Position · 4-hour candles", hours: 720 },
  "1Wutc": { frame: "1Dutc", ms: 86400000, label: "Macro · daily UTC candles", hours: 2160 },
};
const PRESETS: { detector: TerminalRadarDraft["detector"]; side: TerminalRadarDraft["side"]; title: string; description: string }[] = [
  { detector: "sweep_reclaim", side: "below", title: "Support reclaim", description: "Watch for trading below support, a recovery and a later hold." },
  { detector: "breakout_acceptance", side: "above", title: "Break & hold", description: "Watch for a completed break, a later retest and acceptance." },
  { detector: "breakout_failure", side: "above", title: "Failed breakout", description: "Watch for a completed break that returns inside and stays there." },
];
const durationLabel = (hours: number) => hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? "" : "s"}` : `${hours} hours`;

export function TerminalRadarPlanner({ market, initialFrame, initialBoundary = "", initialSide = "below", initialDetector = "sweep_reclaim", active, busy, telegramLinked, telegramEnabled, accessEndsAt, serverNow, onCancel, onCreate }: Props) {
  const detectorValue = PRESETS.some(p => p.detector === initialDetector) ? initialDetector as TerminalRadarDraft["detector"] : "sweep_reclaim";
  const [timeframe, setTimeframe] = useState(initialFrame), [detector, setDetector] = useState(detectorValue);
  const [boundary, setBoundary] = useState(initialBoundary), [side, setSide] = useState(initialSide);
  const [hours, setHours] = useState(CADENCE[initialFrame].hours), [telegram, setTelegram] = useState(false);
  const now = serverNow ?? Date.now();
  const [error, setError] = useState("");
  const cadence = CADENCE[timeframe], firstClose = terminalNextRadarClose(cadence.frame, now);
  const minimumHours = firstClose === null ? 2161 : Math.max(1, Math.ceil((firstClose + 2 * cadence.ms + 1 - now) / 3600000));
  const accessEnds = Date.parse(accessEndsAt ?? ""), passTooShort = firstClose !== null && Number.isFinite(accessEnds) && accessEnds <= firstClose + 2 * cadence.ms;
  const durations = [...new Set([1, 6, 24, 72, 120, 168, 720, 2160, cadence.hours])].filter(h => h >= minimumHours).sort((a, b) => a - b);
  const selectedHours = hours >= minimumHours ? hours : durations[0] ?? minimumHours;
  const levels = useMemo(() => {
    if (!market) return [];
    const result: { key: string; price: number; label: string }[] = [];
    const profile = market.tools.value.orderFlow?.profile;
    if (profile && !["stale", "unavailable"].includes(market.tools.value.status)) {
      result.push({ key: "value-low", price: profile.val, label: "Recent value-area low · executed trades" }, { key: "value-high", price: profile.vah, label: "Recent value-area high · executed trades" }, { key: "value-poc", price: profile.poc, label: "Recent point of control · executed trades" });
    }
    const reference = market.report.currentMarket?.quote?.price ?? market.report.snapshot.price;
    const saved = market.report.levels.filter(level => level.role !== "projection" && Number.isFinite(level.price) && level.price > 0).slice().sort((a, b) => Math.abs(a.price - (reference ?? a.price)) - Math.abs(b.price - (reference ?? b.price))).slice(0, 18);
    result.push(...saved.map(level => ({ key: `saved-${level.id}`, price: level.price, label: `Saved ${terminalLabel(level.role).toLowerCase()} · ${market.timeframe.replace("utc", " UTC")}` })));
    return result.filter(level => Number.isFinite(level.price) && level.price > 0);
  }, [market]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const price = Number(boundary), clock = serverNow ?? Date.now(), first = terminalNextRadarClose(cadence.frame, clock);
    if (!active || busy) { setError("An active Terminal pass is required to start monitoring."); return; }
    if (!Number.isFinite(price) || price <= 0) { setError("Enter a boundary price above zero, or select a chart level."); return; }
    if (first === null || selectedHours <= 0 || selectedHours > 2160 || clock + selectedHours * 3600000 <= first + 2 * cadence.ms) { setError("Choose a monitoring duration that leaves room for at least three new complete candles."); return; }
    if (telegram && !telegramLinked) { setError("Link this wallet to the Telegram bot before choosing Telegram alerts."); return; }
    onCreate({ timeframe, detector, boundary: price, side, tolerance: 0, hours: selectedHours, telegram });
  }
  return <form className="terminal-radar-planner" onSubmit={submit} aria-label="Plan a Market Radar">
    <div className="terminal-radar-planner-intro"><h4>What should Radar watch?</h4><p>Choose a level and the price response you want to review. Radar follows new candles after you start it.</p></div>
    <div className="terminal-radar-presets" role="group" aria-label="Price response to watch">{PRESETS.map(preset => <button type="button" key={preset.detector} className={detector === preset.detector ? "is-selected" : ""} aria-pressed={detector === preset.detector} onClick={() => { setDetector(preset.detector); setSide(preset.side); }}><strong>{preset.title}</strong><span>{preset.description}</span></button>)}</div>
    <div className="terminal-radar-planner-fields">
      {levels.length > 0 && <label>Start with a chart level<select defaultValue="" onChange={event => { if (event.target.value) setBoundary(event.target.value); }}><option value="">Choose a real value or saved price level</option>{levels.map(level => <option key={level.key} value={level.price}>{terminalPrice(level.price)} · {level.label}</option>)}</select><small>Recent value levels cover their displayed execution window; saved levels belong to the report.</small></label>}
      <label>Boundary price<input required inputMode="decimal" type="number" step="any" min="0" value={boundary} placeholder={market ? `Price in ${market.instId.split("-").at(-1)}` : "Enter a price"} onChange={event => setBoundary(event.target.value)} /></label>
      <label>Watch the move<select value={side} onChange={event => setSide(event.target.value as "above" | "below")}><option value="below">Below the level · downside boundary</option><option value="above">Above the level · upside boundary</option></select><small>“Inside” is {side === "below" ? "above" : "below"} your boundary; “outside” is {side} it.</small></label>
      <label>Confirmation speed<select value={timeframe} onChange={event => { const frame = event.target.value as TerminalTimeframe; setTimeframe(frame); setHours(CADENCE[frame].hours); }} >{TERMINAL_FRAMES.map(frame => <option key={frame} value={frame}>{CADENCE[frame].label}</option>)}</select><small>Uses {cadence.frame.replace("utc", " UTC")} completed candles. This changes the Radar cadence, not the report’s selected chart.</small></label>
      <label>Keep watching for<select value={selectedHours} onChange={event => setHours(Number(event.target.value))}>{durations.map(duration => <option key={duration} value={duration}>{durationLabel(duration)}</option>)}</select><small>Durations too short for three eligible candles are unavailable.</small></label>
    </div>
    <div className="terminal-radar-preview"><h4>The sequence you will receive</h4><ol>{(TERMINAL_RADAR_STEPS[detector] ?? []).map((label, index) => <li key={label}><span>{index + 1}</span><div><strong>{label}</strong><small>{index === 0 ? `Beyond ${boundary && Number(boundary) > 0 ? terminalPrice(Number(boundary)) : "your chosen level"}, on the ${side} side` : "Requires a separate later completed candle"}</small></div></li>)}</ol><p><b>First eligible candle closes:</b> {terminalUtc(firstClose ?? undefined)}. The candle already in progress is excluded.</p>{cadence.ms >= 14400000 && <p className="terminal-radar-slow">This is a slow confirmation: three {cadence.frame.replace("utc", " UTC")} candles can take {cadence.ms === 86400000 ? "more than three days" : "more than twelve hours"}. Choose a faster cadence for intraday monitoring.</p>}<p>Completion asks you to review the price response and your entry/stop/target plan. It does not open a position. Monitoring needs an active Terminal pass.</p></div>
    <label className="terminal-radar-telegram"><input type="checkbox" disabled={!telegramLinked} checked={telegram} onChange={event => setTelegram(event.target.checked)} /><span>Notify me in the Telegram bot{!telegramLinked && <small>Link the connected wallet to Telegram in Alerts &amp; activity first.</small>}{telegram && !telegramEnabled && <small>Bot delivery is paused. Enable Telegram delivery in Alerts &amp; activity to receive these changes.</small>}</span></label>
    {passTooShort && <p className="terminal-radar-slow">Your current pass ends before the earliest possible three-candle completion at this speed. Choose a faster confirmation or extend your pass to keep monitoring.</p>}
    {error && <p role="alert" className="terminal-radar-form-error">{error}</p>}{!active && <p className="terminal-radar-form-error">Open an active Terminal pass before starting Radar.</p>}
    <div className="terminal-actions"><button type="submit" className="terminal-primary" disabled={!active || busy}>Start this Radar</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
