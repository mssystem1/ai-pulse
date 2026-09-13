/** Presentation only: existing service IDs, API tiers and prices do not change. */
export function reportTierLabel(tier: unknown): string {
  if (["standard", "base", "quick"].includes(String(tier).toLowerCase())) return "Quick";
  if (["premium", "pro"].includes(String(tier).toLowerCase())) return "Pro";
  return "Report";
}
