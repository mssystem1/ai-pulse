// Run: npx tsx --experimental-test-module-mocks --test scripts/arc-worker-flow.test.mjs
// Real scheduler/policy/journal code; isolated storage, market data and chain clients.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

test('Arc Autopilot buys, protects and closes a position with bounded USDC gas and one activity per fill', async () => {
  process.env.NODE_ENV = 'test';
  process.env.PULSE_SKIP_DOTENV = '1';
  process.env.FEATURE_ARC_TRADING = '1';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected external request in isolated worker test'); });
  const viem = await import('viem');
  const deployment = await import('../apps/api/src/executionContracts.ts');
  const contracts = { ...deployment.executionContracts('arc'), okxRouter: deployment.executionContractAddress('arc', 'okxRouter') };
  const { OKX_DAG_ABI } = await import('../apps/api/src/okxDag.ts');
  const readiness = await import('../apps/api/src/arcExecutionReadiness.ts');
  mock.module('../apps/api/src/arcExecutionReadiness.ts', { namedExports: { ...readiness, arcAutomationReadiness: async () => ({ready:true}) } });
  const owner = `0x${'1'.repeat(40)}`, vault = `0x${'2'.repeat(40)}`;
  const settlement = '0x3600000000000000000000000000000000000000';
  const target = '0x128cc466b61f542da60c70e3aa11c10e19b84edb';
  const pair = 'ETH-USDT';
  const signalMarket = pair;
  const analysisToSettlement = 1;
  let now = Date.now(), mark = 100 * analysisToSettlement, nonce = 0n, targetBalance = 0n, settlementBalance = 1_000_000n;
  mock.timers.enable({ apis: ['Date'], now });
  const strings = new Map(), hashes = new Map();
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
  const market = { instId: signalMarket, timeframe: '1H', candles, ticker: { instId: signalMarket, last: 100, ts: String(lastCandle), change24hPct: 2 }, fetchedAt: new Date(now).toISOString() };
  mock.module('../apps/api/src/robinhoodMarkets.ts', { namedExports: { ...marketModule,
    executionMarketContext: async () => market,
    executionSettlementTicker: async () => ({ ...market.ticker, last: mark, usdPerSettlement: 1 }),
    robinhoodAutopilotContext: async (_cfg, input) => {
      assert.equal(input.signalMarket, signalMarket, 'the worker pins the owner-authorized signal source');
      return { market, signalMarket, signalSource: 'token-dex', analysisToSettlement,
        settlementTicker: { ...market.ticker, last: mark, usdPerSettlement: 1 } };
    },
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
  let pendingBuyHash, timeoutBuyReceipt = true;
  const wallet = { account: { address: owner }, writeContract: async request => {
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
      }
      if (buy) { settlementBalance -= request.args[6]; targetBalance += quoteOutput; }
      else { targetBalance -= request.args[6]; settlementBalance += quoteOutput; }
      nonce++;
    }
    const hash = `0x${submitted.length.toString(16).padStart(64, '0')}`;
    if (request.functionName === 'execute' && request.args[4].toLowerCase() === settlement.toLowerCase()) pendingBuyHash = hash;
    return hash;
  } };
  mock.module('viem', { namedExports: { ...viem, createWalletClient: () => wallet } });
  const discovery = await import('../apps/api/src/onchainDiscovery.ts');
  let runtimeReads = 0, pauseOnRead = Infinity;
  mock.module('../apps/api/src/onchainDiscovery.ts', { namedExports: { ...discovery,
    executionPublicClient: () => ({
      estimateGas: async () => 100000n,
      estimateFeesPerGas: async () => ({ maxFeePerGas:100000000000n, maxPriorityFeePerGas:1n }),
      getBalance: async () => viem.parseEther('5'),
      multicall: async () => [++runtimeReads >= pauseOnRead, 1n, nonce, 50n, 100000n, 0n, 0n, targetBalance, 18, 6, settlementBalance],
      readContract: async request => { assert.equal(request.functionName, 'exposureCap'); return 1_000_000n; },
      simulateContract: async request => ({ request }),
      waitForTransactionReceipt: async request => {
        if (request.hash === pendingBuyHash && timeoutBuyReceipt) {
          timeoutBuyReceipt = false;
          throw Error('Receipt request timed out after the buy landed');
        }
        return { status: 'success' };
      },
    }),
  } });
  const activityStore = await import('../apps/api/src/v6Store.ts');
  mock.module('../apps/api/src/v6Store.ts', { namedExports: { ...activityStore,
    reconcileV6Activity: async (walletOwner, network) => {
      for (const row of await activityStore.listV6Activity(walletOwner, network))
        if (row.status === 'pending' && row.txHash === pendingBuyHash) await activityStore.confirmV6Activity(row);
      return activityStore.listV6Activity(walletOwner, network);
    },
  } });
  const { runAutopilotCycle } = await import('../apps/api/src/autopilotAutomation.ts');
  const cfg = { AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`, AUTOPILOT_KILL_SWITCH: false, hasXaiKey: false };
  const stored = () => JSON.parse(hashes.get(strategyKey).get(strategy.id));
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
