import { useState } from "react";
import { API_BASE } from "./api";
import { connectWallet, getInjectedProvider } from "./wallet";
import "./telegramExperience.css";

/** Only this explicit browser page loads wallet connectors. The Mini App stays wallet-free. */
export function TelegramWalletLinkPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("walletLink") || "");
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${API_BASE}/v1/telegram/wallet-link/${path}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), cache:"no-store", referrerPolicy:"no-referrer", signal:AbortSignal.timeout(20000) });
    const data = await response.json(); if(!response.ok) throw new Error(data.error || "Wallet linking failed"); return data;
  };
  const connect = async () => {
    setBusy(true); setError("");
    try {
      if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("This wallet link is incomplete. Start Link history wallet in the PULSE bot.");
      const connected = await connectWallet("xlayer","auto",{switchNetwork:false});
      const challenge = await request("challenge",{token,wallet:connected.address});
      setWallet(connected.address); setAccountId(challenge.telegramUserId); setMessage(challenge.message);
    } catch(reason) { setError(reason instanceof Error ? reason.message : "Wallet connection failed"); }
    finally { setBusy(false); }
  };
  const sign = async () => {
    setBusy(true); setError("");
    try {
      const provider = getInjectedProvider(); if(!provider) throw new Error("Connect your wallet again, or open this page in your mobile wallet browser.");
      const accounts = await provider.request({method:"eth_accounts"}) as string[];
      if(accounts[0]?.toLowerCase() !== wallet.toLowerCase()) throw new Error("Wallet account changed. Connect again to request a new message.");
      const signature = await provider.request({method:"personal_sign",params:[message,wallet]});
      if(typeof signature !== "string") throw new Error("Wallet returned no signature");
      await request("signature",{token,wallet,signature});setSigned(true);
      window.history.replaceState(window.history.state,"",window.location.pathname);
    } catch(reason) { setError(reason instanceof Error ? reason.message : "Wallet signature failed"); }
    finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.href); setError("Link copied. Paste it into your mobile wallet’s browser, then return to Telegram after signing."); } catch { setError("Copy this page address into your mobile wallet browser."); } };
  return <div className="tg-mini tg-link-page"><header className="tg-mini-header"><a className="tg-brand" href="/telegram">PULSE <small>WALLET LINK</small></a></header><main className="tg-mini-main"><span className="tg-kicker">CONNECT YOUR HISTORY</span><h1>One wallet.<br/><em>Every PULSE device.</em></h1><p className="tg-fine">Link the wallet that paid for your website or mobile-browser reports. Your Telegram account can then read those reports across supported networks.</p>{error && <div role="status" className="tg-mini-notice">{error}</div>}{signed ? <section className="tg-report-handoff"><h3>Ownership verified ✓</h3><p>Return to the PULSE bot, tap Review signed wallet and confirm the exact address. The association is created only after that confirmation.</p><code>{wallet}</code><p className="tg-fine">The link grants report history access. It does not authorize payments or trades.</p></section> : <><button className="tg-button" disabled={busy} onClick={() => void connect()}>{busy ? "Check your wallet…" : wallet ? "Reconnect wallet" : "Connect wallet"}<span>↗</span></button><button className="tg-inline-button" onClick={() => void copy()}>Use a mobile wallet browser: copy this link ↗</button>{wallet && <section className="tg-report-handoff"><h3>Review this association</h3><p>Telegram account ID: <b>{accountId}</b></p><code>{wallet}</code><pre className="tg-link-message">{message}</pre><button className="tg-button" disabled={busy} onClick={() => void sign()}>{busy ? "Verify in wallet…" : "Sign ownership message"}<span>→</span></button></section>}</>}<p className="tg-fine">Use your own wallet and Telegram account. The saved association lasts until you explicitly change or unlink it in Telegram. No chain switch, transaction or gas is required. This flow supports EVM wallets with personal message signatures.</p></main></div>;
}
