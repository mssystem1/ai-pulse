import { formatUnits, parseUnits } from "viem";

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

/** Round the Arc limit estimate down to whole output-token units before displaying/signing. */
export function arcLimitMinimum(amount: string, price: string, slippage: string, side: "buy" | "sell", inputDecimals: number, outputDecimals: number): string {
  try {
    if (![inputDecimals, outputDecimals].every(d => Number.isInteger(d) && d >= 0 && d <= 36)
      || !/^\d+(?:\.\d{1,18})?$/.test(price) || !/^\d+(?:\.\d{1,6})?$/.test(slippage)) return "";
    const input = positiveTokenAmount(amount, inputDecimals), rate = parseUnits(price, 18);
    const retained = 100_000_000n - parseUnits(slippage, 6);
    if (!input || rate <= 0n || retained <= 0n || retained > 100_000_000n) return "";
    const outputScale = 10n ** BigInt(outputDecimals), inputScale = 10n ** BigInt(inputDecimals);
    const numerator = side === "buy" ? input * 10n ** 18n * outputScale : input * rate * outputScale;
    const denominator = side === "buy" ? inputScale * rate : inputScale * 10n ** 18n;
    const minimum = numerator * retained / (denominator * 100_000_000n);
    return minimum > 0n ? formatUnits(minimum, outputDecimals) : "";
  } catch { return ""; }
}
