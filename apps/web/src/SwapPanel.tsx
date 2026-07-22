import { useEffect, useState } from "react";
import type { WalletBalances } from "./balances";
import { fmtBal, USDT0_ADDRESS } from "./balances";
import { apiGet, apiPost } from "./api";
import { getInjectedProvider, shortAddr } from "./wallet";

type Props = {
  lang: "en" | "zh"; open: boolean; address: string | null; walletName: string;
  balances: WalletBalances | null; loadingBal: boolean; emphasize?: boolean;
  onClose: () => void; onDisconnect: () => void; onRefresh: () => void;
};

type DexQuote = {
  fromTokenAmount: string;
  toTokenAmount: string;
  priceImpactPercent: string;
  estimateGas: string;
  tradeFee: string;
  route: string[];
};

type DexTransaction = {
  from: string; to: string; data: string; value: string; gas: string;
  gasPrice: string; maxPriorityFeePerGas?: string | null;
};

function parseOkb(value: string): bigint {
  if (!/^\d+(\.\d{0,18})?$/.test(value)) throw new Error("Enter a valid OKB amount");
  const [whole, fraction = ""] = value.split(".");
  const atomic = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0") || "0");
  if (atomic <= 0n) throw new Error("Amount must be greater than zero");
  return atomic;
}

function formatUsdt0(atomic: string): string {
  const value = BigInt(atomic || "0");
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function quantity(value: string): string {
  return `0x${BigInt(value || "0").toString(16)}`;
}

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) return String((data as { error: unknown }).error);
  return fallback;
}

