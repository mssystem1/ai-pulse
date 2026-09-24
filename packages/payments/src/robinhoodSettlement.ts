import { createHash } from "node:crypto";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";

export const USDG_AUTHORIZATION_TYPES = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] } as const;
export const USDG_DOMAIN = { name: CHAIN.name, version: CHAIN.version, chainId: CHAIN.chainId, verifyingContract: CHAIN.asset } as const;
const address = /^0x[\da-f]{40}$/i;
const bytes32 = /^0x[\da-f]{64}$/i;
const uint256 = /^(0|[1-9]\d{0,77})$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export type RobinhoodProof = { transaction: Hex; blockNumber: string; blockHash: Hex };
export type RobinhoodAttempt = {
  version: 1; id: string; payloadHash: string; requestHash: string; resourceUrl: string;
  payer: Address; payee: Address; amount: string; nonce: Hex;
  validAfter: string; validBefore: string; fromBlock: string;
  provider: string; verifiedAt: string; phase: "pending" | "settled";
  transaction?: Hex; proof?: RobinhoodProof; settledAt?: string;
};
/** Production implementations MUST be durable and atomic. Never expire a pending
 * attempt or replace this with a process-local cache. No signatures are stored. */
export interface RobinhoodJournal {
  get(id: string): Promise<RobinhoodAttempt | null>;
  claim(attempt: RobinhoodAttempt): Promise<boolean>;
  replace(previous: RobinhoodAttempt, next: RobinhoodAttempt): Promise<boolean>;
}
export interface RobinhoodObserver {
  currentBlock(): Promise<bigint>;
  proof(attempt: RobinhoodAttempt): Promise<RobinhoodProof | null>;
}
export type RobinhoodSettlementResult =
  | { status: "settled"; attempt: RobinhoodAttempt }
  | { status: "pending"; code: "payment_reconciliation_pending"; paymentId: string }
  | { status: "rejected"; code: "payment_invalid" | "payment_conflict" | "payment_expired" }
  | { status: "unavailable"; code: "payment_state_unavailable" | "payment_verification_unavailable" };

/** Validate locally before a caller can claim a nonce in the journal. This first
 * integration accepts EOA EIP-3009 signatures, not unverified contract-wallet
 * wrappers. The facilitator must independently verify token/nonce eligibility. */
