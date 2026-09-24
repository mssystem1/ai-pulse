export const APPEARANCE_IDS = ["xlayer", "base", "arbitrum", "arc-testnet", "robinhood"] as const;
export type AppearanceId = typeof APPEARANCE_IDS[number];
let appliedAppearance: AppearanceId | undefined;
export function isAppearance(value: unknown): value is AppearanceId { return APPEARANCE_IDS.some(id => id === value); }
export function readAppearance(storage?: Pick<Storage, "getItem">, href?: string): AppearanceId {
  const incoming = href ? new URL(href).searchParams.get("pulseTheme") : null;
  if (isAppearance(incoming)) return incoming;
  try { const saved = storage?.getItem("pulse:appearance"); if (isAppearance(saved)) return saved; } catch { /* preference is optional */ }
  return appliedAppearance || "xlayer";
}
export function applyAppearance(value: AppearanceId) {
  appliedAppearance = value;
  document.documentElement.dataset.pulseTheme = value;
  try { localStorage.setItem("pulse:appearance", value); } catch { /* storage may be disabled */ }
}
