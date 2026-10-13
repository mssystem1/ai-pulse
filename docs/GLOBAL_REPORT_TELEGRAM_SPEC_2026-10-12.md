# Global reports in Telegram — audit and revised design

Final implementation evidence includes [Telegram chart/caption/message examples](previews/timeframes/telegram-preview.html) and [desktop/Mini App views at every report timeframe](previews/timeframes/native-preview.html). The original 1H planning artifacts remain below for comparison.

12 October 2026 specification; implemented and validated locally on 13 October. This extends the accepted [chart and setup design](GLOBAL_REPORT_CHART_SPEC_2026-10-12.md) to bot delivery and Telegram report views. New Global reports use the same canonical map across PNG, message, TXT, web and Mini App. See the [final validation record](GLOBAL_REPORT_VALIDATION_2026-10-13.md). The original planning previews below are retained for comparison.

[Open the Telegram Quick / Pro preview](previews/telegram-global-reports.html). It includes the message, matching chart attachment, TXT download and Mini App setup card. Switch tiers to compare. The SOL levels are historical screenshot references; all candle, wave, indicator and 4H evidence is synthetic. The illustration uses an 08:00 UTC snapshot after its final 07:00 UTC 1H bar.

Chart exports: [Quick](previews/telegram-global-quick.png), [Pro](previews/telegram-global-pro.png). Message examples: [Quick](previews/telegram-global-quick-message.txt), [Pro](previews/telegram-global-pro-message.txt). Complete TXT examples: [Quick](previews/PULSE-Global-Quick-SOL-USDT-1H.txt), [Pro](previews/PULSE-Global-Pro-SOL-USDT-1H.txt).

## Original findings and required migration (implemented)

| Surface | Current behavior | Required revision |
| --- | --- | --- |
| Bot message | `apps/api/src/telegramResearch.ts` uses featured sections from the generic shared presentation. Quick and Pro have the same section structure. | Curate a short Global summary from the canonical map; Pro adds measured evidence, context conflicts and a third material path when supported. |
| Shared presentation and TXT | `packages/domain/src/researchPresentation.ts` reads the execution plan, separate price targets, key levels, wave paths and technical count independently. | One set of level IDs and one linked setup. Remove conflicting repetition; preserve complete useful analysis in the TXT. |
| Chart attachment | `packages/domain/src/researchChart.ts` returns null for Quick. Pro draws a close-price line, deterministic labels and AI/fallback targets. | Candles, validated wave anchors, tier-specific indicators, activation points and S1/S2/S3 from the same payload as the report. Both Global tiers get charts when saved evidence supports them. |
| TON Mini App | `apps/web/src/TelegramResearchReport.tsx` renders the generic sections and the same Pro-only SVG. | Same core report component or shared presentation contract as web: chart, immediately attached Spot card, concise possible moves, Pro evidence/context and full TXT. |
| First delivery | `apps/api/src/telegram.ts` sends TXT, summary, then chart. A null chart is treated as successful delivery. | Lead with the chart and useful caption, then summary and full TXT. Missing evidence gets an explicit explanation; a failed render stays pending. |
| Reopening | `apps/api/src/telegramBotChat.ts` has a separate TXT → message → chart sequence for `report:<id>`. | Reuse the same delivery presentation and parts builder as first delivery, using the saved snapshot and language. |
| History | A completed order is labelled `Ready`, which can be confused with a trade setup being Ready. | Distinguish `Report ready` from setup `Watching` / `Ready` / `Expired` / `Cancelled`. |
| API full Markdown | `apps/api/src/reportDelivery.ts` recursively exports arbitrary top-level fields. The fixture's provider dump and image payload are included. | Route new Global reports through the same curated content contract; exclude raw provider text, token usage, binary chart data and internal transport fields. Preserve other services' existing content contracts. |
| Language and units | Shared report headings and Telegram copy are hardcoded English. Global formatting does not consistently identify the quote currency or venue. | Localize headings, captions, statuses and buttons for the supported report language; show instrument, venue, quote currency and timeframe consistently. |

Local read-only reproduction used the existing BTC research fixture, with no model calls or Telegram requests:

