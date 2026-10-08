import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, hashTypedData, parseAbi, recoverTypedDataAddress, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertGatewayWallet, assertWithdrawalSpec, encodedWithdrawalSpec, maxArcGatewayDepositAtomic, parseWithdrawalQuote, prepareArcGatewayWithdrawal, prepareMaxArcGatewayWithdrawal, readPendingWithdrawal, resumeArcGatewayWithdrawal, signArcGatewayWithdrawal, trustlessArcGatewayWithdrawal, validateWithdrawalAttestation, withdrawalSpec, withdrawArcGateway } from "./arcGatewayWithdrawal";
const owner = `0x${"1".repeat(40)}` as Hex;
const salt = `0x${"2".repeat(64)}` as Hex;
const signature = `0x${"3".repeat(130)}` as Hex;
const store = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};
const attestation = (spec: ReturnType<typeof withdrawalSpec>) => `0x1e12db7100000001ff6fb334${toHex(200n, { size: 32 }).slice(2)}00000154${encodedWithdrawalSpec(spec).slice(2)}`;

test("deposit Max floors to six decimals and retains approval plus deposit gas", () => {
  const gasPrice = 20_000_000_000n;
  const reserve = 470_000n * gasPrice * 2n;
  assert.equal(maxArcGatewayDepositAtomic(10n ** 18n, gasPrice), 981_200n);
  assert.equal(maxArcGatewayDepositAtomic(reserve + 999_999_999_999n, gasPrice), 0n);
  assert.equal(maxArcGatewayDepositAtomic(reserve + 1_000_000_000_000n, gasPrice), 1n);
  assert.throws(() => maxArcGatewayDepositAtomic(10n ** 18n, 0n), /unavailable/);
});

test("withdrawal Max fits the live 3.9 USDC balance including changing fees without signing", async t => {
  let estimates = 0, balance = "3.9";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), body = JSON.parse(String(init?.body));
    if (url.endsWith("/balances")) return Response.json({ balances: [{ domain: 26, balance }] });
    assert.ok(url.endsWith("/estimate"), "Max must not submit a signed transfer");
    estimates++;
    const maxFee = estimates === 1 ? "3850" : "4000";
    return Response.json([{ burnIntent: { spec: body[0].spec, maxFee, maxBlockHeight: "200" } }]);
  });
  const quote = await prepareMaxArcGatewayWithdrawal(owner);
  assert.equal(quote.amount, "3.896");
  assert.equal(BigInt(quote.spec.value) + BigInt(quote.maxFee), 3_900_000n);
  assert.equal(estimates, 3);
  balance = "0.003";
  await assert.rejects(() => prepareMaxArcGatewayWithdrawal(owner), /does not cover/);
});

test("zero wallet USDC blocks withdrawal before a mobile signature or Gateway debit", async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), body = JSON.parse(String(init?.body));
    if (url.endsWith("/estimate")) return Response.json([{ burnIntent: { spec: body[0].spec, maxFee: "3850", maxBlockHeight: "200" } }]);
    if (url.endsWith("/balances")) return Response.json({ balances: [{ domain: 26, balance: "3.9" }] });
    assert.ok(!url.endsWith("/transfer"));
    const result = body.method === "eth_chainId" ? "0x13b2" : body.method === "eth_blockNumber" ? "0x64" : body.method === "eth_gasPrice" ? "0x1" : "0x0";
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  });
  const provider = { async request({ method }: { method: string }) {
    requests.push(method);
    if (method === "eth_chainId") return "0x13b2";
    if (method === "eth_accounts") return [owner];
    throw { message: { message: "Unsupported mobile request" } };
  } };
  const quote = await prepareArcGatewayWithdrawal(owner, "3.8");
  await assert.rejects(() => withdrawArcGateway(provider, quote, store()), /Gateway USDC cannot pay the mint fee/);
  assert.deepEqual(requests, ["eth_chainId", "eth_accounts"]);
});

