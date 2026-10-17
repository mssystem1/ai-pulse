# BTC report clarity and timeframe audit · 17 October 2026

> Revision: the user rejected the dominant WAIT presentation during implementation. The current method/language recommendation is [GLOBAL_SETUP_METHOD_AND_LANGUAGE_REVIEW_2026-10-17.md](GLOBAL_SETUP_METHOD_AND_LANGUAGE_REVIEW_2026-10-17.md). This earlier audit remains a record of findings; its WAIT-centric proposal is superseded and must not be treated as the accepted release design.

## Decision

The supplied reports need a change to their decision model and presentation. Another replacement of a few status words will leave the underlying confusion intact.

Every report should answer four questions, in this order:

1. **Market view:** up, down, range, or mixed—and on which timeframe?
2. **Action now:** BUY, SELL, or WAIT, with one concrete reason.
3. **Next opportunity:** the price event that would permit a new entry, its stop basis and nearest objective.
4. **What changes the view:** a named price condition on a named timeframe.

`Invalidated` and `expired` describe a particular earlier entry attempt. They should appear in a short history record, not as the title of the current market analysis. A directional scenario can remain useful after an entry attempt ends; it must then be drawn as a possible market route, without active ENTRY/TP labels.

This document is an investigation and implementation proposal. Application behavior has not been changed by this audit. No reports were repurchased and no model calls or wallet transactions were made.

## What was inspected

Four supplied TXT files and four distinct PNGs were read and visually inspected:

| Frame | Report reference | Fetched, UTC | Last completed bar closed, UTC |
| --- | --- | --- | --- |
| 1H | `b5b24709` | October 17, 07:37 | October 17, 07:00 |
| 4H | `ef2fb6f4` | October 17, 07:40 | October 17, 04:00 |
| 1D | `4fdfd5fb` | October 17, 07:42 | October 16, 16:00 |
| 1W | `51c5f8d7` | October 17, 07:46 | October 11, 16:00 |

The second supplied 4H PNG is byte-identical to the first. Input hashes, copied originals and independent arithmetic are recorded privately in `.tmp/global-language-audit-2026-10-17/facts.json` and `originals/`. The source Downloads files were not modified.

The audit also traced the planner, context selection, prompt, chart annotations, report renderer and fresh-assessment rules. TXT/PNG alone do not contain the complete OHLCV and anchor arrays, so this audit does not claim a fresh independent recalculation of every indicator or Elliott count in these new reports.

## Findings in these four reports

| Frame | Actual information in the saved report | Clear current message |
| --- | --- | --- |
| 1H | Bearish main route; a previous sell test failed. The local up 1–2 wave hypothesis describes a bounce within that context. | **WAIT.** Watch a new sell test near 81,690.60; the earlier test does not support an entry. |
| 4H | Downside route toward 81,032.80 and then 80,400.00. The old sell-test window ended at 04:00 UTC, before the report was fetched. | **WAIT.** The market route is down; a new sell entry needs a new rejection and subsequent test. |
| 1D | The close, 81,354.60, is below the proposed 81,499.90 recovery trigger. The hypothetical buy offers only 0.41R to its first obstacle. | **WAIT. Skip this buy plan: reward is too small.** Recovery is unconfirmed. |
| 1W | A broader range/recovery possibility remains. The earlier buy attempt failed when the completed week's low, 80,400.00, breached its 80,636.30 boundary. | **WAIT.** A new weekly support test is needed before another buy can be assessed. |

None of the four exports establishes a current qualified entry. That conclusion should be easy to see without reading the historical bookkeeping. BUY or SELL must describe a qualified action, or an explicitly named future setup; a red market route alone is not a sell signal.

The previous validation checked calculations, rendering, delivery and entry gates, but missed these semantic conflicts. Future acceptance must assess the meaning of the headline, chart and action together.

### The daily LONG is misleading

At the worst planned buy price, 81,610.23:

- Planned loss to 79,958.68 is **1,651.55 per BTC**.
- Potential gain to the first obstacle, 82,285.00, is **674.77 per BTC**.
- `674.77 / 1,651.55 = 0.4086R`, before costs.

