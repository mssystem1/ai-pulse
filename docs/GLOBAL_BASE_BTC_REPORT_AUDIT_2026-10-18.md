# Four fresh BTC Global Pro reports on Base — 18 October 2026

**Single-setup correction:** the [current strategy audit](GLOBAL_SINGLE_SETUP_STRATEGY_2026-10-18.md) supersedes the dual LONG/SHORT presentation below. Each timeframe now publishes one LONG, SHORT or SIDEWAYS assessment and one supported setup with its conditional chart projection.

**Target-policy correction:** a later user-reported daily snapshot exposed consumed historical pivots being reused as TPs. Price consistency in this audit did not establish target validity. The [target and recovery incident audit](GLOBAL_TARGET_AND_RECOVERY_FIX_2026-10-18.md) supersedes the target-selection conclusions below and links a free corrected review. Original purchased snapshots and receipts remain unchanged.

Completed the unfinished request from `codex://threads/01a12ffe-8eea-7900-bdbb-c07ce7377efb`: generate BTC-USDT Pro reports for 1H, 4H, 1D UTC and 1W UTC using `TEST_WALLET_ADDRESS` on Base, then inspect the actual text, charts, Entry, SL and TP levels. The earlier chat explicitly authorized these purchases.

The updated **local API** generated the reports with normal application configuration, Redis persistence, live public OKX Spot candles and **Grok 4.5 / medium** reasoning. Each report cost **0.30 USDC**, exactly **1.20 USDC total**. No trading orders were placed. All subsequent recovery, re-export and recheck work reused these purchases.

## Reports and original evidence

Snapshots were fetched at 13:15–13:16 UTC, or **17:15–17:16 Europe/Samara**. BTC market levels are denominated in **USDT**; report payment was **USDC on Base**. These are different currencies and roles.

| Report | Entry frame | Numeric reference | TXT | Chart PNG |
|---|---|---|---|---|
| 1H · Intraday | 15m | `fb0ab57e` | [Full report](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-1H-20261018131526-fb0ab57e.txt) | [Chart](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-1H-20261018131526-fb0ab57e.png) |
| 4H · Swing | 1H | `d54a294c` | [Full report](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-4H-20261018131530-d54a294c.txt) | [Chart](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-4H-20261018131530-d54a294c.png) |
| 1D UTC · Position | 4H | `4bb8d886` | [Full report](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-1D-20261018131557-4bb8d886.txt) | [Chart](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-1D-20261018131557-4bb8d886.png) |
| 1W UTC · Macro | 1D UTC | `3a514d22` | [Full report](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-1W-20261018131605-3a514d22.txt) | [Chart](../.tmp/global-base-audit-2026-10-18/deliverables/BTC-1W-20261018131605-3a514d22.png) |

These links point to local run artifacts in gitignored `.tmp`. Each report also has JSON, Markdown, Telegram text/caption, and separate LONG/SHORT SVG drawings. Original API deliveries and private recovery capabilities remain under `private/`; they are excluded from Git and from the artifact manifest. `.original.md` preserves the original delivered Markdown, while `.md`, TXT and PNG use the corrected presentation of the same numeric snapshot. No AI narrative or saved trade prices were regenerated to obtain the display corrections.

All four Base transaction receipts succeeded and contain the exact 0.30 USDC transfer from the test wallet to the configured merchant:

