// Explicitly local simulation: real vault bytecode + API, mock payments and RAM.
// No production Redis/Blob, external RPC, facilitator, AI, or real funds.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import solc from "solc";
assert.ok(process.argv.includes("--simulate"), "Explicit --simulate required");
const signer = privateKeyToAccount(process.env.TEST_WALLET_PRIVATE_KEY);
assert.equal(signer.address.toLowerCase(), process.env.TEST_WALLET_ADDRESS?.toLowerCase(), "Test wallet/key mismatch");
const rpc = "http://127.0.0.1:19645";
const api = "http://127.0.0.1:14199";
// Drop all supplied app credentials before importing app modules or spawning EVM.
for (const key of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|REDIS|KV_REST|RPC|PAY_TO|WALLET|EXECUTOR|BLOB|BASE_URL/i.test(key)) delete process.env[key];
Object.assign(process.env, { NODE_ENV: "test", PULSE_SKIP_DOTENV: "1", QUEUE_PROVIDER: "memory", STORAGE_PROVIDER: "memory",
  AUTOMATION_WORKER_ENABLED: "0", FEATURE_TELEGRAM: "0", X402_MOCK: "1", BASE_URL: api,
  FEATURE_BASE_PAYMENTS: "0", FEATURE_ARBITRUM_PAYMENTS: "0", FEATURE_ARC_PAYMENTS: "0", CIRCLE_GATEWAY_ENABLED: "0",
  BASE_RPC_URL: rpc, BASE_RPC_FALLBACK_URL: rpc, X_LAYER_RPC: rpc, X_LAYER_RPC_FALLBACK: rpc, ARBITRUM_RPC_URL: rpc, ARBITRUM_RPC_FALLBACK_URL: rpc });
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.ok([rpc, api].includes(url.origin), "Simulation blocked an external request");
  return fetchOriginal(input, options);
};
const child = spawn(process.execPath, [resolve("node_modules/hardhat/dist/src/cli.js"), "node", "--config", resolve("packages/contracts/hardhat.config.js"), "--hostname", "127.0.0.1", "--port", "19645"], { stdio: "ignore", windowsHide: true });
let server;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); if ((await r.json()).result === "0x7a69") { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Local EVM did not start");
  const chain = { id: 31337, name: "PULSE isolated simulation", nativeCurrency: {name: "Test ETH", symbol: "ETH", decimals:18}, rpcUrls:{default:{http:[rpc]}} };
  const client = createPublicClient({chain,transport:http(rpc),pollingInterval:20});
  assert.equal(await client.getChainId(),31337);
  const [deployer] = await client.request({method:"eth_accounts"});
  const deployWallet = createWalletClient({account:deployer,chain,transport:http(rpc)});
  await client.request({method:"hardhat_setBalance",params:[signer.address,"0x56bc75e2d63100000"]});
  await client.request({method:"hardhat_impersonateAccount",params:[signer.address]});
  const wallet = createWalletClient({account:signer.address,chain,transport:http(rpc)});
  const artifact = async name => JSON.parse(await readFile(`packages/contracts/artifacts/${name}.json`,"utf8"));
  const receipt = async hash => { const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,"success");return r; };
  const deploy = async (name,args=[]) => { const a=await artifact(name);const r=await receipt(await deployWallet.deployContract({abi:a.abi,bytecode:a.bytecode,args}));return {address:r.contractAddress,abi:a.abi}; };
  const write = async (contract,functionName,args=[],sender=wallet) => receipt(await sender.writeContract({...contract,functionName,args}));
  const read = (contract,functionName,args=[]) => client.readContract({...contract,functionName,args});
  // Supply Multicall3-compatible code only on the disposable local chain.
  const source='pragma solidity ^0.8.26; contract LocalMulticall { struct Call3 { address target; bool allowFailure; bytes callData; } struct Result { bool success; bytes returnData; } function aggregate3(Call3[] calldata calls) external payable returns(Result[] memory r) { r=new Result[](calls.length); for(uint i;i<calls.length;i++){(bool ok,bytes memory data)=calls[i].target.call(calls[i].callData); require(ok||calls[i].allowFailure,"CALL_FAILED");r[i]=Result(ok,data);} } }';
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:"Solidity",sources:{"Local.sol":{content:source}},settings:{outputSelection:{"*":{"*":["evm.deployedBytecode.object"]}}}})));
  assert.ok(!compiled.errors?.some(e=>e.severity==="error"));
  await client.request({method:"hardhat_setCode",params:["0xcA11bde05977b3631167028862bE2a173976CA11","0x"+compiled.contracts["Local.sol"].LocalMulticall.evm.deployedBytecode.object]});
  const registry=await deploy("PulseRegistryV1",[deployer]);
  const oracle=await deploy("OracleRouterV1",[deployer]);
  const factory=await deploy("AutopilotVaultFactoryV2",[registry.address,oracle.address]);
  const usd=await deploy("MockERC20Pulse",["USD Coin","USDC",6]);
  const ada=await deploy("MockERC20Pulse",["Cardano","ADA",6]);
  process.env.BASE_AUTOPILOT_VAULT_FACTORY_ADDRESS=factory.address;
  const {loadConfig}=await import("../packages/config/dist/index.js");
  const {createApp}=await import("../apps/api/dist/app.js");
  const passStore=await import("../apps/api/dist/autopilotPassStore.js");
  const cfg=loadConfig();
  assert.equal(cfg.X402_MOCK,true,"Only mock payments allowed in simulation");
  const app=createApp({...cfg,FEATURE_BASE_PAYMENTS:true,FEATURE_ARBITRUM_PAYMENTS:true},{startDurableWorker:false});
  server=await new Promise(resolve=>{const s=app.listen(14199,"127.0.0.1",()=>resolve(s));});
  const post=async(path,body,paid=false)=>{const r=await fetch(api+path,{method:"POST",headers:{"Content-Type":"application/json",...(paid?{"PAYMENT-SIGNATURE":"isolated-mock-payment"}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const policy={pair:"ADA-USDT",timeframe:"4H",maxTradePct:50,dailyLossPct:3,strategy:"Trend following"};
  const policyHash=keccak256(toHex(JSON.stringify(policy)));
  assert.equal((await post("/v1/autopilot/readiness",{})).status,200);
  await write(factory,"createVault",[usd.address,policyHash]);
  let addresses=await read(factory,"vaultsOf",[signer.address]);
  const vault={address:addresses[0],abi:(await artifact("AutopilotVaultV2")).abi};
  await write(vault,"configureAsset",[ada.address,true,700000n]);
  const block=await client.getBlock();
  await write(vault,"configureLimits",[350000n,700000n,100,300,30n,block.timestamp+90n*86400n]);
  await write(usd,"mint",[signer.address,700000n],deployWallet);
  await write(usd,"transfer",[vault.address,700000n]);
  assert.equal(await read(vault,"paused"),true);
  const target={owner:signer.address,vault:vault.address};
  assert.equal((await post("/base/v1/autopilot/pass/24h",target)).status,409,"unfinished registration blocks checkout before payment");
  const payload={owner:signer.address,network:"base",vault:vault.address,settlementAsset:usd.address,targetAsset:ada.address,pair:policy.pair,timeframe:policy.timeframe,strategyType:"trend_following",buyAmountAtomic:"350000",sellAmountAtomic:"350000",minConfidence:60,policy};
  const expiresAt=Date.now()+300000;
  // Short-lived strategy authorization is sent ONLY to the loopback API for the
  // freshly deployed disposable vault. No payment authorization is signed.
  const signature=await signer.signMessage({message:`PULSE Autopilot strategy\n${keccak256(toHex(JSON.stringify(payload)))}\nExpires:${expiresAt}`});
  const registered=await post("/v1/autopilot/strategies",{...payload,authorization:{expiresAt,signature}});
  assert.equal(registered.status,201,registered.body.error);
  assert.equal((await post("/base/v1/autopilot/pass/24h",target)).status,402);
  assert.equal(await passStore.getAutopilotPass("base",vault.address),null,"unpaid challenge grants no time");
  const paid=await post("/base/v1/autopilot/pass/24h",target,true);
  assert.equal(paid.status,201,paid.body.error);
  let pass=await passStore.getAutopilotPass("base",vault.address);
  assert.ok(pass.pausedAt,"paid timer held until owner resumes");
  assert.equal(passStore.autopilotPassRemainingMs(pass,Date.now()+864000000),86400000);
  await write(vault,"setPaused",[false]);
  const started=Date.now();pass=await passStore.synchronizeAutopilotPassPause(pass,false,started);
  assert.equal(await read(vault,"paused"),false);
  pass=await passStore.synchronizeAutopilotPassPause(pass,true,started+4*3600000);
  await write(vault,"setPaused",[true]);
  assert.equal(passStore.autopilotPassRemainingMs(pass,started+100*3600000),20*3600000);
  pass=await passStore.synchronizeAutopilotPassPause(pass,false,started+100*3600000);
  await write(vault,"setPaused",[false]);
  assert.equal(passStore.autopilotPassRemainingMs(pass,started+102*3600000),18*3600000);
  assert.ok(passStore.autopilotPassRemainingMs(pass,started+125*3600000)<0);
  await write(vault,"setPaused",[true]);
  await write(vault,"withdraw",[usd.address,700000n]);
  assert.equal(await read(usd,"balanceOf",[vault.address]),0n);
  assert.equal(await read(usd,"balanceOf",[signer.address]),700000n);
  console.log("PASS local workflow: create/configure/fund 0.70 simulated USDC; incomplete setup blocked; signed registration; unpaid challenge; mock pass; resume; 4h runtime; 96h pause; resume with 20h retained; expiry; withdraw all.");
  console.log("Real payments: 0. External requests permitted: 0. Production records changed: 0. Background workers started: 0.");
} catch(error) {
  // Never dump rich RPC errors containing raw signed payloads.
  console.error("Local workflow failed:",String(error?.shortMessage||error?.message||"unknown").slice(0,600));process.exitCode=1;
} finally {
  if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  child.kill();globalThis.fetch=fetchOriginal;
}
