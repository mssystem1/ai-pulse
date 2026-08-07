export class ProviderCircuitOpenError extends Error {
  constructor(readonly provider: string, readonly retryAt: number) {
    super(`${provider} circuit is open until ${new Date(retryAt).toISOString()}`);
    this.name = "ProviderCircuitOpenError";
  }
}

export class ProviderCircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  constructor(private provider: string, private threshold = 5, private cooldownMs = 30_000) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.openUntil > now) throw new ProviderCircuitOpenError(this.provider, this.openUntil);
    try {
      const value = await operation();
      this.failures = 0; this.openUntil = 0;
      return value;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.threshold) this.openUntil = Date.now() + this.cooldownMs;
      throw error;
    }
  }
}

export function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : 0;
  return Math.min(2_000, Math.max(150 * 2 ** attempt, seconds * 1_000));
}
