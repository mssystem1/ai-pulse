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
| BTC 1W | Range-support long / Spot buy | 82,842.00–83,154.70 | 79,385.51 | 89,111.00 | 1.58 | Price in the planned zone; recheck the saved confirmation and execution quote |

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
