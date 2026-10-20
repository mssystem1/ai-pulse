# Global report audit — 20 October screenshots, reopened 21 October 2026

The previous audit did not justify the daily entry at 80,400. It fixed the diagram and explained reward/risk using the old stop, but retained a rule that selected a range boundary by distance. That was insufficient. This revision supersedes that conclusion and includes a chronological, costed backtest of both rule sets.

The backtest does not establish a profitable strategy or a high win rate. See the [complete results, assumptions and reproducible data](backtests/README.md). Software correctness and a trading edge are separate claims.

## Issue 2: evidence for the daily entry

**There is no proof that BTC should fall from roughly 82,625 to 80,400 and then rally. There is also no proof that 80,400 was the best next entry.** The prior report selected the nearer primary range boundary when neither boundary had a qualifying reaction.

The exact screenshot cutoff was **2026-10-20 17:38:13.365 UTC**. The daily reference close was **81,943.80**, completed at October 20 00:00 UTC. The fresher completed 4H close was **82,610.40**, completed at October 20 16:00 UTC. Neither is a live quote; they describe different closing times.

| Observed structure | Candle opening time, UTC | Earliest knowable time, UTC | Meaning at the screenshot cutoff |
|---|---|---|---|
| Daily low 80,400 | October 8 00:00 | October 12 00:00 | Older support reference |
| Daily low 79,775.10 | October 15 00:00 | October 19 00:00 | Second low forming support band 79,775.10–80,400 |
| 4H high 82,291.10 | October 18 08:00 | October 19 00:00 | Nearer level reclaimed by the latest completed 4H bar |
| 4H low 80,680.50 | October 18 20:00 | October 19 12:00 | Earlier local low |
| 4H high 83,168.20 | October 19 04:00 | October 19 20:00 | Nearer confirmed resistance before daily 84,361.60 |
| 4H low 81,200 | October 20 00:00 | October 20 16:00 | Newer confirmed higher low |

Pivot confirmation requires three completed bars to the right. The latest completed 4H bar opened October 20 12:00, with open 81,503, low 81,319.20, high 83,439.90 and close 82,610.40. It reclaimed 82,291.10, but had not closed above 83,168.20. **There was no later completed 4H bar to establish a subsequent held retest.** Its spike high at 83,439.90 was not yet a confirmed 4H pivot.

The newer structure deserves consideration. It does not supply a confirmed buy merely because it is closer. For example, a hypothetical entry at 82,291.10 with protection below 81,200 has only about **0.80R** to intervening 83,168.20, before a stop buffer and costs. Using a farther daily target to hide that barrier would overstate the available reward. A later observed reaction might support different protection; its price and outcome cannot be invented in advance.

The old displayed 80,400–80,483.84 band was generated from the support edge plus a 0.1-entry-ATR allowance. Its stop, 79,691.25, came from the outer range boundary minus that allowance. Those precise numbers did not represent an observed entry reaction. The old 4.89R was hypothetical geometry, not a probability of profit or proof that price would visit the band.

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

Deploy updated **Vercel web first**, then the same revision to the existing **Railway API**. The new web accepts selector versions 1–4 and the explicit watch/barrier fields; the previous web does not accept version 4. Check /healthz and reload open tabs afterward. No environment-variable or storage migration is required.

Open a version-1/2/3 saved report and use **Review setup and targets · free** to apply this correction from its saved candles. Existing Telegram attachments remain historical copies. Both services need the update: Railway generates reports/exports; Vercel renders them and exposes the free review.
