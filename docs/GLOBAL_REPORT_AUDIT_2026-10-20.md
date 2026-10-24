# Global report audit Р Р†Р вЂљРІР‚Сњ 20 October screenshots, reopened 21 October 2026

## Current report behavior — 24 October 2026

The user clarified the active scope: [apply XO's documented methods to current markets](GLOBAL_XO_CURRENT_MARKET_SCOPE.md), generating fresh setups across supported assets and all five horizons. Strategy backtests and win-rate optimization remain stopped. The [original setup and management review](xo-published-setups/index.html) preserves eighteen publication versions, seventeen canonical posts and forty-four original image references as evidence for those methods. Generated PULSE setups use documented implementation assumptions; they are separate from XO's published trades or personal performance.

This document retains the original October 20 audit below. Its earlier signal-only display policy and release-version instructions are historical. The existing PULSE chart workflow is described in the [Global chart guide](GLOBAL_REPORT_CHART_GUIDE.md) and README. The timeframe table below describes the current PULSE calculations; it does not establish XO's undisclosed indicator settings or a universal strategy for each interval.

With usable market history, the report displays a concrete priced Entry/SL/TP scenario and the reaction required to execute it. Signal confirmation and actual fills retain their own evidence. A directional bias has its own meaning. Visible report titles omit the internal fingerprint.

The current selector uses observed structural context, location, held reclaim/retest evidence and primary-frame VWAP reactions. It no longer chooses sideways direction from the last entry candle's color. An obsolete historical pivot cannot override the current local sequence. Range rotation keeps geometric midpoint/quartile/opposite-edge objectives; a range breakout protects the broken boundary and can use objectives outside the former balance. An interior reclaim retains the opposite range boundary as a constraint. Primary-horizon invalidation follows its current confirmed structure rather than an arbitrarily nearer old pivot. Both primary and entry-frame obstacles remain available before TP1. Older conditional plans can receive an explicit v2 technical review from unchanged saved source data; confirmed canonical prices remain unchanged.

| Selected timeframe | Market reading and chart context | Entry study |
|---|---|---|
| 15m Fast | Session VWAP bands, session range and primary support/resistance | 5m |
| 1H Intraday | Week-open VWAP bands, intraday structure and primary levels | 15m |
| 4H Swing | Confirmed swing value, swing structure, available balance and primary zones | 1H |
| 1D Position | Multi-month swing VWAP bands, recovery/decline structure, current balance and daily zones | 4H |
| 1W Macro | Cycle-anchored VWAP bands, cycle extent, major decline/recovery legs and weekly zones | 1D |

Support/resistance zones use actual confirmed primary-candle wick/body boundaries. Cycle, decline and recovery references remain distinct from consolidation. A weekly view can preserve a major decline and the recovery that followed it; the cycle envelope does not replace either leg. Structural range boundaries, chronology and availability are validated against the saved primary pivots. Geometric intermediate levels remain distinct from POC/VAL/VAH, which require a supplied complete, venue-matched executed-trade window. The selected primary timeframe supplies its own protection and objectives; entry-study barriers retain their lower timeframe.

An additional chart audit found short-window POC/VAL/VAH lines extending across all earlier macro candles. The shared renderer now starts those references at the profile's own source window and removes the overlay when panning before it. A window newer than the completed primary history is shown only as compact recent context. This corrects source scope without changing profile prices, volume, setup selection or protection.

The retained BTC snapshot makes the difference inspectable: weekly cycle VWAP anchors on November 21, 2022, while daily recovery VWAP anchors on July 1, 2026. Weekly shows 260 of its 458 completed saved candles by default. Daily shows 260 of 520; 4H shows 180, and 1H/15m show 120. Full history and zoom preserve all available saved candles. A short listing history remains visible with its actual coverage.

For the daily entry issue, the 17:45 scenario uses the known 4H reclaim at 82,291.10, daily protection at 79,360.83, and daily objectives at 84,361.60 and 87,238.30. Its 4H reference close is 82,610.40, separately timestamped from the completed daily close of 81,943.80. A later defended test is required for execution. This late-day scenario incorporates newer 4H information than the earlier 80,400 scenario. A planned level describes a conditional trade; it does not predict a required trip down to that price.

Saved reports can receive a free technical review from their unchanged saved candles. Original snapshots retain their identity; confirmed canonical trade prices and signal state are preserved. Customer narrative inputs, native overlays and exported PNGs receive the same primary-horizon context and VWAP-band evidence.

Current verification passes 259 analysis, 37 domain, 203 web, 35 market and 394 API checks, with one Redis-dependent API skip. Production API and web builds pass. Public OKX snapshots captured on October 24 supply thirty priced setups across BTC, ETH, HYPE, SOL, BNB and XRP, each on 15m, 1H, 4H, daily and weekly. The rebuilt production UI passes 120 English/Chinese desktop/mobile cases with zero runtime errors, overflow or mutations. Four focused browser cases also verify the genuine profile example and source-window placement. These checks verify source handling, software and presentation; they do not establish profitability or XO's personal performance. Earlier financial experiments remain historical and stopped. The user handles deployment; no push or deployment is authorized here.

## Publication-cadence finding — 24 October 2026

The daily chart can retain the same completed daily candle while its entry study supplies new information. Replaying the [retained public-candle fixture](../packages/analysis/src/globalReport.oct20-fixture.json) at different observation times proves the distinction:

| October 20 observation, UTC | Completed daily close | Displayed conditional setup |
|---|---|---|
| 00:00 | 81,943.80 | Long at 80,400.00 |
| 04:00 | 81,943.80 | Long at 81,953.10 |
| 08:00 | 81,943.80 | Short at 82,556.60 |
| 12:00 | 81,943.80 | Short at 87,238.30 |
| 16:00 and 17:45 | 81,943.80 | Long at 82,291.10 |

This table records the earlier selector and is retained as a historical diagnosis, not the current v2 selection policy. These were conditional scenarios available at their stated observation times, rather than orders or reported fills. The later reclaim cannot justify an earlier entry. The original late-day report needed to account for its available 4H information; a once-daily publication policy observes a different setup sequence.

The historical baseline and entry-proximity studies explicitly publish at primary-candle closes. Their results apply to that schedule and do not establish performance for every on-demand report revision. The report cadence and within-range direction choices identified here remain implementation findings, not an instruction to resume replay. Historical study results and source records are preserved.

A subsequent on-demand experiment was stopped on the user's instruction with fifteen of thirty cases completed. Its captured runtime and partial evidence remain preserved. No automatic restart is authorized. The earlier publication-policy results remain unchanged and are not relabelled as XO trades or results of this incomplete run.

For the original daily-entry question, entry 80,483.84, stop 79,691.25 and TP1 84,361.60 imply approximately 4.89R. Buying instead at the user's approximate 82,625 with that same stop and target gives only 0.59R. This arithmetic explains the different payoff geometry; it supplies no evidence that BTC must first fall to the lower entry or that this entry is best. The original lower band was mechanically generated, not an observed reaction or an XO publication. Repositioning it near the latest price does not make it an XO copy trade. His [June 24 ETH original](https://x.com/Trader_XO/status/1937448336279105751) explicitly separates a value reclaim from a conditional pullback opportunity, while his [July 20 follow-up](https://x.com/Trader_XO/status/1947019929858756919) preserves macro bullish context and cautions about compressed late-entry reward/risk. The report must preserve those separate conditional decisions rather than draw a required path down and up.

## Historical audit and earlier research record

The sections below preserve the reasoning, earlier implementation decisions, historical artifacts and experiment outcomes from their stated dates. Current behavior is specified above.


The previous audit did not justify the daily entry at 80,400. It fixed the diagram and explained reward/risk using the old stop, but retained a rule that selected a range boundary by distance. That was insufficient. This revision supersedes that conclusion and includes a chronological, costed backtest of both rule sets.

The backtest does not establish a profitable strategy or a high win rate. See the [complete results, assumptions and reproducible data](backtests/README.md). Software correctness and a trading edge are separate claims.

The subsequent [deep strategy research](backtests/finalist-study/README.md) found a separate SOL 4H long/short futures candidate with 60/68 net wins (88.24%) and +2.29% aggregate net return on the reserved later period. Its recent profitability is weak and uncertain; it remains a paper candidate and does not validate the BTC setups in these screenshots. [All-trade review and charts](backtests/finalist-study/805e53eefdb5/review.html).

## Issue 2: evidence for the daily entry

**There is no proof that BTC should fall from roughly 82,625 to 80,400 and then rally. There is also no proof that 80,400 was the best next entry.** The prior report selected the nearer primary range boundary when neither boundary had a qualifying reaction.

The exact screenshot cutoff was **2026-10-20 17:38:13.365 UTC**. The daily reference close was **81,943.80**, completed at October 20 00:00 UTC. The fresher completed 4H close was **82,610.40**, completed at October 20 16:00 UTC. Neither is a live quote; they describe different closing times.

| Observed structure | Candle opening time, UTC | Earliest knowable time, UTC | Meaning at the screenshot cutoff |
|---|---|---|---|
| Daily low 80,400 | October 8 00:00 | October 12 00:00 | Older support reference |
| Daily low 79,775.10 | October 15 00:00 | October 19 00:00 | Second low forming support band 79,775.10Р Р†Р вЂљРІР‚Сљ80,400 |
| 4H high 82,291.10 | October 18 08:00 | October 19 00:00 | Nearer level reclaimed by the latest completed 4H bar |
| 4H low 80,680.50 | October 18 20:00 | October 19 12:00 | Earlier local low |
| 4H high 83,168.20 | October 19 04:00 | October 19 20:00 | Nearer confirmed resistance before daily 84,361.60 |
| 4H low 81,200 | October 20 00:00 | October 20 16:00 | Newer confirmed higher low |

Pivot confirmation requires three completed bars to the right. The latest completed 4H bar opened October 20 12:00, with open 81,503, low 81,319.20, high 83,439.90 and close 82,610.40. It reclaimed 82,291.10, but had not closed above 83,168.20. **There was no later completed 4H bar to establish a subsequent held retest.** Its spike high at 83,439.90 was not yet a confirmed 4H pivot.

The newer structure deserves consideration. It does not supply a confirmed buy merely because it is closer. For example, a hypothetical entry at 82,291.10 with protection below 81,200 has only about **0.80R** to intervening 83,168.20, before a stop buffer and costs. Using a farther daily target to hide that barrier would overstate the available reward. A later observed reaction might support different protection; its price and outcome cannot be invented in advance.

The old displayed 80,400Р Р†Р вЂљРІР‚Сљ80,483.84 band was generated from the support edge plus a 0.1-entry-ATR allowance. Its stop, 79,691.25, came from the outer range boundary minus that allowance. Those precise numbers did not represent an observed entry reaction. The old 4.89R was hypothetical geometry, not a probability of profit or proof that price would visit the band.

The earlier **0.60R at 82,610.40** calculation used the **same old stop and daily target**. That arithmetic is correct only for that geometry. It does not prove that a nearer setup with its own observed reaction and protection is impossible.

**Correction:** the daily report no longer publishes 80,400 as a selected entry. It retains the historical support/resistance map, explains the nearer 4H reclaim and barrier, and states that Entry and SL are not established. It draws no trade projection. [Corrected daily chart](previews/global-oct20-audit/1d-pro-en.png), [full report](previews/global-oct20-audit/1d-pro-en.txt), [timestamped candle/pivot evidence](previews/global-oct20-audit/1d-pro-en-evidence.json).

## All findings and corrections

| Finding | Cause and correction |
|---|---|
| 1H LONG had no target map | The strategy lookback removed older unconsumed resistance. Keep the nearest evidenced older barrier when local history provides no objective. In this hourly replay, primary TP1 is 83,858.20. Direction still does not authorize entry. |
| The previous fix forced a 4H boundary plan | Selecting the nearer edge in the middle of a range fabricated a trade preference. Remove proximity as a direction rule. Show the range, local evidence and missing reaction explicitly instead of an empty plan area or a manufactured approximately 24R plan. |
| A primary range vetoed other candidate families | Evaluate actual directional retest evidence as well as edge reactions. A bounded primary range remains context; it cannot automatically discard an observed compatible reclaim/retest. |
| Daily 80,400 entry lacked justification | Older support and a favorable hypothetical R multiple were insufficient. Publish observation references without claiming an Entry/SL until a real signal exists. |
| Entry bands could be clipped backward to achieve 1.5R | The current profile measures the observed band unchanged. If its worst entry has insufficient reward, block it. Do not claim an earlier/better fill merely because it meets a threshold. |
| Stops could include an unnecessarily older pivot despite a new reaction | Derive current observed protection from the actual reaction and structural zone plus the disclosed signal-time allowance. Do not publish numerical watch stops as observed protection. This is not a calibrated profitable stop model. |
| Nearer entry-frame barriers were ignored | Keep primary objectives, but also test the nearest confirmed, unconsumed entry-frame barrier. Retain its real timeframe and knowledge time. Insufficient first-barrier reward blocks entry; fresh assessment forwards that barrier to the quote cost gate. |
| Historical ATR allowance could be known before its candle closed | ATR lookup now requires its candle to have completed. Signal protection can use the signal candle after its close. A newly confirmed pivot can be used after that confirmation close. |
| Fresh assessment derived entry before refreshing primary evidence | Refresh pivots, SMA, RSI and hierarchy first. Preserve saved IDs for freshly reconfirmed identical pivots so saved level references remain valid; do not preserve invalidated pivots. |
| Unconfirmed and blocked plans still drew target arrows | Draw a trade projection only for a technically confirmed current entry. Watch/unavailable setups show explicit status and observation references. |
| Reports could deny an already observed retest when price left its band | Distinguish historical retest evidence from current eligibility. A retest can be observed while price or reward still blocks entry. |
| Report title contained a hashtag and code | Remove the internal fingerprint from customer titles, captions and prose. Retain internal identity and file traceability. |
| Missing setups could lose their explanation | Include completed-price references, status, missing evidence and observation map across web, Telegram, chart and text. |
| Footer words split across lines | Wrap English at word boundaries so the evidence explanation stays readable. |
| Existing reports retained older rules | Version-4 free review reconstructs candidates from the same saved candles. Original purchased reports remain immutable. No new model, payment or market call is needed for review. |

The 0.1-ATR allowance, 1.5R research threshold, primary-frame gate and active-zone consumption rules remain explicit research heuristics. A consumed level needs new pivot evidence before re-entering the active-target map. These are not universal trading truths or validated performance claims. A new confirming candle cannot cure inadequate reward; a tighter stop must be supported by a real reaction.

## Backtest and independent checks

The [backtest report](backtests/README.md) includes previous commit **2125053** and this revision. Public BTC-USDT history is replayed with only completed candles available at each decision. Evaluation covers approximately one year, with earlier history for warm-up. It evaluates every entry-frame close, enters at the next open inside the reported band, freezes SL and primary TP1, applies fees/slippage, and handles ambiguous candles pessimistically.

This tests deterministic research signals. It does not reproduce live wallet execution, fee-tier eligibility, quote routing, authorization, funding or order-book liquidity. Fee-adjusted live quote gates can reject additional candidates; diagnostic counts are reported separately. Short simulations are hypothetical and cannot authorize unowned Spot sales.

The compressed history is under 1 MB. Source hashes, trade logs, win-rate intervals, expectancy, fees, exposure, net return and closing-equity drawdown are exported. Every logged entry/exit and fee is independently reconciled to raw candles. The initial trade-log serializer overwrote its entry-price field with the exit price; reconciliation normalizes those logs using both the raw next-open fill and its independently recorded entry fee. P&L was computed from the original position before serialization and is unchanged. The serializer is corrected and regression-tested.

No threshold was tuned to improve the displayed results. This history already influenced development, so it is **not an untouched out-of-sample test**. Small samples, one instrument and correlated trades cannot establish a stable high win rate or P&L. The changes fix unjustified claims and evidence handling; they do not certify profitability.

## Artifacts and validation

- [Hourly chart](previews/global-oct20-audit/1h-pro-en.png), [4H chart](previews/global-oct20-audit/4h-pro-en.png), [daily chart](previews/global-oct20-audit/1d-pro-en.png), [weekly chart](previews/global-oct20-audit/1w-pro-en.png)
- [Sixteen export cases](previews/global-oct20-audit/validation.json), [desktop/mobile browser results](previews/global-oct20-audit/browser-validation.json), [release checks](previews/global-oct20-audit/release-validation.json)
- [Backtest method and results](backtests/README.md), [results JSON](backtests/results.json), [CSV](backtests/results.csv), [independent reconciliation](backtests/validation.json)

Run the two audit-global-oct20 scripts after building the affected packages. They check all four frames in Quick/Pro and EN/ZH, including 32 desktop/mobile cases, with remote application requests blocked. They validate rendering and state consistency; they do not establish a trading edge.

The original purchased JSON payloads were not supplied. Reconstruction uses public candles at each image's exact cutoff and matches the primary closes, without claiming to reproduce original artifact fingerprints. [OKX's official history documentation](https://www.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks-history) describes the response and confirmation flag.

## Manual deployment

The user authorized a local commit and will deploy manually. No push or deployment is part of this work.

Deploy updated **Vercel web first**, then the same revision to the existing **Railway API**. The new web accepts selector versions 1Р Р†Р вЂљРІР‚Сљ4 and the explicit watch/barrier fields; the previous web does not accept version 4. Check /healthz and reload open tabs afterward. No environment-variable or storage migration is required.

Open a version-1/2/3 saved report and use **Review setup and targets Р вЂ™Р’В· free** to apply this correction from its saved candles. Existing Telegram attachments remain historical copies. Both services need the update: Railway generates reports/exports; Vercel renders them and exposes the free review.

## Subsequent asset-specific research

The user authorized separate strategies for BTC, ETH, SOL, HYPE and additional assets, including long/short futures research. This does not justify restoring the unsupported daily 80,400 entry or publishing a trade whenever a chart has a directional bias. The original evidence/correctness fixes remain separate from profitability claims.

The [asset-specific study](backtests/asset-study/README.md) tests 3,804 declared alternatives across six assets and two recorded versions, with independent accounting/path reconciliation and an [offline trade review](backtests/asset-study/runs/969d76fe1058/review.html). BTC's separately selected 4H range model exceeds 70% observed wins but fails higher-cost profitability. SOL's trend-reversion model has 49/52 net wins and +4.82% baseline return; its highest-cost 2026 contribution remains negative. ETH, HYPE, BNB and XRP have no development-qualified replacement after the additional revisions. These reused historical dates do not establish durable future >70% wins.

Rules remain editable and may differ by asset. No new model has been promoted to production reports, and no new commit, push or deployment was made during this research continuation. The earlier local commits contain correctness fixes and failed-strategy evidence, not certification of the requested win rate.

Further [multi-stage entries](backtests/asset-confirmation-study/README.md) and [managed exits](backtests/managed-exit-study/README.md) retain separate asset rules. New pattern hypotheses remain unqualified. The selected managed SOL variant reaches 43/53 net wins (81.13%), with 9 breakevens, 1 loss and +5.17% baseline return; highest-cost 2026 performance remains negative. Its [offline review](backtests/managed-exit-study/runs/93821f4c7196/review.html) shows actual 15m execution candles and each recorded stop change. These results do not justify restoring the unsupported daily 80,400 plan or claiming future >70% wins. The combined targeted suite has 53 passing tests; no further commit or deployment was made.

The [22 October continuation](GLOBAL_STRATEGY_RESEARCH_2026-10-22.md) now records a persistent active goal, prospective SOL tracking and 75 passing research tests. A HYPE-specific futures refinement reaches 144/183 net wins (78.69%) and +5.28% at the baseline fee/slippage scenario, but loses at higher costs and remains conditional research. Its [actual-trade charts](backtests/ml-profit-floor-refinement/runs/452a8e713789/review-later.html) retain every loss and distinguish decision conditions from actual fills. This is not validation of OKX Spot reports or a reason to restore the unsupported daily entry. Current execution-precision checks, prospective evidence and other assets remain unfinished; no new model, commit, push or deployment is promoted by this result.

The subsequent [precision audit](backtests/execution-precision/README.md) preserves HYPE baseline 78.69% net wins and +5.15% after conservative stop/quantity grids and an additional adverse tick per side; higher-cost profitability still fails. All 81 ledgers/11,836 records reconcile and the research suite has 82 passing tests. A separate HYPE paper window begins 22 October at 10:15 UTC with no future trades yet. These futures results do not prove the original BTC daily entry or justify forced setups. The report correctness fixes remain intact; no further commit or deployment has been made.

The [monthly retraining continuation](backtests/ml-rolling-study/README.md) retains 432 additional failed development variants across all six assets; high observed win rates still fail after-cost return/risk gates. Independent replay checks 71,217 records and the combined suite now has 84 passing tests. No new report strategy, local commit or deployment is promoted by this research.

The [exact-exit hourly research](backtests/ml-exact-exit-study/README.md) aligns model labels with actual proposed exit/precision rules, retains 432 failed development variants and reconciles 61,361 portfolio records. The combined research suite passes 89 tests. The user explicitly requires [separate TP/SL validation by timeframe](GLOBAL_TIMEFRAME_RESEARCH_POLICY.md); these 1H results cannot be presented as validated 4H/daily/weekly setups. Original report correctness fixes remain intact.
