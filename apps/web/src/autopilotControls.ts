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

/** Arc pays passes from Gateway while capital and gas stay in the wallet. */
export function autopilotFundingState(input: {
  network: string; depositRequired: number; walletBalance: number | null;
  needsPass: boolean; passPrice: number; gatewayBalance: number | null;
}) {
  const requiredWalletFunds = input.depositRequired + (input.network === "arc" || !input.needsPass ? 0 : input.passPrice);
  const paymentBalance = input.network === "arc" ? input.gatewayBalance : input.walletBalance;
  const requiredPaymentFunds = input.network === "arc" ? (input.needsPass ? input.passPrice : 0) : requiredWalletFunds;
  return {
    requiredWalletFunds,
    passFundingUnavailable: input.needsPass && (paymentBalance === null || (input.depositRequired > 0 && input.walletBalance === null)),
    passFundingInsufficient: paymentBalance !== null && paymentBalance + 1e-9 < requiredPaymentFunds,
  };
}
