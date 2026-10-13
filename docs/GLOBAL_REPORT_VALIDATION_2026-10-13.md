# Global Quick / Pro: implementation and validation

13 October 2026, Europe/Samara. Implemented locally; no deployment or Telegram messages sent.

[Open the visual review](previews/global-report-validation.html). It contains screenshots of the actual report component and matching PNG/TXT exports. The [accepted Quick](previews/global-report-quick.png) and [accepted Pro](previews/global-report-pro.png) planning images remain unchanged.

## What was corrected

The reported chart looked like a smooth zigzag with repeating volume, and its Spot card did not clearly follow the displayed paths. The redesigned renderer uses completed OHLC candles and real venue volume. Its annotations, possible moves, exports and single Spot plan resolve the same saved level IDs.

Screenshot review found and corrected insufficient candle bodies in the illustrative fixture, missing future space in Quick, overlapping level labels, displaced context panels, and lost chart framing after changing viewport size. The fixture now uses the accepted preview's seeded OHLCV. Production never substitutes fixture candles or creates a wave count from arbitrary window segments.

The chart retains its logical view when resized. A narrow report column or phone shows the complete map first, with a separate native TradingView candle inspection view. Wide views use native TradingView candlesticks, zoom, crosshair OHLC and scenario highlighting. The Spot card remains immediately attached to the chart.

| Feature | Quick | Pro |
| --- | --- | --- |
| Completed candles, wicks, volume, decision levels | Yes | Yes |
| Validated Elliott hypothesis or `Count unclear` | Yes | Yes, with rules and anchor details |
| Main and conditional moves | Main plus one material alternative | Up to three material paths; conditional stress branch when supported |
| Default moving averages | Purple SMA55 | SMA21/55/144; optional 21/55/89/144/233 |
| Additional chart evidence | Core structure and channel | OLS120 ±2 residual σ, RSI14 with 30/50/70 guides, ATR14, volume ratio |
| Optional studies | — | Fibonacci 38.2/50/61.8, anchored HLC3 VWAP, confirmed pivots |
| Independent higher timeframe | — | Actual observed context candles and SMA55 inset |
| Spot plan | One linked plan and all confirmation/cancellation conditions | Same plan plus measured evidence, conflicts and risk checks |

The settings are PULSE's disclosed analysis settings, inspired by the supplied Vilarso examples. They are not claimed to be Vilarso's private Pro indicator formulas.

## Timeframes and conditions

The primary chart uses the selected report timeframe. The paid tests use **1H · 1-hour candles**, with independently observed **4H** context for Pro. The subsequent public-market renderer checks cover both tiers at every selection below. Duration labels appear in the web report, PNG, Telegram caption/message and TXT; every confirmation and cancellation uses the primary candle interval.

| Primary | Pro context | Completed primary/context candles in the renderer checks |
| --- | --- | ---: |
| 15m | 1H | 520 / 299 |
| 1H | 4H | 520 / 299 |
| 4H | 1Dutc | 520 / 299 |
| 1D | 1Wutc | 520 / 299 |
| 1W | 1Mutc | 470 / 105 |

Monthly context closes at the exact calendar boundary, including leap years and the venue's UTC/UTC+8 convention. `1M` means a month; `1m` means a minute. The weekly check preserves all 470 available weekly candles and 105 monthly candles. Production requests 520 primary candles and discloses shorter history rather than fabricating it.

[Timeframe screenshots and exports](previews/timeframes/native-preview.html), [Telegram chat preview](previews/timeframes/telegram-preview.html), [market/export results](previews/timeframes/validation.json), and [20 desktop/Mini App browser checks](previews/timeframes/browser-validation.json) document the matrix. These ten report packets validate the deterministic renderer using observed public data; they contain no new model forecast. Their additional wallet spend and model calls are both zero.

Pro fetches context separately for the same instrument, source and quote currency, and excludes bars not completed by the saved snapshot. Missing context is disclosed; it cannot make a Pro setup Ready.

S1 is the required completed-bar reclaim and subsequent held retest. S2/S3 are the same mapped targets on the amber path and card. The thesis floor is structural invalidation. An unobserved retest does not receive an invented entry, stop or R:R. Readiness requires observed protection, adequate reward to the nearest target, execution costs, expiry and a visible matching path. Invalidated or expired plans cannot preload an order. Pro context must be available and non-conflicting.

Ready also requires the saved completed-close price to remain inside the observed entry zone; an extended move stays Watching. Both tiers preserve Market and Limit ticket review. Watching reports provide a separately labelled manual action with explicit risk acceptance. A manual draft copies entry, TP and SL only when that Watching plan contains observed, unexpired protection; otherwise these fields remain blank. Cancelled/expired plans copy only market context. This does not activate an unconfirmed setup or place an order. The legacy EVM Telegram Mini App component carries the chosen order type and manual/confirmed mode through its owned-report share; the browser reloads all prices from that saved report and ignores price overrides in the URL. The current public TON Mini App retains its existing research-only scope. The EVM component was mounted separately for these mocked checks; it is not the public `/miniapp` route.

