import { getNetwork } from "@pulse/config";
import { getOnchainAccountSnapshot, type OnchainAccountSnapshot, type ExecutionNetwork } from "./onchainDiscovery.js";
import type { Activity } from "./v6Store.js";
import type { PublicActivityStore, VerifiedExecution } from "./publicActivity.js";

/** Client input cannot supply fill fields. These come from receipt/net-transfer reconciliation. */
export function publicExecution(item: Activity, accounts: OnchainAccountSnapshot | null): VerifiedExecution | null {
  if (!["base", "arbitrum", "xlayer", "robinhood", "arc"].includes(item.network) || item.status !== "confirmed"
    || !item.txHash || !item.fillObservedAt || !item.fillSide || !item.fillQuoteAsset || !item.fillQuoteValue || !item.fillQuantity
    || !Number.isFinite(item.fillQuoteValue) || item.fillQuoteValue <= 0 || !Number.isFinite(item.fillQuantity) || item.fillQuantity <= 0
    || !/^(market_(buy|sell)|market_buy_with_protection|automatic_(entry|entry_protected|take_profit|stop_loss|fill)|(buy|sell)(_partial)?_filled)$/i.test(item.kind)) return null;
  const network = getNetwork(item.network as ExecutionNetwork);
  if (item.fillQuoteAsset.toLowerCase() !== network.paymentAsset.address?.toLowerCase()) return null;
  let service: "spot" | "autopilot" = "spot";
  if (item.account) {
    if (!accounts || accounts.stale || accounts.network !== item.network || accounts.owner.toLowerCase() !== item.owner.toLowerCase()) return null;
    const account = item.account.toLowerCase();
    if (accounts.vaults.some(vault => vault.address.toLowerCase() === account)) service = "autopilot";
    else if (!Object.values(accounts.accounts).some(value => value?.toLowerCase() === account)) return null;
  // Direct Spot orders have historically been journalled under "wallet".
  // Receipt enrichment already verifies the owner, approved router and net swap.
  } else if (!["spot", "wallet"].includes(item.source)) return null;
  const settlementAtomic = item.fillSide === "buy" ? item.fillInputAmount : item.fillOutputAmount;
  if (!settlementAtomic || !/^[1-9]\d*$/.test(settlementAtomic)) return null;
  return { chain: network.caip2, txHash: item.txHash, service, at: item.fillObservedAt, settlementAsset: item.fillQuoteAsset, settlementAtomic };
}

/** Bounded background projection of server-reconciled activity, not a new wallet scan per landing visitor. */
export function createExecutionProjector(store: PublicActivityStore) {
  const projected = new Set<string>();
  const inflight = new Set<string>();
  return async (owner: string, network: ExecutionNetwork, activity: Activity[]) => {
    const scope = `${network}:${owner.toLowerCase()}`;
    if (inflight.has(scope)) return;
    inflight.add(scope);
    try {
      const candidates = activity.filter(item => item.fillObservedAt && item.status === "confirmed" && item.txHash && !projected.has(`${network}:${item.txHash.toLowerCase()}`));
      if (!candidates.length) return;
      const accounts = candidates.some(item => item.account) ? await getOnchainAccountSnapshot(network, owner) : null;
      let writes = 0;
      for (const item of candidates) {
        const evidence = publicExecution(item, accounts);
        if (!evidence) continue;
        await store.recordExecution(evidence);
        projected.add(`${network}:${evidence.txHash.toLowerCase()}`);
        if (projected.size > 10_000) projected.delete(projected.values().next().value!);
        if (++writes >= 25) break;
      }
    } finally { inflight.delete(scope); }
  };
}
