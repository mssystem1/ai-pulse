# Global report direction and time audit

This follow-up concerns the October 24 reports captured at 19:36–19:40 UTC (23:36–23:40 Samara time). The earlier audit corrected consumed targets and chart viewport resets. It did not establish that the direction selector correctly evaluated the later rebound; its completion claim was too broad.

## Findings

The hourly short was selected from the primary trend assessment, derived from completed swings and moving averages, then mapped to an EMA pullback. The selector explicitly rejected an opposing local reclaim in a trend. The visible volume profile and footprint did not select that direction. Their October 21–22 window was historical evidence and could not confirm October 24 selling pressure.

The daily report retained daily history and a 4H execution study, but discarded already-fetched hourly candles and the current ticker. An older 4H breakdown could therefore determine the displayed setup without comparing it with a newer hourly recovery. Adding a future-test sentence did not correct that selection problem.

## Changes

Current reports retain a fresh timestamped quote and available completed intraday context separately from primary candles. The observation cutoff is selected after source loading, so quotes fetched during loading are not silently assigned to an earlier capture time. Stale/future quotes, unavailable frames and foreign venues cannot masquerade as current evidence. Saved technical reviews never fetch a replacement quote or rewrite the original source time.

Selection compares completed structural reclaims and primary-level recoveries rather than automatically vetoing a setup because it opposes a slower trend assessment. The chart heading follows the displayed setup side; the primary trend remains separately visible. Each selected setup explains its dated reaction, needs a new subsequent entry test and retains its primary horizon for protection and objectives. An observed bounce is not automatically a confirmed reversal of the daily or weekly trend. Weekly plans cannot reverse their macro assessment solely from a short intraday reclaim.

New current-feed profiles are restricted to the latest complete source day and a bounded age. Archive publication delays can leave current order flow unavailable. No candle-colored proxy, historical order book or liquidation map is fabricated. Existing saved profiles retain their actual dated window.

The chart clock shows current local date, time, seconds and UTC offset. Candle coordinates and source timestamps use UTC. PNG exports display the saved snapshot time with seconds, not an invented live export time. A clock tick does not regenerate an analysis or reset its viewport.

The audit includes 15m, 1H, 4H, daily and weekly, with 5m execution for the fast report. Regression checks inspect source chronology, both reclaim directions, horizon-specific prices, quote freshness and chart behavior. These are software and source checks; strategy backtests remain stopped and no performance claim is made.

The fast report also required a protection correction: a completed primary reaction followed by a later directional break can supply a newer invalidation than the distant session low. Its actual candle and timeframe remain recorded. All horizons load available 5m/15m/1H context for freshness checks without turning those candles into primary daily or weekly history. Entry wording uses the captured quote's location relative to entry, while the completed execution reference retains its own time.

Validation passed: exact reconstruction of all three supplied reports from the deployed commit; thirty saved source snapshots across six assets and five horizons; 120 production browser cases in English/Chinese on desktop/mobile; and four actual viewport/clock cases for fast and weekly charts. Analysis 282, domain 37, web 204 and API 395 checks passed, with one Redis skip. The 39 affected API checks passed again after the final source/presentation change. The production build completed successfully.

The operator deploys manually after the reviewed local commit.
