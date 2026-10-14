# BTC report setup audit — 14 October 2026

The three supplied BTC Pro TXT/PNG reports were checked against their original X Layer report JSON and completed market candles. The stored snapshots remain unchanged. Their observations are 13 October at 21:14:06 UTC (1D), 21:19:24 UTC (4H), and 21:23:57 UTC (1W).

## Findings and resulting behavior

The original planner evaluated only an upside reclaim followed by a retest. A rising daily market with one resistance target had no upside path because that path required a further overhead level. Bearish and range paths supplied market targets without a priced directional plan. The model could also erase a cancelled setup by returning a null setup ID: the 4H and weekly reports lost their cancellation state and mapped conditions this way.

The wave engine considered one scale of three-bar fractals and assigned every count “minor.” That missed broader structures. Full-history PNG scaling compressed the recent setup, and remote levels could enlarge the price scale. Missing execution costs correctly prevent a Ready Spot buy; those costs must not be invented to make an analysis appear actionable.

The revised report has one primary directional research plan aligned with the main path. It retains conditional alternatives and separately preserves the actually observed Spot buy setup, including cancellation and expiry. A rising market can use a support-pullback plan with one valid overhead target. An unclear or disputed wave hypothesis does not disable support/resistance planning.

The plan supplies these explicit references:

- Planned entry allowance: the mapped trigger through at most 0.05 × saved ATR14 in the trade direction, capped at one quarter of the distance to the first target. A close obstacle is never discarded to claim reward to a farther target.
- Planned SL: beyond the structural invalidation by 0.2 × saved ATR14. It is labelled as a reference, not observed protective SL.
- Targets: the canonical path levels. Gross R:R uses the nearest target and the least favorable planned entry. Below 1.50 means avoid entry, with the reason preserved.
- Confirmation: completed closes and subsequent tests on the selected timeframe. Old failed or expired confirmations do not authorize entry. Costs and net R:R require an execution quote.

Nearby secondary targets are limited to four ATR from the completed close; the nearest mapped obstacle is retained. Paths are not added to satisfy a quota. The primary arrow includes the planned pullback/rejection/retest route before its targets. Observed protection and planning references use distinct labels.

## Reproduction on the supplied snapshots

These are **historical conditional references**, not current trade recommendations or observed fills.

| Snapshot | Primary plan | Planned entry | Planned SL reference | Mapped target(s) | Gross R:R | Remaining condition |
| --- | --- | --- | --- | --- | --- | --- |
| BTC 4H | Short thesis / sell owned Spot | 83,489.29–83,530.10 | 83,693.34 | 83,174.70 → 82,902.80 | 1.54 | Subsequent failed resistance test; price in the zone |
| BTC 1D | Support-pullback long / Spot buy | 82,556.60–82,665.62 | 81,848.94 | 87,399.00 | 5.80 | New completed support hold, subsequent held test, and price in the zone |
| BTC 1W | Range-support long / Spot buy | 82,842.00–83,154.70 | 79,385.51 | 89,111.00 | 1.58 | Prior confirmation failed; a fresh valid support hold, subsequent test and price in the zone are required |

The original observed buy setups are cancelled on all three replays and have no executable entry or protection to copy. The new references are conditional planning information; they do not turn those cancelled setups into ready orders.

## Wave and chart rules

Confirmed swings are compared at 0, 1, 2 and 3 ATR deviation scales using ATR known at each pivot's confirmation. Alternating extrema must have valid price geometry. Invalidated origins are rejected. Full impulse hypotheses apply the origin, wave-three-length and wave-four-overlap checks. Partial 1–2 and 1–2–3 counts explicitly identify unobserved later waves. Internal subwaves are unverified; the report describes a local swing hypothesis rather than assigning a theoretical Elliott degree.

