import fs from 'node:fs';
import crypto from 'node:crypto';
import {loadBacktestData} from './global-backtest-data.mjs';
import {RESEARCH_POLICY,STRATEGIES,FRAME_RULES,causalFeatures,simulateStrategy,selectCandidate,acceptanceReasons} from './global-strategy-research.mjs';

const out='docs/backtests/strategy-research';fs.mkdirSync(out,{recursive:true});
const dataFile='docs/backtests/data/btc-okx-20261020.json.gz';
const splits={
  train:{start:Date.parse('2025-10-20T00:00:00Z'),end:Date.parse('2026-04-20T00:00:00Z')},
  validation:{start:Date.parse('2026-04-20T00:00:00Z'),end:Date.parse('2026-07-20T00:00:00Z')},
  final:{start:Date.parse('2026-07-20T00:00:00Z'),end:Date.parse('2026-10-21T00:00:00Z')},
};
const sourcePaths=['scripts/global-strategy-research.mjs','scripts/research-global-strategies.mjs','scripts/global-backtest-engine.mjs','scripts/global-backtest-data.mjs',dataFile];
const registration={registeredAt:new Date().toISOString(),policy:RESEARCH_POLICY,strategies:STRATEGIES,splits,
  sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),
  target:'Strictly more than 70% profitable resolved trades, after costs, with >=1.5 realized payoff, positive expectancy and uncertainty/sample gates.',
  scope:'BTC-USDT unlevered Spot longs only. Research candidates, NOT the production Global report selector.',
  priorExposure:'This archive has already been used for production-rule diagnostics and supplied screenshot development. Chronological partitioning is NOT an untouched external validation. No candidate qualifies for a production profitability claim without new forward/independent evidence.',
  selection:'Select using train and validation only. Final outcomes cannot choose or retune any candidate. No qualifying candidate means no selection.',
  antiCherryPicking:'All 18 declared candidates across four frames and all splits are saved. No tuning after this run, no profitable subperiod extraction, no pooled win rate across overlapping frames.',
};
if(fs.existsSync(`${out}/registration.json`)){
  const previous=JSON.parse(fs.readFileSync(`${out}/registration.json`,'utf8'));
  if(JSON.stringify(previous.sourceHashes)!==JSON.stringify(registration.sourceHashes))throw Error('Research registration is already frozen for different sources. Create an explicit new version; do not silently retune this study.');
  registration.registeredAt=previous.registeredAt;
}
fs.writeFileSync(`${out}/registration.json`,JSON.stringify(registration,null,2));
const {frames,dailyComparisons}=loadBacktestData(dataFile);
const features=Object.fromEntries(Object.entries(frames).map(([f,bars])=>[f,causalFeatures(bars)]));
const rows=[],selected={},ledgers={};
for(const frame of Object.keys(FRAME_RULES)){
  const cases=[];
  for(const config of STRATEGIES){
    const row={frame,config};
    for(const split of ['train','validation']){
      const run=simulateStrategy({frames,features,frame,config,...splits[split]});
      row[split]=run.summary;ledgers[`${frame}:${config.id}:${split}`]=run.trades;
    }
    cases.push(row);
  }
  selected[frame]=selectCandidate(cases);
  // Selection is frozen above, before looking at any final-period result.
  fs.writeFileSync(`${out}/selection.json`,JSON.stringify({sourceHashes:registration.sourceHashes,selected},null,2));
  for(const row of cases){
    const run=simulateStrategy({frames,features,frame,config:row.config,...splits.final});
    row.final=run.summary;row.selectedBeforeFinal=selected[frame]===row.config.id;
    row.finalRejectionReasons=acceptanceReasons(run.summary);
    row.promoted=false; // This reused archive cannot establish independent/forward validation.
    ledgers[`${frame}:${row.config.id}:final`]=run.trades;rows.push(row);
  }
  console.log(JSON.stringify({frame,selected:selected[frame],candidates:cases.length,finalTrades:cases.reduce((s,r)=>s+r.final.resolvedTrades,0)}));
}
const result={registration,dailyComparisons,selected,productionPromotions:[],rows};
fs.writeFileSync(`${out}/results.json`,JSON.stringify(result,null,2));
fs.writeFileSync(`${out}/trades.json`,JSON.stringify(ledgers));
const keys=['frame','strategyId','split','resolvedTrades','wins','winRatePercent','profitFactor','expectancyR','realizedPayoff','netReturnPercent','maxDrawdownPercent','targetHitRatePercent'];
fs.writeFileSync(`${out}/results.csv`,[keys.join(','),...rows.flatMap(r=>['train','validation','final'].map(split=>keys.map(k=>k==='split'?split:r[split][k]??'').join(',')))].join('\n')+'\n');
const fmt=(n,d=2)=>n===null||n===undefined?'—':n.toFixed(d);
const lines=['# Global strategy research — 70% acceptance target','',
  '**No production strategy is promoted by this research.** These are new mechanical candidate rules, not a rerun of the production report selector. The archive was previously inspected; the final partition is chronological evaluation, not untouched external proof.','',
  '## Rules declared before the run','',
  '- Three Spot-long families: trend pullback, breakout followed by a separate retest, and range-edge rejection. Each waits for a later confirming close, then can fill only at the next open within the saved entry band.','- Core, higher-timeframe-aligned and stricter volume/RSI filters; fixed 1.75R/2.5R nominal targets, capped by nearer known confirmed barriers (range entries also by the observed opposite range edge). All 18 variants are included, including failures.','- No entry unless reward after assumed fees (0.10% per side) and adverse slippage (0.02% per side) is at least 1.5 times the modeled net stop loss. Stops use the observed reaction low minus 0.15 entry ATR; no widening after entry.','- Separate $10,000 cash ledgers, 1% modeled risk cap, 100% cash cap, no leverage. Pause entries after a 3% UTC-day equity loss; four entry candles cooldown after a loss. Gaps may exceed the modeled risk budget.','- All-out frozen stop/target; ambiguous OHLC stop first; maximum holding time 48 entry candles, then exit at that close. Time exits count as wins only if net positive; full-target hit rates are reported separately. Split-end liquidations are excluded from resolved win rate.','- Only completed candles; confirmed pivots need three right candles. No reaction, outcome or position crosses a split boundary. No future retest fill, future pivot or report-time price is substituted for execution.','',
  '## Acceptance','',
  'A candidate needs >70% net wins in both training and validation with at least 20 resolved trades in each and positive expectancy/profit factor; selection is frozen before final evaluation. Final acceptance also needs at least 100 resolved trades, a Wilson 95% lower bound >70%, positive net P&L/expectancy, profit factor >1, realized mean win / mean loss >=1.5 and closing-equity drawdown <=10%. These are research acceptance rules, not estimates of attainable future performance. A passed result on this reused archive would still require independent evidence and forward paper trading.','',
  'Train: 2025-10-20–2026-04-20 UTC. Validation: 2026-04-20–2026-07-20. Final: 2026-07-20–last available completed candle on 2026-10-20. Each partition starts flat. Weekly evidence is intrinsically sparse.','',
  '| Report frame | Selected using train + validation | Final trades | Final wins | Final win rate | Final net return |','|---|---|---:|---:|---:|---:|'];
