# BTC Pro report audit and corrections — 18 October 2026

**Single-setup correction:** the [current strategy audit](GLOBAL_SINGLE_SETUP_STRATEGY_2026-10-18.md) supersedes the dual LONG/SHORT presentation below. Each timeframe now publishes one LONG, SHORT or SIDEWAYS assessment and one supported setup with its conditional chart projection.

**Later correction:** the nearest-historical-pivot target policy described here missed consumed support/resistance. The [target and recovery incident audit](GLOBAL_TARGET_AND_RECOVERY_FIX_2026-10-18.md) supersedes that policy and records corrected daily targets, free saved-report review and the processing delay. Historical snapshot reproductions below retain their original identity.

The uploaded 17 October reports had substantive planning and presentation defects. Passing software checks did not make the previous design usable. This revision replaces the objective/checkpoint presentation with LONG / BUY and SHORT / SELL plans containing Entry, SL and TP1–TP3. It preserves the requested strategy horizons and the evidence behind archived reports.

## Evidence

Audited all four TXT reports and PNG charts. Reconstructed the same completed public OKX Spot candles and original numeric references:

| Frame | Uploaded reference | Fetched at, 17 October UTC | Main reference close | Entry frame |
|---|---|---|---:|---|
| 1H | `01ac5e27` | 21:16:16.779 | 81,644.20 | 15m |
| 4H | `1f108b99` | 21:14:44.983 | 81,605.00 | 1H |
| 1D UTC | `149fe0f6` | 21:10:34.259 | 81,617.50 | 4H |
| 1W UTC | `2c03071c` | 21:12:39.757 | 83,760.40 | 1D UTC |

These are historical replay results, not current quotes or trade instructions. The weekly reference closed on 12 October; its daily entry study closed on 17 October at 81,617.50. Those are different observations. UTC calendar candles also differ from the earlier UTC+8 exports. The supplied Vilarso example uses Binance; identical prices should not be expected from OKX.

Public fixtures: `packages/analysis/src/globalReport.oct17-fixtures.json` and incremental `globalReport.oct17-2116-fixtures.json`. All four archived `decision-v4` numeric identities still reproduce exactly. Current reports use `decision-v5 / structure-v5 / horizon-v2`, with new identities; archived reports are not silently repriced.

## Findings and implemented corrections

| Problem | Cause | Correction |
|---|---|---|
| Objective/checkpoint/watch-area wording competed with chart TP labels | Multiple price systems exposed at once | Entry, SL, TP1–TP3; nearest relevant confirmed zone is TP1 |
| Daily/weekly Entry and SL disappeared | Insufficient reward suppressed planning geometry | Planned prices remain visible beside the missing condition or reward issue |
| Weekly 124,500 appeared to be the next destination | A distant archive swing became a large arrow while nearer resistance was treated as checkpoints | Nearer resistance becomes TP1/TP2; unused archive levels remain historical context |
| Weekly SHORT risk exceeded 50% | Horizon selection forced an archive extreme into trade protection | Main frame defines the market condition; confirmed entry-frame structure establishes trade SL |
| Numeric labels drifted away from their lines | Collision packing moved labels vertically | Lines stay at exact prices; omit colliding axis labels and retain all prices in a readable ledger |
| Range reports buried the opposite side | Drawing selected one route without exposing both plans | Expanded LONG and SHORT cards, each with Entry, SL, TPs, trigger and R:R |
| Selecting another side left the entry inset unchanged | Main drawing and inset used different selections | Both follow the same selected plan |
| A failed lower-frame attempt could prevent a later valid test | Old attempt consumed the main-frame confirmation | A fresh lower-frame break/retest can rearm while the completed main condition holds |
| Range Entry band could end almost on SL | Symmetric tolerance crossed the zone | Planned bands lie on the holding/rejection side |
| Multiple arrows implied an unobserved price path | Future route drawings looked like forecasts | Position drawing with Entry, SL, TPs and risk/reward regions; no invented future candle path |

This changes target selection, SL evidence, entry rearming and chart geometry, not just vocabulary. Archived methods remain versioned.

