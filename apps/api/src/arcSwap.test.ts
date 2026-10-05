import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
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

test("Arc pool validation uses fallback only for outages and rechecks every hop on mainnet", async t => {
  const names = ["ARC_RPC_URL", "ARC_RPC_FALLBACK_URL", "ARC_OKX_ROUTER_ADDRESS"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  process.env.ARC_RPC_URL = "https://primary.fixture.invalid";
  process.env.ARC_RPC_FALLBACK_URL = "https://fallback.fixture.invalid";
  process.env.ARC_OKX_ROUTER_ADDRESS = router;
  const secondPool = `0x${"4".repeat(40)}` as const;
  const middle = `0x${"3".repeat(40)}` as const;
  const swap = { ...sample(), tx: { ...sample().tx, data: encodeFunctionData({ abi: OKX_DAG_ABI,
    functionName: "uniswapV3SwapTo", args: [BigInt(owner), 100000n, base.minReturnAmount, [BigInt(other), BigInt(secondPool)]] }) } };
  const abi = parseAbi(["function token0() view returns(address)", "function token1() view returns(address)"]);
  type Options = { failure?: "early" | "late"; allUnavailable?: boolean; wrongPrimaryChain?: boolean;
    wrongFallbackChain?: boolean; mismatch?: "primary" | "fallback" };
  const run = async (options: Options, verify: (operation: Promise<Awaited<ReturnType<typeof validateArcSwap>>>) => Promise<unknown>) => {
    const reads: Array<{ provider: string; method: string; address?: string; functionName?: string }> = [];
    const fetchMock = t.mock.method(globalThis, "fetch", async (requestUrl, init) => {
      const provider = String(requestUrl).includes("primary") ? "primary" : "fallback";
      const request = JSON.parse(String(init?.body));
      const address = request.params?.[0]?.to?.toLowerCase();
      const functionName = request.method === "eth_call" ? decodeFunctionData({ abi, data: request.params[0].data }).functionName : undefined;
      reads.push({ provider, method: request.method, address, functionName });
      if (options.allUnavailable || (provider === "primary" && (options.failure === "early"
        || (options.failure === "late" && address === secondPool && functionName === "token1")))) return new Response("unavailable", { status: 503 });
      let result: string;
      if (request.method === "eth_chainId") result = (provider === "primary" ? options.wrongPrimaryChain : options.wrongFallbackChain) ? "0x4cef52" : "0x13b2";
      else if (functionName) result = encodeFunctionResult({ abi, functionName,
        result: functionName === "token0" ? (address === other ? usdc : middle)
          : options.mismatch === provider ? other : address === other ? middle : weth });
      else throw new Error(`Unexpected read-only RPC method: ${request.method}`);
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    });
    try { await verify(validateArcSwap(swap, input, now)); return reads; }
    finally { fetchMock.mock.restore(); }
  };
  await t.test("healthy primary does not contact fallback", async () => {
    const reads = await run({}, async operation => assert.equal((await operation).minimum, base.minReturnAmount));
    assert.ok(reads.every(read => read.provider === "primary"));
  });
  for (const failure of ["early", "late"] as const) await t.test(`${failure} outage revalidates both hops on fallback`, async () => {
    const reads = await run({ failure }, async operation => assert.equal((await operation).minimum, base.minReturnAmount));
    const fallback = reads.filter(read => read.provider === "fallback");
    assert.equal(fallback[0].method, "eth_chainId");
    assert.deepEqual(fallback.filter(read => read.method === "eth_call").map(read => [read.address, read.functionName]),
      [[other, "token0"], [other, "token1"], [secondPool, "token0"], [secondPool, "token1"]]);
  });
  await t.test("primary testnet cannot be masked by a healthy fallback", async () => {
    const reads = await run({ wrongPrimaryChain: true }, operation => assert.rejects(operation, /RPC network mismatch/));
    assert.deepEqual(reads.map(read => read.method), ["eth_chainId"]);
  });
  await t.test("testnet fallback cannot supply pool evidence", async () => {
    const reads = await run({ failure: "early", wrongFallbackChain: true }, operation => assert.rejects(operation, /RPC network mismatch/));
    assert.deepEqual(reads.map(read => read.method), ["eth_chainId", "eth_chainId"]);
  });
  for (const mismatch of ["primary", "fallback"] as const) await t.test(`${mismatch} token mismatch blocks execution`, async () => {
    const reads = await run({ mismatch, ...(mismatch === "fallback" ? { failure: "early" as const } : {}) },
      operation => assert.rejects(operation, /pool token path mismatch/));
    if (mismatch === "primary") assert.ok(reads.every(read => read.provider === "primary"));
  });
  await t.test("unavailable providers fail closed", async () => {
    const reads = await run({ allUnavailable: true }, operation => assert.rejects(operation, /pool evidence unavailable/));
    assert.deepEqual(reads.map(read => read.method), ["eth_chainId", "eth_chainId"]);
  });
});