On these candles, the measured candidates are 4H local 1–2, daily 1–5/A, and weekly 1–5/ABC. The model may decline a candidate; it cannot alter numeric evidence or erase an observed setup state. The [Elliott Wave International impulse reference](https://www.elliottwave.com/waveopedia/impulse/) describes subdivision and overlap requirements, which is why swing-only labels remain hypotheses.

Fibonacci uses a confirmed impulse leg: origin to wave five for a full impulse, origin to wave one for a partial 1–2, or origin to wave three for a partial 1–2–3. Without a supported count it uses the saved confirmed swing. The two-ATR eligibility rule and standard seven retracement ratios remain. Protected Vilarso indicators are not claimed or reproduced.

PNG/phone overviews show 180 recent candles and state the shown/saved counts. Interactive Full history retains the entire archive; Zoom to setup focuses the latest 64 bars. The wave origin remains available in its evidence, without forcing a distant origin into the displayed trade-level list. The illustrated app guide adds a historical 4H directional-plan image with provenance.

## Execution and compatibility

Market and Limit buys retain observed, unexpired entry/TP/SL handoffs. Conditional reference prices never become observed protection. A bearish report can open a manual Market or Limit sell draft for owned Spot inventory, with quantity and execution price reviewed in Spot. Hypothetical short TP/SL are not copied to that sell or inverted into a buy. The Telegram handoff preserves the side and order type while ignoring URL price overrides.

The new canonical `tradePlan` field is optional for old `pulse-global-v3` reports. Older saved JSON and Markdown stay immutable. Their viewer can derive a planning view from the saved map. New generated reports include the directional plan in full delivery, TXT, PNG and Telegram views. The deployed-delivery validator checks historic documents against their original sections and requires the new section when the delivered report contains `tradePlan`.

## Validation

Only public OHLCV/timeframes are retained in the committed BTC regression fixture; wallet, receipt, recovery, user-note and provider-prose fields are excluded.

- Analysis: 46 tests; domain: 25; web: 184; focused API delivery/Telegram/discovery: 19. All pass with no skips.
- Four explicitly approved live Grok 4.5 tests: Pro 4H/1D/1W with medium reasoning and Quick 1D with low reasoning. The model retains the supplied wave candidates and cancelled setup facts. Prompt inputs contain only market/indicator evidence.
- Live-result Telegram captions: 508–577 characters; overviews: 2,064–2,595 characters. Full documents and PNGs retain planning and cancellation conditions.
- Desktop/mobile web and Telegram Mini App: 28 browser cases, including the six-image guide; no runtime errors or horizontal overflow. Telegram host/library reads are mocked, and browser mutations are blocked. No Telegram messages or trading transactions are sent.
- Actual zoom-in/zoom-out with all studies enabled is checked separately on desktop and mobile, including chart preservation and unchanged time position when studies are toggled.
- Schema, domain, analysis, API and web production builds pass. Chart/TXT outputs and targeted desktop/mobile screenshots are visually inspected before acceptance.

Private live-result previews are in `.tmp/btc-report-qa/`; renderer/browser evidence is in `.tmp/btc-local-render-qa/`. They are local validation artifacts and are not committed. Publishing the implementation requires the user's deployment of the local commit; the existing deployment is the earlier discovery fix.

## Follow-up on the four supplied 14 October reports

After the user deployed `ceb65c9`, the four attached TXT/PNG reports were matched to their existing paid deliveries through read-only wallet history. The matching observations are 09:51:55.972 UTC for 1H (Arbitrum), 09:50:46.136 for 4H (Arbitrum), 09:31:39.586 for 1D (Base), and 09:30:09.961 for 1W (X Layer). This investigation purchased no reports, called no model, placed no trade and sent no Telegram message.

| Report | Finding | Resulting behavior |
| --- | --- | --- |
| 1H | The purported range-support confirmation candle had a low of 83,176.40 below its 83,230.00 structural boundary; the next supposed test also breached it. Calling the attempt merely expired concealed an invalid original test. The chart emphasized recovery targets of 83,960/84,200 instead of the primary plan's 83,858.20. | Reject the original confirmation. Keep planned prices, require fresh confirmation and a subsequent test, and label the primary target TP1. |
| 4H | Primary short gross R:R is 1.63, while the alternative observed buy has entry 83,530.10–83,584.00, SL 83,160.61, and gross R:R 0.71. Provider risk prose incorrectly suggests that the retest/protection is not observed; actual blockers are costs and reward. | Preserve the observed buy protection for explicit manual Market/Limit review, identify it as alternative buy evidence, show its 0.71 reward warning, and keep its prices separate from the short plan. |
| 1D | A subsequent candle low of 81,032.80 broke the 82,285.00 boundary after a support hold. One evaluator cancelled the observed attempt while the directional evaluator kept future planning active without describing that failure. | Use one confirmation evaluator and require a new valid support test; keep the previous failed attempt as a dated record. |
| 1W | A candle low of 80,400 broke the 80,636.30 boundary. Directional confirmation survived because the wider reference SL was 79,385.51; the observed evaluator cancelled. The chart showed two recovery targets while the primary range plan had one. | Structural-boundary checks reset the confirmation before a wider reference SL is reached. Primary ENTRY/TP1 match the range plan; the recovery alternative retains its own two targets. |

Both evaluators now use the same completed-candle qualification, subsequent-test, failure and expiry rules. A failing candle cannot restart its replacement. A later valid test can rearm an expired or failed attempt and still requires a later held test. When rejection trigger and invalidation coincide, touching that line is necessary for the test; its failed close invalidates it. A wider planned SL never substitutes for the structural qualification rule.

Saved JSON and original Markdown remain immutable. The viewer preserves purchased prices and downgrades unsupported old confirmations, with a visible correction notice. Historical provider prose is preserved and explicitly identified as predating that correction. Revised prompts require all blockers, distinguish observed protection from executable readiness, separate alternative reward from primary reward, and explain that wave 2 retraces opposite the impulse orientation. These prompt revisions have not been sent to a live model, respecting the user's request to use existing reports.

The chart numbers each arrow to match its main/alternative title. Primary ENTRY and TP1/TP2 use canonical primary-plan levels; alternative recovery is visually distinct. Labels for observed alternative-buy SL join the collision layout. WAIT appears in unconfirmed primary headings. Telegram captions use primary support-hold/rejection conditions and identify historical cancellations separately. The first guide image is refreshed from the public daily numeric evidence; the five older study illustrations are labelled as historical S1/S2/S3 examples.

Local validation evidence is in `.tmp/btc-oct14-review/`. All four report exports preserve primary prices across PNG/TXT/caption and leave the stored report unchanged; captions are 699–771 characters and messages 2,686–2,999 characters. Desktop and phone web/Telegram Mini App rendering passed 20 cases, including all-study and illustrated-guide views, with no runtime errors or horizontal overflow. Telegram hosting/library reads are mocked, and browser mutations are blocked. Market/Limit handoff checks preserve observed, unexpired protection and never copy research-only short references.

Final local checks: 29 domain checks, 19 analysis checks, 9 Telegram export/delivery checks and 11 web/Spot handoff checks passed (68 total; no failures or skips). Domain, analysis, API and web production builds passed. The four original PNGs, revised exports, desktop native chart with all studies, mobile Telegram primary-plan card and phone guide were visually inspected. The revised live-model prose and deployment remain unverified until the user publishes this follow-up; no further live model test was made.

## Follow-up after deployment of 78ad4c1: supplied 13:05–13:10 UTC reports

All eight newly supplied TXT/PNG files were inspected and matched to their existing paid JSON through read-only wallet history. The investigation uses those saved snapshots, not newly purchased reports or current market predictions. No model call, payment, trading transaction or Telegram message was made.

The planned entry, reference SL, target prices and least-favorable-entry gross R:R reproduce exactly on all four reports. Saved prices equal their last completed candle closes. SMA periods, Wilder RSI14 and ATR14 agree with recalculation from the saved candles. PNG, TXT and caption retain the primary plan's numeric references. The primary WAIT states are supported by the candle evidence.

| Timeframe | Primary thesis | Planned entry reference | Reference SL | Nearest target / further target | Gross R:R | Why entry remains avoided |
| --- | --- | --- | --- | --- | --- | --- |
| 1H | Conditional short / sell owned Spot | 82,744.74–82,767.40 | 82,858.04 | 82,627.18 / 82,277.20 | 1.04 | Below the 1.50 nearest-target threshold, with no valid confirmation or subsequent test; completed close is outside the zone. |
| 4H | Conditional short / sell owned Spot | 83,490.27–83,530.10 | 83,689.40 | 83,168.90 / 82,902.80 | 1.61 | Prior primary confirmation failed. A fresh resistance rejection and subsequent failed test are required; completed close is outside the zone. |
| 1D | Support-pullback long / Spot buy | 82,556.60–82,665.62 | 81,848.94 | 87,399.00 | 5.80 | Previous support attempt breached its structural boundary. Fresh support confirmation and subsequent test are required; completed close is outside the zone. |
| 1W | Range-support long / Spot buy | 82,842.00–83,154.70 | 79,385.51 | 89,111.00 | 1.58 | Previous range-support attempt breached its structural boundary. Fresh support confirmation and subsequent test are required; completed close is outside the zone. |

These are historical planning references, not observed fills or new trading recommendations. Confirmation alone cannot repair the 1H plan's insufficient gross reward. Selling owned Spot inventory is a separate manual decision; short research does not authorize a leveraged short. Current attempts have no observed entry or protective SL to copy. Existing Market/Limit handoffs continue to distinguish research references from observed, unexpired protection.

### Presentation and narrative defects

Three fresh reports displayed a misleading legacy correction warning. Their saved and recalculated blockers had the same members in a different order; all actual state and confirmation facts matched. The warning now compares blocker sets. Real legacy downgrades still display the correction notice.

The 4H Spot recovery attempt had confirmation on the October 14 00:00 UTC candle and an observed held retest on the 04:00 candle. The 08:00 candle, completed at 12:00, had a low of 83,031.20 below the 83,168.90 floor and cancelled that protection. Provider prose claiming that a retest never occurred is inaccurate. The active setup deliberately clears its prices and retest timestamp on cancellation; that clearing must not be interpreted as historical absence. The evaluator now retains the prior retest in transient event evidence, and the rendered cancellation record states that the later failure cancels it.

The daily attempt failed on the October 12 16:00 UTC candle, completed October 13 at 16:00, whose low of 81,032.80 breached 82,285.00. The narrative attributed failure to an absent retest/window instead of that structural breach. Prompt evidence now supplies the actual failure candle, completed time, reason and relevant boundary for both the primary research plan and the separate Spot buy attempt. Those events must not be mixed: weekly primary range-support failure is distinct from its still-Watching recovery alternative. No held retest is reconstructed before the weekly primary failure.

The 1H prose describes poor net reward even though no execution quote exists. Its measured failure is poor **gross** reward to the nearest target. Prompts now distinguish gross reward from unknown costs/net reward, and the chart/TXT/UI action line explicitly retains the reward gate after confirmation.

Original paid JSON, Markdown and provider prose remain unchanged. New structured renderings add factual history and price-reference clarity; prompt corrections apply to future generation. No new live-model response has been obtained to verify compliance with the revised instructions.

### Time references and Elliott counts

The new header identifies the last completed close and its UTC closing time separately from when evidence was fetched:

| Timeframe | Saved completed close | Candle closed, UTC | Evidence fetched, UTC |
| --- | --- | --- | --- |
| 1H | 82,739.00 | October 14, 13:00 | October 14, 13:10:26.030 |
| 4H | 83,476.60 | October 14, 12:00 | October 14, 13:08:50.350 |
| 1D | 83,430.60 | October 13, 16:00 | October 14, 13:05:18.369 |
| 1W | 83,902.10 | October 11, 16:00 | October 14, 13:07:10.779 |

These prices are different completed bars, not contradictory live quotes. The selected OKX calendar bars preserve their actual UTC boundaries. Charts label LAST CLOSE, and TXT, UI and Telegram state that the reference is not live. Entry-zone blockers likewise refer to the completed close and require a fresh execution quote.

The saved candidates pass independent basic price-geometry and pivot-availability checks: 1H has a downward partial 1–2, 4H an upward partial 1–2, daily a local 1–5/A, and weekly a 1–5/ABC hypothesis. The weekly C extreme is below A. A label identifies a confirmed candidate pivot, not necessarily the currently developing leg; a subsequent downward move alone does not establish a confirmed hourly wave-three pivot. Internal subdivisions remain unverified. Full [impulse](https://www.elliottwave.com/waveopedia/impulse/) and [zigzag](https://www.elliottwave.com/waveopedia/zigzags/) structures require subdivision evidence beyond these swing checks. Opposing intraday and broader conditional directions are allowed; independent context and all entry blockers remain explicit.

### Local validation and review artifacts

All 84 local checks pass with no skips: 30 domain, 25 analysis/mocked-provider, 15 Telegram/delivery and 14 web/report-handoff checks. Domain, analysis, API and final web production builds pass. Regression coverage includes blocker-order invariance, genuine legacy correction notices, previous retest capture without restoring protection, completed daily closing times, reward gates and multilingual Telegram budgets. Captions for the four saved reports are 840–941 characters; overview messages are 2,745–3,035.

Desktop and phone web/Telegram Mini App rendering passed 20 cases, with two additional guide cases after the final guide update. No runtime errors or horizontal overflow occurred. Telegram host/library reads are mocked; browser network mutations are blocked. Chart preservation and Fibonacci availability are checked with all studies enabled. All four revised PNGs, native chart with all studies, mobile primary-plan card and final phone guide were visually inspected. The first guide image now uses the public numeric evidence from the supplied 13:05 daily snapshot, with provenance; the guide explains closing times, gross-reward gating and historical protection.

Local review artifacts are under `.tmp/btc-oct14-13-review/`, including immutable-snapshot renderer fixtures, four exports, arithmetic/event summaries, wave checks and screenshots. They are not committed. This follow-up still requires deployment; revised provider prose has not been live-tested, as requested.
