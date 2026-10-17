# BTC 4H reference: range, channels and trade conditions

17 October 2026. Addendum to [the setup-method review](GLOBAL_SETUP_METHOD_AND_LANGUAGE_REVIEW_2026-10-17.md). The user supplied `5375558364936478974.jpg` and `5375558364936478971.jpg`. Both images were inspected at original resolution. This is an audit and implementation specification, not a reconstruction of the author's private indicator or a fresh BTC signal.

## What the supplied example says

The accompanying Russian post identifies BTC as sideways. It gives a downward preference below $80,000 and considers positive scenarios only after price establishes itself above $85,000. Trading inside those thresholds remains a range in the author's description.

The chart is Binance BTCUSDT, 4H, and displays a price around 81,572. This is inside the stated range. Its right-hand candle is developing; the screenshot includes a countdown. Neither that price nor the candle should be presented as a completed PULSE confirmation. PULSE's earlier reports use OKX Spot and different observation times; matching their exact candles, indicators or decimals to this image is not a valid acceptance criterion.

| Feature visible in the image | Interpretation supported by the screenshot | What cannot be established from the image |
| --- | --- | --- |
| Broad rising orange boundaries | A longer-span rising structure on this same 4H chart | The exact anchors, fitting method and whether the author drew them manually |
| Smaller descending light-colored boundaries | A local downward structure/pullback within the broader view | Exact parallelism, anchor prices, or whether every line belongs to the same tool |
| Horizontal colored levels | The author's overhead and downside price references | A complete entry/stop/position-size specification for each level |
| Purple moving average | An additional trend reference | Its exact period from color alone |
| Lower oscillator | A separate momentum/trend study | Its parameters or identity from the image alone; do not label it RSI or claim to reproduce it |

The broad and local drawings are different spans of a 4H chart. They are not evidence that the orange lines were calculated from daily or weekly candles.

## The report this example calls for

```text
BTC · 4H · RANGE 80,000–85,000

LONG: price establishes itself above 85,000.
SHORT: downside preference below 80,000.

Within the range:
Only separately evidenced buys at support or sells at resistance.
```

The first three lines summarize the supplied author's analysis. The within-range trade treatment is our proposed product behavior, not an additional recommendation quoted from that post. A touch at support or resistance does not itself establish an entry.

The author does not define in this post a mandatory number of closing candles, a universal second retest, or a three-bar deadline for “establishes itself.” PULSE must name its own tested confirmation method rather than attribute those details to him.

This distinction fixes an important setup classification problem:

- **Range sell:** rejection of the range's resistance, with support as a possible exit objective.
- **Trend short:** accepted failure below the range, with lower structural objectives.
- **Range buy:** a supported reversal at the range floor.
- **Breakout long:** accepted recovery above the range ceiling.

A sell within a range is not automatically a bearish higher-timeframe trend. A broad rising channel is not automatically a current long signal. These relationships should be visible in one sentence rather than hidden behind a WAIT status or conflicting bullish/bearish headings.

The same logic explains how an intraday sell can coexist with a broader recovery possibility. It needs to be identified as the correct setup family, on a named entry timeframe, with its own entry and protection.

## Channel construction audit

Current code:

- `packages/analysis/src/globalReport.ts` selects the last two pivot lows and last two pivot highs independently for `indicators.channel`.
- `packages/domain/src/globalChart.ts` extends each resulting line separately to the history boundary.
- These are two swing boundaries. They are not constrained to a common slope, can converge, diverge or cross, and have no explicit broader/local classification or channel-validation evidence.
- A separate 120-close regression with residual bands already exists. Calling the independent swing boundaries the same thing as that regression, or as a TradingView parallel channel, would be inaccurate.