## Revised plans for the uploaded snapshots

**None of these entries is confirmed at its replay cutoff.** Favorable planned R:R alone does not authorize entry. Prices below are conditional; actual reaction geometry and quote costs can change them.

| Plan | Planned Entry | Planned SL | TP1 | TP2 | TP3 | Gross R:R → TP1 |
|---|---:|---:|---:|---:|---:|---:|
| 1H SHORT | 81,682.71–81,690.60 | 81,782.90 | 81,523.90 | 81,404.30 | 81,194.00 | 1.59 |
| 1H LONG | 81,690.60–81,698.49 | 81,453.60 | 81,775.00 | 81,822.40 | 81,933.50 | 0.31 |
| 4H range LONG | 81,032.80–81,055.44 | 80,786.85 | 81,953.10 | 82,556.60 | 82,800.00 | 3.34 |
| 4H range SHORT | 84,124.46–84,147.10 | 84,188.95 | 83,884.00 | 83,530.10 | 83,174.70 | 3.73 |
| 1D LONG | 82,285.00–82,360.24 | 80,734.26 | 82,473.60 | 84,361.60 | 87,399.00 | 0.07 |
| 1D SHORT | 80,324.76–80,400.00 | 84,222.34 | 79,488.00 | 78,200.00 | 76,053.00 | 0.21 |
| 1W LONG | 82,842.00–83,067.25 | 80,174.74 | 89,111.00 | 98,188.40 | 108,365.00 | 2.09 |
| 1W SHORT | 82,616.74–82,842.00 | 84,586.86 | 80,636.30 | 76,011.80 | 74,501.60 | 1.01 |

R:R uses the conservative end of Entry. The 1.50 minimum is a PULSE product rule, not a universal TradingView rule or proven profitable threshold.

Daily LONG still has poor reward to nearby resistance. Confirmed prices within 0.20 main-frame ATR form zones; the nearest edge is retained. Here that yields 82,473.60, rather than skipping the area and advertising only 87,399. A position horizon cannot make intervening resistance disappear. Another supported entry structure is needed; a farther TP would only conceal the problem.

Weekly LONG TPs are approximately +7.28%, +18.20% and +30.45% from conservative planned Entry. These are distances, not likelihoods. Each TP now lists its timeframe, structural source/date and percentage distance. Multiple TPs do not imply automated partial exits: current Spot order review supports one selected TP, normally TP1; it does not create a three-order exit ladder.

## Why 124,500 appeared and what can be estimated

124,500 is a historical swing high in the weekly data, not an output of a calibrated six-month forecasting model. The old horizon selector promoted that archive resistance into a large recovery arrow. The earlier daily chart's distant 126,200 level had the same presentation problem.

**124,500 fails the projected-target evidence check in this snapshot.** It must not be justified after selecting the desired price. The following checks use the saved calculations, rather than choosing new anchors to manufacture a match:

| Study | Actual saved evidence | Does it derive a new 124,500 target? |
|---|---|---|
| Price swing | High printed on 2025-08-11, pivot confirmed 2025-09-01 | No; a past observation |
| Fibonacci | A = 24,220; B = 124,500. Formula: `B − ratio × (B − A)`. At ratio 0, the result is B by definition | No; 124,500 is the input endpoint, not independent evidence |
| Other retracements | 23.6% = 100,833.92; 38.2% = 86,193.04; 50% = 74,360.00 | None calculates a new 124,500 projection |
| Elliott hypothesis | Historical label 5 is the same August 2025 high; active candidate is C?, with unverified subdivisions | No; relabelling the same high is not a new impulse projection |
| 120-week regression | Last fitted midpoint 83,944.97; upper two-residual-sigma rail 121,204.15 | No; a fitted rail is not 124,500 or a six-month forecast |
| Parallel channels | No qualifying weekly parallel channel in this snapshot | No channel-derived target is available |
| SMA family | Last SMA21/55/89/144/233 values are 71,438.38 / 80,573.35 / 88,816.60 / 81,239.04 / 60,271.90 | No dated 124,500 price estimate |

