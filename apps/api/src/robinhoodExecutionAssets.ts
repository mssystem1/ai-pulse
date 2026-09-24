import { collectRobinhoodStockEvidence } from "./robinhoodAssetRegistry.js";

export const ROBINHOOD_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const ROBINHOOD_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** Exact identities only. Stock tokens have separate price units and cannot
 * inherit the crypto oracle model merely because their ticker looks familiar. */
export async function robinhoodExecutionIdentity(address: string) {
  const token = address.toLowerCase();
  if (token === ROBINHOOD_USDG) return { symbol: "USDG", analysisSymbol: "USDT", decimals: 6, multiplier: "1", kind: "settlement" as const };
  if (token === ROBINHOOD_WETH || token === NATIVE_ETH) return { symbol: token === NATIVE_ETH ? "ETH" : "WETH", analysisSymbol: "ETH", decimals: 18, multiplier: "1", kind: "crypto" as const };
  const stock = await collectRobinhoodStockEvidence(address);
  if (!stock.listed || stock.status !== "ASSET_STATUS_ACTIVE" || !stock.symbol || !stock.currentMultiplier) return null;
  return { symbol: stock.symbol, analysisSymbol: `X${stock.symbol.toUpperCase()}`, decimals: 18, multiplier: stock.currentMultiplier, kind: "stock" as const };
}

export async function assertRobinhoodExecutionPair(target: string, settlement: string, pair: string) {
  if (settlement.toLowerCase() !== ROBINHOOD_USDG) throw new Error("Robinhood settlement must be canonical USDG");
  const identity = await robinhoodExecutionIdentity(target);
  if (!identity || identity.kind === "settlement" || pair.toUpperCase() !== `${identity.analysisSymbol}-USDT`) throw new Error("Robinhood contract identity does not match the analysis pair");
  return identity;
}