| Frame | Job | Base settlement |
|---|---|---|
| 1H | `978cd4a6-e21f-4d7e-b40c-0b25468bd36c` | [Transaction](https://basescan.org/tx/0x3c0d054dc5aad00928ebf47c66ad1d7d1dcf7e1f13b00f443aab438d2e32f4b6) |
| 4H | `4f29bff1-1e88-4f50-b50b-3a14ed4d14aa` | [Transaction](https://basescan.org/tx/0xd860d589098d787e14bd49ac16f715a0d60227dcceec97e945d9d548881b8cfb) |
| 1D | `577877a3-3c68-4c41-8048-c0e3c3466dc9` | [Transaction](https://basescan.org/tx/0xa19bcc557387d36c8400d28bdbfb506cab8989c2b533b1ea6dc58deb3d6102e0) |
| 1W | `d2600c73-8fea-47f1-9aec-cf3fe9eb1b84` | [Transaction](https://basescan.org/tx/0xb4577268d609b72ce83b7c70cc5b57077f58a1922c361d80f35760184febbf9b) |

USDC balance before/after: **1.771102 → 0.571102**. Receipt verification checked chain 8453, the configured Base USDC contract, sender, recipient and exact amount, rather than accepting an HTTP success as payment evidence.

## Findings and corrections from this run

| Finding | Consequence | Implemented correction |
|---|---|---|
| The unconfirmed 1H headline emphasized the main LONG market route while the selected/default position drawing was SHORT | A reader could mistake the market narrative for the displayed entry plan | Unconfirmed reports with both sides use `LONG / SHORT · Separate entry conditions`. Each card retains its own trigger and R:R; confirmed entries retain their qualified direction |
| PNG download omitted `selectedPathId` | Selecting another plan changed the screen and entry inset but could export the default side | Download forwards the selected plan together with the chosen studies and view. Browser checks select and export both sides of every report |
| The position drawing still said “Conditional moves · timing schematic” | Wording described the removed forecast-path design | Current reports say `Trade plan · Entry / SL / TP` in SVG and web readout |
| 1H and daily plans both fail the TP1 reward rule, but the general instruction emphasized confirmation | Another candle might appear sufficient to authorize an otherwise poor entry | Explicit instruction: both sides need better reward and new supported entry structure; confirmation alone does not qualify entry |
| An extra R:R line did not name its side | Its ratio could appear to describe both displayed cards | The line identifies LONG or SHORT |
| Weekly history has 457 bars rather than 520 | A rigid 520-bar assertion would either fail a usable disclosed report or encourage invented history | Preserved `completed_partial` and the visible coverage note. A direct public OKX request older than the earliest bar returned zero rows |

App documentation explains the relationship between the two-sided heading, market context, plan selection, entry inset and exported PNG. All nine guide images were regenerated from the existing public historical replay, without wallet data or new model calls.

## Trade geometry at the saved cutoffs

**None of these eight plans has a confirmed entry.** Entry and SL below are planned references. R:R uses the conservative end of the entry zone, TP1 and the full Entry–SL distance, before costs.

| Frame / side | Planned Entry | Planned SL | TP1 | TP2 | TP3 | R:R → TP1 |
|---|---:|---:|---:|---:|---:|---:|
| 1H LONG | 82,072.40–82,082.51 | 81,605.88 | 82,291.10 | 82,642.80 | 82,956.30 | 0.44 |
| 1H SHORT | 81,923.39–81,933.50 | 82,301.22 | 81,822.40 | 81,690.60 | 81,616.00 | 0.27 |
| 4H LONG | 81,032.80–81,057.40 | 80,784.89 | 81,953.10 | 82,556.60 | 82,800.00 | 3.29 |
| 4H SHORT | 84,122.50–84,147.10 | 84,190.91 | 83,884.00 | 83,530.10 | 83,174.70 | 3.49 |
| 1D LONG | 82,285.00–82,357.02 | 80,737.48 | 82,473.60 | 84,361.60 | 87,399.00 | 0.07 |
| 1D SHORT | 80,327.98–80,400.00 | 84,219.12 | 79,488.00 | 78,200.00 | 76,053.00 | 0.22 |
| 1W LONG | 82,842.00–83,058.03 | 80,183.96 | 89,111.00 | 98,188.40 | 108,365.00 | 2.11 |
| 1W SHORT | 82,625.97–82,842.00 | 84,577.64 | 80,636.30 | 76,011.80 | 74,501.60 | 1.02 |

The intraday and position plans fail the product's 1.50 TP1 R:R minimum on both sides. Moving TP1 farther away would conceal nearer obstacles. Neither those prices nor an extra confirming candle fix the poor reward geometry.

The 4H range plans have sufficient planned reward, but the saved price is inside the range rather than at a confirmed entry. LONG requires a completed 4H support test holding 81,032.80, followed by a new 1H reaction and later close above its high. SHORT requires a completed 4H rejection at 84,147.10, followed by a new 1H reaction and later close below its low. Their planned stops can be close to entry; an eventual observed reaction must establish actual protection and a new quote must still qualify.

Weekly LONG has sufficient planned reward but a prior failed entry attempt and missing fresh confirmation/retest. The latest saved daily entry close is 81,489.40, while the older completed weekly reference is 83,760.40. The two observations must not be interchanged. Weekly SHORT also fails the TP1 reward rule. Neither side becomes an active recommendation because the old weekly close is above or below a level.

TP rows disclose timeframe, confirmed swing date and percentage distance. The 124,500 historical high is absent from chart price labels and the TP list. Historical Elliott labels and the Fibonacci measurement do not independently prove a future target or an arrival date.

## Validation and remaining limits

The paid audit checks confirmed chronological candles, source/currency, main/entry timeframes, live model/reasoning, Entry–SL direction, ordered TPs, independent R:R calculations, both direction cards, exact SVG prices, chart selection, all export sections and Telegram character limits. TXT and the Telegram document use the same full text. All four paid artifacts pass these checks.

The 1H, 4H and 1D reports each retain 520 completed candles. Weekly retains **457**, beginning **2018-01-08 UTC**; public OKX returned zero older weekly candles. The history still supports all five default SMAs, including SMA233, but it must not be represented as 520 observed candles. The report and API explicitly disclose that coverage limit.

The browser matrix covers **20 cases**: four reports on desktop and mobile web, all four in the Telegram Mini App on both viewport sizes, focused/all-study views and the illustrated guide. It checks both plan selections, agreement between main chart and entry-study SL, both PNG export selections, default studies, canvas stability, layout overflow and runtime errors. It completed with **zero runtime errors**. The Mini App host/library are simulated with the actual paid report payloads; no Telegram message is sent. Coinbase analytics POSTs are blocked by the browser harness.

The focused regression run passed **177 tests**. The final complete domain/analysis/web runs passed **413 tests** (37 + 176 + 200), and the API access/recheck/delivery run passed **28**, for **441 passing checks** with no failures or skips. The normal frontend production build passed. English/Chinese historical exports also passed all ten profile/language cases, with the maximum caption at 598 characters and overview at 1,847 characters. Fresh English paid exports fit Telegram limits as well: maximum caption 598 and overview 1,845 characters.

All four paid reports reopen without payment and require recovery authorization; unauthenticated reads return 403. Free setup rechecks return HTTP 200, retain each source reference and use the requested entry timeframe. At the recheck cutoff, 1H/daily had insufficient geometry, 4H still needed confirmation, and the earlier weekly LONG attempt remained failed. Rechecks create no AI call, payment or order.

The resulting implementation is locally built and verified. This run does not publish it to Railway/Vercel, establish strategy profitability, calibrate a six-month BTC forecast, or validate live order execution.

Local evidence:

- [Paid results and plan audit](../.tmp/global-base-audit-2026-10-18/results.json)
- [Artifact hashes](../.tmp/global-base-audit-2026-10-18/manifest.json)
- [Browser validation](../.tmp/global-base-audit-2026-10-18/browser/validation.json)
- [Free recheck results](../.tmp/global-base-audit-2026-10-18/rechecks-summary.json)
- [Weekly history boundary check](../.tmp/global-base-audit-2026-10-18/weekly-earlier-history.json)

Reproduce the export/numeric audit without payment or network access using `node scripts/audit-global-base-reports.mjs --render-only`. `--recover` requires four accepted jobs and refuses new purchases. `--execute` is the explicit purchase mode; it is restricted to these four local-API Base reports, verifies each 0.30 USDC challenge before signing and journals accepted jobs to prevent duplicate spending.