export function SwapPanel({ lang, open, address, walletName, balances, loadingBal, emphasize, onClose, onDisconnect, onRefresh }: Props) {
  const [amount, setAmount] = useState("0.001");
  const [quote, setQuote] = useState<DexQuote | null>(null);
  const [swapBusy, setSwapBusy] = useState<"quote" | "swap" | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const copy = {
    en: { eyebrow: "X Layer wallet", title: "Wallet & funding", subtitle: "Balances, payment readiness, and swapping in one place.", disconnected: "Connect once from the header to view balances and swap on X Layer.", okb: "OKB", okbRole: "Network gas", usdt: "USDT0", usdtRole: "x402 payments", ready: "Ready to pay", low: "Top up USDT0", refresh: "Refresh", disconnect: "Disconnect", swapTitle: "Swap OKB → USDT0", swapHelp: "A native PULSE swap flow powered by the official OKX Exchange OS DEX API. The connected header wallet signs directly—there is no second wallet session.", connected: "Connected wallet", amount: "You pay", balance: "Balance", getQuote: "Get live quote", quoting: "Finding best route…", receive: "You receive", route: "Route", impact: "Price impact", swap: "Review & swap in wallet", swapping: "Preparing transaction…", success: "Transaction submitted", openDex: "Open OKX DEX", close: "Close wallet panel", reserve: "Leave a small OKB reserve for network gas.", noCredentials: "Live OKX DEX funding is unavailable on this deployment." },
    zh: { eyebrow: "X Layer 钱包", title: "钱包与充值", subtitle: "余额、支付状态和兑换集中在一个面板。", disconnected: "请从页眉连接一次钱包，以查看余额并在 X Layer 上兑换。", okb: "OKB", okbRole: "网络 Gas", usdt: "USDT0", usdtRole: "x402 支付", ready: "可以支付", low: "充值 USDT0", refresh: "刷新", disconnect: "断开", swapTitle: "兑换 OKB → USDT0", swapHelp: "PULSE 原生兑换流程，由 OKX Exchange OS 官方 DEX API 提供。页眉中已连接的钱包直接签名，无需第二次连接。", connected: "已连接钱包", amount: "支付", balance: "余额", getQuote: "获取实时报价", quoting: "正在寻找最佳路由…", receive: "预计收到", route: "路由", impact: "价格影响", swap: "在钱包中确认兑换", swapping: "正在准备交易…", success: "交易已提交", openDex: "打开 OKX DEX", close: "关闭钱包面板", reserve: "请保留少量 OKB 用于网络 Gas。", noCredentials: "此部署暂未启用 OKX DEX 实时充值。" },
  }[lang];

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.classList.add("drawer-open");
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.classList.remove("drawer-open"); window.removeEventListener("keydown", closeOnEscape); };
  }, [open, onClose]);

  useEffect(() => {
    setQuote(null);
    setSwapError(null);
    setTxHash(null);
  }, [address]);

  async function loadQuote(): Promise<DexQuote> {
    if (!address) throw new Error(copy.disconnected);
    const atomic = parseOkb(amount);
    if (balances && Number(amount) > Math.max(0, balances.okb - 0.00005)) {
      throw new Error(`${copy.reserve} ${copy.balance}: ${fmtBal(balances.okb, 6)} OKB`);
    }
    setSwapBusy("quote");
    setSwapError(null);
    setTxHash(null);
    try {
      const response = await apiGet(`/v1/dex/quote?amount=${atomic}`);
      if (!response.ok) throw new Error(apiError(response.data, copy.noCredentials));
      const next = response.data as DexQuote;
      setQuote(next);
      return next;
    } finally {
      setSwapBusy(null);
    }
  }

  async function executeSwap() {
    if (!address) return;
    setSwapBusy("swap");
    setSwapError(null);
    setTxHash(null);
    try {
      const atomic = parseOkb(amount);
      if (!quote) throw new Error(copy.getQuote);
      const response = await apiPost("/v1/dex/swap", {
        amount: atomic.toString(),
        userWalletAddress: address,
        slippagePercent: 0.5,
      });
      if (!response.ok) throw new Error(apiError(response.data, copy.noCredentials));
      const tx = (response.data as { tx?: DexTransaction }).tx;
      if (!tx || !/^0x[a-fA-F0-9]{40}$/.test(tx.to) || !/^0x[a-fA-F0-9]*$/.test(tx.data)) {
        throw new Error("OKX DEX returned an invalid transaction");
      }
      if (tx.from.toLowerCase() !== address.toLowerCase()) {
        throw new Error("OKX DEX transaction wallet mismatch");
      }
      if (BigInt(tx.value || "0") !== atomic) {
        throw new Error("OKX DEX transaction amount mismatch");
      }
      const provider = getInjectedProvider();
      if (!provider) throw new Error(copy.disconnected);
      const chainId = await provider.request({ method: "eth_chainId" });
      if (chainId !== "0xc4" && chainId !== "0xC4") {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xc4" }],
        });
      }
      const request: Record<string, string> = {
        from: address,
        to: tx.to,
        data: tx.data,
        value: quantity(tx.value),
      };
      if (BigInt(tx.gas || "0") > 0n) request.gas = quantity(tx.gas);
      if (BigInt(tx.gasPrice || "0") > 0n) request.gasPrice = quantity(tx.gasPrice);
      const hash = await provider.request({ method: "eth_sendTransaction", params: [request] });
      if (typeof hash !== "string") throw new Error("Wallet returned no transaction hash");
      setTxHash(hash);
      setQuote(null);
      onRefresh();
    } catch (error) {
      setSwapError(error instanceof Error ? error.message : String(error));
    } finally {
      setSwapBusy(null);
    }
  }

  if (!open) return null;
  const paymentReady = Boolean(balances && balances.usdt0 >= 0.01);
  const dexUrl = `https://web3.okx.com/dex-swap#srcChain=196&dstChain=196&toTokenAddress=${USDT0_ADDRESS}`;
  return (
    <div className="wallet-layer" role="dialog" aria-modal="true" aria-label={copy.title}>
      <button className="wallet-backdrop" type="button" onClick={onClose} aria-label={copy.close} />
      <aside className={`wallet-drawer ${emphasize ? "warn" : ""}`}>
        <header className="drawer-header"><div><span className="eyebrow">{copy.eyebrow}</span><h2>{copy.title}</h2><p>{copy.subtitle}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label={copy.close}>×</button></header>
        {!address ? (
          <div className="wallet-empty"><div className="wallet-orb" aria-hidden>↗</div><p>{copy.disconnected}</p></div>
        ) : (
          <>
            <div className="account-row"><div className="account-avatar">{address.slice(2, 4).toUpperCase()}</div><div><strong>{shortAddr(address)}</strong><span>{walletName} · X Layer</span></div><button type="button" className="text-button" onClick={onDisconnect}>{copy.disconnect}</button></div>
            <div className="balance-grid"><div className="balance-card"><div><span>{copy.okb}</span><small>{copy.okbRole}</small></div><strong>{balances ? fmtBal(balances.okb, 6) : "—"}</strong></div><div className={`balance-card payment ${emphasize ? "low" : ""}`}><div><span>{copy.usdt}</span><small>{copy.usdtRole}</small></div><strong>{balances ? fmtBal(balances.usdt0, 6) : "—"}</strong></div></div>
            <div className={`readiness ${paymentReady && !emphasize ? "ready" : "needs-funds"}`}><span className="status-dot" /><span>{paymentReady && !emphasize ? copy.ready : copy.low}</span><button type="button" onClick={onRefresh} disabled={loadingBal}>{loadingBal ? "…" : copy.refresh}</button></div>
          </>
        )}
        <section className="swap-section">
          <div className="swap-title-row"><div><span className="eyebrow">OKX EXCHANGE OS</span><h3>{copy.swapTitle}</h3></div><a href={dexUrl} target="_blank" rel="noreferrer">{copy.openDex} ↗</a></div>
          {address && <div className="connected-wallet-status"><span className="status-dot" />{copy.connected} · {shortAddr(address)}</div>}
          <p>{copy.swapHelp}</p>
          <div className="native-swap">
            <div className="swap-asset-card">
              <div><span>{copy.amount}</span><small>{copy.balance}: {balances ? fmtBal(balances.okb, 6) : "—"} OKB</small></div>
              <div className="swap-input-row"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); setSwapError(null); }} aria-label={`${copy.amount} OKB`} /><strong>OKB</strong></div>
            </div>
            <div className="swap-arrow" aria-hidden>↓</div>
            <div className="swap-asset-card receive">
              <div><span>{copy.receive}</span><small>USDT0 · X Layer</small></div>
              <div className="swap-output">{quote ? formatUsdt0(quote.toTokenAmount) : "—"}<strong>USDT0</strong></div>
            </div>
            {quote && <div className="quote-meta"><span>{copy.route}<b>{quote.route.join(" + ") || "OKX DEX"}</b></span><span>{copy.impact}<b>{quote.priceImpactPercent}%</b></span></div>}
            {!quote ? <button type="button" className="btn btn-soft full" disabled={!address || swapBusy !== null} onClick={() => void loadQuote().catch((error) => setSwapError(error instanceof Error ? error.message : String(error)))}>{swapBusy === "quote" ? copy.quoting : copy.getQuote}</button> : <button type="button" className="btn btn-primary full" disabled={!address || swapBusy !== null} onClick={() => void executeSwap()}>{swapBusy === "swap" ? copy.swapping : copy.swap}</button>}
            <p className="gas-note">{copy.reserve}</p>
            {swapError && <div className="swap-message error">{swapError}</div>}
            {txHash && <div className="swap-message success">{copy.success} · <a href={`https://www.oklink.com/x-layer/tx/${txHash}`} target="_blank" rel="noreferrer">{shortAddr(txHash)} ↗</a></div>}
          </div>
        </section>
      </aside>
    </div>
  );
}
