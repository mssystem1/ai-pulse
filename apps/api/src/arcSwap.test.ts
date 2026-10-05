import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { OKX_DAG_ABI } from "./okxDag.js";
import { validateArcSwap } from "./arcSwap.js";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const router = "0x4E3bcCE28cAf98A143Fd8BD9e4875ccAb3E7bBE0";
const usdc = "0x3600000000000000000000000000000000000000";
const weth = "0x128cC466B61f542da60c70e3aA11c10e19B84EDB";
const now = 1_800_000_000_000;
const base = { fromToken: BigInt(usdc), toToken: weth, fromTokenAmount: 100000n, minReturnAmount: 29850000000000n, deadLine: BigInt(now / 1000 + 600) };
function sample(changes: Partial<typeof base> = {}, receiver: `0x${string}` = owner) {
  return { quote: { chainId: "5042", fromTokenAmount: "100000", toTokenAmount: "30000000000000", fromToken: { address: usdc, decimals: 6, symbol: "USDC" }, toToken: { address: weth, decimals: 18, symbol: "WETH" }, priceImpactPercent: "0.01", estimateGasFee: "0", tradeFee: "0", route: ["Fixture"], quoteId: "fixture" },
    tx: { from: owner, to: router, value: "0", gas: "1", gasPrice: "1", maxPriorityFeePerGas: null, data: encodeFunctionData({ abi: OKX_DAG_ABI, functionName: "dagSwapTo", args: [1n, receiver, { ...base, ...changes }, []] }) }, slippage: { mode: "manual", percent: "0.5", maxPercent: null } };
}
const input = { from: usdc, to: weth, amount: "100000", receiver: owner, slippageBps: 50 };
test("Arc executable routes enforce recipient/assets/input/minimum/deadline inside calldata", async t => {
  const before = process.env.ARC_OKX_ROUTER_ADDRESS;
  process.env.ARC_OKX_ROUTER_ADDRESS = router;
  t.after(() => { if (before === undefined) delete process.env.ARC_OKX_ROUTER_ADDRESS; else process.env.ARC_OKX_ROUTER_ADDRESS = before; });
  assert.equal((await validateArcSwap(sample(), input, now)).minimum, base.minReturnAmount);
  for (const bad of [sample({}, other), sample({ fromToken: 1n }), sample({ toToken: other }), sample({ fromTokenAmount: 1n }), sample({ minReturnAmount: 1n }), sample({ deadLine: BigInt(now / 1000) })]) await assert.rejects(validateArcSwap(bad, input, now), /Arc route/);
  for (const bad of [{ ...sample(), tx: { ...sample().tx, value: "1" } }, { ...sample(), tx: { ...sample().tx, to: other } }, { ...sample(), quote: { ...sample().quote, chainId: "5042002" } }]) await assert.rejects(validateArcSwap(bad, input, now), /Arc route/);
  const byOrder = sample();
  byOrder.tx.data = encodeFunctionData({ abi: OKX_DAG_ABI, functionName: "dagSwapByOrderId", args: [1n, base, []] });
  assert.equal(byOrder.tx.data.slice(0, 10), "0xf2c42696");
  assert.equal((await validateArcSwap(byOrder, input, now)).minimum, base.minReturnAmount);
});

test("Arc direct V3 routes derive every token hop from mainnet pool evidence", async t => {
  const before = process.env.ARC_OKX_ROUTER_ADDRESS;
  process.env.ARC_OKX_ROUTER_ADDRESS = router;
  t.after(() => { if (before === undefined) delete process.env.ARC_OKX_ROUTER_ADDRESS; else process.env.ARC_OKX_ROUTER_ADDRESS = before; });
  const pool = BigInt(other);
  const make = (pools = [pool], receiver = BigInt(owner), amount = 100000n, minimum = base.minReturnAmount) => ({ ...sample(), tx: { ...sample().tx, data: encodeFunctionData({ abi: OKX_DAG_ABI, functionName: "uniswapV3SwapTo", args: [receiver, amount, minimum, pools] }) } });
  const read = async () => [usdc, weth] as const;
  assert.equal((await validateArcSwap(make(), input, now, read)).minimum, base.minReturnAmount);
  await assert.rejects(validateArcSwap(make(), input, now, async () => [usdc, other]), /output token/);
  await assert.rejects(validateArcSwap(make(), input, now, async () => { throw new Error("RPC outage"); }), /evidence unavailable/);
  for (const bad of [make([pool | (1n << 255n)]), make([pool | (1n << 253n)]), make([], BigInt(owner)), make([pool], BigInt(other)), make([pool], BigInt(owner), 1n), make([pool], BigInt(owner), 100000n, 1n)]) await assert.rejects(validateArcSwap(bad, input, now, read));
});
