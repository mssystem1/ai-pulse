import test from 'node:test';
import assert from 'node:assert/strict';
import {makePosition,positionExit,closePosition,summarizeTrades,winInterval} from './global-backtest-engine.mjs';
const signal={side:'long',availableAt:200,entry:[99,102],stop:95,target:110};
test('cannot fill a signal in a candle that began before it became available',()=>{
  assert.throws(()=>makePosition(signal,{ts:100,open:100},10000),/before signal/);
  assert.equal(makePosition(signal,{ts:200,open:103},10000),null);
});
test('ambiguous candle takes the stop and a gap cannot fill at the better stop price',()=>{
  assert.deepEqual(positionExit(signal,{open:100,high:111,low:94}),{price:95,reason:'stop'});
  assert.deepEqual(positionExit(signal,{open:90,high:100,low:89}),{price:90,reason:'stop_gap'});
  assert.deepEqual(positionExit({...signal,side:'short',stop:105,target:90},{open:110,high:112,low:89}),{price:110,reason:'stop_gap'});
});
test('fees and adverse slippage reduce net PnL and units obey spot cash and risk limits',()=>{
  const p=makePosition(signal,{ts:200,open:100},10000);assert.ok(p.price>100);
  assert.ok(p.units*p.price+p.entryFee<=10000);assert.ok(p.riskBudget<=100.000001);
  const result=closePosition(p,110);assert.ok(result.exitPrice<110);assert.ok(result.net<result.gross);assert.ok(result.fees>0);
  assert.equal(result.price,undefined,"Exit results cannot overwrite the original position entry");
});
test('zero trades has no fabricated win rate or profit factor; end liquidation is separate',()=>{
  assert.equal(summarizeTrades([],10000,10000,0).winRatePercent,null);
  const s=summarizeTrades([{reason:'sample_end',net:10,fees:2,riskBudget:100}],10000,10010,1);
  assert.equal(s.resolvedTrades,0);assert.equal(s.sampleEndExits,1);assert.equal(s.winRatePercent,null);
});
test('win-rate intervals respect probability bounds despite floating-point roundoff',()=>{
  assert.equal(winInterval(0,5)[0],0);assert.equal(winInterval(5,5)[1],100);assert.equal(winInterval(0,0),null);
});