test("Gateway withdrawal quote binds mainnet domains, contracts, wallet, exact six-decimal amount and maximum fee", () => {
  const spec = withdrawalSpec(owner, "0.100001", salt);
  assert.equal(spec.value, "100001");
  const estimate = [{ burnIntent: { spec, maxFee: "3850", maxBlockHeight: "200" } }];
  const quote = parseWithdrawalQuote(estimate, owner, "0.100001", spec);
  assert.equal(quote.maxFee, "3850");
  for (const mutation of [{ destinationDomain: 7 }, { sourceToken: `0x${"4".repeat(40)}` }, { destinationRecipient: `0x${"4".repeat(40)}` }, { value: "100002" }, { hookData: "0x1234" }, { destinationCaller: `0x${"0".repeat(40)}` }]) {
    assert.throws(() => assertWithdrawalSpec({ ...spec, ...mutation }, spec), /mismatch/);
  }
  assert.throws(() => parseWithdrawalQuote([...estimate, ...estimate], owner, "0.100001", spec), /single/);
  assert.throws(() => withdrawalSpec(owner, "0.0000009", salt), /6 decimal/);
});

test("Gateway mint rejects changed recipient, amount, hooks, malformed and extra attestations", () => {
  const spec = withdrawalSpec(owner, "0.1", salt);
  assert.equal(validateWithdrawalAttestation({ attestation: attestation(spec), signature }, spec).expiry, 200n);
  const altered = withdrawalSpec(`0x${"5".repeat(40)}`, "0.1", salt);
  assert.throws(() => validateWithdrawalAttestation({ attestation: attestation(altered), signature }, spec), /does not match/);
  assert.throws(() => validateWithdrawalAttestation({ attestation: attestation(spec) + "00", signature }, spec), /does not match/);
  assert.throws(() => validateWithdrawalAttestation({ attestation: attestation(spec).replace("00000001ff6f", "00000002ff6f"), signature }, spec), /multiple/);
});

test("Gateway cannot sign when the wallet changes account or fails to switch to Arc", async () => {
  const requests: string[] = [];
  const provider = { async request({ method }: { method: string }) { requests.push(method); return method === "eth_chainId" ? "0x13b2" : [owner]; } };
  await assertGatewayWallet(provider, owner);
  await assert.rejects(() => assertGatewayWallet(provider, `0x${"9".repeat(40)}`), /account changed/);
  provider.request = async ({ method }) => { requests.push(method); return "0x7a69" as never; };
  await assert.rejects(() => assertGatewayWallet(provider, owner), /did not switch/);
  assert.equal(requests.includes("eth_signTypedData_v4"), false);
  assert.equal(requests.includes("eth_sendTransaction"), false);
});

test("Gateway API uncertainty keeps the signed request; recovery retries its salt and never signs another debit", async t => {
  // Public deterministic test account. No live provider or transaction.
  const account = privateKeyToAccount(toHex(1n, { size: 32 }));
  const storage = store();
  let intentSpec: ReturnType<typeof withdrawalSpec>;
  let transferCalls = 0, signatures = 0, sends = 0, used = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), request = JSON.parse(String(init?.body));
    if (url.endsWith("/estimate")) { intentSpec = request[0].spec; return Response.json([{ burnIntent: { spec: intentSpec, maxFee: "3850", maxBlockHeight: "200" } }]); }
    if (url.endsWith("/balances")) return Response.json({ balances: [{ domain: 26, balance: "0.5" }] });
    if (url.endsWith("/transfer")) {
      transferCalls++;
      assert.deepEqual(request[0].burnIntent.spec, intentSpec);
      if (transferCalls === 1) throw new Error("API connection lost after submission");
      return Response.json({ attestation: attestation(intentSpec!), signature });
    }
    assert.match(url, /rpc\.(?:mainnet|quicknode\.mainnet)\.arc\.io/);
    const req = request;
    const result = req.method === "eth_getTransactionReceipt" ? { transactionHash: req.params[0], transactionIndex: "0x0", blockHash: `0x${"9".repeat(64)}`, blockNumber: "0x64", from: account.address, to: `0x${"8".repeat(40)}`, cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", logs: [], logsBloom: `0x${"0".repeat(512)}`, status: "0x1", type: "0x2" } : req.method === "eth_chainId" ? "0x13b2" : req.method === "eth_blockNumber" ? "0x64" : req.method === "eth_getBalance" ? toHex(10n ** 18n) : req.method === "eth_gasPrice" ? "0x1" : req.method === "eth_call" ? `0x${(used ? "1" : "0").padStart(64, "0")}` : "0x0";
    return Response.json({ jsonrpc: "2.0", id: req.id, result });
  });
  const provider = { async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    if (method === "eth_chainId") return "0x13b2";
    if (method === "eth_accounts") return [account.address];
    if (["eth_getBalance", "eth_gasPrice", "wallet_switchEthereumChain"].includes(method)) throw { message: { message: "Mobile bridge does not support this method" } };
    if (method === "eth_signTypedData_v4") { signatures++; return account.signTypedData(JSON.parse(String(params![1]))); }
    if (method === "eth_sendTransaction") { sends++; throw new Error("User declined mint"); }
    return null;
  } };
  const quote = await prepareArcGatewayWithdrawal(account.address, "0.1");
  await assert.rejects(() => withdrawArcGateway(provider, quote, storage), /connection lost/);
  assert.equal(signatures, 1);
  assert.ok(readPendingWithdrawal(storage, account.address));
  await assert.rejects(() => withdrawArcGateway(provider, quote, storage), /Resume the existing/);
  await assert.rejects(() => resumeArcGatewayWithdrawal(provider, account.address, storage), /User declined/);
  assert.equal(signatures, 1); assert.equal(sends, 1); assert.equal(transferCalls, 2);
  assert.ok(readPendingWithdrawal(storage, account.address)?.attestation);
  const saved = readPendingWithdrawal(storage, account.address)!;
  saved.mintHash = `0x${"7".repeat(64)}`;
  storage.setItem(`pulse:arc:5042:gateway-withdrawal:${account.address.toLowerCase()}`, JSON.stringify(saved));
  await assert.rejects(() => resumeArcGatewayWithdrawal(provider, account.address, storage), /Receipt did not confirm/);
  assert.ok(readPendingWithdrawal(storage, account.address));
  used = true;
  assert.deepEqual(await resumeArcGatewayWithdrawal(provider, account.address, storage), { hash: saved.mintHash, recovered: true });
  assert.equal(transferCalls, 2); assert.equal(sends, 1); assert.equal(readPendingWithdrawal(storage, account.address), null);
});

