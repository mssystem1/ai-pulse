# Global setup implementation and validation

17 October 2026. Implements the [method and language review](GLOBAL_SETUP_METHOD_AND_LANGUAGE_REVIEW_2026-10-17.md) and [BTC channel review](GLOBAL_BTC_4H_CHANNEL_REVIEW_2026-10-17.md). This records functional, numerical and visual validation. It does not establish profitable strategy parameters or reproduce protected Vilarso indicators.

## Delivered behavior

The report leads with LONG, SHORT or RANGE and one exact entry sentence. A directional idea with insufficient reward is a **LONG/SHORT SCENARIO**, with the reason in plain language. WAIT, INVALIDATED, EXPIRED and NO TRADE are no longer prominent chart/report headings. Machine status values remain compatible with existing clients; earlier failed attempts remain in a separate history record.

Market structure, a prospective setup, an observed signal and an actual fill are separate. A daily recovery can coexist with a four-hour decline. Each report names its analysis frame, higher context and entry study. Context evidence, timestamps and sessions explain the relationship instead of forcing every timeframe to agree.

| Analysis | Entry study | Immediate context |
| --- | --- | --- |
| 1H | 15m | 4H |
| 4H | 1H | 1D UTC |
| 1D UTC | 4H | 1W UTC |
| 1W UTC | 1D UTC | 1M UTC |

New calendar-frame requests use UTC. Legacy UTC+8 snapshots keep their original candles and are identified as UTC+8. Reopening an old report does not recalculate its purchased price map.

## Entry and protection

Report planning, free recheck and quote review now use one structure-based entry calculator. The named families are breakout/retest, support bounce, resistance rejection, range buy and range sell.

- A breakout needs a completed crossing close and a later held retest. A bounce/rejection needs a reaction at the mapped area followed by a later completed close beyond that reaction candle's high/low.
- Stops use the named entry frame's confirmed swing and observed reaction/retest extreme. The touch allowance is the larger of two price ticks or 0.10 of entry ATR14. An observed signal uses ATR available at that signal, rather than later volatility.
- Planned entry zones intersect the measured setup area with the prices offering at least 1.50R to the first structural obstacle. R:R cannot invent an entry away from that area, tighten the stop or skip a nearer target. Reward uses the worst permitted entry price.
- Trigger failure, a structural breach, stop touch or first-objective touch ends that attempt. A failed candle cannot rearm itself. There is no universal two-bar setup lifetime. Signal evidence refreshes after the next entry close; quote and assessment freshness are separate checks.
- A report's planned stop is a reference. Copying protection into an order requires fresh observed evidence, the same supported entry zone, verified representation/currency/balance and a size-specific quote with adequate net reward after costs.

Manual Spot Market/Limit buy and sell tickets remain available with editable TP/SL. A Spot sell uses owned inventory. A SHORT research study does not open a leveraged position. Positive long/short signal fixtures and the X Layer Market/Limit quote-review route are tested without placing BTC trades.

## Charts and documentation

The app keeps TradingView Lightweight Charts candlesticks. Setup, Trend and Fibonacci presets answer separate questions; study toggles preserve the chart canvas and view. Optional studies remain available without becoming the default entry signal.

Broad and local parallel channels use two confirmed same-side anchors and an opposite boundary, equal slopes and constant width in candle-index/linear-price space. The saved construction identifies its timeframe, anchors, observation cutoff, touches and close violations. An unsupported channel is omitted. Channel geometry is contextual evidence, not an entry trigger.

The research profile uses broad/local windows of 180/64 candles, minimum anchor spans of 40/12, width at least 2 ATR, touch tolerance 0.30 ATR and at least two touches on each side. No more than 5% of closes, allowing one close, may violate the channel tolerance; the latest close must remain contained. These are explicit construction parameters, not success probabilities.

Horizontal range detection needs repeated support/resistance tests, 2–10 ATR width and at least 90% close containment. Its outer boundaries and inner support/resistance zones are named separately. A range is not inferred merely from price near an SMA. The 4H paid example retains both broad and local channels.

Fibonacci retracement uses the actual measured A–B swing and standard ratios; three-point extensions need a real later correction anchor. A two-point projection is labelled as such. Distant archive highs/lows remain context rather than stretching the local setup or becoming its first target. Elliott labels remain candidate swing hypotheses with unverified subwaves identified; an incomplete count does not prevent level-based analysis.

All exported charts contain real completed candles, one main route plus a material alternative, context and a separate actual-candle entry panel. Valid prospective plans have dashed planned entry/SL/TP marks. Rejected reward/structure does not receive an entry risk box. Future space is schematic and carries no arrival-time forecast. The illustrated English/Chinese app guide contains nine images generated from public historical fixtures, provenance and practical reading instructions.

## Four actual paid X Layer reports

Exactly four Global Pro reports were purchased locally using the authorized TEST_WALLET_ADDRESS: BTC 1H, 4H, 1D and 1W. Each charged exactly 0.30 USD₮0; report charges totalled **1.20 USD₮0**, with network gas separate. All four transactions succeeded and the exact token Transfer events were verified. No additional report purchases were made during rendering recovery.

