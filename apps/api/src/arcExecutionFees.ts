import { parseEther, type Account, type Address, type Hex } from "viem";

type FeeClient = {
  estimateFeesPerGas(): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }>;
  estimateGas(input: { account: Address | Account; to: Address; data: Hex }): Promise<bigint>;
  getBalance(input: { address: Address }): Promise<bigint>;
};

/** Arc gas uses the native 18-decimal USDC balance. Pin a bounded fee before signing. */
export async function arcExecutionFees(client: FeeClient, tx: { account: Address | Account; to: Address; data: Hex }) {
  const fees = await client.estimateFeesPerGas();
  if (!fees.maxFeePerGas || fees.maxPriorityFeePerGas === undefined) throw new Error("Arc execution fee evidence unavailable");
  const gas = (await client.estimateGas(tx)) * 125n / 100n;
  const cost = gas * fees.maxFeePerGas;
  if (cost > parseEther("0.10")) throw new Error("Arc execution exceeds the 0.10 USDC transaction gas limit");
  const address = typeof tx.account === "string" ? tx.account : tx.account.address;
  if (await client.getBalance({ address }) < cost + parseEther("0.05")) throw new Error("Arc execution requires a USDC gas reserve");
  return { gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}