Wave anchors require completed-bar confirmation and structure checks. A completed close through the origin rejects the hypothesis; a rebound cannot restore that same invalidated count. Conditional projection spacing does not forecast timing. A main view and a future recovery plan remain distinct.

## Images inspected

| Evidence | Image |
| --- | --- |
| Final Quick, live market history | [Desktop](previews/finalQuickDesktop.png), [phone](previews/finalQuickMobile.png) |
| Final Pro, same live primary history | [Desktop](previews/finalProDesktop.png), [phone](previews/finalProMobile.png) |
| Pro candle bodies, wicks and close/retest stages | [Zoomed setup](previews/finalProFocused.png) |
| Complete map in a narrow report column | [Narrow panel](previews/finalProNarrow.png) |
| Accepted illustrative count and historical levels | [Implemented design fixture](previews/auditProDesktop.png) |
| Pro optional chart studies enabled | [All layers](previews/auditProAllLayers.png) |
| Chinese labels and timeframe durations | [Chinese phone view](previews/auditProChinese.png), [Chinese PNG](previews/implemented-pro-zh-chart.png) |

The final live-data screenshots use the final prompts evaluated against the original saved market history. Those model checks did not purchase another report or overwrite the original purchased JSON. Both tiers were evaluated on the same frozen Pro market snapshot for direct comparison. The illustrative Elliott fixture is synthetic and clearly identified as a design example; it is not evidence of a live validated count.

Both actual purchased reports and final prompt checks correctly returned `Count unclear` and `Watching`. The actual shared levels were S1 **108.45**, S2 **108.81**, S3 **108.97**, with floor **105.71**. Entry, protective stop and net R:R remain null. The historical screenshot levels 117.30/120.56/124.80 are confined to the illustrative fixture.

## Paid Base validation

Two real report purchases used `TEST_WALLET_ADDRESS` on Base mainnet, chain 8453, with real Grok 4.5 generation. Each successful receipt was verified against the exact USDC Transfer from the configured test wallet to the configured report payee.

