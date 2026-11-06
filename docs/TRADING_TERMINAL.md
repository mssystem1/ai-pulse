# Trading Terminal

Trading Terminal is an independent PULSE workspace at `/trading-terminal`, with its tab immediately after Portfolio. The app's existing brand, header controls, network/payment selector, appearance/language controls and other tabs retain their behavior. Global Quick/Pro, Spot and Autopilot remain separate services.

## Trader workflow

1. Connect the owner wallet and sign the Terminal login message. This authenticates private state; it is not a payment or trade.
2. Review the server-published pass, supported payment network and capacity limits. Explicitly purchase access. A report purchase is not required.
3. Select the asset and primary timeframe once. Inspect the shared Pro chart and its primary, execution and higher-context evidence roles.
4. Use Market tools for measurements, Market Radar for ordered events, or Follow setup for one eligible plan.
5. Record actual trades in My positions. Review observations, state changes and notification delivery in Alerts & activity.

The main website has an additional Terminal product section. Portfolio provides an entry to the owner's Terminal records while keeping unverified journal values outside verified Spot/Autopilot performance. The in-app handbook is `/docs#docs-trading-terminal`.

Choose BTC, ETH, HYPE, SOL, DOGE, BNB, Zcash (ZEC) or OKB in the single Market dropdown. Other spot market opens the optional exact-pair input; unsupported pairs are never replaced with another asset. An independent timestamped ticker updates the current-price line across timeframe changes. The actual exchange-supplied developing candle follows that quote and refreshes its real volume. Hover or tap a candle to inspect its highlighted UTC time, OHLC, volume and change. Completed candles and confirmation studies remain separate; ticker updates preserve chart zoom, saved setup prices and original report exports.

To record a position, enter its market, direction, entry price and size. Choose coins, position value **at entry**, or initial futures margin and leverage; the journal converts these to base-asset quantity once. Stop-loss and individual target fields are optional, as are an earlier UTC opening time and exchange name. The default opening time is pinned when the form opens, and a lost-response retry reuses the same request identity and time.

## Distinct market functions

| Function | Input | Result |
| --- | --- | --- |
| Market tools | Market/frame and the stated captured source window | VWAP/value, executed flow/footprint, OI/funding and book evidence with provenance and coverage |
| Market Radar | Boundary, detector, observation frame and expiry | Ordered Developing/Completed/Failed/Expired/Data needed events, with history and optional alerts |
| Follow setup | A currently eligible immutable setup version | Its saved policy's next requirement and lifecycle; old plans cannot be revived by resetting the watch |
| My positions | Actual user-recorded fills, protection and closes | A separate private journal with explicit provenance; observed prices do not prove executions |

Radar's reclaim, breakout acceptance and breakout failure are event detectors. Their results are not orders. Each existing strategy retains its own admission policy, including passive bounded entry versus reaction/confirmation requirements. Chart zoom does not recalculate tool windows or edit a setup's Entry/SL/TP. Current tools use their stated captured windows; the footprint selector inspects available completed execution buckets.

### Timeframe roles

| Primary | Execution | Higher context |
| --- | --- | --- |
| 15m | 5m | 1H |
| 1H | 15m | 4H |
| 4H | 1H | 1D UTC |
| 1D UTC | 4H | 1W UTC |
| 1W UTC | 1D UTC | 1M UTC |

Value anchors/windows, setup expiry and entry/stop/target interpretation follow the actual frame and strategy. A completed weekly candle and the current quote have different timestamps. Historical structural levels may remain useful; a past reaction cannot be counted as fresh confirmation.

AI explanations receive the same deterministic qualification and payoff as the UI, separately from price-event progress. A confirmed retest or observed entry-area touch can still have `qualified=false` and `WAIT`. Neither establishes a venue fill. Questions about an older saved setup distinguish its assessment from current market eligibility.

Published opportunities are bound to a durable owner-scoped scenario ledger. Refresh updates market evidence while preserving the same opportunity's original prices, targets, start time and deadlines. Reaching its first target before entry ends that opportunity; replacing it with a farther target cannot revive it. The entry deadline can be earlier than the overall setup expiry. Existing followed reports seed their original history during migration. Previously unindexed, unfollowed Terminal views cannot be reconstructed retroactively.

## Data and Tapeout boundaries

