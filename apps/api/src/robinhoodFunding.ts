import { createPublicClient, decodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import type { AppConfig } from "@pulse/config";
import { getGenericOkxSwap } from "./okxDex.js";

// Official OKX deployment, checked against the live Swap API and Sourcify on
// 2026-09-21. A provider router migration must be reviewed, not silently trusted.
// https://web3.okx.com/onchainos/dev-docs/trade/dex-smart-contract
export const ROBINHOOD_FUNDING = {
  chainId: 4663,
  native: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  router: "0x6e2a35a7ad683cf634d91492d73bb7ff774c6919",
} as const;

// ABI from the verified deployed router (not the older published V1 artifact):
// https://sourcify.dev/server/v2/contract/4663/0x6e2a35a7ad683cf634d91492d73bb7ff774c6919?fields=abi
export const ROBINHOOD_FUNDING_ABI = parseAbi([
  "function dagSwapByOrderId(uint256 orderId, (uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest, (address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths) payable returns (uint256 returnAmount)",
  "function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest, (address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths) payable returns (uint256 returnAmount)",
]);
type PreparedSwap = Awaited<ReturnType<typeof getGenericOkxSwap>>;

/** Validate the executable DAG, not just its provider-supplied quote. Used by
 * wallet Spot and the contract-account keeper/executor paths. */
export function validateRobinhoodSwap(swap: PreparedSwap, input: { from: string; to: string; amount: string; receiver: string; slippageBps: number }, now = Date.now()) {
  const { quote, tx } = swap;
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 1000) throw new Error("Invalid route slippage");
  const amount = BigInt(input.amount);
  if (!quote || amount <= 0n || quote.chainId !== "4663" || quote.fromToken.address.toLowerCase() !== input.from.toLowerCase()
    || quote.toToken.address.toLowerCase() !== input.to.toLowerCase() || BigInt(quote.fromTokenAmount) !== amount || BigInt(quote.toTokenAmount) <= 0n)
    throw new Error("Robinhood route quote identity mismatch");
  if (tx.to.toLowerCase() !== ROBINHOOD_FUNDING.router || tx.from.toLowerCase() !== input.receiver.toLowerCase()
    || !/^0x(?:[\da-f]{2})+$/i.test(tx.data) || tx.data.length > 131_074
    || BigInt(tx.value) !== (input.from.toLowerCase() === ROBINHOOD_FUNDING.native ? amount : 0n)) throw new Error("Robinhood route transaction mismatch");
  const decoded = decodeFunctionData({ abi: ROBINHOOD_FUNDING_ABI, data: tx.data as Hex });
  const receiver = decoded.functionName === "dagSwapTo" ? decoded.args[1] : tx.from;
  const base = decoded.functionName === "dagSwapTo" ? decoded.args[2] : decoded.args[1];
  if (receiver.toLowerCase() !== input.receiver.toLowerCase() || base.toToken.toLowerCase() !== input.to.toLowerCase()
    || (base.fromToken & ((1n << 160n) - 1n)) !== BigInt(input.from) || base.fromTokenAmount !== amount) throw new Error("Robinhood route calldata identity mismatch");
  const minimum = BigInt(quote.toTokenAmount) * BigInt(10000 - input.slippageBps) / 10000n;
  if (base.minReturnAmount <= 0n || base.minReturnAmount < minimum || base.minReturnAmount > BigInt(quote.toTokenAmount)) throw new Error("Robinhood route minimum received mismatch");
  if (base.deadLine <= BigInt(Math.floor(now / 1000) + 15)) throw new Error("Robinhood route expired");
  return { minimum: base.minReturnAmount, expiresAt: Math.min(now + 30_000, Number(base.deadLine) * 1000) };
}

