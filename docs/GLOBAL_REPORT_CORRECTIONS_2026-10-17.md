# BTC Global report corrections — 17 October 2026

Implementation follows the [audit of the four uploaded reports](GLOBAL_BTC_UPLOADED_REPORT_AUDIT_2026-10-17_1756.md). The replay uses public OKX candles at exactly the uploaded observation times. It does not request another model analysis or buy another report.

## What changes for the reader

The report separates **market structure**, **a possible BUY or SELL**, and **an observed entry signal**. A proposed trade that fails its own reward rule no longer supplies a dominant LONG headline in a mixed market. BUY and SELL conditions remain visible with the reason each does or does not qualify.

| Uploaded frame | Corrected interpretation at the same cutoff | Entry evidence |
| --- | --- | --- |
| 1H | Mixed structure; neither reference qualifies. BUY has 0.28R and SELL about 0.36R to its first obstacle. | 15m completed candles. A different observed reaction must justify protection and sufficient reward; another confirmation alone cannot repair the rejected geometry. |
| 4H | Observed range 80,809.50–84,166.30. Both edge studies are visible. The selected study is a prospective BUY at lower support, rather than an old internal-resistance SELL. | A 1H support reaction at 81,032.80, then another completed close above the reaction high. This has not been observed. |
| 1D UTC | Mixed structure; the BUY reference has 0.12R and the SELL reference about 1.38R. Both fall below the configured 1.50R floor. | 4H completed candles. The report explains both conditions without presenting the rejected buy as the market's required direction. |
| 1W UTC | Mixed structure. BUY above 82,842 with a later held test remains a possible recovery scenario; the earlier attempt ended. | Daily UTC completed candles. The newer daily close of 81,617.50 is displayed separately from the weekly 83,760.40 reference. |

These are historical snapshot interpretations, not current BTC orders.

## Calculation corrections

New reports use `decision-v3` / `structure-v3`. Older `structure-v2` reports retain their numeric maps and their original calculation for rechecks. Replaying the old calculation reproduces all four uploaded numeric references: `0c8d3da7`, `6b97b8bc`, `7df9442b`, `367da094`. Presentation corrections do not overwrite purchased prices.

The primary frame's evidenced classification now supplies path construction. Mixed conditions do not become bullish because an upside path happened to be created first. Presentation removes directional priority from the serialization-only main slot in mixed conditions. Candidate selection evaluates structure, reward, context and observed evidence symmetrically; proximity only orders otherwise eligible watch areas.

Unconfirmed range-edge studies remain eligible for discussion. Their first objective is the nearest intervening mapped primary swing cluster. The far range edge remains a structure objective, rather than replacing nearer obstacles to enlarge R:R. In the 4H replay, the lower-edge BUY's first obstacle becomes **82,800**, followed by **82,902.80**; its provisional first-obstacle reward is **6.38R**, not the old full-range 11.31R. The upper-edge SELL likewise retains intervening resistance/support levels instead of claiming 44.73R to its first obstacle. Internal range levels are explicitly distinguished from range edges.

Prospective breakout bands stay on the correct side of the trigger. A downside retest cannot gain eligibility from a hypothetical entry band above its breakdown level. Stops are not tightened merely to pass 1.50R, and targets are not deleted to manufacture reward.

## Entry conditions and risk

One shared entry-condition function supplies chart/TXT/app scenario prose and authenticated recheck explanations. Every condition names its entry timeframe. Higher-frame structure gates are labelled separately. Telegram captions use both conditions in mixed markets and distinguish watch areas from observed entries. Human text uses `1D (UTC)` / `1W (UTC)` rather than raw provider tokens.

Unobserved levels are labelled **Watch area** and **Provisional SL example**. Rejected geometry is not promoted into the main setup reference table. A real reaction or held retest establishes observed entry geometry and protection; quote review then checks the actual amount, prices, fees, slippage, asset representation and net reward. The gross 1.50R floor and 0.10 entry-ATR allowance are PULSE profile parameters, not attributed to Vilarso.

A narrow or wide percentage alone does not validate a stop. Its swing/reaction anchor and timeframe matter. The owner sizes a position from the acceptable cash loss and actual stop distance plus costs. This work does not backtest profitability or certify a particular risk percentage.

