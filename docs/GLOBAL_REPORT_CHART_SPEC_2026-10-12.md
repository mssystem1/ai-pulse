# Global chart and trade setup — revised design

13 October follow-up: Market and Limit ticket review is preserved for both tiers. Confirmed setups carry observed entry, TP and SL. A separately labelled manual action accepts the user's trading risk without changing Watching to Ready; only observed, unexpired protection is copied. Otherwise the ticket keeps those fields blank. See the [interaction screenshots](previews/global-handoff-validation.html).

The 13 October implementation also supports selected 15m, 1H, 4H, 1D and 1W primary charts. Pro observes 1H, 4H, daily UTC, weekly UTC and monthly UTC context respectively. The original planning examples below use 1H. See the [timeframe rendering audit](previews/timeframes/native-preview.html) for both tiers on desktop and phone.

12 October 2026 specification; implementation completed and audited on 13 October. The Spot plan uses the chart's reclaim/retest and targets; entry and stop await the observed retest. Historical design references are 117.30, 120.56 and 124.80. Live reports derive their own prices from completed candles. The canonical map, distinct Quick/Pro charts, prompts, exports and Telegram delivery are implemented. See the [implementation and validation record](GLOBAL_REPORT_VALIDATION_2026-10-13.md).

[Open the interactive Quick / Pro preview](previews/global-report-v2.html). Switch tiers and highlight individual paths. It is a standalone planning artifact, not a deployed page or the application report renderer.

Static previews: [Quick](previews/global-report-quick.png), [Pro](previews/global-report-pro.png).

Telegram is part of the same revision: [audit and delivery specification](GLOBAL_REPORT_TELEGRAM_SPEC_2026-10-12.md), [Quick / Pro message and chart preview](previews/telegram-global-reports.html). This includes bot messages, both chart tiers, full TXT, the TON Mini App and reopening saved reports.

## Design decision

Quick answers “What is happening, what can happen next, and what must happen before entry?” Pro adds “What supports this setup, what conflicts with it, and is the potential reward worth the risk?” The paid advantage is visible analysis and execution detail. It is not just a longer report.

Both tiers get real candles, Elliott labels, decision levels and one selected Spot setup. Quick shows the main path and one material alternative. Pro supports a third meaningful path and adds trend, momentum, volatility and higher-timeframe chart layers. Every path has explicit activation and cancellation conditions. Present one next eligible Spot setup, linked to its path and labeled Watching or Ready. Do not add paths just to fill a tier quota.

An alternative path may contain a useful future entry plan. The problem to fix is treating that future plan as a currently recommended buy, omitting its activation conditions, or silently switching between incompatible targets. A bearish report can show what would create a future recovery trade while its current action remains Wait.

There is no need to force every market into one globally fixed entry strategy. A supported wave continuation, support recovery or completed correction can produce the selected setup. Each report still selects at most one executable setup at a time.

## What the chart includes

| Layer | Presentation | Evidence requirement |
| --- | --- | --- |
| Candles | Real OHLC candlesticks and wicks, current price, legible time and price axes | Saved primary-timeframe OHLCV; completed-bar status retained |
| Elliott structure | Origin plus 1–5 or A–B–C labels on the actual anchors, active wave and degree | Timestamped anchors and validated structure, not five arbitrary window segments |
| Candidate count | Clear candidate label; provisional last wave can use `C?` or `5?` | Honest uncertainty; no count invented solely to fill the chart |
| Channel / trend lines | Orange channel boundaries and relevant internal trend line | Verified swing anchors or disclosed regression method; omit unsupported lines |
| Moving average | Purple SMA55 initially; Pro exposes the larger Fibonacci-period family | Calculated from saved history with adequate warmup; proposed PULSE settings, not Vilarso's exact private configuration |
| Decision levels | Recovery threshold, support 1/2, upside 1/2, key resistance | Derived and ranked levels with stable IDs and correct display precision |
| Possible moves | Quick: one solid main path and one dashed alternative. Pro: up to two alternatives | Every path states trigger, progression, target and what invalidates it |
| Invalidation | Dashed structural invalidation line and stated bar-close condition | Associated with the displayed count or thesis |
| Setup overlay | Future confirmation/retest level and target stages; add priced entry/stop only when supported | Same stable level IDs as the card; an unformed retest has no exact entry, stop or R:R |
| Volume | Compact bars under price | The observed venue's volume, not inferred cross-exchange activity |
| Momentum | Pro: compact RSI14 panel with 30/50/70 guides and observed participation | Calculated from the same saved candles; original screenshot oscillator identity is unverified |
| Metadata | Pair, venue, timeframe, currency, snapshot time, actual context timeframe | Explicit source and freshness; no hidden exchange or timeframe substitution |

