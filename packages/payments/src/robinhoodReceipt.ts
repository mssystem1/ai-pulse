import { createPublicClient, decodeEventLog, http, parseAbi, type Hex, type TransactionReceipt } from "viem";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";
import type { RobinhoodAttempt, RobinhoodObserver, RobinhoodProof } from "./robinhoodSettlement.js";

const events = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

/** An RPC receipt must prove both nonce consumption AND the exact USDG transfer.
 * A canceled/used nonce alone, a different asset, or a facilitator's claim is not
 * evidence of payment. This is L2 inclusion, not parent-chain finality. */
export function robinhoodReceiptProof(attempt: RobinhoodAttempt, receipt: TransactionReceipt): RobinhoodProof | null {
  if (receipt.status !== "success" || receipt.blockNumber < BigInt(attempt.fromBlock)
    || !/^0x[\da-f]{64}$/i.test(receipt.transactionHash) || !/^0x[\da-f]{64}$/i.test(receipt.blockHash)
    || (attempt.transaction && receipt.transactionHash.toLowerCase() !== attempt.transaction.toLowerCase())) return null;
  let transferred = false;
  let authorized = false;
  for (const log of receipt.logs) {
    if (log.removed || log.address.toLowerCase() !== CHAIN.asset.toLowerCase()
      || log.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase()
      || log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: events, data: log.data, topics: log.topics });
      if (decoded.eventName === "Transfer") {
        transferred ||= decoded.args.from.toLowerCase() === attempt.payer.toLowerCase()
          && decoded.args.to.toLowerCase() === attempt.payee.toLowerCase() && decoded.args.value === BigInt(attempt.amount);
      } else if (decoded.eventName === "AuthorizationUsed") {
        authorized ||= decoded.args.authorizer.toLowerCase() === attempt.payer.toLowerCase()
          && decoded.args.nonce.toLowerCase() === attempt.nonce.toLowerCase();
      }
    } catch { /* Other token events are irrelevant, not positive evidence. */ }
  }
  return transferred && authorized ? { transaction: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString() } : null;
}

export function robinhoodPaymentObserver(rpcUrl: string): RobinhoodObserver {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 8_000, retryCount: 0 }) });
  const assertChain = async () => { if (await client.getChainId() !== CHAIN.chainId) throw new Error("Robinhood RPC chain mismatch"); };
  return {
    async currentBlock() { await assertChain(); return client.getBlockNumber({ cacheTime: 0 }); },
    async proof(attempt) {
      await assertChain();
      const tip = await client.getBlockNumber({ cacheTime: 0 });
      let hash: Hex | undefined = attempt.transaction;
      if (!hash) {
        // Exact authorizer/nonce lookup recovers a transfer when /settle timed out
        // before returning its hash. Provider range limits fail closed to pending.
        const logs = await client.getLogs({ address: CHAIN.asset, event: events[1],
          args: { authorizer: attempt.payer, nonce: attempt.nonce }, fromBlock: BigInt(attempt.fromBlock), toBlock: tip, strict: true });
        const matches = logs.filter(log => !log.removed);
        if (matches.length !== 1) return null;
        hash = matches[0].transactionHash;
      }
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.blockNumber > tip) return null;
      const proof = robinhoodReceiptProof(attempt, receipt);
      if (!proof) return null;
      const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
      return canonical.hash === receipt.blockHash ? proof : null;
    },
  };
}
