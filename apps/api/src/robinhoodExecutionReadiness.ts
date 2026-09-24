import { createPublicClient, http, parseAbi } from "viem";
import type { AppConfig } from "@pulse/config";
import { executionContracts } from "./executionContracts.js";

/** Fail closed without hiding ordinary owner-signed wallet swaps. */
export async function robinhoodAutomationReadiness(cfg: AppConfig): Promise<{ ready: boolean; reason?: string }> {
  try {
    const client = createPublicClient({ transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: 5_000, retryCount: 0 }) });
    if (await client.getChainId() !== 4663) return { ready: false, reason: "Robinhood RPC returned the wrong network" };
    const paused = await client.readContract({ address: executionContracts("robinhood").registry,
      abi: parseAbi(["function automationPaused() view returns(bool)"]), functionName: "automationPaused" });
    return paused ? { ready: false, reason: "Robinhood automated execution is paused on-chain; wallet swaps remain available" } : { ready: true };
  } catch {
    return { ready: false, reason: "Robinhood on-chain automation readiness is temporarily unavailable" };
  }
}
