/** Bounded walk-forward diagnostics on the saved public BTC candles. No model,
 * quotes, orders or network. Not a calibrated strategy or a performance claim. */
import fs from "node:fs";
import { prepareGlobalReport, assessGlobalReport } from "../packages/analysis/dist/index.js";
import { candleCloseTime } from "../packages/schemas/dist/index.js";
import { summarizeCandles } from "../packages/market/dist/index.js";
const rows=JSON.parse(fs.readFileSync("packages/analysis/src/globalReport.oct16-fixtures.json","utf8")).filter(r=>r.date==="oct16");
const results=[];
for(const row of rows){
  const full=row.candles.map(([ts,open,high,low,close,volume])=>({ts,open,high,low,close,volume,volumeCcy:0,confirmed:true}));
  const candidates=[.2,.5,1].map(buffer=>({buffer,qualified:0,rewardRejected:0,stopped:0,target:0,timedExit:0,ambiguous:0,sumNetR:0})),seen=new Set();
  for(let i=Math.max(120,full.length-128);i<full.length-8;i++){
    const candles=full.slice(0,i+1),last=candles.at(-1),market={source:"okx-public-spot",instId:"BTC-USDT",bar:row.frame,candles,summary:summarizeCandles(candles),fetchedAt:new Date(candleCloseTime(last.ts,row.frame)).toISOString(),ticker:{instId:"BTC-USDT",last:last.close,open24h:0,high24h:0,low24h:0,vol24h:0,volCcy24h:0,change24hPct:0,ts:String(last.ts),priceCurrency:"USDT"}};
    const report=prepareGlobalReport({market,tier:"base"}),a=assessGlobalReport(report,market);
    if(a.state!=="technical_valid"||!a.permittedEntry||a.observedStop===null)continue;
    const key=JSON.stringify([a.side,a.retestTs,report.tradePlan.triggerLevelId,report.tradePlan.invalidationLevelId]);if(seen.has(key))continue;seen.add(key);
    const sign=a.side==="long"?1:-1,entry=full[i+1].open,target=a.targets[0],atr=report.indicators.atr.points.find(p=>p.ts===a.retestTs)?.value;
    if(!atr||entry<a.permittedEntry[0]||entry>a.permittedEntry[1])continue;
    for(const c of candidates){
      const stop=a.observedStop-sign*(c.buffer-.2)*atr,risk=sign*(entry-stop),reward=sign*(target-entry),cost=entry*.002;
      if(risk<=0||reward<=0||(reward-cost)/(risk+cost)<1.5){c.rewardRejected++;continue;}
      c.qualified++;let exit=full[i+8].close,reason="timedExit";
      for(const bar of full.slice(i+1,i+9)){
        const loss=sign===1?bar.low<=stop:bar.high>=stop,win=sign===1?bar.high>=target:bar.low<=target;
        if(loss||win){if(loss&&win)c.ambiguous++;reason=loss?"stopped":"target";exit=loss?stop:target;break;}
      }
      c[reason]++;c.sumNetR+=(sign*(exit-entry)-cost)/(risk+cost);
    }
  }
  results.push({frame:row.frame,uniqueTechnicalAttempts:seen.size,candidates});
}
fs.mkdirSync(".tmp/global-setup-validation",{recursive:true});
fs.writeFileSync(".tmp/global-setup-validation/stop-diagnostics.json",JSON.stringify({hypotheticalRoundTripCostBps:20,holdingBars:8,results},null,2));
const lines=["# Stop-policy diagnostics · 16 October 2026","","This is a bounded walk-forward sensitivity check on public BTC candles saved with the supplied reports. It does not validate a trading strategy or select an optimal stop.","","At each of the last 120 eligible prefixes per timeframe, only that prefix is used to calculate pivots, ATR, levels and confirmation. A qualifying attempt is counted once. The illustrative fill is the next bar's open if it is in the permitted range. All candidate stops clear the same observed structure; additional buffers widen the stop and cannot improve its risk ratio. The nearest obstacle is never skipped.","","Assumptions: 8 subsequent bars of holding; hypothetical aggregate costs of 20 bps; no live quote, latency, gas-account setup, balance or liquidity model. A bar touching both TP and SL is counted as SL. Fixed-horizon exits use the eighth bar's close. Candidate selection starts from attempts passing the current baseline, so results do not establish how a wider policy would select a different population. Overlapping exposures and overlapping timeframe data are not an independent portfolio backtest.","","| Frame | Buffer beyond structure | Qualified | Reward rejected | Stop / target / timed exit | Mean modeled net R |","| --- | ---: | ---: | ---: | --- | ---: |"];
for(const r of results)for(const c of r.candidates)lines.push(`| ${r.frame} | ${c.buffer} ATR | ${c.qualified} | ${c.rewardRejected} | ${c.stopped} / ${c.target} / ${c.timedExit} | ${c.qualified?(c.sumNetR/c.qualified).toFixed(2):"insufficient observations"} |`);
lines.push("","The sample covers one asset and a small, selected set of market histories. These counts are too limited and dependent to justify changing the default buffer to a supposed optimum. The implementation therefore preserves the declared 0.2-ATR reference buffer, makes observed protection clear both the actual retest and structural boundary, displays total risk in percent and ATR, and warns when the stop is inside one average bar range. A wider stop can turn an attractive gross ratio into No trade; confirmation does not fix that arithmetic.","","Before choosing a new default, use independently collected instruments/regimes, out-of-sample periods, execution-sized quotes and protection/fee behavior; evaluate adverse excursion, stop frequency, drawdown and expectancy. No live provider, model, payment, Telegram send or wallet transaction was used here.");
if(process.argv.includes("--write-docs"))fs.writeFileSync("docs/GLOBAL_SETUP_CALIBRATION_2026-10-16.md",lines.join("\n")+"\n");
console.log(JSON.stringify(results));