Measurements come from explicitly identified exchange sources. Profiles and footprints use retained executions within the chosen UTC session. Candle-based anchored studies remain distinct from exact trade-weighted value. Spot base-asset quantities and Futures contract quantities are collected and calculated separately. OI units and funding kind/time remain explicit. Missing executions and order-book observations stay unknown rather than becoming zero.

### Retained sessions and liquidity history

Choose **Today**, **Previous day**, **This week**, **This month** or **Custom UTC range** (up to 31 days) above Market tools. Current sessions stop at the last completed UTC minute. The choice affects session VWAP, volume profile, buy/sell flow and complete execution footprints; it does not change the primary chart, setup prices or selected strategy. Complete profiles require verified coverage across the entire requested range. Developing profiles expose missing intervals, source knowledge time and resumable backfill status. VWAP and deviation bands use exact execution moments before price-bin rounding. The native session value area expands around POC to cover at least 70% of retained volume; the histogram never expands levels merely to make them look farther apart.

The collector first uses official daily execution archives when published, otherwise it pages the public historical tape with execution-ID continuity. UTC sessions crossing the execution archives' UTC+8 day boundary use both source files. Immutable compressed chunks, content hashes, durable cursors and fenced leases allow restart and prevent duplicate quantities. Only fully covered execution candles become footprints. Price/CVD lines break across missing display buckets; observed cumulative delta cannot establish unknown flow.

**Liquidity over time** shows actual resting bids/offers, with 1h, 6h, 24h and 7d choices. The collector replays every update in the exchange's dated 400-level book archive before sampling; forward collection retains real book snapshots. The default display stores 50 levels per side at one-minute cadence. Each cell exposes its actual source timestamp, price band and quantities. Color is size in one observation, never a sum of the same resting order across repeated polls. Hatched columns and explicit source gaps remain unknown. Sampled observations do not establish what happened between samples, consumed liquidity or liquidation prices. The archive does not provide publisher sequence/checksum IDs; archive integrity and chronological replay are verified without claiming such continuity.

Official execution archives typically appear after two days and book archives after three; actual availability varies by instrument. Newly started services need time to collect recent book history. Backfill cannot manufacture unpublished observations. The illustrated app guide uses the verified **1 November 2026 BTC Spot session: 177,587 executions, VWAP 77,953.3661, POC 78,005, VAL 77,820, VAH 78,220**, plus 1,440 retained one-minute order-book observations. This is explicitly a historical example, not a current trade recommendation.

Market tools show the actual execution count and covered duration before a profile, aligned price/CVD plot or footprint. “Recent executions” describes a bounded sample, not a full UTC session. The profile's quoted price is the quote retained at that evidence capture; Refresh evidence updates those views together. The chart's independent current ticker is labelled separately. Closely spaced POC/VAL/VAH prices can be correct for a short, narrow capture. Label spacing and display precision improve readability without manufacturing wider levels.

Create Radar from a value-area edge or a saved chart level, then review its ordered stages, confirmation speed, first eligible candle close and expiry. Each stage requires a distinct new completed candle; the already-running candle is excluded. A macro daily sequence can require more than three days. The interface warns when paid access ends before the earliest completion. A reclaim detector's first stage means a new candle traded beyond the boundary; it does not establish liquidation, absorption or a crossing from inside on that candle. Starting the same reviewed Radar again after a lost response retains its original detector and expiry.

Radar uses a registered Tapeout component from X Layer, retaining processor/circuit identity, pinned block/code/netlist provenance and verified evaluation semantics. Source-derived price comparisons feed the causal event layer; the chain component does not prove exchange-feed truth or predict outcomes. Dependency failure blocks supported Radar evaluation instead of silently substituting an unrelated local-only demonstration. Private position and strategy data are not published on-chain.

Replay re-evaluates at most 512 retained source observations using the original detector and Tapeout definition. If the required prefix has been dropped, replay is unavailable; workspace retention does not imply unlimited raw observation history. Repeated polling cannot supply a later event. Past-history inspection is distinct from newly triggered monitoring and cannot invent a trade. Protocol use and local checks do not establish organizer acceptance or trading win rate.

