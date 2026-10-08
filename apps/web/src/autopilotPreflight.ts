/** Match the reviewed history source before any vault mutation or payment. */
export function reviewedAutopilotSignalMarket(input: {
  network: "arc" | "robinhood";
  pair: string;
  historyScope: string;
  history: { scope: string; ready: boolean; signalMarket?: string } | null;
  preflight: unknown;
}): string {
  const preflight = input.preflight as { ready?: boolean; pair?: string; signalMarket?: unknown } | null;
  if (preflight?.ready !== true || preflight.pair !== input.pair)
    throw new Error("Autopilot preflight did not confirm the selected market. Refresh before starting. No wallet transaction was sent.");
  if (typeof preflight.signalMarket !== "string" || !preflight.signalMarket)
    throw new Error("The API did not confirm the strategy signal source. Refresh the market check before starting. No wallet transaction was sent.");
  if (input.history?.scope !== input.historyScope || !input.history.ready)
    throw new Error("The market history review is no longer current. Check history before starting. No wallet transaction was sent.");
  if (preflight.signalMarket !== input.history.signalMarket || (input.network === "arc" && preflight.signalMarket !== input.pair))
    throw new Error("The strategy signal source changed. Review the refreshed history source before starting. No wallet transaction was sent.");
  return preflight.signalMarket;
}
