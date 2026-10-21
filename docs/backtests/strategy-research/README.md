# Global strategy research — 70% acceptance target

**No production strategy is promoted by this research.** These are new mechanical candidate rules, not a rerun of the production report selector. The archive was previously inspected; the final partition is chronological evaluation, not untouched external proof.

## Rules declared before the run

- Three Spot-long families: trend pullback, breakout followed by a separate retest, and range-edge rejection. Each waits for a later confirming close, then can fill only at the next open within the saved entry band.
- Core, higher-timeframe-aligned and stricter volume/RSI filters; fixed 1.75R/2.5R nominal targets, capped by nearer known confirmed barriers (range entries also by the observed opposite range edge). All 18 variants are included, including failures.
- No entry unless reward after assumed fees (0.10% per side) and adverse slippage (0.02% per side) is at least 1.5 times the modeled net stop loss. Stops use the observed reaction low minus 0.15 entry ATR; no widening after entry.
- Separate $10,000 cash ledgers, 1% modeled risk cap, 100% cash cap, no leverage. Pause entries after a 3% UTC-day equity loss; four entry candles cooldown after a loss. Gaps may exceed the modeled risk budget.
- All-out frozen stop/target; ambiguous OHLC stop first; maximum holding time 48 entry candles, then exit at that close. Time exits count as wins only if net positive; full-target hit rates are reported separately. Split-end liquidations are excluded from resolved win rate.
- Only completed candles; confirmed pivots need three right candles. No reaction, outcome or position crosses a split boundary. No future retest fill, future pivot or report-time price is substituted for execution.

## Acceptance

A candidate needs >70% net wins in both training and validation with at least 20 resolved trades in each and positive expectancy/profit factor; selection is frozen before final evaluation. Final acceptance also needs at least 100 resolved trades, a Wilson 95% lower bound >70%, positive net P&L/expectancy, profit factor >1, realized mean win / mean loss >=1.5 and closing-equity drawdown <=10%. These are research acceptance rules, not estimates of attainable future performance. A passed result on this reused archive would still require independent evidence and forward paper trading.

Train: 2025-10-20–2026-04-20 UTC. Validation: 2026-04-20–2026-07-20. Final: 2026-07-20–last available completed candle on 2026-10-20. Each partition starts flat. Weekly evidence is intrinsically sparse.

| Report frame | Selected using train + validation | Final trades | Final wins | Final win rate | Final net return |
|---|---|---:|---:|---:|---:|
| 1H | None qualified | — | — | — | — |
| 4H | None qualified | — | — | — | — |
| 1Dutc | None qualified | — | — | — | — |
| 1Wutc | None qualified | — | — | — | — |

## All candidates — final diagnostic results

Results below cannot be used to select a strategy after inspecting this final partition. Overlapping candidate ledgers are alternative simulations, not independent trades or a combined portfolio.

| Frame | Candidate | Trades | Wins | Win rate | 95% interval | Realized payoff | Net return | Rejections |
|---|---|---:|---:|---:|---|---:|---:|---|
| 1H | trend_pullback-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | trend_pullback-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | trend_pullback-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | trend_pullback-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | trend_pullback-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | trend_pullback-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | breakout_retest-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | breakout_retest-core-2.5R | 1 | 1 | 100.00% | 20.65–100.00 | — | 1.83% | insufficient_final_trades, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | breakout_retest-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | breakout_retest-aligned-2.5R | 1 | 1 | 100.00% | 20.65–100.00 | — | 1.83% | insufficient_final_trades, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | breakout_retest-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | breakout_retest-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | range_rejection-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | range_rejection-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | range_rejection-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | range_rejection-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | range_rejection-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1H | range_rejection-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | trend_pullback-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | trend_pullback-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | trend_pullback-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | trend_pullback-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | trend_pullback-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | trend_pullback-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | breakout_retest-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | breakout_retest-core-2.5R | 1 | 1 | 100.00% | 20.65–100.00 | — | 1.33% | insufficient_final_trades, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | breakout_retest-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | breakout_retest-aligned-2.5R | 1 | 1 | 100.00% | 20.65–100.00 | — | 1.33% | insufficient_final_trades, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | breakout_retest-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | breakout_retest-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | range_rejection-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | range_rejection-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | range_rejection-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | range_rejection-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | range_rejection-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 4H | range_rejection-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | trend_pullback-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | trend_pullback-core-2.5R | 1 | 1 | 100.00% | 20.65–100.00 | — | 1.38% | insufficient_final_trades, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | trend_pullback-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | trend_pullback-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | trend_pullback-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | trend_pullback-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | breakout_retest-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | breakout_retest-core-2.5R | 1 | 0 | 0.00% | 0.00–79.35 | — | -1.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | breakout_retest-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | breakout_retest-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | breakout_retest-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | breakout_retest-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | range_rejection-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | range_rejection-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | range_rejection-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | range_rejection-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | range_rejection-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Dutc | range_rejection-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | trend_pullback-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | trend_pullback-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | trend_pullback-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | trend_pullback-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | trend_pullback-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | trend_pullback-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | breakout_retest-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | breakout_retest-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | breakout_retest-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | breakout_retest-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | breakout_retest-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | breakout_retest-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | range_rejection-core-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | range_rejection-core-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | range_rejection-aligned-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | range_rejection-aligned-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | range_rejection-strict-1.75R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |
| 1Wutc | range_rejection-strict-2.5R | 0 | 0 | —% | — | — | 0.00% | insufficient_final_trades, win_rate_target_failed, win_rate_uncertainty_too_large, positive_net_edge_not_established, realized_reward_risk_failed |

## Limits and reproduction

One instrument, about one year, assumed costs, overlapping candidates and sparse higher-timeframe trades cannot establish future win rate. OHLC execution assumes prompt readiness, no order-book constraints, no partial fills and no measured report latency. Daily risk pauses cannot prevent overnight/intrabar gaps. Closing-equity drawdown omits intrabar peaks. The win interval assumes independent trials and does not correct for all 72 tested frame/candidate combinations. No live orders, wallets, payments or model calls are used.

Run `npm run test:global-strategies`, then `npm run research:global-strategies`. Registration freezes source/data hashes; changing rules requires an explicit new study version. Run `node scripts/verify-global-strategy-research.mjs` for independent fill, cost, target, timing and selection reconciliation.

[Frozen registration](registration.json) · [All splits JSON](results.json) · [All splits CSV](results.csv) · [Every simulated trade](trades.json)