## Access and configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `FEATURE_TRADING_TERMINAL` | `0` | Enables this product/API. Use `1` for full feature testing. |
| `PRICE_TERMINAL_PASS_24H` | `1.50` | 24-hour pass price |
| `PRICE_TERMINAL_PASS_7D` | `10.50` | 7-day pass price |
| `PRICE_TERMINAL_PASS_30D` | `45.00` | 30-day pass price |
| `TERMINAL_MAX_WATCHES` | `20` | Active setup-watch capacity per owner |
| `TERMINAL_MAX_RADARS` | `20` | Active Radar capacity per owner |
| `TERMINAL_MAX_POSITIONS` | `50` | Open journal-position capacity per owner |
| `TERMINAL_AI_QUESTIONS_PER_DAY` | `20` | Bounded AI-question allowance |
| `TERMINAL_RETENTION_DAYS` | `180` | Private workspace retention |
| `TERMINAL_MONITOR_INTERVAL_MS` | `60000` | Configured background observation interval; not a latency guarantee |

Pass prices allow exact settlement precision up to six decimals. The public catalog is the source for marketing, workspace and checkout. The reviewed amount must still match the fresh catalog and payment challenge before signing; a price change requires review. Existing paid receipts keep their accepted terms and recover access idempotently. These are standalone prepaid periods, with explicit renewal and no recurring debit. Actual access/limits are shown before purchase.

The access panel shows a live countdown for the recorded paid period, with days, hours, minutes and seconds. It uses the server clock and recorded expiry for 24h, 7d and 30d passes, including continuous stacked renewals. Reloading the page or changing a configured price does not restart purchased access. At zero, paid controls stop; recorded positions and exchange protection remain unchanged. Renewal is an explicit purchase.

Follow review retains the plan originally opened in the dialog while background market evidence refreshes. Questions opened from Market tools also retain the selected source capture, Spot/perpetual stream and completed footprint candle. Tool captures remain available for one hour; an expired capture must be refreshed and selected again rather than silently replaced with current data.

Current private-workspace login supports EOA `personal_sign` ownership signatures. Smart-contract-wallet signature verification is outside this release's tested support.

Use the existing Redis/KV configuration for durable owner state, authentication challenges/sessions, receipts, observations and delivery records. Production cannot replace durable storage with a browser cache or in-memory entitlement. Access applies to the authenticated owner, while payment-chain/token details remain attached to the purchase. Terminal settlement supports enabled X Layer, Base and Arbitrum routes. Arc and Robinhood Terminal purchases are unavailable; their existing services keep their own payment paths. The deployed catalog discloses actual availability.

`FEATURE_TERMINAL_TRADING` is an older execution flag and does not enable Trading Terminal. Terminal's journal/monitoring controls do not grant direct signed orders or automatic trading.

