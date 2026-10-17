# Global setup methodology and language review

17 October 2026. Historical research and implementation plan, revised after the user's rejection of dominant WAIT headings. This supersedes the presentation recommendations in `GLOBAL_REPORT_CLARITY_AUDIT_2026-10-17.md`. Implementation and final validation are recorded in [the implementation audit](GLOBAL_SETUP_IMPLEMENTATION_VALIDATION_2026-10-17.md). Findings and deferred-test statements below describe the planning stage, before that implementation.

## Recommendation

Rebuild the report around a named LONG or SHORT setup, its entry condition, its stop basis and its targets. Show whether the entry condition has occurred in an ordinary sentence. Remove WAIT, INVALIDATED, EXPIRED and NO TRADE as prominent chart/report labels. Keep historical failures in a collapsed history record.

The correction must also address the planner. Replacing WAIT with LONG on every retained bullish candidate would leave rejected trades looking actionable. A directional scenario, a valid prospective setup, a confirmed signal and an executed position need separate representations.

Use a documented PULSE method with explicit setup families. Do not claim that generic pivots, RSI and an ATR buffer reproduce Vilarso PRO. TradingView's charting and drawing tools provide a useful presentation model; they do not select PULSE's strategy parameters.

No new paid reports, model calls, BTC trades or Telegram sends were made for this research. Four local payment quotes were inspected without signing; they were not purchases. The earlier authorized four-report paid regression is deferred while this methodology is revised.

## Research coverage and limits

Reviewed the accessible written Vilarso PRO presentation, settings, alerts and strategy instructions; its TradingView description and release notes; the author's public BTC scenario example; Vilarso Trend's description; TradingView's position tools, technical ratings, multiple-timeframe, repainting, Fibonacci and Elliott guidance; and CME/Schwab trading education. Author-linked TradingView video pages were inaccessible to the browsing tool. Some Telegram videos require its client. Private lessons, proprietary script code and an exhaustive video archive were not available. This is not a claim to have reviewed every Vilarso lesson or every TradingView document.

The sources support presentation and methodology principles. They do not establish profitable parameter values for PULSE or validate its current fixed constants.

