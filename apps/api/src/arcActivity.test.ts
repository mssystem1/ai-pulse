import assert from "node:assert/strict";
import test from "node:test";
import { encodeEventTopics, erc20Abi, toHex } from "viem";
import { enrichExecutionFill, type Activity } from "./v6Store.js";
import type { executionPublicClient } from "./onchainDiscovery.js";

const owner = `0x${"1".repeat(40)}`, vault = `0x${"2".repeat(40)}`, adapter = `0x${"3".repeat(40)}`;
const usdc = "0x3600000000000000000000000000000000000000", weth = "0x128cc466b61f542da60c70e3aa11c10e19b84edb";
const system = "0xfffffffffffffffffffffffffffffffffffffffe";
const transfer = (token: string, from: string, to: string, value: bigint) => ({ address: token,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } }), data: toHex(value, { size: 32 }) });
const reader = { readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
  assert.ok(address === usdc || address === weth, "system ledger must never be queried as an ERC-20");
  return functionName === "symbol" ? address === usdc ? "USDC" : "WETH" : address === usdc ? 6 : 18;
}, getBlock: async () => ({ timestamp: 1791174629n }) } as unknown as ReturnType<typeof executionPublicClient>;
const activity = (kind: string): Activity => ({ id: kind, owner, network: "arc", source: "autopilot", kind, status: "confirmed", account: vault,
  txHash: `0x${"4".repeat(64)}`, createdAt: "2026-10-05T04:30:00.000Z", updatedAt: "2026-10-05T04:30:00.000Z" });

test("Arc exit history enriches one USDC payout despite its native system mirror", async () => {
  const fill = await enrichExecutionFill(activity("sell_filled"), { status: "success", from: owner, to: vault, blockNumber: "24333825", logs: [
    transfer(weth, vault, adapter, 36673893240074n), transfer(system, adapter, vault, 99294000000000000n), transfer(usdc, adapter, vault, 99294n),
  ] }, reader);
  assert.equal(fill.fillSide, "sell"); assert.equal(fill.fillOutputAmount, "99294"); assert.equal(fill.fillInputAmount, "36673893240074");
  assert.equal(fill.fillQuoteValue, .099294); assert.equal(fill.fillQuoteAsset, usdc); assert.ok(fill.fillPrice! > 0);
  assert.equal(fill.fillObservedAt, "2026-10-05T04:30:29.000Z");
});

test("Arc entry history uses 6-decimal USDC once and retains the real multi-asset guard", async () => {
  const item = activity("buy_filled");
  const logs = [transfer(system, vault, adapter, 100000000000000000n), transfer(usdc, vault, adapter, 100000n), transfer(weth, adapter, vault, 36673893240074n)];
  const fill = await enrichExecutionFill(item, { status: "success", from: owner, to: vault, blockNumber: "24333000", logs }, reader);
  assert.equal(fill.fillSide, "buy"); assert.equal(fill.fillInputAmount, "100000"); assert.equal(fill.fillQuoteValue, .1);
  const ambiguous = await enrichExecutionFill(item, { status: "success", from: owner, to: vault, blockNumber: "24333000", logs: [...logs,
    transfer(`0x${"5".repeat(40)}`, adapter, vault, 1n)] }, reader);
  assert.equal(ambiguous.fillPrice, undefined);
});