- Quick chart: absent. Pro chart: present.
- Both tiers: identical section titles; messages 1,229 and 1,227 characters respectively.
- Execution trigger: 63,100. Path sequence: `Break 63000`. Both appear in the full TXT without a shared level reference explaining the difference.
- Curated Telegram TXT/message omit fixture provider and private transport fields. Keep that explicit allowlist behavior.
- Generic full Markdown includes the fixture's raw provider and image markers. This is a separate export path, not evidence that the current Telegram formatter leaks them.

## Message and delivery design

One purchase produces three parts, all derived from the same saved, versioned report:

1. **Chart photo with a compact caption.** Pair, venue, timeframe, quote currency, snapshot time, current action and setup state. Include S1 confirmation, S2/S3 targets and cancellation so the image remains understandable when viewed alone. The image itself has the linked setup band.
2. **Useful summary message.** Current wave hypothesis and uncertainty; main move and conditional alternative; one linked Spot plan with confirmation, targets, cancellation and pending or priced execution fields. Pro adds observed trend/momentum/volatility/context evidence and an optional third branch.
3. **Full research TXT.** The complete curated paid analysis, including the reasons, count conditions, limitations and available evidence. It is supplementary to an already useful chart/message, not a raw schema dump.

Use inline actions for `Open full report` and `My reports`. Provide `Original chart PNG` through the owned report/download flow so users can inspect fine labels at full resolution. A Watching setup offers report inspection; any later Spot execution action must check fresh evidence and the execution contract.

The default messages should stay concise: approximately 900–1,600 visible characters for Quick and 1,500–2,800 for Pro, allowing localization to vary. The current conservative 3,900-character HTML budget can remain as a final guard. Telegram's `sendMessage` accepts up to 4,096 characters after entity parsing; photo/document captions accept up to 1,024. Use a caption budget below 900 and an appropriate PNG size; `sendPhoto` supports up to 10 MB with width plus height at most 10,000 and aspect ratio at most 20. [Telegram Bot API](https://core.telegram.org/bots/api#sendphoto), [message format](https://core.telegram.org/bots/api#sendmessage), [document delivery](https://core.telegram.org/bots/api#senddocument).

Use HTML-safe interpolation for plain text and price values. Budget required setup fields together: state, confirmation/retest, targets, cancellation and missing evidence. Trim optional explanations first. Do not truncate a condition halfway through or drop cancellation while retaining entry. Long instrument names, CJK text, ampersands and emoji must preserve valid markup and Unicode.

## Quick versus Pro

| Item | Quick | Pro |
| --- | --- | --- |
| Core decision | Current action, candidate count, key levels, one linked Spot plan | Same canonical core for the same snapshot, with deeper assessment |
| Possible moves | Main and one material alternative | Main and up to two supported alternatives; deeper stress branch only when justified |
| Chart | Candles, wave anchors, swing channel, SMA55, volume, setup stages | SMA21/55/144, regression channel, RSI14, ATR14, measured volume and actual 4H context; optional layers in the full report |
| Message | What matters and what must confirm | Why the setup is supported or conflicted; observed indicator/context measurements and reward constraints |
| TXT / Mini App | Clear core analysis and conditions | Count rationale, context conflicts, costs/net reward, expiry, recount rules and indicator methods |

The paid difference is richer evidence and a richer chart. Pro must not repeat five moving averages as five independent votes, turn an oversold RSI into a buy signal, or fabricate an R:R for an unformed retest. Missing Pro context is explicitly unavailable rather than silently treated as confirmation.

## Setup alignment in the SOL design

The main view remains the candidate correction below 117.30 toward 113.12 and then 109.93. The amber recovery branch is conditional, and its single Spot plan is **Watching** while the action stays **Wait**:

- **S1:** completed 1H close above 117.30, followed by a retest that returns to that level and closes at or above it. The 113.12 floor must remain intact.
- **S2 / target 1:** 120.56. **S3 / target 2:** 124.80.
- **Entry, protective stop and R:R:** pending the actual retest.
- **Cancel:** completed 1H close below 113.12; or back below 117.30 after reclaim.
- **Pro third path:** close and held retest above 124.80 opens a possible move toward 128.00 and 132.74. Losing 124.80 after confirmation cancels this branch and requires reassessment. It needs a new count and setup assessment.

