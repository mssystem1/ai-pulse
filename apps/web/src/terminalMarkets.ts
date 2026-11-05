export type TerminalQuickMarket = { readonly symbol: string; readonly name: string; readonly instId: string };

/** Research selections name the exact OKX spot pair; they are not execution
 * routes and never silently switch venue or quote currency when unavailable. */
export const TERMINAL_QUICK_MARKETS = [
  { symbol: "BTC", name: "Bitcoin", instId: "BTC-USDT" },
  { symbol: "ETH", name: "Ethereum", instId: "ETH-USDT" },
  { symbol: "HYPE", name: "Hyperliquid", instId: "HYPE-USDT" },
  { symbol: "SOL", name: "Solana", instId: "SOL-USDT" },
  { symbol: "DOGE", name: "Dogecoin", instId: "DOGE-USDT" },
  { symbol: "BNB", name: "BNB", instId: "BNB-USDT" },
  { symbol: "ZEC", name: "Zcash", instId: "ZEC-USDT" },
  { symbol: "OKB", name: "OKB", instId: "OKB-USDT" },
] as const satisfies readonly TerminalQuickMarket[];

const ALIASES: Readonly<Record<string, string>> = {
  BITCOIN: "BTC", ETHEREUM: "ETH", ETHER: "ETH", HYPERLIQUID: "HYPE",
  SOLANA: "SOL", DOGECOIN: "DOGE", BINANCECOIN: "BNB", ZCASH: "ZEC",
};
const QUOTES = new Set(["USDT", "USDC", "USD"]);
function baseSymbol(value: string): string | null {
  const alias = ALIASES[value.replace(/\s+/g, "")];
  if (alias) return alias;
  return /^[A-Z0-9]{2,20}$/.test(value) && !QUOTES.has(value) ? value : null;
}

/** Bare symbols use USDT visibly. Explicit supported quotes are preserved.
 * Zcash's exchange ticker is ZEC; ZCASH is only an input/name alias. */
export function terminalMarketId(input: string): string | null {
  const text = input.trim().toUpperCase();
  if (!text || text.length > 60) return null;
  const knownName = ALIASES[text.replace(/\s+/g, "")];
  if (knownName) return `${knownName}-USDT`;
  let parts = text.split(/\s*[-/]\s*/);
  if (parts.length === 1) {
    const words = text.split(/\s+/);
    if (words.length > 1 && QUOTES.has(words.at(-1)!)) parts = [words.slice(0, -1).join(" "), words.at(-1)!];
    else {
      // Do not guess whether a concatenated BTCUSDT-like input is a ticker or
      // a pair; require BTC/USDT so the chosen asset cannot be silently wrong.
      if (/(?:USDT|USDC|USD)$/.test(text)) return null;
      const symbol = baseSymbol(text);
      return symbol ? `${symbol}-USDT` : null;
    }
  }
  if (parts.length !== 2 || !QUOTES.has(parts[1])) return null;
  const symbol = baseSymbol(parts[0]);
  return symbol ? `${symbol}-${parts[1]}` : null;
}
