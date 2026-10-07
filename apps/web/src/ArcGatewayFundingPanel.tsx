import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { depositArcGateway, WEB_NETWORKS } from "./networks";
import { getInjectedProvider, shortAddr } from "./wallet";
import { fetchGatewayWithdrawalStatus, prepareArcGatewayWithdrawal, prepareMaxArcGatewayDeposit, prepareMaxArcGatewayWithdrawal, readPendingWithdrawal, resumeArcGatewayWithdrawal, trustlessArcGatewayWithdrawal, withdrawArcGateway, type GatewayWithdrawalStatus, type PendingWithdrawal, type WithdrawalQuote } from "./arcGatewayWithdrawal";
import { walletErrorMessage } from "./walletErrors";

export function ArcGatewayFundingPanel({ lang, address, walletBalance, gatewayBalance, onRefresh }: { lang: "en" | "zh"; address: string | null; walletBalance: number | null; gatewayBalance: number | null; onRefresh: () => void }) {
  const zh = lang === "zh";
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
  const [pending, setPending] = useState<PendingWithdrawal | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [status, setStatus] = useState<GatewayWithdrawalStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; hash?: string } | null>(null);
  const [fallbackReview, setFallbackReview] = useState(false);
  const busyRef = useRef(false);
  const scope = `${address || ""}:${mode}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const readRecovery = () => {
    if (!address) { setPending(null); setRecoveryError(null); return; }
    try { setPending(readPendingWithdrawal(localStorage, address)); setRecoveryError(null); }
    catch (e) { setRecoveryError(walletErrorMessage(e)); }
  };
  const refreshStatus = async () => {
    if (!address) return;
    setStatus(null); setStatusError(null);
    try { setStatus(await fetchGatewayWithdrawalStatus(address)); }
    catch (e) { setStatusError(walletErrorMessage(e)); }
  };
  useEffect(() => {
    readRecovery();
    const refresh = () => readRecovery();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [address]);
  useEffect(() => { if (mode === "withdraw") void refreshStatus(); }, [address, mode]);
  useEffect(() => { setQuote(null); setError(null); setResult(null); setFallbackReview(false); }, [address]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null); setResult(null);
    try { await action(); }
    catch (e) { setError(walletErrorMessage(e)); }
    finally { busyRef.current = false; readRecovery(); setBusy(false); }
  }
  const provider = () => {
    const p = getInjectedProvider();
    if (!address || !p) throw new Error(zh ? "请连接 Gateway 存款钱包" : "Connect the Gateway depositor wallet");
    return p;
  };
  const balanceLabel = (v: number | null) => v === null ? "—" : v.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 6 });
  const funds = mode === "deposit" ? walletBalance : gatewayBalance;
  const noMintGas = mode === "withdraw" && walletBalance !== null && walletBalance <= 0;
  const chooseMax = () => run(async () => {
    if (!address) throw new Error("Connect the Gateway depositor wallet");
    const requestedScope = scope;
    const estimate = mode === "withdraw" ? await prepareMaxArcGatewayWithdrawal(address) : await prepareMaxArcGatewayDeposit(address);
    if (scopeRef.current !== requestedScope) return;
    setAmount(typeof estimate === "string" ? estimate : estimate.amount);
    setQuote(typeof estimate === "string" ? null : estimate);
    setFallbackReview(false);
  });
  const finish = async (label: string, hash?: string) => {
    setResult({ label, hash }); setQuote(null); setFallbackReview(false); onRefresh();
    if (mode === "withdraw") await refreshStatus();
  };
  return <div className="native-swap arc-gateway-funding" data-no-localize>
    <div className="arc-balance-tabs" role="group" aria-label={zh ? "Gateway 资金操作" : "Gateway funding actions"}>
      <button type="button" aria-pressed={mode === "deposit"} className={mode === "deposit" ? "active" : ""} disabled={busy} onClick={() => { setMode("deposit"); setError(null); setResult(null); setQuote(null); }}>{zh ? "充值" : "Deposit"}</button>
      <button type="button" aria-pressed={mode === "withdraw"} className={mode === "withdraw" ? "active" : ""} disabled={busy} onClick={() => { setMode("withdraw"); setError(null); setResult(null); setQuote(null); }}>{zh ? "提取到钱包" : "Withdraw to wallet"}</button>
    </div>
    <div className="swap-asset-card">
      <div><span>{mode === "deposit" ? (zh ? "钱包 → Gateway" : "Wallet → Gateway") : (zh ? "Gateway → 钱包" : "Gateway → wallet")}</span><small>{zh ? "可用余额" : "Available"}: {balanceLabel(funds)} USDC</small></div>
      <div className="swap-input-row"><input inputMode="decimal" disabled={busy || mode === "withdraw" && Boolean(pending || recoveryError)} value={amount} onChange={e => { setAmount(e.target.value); setQuote(null); setFallbackReview(false); setError(null); }} aria-label={mode === "deposit" ? (zh ? "Gateway 充值金额" : "Gateway deposit amount") : (zh ? "Gateway 提取金额" : "Gateway withdrawal amount")} /><button type="button" className="gateway-max-button" disabled={!address || busy || mode === "withdraw" && Boolean(pending || recoveryError)} aria-label={mode === "deposit" ? "Maximum Gateway deposit" : "Maximum Gateway withdrawal after fee"} onClick={() => void chooseMax()}>{busy ? "…" : "Max"}</button><strong>USDC</strong></div>
    </div>
    {mode === "deposit" ? <>
      <button type="button" className="btn btn-primary full" disabled={!address || busy} onClick={() => void run(async () => {
        const tx = await depositArcGateway(provider(), address!, amount);
        await finish(zh ? "Gateway 充值已确认" : "Gateway deposit confirmed", tx.depositHash);
      })}>{busy ? (zh ? "请在钱包中审核…" : "Review in your wallet…") : (zh ? "存入 Circle Gateway" : "Deposit into Circle Gateway")}</button>
      <p className="gas-note">{zh ? "审核两笔交易：USDC 授权与 Gateway 存款。Max 会预留两笔交易的网络费用；签名前会重新检查余额和费用。" : "Review two transactions: USDC approval and Gateway deposit. Max reserves gas for both transactions; balance and gas are checked again before signing."}</p>
    </> : <>
      <p className="gas-note">{zh ? "提取到此钱包在 Arc 主网的地址" : "Receive in this wallet on Arc Mainnet"}: {address ? shortAddr(address) : "—"}. {zh ? "研究服务和 Autopilot 通行证使用 Gateway 余额；交易资金与手续费使用钱包 USDC。" : "Gateway pays for research and Autopilot passes. Trading capital and gas use wallet USDC."}</p>
      <p className="gas-note">{zh ? "Max 会扣除 Gateway 最高费用。收到服务付款的卖家也使用此提取流程；款项属于连接钱包的 Gateway 余额。" : "Max subtracts the maximum Gateway fee. Sellers use this same withdrawal flow for service proceeds credited to their connected wallet's Gateway balance."}</p>
      {noMintGas && <div className="swap-message error" role="alert">{zh ? "此钱包没有用于支付铸币交易手续费的 Arc USDC。先向此地址充值少量 Arc 主网 USDC，再刷新余额。Gateway 余额不能支付这笔交易的网络费用。" : "This wallet has no Arc USDC for mint transaction gas. Fund this same address with a small amount of Arc Mainnet USDC, then refresh balances. Gateway funds cannot pay this network fee."}<button type="button" className="btn btn-soft" onClick={onRefresh}>{zh ? "刷新余额" : "Refresh balances"}</button></div>}
      {recoveryError ? <div className="swap-message error" role="alert">{recoveryError}<p>{zh ? "请保留恢复记录，联系支持后再发起另一笔提取。" : "Keep the recovery record and contact support before starting another withdrawal."}</p></div> : pending ? <>
        <div className="swap-message" role="status">{zh ? "待完成的提取" : "Withdrawal to resume"}: {pending.amount} USDC. {zh ? "继续同一笔提取，不会创建新的扣款授权。" : "Resume this request; no new debit authorization is created."}</div>
        <button type="button" className="btn btn-primary full" disabled={!address || busy || noMintGas} onClick={() => void run(async () => {
          const tx = await resumeArcGatewayWithdrawal(provider(), address!, localStorage);
          await finish(zh ? "Gateway 提取已确认" : "Gateway withdrawal confirmed", tx.hash);
        })}>{busy ? (zh ? "正在恢复…" : "Resuming…") : (zh ? "继续提取" : "Resume withdrawal")}</button>
      </> : quote ? <>
        <div className="quote-meta"><span>{zh ? "钱包将收到" : "Wallet receives"}<b>{quote.amount} USDC</b></span><span>{zh ? "Gateway 最高费用" : "Maximum Gateway fee"}<b>{formatUnits(BigInt(quote.maxFee), 6)} USDC</b></span><span>{zh ? "Gateway 最高扣款" : "Maximum Gateway debit"}<b>{formatUnits(BigInt(quote.spec.value) + BigInt(quote.maxFee), 6)} USDC</b></span></div>
        <p className="gas-note">{zh ? "审核 Gateway 提取签名，再签署将 USDC 铸回钱包的交易。网络费用另从钱包支付。报价有效期为两分钟或其区块到期时间，以先到者为准。" : "Review the Gateway withdrawal signature, then the transaction that mints USDC back to your wallet. Wallet gas is additional. Review expires after two minutes or at its block expiry, whichever comes first."}</p>
        <button type="button" className="btn btn-primary full" disabled={busy || noMintGas} onClick={() => void run(async () => {
          const tx = await withdrawArcGateway(provider(), quote, localStorage);
          await finish(zh ? "Gateway 提取已确认" : "Gateway withdrawal confirmed", tx.hash);
        })}>{busy ? (zh ? "请在钱包中审核…" : "Review in your wallet…") : (zh ? "审核并提取到钱包" : "Review & withdraw to wallet")}</button>
        <button type="button" className="btn btn-soft full" disabled={busy} onClick={() => setQuote(null)}>{zh ? "更新金额或费用" : "Change amount or refresh fee"}</button>
      </> : <button type="button" className="btn btn-primary full" disabled={!address || busy} onClick={() => void run(async () => setQuote(await prepareArcGatewayWithdrawal(address!, amount)))}>{busy ? (zh ? "正在获取费用…" : "Checking withdrawal fee…") : (zh ? "查看提取费用" : "Review withdrawal fee")}</button>}
      <details className="gateway-withdraw-fallback">
        <summary>{zh ? "合约提取备用方案（有等待期）" : "Contract withdrawal fallback (waiting period)"}</summary>
        <p className="gas-note">{zh ? "Circle 即时提取服务不可用时，可直接通过 Gateway 合约发起提取。通常需等待约七天，然后签署领取交易。已有提取完成前，不再追加金额，以免重置等待期。" : "If Circle's instant transfer service is unavailable, initiate directly through the Gateway contract. Usually wait about seven days, then sign a claim transaction. Additional withdrawals are blocked while one is pending to avoid resetting its delay."}</p>
        {status ? <div className="quote-meta"><span>{zh ? "等待中" : "Pending"}<b>{formatUnits(status.withdrawing, 6)} USDC</b></span><span>{zh ? "可领取" : "Ready to claim"}<b>{formatUnits(status.withdrawable, 6)} USDC</b></span>{status.withdrawing > 0n && <span>{zh ? "当前 / 领取区块" : "Current / claim block"}<b>{status.currentBlock.toString()} / {status.withdrawalBlock.toString()}</b></span>}</div> : <p role="status">{statusError || (zh ? "正在读取合约状态…" : address ? "Reading contract status…" : "Connect a wallet to check withdrawal status.")}</p>}
        <button type="button" className="btn btn-soft full" disabled={!address || busy} onClick={() => void refreshStatus()}>{zh ? "刷新提取状态" : "Refresh withdrawal status"}</button>
        {status && status.withdrawable > 0n ? <button type="button" className="btn btn-primary full" disabled={busy || Boolean(pending || recoveryError)} onClick={() => void run(async () => finish(zh ? "Gateway 合约提取已领取" : "Gateway contract withdrawal claimed", await trustlessArcGatewayWithdrawal(provider(), address!, null, localStorage)))}>{zh ? "领取到钱包" : "Claim to wallet"}</button> : status && status.withdrawing === 0n && <>
          <label className="gas-note"><input type="checkbox" checked={fallbackReview} disabled={busy || Boolean(pending || recoveryError)} onChange={e => { setFallbackReview(e.target.checked); setQuote(null); }} /> {zh ? `我同意发起 ${amount} USDC 的合约提取，并等待 ${status.delay} 个区块后再领取。` : `I agree to initiate ${amount} USDC and wait ${status.delay} blocks before claiming.`}</label>
          <button type="button" className="btn btn-soft full" disabled={busy || !fallbackReview || Boolean(pending || recoveryError)} onClick={() => void run(async () => finish(zh ? "合约提取已发起；等待到期后领取" : "Contract withdrawal initiated; claim after the delay", await trustlessArcGatewayWithdrawal(provider(), address!, amount, localStorage)))}>{zh ? "发起有等待期的提取" : "Initiate delayed withdrawal"}</button>
        </>}
      </details>
    </>}
    {error && <div className="swap-message error" role="alert">{error}</div>}
    {result && <div className="swap-message success" role="status">{result.label}{result.hash && <> · <a href={`${WEB_NETWORKS.arc.explorer}/tx/${result.hash}`} target="_blank" rel="noreferrer">{shortAddr(result.hash)} ↗</a></>}</div>}
  </div>;
}
