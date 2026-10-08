export class PaidPassResumeError extends Error {
  constructor(public readonly expiresAt: string | undefined, cause: unknown) {
    super(`Pass payment succeeded. Resume is still pending: ${cause instanceof Error ? cause.message : String(cause)}. Your purchased time is retained; use Resume, not another payment.`);
  }
}

/** A telemetry/readback failure must not misreport a confirmed resume as paused. */
export function autopilotSetupFailureState(input: { resumed: boolean; paid: boolean; safelyPaused: boolean; setupStarted?: boolean; vaultAvailable?: boolean }) {
  if (input.resumed) return "Resume was confirmed on-chain; dashboard synchronization is pending. Refresh the dashboard instead of repeating setup or payment.";
  if (input.paid) return "The pass purchase succeeded, but activation is not confirmed. Refresh the selected vault and use Resume if it is paused; do not purchase another pass.";
  if (input.setupStarted === false) return "Setup stopped during checks, before any vault creation, policy update or pass purchase was requested. Review the check above and retry.";
  if (input.vaultAvailable === false) return "A usable vault has not been confirmed. Refresh the wallet transactions and account list before retrying, and reuse any account that was created.";
  return input.safelyPaused ? "The strategy wallet remains paused; funds stay owner-withdrawable." : "Pause the existing strategy before retrying any policy change.";
}

/** Payment is performed once. A rejected resume must never restart checkout. */
export async function renewAndResumeAutopilot(actions: {
  pay: () => Promise<string | undefined>;
  isPaused: () => Promise<boolean>;
  resume: () => Promise<void>;
}) {
  const expiresAt = await actions.pay();
  try {
    if (await actions.isPaused()) await actions.resume();
    return { expiresAt, running: true as const };
  } catch (error) {
    throw new PaidPassResumeError(expiresAt, error);
  }
}
