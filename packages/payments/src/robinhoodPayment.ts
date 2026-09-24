/** Staged Robinhood payment primitives; not an enabled production payment adapter.
 * Official token: https://docs.robinhood.com/chain/contracts/
 * Metadata and EIP-712 domain independently checked on mainnet on 2026-09-19.
 */
import { getAddress, isAddress, parseUnits, zeroAddress } from "viem";

export const ROBINHOOD_PAYMENT = Object.freeze({
  chainId: 4663,
  network: "eip155:4663" as const,
  asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
  symbol: "USDG",
  decimals: 6,
  name: "Global Dollar",
  version: "1",
});

/** Capability advertisement only: does not establish token support, liquidity,
 * successful settlement, pricing, merchant access or provider trustworthiness.
 */
export function advertisesRobinhoodExactV2(body: unknown): boolean {
  if (!body || typeof body !== "object" || !("kinds" in body) || !Array.isArray(body.kinds)) return false;
  return body.kinds.some((kind: unknown) => {
    if (!kind || typeof kind !== "object") return false;
    const row = kind as Record<string, unknown>;
    if (row.x402Version !== 2 || row.scheme !== "exact" || row.network !== ROBINHOOD_PAYMENT.network) return false;
    if (row.extra === undefined) return true;
    if (!row.extra || typeof row.extra !== "object" || Array.isArray(row.extra)) return false;
    const extra = row.extra as Record<string, unknown>;
    if (extra.assetTransferMethod !== undefined && extra.assetTransferMethod !== "eip3009") return false;
    if (extra.asset !== undefined && (typeof extra.asset !== "string" || extra.asset.toLowerCase() !== ROBINHOOD_PAYMENT.asset.toLowerCase())) return false;
    return true;
  });
}

/** Use an explicit asset price, never the SDK's default dollar/USDC mapping.
 * Amounts here are protocol-only; user-facing amounts must remain human-readable.
 */
export function robinhoodExactAccepts(priceUSDG: string, payTo: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(priceUSDG) || priceUSDG.length > 80) throw new Error("Invalid USDG price");
  const amount = parseUnits(priceUSDG, ROBINHOOD_PAYMENT.decimals);
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error("USDG price must be positive and fit uint256");
  if (!isAddress(payTo) || payTo.toLowerCase() === zeroAddress) throw new Error("Invalid Robinhood payment recipient");
  return {
    scheme: "exact" as const,
    network: ROBINHOOD_PAYMENT.network,
    payTo: getAddress(payTo),
    price: {
      amount: amount.toString(),
      asset: ROBINHOOD_PAYMENT.asset,
      extra: { name: ROBINHOOD_PAYMENT.name, version: ROBINHOOD_PAYMENT.version, assetTransferMethod: "eip3009" },
    },
  };
}