Keep full history and future space readable. Labels should sit on the right with collision handling. Use names as well as colors. Place each path at its relevant activation point rather than drawing every alternative as already active from the last close. Future space is schematic; it does not predict arrival time.

Support may be shown as a zone around a level. Do not describe an OHLC support zone as exchange order-book liquidity unless a separate observed order-book source establishes that claim.

For a valid impulse, retain six anchors including the origin, and check wave 2 versus origin, wave 3 length and wave 4 overlap. A diagonal needs its own rules and label. Corrective structures and degrees must match their actual anchors. Confirm pivots using only candles available at the snapshot; retrospective labels cannot be used as if known at the time.

Show one primary count at a time. If Pro exposes an alternate count, make it a selectable overlay with its own validation and conditions; do not stack conflicting labels over the main count. A rich chart is allowed to say “count unclear” when the evidence does not support a count.

## Concrete SOL example from the supplied screenshot

The screenshot's displayed reference is 115.75, with levels 117.30, 120.56, 124.80, 128.00, 132.74, 113.12, 109.93 and a distant 95.24 level. They are historical reference levels, not current quotes. The original labels' proprietary calculation and semantics have not been reproduced.

The preview uses these reference prices but **synthetic candles, volume, indicators, derived 4H context and wave labels**. Its wave anchors illustrate a completed five-wave advance followed by a possible A–B–C correction. They are a visual design example, not an asserted count on the original screenshot or a validated current market analysis. Quick shows paths ① and ②; Pro also shows ③ and the remote stress reference.

| Possible move | Activation / condition | Visible route | Meaning for Spot |
| --- | --- | --- | --- |
| ① Main: correction continues | Price remains below recovery at 117.30; a completed 1H close below 113.12 confirms the next leg | 113.12 → 109.93 | Current action: Wait; downside route is market-risk context, not a short instruction |
| ② Conditional recovery | 113.12 remains intact, a completed 1H candle reclaims 117.30, then the retest holds that level | S1 117.30 → S2 120.56 → S3 124.80 | The Spot watch plan uses those same chart stages; entry and stop remain pending the actual retest |
| ③ Bullish recount | Completed close and held retest above 124.80, after clearing earlier recovery hurdles | 128.00 → 132.74 | Reassess the count and create a new validated setup at that future snapshot |

The 95.24 stress reference is secondary: it becomes relevant only if 109.93 also fails. Do not give it the same visual weight as the nearest support or present it as the current base target.

S1 / S2 / S3 are setup-stage markers, distinct from Elliott wave labels and scenario numbers. S1 is confirmation, S2 is target 1, and S3 is target 2. The new amber route visibly reclaims S1, pulls back to retest it, then progresses to S2/S3. These are proposed conditions for the historical design example, not Vilarso's transcribed trade instructions.

## How the trade setup looks

```text
CONDITIONAL SPOT PLAN — AMBER PATH ②
Reclaim and retest 117.30 · WATCHING

Current action: WAIT. No buy at the displayed reference 115.75.

Confirmation:
1. The 113.12 support floor remains intact.
2. S1: a completed 1H candle closes above 117.30.
3. A subsequent retest returns to 117.30 and closes at or above it.

Entry: pending the actual retest and its permitted entry zone.
Protective stop: pending its confirmed low and a measured buffer.
S2 / Target 1: 120.56, first mapped recovery resistance.
S3 / Target 2: 124.80, next resistance / recount boundary.
Gross and net R:R: pending entry, stop and actual execution costs.

Cancel: completed 1H close below 113.12, or back below 117.30 after reclaim.
Do not chase a breakout without a held retest.
Reassess trend/context and risk before this can become Ready.
```

The 113.12 floor is thesis invalidation; it is not an execution stop. The future retest's observed low determines the protective-stop anchor, with a disclosed volatility/market-precision buffer. Do not invent this low, a permitted entry range or an attractive R:R before the required candles exist. Once they exist, the first mapped target must offer adequate net reward after costs; otherwise retain Wait even if the reclaim succeeds.

The card now sits inside the chart panel directly below its path controls, with the same amber accent. It shows S1 / S2 / S3 using canonical level IDs and a “Highlight this plan on chart” control. Confirmation and target marks appear only in future schematic space. No unconfirmed entry band or execution stop is drawn across past candles. Both tiers use the same alignment; Pro expands context and risk checks.

