# Trading Terminal: user-reported defects, 5 November 2026

This audit follows commit `cad1a69`. The previous API and selected browser checks did not establish the usability of every guide, appearance and trading workflow. In particular, they missed article width, actual appearance selection, current-price labeling and a live watch's evolving source clock. The corrections below keep these failures distinct from trading performance.

## Ten issues and corrections

| Issue | Finding | Correction |
| --- | --- | --- |
| 1. Broken app guides | New unnumbered articles were placed in a 42px grid column reserved for legacy section numbers. | Sole-child articles span the content grid. Responsive topic navigation and readable type apply across all guides and appearances. |
| 2. Difficult position entry | Base quantity, UTC timestamps, venue and comma-separated targets were presented together. | Enter market, trade type, direction, entry price and size. Size can be coins, position value at entry, or initial futures margin multiplied by leverage. Stop/targets and time/exchange are optional details. The opening timestamp and request identity survive a lost-response retry. |
| 3. Telegram behavior unclear | Delivery already required wallet ownership and confirmation in the bot, but the Terminal did not expose that link, its destination or the global/per-item gates. | The panel shows the verified wallet, configured bot and linking steps. Select event groups and included items, then enable delivery. Pausing cancels queued notifications while monitoring continues. The bot's Terminal deep link leads through the existing signed wallet-link and chat-confirmation flow. |
| 4. Timeline has no clear purpose | Generic events and source errors did not explain their relation to a watched item or delivery. | The timeline describes market, position and service events, source times and message delivery. Related events open their item. Source failures now have safe, specific reasons and recovery instructions. |
| 5. Market tools are disconnected tables | Six pages of recent executions were compared with broad day/week/month/cycle requests. A short sample often collapsed into one execution-frame bucket. | Show exact duration, count and source before the visuals. Add a volume profile, value-area reading, price aligned with CVD, shaded footprint cells, spread and depth. Adaptive display buckets use the same executions for price and delta; strategy execution candles retain their own timeframe. |
| 6. Radar's trading purpose is unclear | Circuit metadata did not tell a trader what to monitor, when to expect an observation, or how completion relates to an entry. | Start from a real value edge or saved chart level. Review three ordered candle conditions, confirmation speed, first eligible close, monitoring duration and Telegram status. Show actual stage timestamps and next required event. Warn when the current pass is too short for the chosen cadence. Creation retries retain the original detector and deadline. |
| 7. Different “current” prices across timeframes | The chart's default candle-series label represented a completed candle close. Daily and weekly closes are historical prices. | Use an independent timestamped asset ticker, shared across timeframe changes. Show a Current/Snapshot quote separately from the last completed close. A quote-only update must preserve inspection zoom; visible candle highs/lows and the quote participate in automatic scaling. |
| 8. POC, VAL and VAH unusually close | The underlying profile covered only a few minutes, not the full selected chart horizon. Small price differences were also obscured by generic display precision. | Preserve calculated prices and quantities. Expose the actual profile interval and trade count, use adequate precision for low-priced assets, and separate tightly spaced text labels. A narrow recent profile is not relabelled as a weekly profile. |
| 9. Enabled indicators hard to distinguish | The Clarity appearance made selected and unselected study buttons look similar. | Give enabled studies a filled, high-contrast state and explicit ON treatment, while preserving `aria-pressed` and unavailable-study semantics. |
| 10. Missing named markets | The initial suggestions listed only four markets. | Add BTC, ETH, HYPE, SOL, DOGE, BNB, Zcash/ZEC and OKB, with clear selected state and exact-pair custom input. All eight USDT pairs were checked against the public OKX live Spot instrument list. |

## The immediate weekly-watch defect

A live public-source reproduction exposed a second failure behind “Data needed.” A newer scenario lifecycle was inserted into the original immutable report. Its `updatedAt` then exceeded the report's original observation cutoff, so strict schema validation rejected the source with “A saved Global report is required.” The generic catch path concealed this distinction.

The saved report now remains an immutable, schema-valid source. Dynamic progress is a separately validated lifecycle override. The override must retain the original scenario definition, prices and deadlines, and cannot revive an ended source. Existing affected watch objects receive a narrow cloned-source repair rather than a permissive schema change. The same live weekly create/recheck/worker sequence now succeeds without the immediate interruption.

## What the tools can support

POC is the price row with the greatest executed volume; VAL and VAH bound the calculated value area in that same capture. They can be close when trading occurs in a narrow range. Spreading them apart to resemble a larger chart would manufacture levels.

