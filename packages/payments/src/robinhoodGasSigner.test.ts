import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { keccak256, parseTransaction, type Hex } from "viem";
import { eip3009ABI } from "@x402/evm";
import { createRobinhoodGasSigner, type RobinhoodGasSubmission } from "./robinhoodGasSigner.js";
import { ROBINHOOD_PAYMENT as CHAIN } from "./robinhoodPayment.js";
const payee = `0x${"2".repeat(40)}` as Hex;
const fixtureKey = `0x${"1".repeat(64)}` as Hex;
const args = { address: CHAIN.asset, abi: eip3009ABI, functionName: "transferWithAuthorization", args: [
  `0x${"3".repeat(40)}`, payee, 200000n, 0n, 2000000000n, `0x${"c".repeat(64)}`, 27, `0x${"d".repeat(64)}`, `0x${"e".repeat(64)}`,
] };

test("gas signer rejects arbitrary contracts, methods, payees, amounts and suffixes before RPC", async () => {
  const signer = createRobinhoodGasSigner({ privateKey: fixtureKey, rpcUrl: "http://127.0.0.1:1", payTo: payee,
    amounts: ["200000"], maxGasCostEth: "0.00001", journal: { exclusive: async () => { throw new Error("Must not acquire signer"); } } });
  await assert.rejects(signer.sendTransaction({ to: payee, data: "0x" }), /disabled/);
  for (const request of [
    { ...args, address: payee }, { ...args, functionName: "approve" },
    { ...args, args: [args.args[0], args.args[0], ...args.args.slice(2)] },
    { ...args, args: [...args.args.slice(0, 2), 1n, ...args.args.slice(3)] },
    { ...args, dataSuffix: "0x01" as Hex },
  ]) await assert.rejects(signer.writeContract(request), /denied/);
});

test("prepared transaction is durably reserved before exactly one broadcast; an unresolved nonce is never reused", async () => {
  let saved: RobinhoodGasSubmission | null = null;
  let broadcast = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const call = JSON.parse(body);
    let result: unknown;
    switch (call.method) {
      case "eth_chainId": result = "0x1237"; break;
      case "eth_getTransactionCount": result = "0x0"; break;
      case "eth_estimateGas": result = "0x186a0"; break;
      case "eth_maxPriorityFeePerGas": result = "0x186a0"; break;
      case "eth_gasPrice": result = "0xf4240"; break;
      case "eth_getBalance": result = "0xde0b6b3a7640000"; break;
      case "eth_getBlockByNumber": result = { number: "0x64", hash: `0x${"0".repeat(64)}`, parentHash: `0x${"0".repeat(64)}`, baseFeePerGas: "0xf4240", timestamp: "0x6b49d200", gasLimit: "0x1c9c380", gasUsed: "0x0", difficulty: "0x0", size: "0x0", transactions: [], uncles: [], extraData: "0x", miner: payee }; break;
      case "eth_sendRawTransaction": {
        // Fixture raw tx stays in memory and is never printed or persisted.
        const raw = call.params[0] as Hex;
        assert.ok(saved, "Must save before RPC broadcast");
        assert.equal(saved.transaction, keccak256(raw));
        const tx = parseTransaction(raw);
        assert.equal(tx.chainId, 4663); assert.equal(tx.nonce, 0);
        assert.equal(tx.to?.toLowerCase(), CHAIN.asset.toLowerCase());
        assert.ok(tx.gas! * tx.maxFeePerGas! <= 10000000000000n);
        broadcast++; result = saved.transaction; break;
      }
      default:
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "Method not supported by fixture" } }));
        return;
    }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
  });
  server.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const signer = createRobinhoodGasSigner({ privateKey: fixtureKey, rpcUrl: `http://127.0.0.1:${address.port}`, payTo: payee,
    amounts: ["200000"], maxGasCostEth: "0.00001", journal: { exclusive: async (_signer, run) => run(saved, async next => { saved = next; }) } });
  try {
    const hash = await signer.writeContract(args);
    assert.ok(saved); assert.equal(hash, (saved as RobinhoodGasSubmission).transaction);
    assert.equal(broadcast, 1);
    await assert.rejects(signer.writeContract(args), /unresolved transaction/);
    assert.equal(broadcast, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
