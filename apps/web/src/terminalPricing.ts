export type TerminalDuration = "24h" | "7d" | "30d";
export type TerminalPublishedPlan = { duration: TerminalDuration; priceUsd: string; durationMs: number };
const durations: Record<TerminalDuration, number> = { "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 };

/** Exact six-decimal settlement amounts. Never round a quoted payment up/down. */
export function terminalUsdAtomic(price: string): string {
  if (typeof price !== "string" || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(price)) throw new Error("Invalid published Terminal price");
  const [whole, fraction = ""] = price.split(".");
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (value <= 0n) throw new Error("Terminal price must be positive");
  return value.toString();
}

export function parseTerminalPlans(raw: unknown): TerminalPublishedPlan[] {
  if (!Array.isArray(raw)) return [];
  const plans: TerminalPublishedPlan[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return [];
    const plan = item as Record<string, unknown>;
    if (!Object.hasOwn(durations, String(plan.duration)) || typeof plan.priceUsd !== "string") return [];
    const duration = plan.duration as TerminalDuration;
    try { terminalUsdAtomic(plan.priceUsd); } catch { return []; }
    if (plan.durationMs !== durations[duration] || plans.some(p => p.duration === duration)) return [];
    plans.push({ duration, priceUsd: plan.priceUsd, durationMs: durations[duration] });
  }
  return plans.sort((a,b) => a.durationMs-b.durationMs);
}
