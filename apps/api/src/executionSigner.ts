import type { ExecutionNetwork } from "./executionContracts.js";

type SignerConfig = { ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY?: string; AUTOMATION_EXECUTOR_PRIVATE_KEY?: string; TEST_WALLET_PRIVATE_KEY?: string };

/** An Arc signer must not silently replace the other networks' executor. */
export function executionSignerKey(cfg: SignerConfig, network: ExecutionNetwork) {
  return (network === "arc" && cfg.ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY)
    || cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY || "";
}

export function hasExecutionSigner(cfg: SignerConfig) {
  return [executionSignerKey(cfg, "arc"), executionSignerKey(cfg, "xlayer")]
    .some(key => /^0x[a-fA-F0-9]{64}$/.test(key));
}
