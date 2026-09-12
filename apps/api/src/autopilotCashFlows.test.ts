import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, type PublicClient } from "viem";
import { cashFlowCoverage, decodeOwnerCashFlow, recoverCashFlowPage, type CashFlowStrategy } from "./autopilotCashFlows.js";
import { cashFlowAdjustedPnl } from "./autopilotStrategyStore.js";
const owner = `0x${"1".repeat(40)}`, vault = `0x${"2".repeat(40)}`, token = `0x${"3".repeat(40)}`;
const strategy: CashFlowStrategy = { network: "base", owner, vault, settlementAsset: token, createdAt: "2026-09-09T00:00:00Z", baselineBlockNumber: "10" };
const padded = (address: string) => `0x${address.slice(2).padStart(64,"0")}`;
const makeLog = (block: number, withdrawal = false, logIndex = 0) => ({ address: token, topics: [keccak256(toHex("Transfer(address,address,uint256)")), padded(withdrawal ? vault : owner), padded(withdrawal ? owner : vault)], data: toHex(withdrawal ? 1000000n : 700000n, { size: 32 }), transactionHash: `0x${String(block).padStart(64,"0")}`, blockNumber: BigInt(block), blockHash: `block-${block}`, logIndex, removed: false });
function fixture(logs = [makeLog(12,true),makeLog(13)], tip = 80, badReceipt = false) {
  const queries: Array<{start:number;end:number}> = [];
  const client = {
    getBlockNumber: async () => BigInt(tip),
    getBlock: async ({blockNumber}: {blockNumber:bigint}) => ({ hash: `block-${blockNumber}`, timestamp: 1788912000n+blockNumber }),
    request: async ({params}: {params:Array<{fromBlock:string;toBlock:string;topics:Array<string|null>}>}) => {
      const request=params[0]; queries.push({start:Number(BigInt(request.fromBlock)),end:Number(BigInt(request.toBlock))});
      return logs.filter(log=>log.blockNumber>=BigInt(request.fromBlock)&&log.blockNumber<=BigInt(request.toBlock)&&request.topics.every((topic,i)=>topic===null||topic===log.topics[i])).map(log=>({...log,blockNumber:toHex(log.blockNumber),logIndex:toHex(log.logIndex)}));
    },
    getTransactionReceipt: async ({hash}: {hash:string}) => {const log=logs.find(log=>log.transactionHash===hash)!;return {status:badReceipt?"reverted":"success",blockHash:log.blockHash,blockNumber:log.blockNumber,logs:logs.filter(log=>log.transactionHash===hash)};},
  } as unknown as PublicClient;
  return {client,queries};
}
test("recovers missing deposit/withdrawal with receipts, without doubling existing proof", async () => {
  const {client}=fixture();
  const first=await recoverCashFlowPage(strategy,null,client);
  assert.equal(first.flows.length,2);
  const next=await recoverCashFlowPage(strategy,first,client);
  assert.equal(next.flows.length,2);
  assert.equal(next.throughBlock,"16");
  assert.equal(cashFlowAdjustedPnl(700000n,1000000n,next.flows).pnlAtomic,0n);
  assert.equal(cashFlowCoverage(next,token).state,"synced");
});
test("scan is bounded and resumes from the next block", async () => {
  const {client,queries}=fixture([],10000);
  const first=await recoverCashFlowPage(strategy,null,client,1);
  assert.equal(first.throughBlock,"2010");
  assert.equal(cashFlowCoverage(first,token).state,"recovering");
  const next=await recoverCashFlowPage(strategy,first,client,1);
  assert.equal(next.throughBlock,"4010");
  assert.equal(queries[2].start,2011);
  assert.ok(queries.every(query=>query.end-query.start<2000));
});
test("X Layer splits logical pages into contiguous 100-block reads with bounded concurrency", async () => {
  const {client,queries}=fixture([makeLog(110,true),makeLog(111),makeLog(2010)],2111);
  const original=client.request.bind(client);
  let active=0, maximum=0;
  client.request=(async (args: Parameters<typeof client.request>[0]) => {
    active++; maximum=Math.max(maximum,active);
    try { await new Promise(resolve=>setTimeout(resolve,1)); return await original(args); }
    finally { active--; }
  }) as typeof client.request;
  const s={...strategy,network:"xlayer" as const};
  const first=await recoverCashFlowPage(s,null,client,1);
  assert.equal(first.throughBlock,"2010");
  assert.equal(first.flows.length,3);
  assert.equal(queries.length,40);
  assert.ok(maximum<=2);
  assert.equal(active,0);
  for(let i=0;i<20;i++) {
    assert.deepEqual(queries[2*i],{start:11+i*100,end:110+i*100});
    assert.deepEqual(queries[2*i+1],queries[2*i]);
  }
  const next=await recoverCashFlowPage(s,first,client,1);
  assert.equal(next.throughBlock,"2047");
  assert.equal(next.flows.length,3);
  assert.deepEqual(queries[40],{start:2011,end:2047});
  assert.equal(cashFlowCoverage(next,token).state,"synced");
});
test("failed X Layer subrange drains in-flight reads and preserves the prior checkpoint", async () => {
  const s={...strategy,network:"xlayer" as const};
  const first=await recoverCashFlowPage(s,null,fixture([],5000).client,1);
  const snapshot=JSON.stringify(first);
  const {client}=fixture([],5000);
  const original=client.request.bind(client);
  let active=0;
  client.request=(async (args: Parameters<typeof client.request>[0]) => {
    active++;
    try {
      await new Promise(resolve=>setTimeout(resolve,1));
      const params=args.params as Array<{fromBlock:string}>;
      if(params?.[0]?.fromBlock===toHex(2111)) throw new Error("RPC unavailable");
      return await original(args);
    } finally { active--; }
  }) as typeof client.request;
  await assert.rejects(recoverCashFlowPage(s,first,client,1),/RPC unavailable/);
  assert.equal(active,0);
  assert.equal(JSON.stringify(first),snapshot);
  const retry=await recoverCashFlowPage(s,first,fixture([],5000).client,1);
  assert.equal(retry.throughBlock,"4010");
});
test("failed receipt cannot advance checkpoint or fabricate cash-flow confirmation", async () => {
  await assert.rejects(recoverCashFlowPage(strategy,null,fixture(undefined,80,true).client),/receipt verification/);
  assert.throws(()=>decodeOwnerCashFlow({...makeLog(12),removed:true},strategy),/not confirmed/);
  assert.equal(decodeOwnerCashFlow({...makeLog(12),topics:[...makeLog(12).topics,"nft-id"]},strategy),null);
});
test("a changed checkpoint hash replays the range instead of retaining orphaned flows", async () => {
  const first=await recoverCashFlowPage(strategy,null,fixture().client);
  const result=await recoverCashFlowPage(strategy,{...first,throughHash:"old-fork"},fixture([]).client);
  assert.equal(result.flows.length,0);
  assert.equal(result.throughHash,"block-16");
});
test("stale proofs and unpriced target withdrawals withhold PnL", async () => {
  const snapshot=await recoverCashFlowPage(strategy,null,fixture().client);
  assert.equal(cashFlowCoverage(snapshot,token,Date.parse(snapshot.updatedAt)+600001).state,"stale");
  assert.equal(cashFlowCoverage({...snapshot,flows:snapshot.flows.map(flow=>({...flow,token:owner}))},token).state,"unpriced_transfer");
});
test("legacy baselines use registration time, never scan owner history before the strategy", async () => {
  const legacy={...strategy,baselineBlockNumber:undefined,createdAt:new Date((1788912000+12)*1000).toISOString()};
  const result=await recoverCashFlowPage(legacy,null,fixture().client);
  assert.equal(result.fromBlock,"12");
  assert.equal(result.baselineSource,"legacy_timestamp");
});

test("external funding is not profit; verified executions are not capital flows", async () => {
  const external={...makeLog(12),topics:[...makeLog(12).topics]};
  external.topics[1]=padded(`0x${"4".repeat(40)}`);
  const funded=await recoverCashFlowPage(strategy,null,fixture([external]).client);
  assert.equal(funded.flows.length,1);
  assert.equal(cashFlowAdjustedPnl(1700000n,1000000n,funded.flows).pnlAtomic,0n);
  const execution={...external,address:vault,logIndex:1,topics:[keccak256(toHex("Executed(bytes32,address,uint256,address,address,uint256,uint256,bytes32)"))]};
  const traded=await recoverCashFlowPage(strategy,null,fixture([external,execution]).client);
  assert.equal(traded.flows.length,0);
  const spoofed={...execution,address:owner};
  assert.equal((await recoverCashFlowPage(strategy,null,fixture([external,spoofed]).client)).flows.length,1);
  assert.equal((await recoverCashFlowPage(strategy,null,fixture([makeLog(12),execution]).client)).flows.length,1);
});