export function validateRobinhoodFunding(swap: PreparedSwap, amount: string, owner: string, now = Date.now()) {
  const { quote, tx } = swap;
  const expected = BigInt(amount);
  if (expected <= 0n || !/^0x[\da-f]{40}$/i.test(owner) || /^0x0{40}$/i.test(owner)) throw new Error("Invalid funding input");
  if (!quote || quote.chainId !== "4663" || quote.fromToken.address.toLowerCase() !== ROBINHOOD_FUNDING.native
    || quote.toToken.address.toLowerCase() !== ROBINHOOD_FUNDING.usdg.toLowerCase()
    || quote.fromToken.decimals !== 18 || quote.toToken.decimals !== 6
    || BigInt(quote.fromTokenAmount) !== expected || BigInt(quote.toTokenAmount) <= 0n) throw new Error("Funding quote asset or amount mismatch");
  if (!Number.isFinite(Number(quote.priceImpactPercent)) || Math.abs(Number(quote.priceImpactPercent)) > 1) throw new Error("Funding price impact exceeds the 1% limit");
  if (tx.to.toLowerCase() !== ROBINHOOD_FUNDING.router || tx.from.toLowerCase() !== owner.toLowerCase()
    || BigInt(tx.value) !== expected || !/^0x(?:[\da-f]{2})+$/i.test(tx.data) || tx.data.length > 131_074) throw new Error("Funding transaction mismatch");
  const decoded = decodeFunctionData({ abi: ROBINHOOD_FUNDING_ABI, data: tx.data as Hex });
  const receiver = decoded.functionName === "dagSwapTo" ? decoded.args[1] : tx.from;
  const base = decoded.functionName === "dagSwapTo" ? decoded.args[2] : decoded.args[1];
  if (receiver.toLowerCase() !== owner.toLowerCase() || base.toToken.toLowerCase() !== ROBINHOOD_FUNDING.usdg.toLowerCase()
    || (base.fromToken & ((1n << 160n) - 1n)) !== BigInt(ROBINHOOD_FUNDING.native)
    || base.fromTokenAmount !== expected) throw new Error("Funding calldata recipient or asset mismatch");
  const minimum = BigInt(quote.toTokenAmount) * 995n / 1000n;
  if (base.minReturnAmount <= 0n || base.minReturnAmount < minimum || base.minReturnAmount > BigInt(quote.toTokenAmount)) throw new Error("Funding minimum received is outside the 0.5% slippage limit");
  if (base.deadLine <= BigInt(Math.floor(now / 1000) + 15)) throw new Error("Funding transaction expired; request a fresh quote");
  return { network: "robinhood" as const, chainId: 4663, provider: "OKX DEX", fromAmount: amount,
    toAmount: quote.toTokenAmount, minToAmount: base.minReturnAmount.toString(), toToken: ROBINHOOD_FUNDING.usdg,
    priceImpactPercent: quote.priceImpactPercent, route: quote.route, slippagePercent: "0.5",
    expiresAt: Math.min(now + 45_000, Number(base.deadLine) * 1000),
    transaction: { from: tx.from, to: tx.to, value: tx.value, data: tx.data } };
}

/** Free preparation only. The connected wallet, never the server, signs funding. */
export async function prepareRobinhoodFunding(cfg: AppConfig, amount: string, owner: string) {
  const swap = await getGenericOkxSwap(cfg, { chainId: "4663", fromTokenAddress: ROBINHOOD_FUNDING.native,
    toTokenAddress: ROBINHOOD_FUNDING.usdg.toLowerCase(), amount, userWalletAddress: owner, slippagePercent: "0.5" });
  const result = validateRobinhoodFunding(swap, amount, owner);
  const rpc = createPublicClient({ transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: 12_000, retryCount: 0 }) });
  if (await rpc.getChainId() !== 4663) throw new Error("Funding RPC network mismatch");
  const code = await rpc.getCode({ address: result.transaction.to as Address });
  if (!code || code === "0x") throw new Error("Funding router is unavailable on Robinhood");
  return result;
}
