export class PaidPassResumeError extends Error {
  constructor(public readonly expiresAt: string | undefined, cause: unknown) {
    super(`Pass payment succeeded. Resume is still pending: ${cause instanceof Error ? cause.message : String(cause)}. Your purchased time is retained; use Resume, not another payment.`);
  }
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
