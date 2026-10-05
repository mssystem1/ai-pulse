/** A 0.10 USDC order registered through the SDK and executed by the real scoped keeper. */
import { config } from "dotenv";
import express from "express";
import { readFile } from "node:fs/promises";
import { decodeEventLog, encodeFunctionData, erc20Abi, formatEther, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PulseClient } from "../packages/sdk/src/index.js";
import { qualificationJournal } from "./arc-qualification-journal.js";

const usdc = "0x3600000000000000000000000000000000000000" as Address;
const weth = "0x128cc466b61f542da60c70e3aa11c10e19b84edb" as Address;
const amount = 100000n;
const abi = parseAbi([
  "function automationPaused() view returns(bool)", "function pauseAutomation(bool)",
  "function createOrder(address,address,address,address,uint128,uint128,bool,uint128,uint64) returns(uint256)",
  "event OrderCreated(uint256 indexed id,address indexed sellToken,address indexed buyToken,uint256 amount,uint256 triggerPrice,bool triggerAbove,uint256 minOut)",
  "event OrderFilled(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut)",
]);
async function main() {
  config({ quiet: true });
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  process.env.FEATURE_ARC_TRADING = "1";
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts, executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const { createTradeAutomationRouter, runTradeAutomationCycle } = await import("../apps/api/src/tradeAutomation.js");
  const { getGenericOkxSwap } = await import("../apps/api/src/okxDex.js");
  const { validateArcSwap } = await import("../apps/api/src/arcSwap.js");
  const { executionSettlementTicker } = await import("../apps/api/src/robinhoodMarkets.js");
  const cfg = loadConfig(), contracts = executionContracts("arc");
  const accounts = JSON.parse(await readFile("packages/contracts/deployments/5042-account-qualification.json", "utf8"));
  const limit = accounts.entries.find((entry: {kind: string}) => entry.kind === "spot-limit")?.account as Address;
  const executor = privateKeyToAccount((cfg.AUTOMATION_EXECUTOR_PRIVATE_KEY || cfg.TEST_WALLET_PRIVATE_KEY) as Hex);
  if (!limit || accounts.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase() || executor.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase())
    throw new Error("Qualification owner/executor mismatch");
  const router = executionContractAddress("arc", "okxRouter"), spender = executionContractAddress("arc", "okxApproval");
  const broadcast = process.argv.includes("--broadcast");
  const q = await qualificationJournal({ path: "packages/contracts/deployments/5042-keeper-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: "0.30", targets: [limit, usdc, weth, router, contracts.registry] });
  const app = express(); app.use(express.json()); app.use(createTradeAutomationRouter(cfg));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({error:"Qualification dependency unavailable"}); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Qualification server unavailable");
  const sdk = new PulseClient({baseUrl:`http://127.0.0.1:${address.port}`, network:"arc"});
  const prepare = async (from: Address, to: Address, quantity: bigint, receiver: Address) => {
    const swap = await getGenericOkxSwap(cfg, {chainId:"5042",fromTokenAddress:from,toTokenAddress:to,amount:String(quantity),userWalletAddress:receiver,slippagePercent:"0.5"});
    const checked = await validateArcSwap(swap,{from,to,amount:String(quantity),receiver,slippageBps:50});
    if (!Number.isFinite(Number(swap.quote!.priceImpactPercent)) || Math.abs(Number(swap.quote!.priceImpactPercent)) > 1) throw new Error("Qualification price impact exceeds 1%");
    return {swap,checked};
  };
  let cleanup = false;
  try {
    await q.reconcile();
    if (q.journal.data.completed) { console.log("Scoped keeper qualification complete; no new order or trade."); return; }
    const quote = await prepare(usdc,weth,amount,contracts.executionAdapter);
    console.log(JSON.stringify({broadcast,network:"arc",inputUSDC:"0.10",scopedAccount:limit,allNetworkWorker:false}));
    if (!broadcast) return;
    if (q.journal.entries.some(entry => entry.step === "registry-pause") || q.journal.data.schedulerAttempted)
      throw new Error("Qualification partial keeper attempt requires reconciliation before retry");
    if (!await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"})) throw new Error("Qualification requires initially paused registry");
    if (!q.journal.data.orderId) {
      const ticker = await executionSettlementTicker(cfg,"ETH-USDT");
      await q.send("approve-order",usdc,encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[limit,amount]}));
      const created = await q.send("create-order",limit,encodeFunctionData({abi,functionName:"createOrder",args:[usdc,weth,weth,usdc,amount,
        parseUnits((ticker.last*1.02).toFixed(18),18),false,quote.checked.minimum*99n/100n,BigInt(Math.floor(Date.now()/1000)+3600)]}),undefined,amount);
      const events=created.logs.flatMap(log => {
        if(log.address.toLowerCase()!==limit.toLowerCase())return [];
        try{return [decodeEventLog({abi,eventName:"OrderCreated",data:log.data,topics:log.topics}).args];}catch{return [];}
      });
      if(events.length!==1 || events[0].amount!==amount)throw new Error("Qualification order creation mismatch");
      q.journal.data.orderId=String(events[0].id);q.journal.data.creationHash=created.transactionHash;await q.save();
    }
    await sdk.registerAutomationOrder({owner:q.account.address,account:limit,orderId:q.journal.data.orderId,version:"limit-v2",instId:"ETH-USDT",sellToken:usdc,buyToken:weth,txHash:q.journal.data.creationHash});
    cleanup=true;
    await q.send("registry-resume",contracts.registry,encodeFunctionData({abi,functionName:"pauseAutomation",args:[false]}));
    const before=await q.client.getBalance({address:q.account.address});
    q.journal.data.schedulerAttempted=true;await q.save();
    await runTradeAutomationCycle(cfg,{network:"arc",account:limit,orderId:String(q.journal.data.orderId)});
    const workerGas=before-await q.client.getBalance({address:q.account.address});
    q.journal.data.workerGasUSDC=formatEther(workerGas);await q.save();
    if(workerGas<0n || workerGas>200000000000000000n)throw new Error("Qualification keeper gas evidence exceeds scope");
    const view=await sdk.automationOrders(q.account.address,true) as {orders:Array<{account:string;orderId:string;status:string;executionTxHash?:Hex;lastError?:string}>};
    const order=view.orders.find(item => item.account.toLowerCase()===limit.toLowerCase() && item.orderId===q.journal.data.orderId);
    if(order?.status!=="filled" || !order.executionTxHash || order.lastError)throw new Error("Qualification scoped keeper did not confirm the fill");
    const fill=await q.client.getTransactionReceipt({hash:order.executionTxHash});
    const events=fill.logs.flatMap(log => {
      if(log.address.toLowerCase()!==limit.toLowerCase())return [];
      try{return [decodeEventLog({abi,eventName:"OrderFilled",data:log.data,topics:log.topics}).args];}catch{return [];}
    });
    if(fill.status!=="success" || fill.from.toLowerCase()!==q.account.address.toLowerCase() || events.length!==1 || events[0].id!==BigInt(String(q.journal.data.orderId)) || events[0].amountIn!==amount)
      throw new Error("Qualification keeper receipt mismatch");
    const output=events[0].amountOut;
    const received=fill.logs.reduce((sum,log)=>{
      if(log.address.toLowerCase()!==weth)return sum;
      try{const {args}=decodeEventLog({abi:erc20Abi,eventName:"Transfer",data:log.data,topics:log.topics});
        return sum+(args.to.toLowerCase()===q.account.address.toLowerCase()?args.value:0n)-(args.from.toLowerCase()===q.account.address.toLowerCase()?args.value:0n);
      }catch{return sum;}
    },0n);
    if(received!==output || output<=0n)throw new Error("Qualification keeper owner payout mismatch");
    q.journal.data.executionHash=order.executionTxHash;await q.save();
    await prepare(weth,usdc,output,q.account.address);
    await q.send("approve-output",weth,encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[spender,output]}));
    const exit=await prepare(weth,usdc,output,q.account.address);
    if(exit.checked.minimum<amount*95n/100n)throw new Error("Qualification round-trip loss exceeds 5%");
    await q.send("sell-only-test-output",router,exit.swap.tx.data as Hex,exit.checked.expiresAt);
    q.journal.data.sdkRegistrationVerified=true;q.journal.data.scopedKeeperVerified=true;q.journal.data.workflowCompleted=true;await q.save();
  } finally {
    try {
      if(cleanup){
        await q.send("registry-pause",contracts.registry,encodeFunctionData({abi,functionName:"pauseAutomation",args:[true]}));
        if(!await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"}))throw new Error("Qualification pause restoration failed");
        if(q.journal.data.workflowCompleted){q.journal.data.completed=true;await q.save();}
      }
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await q.close();}
  }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error instanceof Error && error.message.startsWith("Qualification ")?error.message:"Arc keeper qualification stopped; inspect its public journal before retrying.");process.exit(1);});