export async function validateRobinhoodAuthorization(header: string, expected: PaymentRequirements, resourceUrl: string) {
  if (header.length > 24_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) throw new Error("Invalid payment encoding");
  const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
  const accepted = payload?.accepted;
  if (expected.network !== CHAIN.network || expected.scheme !== "exact" || expected.asset.toLowerCase() !== CHAIN.asset.toLowerCase()
    || !address.test(expected.payTo) || !uint256.test(expected.amount) || BigInt(expected.amount) <= 0n || BigInt(expected.amount) >= 2n ** 256n
    || expected.extra?.name !== CHAIN.name || expected.extra?.version !== CHAIN.version) throw new Error("Invalid server requirements");
  if (payload.x402Version !== 2 || payload.resource?.url !== resourceUrl || accepted?.network !== expected.network
    || accepted.scheme !== expected.scheme || accepted.asset?.toLowerCase() !== expected.asset.toLowerCase()
    || accepted.amount !== expected.amount || accepted.payTo?.toLowerCase() !== expected.payTo.toLowerCase()
    || accepted.extra?.name !== CHAIN.name || accepted.extra?.version !== CHAIN.version) throw new Error("Payment requirements mismatch");
  const raw = payload.payload as { authorization?: Record<string, unknown>; signature?: unknown };
  const auth = raw?.authorization;
  if (!auth || typeof raw.signature !== "string" || !/^0x[\da-f]{130}$/i.test(raw.signature)
    || typeof auth.from !== "string" || !address.test(auth.from) || typeof auth.to !== "string" || !address.test(auth.to)
    || auth.to.toLowerCase() !== expected.payTo.toLowerCase() || auth.value !== expected.amount
    || typeof auth.nonce !== "string" || !bytes32.test(auth.nonce)) throw new Error("Invalid authorization");
  for (const key of ["value", "validAfter", "validBefore"]) {
    if (typeof auth[key] !== "string" || !uint256.test(auth[key] as string) || BigInt(auth[key] as string) >= 2n ** 256n) throw new Error("Invalid authorization integer");
  }
  const message = { from: auth.from as Address, to: auth.to as Address, value: BigInt(auth.value as string),
    validAfter: BigInt(auth.validAfter as string), validBefore: BigInt(auth.validBefore as string), nonce: auth.nonce as Hex };
  if (message.validBefore <= message.validAfter) throw new Error("Invalid authorization validity");
  const signer = await recoverTypedDataAddress({ domain: USDG_DOMAIN, types: USDG_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization", message, signature: raw.signature as Hex });
  if (signer.toLowerCase() !== message.from.toLowerCase()) throw new Error("Authorization signer mismatch");
  return { payload, message, id: digest(`${CHAIN.network}:${CHAIN.asset.toLowerCase()}:${message.from.toLowerCase()}:${message.nonce.toLowerCase()}`), payloadHash: digest(header) };
}

/** At-most-one settlement submission per authorization. Provider exceptions and
 * even reported failures after submission are uncertain until RPC reconciliation.
 * Replays (including after signature expiry) only inspect the original attempt;
 * they never submit it again or switch providers. Production callers must supply
 * durable journals and support retrying the original signed request. */
export async function settleRobinhoodPayment(input: {
  header: string; requirements: PaymentRequirements; resourceUrl: string; requestHash: string; provider: string;
}, deps: { journal: RobinhoodJournal; observer: RobinhoodObserver; facilitator: FacilitatorClient; now?: () => number }): Promise<RobinhoodSettlementResult> {
  let checked: Awaited<ReturnType<typeof validateRobinhoodAuthorization>>;
  try {
    if (!/^[\da-f]{64}$/.test(input.requestHash)) throw new Error("Invalid request digest");
    checked = await validateRobinhoodAuthorization(input.header, input.requirements, input.resourceUrl);
  } catch { return { status: "rejected", code: "payment_invalid" }; }
  const { id, payload, message, payloadHash } = checked;
  const pending = (): RobinhoodSettlementResult => ({ status: "pending", code: "payment_reconciliation_pending", paymentId: id });
  const reconcile = async (attempt: RobinhoodAttempt): Promise<RobinhoodSettlementResult> => {
    if (attempt.payloadHash !== payloadHash || attempt.requestHash !== input.requestHash || attempt.resourceUrl !== input.resourceUrl) {
      return { status: "rejected", code: "payment_conflict" };
    }
    if (attempt.phase === "settled") return { status: "settled", attempt };
    let proof: RobinhoodProof | null;
    try { proof = await deps.observer.proof(attempt); } catch { return pending(); }
    if (!proof) return pending();
    const next: RobinhoodAttempt = { ...attempt, phase: "settled", transaction: proof.transaction, proof,
      settledAt: new Date((deps.now || Date.now)()).toISOString() };
    if (await deps.journal.replace(attempt, next)) return { status: "settled", attempt: next };
    const current = await deps.journal.get(id);
    return current?.phase === "settled" && current.payloadHash === payloadHash && current.requestHash === input.requestHash
      ? { status: "settled", attempt: current } : pending();
  };
  try {
    const existing = await deps.journal.get(id);
    if (existing) return await reconcile(existing);
    const now = BigInt(Math.floor((deps.now || Date.now)() / 1000));
    if (now <= message.validAfter || now >= message.validBefore) return { status: "rejected", code: "payment_expired" };
    let valid;
    try { valid = await deps.facilitator.verify(payload, input.requirements); }
    catch { return { status: "unavailable", code: "payment_verification_unavailable" }; }
    if (!valid.isValid) return { status: "rejected", code: "payment_invalid" };
    const attempt: RobinhoodAttempt = {
      version: 1, id, payloadHash, requestHash: input.requestHash, resourceUrl: input.resourceUrl,
      payer: message.from, payee: message.to, amount: message.value.toString(), nonce: message.nonce,
      validAfter: message.validAfter.toString(), validBefore: message.validBefore.toString(),
      fromBlock: (await deps.observer.currentBlock()).toString(), provider: input.provider,
      verifiedAt: new Date((deps.now || Date.now)()).toISOString(), phase: "pending",
    };
    if (!await deps.journal.claim(attempt)) {
      const current = await deps.journal.get(id);
      return current ? await reconcile(current) : pending();
    }
    // No calls to settle before the durable claim succeeds. Do not add retries.
    let submitted = attempt;
    try {
      const result = await deps.facilitator.settle(payload, input.requirements);
      if (typeof result.transaction === "string" && bytes32.test(result.transaction)) {
        submitted = { ...attempt, transaction: result.transaction as Hex };
        if (!await deps.journal.replace(attempt, submitted)) {
          const current = await deps.journal.get(id);
          return current ? await reconcile(current) : pending();
        }
      }
    } catch {
      // A network error does not mean the transfer failed. Reconcile by nonce.
    }
    return await reconcile(submitted);
  } catch { return { status: "unavailable", code: "payment_state_unavailable" }; }
}
