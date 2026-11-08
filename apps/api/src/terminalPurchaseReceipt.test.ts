import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { getNetwork } from "@pulse/config";
import { verifyTerminalPurchaseReceipt } from "./terminalPayments.js";
import type { TerminalPurchase } from "./terminalStore.js";
const owner="0x"+"11".repeat(20),payee="0x"+"22".repeat(20),nonce="0x"+"33".repeat(32),hash="0x"+"44".repeat(32),blockHash="0x"+"55".repeat(32);
const abi=parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)","event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)"]);
for(const network of ["xlayer","base","arbitrum"] as const)test(`lost acknowledgement receipt on ${network} binds token, payer, creator, amount, nonce and post-intent block`,async()=>{
  const asset=getNetwork(network).paymentAsset.address!,createdAt=new Date(Date.now()-60000).toISOString();
  const purchase={network,asset,payee,nonce,amountAtomic:"1000",preparedBlock:"100",createdAt} as TerminalPurchase;
  function client(change:Record<string,unknown>={}){
    const address=String(change.asset??asset),from=String(change.from??owner),to=String(change.to??payee),usedNonce=String(change.nonce??nonce);
    const logs=[{address,topics:encodeEventTopics({abi,eventName:"Transfer",args:{from:from as `0x${string}`,to:to as `0x${string}`}}),data:encodeAbiParameters([{type:"uint256"}],[BigInt(String(change.amount??1000))])},{address,topics:encodeEventTopics({abi,eventName:"AuthorizationUsed",args:{authorizer:owner as `0x${string}`,nonce:usedNonce as `0x${string}`}}),data:"0x"}];
    return {getTransactionReceipt:async()=>({status:change.status??"success",blockNumber:BigInt(String(change.block??101)),blockHash,logs}),getBlock:async()=>({timestamp:BigInt(Math.floor((change.timestamp as number|undefined??Date.now())/1000))})} as unknown as NonNullable<Parameters<typeof verifyTerminalPurchaseReceipt>[3]>;
  }
  assert.equal((await verifyTerminalPurchaseReceipt(owner,purchase,hash,client())).settlementTx,hash);
  for(const change of [{asset:"0x"+"99".repeat(20)},{from:payee},{to:owner},{amount:1001},{nonce:"0x"+"66".repeat(32)},{block:100},{status:"reverted"},{timestamp:Date.parse(createdAt)-600000}])await assert.rejects(()=>verifyTerminalPurchaseReceipt(owner,purchase,hash,client(change)));
});