[TradingView's Parallel Channel](https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/) uses a baseline defined by two points and an offset boundary. Its display supports additional internal levels and extension. [Regression Trend](https://www.tradingview.com/support/solutions/43000518108-regression-trend-drawing-tool/) instead places deviation bands around a fitted baseline. These are distinct constructions.

## Revised channel requirement

### 1. Structural parallel channel

Construct the baseline from two suitably separated, confirmed same-side swing anchors. Use an evidenced opposite-side anchor to establish the offset. A validation rule must assess touches, intervening violations, recency and span. Avoid selecting a pair solely because they are the latest two pivots.

For a linear price scale, using logical bar positions:

```text
m = (priceB - priceA) / (barB - barA)
base(t) = priceA + m × (t - barA)
offset = priceC - base(barC)
lower(t) = base(t) + min(0, offset)
upper(t) = base(t) + max(0, offset)
middle(t) = (lower(t) + upper(t)) / 2
```

The boundaries share one slope and cannot cross. Positive width, distinct baseline times and finite coordinates are required. If the chart uses a logarithmic price construction, fit and offset in the declared transformed space consistently; do not silently reuse a linear-price channel.

Record the instrument, venue, timeframe, anchors and their confirmation-close times, fitting span, scale convention, current boundary values, touches and breaks. The channel becomes available only when all required anchors are known. Do not use future pivots to make a historical channel look obvious.

### 2. Local consolidation boundaries

Use a separate local structure when the evidence supports one. If the slopes are not parallel, classify the geometry as converging, diverging or separate trendlines; do not force a parallel-channel label. A triangle or wedge needs its own validation before receiving that name.

The broader and local structures must be distinct rather than duplicate versions of the same fit. A weak or unavailable local structure should be omitted. A range regime also needs evidenced horizontal boundary zones; two mixed swing comparisons do not alone prove a tradable range.

### 3. Statistical regression channel

Keep regression as a separately named optional study. Show its input span and band definition. It can help describe displacement from a fitted trend; it does not replace the structural channel or produce an independent vote for entry. The author describes a regression component publicly, but the screenshot does not establish that the orange lines use PULSE's 120-bar calculation. [Vilarso PRO description](https://www.tradingview.com/script/G6hpaqTy-vilarso-pro/)

## Chart and report design

The default Pro setup view should show, when supported:

1. Primary horizontal support/resistance zones and the named market regime.
2. One broad structural channel in muted orange.
3. One local structure in muted gray, only when it adds different information.
4. The relevant planned LONG/SHORT setup and its entry condition.

Make the midpoint subtle and independently switchable. Keep regression, full SMA family, Fibonacci and extra pivots under study controls. Quick can retain the principal validated channel and essential range conditions; Pro adds local structure and construction evidence. The essential regime classification must agree between tiers.

Use native price/time coordinates in the interactive chart and the same saved construction in exports. Preserve anchors when zooming, panning or toggling studies; refit only on a separately identified analysis update. Use a bounded dashed continuation into future space and clip all drawings to the price pane. A projected boundary varies with time and must not be turned into a fixed TP without an explicit reference time and setup rationale.

Do not let an old channel or remote projected target stretch the setup view until current candles become unreadable. Full structure/history views can expose wider context. On mobile, keep the same anchor geometry and prioritize zone labels over secondary line labels.

Human explanations should answer: “What structure is this?”, “Where is price relative to it?” and “Which event supports a buy or sell?” For example:

> BTC is inside the 80,000–85,000 range. The broader rising channel gives context, while the local downward structure describes the pullback. A long breakout requires acceptance above the upper zone; a trend short requires acceptance below the lower zone.

These reference thresholds belong to this supplied example. Production thresholds must come from the report's own price evidence and chosen method. They must not be hardcoded or copied across venues/timeframes.

## Integration and acceptance

Extend the next method version with typed channel constructions and range-zone evidence, not merely another visual toggle. Keep the existing singular swing-boundary field readable for old purchased reports; do not silently replace their stored anchors or prices.

- Baseline and offset channel boundaries remain exactly parallel in the chosen price scale.
- No channel is available before its final required anchor confirmation.
- Missing/degenerate/noisy evidence can produce no channel; the renderer must not invent one.
- Broad and local structures have named spans and cannot be confused with higher-timeframe data.
- Range trades, trend continuation, breakout and breakdown receive different setup classifications.
- The reference example is described as a range, with conditional LONG above 85k and SHORT below 80k; it does not become an unconditional sell at its displayed 81.6k price.
- An OKX report is validated against OKX candles and its own timestamp; matching the Binance screenshot's exact levels is not required.
- Entry, SL and targets still require setup evidence. A channel touch cannot bypass the shared geometry, quote and order-review checks.
- PNG, TXT, Telegram, desktop and mobile use the same channel anchors, current values and explanation.
- Zoom and study toggles cannot alter the channel's underlying calculation or make its lines cross the RSI pane.

This requirement is added to the revised methodology plan. No channel engine was represented as completed by this audit, and no paid test or trading transaction was needed to inspect the supplied example.
