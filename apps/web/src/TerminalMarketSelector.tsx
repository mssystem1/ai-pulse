import { useId, type FormEvent } from "react";
import { TERMINAL_QUICK_MARKETS, terminalMarketId } from "./terminalMarkets";
import "./terminalMarkets.css";

type Props = {
  instId: string; marketInput: string; onInput: (value: string) => void;
  onChoose: (instId: string) => void; disabled?: boolean;
};

export function TerminalMarketSelector({ instId, marketInput, onInput, onChoose, disabled = false }: Props) {
  const id = useId(), candidate = terminalMarketId(marketInput);
  const selected = TERMINAL_QUICK_MARKETS.find(market => market.instId === instId);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (candidate && !disabled) onChoose(candidate);
  }
  return <div className="terminal-market-selector">
    <div className="terminal-market-selector-heading"><span className="terminal-field-label">Choose a market</span><small>{selected ? `${selected.name} · ${selected.instId}` : instId} · spot research</small></div>
    <div className="terminal-quick-markets" role="group" aria-label="Quick asset selection">{TERMINAL_QUICK_MARKETS.map(market => <button type="button" key={market.instId} title={`${market.name} · ${market.instId}`} aria-label={`View ${market.name} ${market.instId}`} aria-pressed={instId === market.instId} disabled={disabled} onClick={() => onChoose(market.instId)}><strong>{market.symbol}</strong><span>{market.name}</span></button>)}</div>
    <form className="terminal-custom-market" onSubmit={submit}>
      <label htmlFor={`${id}-input`}>Other spot market</label>
      <div className="terminal-custom-market-row"><input id={`${id}-input`} list={`${id}-options`} aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false} value={marketInput} maxLength={60} placeholder="BTC, Zcash or LINK/USDT" disabled={disabled} onChange={event => onInput(event.target.value)} /><datalist id={`${id}-options`}>{TERMINAL_QUICK_MARKETS.map(market => <option key={market.instId} value={market.instId} label={market.name} />)}</datalist><button type="submit" disabled={disabled || !candidate}>View {candidate ?? "market"}</button></div>
      <small id={`${id}-hint`}>{marketInput.trim() && !candidate ? "Use a coin symbol/name, or an explicit pair such as BTC/USDT. Supported quotes: USDT, USDC and USD." : candidate ? `Will open ${candidate}. Sources must provide this exact spot pair; another asset or venue is never substituted.` : "Enter a symbol or full coin name. Zcash uses the exchange symbol ZEC."}</small>
    </form>
  </div>;
}
