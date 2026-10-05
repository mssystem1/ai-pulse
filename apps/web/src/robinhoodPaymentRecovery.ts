import { createRecoverablePaymentFetch } from "./paymentRecovery";

// Preserve existing callers and Robinhood's stored authorization namespace.
export function createRecoverableRobinhoodFetch(wallet: string, deps: Parameters<typeof createRecoverablePaymentFetch>[2]): typeof fetch {
  return createRecoverablePaymentFetch("robinhood", wallet, deps);
}