| Frame / saved reference | Result of the saved entry study | Planned reference prices | First-objective gross reward |
| --- | --- | --- | --- |
| 1H / `7fbfec2b` | LONG scenario; insufficient reward. Entry evidence is 15m. | Entry 81,683.30–81,697.90; SL 81,453.69; first objective 81,775.00 | 0.32R |
| 4H / `5d3160e2` | RANGE 80,809.50–84,361.60; conditional 1H resistance-rejection sell study at 82,800.00. No current sell signal. | Entry 82,775.56–82,824.44; SL 82,952.95; TP1 81,032.80 → TP2 80,809.50 | 9.82R |
| 1D UTC / `9044e06a` | LONG scenario; insufficient reward. Entry evidence is 4H. | Entry 82,204.09–82,365.91; SL 80,728.59; first objective 82,556.60 | 0.12R |
| 1W UTC / `11b04665` | Conditional LONG daily breakout/retest study at 82,842.00; new completed daily confirmation and later held test needed. | Entry 82,616.75–83,067.25; SL 80,174.74; TP1 89,111.00 → TP2 98,188.40 | 2.09R |

These are saved research observations from approximately 15:36–15:39 UTC, not current execution quotes. None of the four snapshots had a qualified current entry. Positive-signal and successful quote-review behavior is demonstrated by separate deterministic tests; a paid call is not forced to produce a trade.

The daily report no longer treats a distant 126,200 archive high as a local target. Its first obstacle remains 82,556.60, which exposes the inadequate reward instead of concealing it. The weekly planned risk is based on daily structure: about 1.28 daily ATR, rather than comparing a lower-frame entry with weekly noise. Protection still needs a new observed test before execution.

**Weekly coverage is partial:** the source returned 457 completed weekly candles against 520 requested. Its paid job remains `completed_partial`; the chart, text, caption and app disclose 457/520. Daily entry evidence and higher context are available. This is an actual source-history limit, not an optional skipped test.

| Frame | Payment transaction |
| --- | --- |
| 1H | `0x39865ed26f25bf0c746aeec188a6497d9929c5964b3b12a2845e115043301987` |
| 4H | `0x1d34dae1d27b1bb01e187e924ea1fd611616cc4656d5cad2bd3e0fd30b0c8cbb` |
| 1D | `0xd7a398c20f1a6e53c7594dba13848441700f88bf92ce2ab5ae823efd5edf5296` |
| 1W | `0x80f637c6c933f8974337937bbd895c8dd8b7e9a3fa056ab8719c5d10db136bf8` |

## Validation and evidence

- **321 automated tests passed:** domain 37, analysis 79, web 185, selected API/authentication/MCP/Telegram delivery tests 20; no skips in those runs. Tests cover observed long/short signals, shared report/recheck geometry, failed-bar rearming, revised/developing/future evidence rejection, context conflicts, minimum reward, fresh quotes and manual trade handoff.
- **32 offline exports passed:** Quick/Pro × English/Chinese × eight public historical snapshots. They exercise the actual TXT/PNG/SVG/Telegram renderers without model or payment calls. Earlier missing 15m fixture history is explicitly unavailable; it is not relabelled from hourly data.
- **20 final Chrome rendering cases passed:** four paid Pro frames on desktop/mobile, all-study toggles, Telegram Mini App report/plan views and the illustrated guide. No runtime exceptions or horizontal page overflow. Telegram host/library reads are browser fixtures; no Telegram message was sent. Chart toggles preserve the canvas; all nine documentation images decode.
- The four final PNG exports, mobile Telegram plan and desktop study screenshots were visually inspected. Numeric checks independently verify worst-entry R:R, completed cutoffs, parallel-channel offsets, canonical text/chart headings, caption budgets and weekly coverage. Private payment signatures, recovery tokens and keys remain outside public artifacts and Git.
- Schemas, domain, analysis, API and web builds pass. Existing dependency annotation and large-bundle warnings remain; no type/build errors are accepted.
- Authenticated report recovery succeeds; unauthenticated access returns 403. Repeated recovery leaves the saved global report identical and performs no new model request. Delivery retry tests prevent duplicate document/overview sends.

Final artifacts are retained locally under `.tmp/global-clarity-live-2026-10-17/deliverables/`. The four PNGs and matching TXT files are named `BTC-{frame}-20261017…-{reference}`. The numerical audit and browser screenshots are under `.tmp/global-methodology-implementation-2026-10-17/`; `final-numeric-audit.json` records hashes and selected public measurements. These local QA files are ignored by Git.

After the four paid calls, final presentation refinements clarified outer range boundaries, pretty UTC frame names, direction colors and weekly coverage. Schema checks were tightened, and the prompt explicitly distinguishes range boundaries from zone edges. The same four immutable reports were recovered and rendered again for free; no fifth model/report purchase is claimed as validation of that final prompt sentence. Original saved analyst notes remain available and can refer to the inner trading edges; the calculated range summary identifies the full envelope and each zone.

## Release handoff and practical limits

The change is prepared as a local commit. Deployment and push are separate operations. No environment settings, worker configuration, automation flags, service fees or discovery endpoints are changed by this implementation. No BTC trade or Telegram send was used for validation. The unrelated microgrant draft is excluded from the commit.

The method is a documented research profile. Its tolerances need separate historical strategy evaluation before making performance claims. Signals can be absent, higher context can conflict, costs can invalidate otherwise adequate gross reward and source history can be incomplete. Those facts are expressed as precise entry conditions or coverage statements rather than alarming action headings. A report does not update itself as the market moves; its authenticated free recheck supplies fresh evidence for the unchanged purchased map.
