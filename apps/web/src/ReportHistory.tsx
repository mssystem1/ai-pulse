import { useState } from "react";
import { API_BASE } from "./api";
import { forgetJobRecovery, listJobRecoveries, type JobRecoveryScope } from "./jobRecovery";
import type { WebNetworkKey } from "./networks";
import { switchWalletNetwork } from "./networks";
import { getInjectedProvider } from "./wallet";

type RemoteReport = { id: string; mode: string; tier: string | null; stage: string; label: string; createdAt: string; ready: boolean };
const TERMINAL_REPORT_STAGES = new Set(["failed_retriable", "failed_terminal", "manual_reconciliation"]);

export function ReportHistory({ networkKey, scope, wallet, onOpen }: { networkKey: WebNetworkKey; scope: JobRecoveryScope; wallet: string | null; onOpen: (report: Record<string, unknown>) => void }) {
  const [, rerender] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState<RemoteReport[]>([]);
  const [sessionToken, setSessionToken] = useState("");
  const items = listJobRecoveries(localStorage, networkKey, scope);

  async function loadWalletHistory(token: string) {
    const response = await fetch(`${API_BASE}/v1/report-history?fresh=${Date.now()}`, { headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" }, cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 ? "Wallet history session expired. Sign again to continue." : `Wallet history failed (${response.status})`);
    const body = await response.json() as { reports?: RemoteReport[] };
    setRemote((body.reports || []).filter((item) => scope === "spot" ? item.mode === "spot" : item.mode === "prediction"));
  }

  async function syncWalletHistory() {
    if (!wallet) return setMessage("Connect the report-paying wallet first.");
    const provider = getInjectedProvider();
    if (!provider) return setMessage("Open PULSE inside your wallet browser or connect a wallet that supports message signing.");
    setBusy("sync"); setMessage("");
    try {
      if (networkKey !== "arc-testnet") await switchWalletNetwork(provider, networkKey);
      const challengeResponse = await fetch(`${API_BASE}/v1/report-history/challenge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, networkKey }) });
      if (!challengeResponse.ok) throw new Error(`Could not create wallet history challenge (${challengeResponse.status})`);
      const challenge = await challengeResponse.json() as { nonce: string; message: string };
      const signature = await provider.request({ method: "personal_sign", params: [challenge.message, wallet] });
      if (typeof signature !== "string") throw new Error("Wallet returned no history signature");
      const sessionResponse = await fetch(`${API_BASE}/v1/report-history/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, networkKey, nonce: challenge.nonce, signature }) });
      const sessionBody = await sessionResponse.json() as { sessionToken?: string; error?: string };
      if (!sessionResponse.ok || !sessionBody.sessionToken) throw new Error(sessionBody.error || "Wallet history authorization failed");
      setSessionToken(sessionBody.sessionToken);
      await loadWalletHistory(sessionBody.sessionToken);
      setMessage("Wallet history synchronized from KV and private Blob storage.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }

  async function openRemote(jobId: string) {
    if (!sessionToken) return setMessage("Sign in to wallet history again.");
    setBusy(jobId); setMessage("");
    try {
      const response = await fetch(`${API_BASE}/v1/report-history/${encodeURIComponent(jobId)}/report?fresh=${Date.now()}`, { headers: { Authorization: `Bearer ${sessionToken}`, "Cache-Control": "no-cache" }, cache: "no-store" });
      const body = await response.json() as { report?: Record<string, unknown>; error?: string };
      if (!response.ok || !body.report) throw new Error(body.error || `Report recovery failed (${response.status})`);
      onOpen(body.report); setMessage("Private Blob report restored for the connected wallet.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }

  async function retryRemote(jobId: string) {
    if (!sessionToken) return setMessage("Sign in to wallet history again.");
    setBusy(jobId); setMessage("");
    try {
      const response = await fetch(`${API_BASE}/v1/report-history/${encodeURIComponent(jobId)}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}`, "Cache-Control": "no-cache" },
        cache: "no-store",
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `Report retry failed (${response.status})`);
      await loadWalletHistory(sessionToken);
      setMessage("Recovery restarted from the settled receipt. No new payment was created; refresh wallet history when generation completes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }

  async function open(jobId: string, recoveryToken: string) {
    setBusy(jobId); setMessage("");
    try {
      const headers = { "PULSE-RECOVERY-TOKEN": recoveryToken };
      const status = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}?fresh=${Date.now()}`, { headers: { ...headers, "Cache-Control": "no-cache" }, cache: "no-store" });
      if (!status.ok) throw new Error(`History lookup failed (${status.status})`);
      const statusBody = await status.json() as { job?: { stage?: string } };
      const stage = statusBody.job?.stage || "unknown";
      if (stage !== "completed" && stage !== "completed_partial") throw new Error(`Report is ${stage.replaceAll("_", " ")}; retry when processing completes.`);
      const response = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}/report?fresh=${Date.now()}`, { headers: { ...headers, "Cache-Control": "no-cache" }, cache: "no-store" });
      if (!response.ok) throw new Error(`Report recovery failed (${response.status})`);
      const body = await response.json() as { report?: Record<string, unknown> };
      if (!body.report) throw new Error("Stored report payload is unavailable");
      onOpen(body.report); setMessage("Report restored without a new payment.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }

  return <section className="report-history" aria-label="Report history">
    <div className="report-history-head"><div><span className="eyebrow">WALLET-OWNED · CROSS-DEVICE</span><h3>Paid report history</h3></div><button type="button" className="btn btn-soft" disabled={Boolean(busy) || !wallet} onClick={() => void syncWalletHistory()}>{busy === "sync" ? "Check wallet…" : remote.length ? "Refresh wallet history" : "Sync with wallet"}</button></div>
    <p>Reports are stored privately in Blob and indexed by paying wallet in KV. Sign a report-access message to open them or retry an already-settled failure on desktop, iOS, Android or Mac. The signature cannot create a payment or trade.</p>
    {remote.length ? <div className="report-history-list remote-history">{remote.map((item) => {
      const retryable = TERMINAL_REPORT_STAGES.has(item.stage);
      return <article key={item.id}>
        <div><strong>{item.label}</strong><span>{item.tier || "paid"} · {new Date(item.createdAt).toLocaleString()} · {item.stage.replaceAll("_", " ")}</span></div>
        <button type="button" disabled={Boolean(busy) || (!item.ready && !retryable)} onClick={() => void (retryable ? retryRemote(item.id) : openRemote(item.id))}>{busy === item.id ? (retryable ? "Restarting…" : "Opening…") : item.ready ? "Open" : retryable ? "Retry" : "Processing"}</button>
      </article>;
    })}</div> : <div className="report-history-empty">{wallet ? "Sign once to load reports purchased by this wallet on the selected network." : "Connect the wallet that paid for the reports."}</div>}
    {items.length ? <details className="device-recovery"><summary>This-device recovery fallback · {items.length}</summary><p>These opaque capabilities can recover recent jobs without another wallet signature on this browser.</p><div className="report-history-list">{items.map((item) => <article key={item.jobId}>
      <div><strong>{item.label || `${scope === "spot" ? "Global" : "Prediction"} report`}</strong><span>{item.tier || "paid"} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : item.jobId.slice(0, 8)}</span></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => void open(item.jobId, item.recoveryToken)}>{busy === item.jobId ? "Opening…" : "Open"}</button>
      <button type="button" className="forget" disabled={Boolean(busy)} aria-label="Forget this report on this device" onClick={() => { forgetJobRecovery(localStorage, networkKey, scope, item.jobId); rerender((value) => value + 1); }}>Forget</button>
    </article>)}</div></details> : null}
    {message && <div className="report-history-message">{message}</div>}
  </section>;
}