Counting the historical high, Fibonacci endpoint and Elliott label as three confirmations would count the same input three times. They do not justify a projected TP. Historical Fibonacci endpoints (ratios 0 and 1) are omitted from horizontal levels and numeric labels; calculated interior retracements and the measured swing dates remain available. The unsupported 124,500 label is absent from the chart and current TP list. Current TP1–TP3 are disclosed support/resistance exits, not claims of Fibonacci/Elliott forecast confluence.

From the daily entry-study close of 81,617.50, reaching 124,500 would require about +52.54%. Fibonacci, Elliott labels, moving averages and channels do not establish that this will occur within six months. They also cannot prove that it cannot occur. The report should state conditions and uncertainty, rather than adopt an optimistic or pessimistic conviction.

The supported estimate is a **conditional sequence of observed resistance zones**. Weekly recovery first needs its entry condition, then encounters 89,111, 98,188.40 and 108,365. Each must be reassessed as completed candles change the structure. 124,500 remains historical context with no estimated arrival date or calibrated probability.

Fibonacci and Elliott can contribute conditional measurements when their anchors/counts are supported. PULSE displays confirmed Fibonacci anchors by default and labels Elliott as a swing hypothesis whose internal subdivisions are unverified. It does not add a large extension merely to produce attractive reward. A six-month probability forecast would require a separately specified model, point-in-time data, out-of-sample/walk-forward evaluation and calibration. This implementation has not performed that work and does not advertise such a forecast.

## Entry workflow and stop logic

1. Select the intended profile: **15m Fast → 5m entry; 1H Intraday → 15m; 4H Swing → 1H; 1D Position → 4H; 1W Macro → 1D UTC**. These are requested product profiles, not guaranteed holding durations.
2. Read LONG and SHORT separately. A direction, range label or old weekly close is not itself an entry.
3. A completed main-frame bar must satisfy the stated hold/rejection/breakout condition. A later entry-frame reaction must produce follow-through or a held retest. Open bars cannot confirm.
4. Establish SL from observed entry structure and recompute TP1 reward. Planned SL uses available confirmed entry swings or the mapped boundary. Observed protection includes the reaction/retest extreme and farther qualifying entry swing. Allowance is 0.10 entry-frame ATR or two ticks, whichever is greater, using information available at the signal. This is a disclosed PULSE research setting, not a backtested Vilarso formula.
5. Entry also requires sufficient reward, available suitable higher-frame evidence, a valid signal window and price in the supported Entry zone. Confirmation cannot repair poor reward. The chart explains the missing condition without using WAIT as its direction.
6. Recheck evidence and a fresh amount-specific quote. Server review verifies asset representation, currency, balance, fees/slippage, Entry, SL, TP and net R:R. A signal is not a fill. Spot SELL reduces owned inventory; analytical SHORT is not an instruction to open a leveraged position.

SL and a main-frame view change have different jobs. An entered trade can stop out before the weekly view changes. A closer SL is not intrinsically safer; ordinary entry-frame volatility may trigger it. Size follows acceptable cash loss divided by Entry–SL distance, including costs. Do not enlarge a position merely because a stop was drawn closer.

A 4H decline and a daily recovery can coexist. Each needs its own trigger, horizon and protection. Forcing unanimity, or calling a rejected daily LONG an active recommendation, would be misleading.

## Source review beyond Vilarso

Reviewed relevant official documentation and representative author-published education. This is not a claim to have reviewed every TradingView publication or independently verified all authors' trading records. Tool documentation is not evidence that a strategy is profitable.