| Report | Paid | Reasoning | Base receipt |
| --- | --- | --- | --- |
| Quick | 0.20 USDC | low | [Transaction](https://basescan.org/tx/0x0c9e08b63c964b4020da80a7c09fee7183dfd9fa12aeefebbbc990efa3e7db8e) |
| Pro | 0.30 USDC | medium | [Transaction](https://basescan.org/tx/0x78a902c03f0086a86dfae5fe219eb28b1138611b8dd7fe41a90b00f25fb3406f) |

Total report-test spend: **0.50 USDC**, verified by the wallet's before/after USDC balance. No swaps, approvals or automation were executed. The live jobs were isolated from production queues and Telegram. Private recovery credentials are kept only in ignored local test archives.

Quick saved 520 completed 1H candles. Pro saved 520 completed 1H candles and 299 independently observed completed 4H candles. Both jobs completed. Reopening each saved report returned HTTP 200, the identical canonical snapshot and no payment requirement. An unauthenticated reopen returned HTTP 403.

[Original paid-run evidence](previews/global-base-validation.json) records the receipts and job outcomes; its image byte counts describe the render at checkout. [Final export evidence](previews/global-final-validation.json) records the current PNG sizes, Telegram limits, preserved history and price parity after presentation fixes. Original paid snapshots: [Quick](previews/live-global-quick.json), [Pro](previews/live-global-pro.json).

## Grok and delivery

Local `.env` and documented defaults use `GROK_MODEL=grok-4.5`, `GROK_REASONING_STANDARD=low`, `GROK_REASONING_PREMIUM=medium`, input budgets 16,000/32,000 and output budgets 4,096/8,192. Large output limits accommodate hidden reasoning and structured JSON; they do not request verbose reports. Final live prompt checks produced short two-sentence summaries, with no internal level IDs in prose. The model selects supplied candidates and explains evidence; it cannot invent numerical levels or price a setup.

The production template and Railway runbook now contain those same settings. An isolated smoke test loaded the compiled API with production configuration, Quick `low` and Pro `medium`, and returned HTTP 200 from `/healthz`: [startup evidence](previews/global-startup-validation.json). It used no real credentials or workers. Railway's reported validator listing only `none`/`low` belongs to an older build; that deployment must be replaced with this revision. No Railway deployment was performed during this validation.

Output cost accounting includes reasoning without double-counting it when already included in the provider total. See [xAI reasoning usage](https://docs.x.ai/developers/model-capabilities/text/reasoning) and [usage details](https://docs.x.ai/developers/tools/tool-usage-details).

Telegram leads with chart, then concise overview and full TXT. The overview presents headline/summary before the conditions, and preserves activation and cancellation rules within its length budget. A failed photo does not suppress the summary or TXT; retry sends only the missing part. Both tiers have charts and owned-report PNG downloads. The Mini App shares the same report component. Old snapshots retain their legacy renderer and saved evidence.

The final visual audit also separated nearby Elliott and scenario labels without moving their observed anchors, preserved years on daily/weekly PNG axes, and removed calendar dates from schematic future space. Cancelled plans are labelled on the chart. Expiry appears in the image, caption, message and TXT. If only one supported target exists, the chart and card show S1 → S2; they do not advertise S3. An unsupported setup has no pending R:R value. The Telegram message states the Spot status once, and the Prediction menu retains its own description.

Matching final examples: [Quick PNG](previews/prompt-global-quick.png), [Quick overview](previews/prompt-global-quick-telegram.txt), [Quick TXT](previews/prompt-global-quick.txt); [Pro PNG](previews/prompt-global-pro.png), [Pro overview](previews/prompt-global-pro-telegram.txt), [Pro TXT](previews/prompt-global-pro.txt). PNGs are 1300×813 and 1300×992; bundled Noto Sans SC renders Chinese labels without relying on system fonts.

## Checks

The full workspace build passed. The complete workspace test command passed; affected suites were rebuilt and rerun after timeframe and screenshot-driven fixes. Final suite counts are recorded below; repeat runs are not added to the totals.

| Suite | Tests | Result |
| --- | ---: | --- |
| Contracts | 14 | Passed |
| Config | 12 | Passed |
| Domain and exports | 17 | Passed |
| Market history | 13 | Passed |
| Analysis | 42 | Passed |
| Payments | 38 | Passed |
| Buyer | 9 | Passed |
| SDK | 6 | Passed |
| API, recovery and Telegram | 351 | All passed across full suite and Redis follow-up |
| Web and Mini App | 183 | Passed |
| Arc workers | 11 | Passed |
| Cloud environment | 7 | Passed |

Final total: **703 distinct tests passed, zero failed, none left unrun**. The normal full workspace command passed 702 and skipped the opt-in Redis check because `PUBLIC_ACTIVITY_REDIS_TEST_URL` was unset. The unchanged skipped test was then run separately and passed against Microsoft Garnet 2.1.8, bound only to `127.0.0.1` with Lua transactions enabled. It verified 25 concurrent duplicate calls, exact integer volume, a fresh reader and key TTL; only its five exact random-namespace keys were removed. [Redis follow-up evidence](previews/global-redis-validation.json). Garnet was obtained from the [Microsoft NuGet package](https://www.nuget.org/packages/garnet-server/2.1.8), with settings from the [official configuration documentation](https://microsoft.github.io/garnet/docs/getting-started/configuration). This check covers Redis-compatible TCP/Lua command semantics and a fresh reader; it does not test server restart, disk recovery or Railway availability. No production Redis endpoint was used.

The final workspace build also passed. The existing AppKit bundle-size warning remains; this change does not alter that dependency.

Final Telegram viewport evidence: [Quick phone](previews/timeframes/telegram-quick-mobile.png), [Pro phone](previews/timeframes/telegram-pro-mobile.png), [Quick message](previews/timeframes/telegram-quick-mobile-message.png), [Pro message](previews/timeframes/telegram-pro-mobile-message.png), [Quick desktop](previews/timeframes/telegram-quick-desktop.png), [Pro desktop](previews/timeframes/telegram-pro-desktop.png). These are exact formatter outputs shown in a local chat-style preview, not screenshots of a real Telegram client. Real Telegram HTTP delivery was mocked in the tests.

The [phone native-candle inspection](previews/timeframes/mobile-native-inspection.png) retained a 390px page with a separate 1000px chart scroller and matching S1/S2/S3 labels. Desktop and phone layouts were inspected in Chromium browser emulation; physical iOS/Android devices were not used.

[Final Market/Limit interaction screenshots](previews/global-handoff-validation.html) show Ready, Watching and Cancelled plans. Both order choices carried the expected levels; URL price overrides were ignored; PNG download worked. The [interaction results](previews/global-handoff-validation.json) also record 20 refreshed timeframe screenshots and zero runtime errors. Ready examples are synthetic; the refreshed Quick/Pro report screenshots use the original frozen market history.

Browser checks covered wide and 390px views, a 786px report column, viewport resizing, scenario highlighting, Pro study toggles, native candle inspection and Chinese labels. No horizontal page overflow or console errors/warnings were observed in the verified views. Exact S1/S2/S3/floor parity was checked across web sections, PNG/SVG, Telegram message/caption and TXT. Original purchased snapshots were compared with their private saved records and remained identical.

Telegram HTTP delivery was mocked; no real message was sent. Functional validation does not establish strategy profitability. The temporary visual test entry was removed from the web application. This record accompanies the validated local commit; no deployment or push was performed.
