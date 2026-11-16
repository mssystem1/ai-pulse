import { parseIndicatorPackage, type IndicatorManifest } from "@pulse/domain";

export const indicatorDraftKey = (wallet?: string | null) => "pulse-indicator-draft:" + (wallet?.toLowerCase() ?? "local");
export const indicatorCreatedKey = (wallet?: string | null) => "pulse-indicator-created:" + (wallet?.toLowerCase() ?? "local");

/** Device-local working copies are separate from installed panes, publications
 * and paid receipts. Never put market observations or wallet credentials here. */
export function saveCreatedIndicator(manifest: IndicatorManifest, wallet?: string | null, terms: { paid: boolean; price: string } = { paid: false, price: "1.00" }) {
  const valid = parseIndicatorPackage(manifest), key = indicatorCreatedKey(wallet);
  let raw: unknown;
  try { raw = JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { raw = []; }
  const previous = Array.isArray(raw) ? raw.flatMap(item => { try { return [parseIndicatorPackage(item)]; } catch { return []; } }) : [];
  const next = [valid, ...previous.filter(item => item.id !== valid.id)].slice(0, 50);
  localStorage.setItem(key, JSON.stringify(next));
  localStorage.setItem(indicatorDraftKey(wallet), JSON.stringify({ manifest: valid, ...terms }));
  window.dispatchEvent(new Event("pulse:indicator-saved"));
}
