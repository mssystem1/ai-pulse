import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import type { toFacilitatorEvmSigner } from "@x402/evm";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";

export type RobinhoodGasSigner = ReturnType<typeof toFacilitatorEvmSigner>;
/** Private embedded facilitator: same SDK verify/settle protocol without an
 * external operator or public gas-sponsoring endpoint. Call settle only through
 * the durable settlement coordinator. No Permit2 or wallet deployment sponsorship.
 * Gas signer must independently restrict calls, budget gas and serialize nonces. */
export function createRobinhoodSelfHostedFacilitator(options: {
  signer: RobinhoodGasSigner; payTo: string; amounts: readonly string[];
}): FacilitatorClient {
  if (!/^0x[\da-f]{40}$/i.test(options.payTo) || /^0x0{40}$/i.test(options.payTo)
    || !options.amounts.length || options.amounts.some(amount => !/^[1-9]\d{0,77}$/.test(amount) || BigInt(amount) >= 2n ** 256n)) {
    throw new Error("Invalid self-hosted facilitator merchant policy");
  }
  const amounts = new Set(options.amounts);
  const policy = (payload: PaymentPayload, requirements: PaymentRequirements): boolean => {
    try {
      const accepted = payload?.accepted;
      const auth = payload?.payload?.authorization as Record<string, unknown> | undefined;
      return !!(
        payload?.x402Version === 2 && requirements?.network === CHAIN.network && requirements.scheme === "exact"
        && requirements.asset?.toLowerCase() === CHAIN.asset.toLowerCase() && requirements.payTo?.toLowerCase() === options.payTo.toLowerCase()
        && amounts.has(requirements.amount) && requirements.extra?.name === CHAIN.name && requirements.extra?.version === CHAIN.version
        && requirements.extra?.assetTransferMethod !== "permit2"
        && accepted?.scheme === "exact" && accepted.network === CHAIN.network && accepted.amount === requirements.amount
        && accepted.asset?.toLowerCase() === CHAIN.asset.toLowerCase() && accepted.payTo?.toLowerCase() === options.payTo.toLowerCase()
        && auth && typeof auth.to === "string" && auth.to.toLowerCase() === options.payTo.toLowerCase() && auth.value === requirements.amount
        && typeof payload.payload.signature === "string" && /^0x[\da-f]{130}$/i.test(payload.payload.signature)
        && !Object.hasOwn(payload.payload, "permit2Authorization")
      );
    } catch { return false; }
  };
  const sdk = new x402Facilitator().register(CHAIN.network, new ExactEvmScheme(options.signer, {
    simulateInSettle: true, eip6492AllowedFactories: [],
  }));
  return {
    async getSupported() {
      const supported = sdk.getSupported();
      return { ...supported, kinds: supported.kinds.map(kind => ({ ...kind, network: CHAIN.network, extra: { asset: CHAIN.asset, assetTransferMethod: "eip3009" } })) };
    },
    async verify(payload, requirements) {
      if (!policy(payload as PaymentPayload, requirements as PaymentRequirements)) return { isValid: false, invalidReason: "merchant_policy_rejected" };
      return sdk.verify(payload as PaymentPayload, requirements as PaymentRequirements);
    },
    async settle(payload, requirements) {
      if (!policy(payload as PaymentPayload, requirements as PaymentRequirements)) return { success: false, transaction: "", network: CHAIN.network, errorReason: "merchant_policy_rejected" };
      return sdk.settle(payload as PaymentPayload, requirements as PaymentRequirements);
    },
  };
}
