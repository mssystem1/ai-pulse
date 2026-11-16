# BTC report audit — 16 November 2026

Scope: the user's October 27–30, November 2 and November 9 exports and screenshots. Original reports remain unchanged. No other customers' reports or new paid reports are used.

| Saved report | Verified problem |
| --- | --- |
| October 28 weekly long | Entry 76,430.17–77,184.93, stop 73,733.58, quote 80,483.3. It required a new daily test and later follow-through. A remote conditional recovery was presented like a usable trade. The screenshot cannot establish a trigger or fill. |
| October 30 weekly long | Entry 74,501.60–75,682.08, stop 73,279.68, required reclaim 78,427.10. A later stop touch alone cannot prove that its required entry occurred. |
| November 2 daily short | Entry 78,107.50–78,649.30, stop 82,362.89, TP1 facing edge 77,007.50. TP1 offers about **0.26R** at the worst entry; overlapping primary support leaves **0R** immediate clearance. |
| November 9 daily short | Entry 74,856.90–74,883.60, stop 76,471.83, TP1 facing edge 74,846.40. Reward 10.50 / risk 1,614.93 = **0.00650R**, displayed as 0.01R. Quote 74,289.5 was already below entry. |
| November 9 weekly short | Entry 75,868–76,011.80, stop 79,110, obstacle 74,501.60. Clearance 1,366.40 / risk 3,242 = **0.42147R**. Distant targets cannot remove that obstacle. |

These short plans fail their saved 1R admission policy. Correct bearish direction does not make their entries usable. Daily and weekly directions can differ, but each needs its own supported execution and payoff. Images cannot establish order placement, intrabar order, venue fills or realized PnL; this is not a verified strategy win-rate study.

## Changes

- A fresh quote at or beyond the saved hard stop blocks a new entry, including while the weekly candle is still forming. Stale quotes do not establish this breach; no exchange fill or cancellation is inferred.
- Failed admission now shows **NO ENTRY** in the report heading and setup card, with the actual reason. Prices remain available for audit.
- A complementary price event cannot replace an independently supported core limit plan solely because it is more recent. When the event fails geometry and the core qualifies, retain the core. When both fail, keep the report blocked. Never shift Entry/SL/TP to manufacture payoff.
- Existing passive policies for structure zones, EMA pullbacks, range edges and VWAP deviations explicitly permit preparing a limit at the saved region after eligibility review, without adding future candle confirmation. Confirmed breakout/retest policies retain their own required event.
- A remote limit can remain unfilled. The report cannot promise a return to entry or invent a current fill to make a trader active.
- Completed indicator history excludes candles still marked unconfirmed, even after their nominal end passes.

## XO review

The [first-party Insilico interview](https://zencastr.com/z/NsBYVQlb), particularly its strategy discussion around 1:21:50, separates regimes, hypotheses and execution. The [btc_charlie Macro Trend Scanner](https://www.tradingview.com/script/Q95qqFgC-btc-charlie-Trader-XO-Macro-Trend-Scanner/) describes EMA/Stochastic RSI context and explicitly does not claim a perfect entry/exit system; its publisher is btc_charlie.

Earlier range/VWAP studies, including their losses, remain preserved in `GLOBAL_TRADER_XO_PLAYBOOK.md` and the research folders. These changes improve causal selection and execution clarity. They do not claim private XO rules or prove a profitable replacement strategy.

Regression tests use the supplied short geometry, reject weak payoff and preserve all original prices. See the ten-issue audit for final validation results.
