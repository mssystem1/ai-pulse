import { useEffect, useMemo, useRef, useState } from "react";
import type { TerminalLiquidityHistory as History } from "@pulse/domain";
import { terminalLiquidityModel, terminalLiquidityCell, terminalLiquidityIntensity, terminalLiquidityViewport } from "./terminalLiquidityVisual";
import { terminalPrice, terminalUtc } from "./terminalClient";
import { terminalHistoryDefaults } from "./terminalHistorySelection";
import "./terminalHistory.css";

type Props = { history: History | null; busy?: boolean; collecting?: boolean; disabled?: boolean; error?: string; selectedHours: number; onWindowChange: (hours: number) => void; followsTimeframe?: boolean; onFollowTimeframe?: () => void; timeframe?: string; onCollect: () => void };
export function TerminalLiquidityHistory({ history, busy, collecting = busy, disabled, error, selectedHours, onWindowChange, followsTimeframe, onFollowTimeframe, timeframe, onCollect }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [log, setLog] = useState(true);
  const [view, setView] = useState<"available" | "requested">("available");
  const [displaySpan, setDisplaySpan] = useState<number | null | "timeframe">("timeframe");
  const [periodAt, setPeriodAt] = useState<number>();
  const [selection, setSelection] = useState<{ column: number; row: number; at?: number } | null>(null);
  const effectiveDisplaySpan=displaySpan==="timeframe"?(selectedHours===1?3_600_000:null):displaySpan;
  const viewport = useMemo(() => history ? terminalLiquidityViewport(history, view, periodAt, effectiveDisplaySpan) : null, [history, view, periodAt, effectiveDisplaySpan]);
  const model = useMemo(() => history ? terminalLiquidityModel(viewport ? { ...history, requestedStart: viewport.start, requestedEnd: viewport.end } : history) : null, [history, viewport]);
  const cell = model && selection ? terminalLiquidityCell(model, selection.column, selection.row, selection.at) : null;
  const retainedIntervals = useMemo(() => {
    const intervals: { start: number; end: number }[] = [];
    for (const sample of model?.samples ?? []) {
      const previous = intervals.at(-1);
      if (previous && previous.end >= sample.start) previous.end = Math.max(previous.end, sample.end);
      else intervals.push({ start: sample.start, end: sample.end });
    }
    return intervals;
  }, [model]);
  useEffect(() => { setSelection(null); setPeriodAt(undefined); setView("available"); }, [history?.instrumentId]);
  useEffect(() => { setSelection(null); setPeriodAt(undefined); }, [selectedHours]);
  useEffect(() => { setSelection(null); }, [view, periodAt, displaySpan]);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !model) return;
    const paint = () => {
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      const bounds = canvas.getBoundingClientRect(), width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const x = (at: number) => (at - model.start) / (model.end - model.start) * width;
      const y = (price: number) => height - (price - model.low) / (model.high - model.low) * height, rh = height / model.rowCount;
      ctx.clearRect(0, 0, width, height);
      // Unknown remains hatched, including prices outside each returned ladder.
      // Never stretch a single snapshot over absent time or repeated columns.
      ctx.fillStyle = "rgba(120,135,155,.13)"; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(120,135,155,.32)"; ctx.lineWidth = .6;
      for (let offset = -height; offset < width; offset += 18) { ctx.beginPath(); ctx.moveTo(offset, 0); ctx.lineTo(offset + height, height); ctx.stroke(); }
      for (const sample of model.samples) {
        const left = x(sample.start), sw = x(sample.end) - left;
        const top = Math.max(0, y(sample.highestAsk + model.priceStep)), bottom = Math.min(height, y(sample.lowestBid));
        ctx.clearRect(left, top, sw, Math.max(0, bottom - top));
        for (let row = 0; row < model.rowCount; row++) {
          const bidStrength = terminalLiquidityIntensity(sample.bids[row], model.maxSize, log), askStrength = terminalLiquidityIntensity(sample.asks[row], model.maxSize, log);
          const rowTop = height - (row + 1) * rh;
          if (bidStrength) { ctx.fillStyle = "rgba(0,175,139," + (.18 + bidStrength * .82) + ")"; ctx.fillRect(left, rowTop + (askStrength ? rh / 2 : 0), sw, askStrength ? rh / 2 : rh); }
          if (askStrength) { ctx.fillStyle = "rgba(229,66,111," + (.18 + askStrength * .82) + ")"; ctx.fillRect(left, rowTop, sw, bidStrength ? rh / 2 : rh); }
        }
      }
      ctx.strokeStyle = "rgba(120,135,155,.22)"; ctx.lineWidth = .6;
      for (let index = 1; index < 4; index++) { ctx.beginPath(); ctx.moveTo(0, height * index / 4); ctx.lineTo(width, height * index / 4); ctx.stroke(); }
      ctx.strokeStyle = "#c89414"; ctx.fillStyle = "#c89414"; ctx.lineWidth = 2;
      for (const segment of model.midSegments) {
        ctx.beginPath(); segment.forEach((point, index) => { index ? ctx.lineTo(x(point.at), y(point.price)) : ctx.moveTo(x(point.at), y(point.price)); }); ctx.stroke();
        if (segment.length === 1) { const point = segment[0]; ctx.beginPath(); ctx.arc(x(point.at), y(point.price), 2, 0, Math.PI * 2); ctx.fill(); }
      }
    };
    paint();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(paint) : null;
    observer?.observe(canvas); window.addEventListener("resize", paint);
    return () => { observer?.disconnect(); window.removeEventListener("resize", paint); };
  }, [model, log]);
  const inspect = (px: number, py: number) => {
    const r = ref.current?.getBoundingClientRect(); if (!r || !model || !r.width || !r.height) return;
    const fraction = Math.max(0, Math.min(1 - Number.EPSILON, (px - r.left) / r.width));
    setSelection({ column: Math.min(model.columns.length - 1, Math.floor(fraction * model.columns.length)), row: Math.max(0, Math.min(model.rowCount - 1, model.rowCount - 1 - Math.floor((py - r.top) / r.height * model.rowCount))), at: model.start + fraction * (model.end - model.start) });
  };
  const unit = history?.quantityUnit === "contracts" ? "contracts" : history?.instrumentId.split("-")[0] ?? "base";
  const automaticHours = timeframe ? terminalHistoryDefaults(timeframe).hours : selectedHours;
  return <section className="terminal-history-heatmap" aria-labelledby="liquidity-history-heading" data-history-market={history?.instrumentId ?? ""} data-history-view={view}>
    <div className="terminal-section-heading"><div><h4 id="liquidity-history-heading">Liquidity over time</h4><p>Compare real bid and offer size at each captured time. Brighter bands show larger resting orders.</p></div><label className="terminal-history-window">Order-book history window<select aria-label="Liquidity history interval" value={followsTimeframe?"timeframe":selectedHours} onChange={e => { setSelection(null); if(e.target.value==="timeframe")onFollowTimeframe?.();else onWindowChange(Number(e.target.value)); }}>{onFollowTimeframe&&<option value="timeframe">Follow chart timeframe · {automaticHours===1?"last hour":automaticHours===168?"last 7 days":`last ${automaticHours} hours`}</option>}{[[1, "Last hour"], [6, "Last 6 hours"], [24, "Last 24 hours"], [168, "Last 7 days"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {onFollowTimeframe&&<p className="terminal-hint">{followsTimeframe?`Following the ${timeframe?.replace("utc", "")} chart horizon. `:"Manual order-book window: kept when you change chart timeframe. "}This window uses retained book snapshots; it is separate from the executed-trade session above. Longer windows show broader changes; short windows show recent order placement and withdrawal.</p>}
    <div className="terminal-heatmap-view-controls" aria-label="Liquidity display range">
      <button type="button" aria-pressed={view === "available"} onClick={() => setView("available")} disabled={!viewport}>Fit captured history</button>
      <button type="button" aria-pressed={view === "requested"} onClick={() => setView("requested")} disabled={!viewport}>Full selected interval</button>
      <label>Display span<select aria-label="Liquidity display span" value={displaySpan ?? "full"} onChange={e => { setDisplaySpan(e.target.value === "timeframe"?"timeframe":e.target.value === "full" ? null : Number(e.target.value)); setView("available"); }}><option value="timeframe">Automatic · {selectedHours===1?"latest captured hour":"full captured period"}</option><option value={900_000}>Latest 15 minutes of capture</option><option value={3_600_000}>Latest hour of capture</option><option value="full">Full captured period</option></select></label>
      {viewport && viewport.periods.length > 1 && <label>Captured period<select aria-label="Captured liquidity period" value={viewport.period.start} onChange={e => { setPeriodAt(Number(e.target.value)); setView("available"); }}>{[...viewport.periods].reverse().map((period, index) => <option value={period.start} key={period.start}>{index === 0 ? "Latest: " : "Earlier: "}{terminalUtc(period.start)} - {period.frames} snapshots</option>)}</select></label>}
    </div>
    <div className="terminal-history-legend"><span><i className="bid" />Bids</span><span><i className="ask" />Offers</span><span><i className="mid" />Mid-price</span><span><i className="unknown" />No observation</span><label><input type="checkbox" checked={log} onChange={e => setLog(e.target.checked)} />Log intensity</label></div>
    {history && <p className="terminal-hint">{history.source} · {history.depthLevels} levels per side · {Math.round(history.sampleIntervalMs / 1000)}s sampling · {viewport?.totalFrames ?? 0} retained snapshots in the selected interval: {terminalUtc(history.requestedStart)} to {terminalUtc(history.requestedEnd)}.</p>}
    {history && <p className="terminal-history-coverage" role="status" data-history-coverage={history.status}>{model ? <>{view === "available" ? "Fitted to " + (effectiveDisplaySpan === null ? "the full captured period" : effectiveDisplaySpan === 900_000 ? "up to the latest 15 captured minutes" : "up to the latest captured hour") + "; the full selected interval is available above. " : "Showing the complete selected interval, including missing history. "}{model.representedFrames} real snapshots visible. {model.representedFrames === 1 ? "One snapshot cannot establish persistence. " : ""}{history.gaps.length ? history.gaps.length + " missing source interval(s); see their exact times below. " : ""}Hatched time and price areas have no retained observation.</> : "No usable retained observations in this interval yet."}</p>}
    {error && <p role="alert">{error}</p>}{busy && !history && <p>Loading retained liquidity...</p>}
    {model ? <>
      <div className="terminal-heatmap-plot"><div className="terminal-heatmap-axis">{[0, 1, 2, 3, 4].map(index => <span key={index}>{terminalPrice(model.high - (model.high - model.low) * index / 4)}</span>)}</div>
        <canvas ref={ref} role="img" tabIndex={0} aria-label="Historical bid and offer liquidity. Hover or tap for price and source time; arrow keys inspect samples." onPointerMove={e => inspect(e.clientX, e.clientY)} onClick={e => inspect(e.clientX, e.clientY)} onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return; e.preventDefault();
          setSelection(s => ({ column: Math.max(0, Math.min(model.columns.length - 1, (s?.column ?? 0) + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0))), row: Math.max(0, Math.min(model.rowCount - 1, (s?.row ?? 0) + (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0))) }));
        }} />
        <div className="terminal-heatmap-retention" aria-label="Retained time coverage">{retainedIntervals.map(interval => <i key={interval.start} style={{ left: (interval.start - model.start) / (model.end - model.start) * 100 + "%", width: (interval.end - interval.start) / (model.end - model.start) * 100 + "%" }} />)}</div>
      </div>
      <div className="terminal-history-axis"><span>{terminalUtc(model.start)}</span><span>{terminalUtc((model.start + model.end) / 2)}</span><span>{terminalUtc(model.end)}</span></div>
      <div className="terminal-heatmap-inspector" aria-live="polite" data-source-at={cell?.sourceAt ?? ""}>{cell ? <>
        <b>{terminalPrice(cell.low)} - {terminalPrice(cell.high)}</b><span>{cell.sourceAt === null ? "No retained observation at the selected time" : "Source " + terminalUtc(cell.sourceAt)}</span>
        {cell.knownAt !== null && <span>Retrieved {terminalUtc(cell.knownAt)}</span>}
        {cell.clockOffsetMs !== null && <span>Exchange clock {cell.clockOffsetMs >= 0 ? "ahead of" : "behind"} local retrieval by {Math.abs(cell.clockOffsetMs / 1000).toFixed(2)}s; official HTTPS calibration uncertainty ±{((cell.clockUncertaintyMs ?? 0) / 1000).toFixed(2)}s. Source and retrieval clocks remain separate.</span>}
        <span>{cell.bid === null ? "Bids unknown outside retained coverage" : "Bids " + terminalPrice(cell.bid, 6) + " " + unit} · {cell.ask === null ? "Offers unknown outside retained coverage" : "Offers " + terminalPrice(cell.ask, 6) + " " + unit}</span>
        {cell.gaps.length > 0 && <span>Source gap in this display bucket: {cell.gaps.map(gap => gap.reason).filter((value, index, all) => all.indexOf(value) === index).join("; ")}</span>}
      </> : "Hover or tap a cell to see its source time, price band and displayed quantities."}</div>
    </> : <div className="terminal-empty"><b>Building genuine liquidity history</b><p>Historical exchange archives and new retained observations populate this view. Current depth is never copied into missing time.</p></div>}
    <p className="terminal-hint">{history?.backfill.message ?? "Enable the market-history collector to retain observations."} Color shows resting size in one snapshot, not traded volume or liquidation prices. The timeline keeps actual elapsed time; gaps are never compressed or filled with the current book.</p>
    {history?.gaps.length ? <details className="terminal-heatmap-gaps"><summary>Missing source intervals · {history.gaps.length}</summary><ul>{history.gaps.slice(0, 12).map((gap, index) => <li key={index}>{terminalUtc(gap.start)} to {terminalUtc(gap.end)} · {gap.reason}</li>)}</ul>{history.gaps.length > 12 && <p>More intervals are retained in the source response.</p>}</details> : null}
    <button type="button" disabled={disabled || collecting} onClick={onCollect}>{collecting ? "Updating market history..." : "Update missing market history"}</button><p className="terminal-hint">Collection saves new exchange executions and book snapshots. Backfill requests older exchange records for missing intervals in batches and resumes from saved progress. This view updates automatically; use this button to retry now. It does not generate a report or place a trade. Older order-book gaps remain visible when the exchange has not published an archive yet.</p>{disabled && <p className="terminal-hint">An active Terminal pass is required to collect or refresh market history.</p>}
  </section>;
}