test("OKX mobile NaN chain rejection retries the same Gateway digest and completes one reviewed withdrawal", async t => {
  const account = privateKeyToAccount(toHex(1n, {size:32}));
  const spec = withdrawalSpec(account.address,"3.89615",salt);
  const quote = parseWithdrawalQuote([{burnIntent:{spec,maxFee:"3850",maxBlockHeight:"200"}}],account.address,"3.89615",spec);
  let attempts=0, transfers=0, sends=0, used=false;
  let original: Parameters<typeof hashTypedData>[0];
  t.mock.method(globalThis,"fetch",async (input: unknown, init?: RequestInit) => {
    const url=String(input),body=JSON.parse(String(init?.body));
    if(url.endsWith("/balances"))return Response.json({balances:[{domain:26,balance:"3.9"}]});
    if(url.endsWith("/transfer")) {
      transfers++;
      assert.deepEqual(body[0].burnIntent.spec,spec);
      assert.equal((await recoverTypedDataAddress({...original,signature:body[0].signature})).toLowerCase(),account.address.toLowerCase());
      return Response.json({attestation:attestation(spec),signature});
    }
    const req=body;
    const result=req.method==="eth_chainId"?"0x13b2":req.method==="eth_blockNumber"?"0x64"
      :req.method==="eth_getBalance"?toHex(10n**18n):req.method==="eth_gasPrice"?"0x1"
      :req.method==="eth_call"?toHex(used?1n:0n,{size:32})
      :req.method==="eth_getTransactionReceipt"?{transactionHash:req.params[0],transactionIndex:"0x0",blockHash:toHex(9n,{size:32}),blockNumber:"0x64",from:account.address,to:"0x2222222d7164433c4C09B0b0D809a9b52C04C205",cumulativeGasUsed:"0x1",gasUsed:"0x1",effectiveGasPrice:"0x1",logs:[],logsBloom:`0x${"0".repeat(512)}`,status:"0x1",type:"0x2"}:"0x0";
    return Response.json({jsonrpc:"2.0",id:req.id,result});
  });
  const provider={async request({method,params}:{method:string;params?:unknown[]}) {
    if(method==="eth_chainId")return "0x13b2";
    if(method==="eth_accounts")return [account.address];
    if(method==="eth_signTypedData_v4") {
      attempts++;
      const data=JSON.parse(String(params![1]));
      if(!data.domain.chainId) {original=data;throw {message:{message:'Provided chainId "NaN" must match the active chainId "5042"'}};}
      assert.equal(data.domain.chainId,5042);
      assert.deepEqual(data.types.EIP712Domain,[{name:"name",type:"string"},{name:"version",type:"string"}]);
      assert.equal(hashTypedData(data),hashTypedData(original));
      assert.deepEqual(data.message,original.message);
      return account.signTypedData(data);
    }
    if(method==="eth_sendTransaction") {sends++;used=true;return toHex(7n,{size:32});}
    throw Error(`Unexpected wallet method ${method}`);
  }};
  const storage=store();
  assert.deepEqual(await withdrawArcGateway(provider,quote,storage),{hash:toHex(7n,{size:32}),recovered:false});
  assert.equal(attempts,2);assert.equal(transfers,1);assert.equal(sends,1);
  assert.equal(readPendingWithdrawal(storage,account.address),null);
});

