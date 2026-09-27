// Run: npx tsx --experimental-test-module-mocks --test scripts/robinhood-worker-flow.test.mjs
// Real scheduler/policy/journal code; isolated storage, market data and chain clients.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

test('Robinhood worker buys, protects and closes a position with one activity per fill', async () => {
  process.env.NODE_ENV = 'test';
  process.env.PULSE_SKIP_DOTENV = '1';
  process.env.FEATURE_ROBINHOOD_TRADING = '1';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected external request in isolated worker test'); });
  const viem = await import('viem');
  const deployment = await import('../apps/api/src/executionContracts.ts');
  const contracts = { ...deployment.executionContracts('robinhood'), okxRouter: deployment.executionContractAddress('robinhood', 'okxRouter') };
  const funding = await import('../apps/api/src/robinhoodFunding.ts');
  const owner = `0x${'1'.repeat(40)}`, vault = `0x${'2'.repeat(40)}`;
  const settlement = funding.ROBINHOOD_FUNDING.usdg;
  const target = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
  const pair = 'WETH.0BD7D308F8E1639F-USDG';
  let now = Date.now(), mark = 100, nonce = 0n, targetBalance = 0n, settlementBalance = 1_000_000n;
  mock.timers.enable({ apis: ['Date'], now });
  const strings = new Map(), hashes = new Map();
  const strategyKey = 'pulse:v6:autopilot:strategy-map';
  const strategy = { id: 'isolated-robinhood-worker', owner, network: 'robinhood', vault,
    settlementAsset: settlement, targetAsset: target, pair, timeframe: '1H', strategyType: 'trend_following',
    buyAmountAtomic: '100000', sellAmountAtomic: '100000', minConfidence: 60,
    policy: { pair, timeframe: '1H', maxTradePct: 100, dailyLossPct: 20, strategy: 'Trend following' },
    status: 'active', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
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
  let pass = { owner, network: 'robinhood', vault, purchasedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 86400000).toISOString(), signalLimit: 3, signalsUsed: 0 };
  mock.module('../apps/api/src/autopilotPassStore.ts', { namedExports: { ...passModule,
    getAutopilotPass: async () => pass,
    synchronizeAutopilotPassPause: async value => value,
    mutateAutopilotPass: async (_network, _vault, update) => { pass = update(pass); return pass; },
  } });
  const marketModule = await import('../apps/api/src/robinhoodMarkets.ts');
  const lastCandle = Math.floor(now / 3600000) * 3600000 - 3600000;
  const candles = Array.from({ length: 120 }, (_, i) => ({ ts: lastCandle - (119 - i) * 3600000,
    open: 40 + i * .5, high: 41 + i * .5, low: 39 + i * .5, close: 40.5 + i * .5, volume: 100, volumeCcy: 10000, confirmed: true }));
  const market = { instId: pair, timeframe: '1H', candles, ticker: { instId: pair, last: 100, ts: String(lastCandle), change24hPct: 2 }, fetchedAt: new Date(now).toISOString() };
  mock.module('../apps/api/src/robinhoodMarkets.ts', { namedExports: { ...marketModule,
    executionMarketContext: async () => market,
    executionSettlementTicker: async () => ({ ...market.ticker, last: mark, usdPerSettlement: 1 }),
  } });
  const signal = { generatedAt: new Date(now).toISOString(), candleTs: lastCandle,
    signal: { bias: 'bullish', confidence: 90, regime: 'trend_up', support: [95], resistance: [110] } };
  strings.set(`pulse:v6:autopilot:signal:${pair}:1H`, JSON.stringify({ expiresAt: now + 3600000, value: signal }));
  let quoteOutput = 0n;
  const dex = await import('../apps/api/src/okxDex.ts');
  mock.module('../apps/api/src/okxDex.ts', { namedExports: { ...dex, getGenericOkxSwap: async (_cfg, input) => {
    const buy = input.fromTokenAddress.toLowerCase() === settlement.toLowerCase();
    quoteOutput = buy ? BigInt(input.amount) * 10n ** 12n / BigInt(mark) : BigInt(input.amount) * BigInt(mark) / 10n ** 12n;
    return { quote: { chainId: '4663', fromTokenAmount: input.amount, toTokenAmount: String(quoteOutput),
      fromToken: { address: input.fromTokenAddress, decimals: buy ? 6 : 18 }, toToken: { address: input.toTokenAddress, decimals: buy ? 18 : 6 }, priceImpactPercent: '0' },
      tx: { to: contracts.okxRouter, from: contracts.executionAdapter, value: '0', data: viem.encodeFunctionData({
        abi: funding.ROBINHOOD_FUNDING_ABI, functionName: 'dagSwapTo', args: [1n, contracts.executionAdapter,
          { fromToken: BigInt(input.fromTokenAddress), toToken: input.toTokenAddress, fromTokenAmount: BigInt(input.amount),
            minReturnAmount: quoteOutput * 995n / 1000n, deadLine: BigInt(Math.floor(now / 1000) + 600) }, []] }) } };
  } } });
  const submitted = [];
  const wallet = { account: { address: owner }, writeContract: async request => {
    submitted.push(request);
    if (request.functionName === 'execute') {
      assert.equal(request.args[2], nonce);
      const buy = request.args[4].toLowerCase() === settlement.toLowerCase();
      if (buy) { settlementBalance -= request.args[6]; targetBalance += quoteOutput; }
      else { targetBalance -= request.args[6]; settlementBalance += quoteOutput; }
      nonce++;
    }
    return `0x${submitted.length.toString(16).padStart(64, '0')}`;
  } };
  mock.module('viem', { namedExports: { ...viem, createWalletClient: () => wallet } });
  const discovery = await import('../apps/api/src/onchainDiscovery.ts');
  let runtimeReads = 0, pauseOnRead = Infinity;
  mock.module('../apps/api/src/onchainDiscovery.ts', { namedExports: { ...discovery,
    executionPublicClient: () => ({
      multicall: async () => [++runtimeReads >= pauseOnRead, 1n, nonce, 50n, 100000n, 0n, 0n, targetBalance, 18, 6, settlementBalance],
      readContract: async request => { assert.equal(request.functionName, 'exposureCap'); return 1_000_000n; },
      simulateContract: async request => ({ request }),
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    }),
  } });
  const { runAutopilotCycle } = await import('../apps/api/src/autopilotAutomation.ts');
  const cfg = { AUTOMATION_EXECUTOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`, AUTOPILOT_KILL_SWITCH: false, hasXaiKey: false };
  const stored = () => JSON.parse(hashes.get(strategyKey).get(strategy.id));
  await runAutopilotCycle(cfg);
  assert.equal(stored().lastDecision, 'buy_filled', JSON.stringify(stored()));
  assert.ok(targetBalance > 0n);
  assert.equal(pass.signalsUsed, 1);
  mark = 130; now += 120000;
  mock.timers.setTime(now);
  await runAutopilotCycle(cfg);
  assert.equal(stored().lastDecision, 'sell_partial_filled', JSON.stringify(stored()));
  now += 120000;
  mock.timers.setTime(now);
  await runAutopilotCycle(cfg);
  assert.equal(stored().lastDecision, 'sell_filled', JSON.stringify(stored()));
  assert.equal(targetBalance, 0n);
  assert.equal(pass.signalsUsed, 1, 'deterministic exits consume no additional AI confirmations');
  const { listV6Activity } = await import('../apps/api/src/v6Store.ts');
  const fills = (await listV6Activity(owner, 'robinhood')).filter(row => row.kind.endsWith('_filled'));
  assert.deepEqual(fills.map(row => row.kind).sort(), ['buy_filled', 'sell_filled', 'sell_partial_filled']);
  assert.ok(fills.every(row => row.status === 'confirmed'));
  assert.equal(submitted.filter(request => request.functionName === 'execute').length, 3);

  // Owner control must win even when the entry signal already passed.
  const raceStrategy = { ...strategy, id: 'owner-pause-race' };
  hashes.set(strategyKey, new Map([[raceStrategy.id, JSON.stringify(raceStrategy)]]));
  runtimeReads = 0; pauseOnRead = 3; mark = 100;
  const beforePause = submitted.length;
  await runAutopilotCycle(cfg);
  const paused = JSON.parse(hashes.get(strategyKey).get(raceStrategy.id));
  assert.equal(paused.lastDecision, 'hold_paused', JSON.stringify(paused));
  assert.equal(submitted.length, beforePause, 'a pause before submission prevents both oracle and execution writes');
  assert.equal(pass.signalsUsed, 1, 'the already-consumed cached signal must not be billed twice');
});
