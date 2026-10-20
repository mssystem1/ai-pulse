# Global report backtest — BTC-USDT

These results do not establish a high win rate or a profitable strategy. They are a costed simulation of the deterministic research signals, not a simulation of live wallet execution. Baseline is commit 2125053; revised rules are the accompanying source changes. No parameters were optimized against these results. Every revised spot-long ledger that traded lost money in this sample; the revision does not establish a better entry model.

## Spot-long results

| Rules | Frame | Trades | Wins | Win rate | Profit factor | Net P&L | Net return | Close-equity drawdown |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 1H | 17 | 2 | 11.76% | 0.21 | $-833.14 | -8.33% | 8.33% |
| baseline | 4H | 7 | 2 | 28.57% | 0.79 | $-97.65 | -0.98% | 3.69% |
| baseline | 1D | 3 | 0 | 0.00% | 0.00 | $-279.60 | -2.80% | 3.19% |
| baseline | 1W | 1 | 0 | 0.00% | 0.00 | $-100.00 | -1.00% | 1.45% |
| revised | 1H | 15 | 1 | 6.67% | 0.10 | $-450.56 | -4.51% | 4.51% |
| revised | 4H | 8 | 1 | 12.50% | 0.31 | $-316.79 | -3.17% | 3.47% |
| revised | 1D | 4 | 0 | 0.00% | 0.00 | $-330.59 | -3.31% | 3.31% |
| revised | 1W | 0 | 0 | — | — | $0.00 | 0.00% | 0.00% |

## Hypothetical short results

| Rules | Frame | Trades | Wins | Win rate | Profit factor | Net P&L | Net return | Close-equity drawdown |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 1H | 20 | 5 | 25.00% | 0.76 | $-248.65 | -2.49% | 6.00% |
| baseline | 4H | 2 | 0 | 0.00% | 0.00 | $-199.00 | -1.99% | 1.99% |
| baseline | 1D | 2 | 1 | 50.00% | 2.28 | $99.89 | 1.00% | 0.88% |
| baseline | 1W | 0 | 0 | — | — | $0.00 | 0.00% | 0.00% |
| revised | 1H | 17 | 0 | 0.00% | 0.00 | $-808.29 | -8.08% | 8.33% |
| revised | 4H | 5 | 0 | 0.00% | 0.00 | $-233.17 | -2.33% | 2.33% |
| revised | 1D | 2 | 0 | 0.00% | 0.00 | $-121.64 | -1.22% | 1.22% |
| revised | 1W | 0 | 0 | — | — | $0.00 | 0.00% | 0.00% |

These short ledgers cannot be executed by selling unowned OKX Spot inventory. Borrow, funding, liquidation and derivatives basis are not modeled; short results are incomplete.

## Method

- Evaluation starts 2025-10-20 UTC and ends at the last complete available bar on 2026-10-20. The exact end differs by entry timeframe and is saved in each summary. Longer history is warm-up only. Recompute a report at every completed entry-frame bar: 15m for 1H, 1H for 4H, 4H for daily, and daily for weekly. Each frame receives at most its latest 520 completed candles.
- Public OKX OHLCV only, downloaded 2026-10-20T20:24:40.848Z. The compressed data archive is included. SHA-256 verification and 457 complete-day OHLC comparisons check data integrity and UTC aggregation. Candle history can contain later exchange revisions; no historical revision feed is available.
- Start each independent ledger with $10,000. Risk at most 1% of current equity per trade, cap exposure at 100% of cash, no leverage. Ledgers and overlapping timeframes are never pooled.
- Enter only after the report says technical_valid, at the NEXT candle's open with adverse 0.02% slippage, provided the filled price is inside the saved entry band. No filling at a historical low or at the signal candle's already-passed retest. Deduplicate successful entries by their observed signal.
- Charge assumed 0.10% per side; these are test assumptions, not a verified fee tier or a measured order-book spread. Freeze the observed stop and primary TP1. Close all units at the first stop or TP1. A candle touching both uses the stop. Stop gaps fill at the opening price; favorable target gaps get no improvement. No trailing stop, compounding between ledgers, or target switching.
- Final open positions are liquidated at the final close, charged costs, and identified separately from resolved win-rate samples. Drawdown is measured from entry-frame closing liquidation equity, not tick-by-tick or intrabar peaks. Next-open execution assumes immediate deterministic readiness; actual report/quote latency is not modeled.
- The test evaluates research-signal behavior. It does not assert that a live quote, token representation, balance, pass, owner authorization or order route would pass. The independent reconciliation counts recorded fills whose fee-adjusted reward would fail even a primary-TP1-only 1.5R quote gate. A nearer barrier can make the quote gate stricter. Those counts are diagnostic; do not reinterpret the table as the result of a separately backtested fee-gated strategy.

## Limits and decision

The rules have already been developed using historical BTC examples, including the supplied screenshots. This is a retrospective diagnostic with chronological inputs, not an untouched out-of-sample result. One instrument and small trade counts cannot establish a stable edge. The JSON results include Wilson 95% win-rate intervals, expectancy, exposure and missed next-open fills; zero trades has no estimated win rate or profit factor. The same-fill fee and risk calculations are reconciled independently for every trade. Wilson intervals assume independent trials; correlated trades can make them overconfident. The buy-and-hold context benchmark has different exposure and risk and is not evidence of strategy outperformance.

The report correctness fixes are useful independently of trading performance. Do not describe these rules as proven profitable or advertise a high win rate from this sample. Further strategy development needs a predeclared objective, untouched markets/periods and forward paper trading; changing stops or targets until this BTC history looks good would invalidate a performance claim.

## Reproduce offline

Build schemas, domain and analysis. Run, for each frame:

`node scripts/backtest-global-reports.mjs --label=revised --frame=1H`

Use 4H, 1Dutc and 1Wutc for the other frames. The default data is the included compressed archive; no network calls are made. For the baseline, use source commit 2125053 in an isolated checkout, build its packages, then run the same harness with `--label=baseline`. The harness is new in this revision and must be copied into that checkout along with the data loader, engine and archive. Compare the production-module SHA-256 hashes in the summaries. Run `npm run test:global-backtest` and `node scripts/summarize-global-backtest.mjs` to verify execution cases, source hashes and all exported fills.

[Machine-readable results](results.json) · [CSV](results.csv) · [Independent reconciliation](validation.json) · [Public-data archive](data/btc-okx-20261020.json.gz)