test("Gateway signing never retries a rejection or real chain mismatch", async () => {
  const account=privateKeyToAccount(toHex(1n,{size:32}));
  const spec=withdrawalSpec(account.address,"0.1",salt);
  const quote=parseWithdrawalQuote([{burnIntent:{spec,maxFee:"3850",maxBlockHeight:"200"}}],account.address,"0.1",spec);
  for(const error of [{code:4001,message:'Provided chainId "NaN" must match the active chainId "5042"'},
    {message:'Provided chainId "NaN" must match the active chainId "5042"',data:{originalError:{code:4001}}},
    new Error('Provided chainId "1" must match the active chainId "5042"'),new Error("Wallet connection lost after signing")]) {
    let attempts=0;
    const provider={async request({method}:{method:string}) {
      if(method==="eth_chainId")return "0x13b2";
      if(method==="eth_accounts")return [account.address];
      attempts++;throw error;
    }};
    await assert.rejects(()=>signArcGatewayWithdrawal(provider,quote));
    assert.equal(attempts,1);
  }
});

test("wallets that add chainId to the signed Gateway domain are rejected before saving or debiting", async () => {
  const account=privateKeyToAccount(toHex(1n,{size:32}));
  const spec=withdrawalSpec(account.address,"0.1",salt);
  const quote=parseWithdrawalQuote([{burnIntent:{spec,maxFee:"3850",maxBlockHeight:"200"}}],account.address,"0.1",spec);
  let attempts=0;
  const provider={async request({method,params}:{method:string;params?:unknown[]}) {
    if(method==="eth_chainId")return "0x13b2";
    if(method==="eth_accounts")return [account.address];
    assert.equal(method,"eth_signTypedData_v4");attempts++;
    const data=JSON.parse(String(params![1]));
    if(!data.domain.chainId)throw new Error('Provided chainId "NaN" must match the active chainId "5042"');
    data.types.EIP712Domain.push({name:"chainId",type:"uint256"});
    return account.signTypedData(data);
  }};
  await assert.rejects(()=>signArcGatewayWithdrawal(provider,quote),/original Gateway intent/);
  assert.equal(attempts,2);
});

test("contract fallback cannot claim before the delay or add funds while a withdrawal is pending", async t => {
  const balanceAbi = parseAbi(["function availableBalance(address,address) view returns(uint256)", "function withdrawingBalance(address,address) view returns(uint256)", "function withdrawableBalance(address,address) view returns(uint256)", "function withdrawalBlock(address,address) view returns(uint256)", "function withdrawalDelay() view returns(uint256)"]);
  const selectors = new Map((["availableBalance", "withdrawingBalance", "withdrawableBalance", "withdrawalBlock"] as const).map((name, i) => [encodeFunctionData({ abi: balanceAbi, functionName: name, args: [`0x${"3".repeat(40)}`, owner] }).slice(0, 10), [10000n, 2000n, 0n, 500n][i]]));
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    const result = req.method === "eth_chainId" ? "0x13b2" : req.method === "eth_blockNumber" ? "0x64" : toHex(selectors.get(String(req.params?.[0]?.data).slice(0, 10)) ?? 400n, { size: 32 });
    return Response.json({ jsonrpc: "2.0", id: req.id, result });
  });
  let sends = 0;
  const provider = { async request({ method }: { method: string }) { if (method === "eth_sendTransaction") sends++; return method === "eth_chainId" ? "0x13b2" : [owner]; } };
  await assert.rejects(() => trustlessArcGatewayWithdrawal(provider, owner, null, store()), /No Gateway USDC is ready/);
  await assert.rejects(() => trustlessArcGatewayWithdrawal(provider, owner, "0.001", store()), /reset its waiting period/);
  assert.equal(sends, 0);
});
