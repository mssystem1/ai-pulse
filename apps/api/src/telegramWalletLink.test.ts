import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import type { AppConfig } from "@pulse/config";
import { MemoryJobStore, type PaymentReceipt } from "./jobs.js";
import { TelegramWalletLink } from "./telegramWalletLink.js";

test("wallet linking requires real ownership and Telegram confirmation, rejects substitution and revokes history on unlink", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const jobs = new MemoryJobStore();
  const links = new TelegramWalletLink({ NODE_ENV:"test",PERSISTENCE_NAMESPACE:"wallet-link-fixture" } as AppConfig,jobs);
  const attempt = await links.start(123);
  assert.equal(await links.association(123),null);
  assert.equal(await links.status(456,attempt.id),null);
  await assert.rejects(links.confirm(123,attempt.id),/Sign with your wallet/);
  const challenge = await links.challenge(attempt.token,account.address);
  assert.match(challenge.message,/Telegram account ID: 123/);
  assert.match(challenge.message,/does not authorize a payment, transfer or trade/);
  await assert.rejects(links.signed(attempt.token,account.address,await other.signMessage({message:challenge.message})),/invalid/);
  await links.signed(attempt.token,account.address,await account.signMessage({message:challenge.message}));
  assert.equal(await links.association(123),null,"A stolen browser token cannot attach an attacker's wallet without Telegram approval");
  await assert.rejects(links.confirm(456,attempt.id));
  await links.confirm(123,attempt.id);
  assert.equal((await links.association(123))?.wallet,account.address.toLowerCase());
  await assert.rejects(links.start(123),/already linked/);
  await assert.rejects(links.signed(attempt.token,account.address,await account.signMessage({message:challenge.message})),/expired/);
  const at=new Date().toISOString();
  const receipt: PaymentReceipt={id:"receipt-fixture",provider:"fixture",network:"eip155:8453",chainId:8453,asset:"USDC",amountAtomic:"200000",payer:account.address.toLowerCase(),payee:other.address,authorizationId:"paid",resourceUrl:"/v1/analysis/spot/standard",requestHash:"fixture",verificationResult:"accepted_by_middleware",settlementResult:"settled",settlementMode:"synchronous_onchain",finality:{status:"receipt_verified",scope:"l2"},createdAt:at,verifiedAt:at,settledAt:at};
  const acquired=await jobs.acquire({idempotencyKey:"wallet-report-fixture",requestHash:"fixture",resourceUrl:receipt.resourceUrl,network:receipt.network,networkKey:"base",mode:"spot",tier:"standard",payer:account.address.toLowerCase(),input:{instId:"BTC-USDT"},maxRegenerationAttempts:2});
  await jobs.bindReceiptAndEnqueue(acquired.job.id,receipt);
  assert.equal((await links.history(123)).length,1);
  assert.equal((await links.history(456)).length,0);
  assert.ok(await links.ownedJob(123,acquired.job.id));
  assert.equal(await links.ownedJob(456,acquired.job.id),null);
  // A wallet cannot be attached to another Telegram account while linked.
  const competing=await links.start(456);const secondChallenge=await links.challenge(competing.token,account.address);
  await links.signed(competing.token,account.address,await account.signMessage({message:secondChallenge.message}));
  await assert.rejects(links.confirm(456,competing.id),/another Telegram/);
  await links.unlink(123);
  assert.equal((await links.history(123)).length,0);
  assert.equal(await links.ownedJob(123,acquired.job.id),null);
  assert.ok(await jobs.get(acquired.job.id),"Unlinking leaves original paid reports intact");
  await links.confirm(456,competing.id);
  assert.equal((await links.history(456)).length,1);
  const replacement=await links.start(456,true);
  assert.equal((await links.association(456))?.wallet,account.address.toLowerCase(),"Old association remains active throughout replacement");
  const replacementChallenge=await links.challenge(replacement.token,other.address);
  await links.signed(replacement.token,other.address,await other.signMessage({message:replacementChallenge.message}));
  assert.equal((await links.association(456))?.wallet,account.address.toLowerCase());
  await links.confirm(456,replacement.id);
  assert.equal((await links.association(456))?.wallet,other.address.toLowerCase(),"Only Telegram confirmation replaces the account wallet");
  assert.equal((await links.history(456)).length,0,"Previous wallet history is removed after the explicit replacement");
});

test("restarting a link revokes the old browser capability and signing rejects an expired link",async()=>{
  const links=new TelegramWalletLink({NODE_ENV:"test"} as AppConfig,new MemoryJobStore());
  const first=await links.start(1000);const second=await links.start(1000);
  const account=privateKeyToAccount(`0x${"33".repeat(32)}`);
  await assert.rejects(links.challenge(first.token,account.address),/expired/);
  const realNow=Date.now;
  try {Date.now=()=>second.expiresAt+1;await assert.rejects(links.challenge(second.token,account.address),/expired/);} finally {Date.now=realNow;}
});

test("a missing production store cannot masquerade as a disconnected account wallet",async()=>{
  const links=new TelegramWalletLink({NODE_ENV:"production"} as AppConfig,new MemoryJobStore());
  await assert.rejects(links.association(123),/has not been disconnected/);
});

test("account wallet loads from durable storage after a new API instance and does not expire with browser sessions",async()=>{
  const env={QUEUE_PROVIDER:process.env.QUEUE_PROVIDER,KV_REST_API_URL:process.env.KV_REST_API_URL,KV_REST_API_TOKEN:process.env.KV_REST_API_TOKEN};
  delete process.env.QUEUE_PROVIDER;process.env.KV_REST_API_URL="https://wallet-persistence-fixture.test";process.env.KV_REST_API_TOKEN="test-token";
  const realFetch=globalThis.fetch, realNow=Date.now;
  const saved={wallet:`0x${"44".repeat(20)}`,linkedAt:new Date().toISOString()};
  const durable=new Map([["durable-fixture:telegram:wallet:account:123",JSON.stringify(saved)]]);
  globalThis.fetch=(async (_input,init)=>{const command=JSON.parse(String(init?.body));assert.equal(command[0],"GET");return Response.json({result:durable.get(command[1]) || null});}) as typeof fetch;
  try {
    const first=new TelegramWalletLink({NODE_ENV:"test",PERSISTENCE_NAMESPACE:"durable-fixture"} as AppConfig,new MemoryJobStore());
    assert.deepEqual(await first.association(123),saved);
    Date.now=()=>realNow()+90*24*60*60_000;
    const restarted=new TelegramWalletLink({NODE_ENV:"test",PERSISTENCE_NAMESPACE:"durable-fixture"} as AppConfig,new MemoryJobStore());
    assert.deepEqual(await restarted.association(123),saved,"A new process and expired browser session keep the same account wallet");
    assert.equal(await restarted.association(456),null,"Another Telegram account cannot inherit the first account's wallet");
  } finally {globalThis.fetch=realFetch;Date.now=realNow;for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
