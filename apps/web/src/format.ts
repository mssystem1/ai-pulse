import type { Lang } from "./i18n";

/**
 * Keep micro-priced assets readable without making BTC-sized prices noisy.
 * The precision expands through the first meaningful decimal digits and falls
 * back to scientific notation only below the practical decimal display range.
 */
export function formatMarketPrice(value: unknown, lang: Lang): string {
  const price = Number(value);
  if (!Number.isFinite(price)) return "—";
  if (price === 0) return "0";

  const magnitude = Math.abs(price);
  if (magnitude < 1e-12) return price.toExponential(4);

  let maximumFractionDigits: number;
  if (magnitude >= 1_000) maximumFractionDigits = 2;
  else if (magnitude >= 100) maximumFractionDigits = 3;
  else if (magnitude >= 1) maximumFractionDigits = 4;
  else if (magnitude >= 0.01) maximumFractionDigits = 6;
  else {
    const leadingDecimalZeros = Math.max(0, Math.ceil(-Math.log10(magnitude)) - 1);
    maximumFractionDigits = Math.min(12, leadingDecimalZeros + 5);
  }

  return price.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits,
    useGrouping: magnitude >= 1_000,
  });
}
