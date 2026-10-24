# Audit of the deployed October 24 reports

The supplied 1H, 4H, daily and weekly reports were reconstructed from public OKX candles at their original UTC observation times. Entry, stop, objectives and reference closes matched the attachments before correction. The original attachments and source captures remain unchanged locally. These checks inspect report correctness, not trading performance. Strategy backtests remain stopped.

## Findings and corrections

| Finding | Evidence | Correction |
| --- | --- | --- |
| Zoom resets during inspection | Saved-report parsing creates a new object on parent refresh. The chart effect depended on that object and ran its initial reset again. | Equivalent evidence retains the native chart instance. Same-snapshot chart rebuilds retain time and manual price ranges. Indicator and Setup/Structure presets preserve the viewport. |
| Hourly TP already reached | At 17:22 UTC, primary close was 80,217.20 and the newer 15m close was 80,159.90. The old 79,775.10 target had already been reached by an intraday wick. | Keep the conditional EMA entry 80,510.72 and hourly SL 80,929.46; use the newer observed hourly low 79,220.10 as the first objective. Require a new post-snapshot 15m test. |
| Daily target behind newer price | Daily TP1 80,400 was above the 4H reference close 79,803.60 for a short. | Exclude it as a fresh downward objective. Retain the nearer 4H observed low 79,220.10 as an intervening level before the remaining daily objectives. Daily protection remains daily protection. |
| Four-hour targets skipped newer structure | The attached plan began at the older 75,559.50 objective despite the recent primary low at 79,220.10. | Include the recent primary extreme and keep current objectives within the selected horizon. Older archive references remain context. Do not force three targets. |
| Incomplete entry history ignored for consumption | A lower frame can have too little history for its studies while still containing a completed wick that reached an old level. | Use available, venue-matched completed observations for consumption and the newest reference close. Do not infer a confirmed entry from insufficient study history. |
| Text could contradict the chart | The prompt described entry-frame stop construction despite the displayed plan using primary-horizon protection. Historical text could call a displayed target “not a TP.” | Describe the supplied displayed plan, preserve its horizon and prices, and exclude active prices from context-only lists. Technical correction replaces stale model prose in the reviewed copy; the original retains it. |
| Intraday range named as a session | The 1H range began at the Monday week open. | Name it a week range. The fast chart retains its session reading. |

Historical levels can remain useful context. Their age alone does not make the candle feed stale. The attached 1H report used the latest completed 17:00 hourly and 17:15 execution closes available at its 17:22 snapshot. Its executed-volume profile separately covered October 21–22; that older profile is historical evidence, not live order flow or a historical order book.

The continued bearish assessment does not establish a new entry or prove the previous short was filled. A conditional pullback plan needs a new completed reaction after its snapshot, with objectives still ahead of the latest completed execution reference. A new future retest and the earlier completed decline are separate decisions. Targets identify confirmed swings, observed extremes, geometric range levels or VWAP bands according to their actual basis.

## Chart controls

Within the same open snapshot, polling, resizing, language changes, indicator switches, Reset studies and the Setup/Structure study presets preserve zoom and pan. Drag or pinch to inspect time and drag the price axis to adjust its scale. Axis double-click does not reset either view. **Reset view** restores the default time window and automatic price scale. **Full history** and **Show measured swing** explicitly fit the history requested by those controls. A different report snapshot starts its own view.

PNG exports remain complete report maps with the selected studies and saved prices; they do not copy temporary inspection zoom. Mobile uses **Inspect candles** for gestures. The [public chart guide](GLOBAL_REPORT_CHART_GUIDE.md), English/Chinese in-app guide and README explain these distinctions.

## Verification

The regression fixture preserves public completed candles for the attachments' original cutoffs. Target checks cover wick touches, newer lower-frame closes, incomplete lower-frame histories, distinct TP/SL horizons and non-mutating review of older plans. The browser negative control reproduces the original polling reset. Corrected desktop/mobile checks exercise actual wheel zoom, price-axis drag, polling, study presets, language changes, resizing and explicit Reset view. The production browser review also covers thirty saved snapshots across six assets and five timeframes, in English/Chinese at desktop/mobile sizes, with no remote requests, payments or orders.

These fixes require the operator's next deployment. Local commits do not update the deployed services.
