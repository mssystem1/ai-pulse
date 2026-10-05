// Run: npx tsx --experimental-test-module-mocks --test scripts/arc-worker-flow.test.mjs
// Real scheduler/policy/journal code; isolated storage, market data and chain clients.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nativeMarket = process.env.PULSE_ARC_WORKER_NATIVE === '1';
const recoveryCase = process.env.PULSE_ARC_WORKER_RECOVERY || '';
test(`Arc ${nativeMarket ? 'native contract' : 'canonical wrapper'} Autopilot ${recoveryCase || 'buys, protects and closes a position with bounded USDC gas and one activity per fill'}`, async () => {
  process.env.NODE_ENV = 'test';
  process.env.PULSE_SKIP_DOTENV = '1';
  process.env.FEATURE_ARC_TRADING = '1';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected external request in isolated worker test'); });
  const viem = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const deployment = await import('../apps/api/src/executionContracts.ts');
  const contracts = { ...deployment.executionContracts('arc'), okxRouter: deployment.executionContractAddress('arc', 'okxRouter') };
  const { OKX_DAG_ABI } = await import('../apps/api/src/okxDag.ts');
  const readiness = await import('../apps/api/src/arcExecutionReadiness.ts');
  mock.module('../apps/api/src/arcExecutionReadiness.ts', { namedExports: { ...readiness, arcAutomationReadiness: async () => ({ready:true}) } });
  const owner = `0x${'1'.repeat(40)}`, vault = `0x${'2'.repeat(40)}`;
  const settlement = '0x3600000000000000000000000000000000000000';
  const target = nativeMarket ? '0xeb64987643db71c76b2a2be7e723decc995e5b37' : '0x128cc466b61f542da60c70e3aa11c10e19b84edb';
  const pair = nativeMarket ? 'COOL.EB64987643DB71C76B2A2BE7E723DECC995E5B37-USDC' : 'ETH-USDT';
  const signalMarket = pair;
  const analysisToSettlement = 1;
  // Keep the simulated five-minute cycle inside one candle window.
  let now = Math.floor(Date.now() / 3600000) * 3600000 + 900000,
    mark = 100 * analysisToSettlement, nonce = 0n, targetBalance = 0n, settlementBalance = 1_000_000n;
  mock.timers.enable({ apis: ['Date'], now });
  const strings = new Map(), hashes = new Map();
  let failDurableConfirmationOnce = recoveryCase === 'storage_confirmation';
  const strategyKey = 'pulse:v6:autopilot:strategy-map';
  const strategy = { id: 'isolated-arc-worker', owner, network: 'arc', vault,
    settlementAsset: settlement, targetAsset: target, pair, timeframe: '1H', strategyType: 'trend_following',
    buyAmountAtomic: '100000', sellAmountAtomic: '100000', minConfidence: 60,
    policy: { pair, timeframe: '1H', maxTradePct: 100, dailyLossPct: 20, strategy: 'Trend following' },
    status: 'active', lastDecision: 'hold_paused', lastRunAt: new Date(now).toISOString(),
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
  hashes.set(strategyKey, new Map([[strategy.id, JSON.stringify(strategy)]]));
  const command = async ([op, key, ...args]) => {
    if (op === 'HGETALL') return Object.fromEntries(hashes.get(key) || []);
    if (op === 'HSET') {
      if (failDurableConfirmationOnce && String(key).includes('activity-map')
        && args.some((value, index) => index % 2 === 1 && JSON.parse(value).kind === 'buy_filled' && JSON.parse(value).status === 'confirmed')) {
        failDurableConfirmationOnce = false;
        throw Object.assign(Error('Durable activity storage temporarily unavailable'), { code: 'KV_TEMPORARILY_UNAVAILABLE' });
      }
      const hash = hashes.get(key) || new Map();
      for (let i = 0; i < args.length; i += 2) hash.set(args[i], args[i + 1]);
      hashes.set(key, hash); return 1;
    }
    if (op === 'GET') return strings.get(key) ?? null;
    if (op === 'SET') { if (args.includes('NX') && strings.has(key)) return null; strings.set(key, args[0]); return 'OK'; }
    if (op === 'EVAL' && String(key).includes("redis.call('del'")) {
      const [, leaseKey, token] = args;
      if (strings.get(leaseKey) === token) { strings.delete(leaseKey); return 1; } return 0;
    }
    throw Error(`Unexpected storage operation: ${op}`);
  };
  const kv = await import('../apps/api/src/resilientKv.ts');
  mock.module('../apps/api/src/resilientKv.ts', { namedExports: { ...kv, kvConfigured: () => true, runKvCommand: command } });
  const passModule = await import('../apps/api/src/autopilotPassStore.ts');
  let pass = { owner, network: 'arc', vault, purchasedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 86400000).toISOString(), signalLimit: 1, signalsUsed: 0 };
  mock.module('../apps/api/src/autopilotPassStore.ts', { namedExports: { ...passModule,
    getAutopilotPass: async () => pass,
    synchronizeAutopilotPassPause: async value => value,
    mutateAutopilotPass: async (_network, _vault, update) => { pass = update(pass); return pass; },
  } });
  const marketModule = await import('../apps/api/src/robinhoodMarkets.ts');
  const lastCandle = Math.floor(now / 3600000) * 3600000 - 3600000;
  const candles = Array.from({ length: 120 }, (_, i) => ({ ts: lastCandle - (119 - i) * 3600000,
    open: 40 + i * .5, high: 41 + i * .5, low: 39 + i * .5, close: 40.5 + i * .5, volume: 100, volumeCcy: 10000, confirmed: true }));
  const market = { instId: signalMarket, source: 'okx-public-spot', timeframe: '1H', candles, ticker: { instId: signalMarket, last: 100, ts: String(now), change24hPct: 2 }, fetchedAt: new Date(now).toISOString() };
  mock.module('../apps/api/src/robinhoodMarkets.ts', { namedExports: { ...marketModule,
    executionMarketContext: async (_cfg, input) => {
      assert.equal(input.instId, pair, 'the worker uses the complete owner-authorized contract market');
      return market;
    },
    executionSettlementTicker: async (_cfg, input) => {
      assert.equal(input, pair, 'protection must use the same contract market as entry');
      return { ...market.ticker, last: mark, usdPerSettlement: 1 };
    },
    robinhoodAutopilotContext: async () => { throw Error('Arc cannot use a Robinhood signal mapping'); },
  } });
  const signal = { generatedAt: new Date(now).toISOString(), candleTs: lastCandle,
    signal: { bias: 'bullish', confidence: 90, regime: 'trend_up', support: [95], resistance: [110] } };
  strings.set(`pulse:v6:autopilot:signal:${pair}:1H`, JSON.stringify({ expiresAt: now + 3600000, value: signal }));
  let quoteOutput = 0n, rejectEntryQuote = true, rejectExitQuote = true, alternativeExitCalls = 0;
  const dex = await import('../apps/api/src/okxDex.ts');
  mock.module('../apps/api/src/okxDex.ts', { namedExports: { ...dex,
    getGenericOkxQuote: async (_cfg, input) => {
      assert.equal(input.fromTokenAddress.toLowerCase(), target.toLowerCase());
      assert.equal(input.toTokenAddress.toLowerCase(), settlement.toLowerCase());
      const output = BigInt(input.amount) * BigInt(mark) / 10n ** 12n;
      return { fromTokenAmount: input.amount, toTokenAmount: String(rejectExitQuote ? output / 2n : output) };
    }, betterGenericOkxExitSwap: async (_cfg, input, original) => {
      alternativeExitCalls++;
      assert.equal(input.slippagePercent, '0.5', 'alternative routing cannot enlarge tolerance');
      quoteOutput = BigInt(input.amount) * BigInt(mark) / 10n ** 12n;
      return { ...original, quote: { ...original.quote, toTokenAmount: String(quoteOutput) }, tx: { ...original.tx,
        data: viem.encodeFunctionData({ abi: OKX_DAG_ABI, functionName: 'dagSwapTo', args: [1n, contracts.executionAdapter,
          { fromToken: BigInt(input.fromTokenAddress), toToken: input.toTokenAddress, fromTokenAmount: BigInt(input.amount),
            minReturnAmount: quoteOutput * 995n / 1000n, deadLine: BigInt(Math.floor(now / 1000) + 600) }, []] }) } };
    }, getGenericOkxSwap: async (_cfg, input) => {
    assert.equal(input.chainId, '5042');
    assert.equal(input.userWalletAddress.toLowerCase(), contracts.executionAdapter.toLowerCase());
    assert.deepEqual([input.fromTokenAddress.toLowerCase(), input.toTokenAddress.toLowerCase()].sort(), [settlement, target].sort());
    const buy = input.fromTokenAddress.toLowerCase() === settlement.toLowerCase();
    quoteOutput = buy ? BigInt(input.amount) * 10n ** 12n / BigInt(mark) : BigInt(input.amount) * BigInt(mark) / 10n ** 12n;
    if (buy && rejectEntryQuote) quoteOutput /= 2n;
    if (!buy) quoteOutput /= 2n; // Default source fails; a better source must still pass the original guard.
    return { quote: { chainId: '5042', fromTokenAmount: input.amount, toTokenAmount: String(quoteOutput),
      fromToken: { address: input.fromTokenAddress, decimals: buy ? 6 : 18 }, toToken: { address: input.toTokenAddress, decimals: buy ? 18 : 6 }, priceImpactPercent: '0' },
      tx: { to: contracts.okxRouter, from: contracts.executionAdapter, value: '0', data: viem.encodeFunctionData({
        abi: OKX_DAG_ABI, functionName: 'dagSwapTo', args: [1n, contracts.executionAdapter,
          { fromToken: BigInt(input.fromTokenAddress), toToken: input.toTokenAddress, fromTokenAmount: BigInt(input.amount),
            minReturnAmount: quoteOutput * 995n / 1000n, deadLine: BigInt(Math.floor(now / 1000) + 600) }, []] }) } };
  } } });
  const submitted = [];
  let pendingBuyHash, timeoutBuyReceipt = !['confirmation', 'storage_confirmation'].includes(recoveryCase);
  let deferBroadcast = ['lost_broadcast', 'pause_expiry'].includes(recoveryCase);
  let loseBroadcastResponse = recoveryCase === 'lost_broadcast';
  let failActivityOnce = recoveryCase === 'activity';
  let failConfirmationOnce = recoveryCase === 'confirmation';
  let signatures = 0, receiptStatus = 'success';
  const broadcasts = [];
  const signedRequests = new Map();
  const executionAbi = viem.parseAbi(['function execute(bytes32,uint64,uint64,address,address,address,uint256,uint256,bytes,bytes32)']);
  const wallet = { account: signer,
    prepareTransactionRequest: async request => ({ ...request, chainId: 5042, nonce: submitted.length, type: 'eip1559' }),
    signTransaction: async request => { signatures++; return signer.signTransaction(request); },
    sendRawTransaction: async ({ serializedTransaction }) => {
      broadcasts.push(serializedTransaction);
      const hash = viem.keccak256(serializedTransaction);
      const tx = viem.parseTransaction(serializedTransaction);
      const decoded = viem.decodeFunctionData({ abi: executionAbi, data: tx.data });
      if (decoded.args[4].toLowerCase() === settlement.toLowerCase()) pendingBuyHash = hash;
      if (loseBroadcastResponse) { loseBroadcastResponse = false; throw Error('Broadcast response lost while the signed trade may be pending'); }
      if (deferBroadcast || signedRequests.has(hash)) return hash;
      signedRequests.set(hash, serializedTransaction);
      await wallet.writeContract({ ...tx, functionName: decoded.functionName, args: decoded.args });
      if (decoded.args[4].toLowerCase() === settlement.toLowerCase()) pendingBuyHash = hash;
      return hash;
    }, writeContract: async request => {
    assert.equal(request.gas, 125000n, 'Arc pins estimated gas with its buffer');
    assert.ok(request.gas * request.maxFeePerGas <= viem.parseEther('0.10'), 'Arc transaction gas is capped in USDC');
    submitted.push(request);
    if (request.functionName === 'execute') {
      assert.equal(request.args[2], nonce);
      const buy = request.args[4].toLowerCase() === settlement.toLowerCase();
      if (buy) {
        const persisted = JSON.parse(hashes.get(strategyKey).get(strategy.id));
        assert.ok(persisted.activeTakeProfit > mark, 'TP is durable before buy submission');
        assert.ok(persisted.activeStopLoss > 0 && persisted.activeStopLoss < mark, 'SL is durable before buy submission');
        const outboxKey = `pulse:v6:arc:execution-outbox:${owner.toLowerCase()}:${vault.toLowerCase()}`;
        assert.ok(strings.has(outboxKey), 'the recoverable signed transaction is durable before broadcasting');
        assert.ok(!strings.get(outboxKey).includes('serializedTransaction'), 'signed payload metadata is encrypted');
      }
      if (buy) { settlementBalance -= request.args[6]; targetBalance += quoteOutput; }
      else { targetBalance -= request.args[6]; settlementBalance += quoteOutput; }
      nonce++;
    }
    const hash = `0x${submitted.length.toString(16).padStart(64, '0')}`;
    if (request.functionName === 'execute' && request.args[4].toLowerCase() === settlement.toLowerCase()) pendingBuyHash = hash;
    return hash;
  } };
  mock.module('viem', { namedExports: { ...viem, createWalletClient: input => {
    assert.equal(input.chain.id, 5042);
    assert.equal(input.account.address, signer.address, 'Arc uses its dedicated key even when a different shared key is configured');
    return wallet;
  } } });
  const discovery = await import('../apps/api/src/onchainDiscovery.ts');
  let runtimeReads = 0, pauseOnRead = Infinity;
  mock.module('../apps/api/src/onchainDiscovery.ts', { namedExports: { ...discovery,
    executionPublicClient: () => ({
      estimateGas: async () => 100000n,
      estimateFeesPerGas: async () => ({ maxFeePerGas:100000000000n, maxPriorityFeePerGas:1n }),
      getBalance: async () => viem.parseEther('5'),
      multicall: async () => [++runtimeReads >= pauseOnRead, 1n, nonce, 50n, 100000n, 0n, 0n, targetBalance, 18, 6, settlementBalance],
      readContract: async request => {
        if (request.functionName === 'vaultsOf') return [vault];
        assert.equal(request.functionName, 'exposureCap'); return 1_000_000n;
      },
      simulateContract: async request => ({ request }),
      getTransactionReceipt: async request => {
        if (!signedRequests.has(request.hash) && receiptStatus !== 'reverted') {
          const error = Error('Original transaction receipt is not available'); error.name = 'TransactionReceiptNotFoundError'; throw error;
        }
        return { status: receiptStatus, transactionHash: request.hash, to: vault,
          logs: receiptStatus === 'success' ? [{ address: vault, topics: [viem.keccak256(viem.toHex('Executed(bytes32,address,uint256,address,address,uint256,uint256,bytes32)'))] }] : [] };
      },
      waitForTransactionReceipt: async request => {
        if (request.hash === pendingBuyHash && timeoutBuyReceipt) {
          timeoutBuyReceipt = false;
          throw Error('Receipt request timed out after buy broadcast');
        }
        return { status: 'success' };
      },
    }),
  } });
  const activityStore = await import('../apps/api/src/v6Store.ts');
  mock.module('../apps/api/src/v6Store.ts', { namedExports: { ...activityStore,
    recordV6Activity: async (input, options) => {
      if (input.kind === 'buy_filled' && failActivityOnce) { failActivityOnce = false; throw Error('Activity insertion interrupted before its durable write'); }
      return activityStore.recordV6Activity(input, options);
    },
    confirmV6Activity: async (input, options) => {
      if (input.kind === 'buy_filled' && failConfirmationOnce) { failConfirmationOnce = false; throw Error('Confirmed trade journal write interrupted'); }
      return activityStore.confirmV6Activity(input, options);
    },
    reconcileV6Activity: async (walletOwner, network) => {
      for (const row of await activityStore.listV6Activity(walletOwner, network))
        if (row.status === 'pending' && row.txHash === pendingBuyHash) await activityStore.confirmV6Activity(row);
      return activityStore.listV6Activity(walletOwner, network);
    },
  } });
  const { runAutopilotCycle, autopilotPassTargetExists, grantAutopilotPass } = await import('../apps/api/src/autopilotAutomation.ts');
  const cfg = { ARC_AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${'7'.repeat(64)}`, AUTOPILOT_KILL_SWITCH: false, hasXaiKey: false };
  const stored = () => JSON.parse(hashes.get(strategyKey).get(strategy.id));
  assert.equal(await autopilotPassTargetExists({ owner, network: 'arc', vault }), !nativeMarket,
    'only a reviewed Arc market can reach pass checkout');
  if (nativeMarket) {
    await assert.rejects(grantAutopilotPass({ owner, network: 'arc', vault, days: 1 }), /Risk Guard only/);
    await runAutopilotCycle(cfg, {network:'arc',vault});
    assert.match(stored().lastError, /Risk Guard only/);
    assert.equal(pass.signalsUsed, 0, 'an indexed meme cannot consume an AI confirmation');
    assert.equal(submitted.length, 0, 'an indexed meme cannot write oracle or execution transactions');
    return;
  }
  market.ticker.ts = String(now - 181_000);
  await runAutopilotCycle(cfg, {network:'arc',vault});
  assert.match(stored().lastError, /Live OKX market data is unavailable/);
  assert.equal(pass.signalsUsed, 0, 'stale OKX data cannot consume an AI confirmation');
  assert.equal(submitted.length, 0, 'stale OKX data cannot prepare an oracle update or trade');
  market.ticker.ts = String(now);
  hashes.set(strategyKey, new Map([[strategy.id, JSON.stringify(strategy)]]));
  await runAutopilotCycle(cfg, {network:'arc',vault});
  assert.equal(stored().entryQuoteRetryPending, true, JSON.stringify(stored()));
  assert.equal(targetBalance, 0n);
  assert.equal(submitted.filter(request => request.functionName === 'execute').length, 0);
  assert.equal(pass.signalsUsed, 1);
  // A paused poll may clear lastError, but cannot erase a known pre-submit retry.
  hashes.get(strategyKey).set(strategy.id, JSON.stringify({ ...stored(), lastError: undefined, lastDecision: 'hold_paused' }));
  rejectEntryQuote = false;
  await runAutopilotCycle(cfg, {network:'arc',vault});
  assert.match(stored().lastError, /current sell route/);
  assert.equal(stored().entryQuoteRetryPending, true);
  assert.equal(targetBalance, 0n, 'a non-executable exit blocks entry before custody changes');
  assert.equal(submitted.length, 0, 'exit quote rejection occurs before oracle or evidence writes');
  assert.equal(pass.signalsUsed, 1, 'exit quote rejection cannot buy another confirmation');
  rejectExitQuote = false;
  hashes.get(strategyKey).set(strategy.id, JSON.stringify({ ...stored(), lastDecision: 'hold_paused' }));
  await runAutopilotCycle(cfg, {network:'arc',vault});
  if (recoveryCase) {
    const outboxKey = `pulse:v6:arc:execution-outbox:${owner.toLowerCase()}:${vault.toLowerCase()}`;
    const savedTransaction = strings.get(outboxKey);
    assert.ok(savedTransaction, 'an interruption retains the independent durable transaction record');
    assert.equal(signatures, 1);
    assert.equal(pass.signalsUsed, 1);
    assert.equal(stored().lastDecision, ['confirmation', 'storage_confirmation'].includes(recoveryCase) ? 'hold_execution_recovery'
      : recoveryCase === 'activity' ? 'hold_failed_closed' : 'hold_receipt_pending');
    if (recoveryCase === 'activity') {
      assert.equal(broadcasts.length, 0, 'failed activity insertion cannot authorize broadcasting');
      assert.equal(targetBalance, 0n);
    }
    if (recoveryCase === 'pause_expiry') {
      const beforePause = broadcasts.length;
      pauseOnRead = 1; now += 500; mock.timers.setTime(now);
      await runAutopilotCycle(cfg, {network:'arc',vault});
      assert.equal(stored().lastDecision, 'hold_receipt_pending');
      assert.equal(broadcasts.length, beforePause, 'a paused owner vault cannot resend a stored trade');
      pauseOnRead = Infinity; now += 700000; mock.timers.setTime(now);
      await runAutopilotCycle(cfg, {network:'arc',vault});
      assert.equal(broadcasts.length, beforePause, 'an expired original quote cannot create a fresh transaction');
      assert.match(stored().lastError, /Operator reconciliation/);
      assert.equal(strings.get(outboxKey), savedTransaction);
      receiptStatus = 'reverted'; now += 60000; mock.timers.setTime(now);
      await runAutopilotCycle(cfg, {network:'arc',vault});
      assert.equal(stored().lastDecision, 'hold_execution_reverted');
      assert.equal(strings.has(outboxKey), false);
      assert.equal(targetBalance, 0n);
      const rows = (await activityStore.listV6Activity(owner, 'arc')).filter(row => row.kind === 'buy_filled');
      assert.equal(rows.length, 1); assert.equal(rows[0].status, 'failed');
      assert.equal(signatures, 1); assert.equal(pass.signalsUsed, 1);
      return;
    }
    // A fresh process/recovery tick must not wait for another AI or risk period
    // while the original 30-second route is still valid.
    deferBroadcast = false; now += 500; mock.timers.setTime(now);
    await runAutopilotCycle(cfg, {network:'arc',vault});
    if (!['confirmation', 'storage_confirmation'].includes(recoveryCase)) {
      assert.equal(stored().lastDecision, 'hold_receipt_pending');
      assert.ok(broadcasts.every(bytes => bytes === broadcasts[0]), 'recovery sends the exact original signed bytes');
      now += 500; mock.timers.setTime(now);
      await runAutopilotCycle(cfg, {network:'arc',vault});
    }
    assert.equal(stored().lastDecision, 'hold_receipt_reconciled', JSON.stringify(stored()));
    assert.equal(strings.has(outboxKey), false);
    assert.equal(submitted.filter(request => request.functionName === 'execute').length, 1);
    assert.equal(signatures, 1, 'a recovered trade never requests a new signature');
    assert.equal(pass.signalsUsed, 1, 'recovery never buys another AI confirmation');
    const rows = (await activityStore.listV6Activity(owner, 'arc')).filter(row => row.kind === 'buy_filled');
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'confirmed');
    assert.ok(stored().activeTakeProfit > mark && stored().activeStopLoss < mark);
    return;
  }
  assert.equal(stored().lastDecision, 'hold_receipt_pending', JSON.stringify(stored()));
  assert.ok(targetBalance > 0n);
  assert.ok(stored().activeTakeProfit > mark && stored().activeStopLoss > 0 && stored().activeStopLoss < mark);
  assert.equal(pass.signalsUsed, 1);
  now += 60000;
  mock.timers.setTime(now);
  await runAutopilotCycle(cfg, {network:'arc',vault});
  assert.equal(stored().lastDecision, 'hold_receipt_reconciled', JSON.stringify(stored()));
  assert.equal(submitted.filter(request => request.functionName === 'execute').length, 1, 'receipt recovery cannot repeat the buy');
  pass = { ...pass, expiresAt: new Date(now - 1).toISOString() };
  mark = 130 * analysisToSettlement; now += 120000;
  mock.timers.setTime(now);
  await runAutopilotCycle(cfg, {network:'arc',vault});
  assert.equal(stored().lastDecision, 'sell_partial_filled', JSON.stringify(stored()));
  now += 120000;
  mock.timers.setTime(now);
  await runAutopilotCycle(cfg, {network:'arc',vault});
  assert.equal(stored().lastDecision, 'sell_filled', JSON.stringify(stored()));
  assert.equal(targetBalance, 0n);
  assert.equal(pass.signalsUsed, 1, 'deterministic exits consume no additional AI confirmations');
  const { listV6Activity } = await import('../apps/api/src/v6Store.ts');
  const fills = (await listV6Activity(owner, 'arc')).filter(row => row.kind.endsWith('_filled'));
  assert.deepEqual(fills.map(row => row.kind).sort(), ['buy_filled', 'sell_filled', 'sell_partial_filled']);
  assert.ok(fills.every(row => row.status === 'confirmed'));
  assert.equal(submitted.filter(request => request.functionName === 'execute').length, 3);
  assert.equal(alternativeExitCalls, 2, 'both bounded exits validate the alternative route');

  // Owner control must win even when the entry signal already passed.
  const raceStrategy = { ...strategy, id: 'owner-pause-race' };
  market.ticker.ts = String(now);
  pass = { ...pass, expiresAt: new Date(now + 86400000).toISOString() };
  hashes.set(strategyKey, new Map([[raceStrategy.id, JSON.stringify(raceStrategy)]]));
  runtimeReads = 0; pauseOnRead = 3; mark = 100 * analysisToSettlement;
  const beforePause = submitted.length;
  await runAutopilotCycle(cfg, {network:'arc',vault});
  const paused = JSON.parse(hashes.get(strategyKey).get(raceStrategy.id));
  assert.equal(paused.lastDecision, 'hold_paused', JSON.stringify(paused));
  assert.equal(submitted.length, beforePause, 'a pause before submission prevents both oracle and execution writes');
  assert.equal(pass.signalsUsed, 1, 'the already-consumed cached signal must not be billed twice');
});

// Node module mocks are process-wide. Exercise the same actual worker with a
// native contract market in a fresh, secret-free process instead of sharing mocks.
if (!nativeMarket && !recoveryCase) test('Arc worker rejects indexed memecoins before AI or execution', { timeout: 60_000 }, async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ComSpec)$/i.test(key)));
  Object.assign(env, { NODE_ENV: 'test', PULSE_SKIP_DOTENV: '1', PULSE_ARC_WORKER_NATIVE: '1' });
  const child = spawn(process.execPath, ['--import', 'tsx', '--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, output);
    assert.match(output, /Arc native contract Autopilot/);
  } finally { child.kill(); }
});

if (!nativeMarket && !recoveryCase) for (const scenario of ['activity', 'lost_broadcast', 'confirmation', 'storage_confirmation', 'pause_expiry'])
  test(`Arc Autopilot durable recovery: ${scenario}`, { timeout: 60_000 }, async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ComSpec)$/i.test(key)));
    Object.assign(env, { NODE_ENV: 'test', PULSE_SKIP_DOTENV: '1', PULSE_ARC_WORKER_RECOVERY: scenario });
    const child = spawn(process.execPath, ['--import', 'tsx', '--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    try {
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      assert.equal(code, 0, output);
    } finally { child.kill(); }
  });