| Primary source | What it establishes for this review |
| --- | --- |
| [Vilarso PRO description](https://www.tradingview.com/script/G6hpaqTy-vilarso-pro/) | A distinct indicator using price averages, volume, volatility and candle behavior; active, standard and longer-horizon settings. Open-bar signals can disappear. The script is invite-only. |
| [Author's public instructions](https://t.me/s/vilarsopro?q=%23VilarsoPro) | BUY/SELL alert vocabulary, configurable behavior and timeframe selection. An alert prompts assessment rather than an immediate order. The author discusses supplementary SMA, regression and pivot studies. |
| [Author's BTC example](https://t.me/s/VilarsoPro?before=56) | Opposing wave scenarios tied to a key level: upward impulse above it, downward correction below it. |
| [Vilarso Trend](https://www.tradingview.com/script/c9nPoO7m-vilarso-trend/) | A separate protected oscillator with its own parameters, zones and fast/slow average interpretation. PULSE's RSI is not this indicator. |
| [TradingView Long/Short tools](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/) | A prospective position can display entry, stop, profit objective, quantity and R:R before an actual order. The drawing itself is not evidence of a fill. |
| [TradingView Technical Ratings](https://www.tradingview.com/support/solutions/43000614331-technical-ratings/) | Buy/Sell/Neutral are technical classifications. Their existence does not establish an entry, a stop or an executed trade. |
| [TradingView multiple timeframes](https://www.tradingview.com/support/solutions/43000591555-leveraging-multi-timeframe-analysis/) and [repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/) | Broader context and developing versus confirmed values must be identified. Historical charts can conceal information that was unavailable in real time. |
| [TradingView Elliott tools](https://www.tradingview.com/support/solutions/43000653212-elliott-wave-theory-and-tools/) | Pattern rules include internal structure and nesting. Its automated pattern tool is not simply three alternating pivots. |
| [Fib retracement](https://www.tradingview.com/support/solutions/43000585089-auto-fib-retracement/) and [Fib extension](https://www.tradingview.com/support/solutions/43000612397-auto-fib-extension/) | Retracement uses a measured two-point swing; Trend-Based Extension uses three points, including the retracement endpoint. |
| [CME support/resistance](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance) | Price levels are trading areas, not guaranteed penny-precise boundaries; broken support/resistance can change roles. |
| [CME position sizing](https://www.cmegroup.com/education/courses/trade-and-risk-management/proper-position-size) | Select a logical stop and size the position around the intended cash risk. Ordinary movement should be considered when placing protection. |
| [Schwab swing trades](https://www.schwab.com/learn/story/ins-and-outs-swing-trade) | Bounce and breakout are distinct entry approaches, with stops tied to the relevant support/resistance structure. |

## What the code audit found

### 1. The report and execution assessment use different entry definitions

`packages/domain/src/globalTradePlan.ts` creates a planned entry allowance of `min(0.05 × ATR, 0.25 × first-objective distance)`. `globalDecision.ts` blocks a confirmed signal if the snapshot close is outside that narrow band.

`packages/analysis/src/globalAssessment.ts` derives a different permitted band from the observed stop and the 1.50R condition. `globalOrderReview.ts` tests the quote against that second band.

A reproducible synthetic fixed-map diagnostic found:

| Same completed-candle evidence | Report | Fresh assessment |
| --- | --- | --- |
| Last close | 100.40 | 100.40 |
| Entry range | 100.00–100.0492 | 100.00–102.6774 |
| Completed confirmation and later test | Observed | Observed |
| Result | WAIT; entry-price blocker | Technically valid; no blockers |

This proves inconsistent eligibility, not that the wider range is the correct trading zone. A reward-derived maximum entry alone can also allow chasing. Both readers need one strategy-specific price zone intersected with the reward-constrained range and current quote requirements.

Reproduction: `.tmp/global-methodology-diagnostics.mjs`; evidence: `.tmp/global-methodology-research-2026-10-17/diagnostics.json`. Synthetic fixture, no network, no performance claim.

### 2. Every setup is forced through a very similar two-test rule

`globalConfirmation.ts` requires either a crossing close, a support hold or a rejection, followed by another touching/holding test. It allows three completed bars after confirmation for that retest and two bars after the retest for entry. These are PULSE policy constants. They are not a universal rule in the reviewed sources.

The consequence is especially visible on weekly charts: a weekly support test plus another weekly test can take weeks, while the report is presented as a way to find a current trade. A breakout, a reversal from support and a pullback continuation should not silently share the same event sequence.

Keep completed-bar evidence for a confirmed signal, but make the required event sequence and its expiry specific to the named setup. A quote's short validity period is a different concern from a market setup's structural life.

### 3. Stops and entry widths are mechanically narrow in some plans

The planner places a reference stop 0.2 ATR beyond the selected invalidation level. For a resistance rejection where trigger and invalidation coincide, the worst entry-to-stop distance becomes roughly 0.25 ATR. The saved October 17 reports show exactly that pattern.

| Supplied frame | Risk per BTC at worst planned entry | Distance as % of entry | Distance in selected-frame ATR | First-target gross R |
| --- | ---: | ---: | ---: | ---: |
| 1H | 82.50 | 0.101% | 0.250 | 1.82 |
| 4H | about 225.16 | 0.273% | 0.250 | 6.57 |
| 1D | 1,651.55 | 2.024% | 0.748 | 0.41 |
| 1W | 3,769.19 | 4.533% | 0.603 | 1.58 |

These are planning distances, not observed stop-order executions. A stop below one ATR is not automatically wrong; there is also no justification for requiring every stop to exceed one ATR. The issue is that its location must follow the actual setup, its entry timeframe and the swing/rejection that makes the idea wrong. A constant offset alone does not establish that.

The protective stop for an observed test already uses that test's extreme in assessment. Its explanation and the planning reference need to share a clear basis. Stop placement must not be squeezed to manufacture an attractive R:R, or widened without reconsidering quantity and targets.

### 4. Context, setup and entry timeframes are conflated

The requested chart timeframe currently determines the confirmation and retest timeframe. A 1W analysis therefore becomes a weekly-entry strategy. A professional report can instead use weekly structure for context and a separately named daily entry setup.

Proposed entry-refinement defaults for evaluation, not new live strategy claims:

| Requested analysis chart | Broader context | Separately labeled entry study |
| --- | --- | --- |
| 1H | 4H / 1D | 15m |
| 4H | 1D / 1W | 1H |
| 1D | 1W | 4H |
| 1W | 1M / 1D | 1D |

The requested chart remains the primary chart. The entry study needs its own actual candles, source, session, close time and marked inset/detail view. This mapping is a proposed PULSE design choice, not a Vilarso/TradingView mandate. No silent substitution and no lower-frame signal without its data. Primary-timeframe entry can remain an explicitly selected strategy.

The current draft's shared UTC hierarchy is useful and should be retained. Universal rejection of any opposing higher frame needs a setup-specific policy: a countertrend bounce is different from a trend-following entry. Initially keep current execution protections until any alternative is replayed and evaluated; show the conflict as context rather than suggesting every timeframe must agree.

### 5. Candidate selection remains a heuristic

The draft now evaluates visible candidates before narration. Its ranking still uses fixed scores for geometry, failure, context and confirmation. It does not establish a measured trading edge, and an acceptable opposite candidate should not silently change the market view.

Select from recognized setup families within a named regime. Record why a candidate was selected and why the other direction is secondary. A rejected long must not automatically become a short. An old failed entry must not reverse the underlying directional view by itself.

### 6. Some plotted targets are obstacles or remote context, not a trade's profit plan

The planner takes nearby pivot-derived levels, with a four-ATR locality filter. Earlier archive extremes stretched the chart; the draft already curates those out of the local map. An archive high such as 126,200 must remain long-horizon context unless a separately evidenced setup genuinely uses it.

Classify material zones by their structure and provenance. Display intervening resistance/support. The existing 1.50R nearest-obstacle rule is a conservative PULSE rule, not a universal professional standard. Preserve it until a different approach is evaluated. If introducing partial exits later, declare TP allocations and the weighted return after costs; do not skip the first obstacle just to display a larger ratio.

### 7. Elliott labels overstate what has actually been verified

`globalWaveCandidate` checks alternating pivots and some impulse geometry, and can choose a 1–2 or 1–2–3 hypothesis. It does not validate the nested subdivisions of the full Elliott model. A moving pivot pattern is useful structure evidence but is not equivalent to TradingView's complete pattern detector or the author's discretionary count.

Proposed display: solid observed swing legs; dashed potential next legs; a short plain-language statement of the candidate and the price that breaks it. Show main/subwave nesting only where actually checked. Keep the full structure view accessible when the setup crop hides earlier anchors. Show a level-based setup when the wave count is ambiguous instead of forcing decorative wave numbers.

### 8. Two-point projections are not TradingView's three-point Trend-Based Extension

Current retracements use an identified A→B leg and are mathematically recognizable. Current generated extension levels use `A + ratio × (B − A)`. That is a two-point measured-leg projection. It should not be presented as the same construction as a three-anchor Trend-Based Fib Extension.

For the latter, retain A, B and the observed retracement endpoint C; calculate projections from C using the signed A→B leg. Show anchors and orientation. Keep two-point projections explicitly named if retained. Do not invent C. Verify both directions and match the chosen linear/log convention before claiming agreement with a reference chart.

### 9. Charts hide useful plans or imply trades, depending on the status gate

The old renderer drew ENTRY and TP stages even for rejected or historical plans. The current draft removes all such geometry unless technically qualified. That avoids a false current entry, but is overly restrictive for a prospective plan: TradingView position drawings can legitimately illustrate a future entry.

Use three different visual objects:

| Object | Visual | Meaning |
| --- | --- | --- |
| Market scenario | Thin conditional route, support/resistance labels | Possible direction; no position implied |
| Valid planned setup | Dashed planned entry zone, planned SL/TP and R:R | Future entry with a named trigger; no fill implied |
| Confirmed entry signal | Time-stamped marker on the observed confirming bar | Signal observed; fresh quote and execution checks still apply |

An actual filled position needs an execution record. A saved report, signal or chart drawing must never claim that fill. Rejected geometry gets no risk/reward trade box. Old risk boxes go into history rather than dominating the current chart.

## Proposed terminology

The dominant title names direction and the trade pattern:

- **LONG SETUP · BUY THE PULLBACK**
- **LONG SETUP · BUY THE BREAKOUT**
- **SHORT SETUP · SELL THE REBOUND**
- **SHORT SETUP · SELL THE BREAKDOWN**

Immediately below it, give the condition: “Buy after a 4H close above X and a held retest,” or “Sell after rejection of X on 1H.” When observed, say “Buy signal confirmed at [time]” or “Sell signal confirmed at [time].” State the signal's timeframe.

Where geometry is rejected, do not call it a trade setup. For example: **LONG SCENARIO ABOVE 81,499.90**; “Buy entry needs better reward: the current first objective offers 0.41R.” This expresses the upside possibility without advertising a usable long.

A real range can show **RANGE · BUY SUPPORT / SELL RESISTANCE** only when both edge plans are supported. Otherwise name the supported edge, or state “Range; directional setup not established.” Forcing a direction where none is evidenced would reduce analytical quality.

| Current label | Replacement |
| --- | --- |
| WAIT / waiting confirmation | “Buy after [exact event]” / “Sell after [exact event]” |
| EXPIRED | History: “Earlier entry window ended at [time].” Current card describes the next valid setup. |
| INVALIDATED | History: “Earlier setup ended below/above [level].” Current view is evaluated independently. |
| NO TRADE · reward insufficient | “Buy/sell entry needs better reward: [R] to the first objective.” |
| Conditional short / sell owned Spot | Chart: “SHORT SETUP.” Execution control: “Sell BTC you own.” |
| PLAN SL (reference) | “Planned stop — beyond [named swing/zone].” After confirmation, identify the observed test basis. |

Use LONG/SHORT for analytical direction and BUY/SELL for order controls. In the existing Spot product, a sell reduces owned inventory; it is not a leveraged short. Explain this once at the trading control. Keep manual Market/Limit entry and TP/SL editing available as the user's separate choice.

## Applying the language to the supplied reports

These are editorial examples using the saved October 17 prices, not new signals or newly validated setups.

| Frame | Proposed dominant language | Essential condition and limitation |
| --- | --- | --- |
| 1H | **SHORT IDEA · SELL AFTER REJECTION AT 81,690.60** | A new 1H rejection/test is required under the saved method. Downside references 81,523.90 and 81,404.30. Planned stop is not observed protection. |
| 4H | **SHORT IDEA · SELL THE REBOUND TO 82,556.60** | New rejection evidence; objectives 81,032.80 / 80,400.00. The old entry window is historical. |
| 1D | **LONG SCENARIO ABOVE 81,499.90** | The current buy references offer 0.41R and do not establish a usable long. 82,285 / 82,556.60 remain recovery resistance. A new entry structure must be calculated. |
| 1W | **LONG IDEA · BUY A CONFIRMED SUPPORT TEST AT 82,842** | Saved weekly idea; 89,111 is overhead resistance. A separately evaluated 1D entry may be practical, but cannot be fabricated from the weekly PNG/TXT. |

The first two are sell ideas with untriggered entry conditions, not a statement to sell at the last close. The daily and weekly ideas do not override intraday pressure. A concise relationship sentence should identify a possible lower-frame pullback within the broader structure and the exact condition that would turn that recovery scenario into a valid setup.

## Proposed calculation and report contract

The user's additional Binance BTC 4H example introduces a specific range/channel requirement. Its accompanying post describes a range between 80k and 85k, downside preference below 80k and positive scenarios after acceptance above 85k. The [channel and range addendum](GLOBAL_BTC_4H_CHANNEL_REVIEW_2026-10-17.md) audits this example and defines structural channels, local boundaries and regression separately. The existing two independent pivot lines are not yet a validated parallel channel.

One immutable calculation result should feed every renderer and order assessment:

```text
market: regime, direction, structure, key zones, analysis timeframe
channels: type, broad/local span, anchors, confirmation times, scale, validation
context: shared frame evidence, session, cutoff, relationship
setup: family, side, setup timeframe, entry timeframe, evidence
entry: zone, exact trigger, trigger status and time
protection: planned/observed, structure anchor, stop, failure condition
objectives: material barriers, planned TP levels, horizon, provenance
risk: actual/worst permitted entry, gross and modeled net R, cash-risk formula
validity: structural conditions, event-based/time conditions, data freshness
history: earlier attempts only
```

Signal confirmation, price location, quote freshness and execution readiness are different fields. The human title comes from setup direction/family; the entry sentence comes from the trigger. Internal eligibility codes remain for compatibility but are not the user's chart vocabulary.

Use one calculator for the report, recheck, PNG/TXT, Telegram, API/MCP projections and order handoff. The language model explains the result; it does not select a new side, price, stop or setup. Check generated claims against the frozen result.

## Implementation plan

### Phase 1 — Repair consistency and language

1. Replace the WAIT-centric presentation contract with direction, family and exact entry-condition fields across all outputs.
2. Unify entry-zone calculation and geometry checks. Add the reproduced report-versus-assessment mismatch as a regression test. Choose a strategy-specific zone; do not simply adopt the wider reward-only band.
3. Retain shared UTC hierarchy, side-aware context, deterministic model boundaries and collapsed history from the current draft.
4. Use planned/confirmed/filled chart semantics. Curate remote levels and keep price labels readable.

### Phase 2 — Make the setup engine strategy-specific

1. Start with two documented families: support/resistance bounce or rejection, and breakout/retest. Treat direct breakout entry as a separately evaluated mode rather than silently waiving the retest rule.
2. For each, define the actual price event, observed bar sequence, zone, stop basis, objectives, setup lifetime and allowed context relationship. Avoid one universal expiry and one entry-width constant.
3. Add explicit analysis/entry timeframe selection and sufficient independent lower-frame candles. Default mappings above require evaluation before release.
4. Evaluate stop behavior and target structure with the chosen entry method. Preserve a logical stop; resize the position when risk changes. Do not increase apparent R:R through stop squeezing or hidden obstacle removal.
5. Introduce the method under a new version. Preserve historical reports, fees, endpoints and existing manual trading choices. Do not change automation as part of report testing.
6. Add evidenced range zones and validated parallel channels, with optional local boundaries and separate regression. Distinguish range-edge trades from trend breakouts/breakdowns. Use one saved geometry in the native chart, PNG/TXT and Telegram; avoid arbitrary crossing pivot lines.

### Phase 3 — Validate the method and every output

1. Replay stored public BTC candles across rising, falling, ranging and volatile periods. Make pivots available only at their real confirmation times. Split calibration and evaluation chronologically.
2. Record both valid entries and rejection reasons, setup coverage, time-to-trigger, timeouts, stop distance, adverse/favorable excursion, target reach, modeled net expectancy and drawdown. Four attractive screenshots cannot establish performance.
3. Model costs and slippage. Where one OHLC bar touches both stop and target, use finer evidence or a conservative ambiguous outcome; never select the favorable sequence.
4. Test genuine long and short examples, rejected reward, opposing context, missing data, target reached and historical failed entries. The test objective is coherent behavior, not a quota of signals.
5. Inspect actual PNG/TXT and desktop/mobile/Telegram screens before accepting a case. Check zoom, all-study toggles, full Elliott anchors, Fibonacci anchors and planned-versus-confirmed marks. Validate Market/Limit and observed TP/SL handoff without opening BTC trades.
6. Only after the above, make the four authorized local paid X Layer Pro reports for BTC 1H/4H/1D/1W. Audit their text and images together, compare the hierarchy and confirm exact report settlement. Reuse accepted jobs for recovery rather than paying twice.

## Release acceptance

- No dominant WAIT, NO TRADE, EXPIRED or INVALIDATED labels in newly rendered human reports.
- A valid proposed trade displays a named LONG/SHORT family, planned entry/SL/TP, an exact trigger and its timeframe.
- A rejected 0.41R buy cannot be styled as a supported long setup or become a short without separate evidence.
- Same evidence produces the same zone and qualification in report, fresh assessment and quoted order review.
- A weekly outlook can use an explicitly named lower-frame entry study; the report never claims to have confirmed it without that data.
- Each target, stop, wave and Fibonacci construction identifies its relevant structure/anchors and horizon.
- Structural channels have consistent parallel geometry and known anchors; local consolidation and statistical regression are identified separately. A range is not forced into an unconditional LONG or SHORT.
- Reports distinguish a price scenario, a valid prospective setup, an observed signal and a filled trade.
- Market direction, entry condition and timeframe relationship agree across chart, prose, Telegram and agent delivery.
- No claim of reproducing Vilarso's private algorithm or profitable performance without the necessary access and evidence.

## Current implementation state

The earlier draft remains uncommitted. Its shared hierarchy, safe delivery projections, manual Spot controls and some export improvements are useful. Its dominant WAIT wording, separate planned/assessment entry ranges and universal setup rules are not accepted as the final design. Offline renderer checks do not resolve those method issues. The next implementation should follow this revised contract rather than ship the current draft as complete.

## Review artifacts

The [interactive wording proposal](../.tmp/global-methodology-research-2026-10-17/proposal.html) switches between the four supplied snapshots. This is an editorial example with saved prices, not a new market analysis. The [desktop daily preview](../.tmp/global-methodology-research-2026-10-17/proposal-1440.png) and [mobile 4H preview](../.tmp/global-methodology-research-2026-10-17/proposal-390.png) were visually inspected. All eight frame/viewport combinations at widths 1440 and 390 passed layout checks without horizontal overflow or runtime exceptions. This checks the language prototype, not the revised trading method.

The entry-band inconsistency is recorded in the [offline diagnostic](../.tmp/global-methodology-research-2026-10-17/diagnostics.json). The four local report quotes contain no signed payment or accepted paid job. No testing funds were spent during this review.