The current public REST adapter retains a bounded recent tape. In one captured validation, BTC 1H contained 590 Spot trades over roughly 169 seconds, BTC 1W contained 595 over 174 seconds, and ETH 15m contained 591 over 191 seconds. These samples support recent participation inspection. They do not supply a complete daily/weekly/cycle profile or a historical order-book heatmap. Historical depth, full-session execution retention and liquidation maps require their own retained data feeds; they are not inferred from candle color or a book snapshot.

The interface applies independently implemented public order-flow patterns: [linked order-flow tools](https://mmt.gg/features/order-flow/), [volume/profile tools](https://mmt.gg/features/volume-profile/) and [aligned footprint cells](https://docs.mmt.gg/scripting/v3/examples/footprint-cells). MMT's [historical/live data API](https://docs.mmt.gg/api) is a separately authenticated service. No private MMT code, licensed feed or hidden strategy was copied. Its X account could not be read in this research session, so no post audit is claimed.

## Tapeout and the hackathon use case

The practical workflow is: choose a real value-area edge → review the ordered price conditions and observation clock → start Radar → inspect observed stages → receive an explicitly enabled wallet-linked Telegram event → review entry, protection and nearest target → record an actual fill separately if a trade was made.

Radar loads verified circuit logic from X Layer and evaluates it locally against ordered source candles. Private rules and prices remain offchain. Processor `0x839bdd6fa7a66416a609a735e11de5411b98574e`, circuit `2`, is imported through pinned public reads and checked before its logic is used. The integration does not put exchange prices onchain or send a transaction for each event.

The [official Build X Series requirements](https://web3.okx.com/xlayer/build-x-series) permit existing Tapeout circuits and offchain interfaces/computation. They require meaningful ecosystem use, a working access path and a complete user journey; an existing project must demonstrate substantial event-period work. A stronger demonstration shows an actual event progressing and a useful notification workflow, rather than only a registration address. Implementation and qualification do not establish that an entry will win a prize or a trade will be profitable.

## Validation evidence

Completed checks are recorded separately by scope:

- Docs: 331 checks covering all 22 topics, five actual appearance choices and 1440/900/390px widths; ten screenshots and zero browser exceptions.
- API after weekly-source, Telegram, Radar-retry and ticker corrections: 483 tests total, 482 passed, one optional Redis integration skipped; production TypeScript build passed.
- Native execution-display checks: 13 passed; domain and analysis builds passed. Actual public BTC 1H/1W and ETH 15m captures passed schema, cutoff, price/delta alignment, trade-count and volume-conservation checks.
- Public instrument metadata confirmed all eight requested USDT Spot pairs live. Independent ticker reads verified exact source/asset and source-clock freshness without regenerating reports.
- The Telegram full chain used real application paths with test wallet proof and a captured transport: verified link, app enable, subject opt-in, worker delivery acknowledgement/deduplication, then pause. No live bot message was sent.
- Final web unit suite: 257 passed. Final domain suite: 73 passed, including the optional-badge collision regression. Web production build passed after the final product-source edits.
- Final Chrome workflow: 26 checks, 22 screenshots and zero browser exceptions. This used the actual local UI with synthetic owner/pass/API responses, plus separately identified retained public market captures. It covered all eight market choices, five real appearance selections at 390px, visual market tools, Radar clocks/stages, wallet-link controls, spot/futures size entry, lost-response retry and access expiry. Radar deadlines and default journal timestamps also used the server clock when the device clock was moved one year ahead.
- Isolated chart Chrome matrix: 35 checks, six screenshots and zero errors. Five captured BTC timeframes × five actual appearance choices share the same controlled quote while retaining different completed closes. Visible wick scaling, quote-outside-range scaling, manual zoom retention, device-clock skew, mobile snapshot fallback, indicator states and quote/setup-badge collision were checked. These controlled observations test rendering, not market direction or trading results.

A passing API response or a rendered page alone is not the acceptance criterion for these defects. Final browser evidence is timestamped 12:53 UTC on 5 November 2026; chart evidence is timestamped 12:46 UTC. An independent read-only review covered owner isolation, source immutability, ended-state handling, Radar retry identity and ticker ordering. These checks support the corrected paths; they do not certify the entire application as defect-free.

Private evidence directories: `.tmp/docs-layout-20261105/`, `.tmp/terminal-alerts-audit/`, `.tmp/terminal-usability-live/`, `.tmp/terminal-usability-regressions/`, `.tmp/chart-source-audit-20261105/`. The full API log is `.tmp/terminal-base-acceptance/api-user-defects-final.log`.

No new payment, exchange order, live Telegram message or deployment was made during this correction. Browser device emulation does not establish physical iOS/Android behavior.