If the main bearish route breaks 113.12, this Watching plan becomes invalid. A drift down while that floor holds does not itself cancel the plan. If price rises without the required retest, it does not become Ready. When another branch activates, reassess the map and create only its selected plan. Never recycle an earlier branch's stop or targets into the new setup.

Setup states: No setup → Watching → Ready → Invalidated/Expired. Visibly mark missing checks. Watching is allowed to have null entry, stop and R:R; it can still show a meaningful trigger and structural targets. Ready requires observed anchors, priced entry/stop, valid geometry and risk/cost checks. The proposed three-bar retest window after reclaim is an initial expiry example to evaluate.

No report-to-order handoff may silently replace a completed-bar reclaim and held retest with a price-only limit trigger. Unconfirmed orders require a separately supported execution workflow; a Watching report is not ready for an automatic order.

## Quick versus Pro

| Element | Quick | Pro |
| --- | --- | --- |
| Reader outcome | Understand the market and the next condition to watch | Assess confirmation, context conflict and risk geometry |
| Core chart | Candles, one main Elliott count, swing channel, nearby levels, SMA55, volume, setup-stage markers; priced entry/stop when supported | Core plus regression channel, SMA family, RSI14, ATR guide and real 4H context inset |
| Optional chart layers | Path highlighting and readable enlargement | Five SMAs, Fibonacci measurements, anchored VWAP, confirmed pivots; alternate validated count when available |
| Possible moves | Main view + one material conditional alternative | Main + up to two material alternatives, progression, deeper levels and recount conditions |
| Selected setup | State, completed-bar trigger, retest/entry, stop, targets, cancellation, no-chase condition | Full confirmation checklist, trend/context conflict, net R:R after costs, ATR-relative risk, expiry and target rationale |
| Evidence | Short rationale and material caveat | Numerical observations, anchor/rule checks, measured level rationale and missing evidence |
| Text target | About 120–180 words plus the structured setup strip | About 250–400 words; detailed checks on expansion |

Both tiers must retain the information needed to interpret their setup responsibly. Pro must never receive a stronger recommendation solely because it is the paid tier. Its extra context may strengthen a thesis, expose conflict or remove a candidate.

## Pro indicators and why they belong