113.12 is structural/thesis invalidation, not an executable protective stop. After an observed retest, derive entry and stop from its real anchor evidence, then evaluate net reward to the nearest mapped resistance. Insufficient reward keeps Wait.

The preview's Pro measurements come from the accepted synthetic chart fixture: SMA21 117.46, SMA55 119.75, SMA144 120.40, RSI14 26.98, ATR14 1.05, volume 1.18× the preceding 20 bars, and 4H SMA55 119.60. They illustrate how to explain a recovery that conflicts with trend. Production uses saved, deterministic measurements; these numbers are not current market data.

## Snapshot, compatibility and delivery behavior

Persist a report version, canonical market/chart payload, level/path IDs, indicator settings, setup state, saved language and tier projection. The bot, web, TON view, TXT, Markdown and PNG resolve the same references. Number formatting uses the instrument's actual quote currency, tick size and price precision. Chart captions use the saved observation time rather than delivery time.

Reopening an older order is a read of its original purchased snapshot. Use a legacy adapter for existing report shapes and visibly identify historical/legacy evidence where needed. Do not run a new model call, recompute indicators using live candles, silently upgrade its strategy, or present an old Ready setup as currently executable. Completed order status and snapshot setup state are separate fields; fresh execution checks happen at handoff.

Use one shared parts builder for first delivery and `/reports` recovery across bot purchases, linked-wallet jobs and the TON Mini App. Retain ownership checks and existing chat-bound capabilities. Preserve per-part delivery acknowledgements across restarts; retry failed parts without deliberately resending acknowledged ones. Reordering parts must respect already delivered part keys during migration. Handle a failed chart or TXT independently so the useful overview can still arrive and the missing part remains queued. A delivery timeout can make acknowledgement uncertain; do not claim exactly-once delivery.

Distinguish two cases: insufficient saved OHLCV legitimately prevents a chart and needs a clear evidence limitation; an image-rendering or upload failure needs retry. Returning null cannot silently satisfy a promised chart when valid chart evidence exists. A supported unclear wave structure still gets a chart with `Count unclear`, rather than invented wave labels.

Keep changes scoped to Global Quick/Pro. Risk Guard and Prediction presentations and Autopilot pass notifications share delivery helpers but require their existing behavior and evidence. No wallet, payment or authorization redesign is needed for this report work.

## Implementation sequence and acceptance

1. Finalize the canonical Global map/setup contract and completed market evidence as in the chart specification. Telegram must not grow a separate numeric planning model.
2. Add a version-aware, curated Global presentation with localized labels and tier-specific evidence. Use it for bot summaries, full TXT, Markdown and Mini App sections.
3. Render both tier images from the same canonical chart payload. Reuse the installed `@resvg/resvg-js` PNG path and bundled font for server exports; use the same annotation geometry and indicator settings as the web chart.
4. Migrate first delivery and owned-report reopening to the shared parts builder, captions and download actions while retaining recovery and per-part retry behavior.
5. Update service descriptions and history copy to communicate the new tier benefit and distinguish report completion from setup readiness.
6. Verify real Global fixtures through web, TON, bot message, TXT, Markdown and PNG. Assert exact level/state parity, no provider/transport leakage, pending fields staying null, correct language/units and no new payment or model call on reopen.
7. Cover long localized summaries, chart-unavailable evidence, renderer/upload failure, partial delivery retries and legacy snapshots. Replace the existing tests that explicitly require no Quick chart; preserve unrelated service cases.

The Telegram acceptance criterion is that someone reading only the delivered chart and message can identify the current wave hypothesis, current action, main move, alternative activation, cancellation and setup state. They should not need to reconcile separate price lists or open the TXT to discover a missing condition.

Original planning-preview validation: PNGs, messages and setup stages matched the historical reference IDs, including nullable entry/stop/R:R and tier-specific indicators. These previews did not perform paid analysis. The subsequent implementation was tested with two real paid reports on Base and live Grok, with matching PNG/message/TXT conditions and free saved-report reopening. Telegram API delivery was mocked to validate partial failure and retry without sending messages. Nothing has been deployed; see the final validation record for evidence.
