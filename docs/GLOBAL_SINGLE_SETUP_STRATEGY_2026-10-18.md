# Global: one strategy, one setup — 18 October 2026

Historical design record. The [reopened October 20 audit](GLOBAL_REPORT_AUDIT_2026-10-20.md) supersedes proximity-based boundary selection, numerical watch entries/stops, clipped entry bands and unconfirmed trade projections. Use that audit and its backtest for the current rules.

This revision supersedes the dual LONG/SHORT presentation in the earlier [trade-plan audit](GLOBAL_BTC_TRADE_PLAN_AUDIT_2026-10-18.md) and [four paid reports audit](GLOBAL_BASE_BTC_REPORT_AUDIT_2026-10-18.md). It also retains every correction in the [target and processing incident](GLOBAL_TARGET_AND_RECOVERY_FIX_2026-10-18.md). No additional reports, model calls, payments or trades were needed for this review.

Each timeframe publishes **LONG**, **SHORT** or **SIDEWAYS**, one supported strategy and at most one setup. SIDEWAYS means a sideways market with one range setup, as clarified by the user. Insufficient evidence produces an explanation and unavailable entry fields rather than fabricated prices. Selecting a direction does not confirm entry.

## Selection before entry

`single-setup-v2` selects a strategy from completed primary candles before comparing entry reward. It stores its assessment, rule, selected path, side, evidence and limitations. The schema rejects additional published paths/routes or an entry inconsistent with the selection. Quick and Pro use the same selector and candidate universe. English and Chinese change prose, not selection.

1. **Range reaction:** requires at least four confirmed boundary anchors, a completed close within the outer boundaries, and no later completed boundary break after the range became knowable. Prefer an observed, unfailed edge reaction. Otherwise watch one lower support edge from the lower 40% or one upper resistance edge from the upper 40%. The central 20% supplies no preferred edge. A prospective edge watch is not a market entry: actual primary and entry-frame reaction/follow-through requirements still apply. The opposite boundary supplies an exit reference, never a second setup.
2. **Trend continuation:** confirmed higher highs/higher lows with price above a rising SMA55 select LONG; the inverse selects SHORT. The ten-bar SMA change measures slope. Price being above an average alone is insufficient.
3. **Confirmed structure break:** a close beyond both recent confirmed highs/lows, agreeing with the SMA55 slope and RSI momentum, can invalidate the previous pivot sequence before a new opposite sequence becomes confirmed. This is a transition hypothesis; a later retest and adequate reward remain mandatory. A still-opposing SMA21 is disclosed.
4. **Structural recovery/reversal:** confirmed directional structure, or a higher low plus a close above both recent confirmed highs (inverse for SHORT), must agree with price above/below a rising/falling SMA21 and RSI14 above/below 50. Opposing SMA55 is disclosed as a limitation; it is a reversal hypothesis rather than an established long-term trend.
5. **Unresolved structure:** do not manufacture a directional setup. Neither a larger opposite-side R multiple nor a nearby price can override the directional rules. Within the selected direction, prefer observed entry evidence, then recent structural confirmation.

Primary confirmation must precede the later entry-frame reaction or held retest. Entry protection, current price inside its band, compatible available higher context, signal freshness, sufficient reward to the first active target and an amount-specific quote remain separate gates. A current recheck blocks a changed strategy or consumed TP1; it does not silently switch the purchased direction.

| Analysis | Profile | Entry evidence |
|---|---|---|
| 15m | Fast | 5m |
| 1H | Intraday | 15m |
| 4H | Swing | 1H |
| 1D UTC | Position | 4H |
| 1W UTC | Macro | 1D UTC |

A range can support fast/intraday trading when its boundaries remain intact, reactions repeat and the first exit leaves room after spread, fees and slippage. A narrow range, an unresolved middle or a completed boundary break does not become an entry merely because it is called sideways. Longer timeframe ranges retain their own horizons; a weekly range is not automatically a scalp.

## Elliott context and projected moves

Historical swing labels remain visible. They are candidate patterns, with unverified internal subdivisions disclosed. In the reported weekly structure, a completed close reclaimed historical B at 82,842 after candidate C; the current description becomes a post-C recovery hypothesis. It neither claims a fully confirmed new Elliott impulse nor treats the old C label as a perpetual current downward forecast.

The chart restores **one dashed conditional move together with the selected setup**: last completed close → planned/observed entry → supported TP levels. Its horizontal spacing is schematic, without target dates, future wave labels, invented turning prices or a calibrated success probability. The same selected map supplies native chart annotations, PNG, entry inset, TXT and Telegram presentation. No projection is invented when entry/protection evidence is unavailable.

TP1 remains the nearest active confirmed exit barrier. A real nearby obstacle cannot be promoted away just to improve R:R. A confirmed unconsumed swing remains an exit barrier when also used as a Fibonacci measurement endpoint. Derived Fibonacci prices without a confirmed swing are not targets. Until a range entry has actual follow-through, its provisional SL protects the full known range boundary, rather than an inner minor pivot.

