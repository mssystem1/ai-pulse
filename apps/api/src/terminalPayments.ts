import { decodeEventLog, parseAbi } from "viem";
import type { TerminalPurchase, TerminalStore } from "./terminalStore.js";
import { grantTerminalPass, terminalAccess } from "./terminalStore.js";
import { executionPublicClient } from "./onchainDiscovery.js";
import type { ExecutionNetwork } from "./executionContracts.js";

const receiptAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)", "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)"]);
/** Recovery is bound to the authorization saved BEFORE settlement, not merely
 * an arbitrary transfer of the same amount to PULSE. */
export async function verifyTerminalPurchaseReceipt(owner: string, purchase: TerminalPurchase, txHash: string) {
  if (!/^0x[\da-f]{64}$/i.test(txHash) || !purchase.nonce || !/^0x[\da-f]{64}$/i.test(purchase.nonce) || !purchase.preparedBlock || !/^\d+$/.test(purchase.preparedBlock)) throw new Error("The saved authorization, pre-settlement block and settlement transaction are required for receipt recovery");
  const client = executionPublicClient(purchase.network as ExecutionNetwork), receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (receipt.status !== "success") throw new Error("Settlement transaction did not succeed");
  if (receipt.blockNumber <= BigInt(purchase.preparedBlock)) throw new Error("Receipt predates the saved Terminal purchase intent; another service's earlier payment cannot activate this pass");
  let transfer = false, authorization = false;
  for (const log of receipt.logs.filter(row => row.address.toLowerCase() === purchase.asset.toLowerCase())) {
    try {
      const decoded = decodeEventLog({ abi: receiptAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Transfer" && decoded.args.from.toLowerCase() === owner && decoded.args.to.toLowerCase() === purchase.payee.toLowerCase() && decoded.args.value.toString() === purchase.amountAtomic) transfer = true;
      if (decoded.eventName === "AuthorizationUsed" && decoded.args.authorizer.toLowerCase() === owner && decoded.args.nonce.toLowerCase() === purchase.nonce.toLowerCase()) authorization = true;
    } catch { /* unrelated token event */ }
  }
  if (!transfer || !authorization) throw new Error("Receipt does not prove the saved Terminal authorization and exact payment");
  const block = await client.getBlock({ blockHash: receipt.blockHash });
  if (Number(block.timestamp) * 1000 < Date.parse(purchase.createdAt) - 300_000) throw new Error("Receipt predates the saved Terminal purchase authorization");
  return { settlementTx: txHash.toLowerCase(), settledAt: new Date(Number(block.timestamp) * 1000).toISOString() };
}
export class TerminalPayments {
  constructor(private store: TerminalStore, private now: () => number = Date.now, private verifyReceipt = verifyTerminalPurchaseReceipt) {}
  async prepare(owner: string, purchase: TerminalPurchase) {
    let claimed = false;
    await this.store.mutate(owner, value => {
      claimed = false;
      const existing = value.pendingPurchases?.find(item => item.requestId === purchase.requestId || item.paymentId === purchase.paymentId);
      if (existing) {
        if (existing.duration !== purchase.duration || existing.requestId !== purchase.requestId || existing.paymentId !== purchase.paymentId) throw new Error("Payment identity belongs to another purchase");
        return false;
      }
      value.pendingPurchases = [...(value.pendingPurchases ?? []), purchase];
      claimed = true;
    });
    return claimed;
  }
  async settled(owner: string, requestId: string, receipt: { settlementTx?: string; settledAt: string }) {
    await this.store.mutate(owner, value => {
      const purchase = value.pendingPurchases?.find(item => item.requestId === requestId);
      if (!purchase) throw new Error("Original purchase identity is unavailable; preserve payment proof for reconciliation");
      if (purchase.state === "granted" || purchase.state === "settled") return false;
      purchase.state = "settled"; purchase.settledAt = receipt.settledAt; purchase.settlementTx = receipt.settlementTx;
    });
    return this.activate(owner, requestId);
  }
  async activate(owner: string, requestId: string) {
    const value = await this.store.mutate(owner, value => {
      const purchase = value.pendingPurchases?.find(item => item.requestId === requestId);
      if (!purchase || !["settled", "granted"].includes(purchase.state)) throw new Error("Settlement is uncertain. Recover the original payment; do not pay again.");
      if (purchase.state === "granted") return false;
      grantTerminalPass(value, { requestId, duration: purchase.duration, priceUsd: purchase.priceUsd, amountAtomic: purchase.amountAtomic, network: purchase.network, asset: purchase.asset, paymentId: purchase.paymentId, purchasedAt: new Date(this.now()).toISOString(), simulated: purchase.simulated });
      purchase.state = "granted";
    });
    return { recovered: true, grant: value.grants.find(item => item.requestId === requestId), access: terminalAccess(value, this.now()) };
  }
  async recover(owner: string, requestId: string, txHash?: string) {
    const value = await this.store.get(owner), purchase = value.pendingPurchases?.find(item => item.requestId === requestId);
    if (!purchase) throw new Error("No pending purchase belongs to this wallet and request");
    if (purchase.state === "settled" || purchase.state === "granted") return this.activate(owner, requestId);
    if (!txHash) throw new Error("Payment reconciliation is required. Preserve the original authorization and transaction; no new payment is requested.");
    const receipt = await this.verifyReceipt(owner, purchase, txHash);
    return this.settled(owner, requestId, receipt);
  }
}