The existing policy requires at least 1.50R. The report correctly rejects that geometry, but its headline and prominent bullish ENTRY/TP route still advertise a long. A new close above the trigger would not repair the poor reward. The buy idea needs new structure or a separately justified entry; the engine must not tighten its stop or skip the first obstacle to make it look attractive.

The current 4H sell references produce approximately **6.57R**, the 1H sell references **1.82R**, and the weekly buy references **1.58R**. Those calculations agree with the TXT prices. Their old confirmation states prevent entry. A favorable hypothetical ratio is separate from an observed valid entry.

### Why 4H can fall while a daily recovery remains possible

Different timeframes need not point in the same direction. A 4H decline toward **80,400** can test a support area relevant to a daily recovery. The daily recovery would need its own subsequent evidence; it is not a current LONG because its price map contains an upside route.

For these snapshots, a useful explanation is:

> Intraday pressure remains downward. The daily recovery is unconfirmed below 81,499.90. On the 4H map, 81,032.80 and then 80,400.00 are downside reference levels. A later daily reclaim could reopen recovery toward 82,285.00 and 82,556.60, but the present daily buy geometry is unattractive.

That is an interpretation of the supplied maps, not a newly generated forecast. We should not force all four reports to say LONG or SHORT. We should make their horizons, conditions and relationship explicit.

### The candles are not using one session convention

The 4H report's context is **1Dutc**, while the standalone daily report is **1D**, whose session ends at 16:00 UTC. Likewise, the daily context uses **1Wutc**, while the separate weekly report uses **1W**. Their SMA55 values consequently need not match: the supplied daily context is 81,068.71 versus the standalone daily value of 81,094.97; the weekly context is 80,573.35 versus the standalone weekly value of 80,501.26.