for(const frame of Object.keys(FRAME_RULES)){
  const row=rows.find(r=>r.frame===frame&&r.selectedBeforeFinal);
  lines.push(`| ${frame} | ${selected[frame]??'None qualified'} | ${row?.final.resolvedTrades??'—'} | ${row?.final.wins??'—'} | ${row?fmt(row.final.winRatePercent)+'%':'—'} | ${row?fmt(row.final.netReturnPercent)+'%':'—'} |`);
}
lines.push('','## All candidates — final diagnostic results','','Results below cannot be used to select a strategy after inspecting this final partition. Overlapping candidate ledgers are alternative simulations, not independent trades or a combined portfolio.','','| Frame | Candidate | Trades | Wins | Win rate | 95% interval | Realized payoff | Net return | Rejections |','|---|---|---:|---:|---:|---|---:|---:|---|');
for(const r of rows)lines.push(`| ${r.frame} | ${r.config.id} | ${r.final.resolvedTrades} | ${r.final.wins} | ${fmt(r.final.winRatePercent)}% | ${r.final.winRate95Percent?.map(n=>fmt(n)).join('–')??'—'} | ${fmt(r.final.realizedPayoff)} | ${fmt(r.final.netReturnPercent)}% | ${r.finalRejectionReasons.join(', ')} |`);
lines.push('','## Limits and reproduction','','One instrument, about one year, assumed costs, overlapping candidates and sparse higher-timeframe trades cannot establish future win rate. OHLC execution assumes prompt readiness, no order-book constraints, no partial fills and no measured report latency. Daily risk pauses cannot prevent overnight/intrabar gaps. Closing-equity drawdown omits intrabar peaks. The win interval assumes independent trials and does not correct for all 72 tested frame/candidate combinations. No live orders, wallets, payments or model calls are used.','','Run `npm run test:global-strategies`, then `npm run research:global-strategies`. Registration freezes source/data hashes; changing rules requires an explicit new study version. Run `node scripts/verify-global-strategy-research.mjs` for independent fill, cost, target, timing and selection reconciliation.','','[Frozen registration](registration.json) · [All splits JSON](results.json) · [All splits CSV](results.csv) · [Every simulated trade](trades.json)','');
fs.writeFileSync(`${out}/README.md`,lines.join('\n'));
