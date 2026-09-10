export function autopilotControlState(input: {
  registered: boolean; storageReady: boolean; paused?: boolean | null;
  funded: boolean; passRemainingMs: number; signalsRemaining: number; hasPosition: boolean;
}) {
  const reason = !input.storageReady ? "Service storage is unavailable. Setup and payments are temporarily stopped; your on-chain funds remain yours."
    : !input.registered ? "Setup incomplete. Review and finish strategy registration before purchasing a pass or resuming."
    : !input.funded ? "Add funds before resuming this Autopilot."
    : input.paused == null ? "Refresh to verify the vault's on-chain state."
    : input.passRemainingMs <= 0 && !input.hasPosition ? "Purchase an AI Entry Pass to start entry monitoring."
    : input.signalsRemaining <= 0 && !input.hasPosition ? "Entry confirmations are used; renew before opening new positions."
    : "";
  return { resumeAllowed: input.paused === true && !reason, reason,
    purchaseAllowed: input.storageReady && input.registered && input.funded && input.paused != null };
}
