import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { advertisesRobinhoodExactV2, ROBINHOOD_PAYMENT, robinhoodExactAccepts } from "./robinhoodPayment.js";

// Explicit choices only: prevents leaking payment authorizations/credentials to
// arbitrary URLs. Additional providers require a reviewed configuration change.
export const ROBINHOOD_FACILITATORS = Object.freeze({
  primer: "https://x402.primer.systems",
  aeron: "https://x402.aeron.sh",
});
export type RobinhoodFacilitatorName = keyof typeof ROBINHOOD_FACILITATORS;

export function robinhoodFacilitator(name: string): FacilitatorClient {
  if (!Object.hasOwn(ROBINHOOD_FACILITATORS, name)) throw new Error("Unrecognized Robinhood facilitator");
  // No Coinbase/OKX credentials: these must never be forwarded to another host.
  return new HTTPFacilitatorClient({ url: ROBINHOOD_FACILITATORS[name as RobinhoodFacilitatorName] });
}

/** Seller-side integration primitive. Production routes must additionally own
 * input validation, durable settlement/recovery and independent receipt checks.
 * No hidden provider fallback: an uncertain settlement needs reconciliation.
 */
export async function createRobinhoodPaymentServer(facilitator: FacilitatorClient) {
  const supported = await facilitator.getSupported();
  if (!advertisesRobinhoodExactV2(supported)) throw new Error("Facilitator does not advertise Robinhood exact v2");
  const checked: FacilitatorClient = {
    getSupported: async () => supported,
    verify: facilitator.verify.bind(facilitator),
    settle: facilitator.settle.bind(facilitator),
  };
  const server = new x402ResourceServer(checked).register(ROBINHOOD_PAYMENT.network, new ExactEvmScheme());
  await server.initialize();
  return {
    server,
    requirements: (priceUSDG: string, payTo: string) => server.buildPaymentRequirements({
      ...robinhoodExactAccepts(priceUSDG, payTo), maxTimeoutSeconds: 120,
    }),
  };
}
