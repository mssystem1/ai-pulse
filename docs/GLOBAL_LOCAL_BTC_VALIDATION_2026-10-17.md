# Four local BTC Global Pro reports · 17 October 2026

Four reports were purchased through the updated **local API**, using `TEST_WALLET_ADDRESS` and real X Layer USD₮0 payments. Each cost 0.30 USD₮0; four exact token transfers were verified on chain, totaling **1.20 USD₮0**. No deployment was required. Existing configuration, storage and feature settings were preserved; local access used the configured public endpoint of the same Redis database.

These are live OKX completed candles and Grok `grok-4.5` narratives with premium reasoning `medium`, not synthetic reports. They were fetched October 16 at 20:43–20:46 UTC, which is **October 17 at 00:43–00:46 in Samara**. A fetched-at timestamp is separate from the last completed candle's timestamp.

## Results and meaning

| Frame / reference | Completed close | Primary research | Nearest gross R:R | Reference stop distance | Result |
| --- | ---: | --- | ---: | --- | --- |
| 1H / `ac551080` | 81,581.80 | Short / owned-Spot sell research | 1.04 | 0.16%; 0.25 ATR | **NO TRADE**: insufficient reward to the nearest obstacle. |
| 4H / `1ddafeaf` | 81,581.80 | Rejection / owned-Spot sell research | 5.90 | 0.30%; 0.25 ATR | **WAIT for subsequent retest**. Daily context supports recovery, opposing this bearish research. |
| 1D / `5504cb26` | 81,354.60 | Conditional long | 0.41 | 2.02%; 0.75 ATR | **NO TRADE**: insufficient reward; the previous Spot attempt is cancelled. |
| 1W / `c272d2e1` | 83,902.10 | Support-pullback long | 1.58 | 4.53%; 0.60 ATR | **INVALIDATED**: the latest completed week's low of 80,400 breached the 80,636.30 structural boundary. |

These are planning references, not active observed stops or orders. There is no currently qualified new entry among these four snapshots. That is a substantive result, rather than a reason to invent a buy or sell signal. A stop inside one selected bar's ATR is explicitly flagged as exposed to ordinary volatility; the 0.2-ATR buffer has not been established as an optimal strategy parameter.

The 1H and 1D maps cannot become eligible merely by printing another confirming candle: their nearest-obstacle reward is inadequate. A new price structure is needed. The 4H map requires a separate completed rejection retest at 82,556.60; its recorded retest deadline is October 17 at **04:00 UTC / 08:00 Samara**. Its context conflict also needs reassessment. Short research supports review of selling owned Spot, not a leveraged-short order. The weekly map needs a new valid weekly confirmation and later held test. Its next completed candle is October 18 at **16:00 UTC / 20:00 Samara**.

A valid technical reassessment still requires a fresh amount-specific quote, observed protection, verified representation and balance, and modeled net R:R of at least 1.50 before an order review. The four live market snapshots did not supply a valid long setup; successful technical qualification and Market/Limit handoff were separately exercised with synthetic conditions, including X Layer USD₮0/xBTC. No BTC trade was part of these report purchases.

## Weekly partial delivery

The 1H, 4H and 1D jobs completed with 520 candles each. The weekly job is **`completed_partial`**, because OKX supplied **470** completed weekly candles rather than the requested 520. Monthly context and the Grok analysis are present. The application currently marks any shorter-than-requested archive as partial, even when enough history exists for the displayed indicators. That status was preserved and is not counted as an unqualified full-history pass. No failed-payment retry or additional purchase was used.

## Comparison with the supplied October 16 reports

- The earlier daily 126,200 archive high remains historical context, approximately 20.32 current daily ATR away; it is absent from ordinary setup arrows and their price scale. The earlier 4H archive low at 62,268.50 is also absent from local setup arrows.
- The daily map changed after another daily candle completed. Its new trigger is 81,499.90 and the nearby objectives are 82,285.00 and 82,556.60. The new reference stop is 79,958.68. The first obstacle is retained even though doing so produces an unattractive ratio.
- The weekly completed candle and planning levels are unchanged. Fetching another report during the same unfinished week does not manufacture another weekly confirmation.
- Intraday plans changed with new completed candles. Their local Elliott count is an explicitly partial downwards 1–2 hypothesis; unobserved waves 3–5 are not drawn as historical facts. The weekly structure retains the larger 1–5/A–B–C candidate; Structure view exposes its older anchors.

## Audit and corrections

An independent calculation from each report's saved candles matched every supplied SMA series, Wilder ATR14, Wilder RSI14, volume ratio and primary gross R:R. SVG target labels and TP markers match the primary plan's target IDs and TXT ordering. No unobserved entry zone or protective stop is prefilled. Receipt-bound reopening returns the same canonical report, and unauthorized report access is rejected. Fresh technical rechecks require no new report payment.

All four PNGs and TXT files were inspected. The production web bundle passed 20 desktop/mobile, indicator, Telegram Mini App and illustrated-guide cases with no runtime exceptions or horizontal page overflow. Telegram views used the actual paid report bodies with a local host/library response fixture; no Telegram messages were sent. Synthetic interactive checks separately passed Market/Limit × desktop/mobile, including converted TP/SL, risk-budget blocking and invalidation after ticket changes.

Two presentation details found during the live audit were corrected and checked using the **same paid snapshots**, without new model generations or report payments:

1. The primary invalidation now names its own failure candle, closing timestamp, price and structural boundary. An older rejected test does not obscure a later primary failure. This is especially relevant to the weekly report, whose directional attempt and alternative Spot recovery watch are different records.
2. Remote calculated Fibonacci levels identify themselves as **derived extensions/retracements**, with an **anchor date**. They are not presented as historical prices traded on that date.

The implementation, original investigation and calibration limitations are documented in [the implementation note](GLOBAL_SETUP_IMPLEMENTATION_2026-10-16.md), [the investigation](GLOBAL_REPORT_INVESTIGATION_2026-10-16.md) and [the stop-policy diagnostics](GLOBAL_SETUP_CALIBRATION_2026-10-16.md).

## Private local evidence

The complete evidence is retained under `.tmp/global-live-local-2026-10-17/`: `results.json`, `independent-audit.json`, numeric `audit-facts.json`, four timestamped TXT/PNG/SVG/Markdown exports, Telegram text/captions, assessments, and desktop/mobile screenshots. Recovery capabilities and payment authorizations remain in the ignored `private/` folder and are excluded from the commit. The `.tmp` evidence is not a public share link.
