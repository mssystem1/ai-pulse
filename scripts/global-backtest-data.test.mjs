import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateCandles,loadBacktestData} from './global-backtest-data.mjs';
test('an aggregate never accepts a partial or missing-candle hour',()=>{
  const bars=Array.from({length:4},(_,i)=>({ts:i*900000,open:100,high:102,low:99,close:101,volume:1}));
  assert.equal(aggregateCandles(bars,4).length,1);
  assert.equal(aggregateCandles(bars.slice(1),4).length,0);
  assert.equal(aggregateCandles([...bars.slice(0,2),...bars.slice(3)],4).length,0);
});
test('the archived public history matches every recorded hash and its daily OHLC agrees with full 15m aggregates',()=>{
  const data=loadBacktestData();assert.equal(data.frames['15m'].length,43999);assert.ok(data.dailyComparisons>450);
});
