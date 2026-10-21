/** Reconcile every research fill independently against the frozen archive. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {loadBacktestData} from './global-backtest-data.mjs';
import {FRAME_RULES,barClose,selectCandidate,acceptanceReasons,RESEARCH_POLICY} from './global-strategy-research.mjs';

const root='docs/backtests/strategy-research',result=JSON.parse(fs.readFileSync(`${root}/results.json`,'utf8'));
const ledgers=JSON.parse(fs.readFileSync(`${root}/trades.json`,'utf8'));
for(const [path,hash]of Object.entries(result.registration.sourceHashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),hash,`Source/data changed: ${path}`);
const {frames,dailyComparisons}=loadBacktestData();let count=0,ambiguous=0;
function near(actual,expected,label){assert.ok(Math.abs(actual-expected)<=1e-7*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);}
for(const row of result.rows){
  for(const split of ['train','validation','final']){
    const bounds=result.registration.splits[split],trades=ledgers[`${row.frame}:${row.config.id}:${split}`];
    const entryFrame=FRAME_RULES[row.frame].entry,source=frames[entryFrame],byTs=new Map(source.map((b,i)=>[b.ts,i]));
    const fee=result.registration.policy.feeBps/10000,slip=result.registration.policy.slippageBps/10000;
    let equity=10000,previousExit=bounds.start,peak=10000,maxDrawdown=0,positionIndex=0;
    for(const t of trades){
      count++;
      assert.ok(t.entryAt>=t.availableAt&&t.availableAt>t.confirmationAt-1);
      assert.equal(t.signalAt,t.availableAt);assert.equal(t.confirmationAt+barClose({ts:0},entryFrame),t.availableAt);
      assert.ok(t.reactionAt<t.confirmationAt);assert.equal(t.entryAt,t.availableAt,'Immediate next-open only');
      assert.ok(t.entryAt>=bounds.start&&t.exitAt<=bounds.end&&t.entryAt>=previousExit);
      const begin=byTs.get(t.entryAt);assert.ok(begin!==undefined);near(t.entryPrice,source[begin].open*(1+slip),'entry');
      assert.ok(t.entryPrice>=t.entry[0]&&t.entryPrice<=t.entry[1]);
      near(t.entryFee,t.entryPrice*t.units*fee,'entry fee');
      const netRisk=t.entryPrice-t.stop*(1-slip)+fee*(t.entryPrice+t.stop*(1-slip));
      const netReward=t.target*(1-slip)-t.entryPrice-fee*(t.entryPrice+t.target*(1-slip));
      near(t.netRewardRiskAtEntry,netReward/netRisk,'net R');assert.ok(netReward/netRisk>=1.5-1e-10);
      assert.ok(t.riskBudget<=equity*.01+1e-6);assert.ok(t.entryPrice*t.units+t.entryFee<=equity+1e-6);
      near(t.riskBudget,t.units*(t.entryPrice-t.stop+t.entryPrice*fee+t.stop*(fee+slip)),'modeled risk');
      let exit=null;
      for(let j=begin;j<source.length&&barClose(source[j],entryFrame)<=bounds.end;j++){
        const b=source[j];let price,reason;
        if(b.open<=t.stop){price=b.open;reason='stop_gap';}
        else if(b.low<=t.stop){price=t.stop;reason='stop';if(b.high>=t.target)ambiguous++;}
        else if(b.high>=t.target){price=t.target;reason='target';}
        else if(j-begin+1>=RESEARCH_POLICY.maxHoldingBars){price=b.close;reason='time_exit';}
        else if(j===source.length-1||barClose(source[j+1],entryFrame)>bounds.end){price=b.close;reason='sample_end';}
        if(reason){exit={price:price*(1-slip),reason,at:barClose(b,entryFrame)};break;}
      }
      assert.ok(exit);assert.equal(t.reason,exit.reason);assert.equal(t.exitAt,exit.at);near(t.exitPrice,exit.price,'exit');
      const fees=fee*t.units*(t.entryPrice+t.exitPrice),net=t.units*(t.exitPrice-t.entryPrice)-fees;
      near(t.fees,fees,'fees');near(t.net,net,'net PnL');equity+=net;previousExit=t.exitAt;
    }
    // Independently reconstruct closing liquidation equity, including position fees.
    let cash=10000,open=null;
    for(const b of source){
      const at=barClose(b,entryFrame);if(b.ts<bounds.start||at>bounds.end)continue;
      const next=trades[positionIndex];if(next?.entryAt===b.ts){open=next;positionIndex++;}
      if(open?.exitAt===at){cash+=open.net;open=null;}
      const marked=cash+(open?open.units*(b.close*(1-slip)-open.entryPrice)-fee*open.units*(open.entryPrice+b.close*(1-slip)):0);
      peak=Math.max(peak,marked);maxDrawdown=Math.max(maxDrawdown,100*(peak-marked)/peak);
    }
    near(row[split].netPnl,equity-10000,'ledger PnL');near(row[split].maxDrawdownPercent,maxDrawdown,'drawdown');
    const resolved=trades.filter(t=>t.reason!=='sample_end'),wins=resolved.filter(t=>t.net>0);
    assert.equal(row[split].resolvedTrades,resolved.length);assert.equal(row[split].wins,wins.length);
    if(resolved.length)near(row[split].winRatePercent,100*wins.length/resolved.length,'win rate');else assert.equal(row[split].winRatePercent,null);
  }
  assert.deepEqual(row.finalRejectionReasons,acceptanceReasons(row.final));
  assert.equal(row.promoted,false);
}
for(const frame of Object.keys(FRAME_RULES))assert.equal(result.selected[frame],selectCandidate(result.rows.filter(r=>r.frame===frame)));
const validation={checkedAt:new Date().toISOString(),sourceHashesVerified:true,dailyComparisons,ledgers:Object.keys(ledgers).length,
  tradesChecked:count,ambiguousStopTargetCandles:ambiguous,checks:['next-open availability','reaction before confirmation','net >=1.5R at fill','fees/slippage','cash and 1% risk caps','independent OHLC exits','split boundaries','closing equity drawdown','win counts','train/validation-only selection'],productionPromotions:[]};
fs.writeFileSync(`${root}/verification.json`,JSON.stringify(validation,null,2));console.log(JSON.stringify(validation));
