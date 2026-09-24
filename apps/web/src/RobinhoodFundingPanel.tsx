import { useEffect, useRef, useState } from "react";
import { createPublicClient, formatUnits, http, parseEther } from "viem";
import { apiPost } from "./api";
import { getInjectedProvider, shortAddr } from "./wallet";
import { switchWalletNetwork, WEB_NETWORKS } from "./networks";
import { submitRobinhoodFunding, validateFundingQuote, type RobinhoodFundingQuote } from "./robinhoodFunding";
const fundingReceipts = createPublicClient({ transport: http(WEB_NETWORKS.robinhood.rpc, { timeout: 12_000, retryCount: 0 }) });

export function RobinhoodFunding({ address, balance, onRefresh }: { address: string | null; balance: number | null; onRefresh: () => void }) {
  const [amount, setAmount] = useState("0.0001");
  const [quote, setQuote] = useState<RobinhoodFundingQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const [receiptState, setReceiptState] = useState<"pending" | "confirmed" | "reverted" | "unavailable">("pending");
  const [receiptAttempt, setReceiptAttempt] = useState(0);
  const refreshBalance = useRef(onRefresh);
  refreshBalance.current = onRefresh;
  const [now, setNow] = useState(Date.now());
  const locked = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1; setQuote(null); setError(""); setHash("");
    return () => { generation.current += 1; };
  }, [address]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!hash || !address) return;
    let current = true;
    setReceiptState("pending");
    void (async () => {
      if (await fundingReceipts.getChainId() !== 4663) throw new Error("Wrong receipt network");
      const receipt = await fundingReceipts.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 2, timeout: 90_000 });
      if (receipt.from.toLowerCase() !== address.toLowerCase()) throw new Error("Receipt wallet mismatch");
      if (current) {
        setReceiptState(receipt.status === "success" ? "confirmed" : "reverted");
        refreshBalance.current();
      }
    })().catch(() => { if (current) setReceiptState("unavailable"); });
    return () => { current = false; };
  }, [hash, address, receiptAttempt]);
  const expired = !!quote && quote.expiresAt <= now;
  async function act(sign: boolean) {
    if (!address || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    const version = generation.current;
    try {
      if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n) throw new Error("Enter a positive ETH amount.");
      const value = parseEther(amount);
      if (!sign) {
        const response = await apiPost("/v1/dex/robinhood/native-usdg", { amount: value.toString(), userWalletAddress: address });
        if (!response.ok) throw new Error((response.data as { error?: string })?.error || "A USDG quote is unavailable. Try again.");
        const next = response.data as RobinhoodFundingQuote;
        validateFundingQuote(next, address, value);
        if (generation.current === version) { setQuote(next); setHash(""); }
      } else {
        if (!quote) throw new Error("Get a fresh quote first.");
        const provider = getInjectedProvider();
        if (!provider) throw new Error("Connect your wallet first.");
        await switchWalletNetwork(provider, "robinhood");
        if (generation.current !== version) return;
        const txHash = await submitRobinhoodFunding(provider, quote, address, value);
        if (generation.current === version) { setHash(txHash); setQuote(null); onRefresh(); }
      }
    } catch (cause) {
      if (generation.current === version) setError(cause instanceof Error ? cause.message : "Funding failed. Check wallet activity before retrying.");
    } finally { locked.current = false; if (generation.current === version) setBusy(false); }
  }
  return <div className="native-swap robinhood-funding">
    <h4>Swap ETH → USDG</h4>
    <p>Fund research payments on Robinhood. You review the quote and sign one wallet transaction; no token approval is needed.</p>
    <div className="swap-asset-card"><div><span>You pay</span><small>Balance: {balance == null ? "—" : balance.toFixed(6)} ETH</small></div>
      <div className="swap-input-row"><input aria-label="ETH to USDG funding amount" inputMode="decimal" value={amount} disabled={busy}
        onChange={e => { setAmount(e.target.value); setQuote(null); setError(""); }} /><strong>ETH</strong></div></div>
    <div className="swap-arrow" aria-hidden>↓</div>
    <div className="swap-asset-card receive"><span>Estimated receive</span><div className="swap-output">{quote ? formatUnits(BigInt(quote.toAmount), 6) : "—"}<strong>USDG</strong></div></div>
    {quote && <div className="quote-meta"><span>Minimum received<b>{formatUnits(BigInt(quote.minToAmount), 6)} USDG</b></span>
      <span>Slippage limit<b>0.5%</b></span><span>Route<b>{quote.route.join(" + ") || "OKX DEX"}</b></span></div>}
    {expired && <p role="status">Quote expired. Refresh it before signing.</p>}
    <button type="button" className={`btn ${quote && !expired ? "btn-primary" : "btn-soft"} full`} disabled={!address || busy || (!!hash && (receiptState === "pending" || receiptState === "unavailable"))}
      onClick={() => void act(!!quote && !expired)}>{busy ? "Checking wallet and route…" : quote && !expired ? "Review & swap in wallet" : "Get live ETH → USDG quote"}</button>
    <p className="gas-note">Keep ETH for gas. PULSE checks Robinhood, USDG, your recipient address, the quoted amount and minimum received, then simulates before signing.</p>
    {error && <div className="swap-message error" role="alert">{error}</div>}
    {hash && <div className={`swap-message ${receiptState === "confirmed" ? "success" : receiptState === "reverted" ? "error" : ""}`} role="status">{receiptState === "confirmed" ? "Swap confirmed; balances refreshed" : receiptState === "reverted" ? "Swap reverted; check the transaction details" : receiptState === "unavailable" ? "Confirmation unavailable; check this transaction before another swap" : "Submitted; confirmation pending"} · <a href={`https://robinhoodchain.blockscout.com/tx/${hash}`} target="_blank" rel="noreferrer">{shortAddr(hash)} ↗</a>
      {receiptState === "unavailable" && <button type="button" className="btn btn-soft" onClick={() => setReceiptAttempt(value => value + 1)}>Check confirmation</button>}
      <button type="button" className="btn btn-soft" onClick={onRefresh}>Refresh balances</button></div>}
  </div>;
}
