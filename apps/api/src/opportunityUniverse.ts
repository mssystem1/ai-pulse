import { analysisSymbolForExecutionToken } from "./okxDex.js";

/** A bounded, chain-aware scan with room for both crypto and tokenized assets. */
export function opportunityUniverse(input: {
  chainId: string; erc20: boolean;
  instruments: readonly { instId: string; baseCcy: string; quoteCcy: string; assetClass?: string }[];
  tokens: readonly { symbol: string; name: string; address: string }[];
  researchPairs: readonly string[];
}) {
  const excluded = new Set(["USDC", "USDT", "USDT0", "USDG", "PYUSD", "DAI", "USDS", "USDBC"]);
  const symbols = new Set(input.tokens.filter(token => !input.erc20 || !/^0xe{40}$/i.test(token.address))
    .map(token => analysisSymbolForExecutionToken(token.symbol, input.chainId, token.name)));
  const mapped = input.instruments.filter(item => item.quoteCcy === "USDT" && !excluded.has(item.baseCcy) && symbols.has(item.baseCcy));
  const crypto = mapped.filter(item => !item.assetClass || item.assetClass === "crypto");
  const rwa = mapped.filter(item => item.assetClass && item.assetClass !== "crypto");
  const ordered = [...crypto.slice(0, 12), ...rwa.slice(0, 12)];
  const selected = new Set(ordered.map(item => item.instId));
  for (const item of mapped) { if (selected.size >= 24) break; selected.add(item.instId); }
  return { pairs: [...new Set([...selected, ...input.researchPairs])], mappedCount: mapped.length, selectedMappedCount: selected.size };
}
