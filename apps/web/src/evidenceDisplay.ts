/** Presentation only: retain the original rule evidence for evaluation and exports. */
export function formatRuleEvidence(value: string): string {
  const match = /^(\s*(?:>=|<=|>|<|=)?\s*)(-?\d+(?:\.\d+)?)(\s*(?:%|×)?)$/.exec(value);
  if (!match) return value;
  const number = Number(match[2]);
  if (!Number.isFinite(number)) return value;
  return `${match[1]}${number.toLocaleString("en-US", { maximumSignificantDigits: 8 })}${match[3]}`;
}
