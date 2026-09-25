import { keccak256, toHex } from "viem";
export type AutopilotExecutionPhase = "not_submitted" | "submitted" | "reverted" | "confirmed";
const EXECUTED = keccak256(toHex("Executed(bytes32,address,uint256,address,address,uint256,uint256,bytes32)"));
export function verifiedAutopilotReceipt(receipt: { status?: string; to?: string | null; logs?: readonly { address: string; topics: readonly string[] }[] }, vault: string, ownedVaults: readonly string[]) {
  return ["success", "0x1"].includes(receipt.status || "")
    && receipt.to?.toLowerCase() === vault.toLowerCase()
    && ownedVaults.some(address => address.toLowerCase() === vault.toLowerCase())
    && Boolean(receipt.logs?.some(log => log.address.toLowerCase() === vault.toLowerCase() && log.topics[0]?.toLowerCase() === EXECUTED.toLowerCase()));
}

export function autopilotExecutionFailure(phase: AutopilotExecutionPhase, transient: boolean) {
  if (phase === "submitted") return {
    lastDecision: "hold_receipt_pending",
    reason: "A vault trade may have been submitted, but confirmation is unresolved. Check its on-chain receipt; a timeout does not prove that no assets moved.",
  };
  if (phase === "confirmed") return {
    lastDecision: "hold_execution_recovery",
    reason: "The vault trade was confirmed, but subsequent activity or journal persistence failed. Recover the confirmed trade; do not interpret this as an unfilled order.",
  };
  if (phase === "reverted") return {
    lastDecision: "hold_execution_reverted",
    reason: "The submitted vault trade reverted on-chain. Its attempted transfers were reverted; network fees may still have been spent.",
  };
  return {
    lastDecision: transient ? "hold_dependency_retry" : "hold_failed_closed",
    reason: transient
      ? "A temporary dependency was unavailable before vault trade submission. The scheduler will retry automatically."
      : "The evaluation or protected execution failed before vault trade submission.",
  };
}

export function pendingAutopilotTrade(activity: readonly { owner?: string; network?: string; source?: string; account?: string; status?: string; kind?: string; txHash?: string }[], strategy: { owner: string; network: string; vault: string }) {
  return activity.find(row => row.owner?.toLowerCase() === strategy.owner.toLowerCase()
    && row.network === strategy.network && row.source === "autopilot"
    && row.account?.toLowerCase() === strategy.vault.toLowerCase()
    && row.status === "pending" && /^(buy_filled|sell_partial_filled|sell_filled)$/.test(row.kind || "")
    && /^0x[0-9a-f]{64}$/i.test(row.txHash || ""));
}
