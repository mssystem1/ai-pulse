import { useEffect, useState } from "react";
import { fmtBal, USDT0_ADDRESS } from "./balances";
import { apiGet, apiPost } from "./api";
import { WEB_NETWORKS, depositArcGateway, type WebNetworkKey } from "./networks";
import { getInjectedProvider, shortAddr } from "./wallet";

type Props = {
  lang: "en" | "zh"; open: boolean; address: string | null; walletName: string;
  networkKey: WebNetworkKey; balances: { native: number; payment: number } | null;
  gatewayBalance: number | null; loadingBal: boolean; emphasize?: boolean;
  onClose: () => void; onDisconnect: () => void; onRefresh: () => void;
  onOkxConnect: () => void; onOtherWalletConnect: () => void; onCircleConnect: (email: string) => Promise<void>;
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
type CdpQuote = { network: "base" | "arbitrum"; fromAmount: string; toAmount: string; minToAmount: string; toToken: string; liquidityAvailable: boolean; transaction: DexTransaction };

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

export function SwapPanel({ lang, open, address, walletName, networkKey, balances, gatewayBalance, loadingBal, emphasize, onClose, onDisconnect, onRefresh, onOkxConnect, onOtherWalletConnect, onCircleConnect }: Props) {
  const [amount, setAmount] = useState("0.001");
  const [quote, setQuote] = useState<DexQuote | null>(null);
  const [swapBusy, setSwapBusy] = useState<"quote" | "swap" | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [gatewayAmount, setGatewayAmount] = useState("1");
  const [arcBalanceView, setArcBalanceView] = useState<"wallet" | "gateway">("wallet");
  const [fundingBusy, setFundingBusy] = useState(false);
  const [cdpQuote, setCdpQuote] = useState<CdpQuote | null>(null);
  const [email, setEmail] = useState("");
  const [circleBusy, setCircleBusy] = useState(false);
  const [circleError, setCircleError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const network = WEB_NETWORKS[networkKey];
  const legacyBalances = balances ? { okb: balances.native, usdt0: balances.payment } : null;
  const copy = {
    en: { eyebrow: "X Layer wallet", title: "Wallet & funding", subtitle: "Balances, payment readiness, and swapping in one place.", disconnected: "Connect once from the header to view balances and swap on X Layer.", okb: "OKB", okbRole: "Network gas", usdt: "USDT0", usdtRole: "x402 payments", ready: "Ready to pay", low: "Top up USDT0", refresh: "Refresh", disconnect: "Disconnect", swapTitle: "Swap OKB → USDT0", swapHelp: "A native PULSE swap flow powered by the official OKX Exchange OS DEX API. The connected header wallet signs directly—there is no second wallet session.", connected: "Connected wallet", amount: "You pay", balance: "Balance", getQuote: "Get live quote", quoting: "Finding best route…", receive: "You receive", route: "Route", impact: "Price impact", swap: "Review & swap in wallet", swapping: "Preparing transaction…", success: "Transaction submitted", openDex: "Open OKX DEX", close: "Close wallet panel", reserve: "Leave a small OKB reserve for network gas.", noCredentials: "Live OKX DEX funding is unavailable on this deployment." },
    zh: { eyebrow: "X Layer 钱包", title: "钱包与充值", subtitle: "余额、支付状态和兑换集中在一个面板。", disconnected: "请从页眉连接一次钱包，以查看余额并在 X Layer 上兑换。", okb: "OKB", okbRole: "网络 Gas", usdt: "USDT0", usdtRole: "x402 支付", ready: "可以支付", low: "充值 USDT0", refresh: "刷新", disconnect: "断开", swapTitle: "兑换 OKB → USDT0", swapHelp: "PULSE 原生兑换流程，由 OKX Exchange OS 官方 DEX API 提供。页眉中已连接的钱包直接签名，无需第二次连接。", connected: "已连接钱包", amount: "支付", balance: "余额", getQuote: "获取实时报价", quoting: "正在寻找最佳路由…", receive: "预计收到", route: "路由", impact: "价格影响", swap: "在钱包中确认兑换", swapping: "正在准备交易…", success: "交易已提交", openDex: "打开 OKX DEX", close: "关闭钱包面板", reserve: "请保留少量 OKB 用于网络 Gas。", noCredentials: "此部署暂未启用 OKX DEX 实时充值。" },
  }[lang];

  async function copyAddress() {
    if (!address) return;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(address);
    else {
      const input = document.createElement("textarea");
      input.value = address; input.style.position = "fixed"; input.style.opacity = "0";
      document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

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
    if (legacyBalances && Number(amount) > Math.max(0, legacyBalances.okb - 0.00005)) {
      throw new Error(`${copy.reserve} ${copy.balance}: ${fmtBal(legacyBalances.okb, 6)} OKB`);
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

  async function fundGateway() {
    if (!address) return;
    const provider = getInjectedProvider();
    if (!provider) throw new Error(copy.disconnected);
    setFundingBusy(true);
    setSwapError(null);
    try {
      const tx = await depositArcGateway(provider, address, gatewayAmount);
      setTxHash(tx.depositHash);
      onRefresh();
    } catch (error) {
      setSwapError(error instanceof Error ? error.message : String(error));
    } finally {
      setFundingBusy(false);
    }
  }

  async function loadCdpQuote() {
    if (!address || (networkKey !== "base" && networkKey !== "arbitrum")) return;
    setSwapBusy("quote"); setSwapError(null); setTxHash(null);
    try {
      const atomic = parseOkb(amount);
      const response = await apiPost("/v1/dex/cdp/native-usdc", { network: networkKey, amount: atomic.toString(), userWalletAddress: address });
      if (!response.ok) throw new Error(apiError(response.data, "CDP Trade API quote failed"));
      const next = response.data as CdpQuote;
      if (next.network !== networkKey || next.toToken.toLowerCase() !== network.payment.address.toLowerCase()) throw new Error("Quote network or output asset mismatch");
      setCdpQuote(next);
    } catch (error) { setSwapError(error instanceof Error ? error.message : String(error)); }
    finally { setSwapBusy(null); }
  }

  async function executeCdpSwap() {
    if (!address || !cdpQuote || (networkKey !== "base" && networkKey !== "arbitrum")) return;
    setSwapBusy("swap"); setSwapError(null);
    try {
      const provider = getInjectedProvider();
      if (!provider) throw new Error(copy.disconnected);
      await (await import("./networks")).switchWalletNetwork(provider, networkKey);
      const tx = cdpQuote.transaction;
      if (!/^0x[a-fA-F0-9]{40}$/.test(tx.to) || !/^0x[a-fA-F0-9]*$/.test(tx.data) || BigInt(tx.value) !== BigInt(cdpQuote.fromAmount)) throw new Error("Invalid or changed CDP transaction");
      const request: Record<string, string> = { from: address, to: tx.to, data: tx.data, value: quantity(tx.value) };
      const liveRaw = await provider.request({ method: "eth_getBalance", params: [address, "latest"] });
      const liveBalance = BigInt(String(liveRaw));
      const principal = BigInt(tx.value || "0");
      const gasUnits = BigInt(tx.gas || "0") || BigInt(String(await provider.request({ method: "eth_estimateGas", params: [request] })));
      const gasPrice = BigInt(tx.gasPrice || "0") || BigInt(String(await provider.request({ method: "eth_gasPrice" })));
      const gasCost = gasUnits * gasPrice;
      const required = principal + gasCost;
      if (liveBalance < required) {
        const shortfall = Number(required - liveBalance) / 1e18;
        const available = Number(liveBalance) / 1e18;
        const principalEth = Number(principal) / 1e18;
        const gasEth = Number(gasCost) / 1e18;
        throw new Error(`Insufficient ${network.native.symbol}: ${available.toFixed(6)} available; ${principalEth.toFixed(6)} swap + ${gasEth.toFixed(6)} quoted gas required. Reduce the swap by at least ${shortfall.toFixed(6)} ${network.native.symbol}.`);
      }
      request.gas = quantity(gasUnits.toString());
      request.gasPrice = quantity(gasPrice.toString());
      const hash = await provider.request({ method: "eth_sendTransaction", params: [request] });
      if (typeof hash !== "string") throw new Error("Wallet returned no transaction hash");
      setTxHash(hash); setCdpQuote(null); onRefresh();
    } catch (error) { setSwapError(error instanceof Error ? error.message : String(error)); }
    finally { setSwapBusy(null); }
  }

  if (!open) return null;
  const spendable = networkKey === "arc-testnet" ? gatewayBalance || 0 : balances?.payment || 0;
  const paymentReady = spendable >= 0.01;
  const fundingStatus = networkKey === "xlayer"
    ? (lang === "zh" ? "充值 USDT0" : "Top up USDT0")
    : networkKey === "arc-testnet"
      ? (lang === "zh" ? "将 USDC 存入 Gateway" : "Deposit USDC into Gateway")
      : (lang === "zh" ? "充值 USDC" : "Top up USDC");
  const dexUrl = `https://web3.okx.com/dex-swap#srcChain=196&dstChain=196&toTokenAddress=${USDT0_ADDRESS}`;
  return (
    <div className="wallet-layer" role="dialog" aria-modal="true" aria-label={copy.title}>
      <button className="wallet-backdrop" type="button" onClick={onClose} aria-label={copy.close} />
      <aside className={`wallet-drawer ${emphasize ? "warn" : ""}`}>
        <header className="drawer-header"><div><span className="eyebrow">{network.label} wallet</span><h2>{copy.title}</h2><p>Balances and payment readiness for {network.provider}.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label={copy.close}>×</button></header>
        {!address ? (
          <div className="wallet-empty wallet-connect-options">
            <div className="wallet-orb" aria-hidden>↗</div><div className="wallet-connect-heading"><strong>Connect your wallet</strong><p>Choose the wallet that will sign payments and trades. PULSE never receives your private key.</p></div>
            <button type="button" className="wallet-connect-choice okx" onClick={onOkxConnect}>
              <span className="wallet-choice-logo okx" aria-hidden><i /><i /><i /><i /></span>
              <span><strong>OKX Wallet</strong><small>Recommended · extension or OKX DApp browser</small></span>
              <b aria-hidden>→</b>
            </button>
            <button type="button" className="wallet-connect-choice" onClick={onOtherWalletConnect}>
              <span className="wallet-choice-logo walletconnect" aria-hidden>◫</span>
              <span><strong>Other wallets</strong><small>WalletConnect, MetaMask, Trust Wallet and Base-compatible wallets</small></span>
              <b aria-hidden>→</b>
            </button>
            {networkKey === "arc-testnet" && <>
              <div className="connect-divider"><span>or</span></div>
              <div className="circle-network-notice"><strong>Circle email wallet · Arc Testnet only</strong><span>This test wallet automatically switches PULSE to Arc Testnet. Base, Arbitrum, and X Layer are hidden until you disconnect it.</span></div>
              <label className="circle-email"><span>Email for your Arc Testnet wallet</span><input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setCircleError(null); }} /></label>
              <button type="button" className="btn btn-primary full" disabled={circleBusy || !email.trim()} onClick={() => { setCircleBusy(true); setCircleError(null); void onCircleConnect(email.trim()).catch((error) => setCircleError(error instanceof Error ? error.message : String(error))).finally(() => setCircleBusy(false)); }}>{circleBusy ? "Check your email…" : "Continue on Arc Testnet with Circle"}</button>
              <small className="circle-note">User-controlled Circle EOA. PULSE never receives your private key.</small>
              {circleError && <div className="swap-message error circle-error"><strong>Circle login needs attention</strong><span>{circleError}</span>{/SMTP|email OTP is not configured/i.test(circleError) && <a href="https://console.circle.com" target="_blank" rel="noreferrer">Open Circle Console ↗</a>}</div>}
            </>}
          </div>
        ) : (
          <>
            <div className="account-row"><div className="account-avatar">{address.slice(2, 4).toUpperCase()}</div><div className="account-identity" title={address}><strong>{shortAddr(address)}</strong><span>{walletName} · {network.label}</span></div><button type="button" className={`copy-address-button ${copied ? "copied" : ""}`} title={`Copy ${address}`} aria-label={`Copy wallet address ${address}`} onClick={() => void copyAddress()}><span aria-hidden>{copied ? "✓" : "⧉"}</span>{copied ? "Copied" : "Copy address"}</button><button type="button" className="text-button" onClick={onDisconnect}>{copy.disconnect}</button></div>
            {networkKey === "arc-testnet" ? <div className="arc-balance-panel"><div className="arc-balance-tabs"><button type="button" className={arcBalanceView === "wallet" ? "active" : ""} onClick={() => setArcBalanceView("wallet")}>Wallet USDC</button><button type="button" className={arcBalanceView === "gateway" ? "active" : ""} onClick={() => setArcBalanceView("gateway")}>Gateway USDC</button></div>{arcBalanceView === "wallet" ? <div className="balance-card payment"><div><span>Wallet USDC</span><small>Onchain wallet balance · gas balance {balances ? fmtBal(balances.native, 6) : "—"} USDC</small></div><strong>{balances ? fmtBal(balances.payment, 6) : "—"}</strong></div> : <div className={`balance-card payment ${emphasize ? "low" : ""}`}><div><span>Gateway USDC</span><small>Available for Circle Gateway x402</small></div><strong>{fmtBal(gatewayBalance || 0, 6)}</strong></div>}</div> : <div className="balance-grid"><div className="balance-card"><div><span>{network.native.symbol}</span><small>Network gas</small></div><strong>{balances ? fmtBal(balances.native, 6) : "—"}</strong></div><div className={`balance-card payment ${emphasize ? "low" : ""}`}><div><span>{network.payment.symbol}</span><small>x402 payments</small></div><strong>{balances ? fmtBal(balances.payment, 6) : "—"}</strong></div></div>}
            <div className={`readiness ${paymentReady && !emphasize ? "ready" : "needs-funds"}`}><span className="status-dot" /><span>{paymentReady && !emphasize ? copy.ready : fundingStatus}</span><button type="button" onClick={onRefresh} disabled={loadingBal}>{loadingBal ? "…" : copy.refresh}</button></div>
          </>
        )}
        {networkKey === "xlayer" ? <section className="swap-section">
          <div className="swap-title-row"><div><span className="eyebrow">OKX EXCHANGE OS</span><h3>{copy.swapTitle}</h3></div><a href={dexUrl} target="_blank" rel="noreferrer">{copy.openDex} ↗</a></div>
          {address && <div className="connected-wallet-status"><span className="status-dot" />{copy.connected} · {shortAddr(address)}</div>}
          <p>{copy.swapHelp}</p>
          <div className="native-swap">
            <div className="swap-asset-card">
              <div><span>{copy.amount}</span><small>{copy.balance}: {legacyBalances ? fmtBal(legacyBalances.okb, 6) : "—"} OKB</small></div>
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
        </section> : <section className="swap-section funding-section">
          <div className="swap-title-row"><div><span className="eyebrow">{network.provider}</span><h3>Fund {network.payment.symbol} on {network.label}</h3></div><a href={network.fundingUrl} target="_blank" rel="noreferrer">{network.fundingLabel} ↗</a></div>
          <p>{network.fundingNote}</p>
          {networkKey === "arc-testnet" ? (
            <div className="native-swap">
              <div className="swap-asset-card"><div><span>Gateway deposit</span><small>Wallet balance: {balances ? fmtBal(balances.payment, 6) : "—"} USDC</small></div><div className="swap-input-row"><input inputMode="decimal" value={gatewayAmount} onChange={(event) => setGatewayAmount(event.target.value)} aria-label="Gateway deposit amount" /><strong>USDC</strong></div></div>
              <button type="button" className="btn btn-primary full" disabled={!address || fundingBusy} onClick={() => void fundGateway()}>{fundingBusy ? "Approving and depositing…" : "Deposit into Circle Gateway"}</button>
              <p className="gas-note">This signs two explicit transactions: ERC-20 approval, then the official Gateway Wallet deposit. Gateway available: {fmtBal(gatewayBalance || 0, 6)} USDC.</p>
              {swapError && <div className="swap-message error">{swapError}</div>}
              {txHash && <div className="swap-message success">Gateway deposit confirmed · {shortAddr(txHash)}</div>}
            </div>
          ) : (
            <div className="native-swap">
              <div className="swap-asset-card"><div><span>You pay</span><small>Balance: {fmtBal(balances?.native || 0, 6)} {network.native.symbol}</small></div><div className="swap-input-row"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setCdpQuote(null); setSwapError(null); }} aria-label={`${network.native.symbol} swap amount`} /><strong>{network.native.symbol}</strong></div></div>
              <div className="swap-arrow" aria-hidden>↓</div>
              <div className="swap-asset-card receive"><div><span>You receive</span><small>Native {network.payment.symbol} · {shortAddr(network.payment.address)}</small></div><div className="swap-output">{cdpQuote ? formatUsdt0(cdpQuote.toAmount) : "—"}<strong>{network.payment.symbol}</strong></div></div>
              {cdpQuote && <div className="quote-meta"><span>Minimum received<b>{formatUsdt0(cdpQuote.minToAmount)} {network.payment.symbol}</b></span><span>Provider<b>CDP Trade API</b></span></div>}
              {!cdpQuote ? <button type="button" className="btn btn-soft full" disabled={!address || swapBusy !== null} onClick={() => void loadCdpQuote()}>{swapBusy === "quote" ? "Finding best route…" : "Get live native-USDC quote"}</button> : <button type="button" className="btn btn-primary full" disabled={!address || swapBusy !== null} onClick={() => void executeCdpSwap()}>{swapBusy === "swap" ? "Preparing transaction…" : "Review & swap in wallet"}</button>}
              <p className="gas-note">Powered by CDP Trade API aggregation. Keep {network.native.symbol} for gas; PULSE validates the chain, native amount, transaction target format, and native {network.payment.symbol} output contract before wallet submission.</p>
              {swapError && <div className="swap-message error">{swapError}</div>}
              {txHash && <div className="swap-message success">Transaction submitted · <a href={`${network.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">{shortAddr(txHash)} ↗</a></div>}
            </div>
          )}
        </section>}
      </aside>
    </div>
  );
}
