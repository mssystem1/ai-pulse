# Global reports: strategy validation and the >70% requirement

The user's acceptance target is **strictly more than 70% winning setups with meaningful risk management**. This target has not been achieved. The report rendering/correctness audit and the search for a profitable trading strategy are separate deliverables. Fixing a chart, identifying a trend or finding a historical support cannot establish an entry's win probability.

## Existing report rules fail the target

The production-rule diagnostic in [the backtest record](backtests/README.md) found revised Spot-long win rates of 6.67% (1H, 1/15), 12.50% (4H, 1/8) and 0% (daily, 0/4). Weekly had no entries. Every revised long ledger that traded lost money after modeled costs. These small samples do not estimate a stable future rate, but they certainly do not validate a >70% claim. A local commit containing correctness fixes does not certify a profitable strategy.

The earlier daily 80,400 entry was an old support reference selected without an observed qualifying reaction. There was no evidence that BTC had to return there before rising. It was removed as the selected entry; the [audit](GLOBAL_REPORT_AUDIT_2026-10-20.md) gives the exact timestamped daily and newer 4H evidence. The earlier claim based on reusing the old stop at the current price did not rule out a new nearer setup with its own observed protection.

## Additional mechanical strategies tested

The new [strategy study](backtests/strategy-research/README.md) tests three families on the same four report/entry-frame mappings:

| Family | Market condition | Observed setup required | Protection |
|---|---|---|---|
| Trend pullback | Primary close/EMA21 above rising EMA55 | Bullish reaction at entry EMA21, then a separate later close above the reaction high | Reaction low minus 0.15 entry ATR |
| Breakout retest | Primary trend compatible with an upward transition | Close above the previous 20 entry-bar highs, a later held retest, then a separate confirming close | Retest reaction low minus 0.15 entry ATR |
| Range rejection | Primary ADX below 22, no primary downtrend | Rejection of the prior 20 entry-bar lower boundary, then a later close above the reaction high | Reaction low minus 0.15 entry ATR |

Each family has a core rule, a higher-timeframe filter and a stricter volume/RSI filter, tested with 1.75R and 2.5R nominal targets: **18 candidates per report frame, 72 frame/candidate combinations**. EMA and Wilder-style smoothing use only completed inputs; values are initialized at the start of the archived series and require warm-up. The strict volume/RSI condition applies while the candidate progresses as well as at confirmation; it is deliberately restrictive. These are new research candidates, not a replacement production selector.

Every candidate has the same execution rules:

- Earliest entry is the next open after the confirming close, with adverse slippage; the fill must remain inside the declared band. Historical low fills are forbidden.
- Target and stop freeze before entry. A nearer confirmed, unconsumed entry/primary resistance caps the objective. Range targets also cannot exceed the observed opposite edge. No farther target can hide a closer obstacle.
- The **actual filled** net reward to net stop loss must be at least 1.5 after assumed 0.10% fees and 0.02% adverse slippage per side. Those costs are assumptions, not a verified account tier.
- One position in each independent $10,000 Spot-long cash ledger, no leverage, modeled loss budget at most 1% of equity, cash exposure at most 100%. No position sizing can increase the owner's actual risk limits because these simulations place no orders.
- Pause new entries after a 3% UTC-day marked-equity loss and for four entry bars after a loss. The daily rule is a pause threshold, not a guaranteed maximum loss: the trade that crosses it, existing positions and gaps can exceed it.
- Exit all units at the frozen stop/target; stop first if an OHLC candle touches both. Exit after 48 entry bars otherwise. A profitable time exit counts as a net win, with its smaller realized reward included; full-target hits are also reported separately.

This bounded study found **no candidate eligible for selection from training and validation**. Six final-period ledger trades across alternative candidates are far too sparse to establish the requested rate; some are duplicate events under related filters. A displayed 100% from one winning trade is not evidence of a 70% strategy. Most candidates fail the entry cost/reward gate or lack sufficient completed setups. All 72 candidates, including failures and zero-trade cases, are retained. Across all three partitions there were 33 simulated ledger trades; they are not 33 independent market events or an investable combined portfolio.

## Qualification before making a performance claim

Win rate means **resolved trades with positive P&L after all modeled costs divided by all resolved trades**. Breakeven/losses after fees cannot become wins by relabeling them. Split-end liquidation has no target/stop resolution and is reported separately. Risk management controls exposure and loss severity; it does not guarantee a win probability.

The research acceptance policy requires:

1. More than 70% net wins in training and validation, at least 20 resolved trades in each, positive expectancy and profit factor, and realized mean win / mean loss of at least 1.5. Select using those partitions alone, then freeze the selection.
2. In the later evaluation period, at least 100 resolved trades, >70% net wins **and a Wilson 95% lower bound above 70%**, positive net P&L/expectancy, profit factor above one, realized payoff at least 1.5 and closing-equity drawdown at most 10%.
3. New independent/forward evidence before production promotion. This archive already influenced report development and earlier diagnostics. A chronological split of previously inspected data is not an untouched test. Wilson intervals also assume independent trials and do not correct for searching 72 correlated alternatives.

These are evidence requirements, not a promise that a strategy meeting them exists. For illustration, 70% wins at a fixed **net** +1.5R on every winner and -1R on every loser has arithmetic expectancy +0.75R per trade. That calculation is an assumed payoff model, not an estimated return from these rules. Smaller wins and rare larger losses can make even a high win rate unprofitable.

The trial registration records exact code and archive hashes before evaluating the new candidates, and selection code never reads final outcomes. Changing rules requires a clearly versioned new study. Searching until this same history yields 70% would not prove future performance; see [Bailey et al., The Probability of Backtest Overfitting](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253). The [CFTC's trading-system advisory](https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/fraudadv_tradingsystem.html) also explains limitations of hypothetical performance. No live win rate is established here.

## Verification and release scope

`npm run test:global-strategies` checks prefix invariance, delayed pivot knowledge, completed higher-timeframe inputs, the separate reaction/confirmation sequence, nearer barriers, next-open fills, costs, cash/risk bounds, split boundaries and selection isolation. `node scripts/verify-global-strategy-research.mjs` independently reconciles every recorded fill against the frozen raw candles, including P&L, timing, net reward/risk, drawdown and win counts. Source hashes and 457 complete-day OHLC comparisons pass.

For a fresh checkout, install dependencies and build `@pulse/schemas` before running the archive loader: `npm run build -w @pulse/schemas`. The four frozen JavaScript source files retain LF line endings through `.gitattributes` so Windows checkout conversion cannot invalidate their hashes. The strategy suite passes 9 tests, and the existing execution/data suite passes 7. The independent research replay checks 216 alternative ledgers and all 33 recorded ledger trades; no exit candle touches both its stop and target.

No candidate is promoted to the production report engine. Existing paid report generation, execution authorization and wallet policies are unchanged by the research tools. The earlier chart fixes are documented and committed independently. The user authorized local commits only and will deploy manually; no push, deployment, paid model call, wallet operation or live trade is part of this work.
