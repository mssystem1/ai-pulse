import { createPublicClient, defineChain, encodeFunctionData, http, keccak256, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eip3009ABI } from "@x402/evm";
import type { RobinhoodGasSigner } from "./robinhoodSelfHosted.js";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";

export type RobinhoodGasSubmission = { nonce: number; transaction: Hex; payer: Address; authorizationNonce: Hex; recordedAt: string };
export interface RobinhoodGasJournal {
  /** Distributed signer lock. The previous prepared transaction must survive
   * process crashes; save must atomically check lock ownership before recording. */
  exclusive<T>(signer: Address, run: (previous: RobinhoodGasSubmission | null, save: (next: RobinhoodGasSubmission) => Promise<void>) => Promise<T>): Promise<T>;
}

/** A least-capability gas signer: only the canonical USDG transfer authorization
 * ABI, PULSE payee and catalog amounts. No approvals, native sends or arbitrary
 * contracts. Prepare/hash/save BEFORE broadcast; never automatically replace an
 * uncertain nonce. A separate funded facilitator key is required by the caller. */
export function createRobinhoodGasSigner(options: {
  privateKey: Hex; rpcUrl: string; payTo: Address; amounts: readonly string[];
  maxGasCostEth: string; journal: RobinhoodGasJournal;
}): RobinhoodGasSigner {
  const cap = parseEther(options.maxGasCostEth);
  if (cap <= 0n || cap > parseEther("0.001")) throw new Error("Invalid facilitator gas ceiling");
  if (!/^0x[\da-f]{40}$/i.test(options.payTo) || /^0x0{40}$/i.test(options.payTo) || !options.amounts.length) throw new Error("Invalid facilitator payee policy");
  const account = privateKeyToAccount(options.privateKey);
  const chain = defineChain({ id: CHAIN.chainId, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [options.rpcUrl] } } });
  const transport = http(options.rpcUrl, { timeout: 8_000, retryCount: 0 });
  const reader = createPublicClient({ chain, transport });
  const amounts = new Set(options.amounts);
  const assertChain = async () => { if (await reader.getChainId() !== CHAIN.chainId) throw new Error("Facilitator RPC chain mismatch"); };
  return {
    getAddresses: () => [account.address],
    readContract: args => reader.readContract(args as Parameters<typeof reader.readContract>[0]),
    verifyTypedData: args => reader.verifyTypedData(args as Parameters<typeof reader.verifyTypedData>[0]),
    getCode: args => reader.getCode(args),
    sendTransaction: async () => { throw new Error("Arbitrary facilitator transactions are disabled"); },
    waitForTransactionReceipt: args => reader.waitForTransactionReceipt({ ...args, timeout: 45_000, retryCount: 0 }),
    async writeContract(args) {
      if (args.address.toLowerCase() !== CHAIN.asset.toLowerCase() || args.functionName !== "transferWithAuthorization"
        || args.args.length !== 9 || args.dataSuffix || typeof args.args[1] !== "string"
        || args.args[1].toLowerCase() !== options.payTo.toLowerCase() || !amounts.has(String(args.args[2]))) {
        throw new Error("Facilitator transaction denied by merchant policy");
      }
      const [payer, , , , , authorizationNonce] = args.args;
      if (typeof payer !== "string" || !/^0x[\da-f]{40}$/i.test(payer)
        || typeof authorizationNonce !== "string" || !/^0x[\da-f]{64}$/i.test(authorizationNonce)) throw new Error("Invalid transfer authorization");
      // Ignore supplied ABI/gas. Encode against the installed official SDK ABI.
      const data = encodeFunctionData({ abi: eip3009ABI, functionName: "transferWithAuthorization", args: args.args as never });
      return options.journal.exclusive(account.address, async (previous, save) => {
        await assertChain();
        const [nonce, pending] = await Promise.all([
          reader.getTransactionCount({ address: account.address, blockTag: "latest" }),
          reader.getTransactionCount({ address: account.address, blockTag: "pending" }),
        ]);
        if (nonce !== pending || (previous && previous.nonce >= nonce)) throw new Error("Facilitator signer has an unresolved transaction; reconcile before reuse");
        const estimate = await reader.estimateGas({ account, to: CHAIN.asset, data });
        const gas = (estimate * 125n + 99n) / 100n;
        if (gas > 500_000n) throw new Error("Facilitator gas limit exceeds policy");
        const fees = await reader.estimateFeesPerGas();
        const ceiling = gas * fees.maxFeePerGas;
        if (ceiling > cap) throw new Error("Facilitator gas cost exceeds configured ceiling");
        if (await reader.getBalance({ address: account.address }) < ceiling) throw new Error("Facilitator gas balance insufficient");
        // All transaction fields are explicit. Do not allow RPC transaction-fill
        // extensions to change the checked recipient, nonce, gas or fee ceiling.
        const serialized = await account.signTransaction({ chainId: CHAIN.chainId, to: CHAIN.asset, data, value: 0n, nonce, gas,
          maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, type: "eip1559" });
        const hash = keccak256(serialized);
        await save({ nonce, transaction: hash, payer: payer as Address, authorizationNonce: authorizationNonce as Hex, recordedAt: new Date().toISOString() });
        // Do not log/persist the raw signed transaction. No automatic retry.
        const broadcast = await reader.sendRawTransaction({ serializedTransaction: serialized });
        if (broadcast.toLowerCase() !== hash.toLowerCase()) throw new Error("Facilitator broadcast identity mismatch");
        return hash;
      });
    },
  };
}
