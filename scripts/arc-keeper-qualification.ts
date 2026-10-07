/** A 0.10 USDC order registered through the SDK and executed by the real scoped keeper. */
import { config } from "dotenv";
import express from "express";
import { readFile } from "node:fs/promises";
import { decodeEventLog, decodeFunctionData, encodeFunctionData, erc20Abi, formatEther, formatUnits, parseAbi, parseEther, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PulseClient } from "../packages/sdk/src/index.js";
import { qualificationJournal } from "./arc-qualification-journal.js";
import { executionSignerKey } from "../apps/api/src/executionSigner.js";

const usdc = "0x3600000000000000000000000000000000000000" as Address;
const amount = 100000n;
const abi = parseAbi([
  "function automationPaused() view returns(bool)", "function pauseAutomation(bool)",
  "function owner() view returns(address)", "function registry() view returns(address)", "function oracle() view returns(address)",
  "function accountOf(address) view returns(address)",
  "function createOrder(address,address,address,address,uint128,uint128,bool,uint128,uint64) returns(uint256)",
  "event OrderCreated(uint256 indexed id,address indexed sellToken,address indexed buyToken,uint256 amount,uint256 triggerPrice,bool triggerAbove,uint256 minOut)",
  "event OrderFilled(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut)",
]);
const oracleAbi = parseAbi(["function setPrice(address,address,uint192,uint64)"]);
async function main() {
  config({ quiet: true });
  const pair = process.argv.find(arg => arg.startsWith("--pair="))?.slice(7) || "ETH-USDT";
  const cirBtc = pair === "BTC-USDT";
  if (pair !== "BTC-USDT" && pair !== "ETH-USDT") throw new Error("Qualification requires a reviewed Arc OKX pair");
  const weth = (cirBtc ? "0x171a4217b86a807a64eb94757db6849fb4bdbaa0" : "0x128cc466b61f542da60c70e3aa11c10e19b84edb") as Address;
  process.env.REDIS_URL = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
  process.env.AUTOMATION_WORKER_ENABLED = "0";
  process.env.FEATURE_ARC_TRADING = "1";
  if (cirBtc) {
    // Never publish a funded qualification order to the production worker's
    // ledger while the owner intentionally keeps the global registry unpaused.
    process.env.QUEUE_PROVIDER = "memory";
    process.env.STORAGE_PROVIDER = "memory";
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
    delete process.env.REDIS_URL;
  }
  const { loadConfig } = await import("../packages/config/src/index.js");
  const { executionContracts, executionContractAddress } = await import("../apps/api/src/executionContracts.js");
  const { createTradeAutomationRouter, runTradeAutomationCycle } = await import("../apps/api/src/tradeAutomation.js");
  const { getGenericOkxSwap } = await import("../apps/api/src/okxDex.js");
  const { validateArcSwap } = await import("../apps/api/src/arcSwap.js");
  const { executionSettlementTicker } = await import("../apps/api/src/robinhoodMarkets.js");
  const { assertArcOkxTicker, verifyArcToken, ARC_OKX_MARKETS } = await import("../apps/api/src/arcMarkets.js");
  const { arcAutomationReadiness } = await import("../apps/api/src/arcExecutionReadiness.js");
  const cfg = loadConfig(), contracts = executionContracts("arc");
  const accounts = JSON.parse(await readFile("packages/contracts/deployments/5042-account-qualification.json", "utf8"));
  const limit = accounts.entries.find((entry: {kind: string}) => entry.kind === "spot-limit")?.account as Address;
  const executor = privateKeyToAccount(executionSignerKey(cfg, "arc") as Hex);
  if (!limit || accounts.owner.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase() || executor.address.toLowerCase() !== cfg.TEST_WALLET_ADDRESS.toLowerCase())
    throw new Error("Qualification owner/executor mismatch");
  const router = executionContractAddress("arc", "okxRouter"), spender = executionContractAddress("arc", "okxApproval");
  const broadcast = process.argv.includes("--broadcast");
  let expectedNonce = -1;
  const q = await qualificationJournal({ path: cirBtc ? "packages/contracts/deployments/5042-cirbtc-keeper-qualification.json" : "packages/contracts/deployments/5042-keeper-qualification.json", rpcUrl: cfg.ARC_RPC_URL,
    privateKey: cfg.TEST_WALLET_PRIVATE_KEY as Hex, owner: cfg.TEST_WALLET_ADDRESS, broadcast, budgetUSDC: cirBtc ? "0.15" : "0.30", targets: cirBtc ? [limit, usdc, weth, router] : [limit, usdc, weth, router, contracts.registry],
    ...(cirBtc ? {expectedNonce: () => expectedNonce} : {}) });
  const send: typeof q.send = async (...args) => {
    const previous = q.journal.entries.some(entry => entry.step === args[0]);
    const receipt = await q.send(...args);
    if (cirBtc && !previous) expectedNonce++;
    return receipt;
  };
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
    await verifyArcToken(ARC_OKX_MARKETS.find(market => market.pair === pair)!);
    if (cirBtc) {
      const ready = await arcAutomationReadiness(cfg);
      if (!ready.ready) throw new Error("Qualification Arc automation is not ready");
      if (await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"}))
        throw new Error("Qualification cirBTC keeper requires the owner-activated registry; it never changes that pause");
      const bindings = await Promise.all([
        q.client.readContract({address:limit,abi,functionName:"owner"}),
        q.client.readContract({address:limit,abi,functionName:"registry"}),
        q.client.readContract({address:limit,abi,functionName:"oracle"}),
        q.client.readContract({address:contracts.spotLimitFactory,abi,functionName:"accountOf",args:[q.account.address]}),
      ]);
      if (bindings.some((value,i) => value.toLowerCase() !== [q.account.address,contracts.registry,contracts.oracleRouter,limit][i].toLowerCase()))
        throw new Error("Qualification limit account owner, registry, oracle or factory binding mismatch");
      if (!q.journal.entries.length && await q.client.readContract({address:weth,abi:erc20Abi,functionName:"balanceOf",args:[q.account.address]}) !== 0n)
        throw new Error("Qualification requires no existing cirBTC wallet holding before the test");
      q.journal.data.registryPauseChanged = false;
      q.journal.data.store = "isolated process memory; production Redis untouched";
      q.journal.data.pair = pair;
      await q.save();
    }
    const quote = await prepare(usdc,weth,amount,contracts.executionAdapter);
    console.log(JSON.stringify({broadcast,network:"arc",pair,inputUSDC:"0.10",expectedTarget:formatUnits(BigInt(quote.swap.quote!.toTokenAmount),cirBtc ? 8 : 18),minimumTargetAtomic:String(quote.checked.minimum),scopedAccount:limit,allNetworkWorker:false,isolatedStore:cirBtc,registryPauseChanged:!cirBtc}));
    if (!broadcast) return;
    if (q.journal.entries.some(entry => entry.step === "registry-pause") || q.journal.data.schedulerAttempted)
      throw new Error("Qualification partial keeper attempt requires reconciliation before retry");
    if (cirBtc) {
      const budget = JSON.parse(await readFile(".tmp/arc-mainnet-current-budget.json","utf8"));
      const age = Date.now() - Date.parse(budget.auditedAt);
      if (budget.chainId !== 5042 || budget.owner?.toLowerCase() !== q.account.address.toLowerCase()
        || budget.maximumTotalSpendUSDC !== "5" || budget.receiptAccountingComplete !== true
        || !Number.isFinite(age) || age < 0 || age > 3600_000
        || parseEther(budget.remainingAuthorizedSpendUSDC) < parseEther("0.45")
        || !Number.isSafeInteger(budget.latestNonce)
        || await q.client.getTransactionCount({address:q.account.address,blockTag:"latest"}) !== budget.latestNonce
        || await q.client.getTransactionCount({address:q.account.address,blockTag:"pending"}) !== budget.latestNonce)
        throw new Error("Qualification cirBTC keeper requires fresh receipt-complete spending evidence reserving input, script gas and worker gas");
      expectedNonce = budget.latestNonce;
    } else if (!await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"})) throw new Error("Qualification requires initially paused registry");
    if (!q.journal.data.orderId) {
      const ticker = await executionSettlementTicker(cfg,pair);
      assertArcOkxTicker(ticker,pair);
      await send("approve-order",usdc,encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[limit,amount]}));
      const created = await send("create-order",limit,encodeFunctionData({abi,functionName:"createOrder",args:[usdc,weth,weth,usdc,amount,
        parseUnits((ticker.last*1.02).toFixed(18),18),false,cirBtc ? quote.checked.minimum : quote.checked.minimum*99n/100n,BigInt(Math.floor(Date.now()/1000)+3600)]}),undefined,amount);
      const events=created.logs.flatMap(log => {
        if(log.address.toLowerCase()!==limit.toLowerCase())return [];
        try{return [decodeEventLog({abi,eventName:"OrderCreated",data:log.data,topics:log.topics}).args];}catch{return [];}
      });
      if(events.length!==1 || events[0].amount!==amount || events[0].sellToken.toLowerCase() !== usdc || events[0].buyToken.toLowerCase() !== weth)throw new Error("Qualification order creation mismatch");
      q.journal.data.orderId=String(events[0].id);q.journal.data.creationHash=created.transactionHash;await q.save();
    }
    await sdk.registerAutomationOrder({owner:q.account.address,account:limit,orderId:q.journal.data.orderId,version:"limit-v2",instId:pair,sellToken:usdc,buyToken:weth,txHash:q.journal.data.creationHash});
    if (!cirBtc) {
      cleanup=true;
      await send("registry-resume",contracts.registry,encodeFunctionData({abi,functionName:"pauseAutomation",args:[false]}));
    }
    const before=await q.client.getBalance({address:q.account.address});
    const workerStartBlock = await q.client.getBlockNumber();
    const workerStartNonce = expectedNonce;
    if (cirBtc && (await q.client.getTransactionCount({address:q.account.address,blockTag:"pending"}) !== expectedNonce
      || await q.client.getTransactionCount({address:q.account.address,blockTag:"latest"}) !== expectedNonce))
      throw new Error("Qualification wallet changed before the scoped worker");
    q.journal.data.schedulerAttempted=true;await q.save();
    await runTradeAutomationCycle(cfg,{network:"arc",account:limit,orderId:String(q.journal.data.orderId)});
    const workerGas=before-await q.client.getBalance({address:q.account.address});
    q.journal.data.workerGasUSDC=formatEther(workerGas);await q.save();
    if(workerGas<0n || workerGas>200000000000000000n)throw new Error("Qualification keeper gas evidence exceeds scope");
    const view=await sdk.automationOrders(q.account.address,true) as {orders:Array<{account:string;orderId:string;status:string;executionTxHash?:Hex;lastError?:string}>};
    const order=view.orders.find(item => item.account.toLowerCase()===limit.toLowerCase() && item.orderId===q.journal.data.orderId);
    if(order?.status!=="filled" || !order.executionTxHash || order.lastError)throw new Error("Qualification scoped keeper did not confirm the fill");
    const fill=await q.client.waitForTransactionReceipt({hash:order.executionTxHash,confirmations:2});
    const events=fill.logs.flatMap(log => {
      if(log.address.toLowerCase()!==limit.toLowerCase())return [];
      try{return [decodeEventLog({abi,eventName:"OrderFilled",data:log.data,topics:log.topics}).args];}catch{return [];}
    });
    if(fill.status!=="success" || fill.from.toLowerCase()!==q.account.address.toLowerCase() || events.length!==1 || events[0].id!==BigInt(String(q.journal.data.orderId)) || events[0].amountIn!==amount)
      throw new Error("Qualification keeper receipt mismatch");
    if (cirBtc) {
      const executed = await q.client.getTransaction({hash:order.executionTxHash});
      if (executed.nonce !== workerStartNonce + 1 || executed.to?.toLowerCase() !== limit.toLowerCase()
        || await q.client.getTransactionCount({address:q.account.address,blockTag:"latest"}) !== workerStartNonce + 2
        || await q.client.getTransactionCount({address:q.account.address,blockTag:"pending"}) !== workerStartNonce + 2)
        throw new Error("Qualification worker nonce accounting mismatch");
      let lo = workerStartBlock, hi = fill.blockNumber;
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        if (await q.client.getTransactionCount({address:q.account.address,blockNumber:mid}) > workerStartNonce) hi = mid;
        else lo = mid + 1n;
      }
      const block = await q.client.getBlock({blockNumber:lo,includeTransactions:true});
      const priceTx = block.transactions.find(tx => tx.from.toLowerCase() === q.account.address.toLowerCase() && tx.nonce === workerStartNonce);
      if (!priceTx || priceTx.to?.toLowerCase() !== contracts.oracleRouter.toLowerCase()) throw new Error("Qualification worker oracle receipt missing");
      const decoded = decodeFunctionData({abi:oracleAbi,data:priceTx.input});
      const oracleReceipt = await q.client.waitForTransactionReceipt({hash:priceTx.hash,confirmations:2});
      if (oracleReceipt.status !== "success" || decoded.functionName !== "setPrice" || decoded.args[0].toLowerCase() !== weth
        || decoded.args[1].toLowerCase() !== usdc || decoded.args[2] <= 0n || decoded.args[3] !== 300n
        || workerGas !== oracleReceipt.gasUsed*oracleReceipt.effectiveGasPrice + fill.gasUsed*fill.effectiveGasPrice)
        throw new Error("Qualification worker oracle intent or gas reconciliation mismatch");
      q.journal.data.oraclePriceHash = priceTx.hash;
      q.journal.data.workerStartNonce = String(workerStartNonce);
      q.journal.data.workerEndNonce = String(workerStartNonce+2);
      expectedNonce = workerStartNonce + 2;
      await q.save();
    }
    const output=events[0].amountOut;
    const received=fill.logs.reduce((sum,log)=>{
      if(log.address.toLowerCase()!==weth)return sum;
      try{const {args}=decodeEventLog({abi:erc20Abi,eventName:"Transfer",data:log.data,topics:log.topics});
        return sum+(args.to.toLowerCase()===q.account.address.toLowerCase()?args.value:0n)-(args.from.toLowerCase()===q.account.address.toLowerCase()?args.value:0n);
      }catch{return sum;}
    },0n);
    if(received!==output || output<=0n)throw new Error("Qualification keeper owner payout mismatch");
    q.journal.data.executionHash=order.executionTxHash;await q.save();
    q.journal.data.ownerReceivedTarget = formatUnits(output,cirBtc ? 8 : 18);
    await prepare(weth,usdc,output,q.account.address);
    await send("approve-output",weth,encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[spender,output]}));
    const exit=await prepare(weth,usdc,output,q.account.address);
    if(exit.checked.minimum<amount*95n/100n)throw new Error("Qualification round-trip loss exceeds 5%");
    const sold = await send("sell-only-test-output",router,exit.swap.tx.data as Hex,exit.checked.expiresAt);
    q.journal.data.saleHash = sold.transactionHash;
    q.journal.data.sdkRegistrationVerified=true;q.journal.data.scopedKeeperVerified=true;q.journal.data.workflowCompleted=true;await q.save();
    if (cirBtc) {
      const remaining = await q.client.readContract({address:weth,abi:erc20Abi,functionName:"balanceOf",args:[q.account.address]});
      if (remaining !== 0n || await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"}))
        throw new Error("Qualification cirBTC capital or live pause check failed");
      const leftovers = await Promise.all([
        q.client.readContract({address:usdc,abi:erc20Abi,functionName:"allowance",args:[q.account.address,limit]}),
        q.client.readContract({address:weth,abi:erc20Abi,functionName:"allowance",args:[q.account.address,spender]}),
        q.client.readContract({address:usdc,abi:erc20Abi,functionName:"balanceOf",args:[limit]}),
        q.client.readContract({address:weth,abi:erc20Abi,functionName:"balanceOf",args:[limit]}),
      ]);
      if (leftovers.some(value => value !== 0n)) throw new Error("Qualification account escrow or test allowance remains");
      q.journal.data.completed = true; await q.save();
      console.log(JSON.stringify({pair,scopedKeeperVerified:true,sdkRegistrationVerified:true,registryPauseChanged:false,soldOnlyTestOutput:true,ownerReceivedTarget:q.journal.data.ownerReceivedTarget}));
    }
  } finally {
    try {
      if(cleanup){
        await send("registry-pause",contracts.registry,encodeFunctionData({abi,functionName:"pauseAutomation",args:[true]}));
        if(!await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"}))throw new Error("Qualification pause restoration failed");
        if(q.journal.data.workflowCompleted){q.journal.data.completed=true;await q.save();}
      }
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await q.close();}
  }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error instanceof Error && error.message.startsWith("Qualification ")?error.message:"Arc keeper qualification stopped; inspect its public journal before retrying.");process.exit(1);});
