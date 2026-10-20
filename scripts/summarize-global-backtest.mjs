/** Independently reconcile every fill/exit against the archived OHLCV. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {candleCloseTime} from '../packages/schemas/dist/index.js';
import {loadBacktestData} from './global-backtest-data.mjs';
import {winInterval} from './global-backtest-engine.mjs';

const {frames,manifest,dailyComparisons}=loadBacktestData(),rows=[],validation=[],equityRows=[],pending=[];
const number=n=>n==null?'—':n.toFixed(2),out='docs/backtests';
for(const label of ['baseline','revised'])for(const frame of ['1H','4H','1Dutc','1Wutc']){
  if(process.argv.includes('--partial')&&!fs.existsSync(`${out}/global-${label}/${frame}-summary.json`)){pending.push({label,frame});continue;}
  const root=`${out}/global-${label}`,result=JSON.parse(fs.readFileSync(`${root}/${frame}-summary.json`));
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.sourceManifest,manifest);
  for(const side of ['long','short']){
    const tradesFile=`${root}/${frame}-${side}-trades.json`,trades=JSON.parse(fs.readFileSync(tradesFile)),bars=frames[result.entryFrame],indices=new Map(bars.map((b,i)=>[b.ts,i]));
    let previousExit=0,net=0,fees=0,costRejected=0,balance=result.initialEquity,ambiguousExits=0;
    for(const t of trades){
      const sign=side==='long'?1:-1,fee=result.costs.feeBps/10000,slip=result.costs.slippageBps/10000,entry=bars[indices.get(t.entryAt)];
      assert.ok(entry);assert.equal(t.entryAt,t.signalAt);assert.ok(t.availableAt<=t.signalAt);
      if(t.entryPrice===undefined){
        // Initial harness logs spread the exit's price over the entry's price.
        // Recover the entry from the raw next-open fill AND its separately
        // recorded entry fee; P&L was calculated before serialization.
        const expected=entry.open*(1+sign*slip);assert.ok(fee>0&&Math.abs(t.entryFee-t.units*expected*fee)<1e-7);
        t.entryPrice=expected;t.exitPrice=t.price;delete t.price;
      }
      assert.ok(t.confirmationTs<t.retestTs);assert.ok(t.entryAt>=previousExit);
      assert.ok(t.riskBudget<=balance*.01+1e-6);assert.ok(t.entryPrice*t.units+t.entryFee<=balance+1e-6);
      assert.ok(t.entryPrice>=t.entry[0]&&t.entryPrice<=t.entry[1]);assert.ok(Math.abs(t.entryPrice-entry.open*(1+sign*slip))<1e-7);
      let exit;
      for(const b of bars.slice(indices.get(t.entryAt))){
        const closed=candleCloseTime(b.ts,result.entryFrame);if(closed>Date.parse(result.end))break;
        const gap=side==='long'?b.open<=t.stop:b.open>=t.stop,stop=side==='long'?b.low<=t.stop:b.high>=t.stop,target=side==='long'?b.high>=t.target:b.low<=t.target;
        if(gap||stop||target){exit={raw:gap?b.open:stop?t.stop:t.target,reason:gap?'stop_gap':stop?'stop':'target',at:closed,ambiguous:!gap&&stop&&target};break;}
      }
      if(!exit){const b=bars.find(b=>candleCloseTime(b.ts,result.entryFrame)===Date.parse(result.end));exit={raw:b.close,reason:'sample_end',at:Date.parse(result.end)};}
      assert.equal(t.reason,exit.reason);assert.equal(t.exitAt,exit.at);
      if(exit.ambiguous)ambiguousExits++;
      const px=exit.raw*(1-sign*slip),gross=sign*(px-t.entryPrice)*t.units,charged=(t.entryPrice+px)*t.units*fee;
      assert.ok(Math.abs(t.exitPrice-px)<1e-7);assert.ok(Math.abs(t.gross-gross)<1e-7);assert.ok(Math.abs(t.fees-charged)<1e-7);assert.ok(Math.abs(t.net-(gross-charged))<1e-7);
      // Report signals use gross-R gates. Identify fills that would fail even
      // an optimistic fee-adjusted 1.5R quote gate to their primary target.
      const reward=sign*(t.target*(1-sign*slip)-t.entryPrice)-fee*(t.entryPrice+t.target*(1-sign*slip));
      const risk=sign*(t.entryPrice-t.stop*(1-sign*slip))+fee*(t.entryPrice+t.stop*(1-sign*slip));
      if(reward/risk<1.5)costRejected++;
      previousExit=t.exitAt;net+=t.net;fees+=t.fees;balance+=t.net;
    }
    const s=result.summaries[side];s.winRate95Percent=winInterval(s.wins,s.resolvedTrades);assert.ok(Math.abs(s.netPnl-net)<1e-6);assert.ok(Math.abs(s.fees-fees)<1e-6);
    let realized=result.initialEquity,peak=realized,drawdown=0,index=0,exposureBars=0;
    const sample=bars.filter(b=>b.ts>=Date.parse(result.start)&&candleCloseTime(b.ts,result.entryFrame)<=Date.parse(result.end));
    for(const [i,b]of sample.entries()){
      const at=candleCloseTime(b.ts,result.entryFrame),held=trades[index];
      if(held&&held.entryAt<=b.ts&&held.exitAt>=at)exposureBars++;
      while(index<trades.length&&trades[index].exitAt<=at)realized+=trades[index++].net;
      const t=trades[index];let marked=realized;
      if(t&&t.entryAt<=b.ts){const sign=side==='long'?1:-1,exit=b.close*(1-sign*result.costs.slippageBps/10000);marked+=sign*(exit-t.entryPrice)*t.units-t.entryFee-exit*t.units*result.costs.feeBps/10000;}
      peak=Math.max(peak,marked);drawdown=Math.max(drawdown,100*(peak-marked)/peak);
      if(at%86400000===0||i===sample.length-1)equityRows.push({label,frame,side,at:new Date(at).toISOString(),equity:marked});
    }
    assert.ok(Math.abs(drawdown-s.maxDrawdownPercent)<1e-7);assert.ok(Math.abs(100*exposureBars/sample.length-s.exposurePercent)<1e-7);
    fs.writeFileSync(tradesFile,JSON.stringify(trades,null,2));
    rows.push({label,frame,side,...s,optimisticCostGateFailures:costRejected,ambiguousStopTargetCandles:ambiguousExits,decisionBars:result.decisionBars,start:result.start,end:result.end});
    validation.push({label,frame,side,tradesChecked:trades.length,priceAndCostReconciliation:true,earliestFillAfterSignal:true,ambiguousCandlesUseStopFirst:true,ambiguousStopTargetCandles:ambiguousExits,optimisticCostGateFailures:costRejected});
  }
  fs.writeFileSync(`${root}/${frame}-summary.json`,JSON.stringify(result,null,2));
}
if(pending.length){fs.writeFileSync('.tmp/global-backtest/partial-validation.json',JSON.stringify({pending,cases:validation},null,2));console.log(JSON.stringify({pending,ledgersVerified:validation.length}));process.exit(0);}
fs.writeFileSync(`${out}/validation.json`,JSON.stringify({dataHashesVerified:true,dailyOhlcComparisons:dailyComparisons,cases:validation},null,2));
fs.writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));
const columns=['label','frame','side','resolvedTrades','wins','losses','winRatePercent','profitFactor','expectancyR','netPnl','netReturnPercent','maxDrawdownPercent','fees','exposurePercent','optimisticCostGateFailures','ambiguousStopTargetCandles'];
fs.writeFileSync(`${out}/results.csv`,columns.join(',')+'\n'+rows.map(r=>columns.map(k=>r[k]??'').join(',')).join('\n')+'\n');
fs.writeFileSync(`${out}/daily-equity.csv`,'label,frame,side,at,equity\n'+equityRows.map(r=>[r.label,r.frame,r.side,r.at,r.equity].join(',')).join('\n')+'\n');
const table=side=>['| Rules | Frame | Trades | Wins | Win rate | Profit factor | Net P&L | Net return | Close-equity drawdown |','|---|---|---:|---:|---:|---:|---:|---:|---:|',...rows.filter(r=>r.side===side).map(r=>`| ${r.label} | ${r.frame.replace('utc','')} | ${r.resolvedTrades} | ${r.wins} | ${r.winRatePercent===null?'—':number(r.winRatePercent)+'%'} | ${number(r.profitFactor)} | $${number(r.netPnl)} | ${number(r.netReturnPercent)}% | ${number(r.maxDrawdownPercent)}% |`)].join('\n');
const report=`# Global report backtest — BTC-USDT\n\nThese results do not establish a high win rate or a profitable strategy. They are a costed simulation of the deterministic research signals, not a simulation of live wallet execution. Baseline is commit 2125053; revised rules are the accompanying source changes. No parameters were optimized against these results. Every revised spot-long ledger that traded lost money in this sample; the revision does not establish a better entry model.\n\n## Spot-long results\n\n${table('long')}\n\n## Hypothetical short results\n\n${table('short')}\n\nThese short ledgers cannot be executed by selling unowned OKX Spot inventory. Borrow, funding, liquidation and derivatives basis are not modeled; short results are incomplete.\n\n## Method\n\n- Evaluation starts 2025-10-20 UTC and ends at the last complete available bar on 2026-10-20. The exact end differs by entry timeframe and is saved in each summary. Longer history is warm-up only. Recompute a report at every completed entry-frame bar: 15m for 1H, 1H for 4H, 4H for daily, and daily for weekly. Each frame receives at most its latest 520 completed candles.\n- Public OKX OHLCV only, downloaded ${manifest.downloadedAt}. The compressed data archive is included. SHA-256 verification and ${dailyComparisons} complete-day OHLC comparisons check data integrity and UTC aggregation. Candle history can contain later exchange revisions; no historical revision feed is available.\n- Start each independent ledger with $10,000. Risk at most 1% of current equity per trade, cap exposure at 100% of cash, no leverage. Ledgers and overlapping timeframes are never pooled.\n- Enter only after the report says technical_valid, at the NEXT candle's open with adverse 0.02% slippage, provided the filled price is inside the saved entry band. No filling at a historical low or at the signal candle's already-passed retest. Deduplicate successful entries by their observed signal.\n- Charge assumed 0.10% per side; these are test assumptions, not a verified fee tier or a measured order-book spread. Freeze the observed stop and primary TP1. Close all units at the first stop or TP1. A candle touching both uses the stop. Stop gaps fill at the opening price; favorable target gaps get no improvement. No trailing stop, compounding between ledgers, or target switching.\n- Final open positions are liquidated at the final close, charged costs, and identified separately from resolved win-rate samples. Drawdown is measured from entry-frame closing liquidation equity, not tick-by-tick or intrabar peaks. Next-open execution assumes immediate deterministic readiness; actual report/quote latency is not modeled.\n- The test evaluates research-signal behavior. It does not assert that a live quote, token representation, balance, pass, owner authorization or order route would pass. The independent reconciliation counts recorded fills whose fee-adjusted reward would fail even a primary-TP1-only 1.5R quote gate. A nearer barrier can make the quote gate stricter. Those counts are diagnostic; do not reinterpret the table as the result of a separately backtested fee-gated strategy.\n\n## Limits and decision\n\nThe rules have already been developed using historical BTC examples, including the supplied screenshots. This is a retrospective diagnostic with chronological inputs, not an untouched out-of-sample result. One instrument and small trade counts cannot establish a stable edge. The JSON results include Wilson 95% win-rate intervals, expectancy, exposure and missed next-open fills; zero trades has no estimated win rate or profit factor. The same-fill fee and risk calculations are reconciled independently for every trade. Wilson intervals assume independent trials; correlated trades can make them overconfident. The buy-and-hold context benchmark has different exposure and risk and is not evidence of strategy outperformance.\n\nThe report correctness fixes are useful independently of trading performance. Do not describe these rules as proven profitable or advertise a high win rate from this sample. Further strategy development needs a predeclared objective, untouched markets/periods and forward paper trading; changing stops or targets until this BTC history looks good would invalidate a performance claim.\n\n## Reproduce offline\n\nBuild schemas, domain and analysis. Run, for each frame:\n\n\`node scripts/backtest-global-reports.mjs --label=revised --frame=1H\`\n\nUse 4H, 1Dutc and 1Wutc for the other frames. The default data is the included compressed archive; no network calls are made. For the baseline, use source commit 2125053 in an isolated checkout, build its packages, then run the same harness with \`--label=baseline\`. The harness is new in this revision and must be copied into that checkout along with the data loader, engine and archive. Compare the production-module SHA-256 hashes in the summaries. Run \`npm run test:global-backtest\` and \`node scripts/summarize-global-backtest.mjs\` to verify execution cases, source hashes and all exported fills.\n\n[Machine-readable results](results.json) · [CSV](results.csv) · [Independent reconciliation](validation.json) · [Public-data archive](data/btc-okx-20261020.json.gz)\n`;
const traded=rows.filter(r=>r.label==='revised'&&r.side==='long'&&r.resolvedTrades>0);
const observedConclusion=!traded.length?'The revised spot-long ledgers produced no resolved trades; their win rate and expectancy cannot be estimated.':traded.every(r=>r.netPnl<0)?'Every revised spot-long ledger that traded lost money in this sample; the revision does not establish a better entry model.':'The revised spot-long outcomes must be assessed individually; this retrospective sample does not establish a reliable improvement.';
fs.writeFileSync(`${out}/README.md`,report.replace('Every revised spot-long ledger that traded lost money in this sample; the revision does not establish a better entry model.',observedConclusion));console.log(JSON.stringify({ledgers:rows.length,tradesValidated:validation.reduce((s,v)=>s+v.tradesChecked,0),dailyComparisons}));
