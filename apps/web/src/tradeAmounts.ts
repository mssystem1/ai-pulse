import { parseUnits } from "viem";

export const DEFAULT_TRADE_AMOUNT = "";
export const DEFAULT_AUTOPILOT_CAPITAL = "";

/** Token amounts have no arbitrary fiat floor. They are valid when the value
 * is positive and can be represented by the selected ERC-20 decimals. */
export function positiveTokenAmount(value: string, decimals: number): bigint | null {
  try {
    const atomic = parseUnits(value.trim() || "0", decimals);
    return atomic > 0n ? atomic : null;
  } catch {
    return null;
  }
}