Vilarso's public indicator documentation describes five Fibonacci-period SMAs, linear regression channels, fractals/pivots, volatility targets across 4H/1D/1W and a trailing line. It does not disclose a complete reproducible algorithm or the exact five periods. The useful pattern to adopt is a consistent decision map with explicit price conditions and measurements. [Vilarso's public documentation](https://t.me/s/vilarsopro?before=38).

| Layer | Proposed PULSE calculation | Purpose and presentation |
| --- | --- | --- |
| SMA family | 21 / 55 / 89 / 144 / 233; proposed starting periods to evaluate | Trend and countertrend context. Pro shows 21/55/144 initially; toggle all five. Quick shows 55. Display slope and price relation, not just colored lines. |
| Regression channel | Last 120 completed primary bars, OLS on closes, ±2 residual standard deviations | Show direction and deviation from recent trend. This is a fitted historical channel, not a statistical confidence interval or prediction probability. |
| Confirmed pivots | Initial 3 bars on each side, with the later confirmation timestamp recorded | Anchor structure and show confirmed turning points. A pivot is usable only after its right-side bars exist; never backdate an executable signal. |
| Fibonacci measurement | Selected validated swing anchors; 38.2 / 50 / 61.8% retracement; useful extensions only when supported | Explain a target or support measurement. Do not show every ratio. The example's 101.00 → 125.20 leg gives 50% at 113.10, near screenshot support 113.12. |
| RSI14 | Wilder averaging on completed bars; 30 / 50 / 70 guides | Momentum context and possible exhaustion. A divergence annotation needs confirmed price/RSI pivots; low RSI alone is not an entry trigger. |
| Volume comparison | Current completed volume / mean of prior 20 completed bars | Establish whether reclaim participation is stronger or weaker than its recent baseline. Label the venue; do not call OHLCV volume order-book liquidity. |
| ATR14 | Wilder true-range average on the actual displayed timeframe | Show stop distance in ATR units and a modest range guide. Measure 4H/1D/1W ranges from their own complete series if enabled; do not present one-hour ATR as a weekly forecast. |
| Anchored VWAP | HLC3 × volume accumulation from an explicit structural anchor | Compare price with average traded price since a major pivot. Optional layer because it can overlap moving averages. Anchor timestamp and venue must be visible. |
| 4H context | Actual completed 4H candles, or correctly aligned aggregation of complete 1H OHLCV; enough SMA warmup | Show agreement or conflict in an inset and explain whether the selected long is countertrend. Do not infer this from a short primary series. |

Default Pro chart: three SMAs, one regression channel, Elliott count, decision levels, setup overlay, volume, RSI and a compact 4H inset. Other overlays are selectable. A full-screen view and responsive labels are essential. Mobile should emphasize the current structure, with older anchors accessible by pan/zoom.

Avoid a score that counts five SMAs as five independent confirmations. Wave measurements, Fibonacci levels and pivot-derived support often share the same input. Explain that relationship. Keep trailing-stop strategies and custom repainting signals out of the initial release until their exact rules and historical behavior are validated. Do not promise Vilarso's private indicator or its claimed performance.

## TradingView API approach

The repository already uses TradingView Lightweight Charts 5.2.1 in `apps/web/src/MarketCandleChart.tsx`. Reuse that dependency and its JavaScript API for the production report chart. It supports our own candle/line/histogram series and custom primitives for wave labels, zones, channels, arrows and projected space. Keep the report annotations in a dedicated component; share the base renderer without changing Autopilot/Prediction strategy behavior.

TradingView does **not** provide a public API to retrieve market data or indicator values. Its REST broker API serves a different integration. Lightweight Charts is the chart renderer; compute the standard indicators in our code from our saved market data. [TradingView's API explanation](https://www.tradingview.com/support/solutions/43000474413-i-need-access-to-your-api-in-order-to-get-data-or-indicator-values/), [Lightweight Charts](https://www.tradingview.com/lightweight-charts/), [custom primitives](https://tradingview.github.io/lightweight-charts/docs/plugins/intro).

Advanced Charts is an alternative if editable drawing tools and its built-in studies become necessary. It requires granted library access and still needs our own datafeed. It cannot run Vilarso's Pine script through the library: custom studies use JavaScript, and Pine is unsupported. Its access/license terms need to fit the paid product before adoption. No additional TradingView access is needed for the currently installed Lightweight Charts approach. [Library access](https://www.tradingview.com/charting-library-docs/latest/quick-start/), [datafeed](https://www.tradingview.com/charting-library-docs/latest/connecting_data/), [custom studies](https://www.tradingview.com/charting-library-docs/latest/custom_studies/).

The preview remains a standalone SVG design artifact. It illustrates the production layout and calculations; it does not claim the report renderer has been migrated. The production API should persist one `ReportChartPayload` containing candle references, indicator settings/series, validated anchors, level IDs, path conditions and the selected setup. Web rendering and downloadable/Telegram chart images must use this same payload and tier projection, so image exports match the report exactly.

## Prompt and schema changes needed

Keep Elliott central to the chart but remove forced unsupported counts. Change the output from independent target arrays, deterministic labels, AI paths and disconnected trade plans into a single canonical structure:

```text
marketSnapshot: instrument, venue, currency, timeframe, observedAt, candleIds
waveCount: degree, structure, activeWave, origin, anchors, validation, uncertainty
levels: stable IDs, role, price/zone, evidence anchors
paths: main + up to two conditional alternatives
       each: wave progression, confirmation, target IDs, invalidation, status
setup: null or one selected candidate
       linked path ID, state, trigger/retest/invalidation level IDs
       observed confirmation/retest anchors, nullable entry zone and stop
       target IDs, nullable R:R, expiry and missing-evidence reasons
narrative: headline, summary, reasons, material risks
chart: candle reference and canonical annotation IDs
indicators: settings, deterministic observed measurements, series references
context: actual completed timeframe series and agreement/conflict
tierView: visible layers, selected path IDs, explanation depth
```

Share the data, validated base count, levels and conditions for the same snapshot. A tier-specific narrative cannot invent different prices or silently change the setup's state. Extra Pro context can change its assessment only with explicit observed evidence and an explained recount or cancellation. Chart, narrative and setup must remain consistent within each report.

Draft shared instruction:

> Analyze the provided candle structure and supplied level/anchor evidence. Present one main Elliott hypothesis and only defensible conditional alternatives. Clearly distinguish observed waves from projected progression. Do not force a five-wave count from arbitrary segments or candle count. Each possible move must state activation, targets and invalidation using canonical references. Select at most one eligible Spot setup and preserve its validated state. Do not convert an alternate upside path into a currently recommended buy. Use simple report prose and detailed chart annotations. State missing context honestly; never infer order-book activity or actual higher-timeframe confirmation from the primary series alone.

Setup alignment instruction:

> Select trigger, retest, invalidation and target levels by canonical chart IDs. A setup is a conditional action on one plotted path; it cannot introduce an unrelated entry strategy. If a required future retest has not formed, leave its entry zone, protective stop and R:R null and state what is missing. Draw only the confirmation level and structural targets. Price entry and stop only from observed anchor evidence, then evaluate reward against the nearest mapped obstacle and actual costs. Thesis invalidation must not be silently reused as a protective stop.

Quick instructions emphasize the main count, one alternative, the current action and concise entry/cancellation conditions. Pro instructions interpret the supplied deterministic indicator measurements and actual 4H context, explain conflicts, justify the selected setup's geometry and include a third path only when material. The model must not calculate technical indicators from prose, invent unseen series or add conflicting setups. Neither prompt should create an independent numeric plan that disagrees with the chart.

Provide enough completed history for all displayed periods and their warmup; Pro SMA233 cannot be built from today's 60-candle model input or 120-candle fetched window. Compute indicator series before prompting, and give the model compact measurements plus timestamped swing/level evidence. The chart can use full saved history without spending model tokens on every raw candle.

## Reasoning and token configuration

The local user choices are preserved:

```dotenv
GROK_REASONING_STANDARD=low
GROK_REASONING_PREMIUM=medium
GROK_MAX_INPUT_STANDARD=16000
GROK_MAX_INPUT_PREMIUM=32000
GROK_MAX_OUTPUT_STANDARD=4096
GROK_MAX_OUTPUT_PREMIUM=8192
```

These are initial ceilings, not target report lengths. Input limits allow richer swing/level/context evidence. Higher output limits leave headroom for reasoning and completed structured output, especially at Pro `medium`; user-facing prose stays short. Validate actual completion/reasoning usage and truncation rates with the chosen model before fixing production budgets. No paid model calls were made for this preview.

Compatibility changes completed: configuration validation accepts `medium`; analysis request/result types and V5 request types accept it; report profile schema accepts it. The four local Global input/output values were raised. Existing unrelated service budgets and deployment settings have not been changed.

Current official Grok 4.5 documentation supports `low` and `medium` reasoning. [Model documentation](https://docs.x.ai/developers/models/grok-4.5), [reasoning controls](https://docs.x.ai/developers/model-capabilities/text/reasoning).

The earlier audit's pricing issue remains a deployment task: verify actual account rates and align model-specific cost estimates before using them to estimate or reserve production spend.

## Validation and remaining implementation

Completed for this revision:

- Configuration suite: 11 passing tests, including Quick `low` / Pro `medium` and configured limits.
- Grok/V5 request tests: 12 passing tests, including Pro `medium`, 8,192 output limit, reasoning usage and report profile validation.
- Schemas, config, analysis and API TypeScript builds passed.
- Browser preview renders 520 illustrative 1H candles and nine wave anchors. Quick shows five nearby reference levels, SMA55 and two paths; Pro shows eight levels, three default SMAs, regression, RSI/ATR, derived 4H candles and three paths. All-five SMA, Fibonacci, VWAP and pivot toggles, tier switching and individual path highlighting were checked.
- Both tiers fit a 390px mobile page without outer horizontal overflow; the detailed chart scrolls within its container.
- Spot plan is attached to the chart, references the same level IDs, and matches future S1/S2/S3 marks. Old unanchored entry/stop prices and R:R have been removed. Path highlighting preserves the distinction between the main correction and the conditional Spot alternative.

Implementation checklist — completed items 1–6; strategy research remains separate:

1. Build/pin the canonical market snapshot with adequate primary history and actual supported context candles.
2. Replace fabricated Elliott fallbacks with validated anchors or an honest unclear state.
3. Unify wave count, channel/level annotations, possible moves and setup conditions.
4. Update prompts and schemas, then implement the report renderer and chart exports across web, Telegram and TON.
5. Preserve completed-bar confirmation, expiry and representation/currency checks during Spot handoff.
6. Keep historical report snapshots and unrelated Autopilot/Prediction behavior compatible; shared technical helpers need a separate impact check.
7. Evaluate holdout periods without lookahead, including fees, spread, missed retests and intrabar ambiguity. Clean presentation does not establish a profitable strategy.

The primary acceptance criterion is that a reader can identify the current wave hypothesis, main possible move, activation conditions and setup state directly from the chart and its one linked card.