| Primary source | Application |
|---|---|
| [TradingView Long position](https://www.tradingview.com/support/solutions/43000517002-long-position-drawing-tool/) and [Long/Short tools](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/) | Explicit Entry, stop, target and risk/reward geometry |
| [TradingView Parallel channel](https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/) | Parallel anchored rails; distinct from statistical regression |
| [TradingView Fibonacci retracement](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/) | Two disclosed extremes and ratio-based possible S/R; no forecast date |
| [TradingView multi-timeframe tutorial](https://www.tradingview.com/chart/TLT/gfhcvho3-How-to-Use-Multi-Timeframe-Analysis-and-What-It-Means/) | Different frames provide different observations |
| [TradingView other timeframes/data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/) and [repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/) | Confirmed data, delayed pivots and avoiding future leakage |
| [TradingView strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/) and [position brackets](https://www.tradingview.com/support/solutions/43000754954-position-brackets/) | Backtest/emulator assumptions and actual exit orders differ from drawings |
| [Capital.com pre-trade checklist](https://www.tradingview.com/chart/DE40/s0bwitq4-Brilliant-Basics-Part-5-Pre-Trade-Checklist/) | Entry, stop, sizing, profit-taking; pattern failure can precede SL |
| [Capital.com multi-timeframe education](https://www.tradingview.com/chart/GOLD/jeBr7iix-Brilliant-Basics-Part-4-Multi-Timeframe-Analysis/) | Main context and detailed execution observations |
| [LonesomeTheBlue multi-timeframe education](https://www.tradingview.com/chart/NDX/lgrkVkTV-Multi-timeframe-analysis/) | Context, intermediate structure and entry perspectives |
| [readCrypto channel example](https://www.tradingview.com/chart/BTCUSD/2Gu4lmme-New-chart-tool-released-Parallel-Channel/) | Anchor selection and S/R matter; a channel alone is not a trade |
| [Tradeciety risk/reward guide](https://tradeciety.com/how-to-use-reward-risk-ratio-guide) | Farther TP/closer SL may increase displayed R:R without improving a setup |
| [Vilarso PRO description](https://www.tradingview.com/script/G6hpaqTy-vilarso-pro/) and [public guide](https://t.me/s/vilarsopro?q=%23VilarsoPro) | BUY/SELL zones, trend, volume, modes and open-bar behavior; invite-only calculations are not reproduced |
| [Vilarso Trend description](https://www.tradingview.com/script/c9nPoO7m-vilarso-trend/) | Protected author indicator; PULSE RSI14 is not Vilarso Trend |

The app guide now includes these broader sources, the workflow, all five profiles and nine regenerated illustrations with fixture hashes/provenance. Available channels, Fibonacci, regression and SMA21/55/89/144/233 remain enabled by default with individual switches.

## Verification and limits

Checks cover exact reconstruction, current shared plans, positive examples for all five horizons and both directions, failed-test recovery, primary failures, insufficient reward, drawing/inset selection, visible canonical prices, English/Chinese delivery, saved-report rechecks and synthetic X Layer USD₮0 Market/Limit quote review. No wallet spending or live order is needed.

Reproduce reviewed PNG/TXT/Telegram artifacts using `node scripts/replay-global-trades.mjs` after building the schemas/domain/market/analysis/API workspaces. Outputs and validation are in `.tmp/global-trade-review`. Regenerate all nine guide images with `node scripts/render-global-guide.mjs`.

Browser verification covers desktop/mobile web and Telegram Mini App, both-side selection, default studies, chart stability and guide images. The final focused test run passed 438 tests: 37 domain, 175 analysis, 200 web and 26 API/recheck/delivery checks. The browser matrix passed 24 desktop/mobile cases with no runtime errors. Ten English/Chinese profile exports fit Telegram limits (maximum caption 598 characters and overview 1,847 characters). A clean Vercel-shaped build verifies that frontend compilation does not depend on server analysis/market build outputs or test fixtures.

Software checks establish consistency and usability, not investment performance. Remaining validation is chronological walk-forward/out-of-sample testing with costs and paper observation before any claim of a trading edge or calibrated forecast. No stop-fill guarantee, protected-indicator reproduction or automatic multi-TP order ladder is claimed.

## Fresh Base validation

The subsequent [four-report Base audit](GLOBAL_BASE_BTC_REPORT_AUDIT_2026-10-18.md) generated 1H, 4H, 1D and 1W Pro reports using the authorized test wallet for exactly 1.20 USDC. It also caught and corrected the unconfirmed 1H headline/selected-plan mismatch, PNG export selection and obsolete timing-schematic wording. The same paid snapshots were re-exported without another purchase or AI call. Original deliveries remain preserved.