Market-history configuration is also environment-driven:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TERMINAL_HISTORY_ENABLED` | `1` | Enable retained public sessions and liquidity history, alongside the Terminal feature flag |
| `TERMINAL_HISTORY_RETENTION_DAYS` | `45` | Executed-trade aggregate retention, 2–90 days |
| `TERMINAL_HISTORY_BOOK_RETENTION_DAYS` | `7` | Retained book observation window, 1–31 days |
| `TERMINAL_HISTORY_BOOK_SAMPLE_MS` | `60000` | Actual book sampling cadence, 1,000–300,000 ms |
| `TERMINAL_HISTORY_BOOK_LEVELS` | `50` | Retained book levels per side, 5–400 |
| `TERMINAL_HISTORY_PAGES_PER_BATCH` | `20` | Maximum execution pages per resumable batch |
| `TERMINAL_HISTORY_WORK_MS` | `20000` | Work budget between source calls; an in-flight archive request may finish later |
| `TERMINAL_HISTORY_POLL_MS` | `15000` | Long-lived collector interval |
| `TERMINAL_HISTORY_MARKETS` | Eight listed Spot pairs | Exact markets collected in the background |

Production history uses the existing durable Redis/KV configuration. Run the long-lived collector with `AUTOMATION_WORKER_ENABLED=1`, or call the existing authenticated cron endpoint; both paths share the fenced collector lease. Configure serverless request duration to accommodate the bounded archive download. The UI continues reading retained progress while a collection is running. A missing archive, rate limit or source outage leaves a visible gap and a resumable checkpoint.

## Monitoring, Telegram and expiry

Use the existing long-lived worker with `AUTOMATION_WORKER_ENABLED=1`, or the authenticated automation-tick deployment path. The same bounded worker state must prevent duplicate observation/notification processing. Exchange failures or stale sources produce Data needed rather than fabricated confirmation. A saved-plan watch first checks fresh lifecycle eligibility; expired/invalidated/completed opportunities require a new separately reviewed version.

Telegram requires the owner's existing verified chat link, enabled Telegram support and explicit event preferences. An outbox records delivery attempts and acknowledgements; uncertain sends are not blindly repeated. Unlink/pause/expiry changes must be reflected before further authorized sends. An alert requests review; a stop/target touch is not evidence of a filled exit.

Radar alerts identify the market and quote currency, Radar ID and detector, selected boundary/direction/tolerance, primary and actual execution timeframe, stage, triggering candle OHLC, candle close and retrieval times, next requirement and expiry. The link opens that exact item after owner sign-in. A failed Radar means its ordered pattern failed; it does not report a trade loss. Same-market interruptions with the same cause are grouped into one incident, with affected Radar IDs retained; recovery has its own notice. Individual item activity remains available, including when Telegram is paused. Provider exception text and credentials are never copied into messages.

Setup geometry is checked before a plan can be followed and again after price-policy confirmation. The saved price-zone policy keeps its existing 1R nearest-obstacle floor; older technical policies keep 1.5R. A distant TP cannot bypass a closer opposing level or an overlapping opposing zone. A quote crossing the first objective cannot promote a farther target to revive the same opportunity. The UI shows **WAIT** for blocked plans. Weekly and daily scenarios can differ in side, but their evidence, entry, invalidation, nearby obstacles and eligibility must each be assessed separately.

In Alerts & activity, open the displayed PULSE bot, choose Link wallet (or `/wallet`), sign ownership in the browser and confirm the same wallet in the bot. Return to the app, check the link, select alert groups and enable notifications. Each setup, Radar and position also has an explicit Telegram switch; “Include all active watches and positions” opts in the current active items. Pause cancels queued messages while monitoring continues; enabling again does not resend historic events. The timeline shows the affected item, source time, delivery status and a link to inspect it.

Watch source reports remain immutable. Evolving lifecycle state travels separately under definition/revision validation, preserving entry/stop/target prices and deadlines. Data-needed events expose safe source-specific reasons, including missing saved evidence, revised candles, incomplete history and unavailable quotes, so a user can distinguish a refreshable outage from a plan that needs a new review.

After access expiry, journal/history can be read within retention, while monitoring and paid AI access show their stopped state. Expiry never closes an actual position or cancels an exchange order. A user-reported stop remains unverified unless an execution source confirms protection; current implementation does not invent exchange imports.

## Validation and release

The [6 November validation record](TRADING_TERMINAL_VALIDATION_2026-11-06.md) documents the current seven-issue follow-up, real session/heatmap examples, fresh five-frame admission audit, automated checks and browser validation. Its [JSON companion](TRADING_TERMINAL_VALIDATION_2026-11-06.json) retains the exact source clocks and geometry results. [Trading Rules](TRADING_TERMINAL_TAPEOUT_NEXT.md) is the proposed next X Layer/Tapeout function and remains separate from implemented capabilities.

Run the new feature paths with `FEATURE_TRADING_TERMINAL=1`, `NODE_ENV=test` and `PULSE_SKIP_DOTENV=1` to avoid inheriting production credentials/workers. Verify owner isolation, exact/env-configured prices, receipt recovery, expiry, scenario eligibility, causal Radar replay, missing sources, manual-fill accounting, notification consent/deduplication, chart-view preservation and mobile/Clarity readability.

This task implements local application behavior. Deployment, public circuit publication, marketplace submission and live wallet transactions remain separate operator actions. Tests do not certify real-device wallet acceptance, complete retained historical depth or trading profitability.

The [4 November acceptance record](TRADING_TERMINAL_ACCEPTANCE_2026-11-04.md) documents the approved 1.50 USDC Base purchase, final API/browser checks, five-timeframe audit and remaining validation limits.

The [5 November usability and data audit](TRADING_TERMINAL_USER_ISSUE_AUDIT_2026-11-05.md) records the ten user-reported defects, their corrections, public-source observations and scoped API/browser evidence.
