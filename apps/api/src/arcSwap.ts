import { createPublicClient, decodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { executionContractAddress } from "./executionContracts.js";
import type { getGenericOkxSwap } from "./okxDex.js";
import { OKX_DAG_ABI } from "./okxDag.js";

/** Bind executable calldata to intent before wallet approval or keeper signing. */
export async function validateArcSwap(swap: Awaited<ReturnType<typeof getGenericOkxSwap>>, input: {
  from: string; to: string; amount: string; receiver: string; slippageBps: number;
}, now = Date.now(), poolTokens?: (pool: Address) => Promise<readonly [Address, Address]>) {
  const { quote, tx } = swap;
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 1000) throw new Error("Invalid Arc route slippage");
  if (!/^[1-9]\d*$/.test(input.amount)) throw new Error("Invalid Arc route amount");
  const amount = BigInt(input.amount);
  if (!quote || quote.chainId !== "5042" || quote.fromToken.address.toLowerCase() !== input.from.toLowerCase()
    || quote.toToken.address.toLowerCase() !== input.to.toLowerCase() || !/^\d+$/.test(quote.fromTokenAmount)
    || !/^[1-9]\d*$/.test(quote.toTokenAmount) || BigInt(quote.fromTokenAmount) !== amount) throw new Error("Arc route quote identity mismatch");
  const router = executionContractAddress("arc", "okxRouter");
  if (!router || tx.to.toLowerCase() !== router.toLowerCase() || tx.from.toLowerCase() !== input.receiver.toLowerCase()
    || !/^0x(?:[\da-f]{2})+$/i.test(tx.data) || tx.data.length > 131_074
    || BigInt(tx.value) !== (input.from.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ? amount : 0n)) throw new Error("Arc route transaction mismatch");
  const decoded = decodeFunctionData({ abi: OKX_DAG_ABI, data: tx.data as Hex });
  if (decoded.functionName === "uniswapV3SwapTo") {
    const [packedReceiver, inputAmount, minimum, pools] = decoded.args;
    const mask = (1n << 160n) - 1n;
    const receiver = packedReceiver & mask;
    if ((receiver !== 0n && receiver !== BigInt(input.receiver)) || inputAmount !== amount || pools.length < 1 || pools.length > 16)
      throw new Error("Arc route calldata identity mismatch");
    if (minimum <= 0n || minimum < BigInt(quote.toTokenAmount) * BigInt(10000 - input.slippageBps) / 10000n || minimum > BigInt(quote.toTokenAmount)) throw new Error("Arc route minimum received mismatch");
    // The public V3 entry point derives assets from its pools. Verify every hop
    // on Arc; provider quote metadata alone cannot establish those assets.
    // https://github.com/okxlabs/Web3-DEX-Router-EVM-V1/blob/main/contracts/8/libraries/UniswapTokenInfoHelper.sol
    if (BigInt(tx.value) !== 0n || (pools.at(-1)! & (1n << 253n)) !== 0n) throw new Error("Arc direct pool route requires ERC-20 assets without native wrapping");
    if (!poolTokens) {
      const client = createPublicClient({ transport: http(process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io", { timeout: 8000, retryCount: 0 }) });
      if (await client.getChainId() !== 5042) throw new Error("Arc route pool RPC network mismatch");
      const abi = parseAbi(["function token0() view returns(address)", "function token1() view returns(address)"]);
      poolTokens = async address => Promise.all([
        client.readContract({ address, abi, functionName: "token0" }),
        client.readContract({ address, abi, functionName: "token1" }),
      ]);
    }
    let current = input.from.toLowerCase();
    for (const packed of pools) {
      const address = `0x${(packed & mask).toString(16).padStart(40, "0")}` as Address;
      let tokens: readonly [Address, Address];
      try { tokens = await poolTokens(address); } catch { throw new Error("Arc route pool evidence unavailable"); }
      const reversed = (packed & (1n << 255n)) !== 0n;
      const [from, to] = reversed ? [tokens[1], tokens[0]] : tokens;
      if (from.toLowerCase() !== current) throw new Error("Arc route pool token path mismatch");
      current = to.toLowerCase();
    }
    if (current !== input.to.toLowerCase()) throw new Error("Arc route pool output token mismatch");
    return { minimum, expiresAt: now + 30_000 };
  }
  const receiver = decoded.functionName === "dagSwapTo" ? decoded.args[1] : tx.from;
  const base = decoded.functionName === "dagSwapTo" ? decoded.args[2] : decoded.args[1];
  if (receiver.toLowerCase() !== input.receiver.toLowerCase() || base.toToken.toLowerCase() !== input.to.toLowerCase()
    || (base.fromToken & ((1n << 160n) - 1n)) !== BigInt(input.from) || base.fromTokenAmount !== amount) throw new Error("Arc route calldata identity mismatch");
  const minimum = BigInt(quote.toTokenAmount) * BigInt(10000 - input.slippageBps) / 10000n;
  if (base.minReturnAmount <= 0n || base.minReturnAmount < minimum || base.minReturnAmount > BigInt(quote.toTokenAmount)) throw new Error("Arc route minimum received mismatch");
  if (base.deadLine <= BigInt(Math.floor(now / 1000) + 15)) throw new Error("Arc route expired");
  return { minimum: base.minReturnAmount, expiresAt: Math.min(now + 30_000, Number(base.deadLine) * 1000) };
}
