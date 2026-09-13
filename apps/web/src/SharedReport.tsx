import { useEffect, useState } from "react";
import { API_BASE } from "./api";
import { AnalysisReport, PredictionAnalysisReport } from "./Report";

/** Read-only bearer-share viewer. Never connects a wallet or prepares a trade. */
export function SharedReport() {
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("share") || "";
    if (!/^[A-Za-z0-9_-]{24,256}$/.test(token)) { setError("This report link is incomplete. Open the full link from your PULSE bot message."); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let active = true;
    setError(""); setReport(null);
    void fetch(`${API_BASE}/v1/shared/reports/${encodeURIComponent(token)}`, { signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 404 || response.status === 403 ? "This share is unavailable or has been revoked. Recover the report through Paid report history in PULSE—do not pay again." : "The report service is temporarily unavailable. Retry this existing link without another payment.");
        const body = await response.json() as { report?: Record<string, unknown> };
        if (!body.report || typeof body.report !== "object" || Array.isArray(body.report)) throw new Error("The report response was incomplete. Retry without paying again.");
        if (active) setReport(body.report);
      }).catch(reason => { if (active) setError(controller.signal.aborted ? "Loading timed out. Retry this report without another payment." : reason instanceof Error ? reason.message : "Unable to load this report."); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  const prediction = report?.mode === "prediction" || Boolean(report?.predictionContext);
  return <main className="shared-report-page">
    <header><div><span className="eyebrow">PULSE · SHARED RESEARCH</span><h1>Your report</h1></div><a className="btn btn-soft" href="/portfolio" rel="noreferrer">Open PULSE</a></header>
    <p className="shared-report-notice">Read-only report. Anyone with this link can read it until the share is revoked. Opening it never charges, connects a wallet or places an order.</p>
    {error ? <section className="card" role="alert"><h2>Report unavailable</h2><p>{error}</p><button type="button" className="btn btn-soft" onClick={() => setAttempt(value => value + 1)}>Retry existing report</button></section>
      : report ? <section className="card">{prediction ? <PredictionAnalysisReport data={report} /> : <AnalysisReport data={report} nfa="Research, not financial advice. Scenarios are not guarantees." />}</section>
      : <p role="status">Opening your paid report… No new payment is needed.</p>}
  </main>;
}