Manual Spot Market/Limit buy and sell remain available. Only fresh, observed BUY protection can be copied into a report-assisted order. The ticket retains editable TP/SL; a Spot SELL uses owned inventory. A SHORT research scenario does not open a leveraged short.

## Chart corrections

- Default history includes the relevant channel and wave anchors rather than a 24–48 candle fragment. The same scale calculation fits both enabled rails in native charts and exports. The 1H replay shows 119 bars, 4H 121, daily 94 and weekly 171.
- Pro opens with **Fibonacci, SMA21/55/89/144/233, regression and available structural channels already visible**. Individual controls are open by default, with a Reset studies button; no preset switch is needed. Missing parallel-channel controls are disabled with an explanation. Regression remains a separate, labelled construction.
- A recently broken channel can remain as historical context only when its preceding construction passes the existing fit rules. Outside-price state is explicit. Retention is limited to 12 completed bars and one current ATR beyond a rail; stale distant constructions are discarded. These are disclosed PULSE display rules, not a recovered proprietary algorithm.
- The daily replay shows its fitted rising channel with price below it. The weekly replay has no qualifying parallel channel; its cyan 120-bar ±2σ regression study is labelled separately.
- Range drawings use observed bounds and conditional level routes. The fixed repeated future zigzag is removed. Dashed routes describe price conditions, not future turning times.
- Fibonacci names the actual Fib A/B dates and prices, separately from Elliott letters. **Fit Fibonacci anchors** exposes the measured swing. Weekly macro anchors are August 14, 2023 and August 11, 2025; the arithmetic is unchanged.
- Weekly Elliott text separates the preceding upward impulse from the downward candidate C leg. The relevant earlier wave anchors are visible; unverified subdivisions remain disclosed.
- Exports use a shorter summary and larger body text; browser PNG downloads use twice the base resolution. Traders can switch each study off or on without replacing the underlying chart or resetting its user-controlled zoom. VWAP, pivot dots, ATR markers and channel midlines remain optional.

## Validation and limits

The repository includes the public-candle replay fixture and regression tests. Checks cover all four original numeric identities, symmetric rejected candidates, range first obstacles, channel pairs and anchors, entry frames, prospective band direction, and positive BUY/SELL breakout/reaction signals with matching rechecks. Browser checks cover desktop, mobile, Telegram Mini App layout, default-on studies, individual toggles and the illustrated guide. X Layer USD₮0 Market/Limit quote-review tests use synthetic catalog/quote responses and exercise both calculation versions; they do not spend wallet funds.

Final verification:

| Check | Result |
| --- | --- |
| Domain tests | 37 passed |
| Analysis tests, including the four uploaded cutoffs | 95 passed |
| Web tests, including manual Market/Limit buy/sell | 185 passed |
| Targeted API, Telegram delivery, authentication and quote-review tests | 22 passed |
| Desktop/mobile/Telegram browser cases | 20 passed; no runtime errors or horizontal overflow |
| English/Chinese TXT, PNG and Telegram field comparisons | 8 passed; captions 342–745 characters and messages 1,291–2,970 characters |
| Clean Vercel command, `npm run build -w @pulse/web` | Exit 0 with market/analysis outputs absent; no server-source or web-test dependencies in production compilation |

All **339 tests** passed with no skips. The four default PNGs were visually inspected, along with study views and native desktop/mobile/Telegram screenshots. The browser verified that Fibonacci, five SMAs and regression were enabled on initial load, that Fibonacci could be disabled and restored, and that available parallel rails remained visible. Existing bundle-size and dependency annotation warnings remain non-fatal.

Local replay artifacts are in `.tmp/global-audit-fixes`: each timeframe has its JSON, TXT, default PNG/SVG and study views; `delivery-validation.json` and `browser/validation.json` retain the delivery and browser results. These artifacts are local review files, not newly purchased reports. This verification made zero paid report calls, model calls, wallet payments or Telegram sends. No deployment, automation configuration or environment setting is part of this change.

Vilarso's protected code is not available. This implementation follows documented distinctions between parallel and regression channels, support/resistance and confirmation, and planned versus observed trade geometry. It does not claim to reproduce Vilarso's proprietary indicator. Primary research links and the evidence behind each defect are retained in the original audit.
