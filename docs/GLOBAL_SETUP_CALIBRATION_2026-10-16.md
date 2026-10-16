# Stop-policy diagnostics · 16 October 2026

This is a bounded walk-forward sensitivity check on public BTC candles saved with the supplied reports. It does not validate a trading strategy or select an optimal stop.

At each of the last 120 eligible prefixes per timeframe, only that prefix is used to calculate pivots, ATR, levels and confirmation. A qualifying attempt is counted once. The illustrative fill is the next bar's open if it is in the permitted range. All candidate stops clear the same observed structure; additional buffers widen the stop and cannot improve its risk ratio. The nearest obstacle is never skipped.

Assumptions: 8 subsequent bars of holding; hypothetical aggregate costs of 20 bps; no live quote, latency, gas-account setup, balance or liquidity model. A bar touching both TP and SL is counted as SL. Fixed-horizon exits use the eighth bar's close. Candidate selection starts from attempts passing the current baseline, so results do not establish how a wider policy would select a different population. Overlapping exposures and overlapping timeframe data are not an independent portfolio backtest.

| Frame | Buffer beyond structure | Qualified | Reward rejected | Stop / target / timed exit | Mean modeled net R |
| --- | ---: | ---: | ---: | --- | ---: |
| 1H | 0.2 ATR | 0 | 0 | 0 / 0 / 0 | insufficient observations |
| 1H | 0.5 ATR | 0 | 0 | 0 / 0 / 0 | insufficient observations |
| 1H | 1 ATR | 0 | 0 | 0 / 0 / 0 | insufficient observations |
| 4H | 0.2 ATR | 1 | 2 | 0 / 0 / 1 | -0.38 |
| 4H | 0.5 ATR | 0 | 3 | 0 / 0 / 0 | insufficient observations |
| 4H | 1 ATR | 0 | 3 | 0 / 0 / 0 | insufficient observations |
| 1D | 0.2 ATR | 1 | 0 | 1 / 0 / 0 | -1.00 |
| 1D | 0.5 ATR | 1 | 0 | 1 / 0 / 0 | -1.00 |
| 1D | 1 ATR | 1 | 0 | 1 / 0 / 0 | -1.00 |
| 1W | 0.2 ATR | 1 | 0 | 1 / 0 / 0 | -1.00 |
| 1W | 0.5 ATR | 0 | 1 | 0 / 0 / 0 | insufficient observations |
| 1W | 1 ATR | 0 | 1 | 0 / 0 / 0 | insufficient observations |

The sample covers one asset and a small, selected set of market histories. These counts are too limited and dependent to justify changing the default buffer to a supposed optimum. The implementation therefore preserves the declared 0.2-ATR reference buffer, makes observed protection clear both the actual retest and structural boundary, displays total risk in percent and ATR, and warns when the stop is inside one average bar range. A wider stop can turn an attractive gross ratio into No trade; confirmation does not fix that arithmetic.

Before choosing a new default, use independently collected instruments/regimes, out-of-sample periods, execution-sized quotes and protection/fee behavior; evaluate adverse excursion, stop frequency, drawdown and expectancy. No live provider, model, payment, Telegram send or wallet transaction was used here.