The exact daily LONG target defect is separately tested as internal candidate geometry: 82,473.60 was consumed, 84,361.60 becomes the first active resistance, 87,238.30 the next zone edge, and no supported third target exists. That forensic candidate is not published beside the newly selected daily SHORT strategy.

## Snapshot evidence and provenance

The reported daily snapshot `9d763a0a` was recovered through its existing authenticated capability. Its review is a separate artifact using the same saved candles; the purchased report remains unchanged. The reported weekly TXT/PNG `4c533748` were inspected. The earlier paid weekly delivery `3a514d22` retains matching completed weekly/daily/monthly evidence for this calculation: weekly close 83,760.40, SMA21 71,438.38, SMA55 80,573.35 and RSI14 59.46. Its offline review identifies that earlier source reference and fetch time; it does not impersonate the later original report.

| Evidence | Selected assessment | Strategy | Published setup |
|---|---|---|---|
| Earlier paid 1H | LONG | Structural recovery | One LONG; entry remains unconfirmed |
| Earlier paid 4H | SIDEWAYS | Range support reaction | One conditional floor setup |
| Reported daily | SHORT | Structural downward reversal | One SHORT; entry remains unconfirmed |
| Weekly completed evidence | LONG | Structural recovery after B reclaim | One LONG; falling SMA55 is disclosed |

These are historical software audit results, not current market instructions. Free **Review setup and targets** uses saved candles only and rebuilds the strategy and active target map, with a new artifact reference and deterministic explanation. The API route remains `/v1/global/target-review` for compatibility. Original model prose is not presented as newly generated AI analysis.

Reproduce offline with `node scripts/review-global-targets.mjs <saved-delivery.json> <output-directory>`. Public regression fixtures contain OHLCV only. Complete deliveries, recovery capabilities and wallet information remain in gitignored private files.

## Sources and limits

The implementation applies explicit PULSE research rules; it does not claim a universal TradingView strategy, a protected author's indicator or a profitable backtested system. Relevant primary educational pages were inspected:

- [TradingView: Moving averages](https://www.tradingview.com/support/solutions/43000502589-moving-averages/) explains lag, trend confirmation, slope and discretionary period choice. It does not mandate the selector's 21/55 periods.
- [TradingView: Relative Strength Index](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/) explains Wilder's RSI, its usual 14-period setting, momentum and interpretation limits. Its discussion references Wilder's *New Concepts in Technical Trading Systems* (1978); this audit does not claim to have read the entire book. RSI is supporting evidence, not a standalone reversal guarantee.
- [CME: Support and resistance](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance.html) explains historical levels, moving averages, trendlines and role changes after breaks. PULSE requires a newly confirmed interaction before reviving a consumed role.
- [StockCharts ChartSchool: Support and resistance](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance) explains ranges, zones, breakouts and the limitations of exact levels. PULSE's completed-close consumption rule is deliberately explicit and conservative; tiny breaks can be noise. The 0.20 ATR grouping, range fractions and exact invalidation rules are product choices, not prescribed by that guide.
- [TradingView: Long Position](https://www.tradingview.com/support/solutions/43000517002-long-position-drawing-tool/), [Fibonacci Retracement](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/) and [Parallel Channel](https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/) describe drawings and measurements, not an instruction to turn every historical pivot into a target.
- [Wiley: Alexander Elder, The New Trading for a Living](https://www.wiley.com/en-us/the-new-trading-for-a-living-psychology-discipline-trading-tools-and-systems-risk-control-trade-management-p-9781118443927) was checked at publisher-description level for its emphasis on systems, discipline, risk and trade management. The full book was not available in this session; this is not an implementation of its proprietary or complete trading system.

Attempts to fetch additional original Elliott educational pages failed. No inaccessible page is represented as reviewed. The implemented Elliott validation remains a limited swing-pattern hypothesis, with explicit hard-rule and look-ahead regression coverage. This work does not claim to have inspected every TradingView document or to have established a trading edge.

## Validation and release

The [fresh X Layer paid audit](GLOBAL_XLAYER_BTC_AUDIT_2026-10-18.md) records two defects found in the first live matrix and their free saved-candle corrections. Version 1 reports remain readable; version 2 reviews reconstruct discarded candidates from saved OHLCV without inventing ticker data or calling a model.

Coverage includes all five profiles, Quick/Pro and both languages; single assessment/path/route/card consistency; chart/entry inset/target prices; one conditional projection; weekly post-C recovery; range floor/ceiling/centre/break cases; directional selection independent of reward; immutable original reports; and a fresh recheck blocking a changed strategy. Existing archived numeric identity tests remain in place.

Recovery, worker ownership, graceful shutdown, progress animation, active-step scrolling, reduced motion and retained recovery access remain part of this change. README, main app docs, chart guide and generated historical guide images are updated. Validation results and local artifacts are recorded with the final source review. Production needs the API and frontend released together; no deployment was performed.
