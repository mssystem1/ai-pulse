// Real keeper control flow with isolated chain, provider and storage clients.
import test, {mock} from 'node:test';
import assert from 'node:assert/strict';

test('Arc keeper executes limit, bracket and TP/SL phases, respects scope, and rejects expired routes', async () => {
  process.env.NODE_ENV='test'; process.env.PULSE_SKIP_DOTENV='1'; process.env.FEATURE_ARC_TRADING='1';
  mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected external request');});
  const viem=await import('viem');
  const deployment=await import('../apps/api/src/executionContracts.ts');
  const contracts=deployment.executionContracts('arc');
  const router=deployment.executionContractAddress('arc','okxRouter');
  const {OKX_DAG_ABI}=await import('../apps/api/src/okxDag.ts');
  const owner=`0x${'1'.repeat(40)}`, usdc='0x3600000000000000000000000000000000000000', weth='0x128cc466b61f542da60c70e3aa11c10e19b84edb';
  const addresses=['2','3','4','5','6'].map(x=>`0x${x.repeat(40)}`);
  const versions=['limit-v2','bracket-v1','oco-v1','limit-v2','limit-v2'];
  const p=x=>viem.parseUnits(String(x),18);
  const records=new Map(addresses.map((address,i)=>[address, versions[i]==='oco-v1'
    ? [weth,usdc,1000000000000000n,p(110),p(90),0n,1n,1]
    : versions[i]==='bracket-v1'
      ? [usdc,weth,weth,usdc,100000n,0n,p(110),p(110),p(90),995000000000000n,0n,1n,false,true,1]
      : [usdc,weth,weth,usdc,100000n,p(110),995000000000000n,0n,1n,false,1]]));
  let items=addresses.map((account,i)=>({id:`arc:${account}:1`,owner,network:'arc',account,orderId:'1',version:versions[i],
    instId:'ETH-USDT',sellToken:i===2?weth:usdc,buyToken:i===2?usdc:weth,status:'active',phase:i===2?'protected':'entry',onchainState:1}));
  const kv=await import('../apps/api/src/resilientKv.ts');
  mock.module('../apps/api/src/resilientKv.ts',{namedExports:{...kv,kvConfigured:()=>true,runKvCommand:async([op,key,value])=>{
    assert.equal(key,'pulse:v6:automation:orders');
    if(op==='GET')return JSON.stringify(items); if(op==='SET'){items=JSON.parse(value);return 'OK';} throw Error(op);
  }}});
  const readiness=await import('../apps/api/src/arcExecutionReadiness.ts');
  mock.module('../apps/api/src/arcExecutionReadiness.ts',{namedExports:{...readiness,arcAutomationReadiness:async()=>({ready:true})}});
  const market=await import('../apps/api/src/robinhoodMarkets.ts');
  let mark=100,now=Date.now(),expire=false,tickerOffset=0;
  mock.timers.enable({apis:['Date'],now});
  mock.module('../apps/api/src/robinhoodMarkets.ts',{namedExports:{...market,executionSettlementTicker:async()=>({instId:'ETH-USDT',last:mark,ts:String(now+tickerOffset)})}});
  const dex=await import('../apps/api/src/okxDex.ts');
  let output=0n;
  mock.module('../apps/api/src/okxDex.ts',{namedExports:{...dex,getGenericOkxSwap:async(_cfg,input)=>{
    assert.equal(input.chainId,'5042'); assert.equal(input.userWalletAddress.toLowerCase(),contracts.executionAdapter.toLowerCase());
    const buy=input.fromTokenAddress.toLowerCase()===usdc;
    output=buy?BigInt(input.amount)*10n**12n/BigInt(mark):BigInt(input.amount)*BigInt(mark)/10n**12n;
    return {quote:{chainId:'5042',fromTokenAmount:input.amount,toTokenAmount:String(output),fromToken:{address:input.fromTokenAddress},toToken:{address:input.toTokenAddress}},
      tx:{to:router,from:contracts.executionAdapter,value:'0',data:viem.encodeFunctionData({abi:OKX_DAG_ABI,functionName:'dagSwapTo',args:[1n,contracts.executionAdapter,
        {fromToken:BigInt(input.fromTokenAddress),toToken:input.toTokenAddress,fromTokenAmount:BigInt(input.amount),minReturnAmount:output*995n/1000n,deadLine:BigInt(Math.floor(now/1000)+600)},[]]})}};
  }}});
  const submitted=[], receipts=new Map(), activities=[];
  const closedAbi=viem.parseAbi(['event PositionClosed(uint256 indexed id,address indexed adapter,uint256 amountIn,uint256 amountOut)']);
  const wallet={account:{address:owner},writeContract:async request=>{
    assert.equal(request.gas,125000n);assert.ok(request.gas*request.maxFeePerGas<=viem.parseEther('0.10'));
    submitted.push(request);const hash=`0x${submitted.length.toString(16).padStart(64,'0')}`;
    const logs=[];
    if(request.functionName!=='setPrice'){
      const record=records.get(request.address);
      assert.ok(record);
      if(request.functionName==='executeEntry'){record[5]=output;record[14]=3;}
      else if(request.functionName==='executeExit'){
        const bracket=request.address===addresses[1];
        const amountIn=record[bracket?5:2];record[bracket?14:7]=bracket?5:3;
        logs.push({address:request.address,topics:viem.encodeEventTopics({abi:closedAbi,eventName:'PositionClosed',args:{id:1n,adapter:contracts.executionAdapter}}),
          data:viem.encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[amountIn,output])});
      }else {assert.equal(request.functionName,'execute');record[10]=3;}
    }
    receipts.set(hash,{status:'success',logs});return hash;
  }};
  mock.module('viem',{namedExports:{...viem,createWalletClient:()=>wallet}});
  const discovery=await import('../apps/api/src/onchainDiscovery.ts');
  mock.module('../apps/api/src/onchainDiscovery.ts',{namedExports:{...discovery,executionPublicClient:()=>({
    readContract:async request=>request.functionName==='decimals'?(request.address.toLowerCase()===usdc?6:18):records.get(request.address),
    simulateContract:async request=>({request}),waitForTransactionReceipt:async({hash})=>receipts.get(hash),getTransactionReceipt:async({hash})=>receipts.get(hash),
    estimateFeesPerGas:async()=>({maxFeePerGas:100000000000n,maxPriorityFeePerGas:1n}),getBalance:async()=>viem.parseEther('5'),
    estimateGas:async()=>{if(expire){now+=31000;mock.timers.setTime(now);}return 100000n;},
  })}});
  const store=await import('../apps/api/src/v6Store.ts');
  mock.module('../apps/api/src/v6Store.ts',{namedExports:{...store,recordV6Activity:async row=>{activities.push(row);return row;}}});
  const {runTradeAutomationCycle}=await import('../apps/api/src/tradeAutomation.ts');
  const cfg={ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY:`0x${'1'.repeat(64)}`};
  const run=i=>runTradeAutomationCycle(cfg,{network:'arc',account:addresses[i],orderId:'1'});
  tickerOffset=-181000;
  await run(0);assert.match(items[0].lastError,/Live OKX market data/);
  assert.equal(submitted.length,0,'a stale ticker cannot update the oracle or execute escrow');
  tickerOffset=0;
  const correctBase=records.get(addresses[0])[2];
  records.get(addresses[0])[2]='0xeb64987643db71c76b2a2be7e723decc995e5b37';
  await run(0);assert.match(items[0].lastError,/exact published wrapper/);
  assert.equal(submitted.length,0,'mismatched on-chain order tokens cannot update the oracle or execute');
  records.get(addresses[0])[2]=correctBase;
  await run(0);assert.equal(items[0].status,'filled');assert.equal(submitted.length,2);
  await run(0);assert.equal(submitted.length,2,'a confirmed limit fill cannot repeat');
  assert.ok(items.slice(1).every(x=>x.status==='active'),'the scope excludes other owner orders');
  await run(1);assert.equal(items[1].phase,'protected');assert.equal(items[1].status,'active');
  mark=120;await run(1);assert.equal(items[1].status,'filled');assert.equal(items[1].lastAction,'take_profit');assert.equal(items[1].exitPrice,120);
  await run(2);assert.equal(items[2].status,'filled');assert.equal(items[2].lastAction,'take_profit');
  assert.deepEqual(activities.map(x=>x.kind),['automatic_fill','automatic_entry_protected','automatic_take_profit','automatic_take_profit']);
  mark=100;records.get(addresses[3])[10]=2;const beforePause=submitted.length;
  await run(3);assert.equal(submitted.length,beforePause,'an owner-paused order cannot execute');
  expire=true;const beforeExpire=submitted.filter(x=>x.functionName!=='setPrice').length;
  await run(4);assert.match(items[4].lastError,/quote expired/);assert.equal(submitted.filter(x=>x.functionName!=='setPrice').length,beforeExpire,'an expired quote cannot move escrow');
  process.env.FEATURE_ARC_TRADING='0';const beforeDisabled=submitted.length;
  await runTradeAutomationCycle(cfg);assert.equal(submitted.length,beforeDisabled,'the release flag gates every Arc order');
});