OKX documents separate UTC+8 and UTC+0 calendar candles. These are different observation windows, not rounding errors. New reports should use one explicit convention across the hierarchy, preferably UTC. Existing purchased reports must retain their original session and data. [OKX candle documentation](https://app.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks)

## Root causes in the implementation

| Component | Current behavior | Consequence |
| --- | --- | --- |
| `packages/analysis/src/globalReport.ts`, `prepareGlobalReport` | Initial main route uses close versus SMA55 and its ten-bar change. Elliott orientation is calculated separately. | A down-wave candidate can coexist with a bullish main recovery route without a concise reconciliation. A moving-average filter is given too much explanatory weight. |
| Same file, `finishGlobalReport` | The model may change `mainPathId`, after which the directional trade plan is recalculated from that path. | The narrative selects the route that determines the trade side. Prompt instructions cannot alone guarantee a consistent selection across reports. |
| `packages/domain/src/globalTradePlan.ts` | A plan is derived from the main route even when confirmation has failed or its geometry is rejected. A range's side is selected by proximity to its boundary. | A hypothetical directional plan is easily mistaken for the current action. Range proximity alone does not establish a buy or sell edge. |
| `globalReport.ts`, `evaluateGlobalSetup` | The separate Spot setup searches for an upward path. | A bearish report still contains a second, unrelated buy/watch/history card. Weekly main-range and alternative-recovery targets also compete. |
| `globalReport.ts`, context construction | `supports/conflicts` means above/below the context SMA55, always in relation to recovery. | “Conflicts” beside a short can describe evidence that actually supports the short. The relation is not to the selected plan. |
| `packages/domain/src/globalPolicy.ts`, `globalEligibility` | Saved eligibility does not include the fresh assessment's side-aware context gate. | A reader can satisfy the printed confirmation checklist and discover another blocker only at recheck. |
| `packages/domain/src/globalPresentation.ts` | The title concatenates eligibility, a reason and the retained research side. | “NO TRADE … Conditional long / Spot buy” reads as two opposing instructions. |
| `packages/domain/src/globalChart.ts` | ENTRY, TP markers, reference risk bands and bold primary routes are drawn for rejected, expired and failed plans. | Geometry implies an available trade while surrounding text says otherwise. |
| `apps/web/src/GlobalResearchReport.tsx` and shared text sections | Directional plan, Spot plan, historical attempt, evidence and risk prose repeat related facts. | The user must reconcile several apparent plans and a long footer. |
| `packages/analysis/src/prompts.ts` | Extensive instructions require narration of internal states and historical exceptions. | Internal terms leak into prose, despite the intent to produce simple reports. |

The fresh assessment already interprets context relative to the trade side for its execution gate. That distinction should be represented consistently in the saved report and every output; it should not be a surprise at the trading step.

## What the external research supports

Vilarso's accessible public guide distinguishes activity/horizon settings, price levels and buy/sell signals. It also says an alert is a prompt to inspect the market, rather than an instruction to trade immediately. The transferable lesson is a readable decision around levels and trend, with a clearly identified horizon. [Public Pro guide](https://t.me/s/vilarsopro?q=%23VilarsoPro)

In an accessible BTC example, the author distinguishes an upward wave route above a key level and a downward correction below it. His other examples distinguish buying, selling and standing aside. We should adopt that conditional clarity. [Public examples](https://t.me/s/VilarsoPro?before=56)

The author's TradingView Pro description covers average price, volume, volatility, candle patterns and regression; it also explains that an open candle's signal can disappear. It is an invite-only script. His Trend oscillator is a separate protected script. The accessible sources do not reveal the complete proprietary method, establish its profitability, or prove that PULSE's pivot detector reproduces it. I reviewed the accessible public material; private lessons, the complete video archive and proprietary source were not available for exhaustive review. [Vilarso Pro](https://www.tradingview.com/script/G6hpaqTy-vilarso-pro/), [Vilarso Trend](https://www.tradingview.com/script/c9nPoO7m-vilarso-trend/)

TradingView documents higher-timeframe indicators as broader context and distinguishes completed higher-timeframe values from developing values that can repaint. Its Long/Short drawings present entry, stop, objective and risk/reward together. Those are useful presentation principles; the drawings do not choose a winning strategy. [Timeframe guidance](https://www.tradingview.com/support/solutions/43000591555-leveraging-multi-timeframe-analysis/), [Position drawings](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/)

The application already uses TradingView Lightweight Charts. Switching chart libraries would not correct plan selection or contradictory wording. Advanced Charts is a separate integration; neither library supplies access to Vilarso's private logic. [TradingView library comparison](https://tradingview.github.io/lightweight-charts/docs/product-comparison)

## Proposed report contract

### One decision, one explanation

Use separate typed fields for `marketView`, `currentAction`, `nextSetup`, `contextRelation` and `previousAttempts`. Preserve machine status codes for audit and agent compatibility; translate them into a useful current decision for people.

| Internal evidence | Main visible wording | Detail |
| --- | --- | --- |
| Failed earlier confirmation | **WAIT — new sell/buy test needed** | One sentence under Previous attempt names the failed level and closing date. |
| Old entry window ended | **WAIT — new sell/buy test needed** | History names when the previous window ended. |
| Insufficient reward | **WAIT — skip this buy/sell plan** | “First objective offers 0.41R; required minimum is 1.50R.” |
| Missing close confirmation | **WAIT — price must close above/below X** | State the exact timeframe and event. |
| Confirmation observed, retest absent | **WAIT — retest X** | Show the required later test and its deadline. |
| Technical evidence and context pass | **BUY setup confirmed** or **SELL setup confirmed** | Qualify with the assessment time; obtain a fresh amount-specific quote for order review. |

BUY means acquiring Spot BTC. SELL means selling BTC the user owns. A leveraged SHORT remains a research direction unless a supported execution product is explicitly added. Show that distinction once near the relevant trade control, not inside every headline. Long/short direction can appear in a compact detail field, while the main action remains BUY/SELL/WAIT.

A saved report must say what was true at its snapshot time. A static PNG never silently becomes a live BUY or SELL. The app's recheck supplies a separate current assessment.

### One market hierarchy

Build a shared completed-candle evidence package for 1W, 1D, 4H and 1H at one cutoff, with an explicit session convention. Each frame retains its own last close, structure and confirmation event. Summarize it as a small matrix with one relationship sentence: for example, “4H decline inside an unconfirmed daily recovery.” Fifteen-minute entry analysis, when requested, must be named separately; it must not silently replace daily or weekly confirmation.

Use confirmed swing structure, relevant broken/reclaimed levels and trend measurements to explain the view. An SMA position alone is not a complete higher-timeframe trend classification. Context should identify its actual direction and its relation to the selected plan: **aligned, opposing, mixed or unavailable**, with the reason and candle-close time.

Do not force unanimity across horizons. When the existing execution policy blocks opposing or unavailable context, include that blocker in the printed next-step checklist. Any future policy allowing countertrend entries needs explicit validation rather than a wording change.

Quick and Pro should share essential decision rules. The proposed shared evidence package changes Quick's current primary-only input policy; introduce it deliberately, rather than claiming Quick already has independent context. Quick displays the selected chart, one action/reason, essential context conflict and the next condition. Pro adds the full timeframe matrix, independent context chart, detailed Elliott/level evidence, optional studies and explanation of alternate routes. More indicators should not be the main reason to upgrade.

### Evaluate plans before asking the model to explain them

Calculate and evaluate the relevant upward and downward candidates independently. Choose the market view separately from an executable plan. Prefer no entry over a forced plan; allow at most one primary trade candidate for the selected horizon. Keep other routes as conditional market information.

Freeze direction, objective order, entry evidence, geometry and action before narrative generation. Supply Grok with these facts and require a short explanation. Remove its ability to change the executable plan by selecting another `mainPathId`; if it identifies a conflict, record an analysis limitation instead. Add deterministic semantic validation after generation.

The current ATR buffers are not proven strategy parameters. Preserve a stop beyond its actual structural boundary and observed retest; do not squeeze it to improve reward. Explain distance in percent and selected-frame ATR compactly. Validate stop choices on replay and out-of-sample data before claiming better performance. Daily and weekly entry refinement on a smaller timeframe would be a separately named plan with its own evidence.

## Concrete replacement using these reports

**BTC · 4H — Downward pressure**

**Action: WAIT — a new sell test is needed.**

While below 82,556.60, the downside references are 81,032.80 and then 80,400.00. The earlier entry window ended at 04:00 UTC. For a new sell candidate, wait for a return to 82,556.60, a completed 4H rejection close, and a later failed retest. The daily context still leans toward recovery, so that relationship must be reassessed before order review.

Watch area: 82,511.57–82,556.60. Planning stop: 82,736.73. These are prospective references, not an active trade. Reclaiming the resistance and holding it changes the bearish route. The daily and 4H candle sessions in this legacy report differ.

**BTC · 1D — Recovery unconfirmed**

**Action: WAIT — skip the current buy plan.**

The last daily close is below 81,499.90. Reclaiming and holding that level would reopen recovery toward 82,285.00 and 82,556.60. At the saved entry/stop references, the first objective offers only **0.41R**; confirmation alone would not make this buy attractive.

The 4H downside route can test the daily support area around 80,400.00. A daily failure there would strengthen the bearish case. A new buy requires a better supported entry structure and adequate reward, rather than another bullish label on the current plan.

**BTC · 1H — Bounce within intraday weakness**

**Action: WAIT — a new sell test is needed.**

Watch 81,690.60 for a fresh completed rejection and subsequent test. Downside references: 81,523.90, then 81,404.30. Reclaiming and holding 81,690.60 would reopen the recovery alternative. The local upward 1–2 hypothesis describes the bounce; it does not establish a larger uptrend or a buy signal.

**BTC · 1W — Range; fresh support test needed**

**Action: WAIT — no confirmed weekly buy.**

The earlier support-buy attempt failed below 80,636.30. A new completed weekly support test and later held retest are needed around 82,842.00 before evaluating another buy. The next weekly close is October 18 at 16:00 UTC in this saved report's session. The first overhead reference is 89,111.00. An intraday decline does not by itself constitute a new completed weekly signal.

## Chart and document layout

1. Put **market view + action + one reason** above the candle chart. Name the candle session and the snapshot time in a small subtitle.
2. Default to one principal market route and one material alternative. Use consistent up/down colors. Expand further alternatives on request; remove arbitrary route quotas.
3. For WAIT, show **watch/retest levels** and **support/resistance objectives**. Rejected daily buys and old expired attempts do not get bright ENTRY/TP markers or active risk boxes. Keep the underlying market route visible.
4. For a qualified setup, draw a compact entry/stop/objective box using the same canonical prices as the trade card. The app still rechecks evidence and costs before order review.
5. Keep candles, one trend average, relevant structure and volume in the default view. Pro keeps RSI, context and optional Fibonacci/VWAP/regression. Add studies for a specific question, not as extra votes.
6. Make Structure view expose the older Elliott anchors. The current weekly 24-bar setup crop shows B/C but hides the earlier 1–5 sequence; do not make that crop look like a complete displayed count. Explain partial counts in one sentence; put rule details in an expandable section.
7. Reduce the PNG footer to action, next condition, change-of-view level and qualified risk details. Move old attempts and technical methodology into history/details. TXT uses the same order. The default report should not include a long archive list such as the weekly 1.00 historical low; retain such data only in a clearly separate provenance appendix.
8. Use the same decision object in web, Telegram message/caption, PNG, TXT, MCP and agent delivery. Preserve Market/Limit Spot review and observed TP/SL handoff. Manual trading stays a separate user choice and is not evidence that a setup is confirmed.

## Implementation order and acceptance

**First:** introduce the shared human decision summary, remove contradictory headings, demote old attempts, and condition chart trade markers on actual eligibility. Add source- and side-aware context wording. Retain old machine codes and purchased data.

**Second:** unify new-report sessions/cutoffs, calculate the full hierarchy, evaluate candidate plans before narration and freeze the chosen decision. Version new methodology explicitly; never recalculate old paid reports silently. Preserve service endpoint names, prices and input contracts; review any additive delivery-schema changes for MCP/ASP discovery.

**Third:** update Quick/Pro prompts, Telegram summaries and illustrated docs. Replay these exact four snapshots locally, then inspect screenshots before any paid regression. This audit authorizes no additional purchases.

Acceptance must cover meaning as well as rendering:

- A 0.41R rejected buy has WAIT as its current action and no active buy ENTRY/TP box.
- Failed and expired attempts produce a fresh next-step instruction plus a separate historical record.
- A down 4H map and an unconfirmed daily recovery receive an explicit relationship sentence, without asserting an active daily LONG.
- Equivalent daily/weekly evidence reused across reports has the same session, source, cutoff and indicator values; legacy differing sessions remain labeled.
- Bearish higher-timeframe context reads as aligned with a sell candidate, rather than “conflicts with recovery.”
- The printed checklist includes every blocker that the fresh assessment would enforce; a user is not promised readiness after satisfying only some conditions.
- Headline, route labels, trade card, Telegram and downloads resolve the same action and prices. Pro never promotes a remote level to a nearer target to improve reward.
- A genuinely qualified BUY or SELL case is also exercised through the appropriate quote/order review; the system must not merely produce WAIT for every fixture.
- Desktop/mobile zoom, indicator toggles, PNG label placement, complete Elliott-anchor access and Telegram length limits pass visual inspection.

The reviewable language/layout prototype is `.tmp/global-language-audit-2026-10-17/proposal.html`. It uses the supplied snapshot numbers and preserves the originals for comparison. It is a proposal, not a new analysis or a changed application.

The prototype passed all eight frame/viewport combinations at widths 1440 and 390, with no runtime exceptions or horizontal page overflow. Desktop daily and mobile 4H screenshots were inspected. This validates the prototype's presentation, not a deployed implementation of the proposed strategy changes.
