# Global BTC reports: strategy horizons and target correction

## Finding

The previous daily report used nearby daily swing levels as its first two objectives and used lower-timeframe structure for entry protection. That produced a daily LONG scenario with intraday-sized reward. The timeframe label alone did not make it a position trade. This was a methodology mismatch, rather than evidence that BTC should reach a much higher price.

The product now uses the owner's requested mapping throughout new reports:

| Main chart | Strategy | Intended holding scale | Entry timing |
| --- | --- | --- | --- |
| 15m | Fast | Minutes to hours | 5m |
| 1H | Intraday | Hours / current session | 15m |
| 4H | Swing | Days to weeks | 1H |
| 1D UTC | Position | Weeks to months | 4H |
| 1W UTC | Macro | Months and longer | 1D UTC |

These are PULSE product profiles. Neither these exact durations nor the numerical filters below are universal trading rules or a reproduction of Vilarso's protected strategy.

## What changed in the uploaded daily example

The replay uses the exact completed public candle cutoff of the uploaded daily report, **2026-10-17 17:47:28.435 UTC**. Its daily reference close is **81,617.50**, from the bar closed at **2026-10-17 00:00 UTC**. These numbers are historical observations, not today's execution prices.

| Item | Previous report | New position profile |
| --- | --- | --- |
| Recovery threshold | 82,285.00 | 82,285.00 |
| Nearby 82,556.60 | First objective | Checkpoint / resistance |
| Nearby 84,361.60 | Second objective | Checkpoint / resistance |
| Position objective | Not distinguished | 87,399.00, a confirmed major daily swing |
| Additional checkpoint | Not distinguished | 82,842.00 |
| Protection basis | Entry-frame swing / allowance | Confirmed major daily low 80,400.00, plus daily ATR allowance |
| Provisional stop reference | 80,732.02 | 80,174.74 |
| Primary confirmation | Lower-frame evidence could suffice | Completed daily confirmation before later 4H entry evidence |

The position objective is approximately **6.2%** above the 82,285 threshold. The first checkpoint is only about **0.33%** above it. They serve different purposes and are now labeled separately in the image and text.

The new prospective daily band is 82,285.00–82,362.47. At its less favorable edge, the objective offers about **2.30R**, but the first checkpoint offers only **0.09R**, before costs. Therefore this historical buy reference **does not qualify**. A farther objective cannot remove resistance directly above entry. The report needs a newly supported entry structure with adequate room, rather than another confirming candle at the same unattractive geometry.

The old distant 126,200 archive extreme does not become a daily position target merely to increase R:R. New objectives need confirmed primary-frame swing evidence within the strategy's structural horizon. Unsupported range extremes and Fibonacci projections are not substituted for that evidence.

## Stop placement

Each new strategy route identifies its most recent material, confirmed main-frame swing on the protective side: a low for BUY, a high for SELL. If there is no supported protective swing or objective, there is no priced entry plan for that route.

The stop clears that main-frame boundary, and any farther confirmed entry swing or observed reaction extreme. The buffer is the greater of two price ticks and **0.10 main-frame ATR14**, using information available at the signal. The lower entry frame retains its own touch allowance; it cannot shrink a macro or position stop into a small entry-frame stop.

This correction matters especially on the weekly chart. In the saved replay, the most recent qualifying major weekly low is **57,809.40**. A prospective macro BUY stop reference is consequently **57,183.15**, rather than the old approximately 80,175 daily-entry reference. That is a broad structural risk, and the nearest 89,111 checkpoint offers only about **0.23R**. The macro buy does not qualify. This illustrates why a nearby minor stop must not be used to manufacture attractive macro reward.

A wider stop is not automatically better. The system does not widen stops to a chosen percentage, force a minimum one-ATR distance, or claim a desired holding duration guarantees survival. Position size follows structural cash risk and costs. If the supported structure is too wide for a useful entry, the report should say so and require new structure.

## From analysis to an entry

1. Read the strategy, main-frame structure, conditional objectives and intervening checkpoints.
2. A **completed main-frame** breakout or support/resistance reaction must establish the relevant direction. Unfinished bars cannot confirm it.
3. After that main-frame close, actual lower-frame candles must supply a new held retest, or a reaction followed by a later close beyond its high/low. A failed attempt cannot reuse the same old primary confirmation.
4. Confirm that the measured entry band, major structural protection and nearest uncleared checkpoint support at least 1.50R before costs. Then assess a fresh amount-specific quote, costs, balance and representation before order review.

An objective is a conditional destination, not an instruction to enter. BUY and SELL candidates are evaluated independently. A fast sell, a four-hour range and a daily recovery scenario can coexist because their horizons and confirmation conditions differ. The longer-horizon scenario does not override the smaller chart's actual entry evidence.

For Spot, SELL reduces owned BTC. A SHORT research signal does not authorize or open a leveraged short. Existing manual Market/Limit BUY/SELL and editable TP/SL remain available.

## Implementation contract

- New reports use `decision-v4` / `structure-v4` and a saved `horizon-v1` strategy map. Older saved v2/v3 calculations and prices remain unchanged.
- Strategy structure uses confirmed primary pivots with a minimum reversal measured against ATR available when the pivot became known. Consecutive same-side candidates retain the more extreme pivot.
- Profile lookbacks are 96 / 120 / 180 / 260 / 520 primary bars for Fast through Macro. Minimum material reversals are 0.5 / 1 / 1.5 / 2 / 3 ATR respectively. Minimum objective distances are 0.5 / 0.75 / 1.5 / 1.5 / 1.5 primary ATR. These are explicit, uncalibrated research settings.
- Objectives are the nearest supported material swings beyond that minimum distance, ordered for the route's side. A range also respects its opposite edge. Nearer confirmed swings remain checkpoints and constrain entry qualification.
- A macro objective can be beyond the old four-ATR local-display limit. It is preserved as macro structure with intervening checkpoints. For example, confirmed weekly 109,800 / 124,500 references are distinct from a fabricated daily 126,200 target.
- Primary confirmation must occur after the relevant trigger, protection, objective and checkpoint anchors were known. Entry evidence must follow its completed close. ATR from a later primary bar cannot revise an already observed stop.
- Rechecks refresh real primary candles and ATR while retaining the purchased level map and pinned route. They use the same calculation as the saved plan. Quote review checks modeled net reward to the nearest uncleared checkpoint, rather than bypassing it with the farther strategy TP.
- Main chart windows now reflect the strategy's structural scope. Default display windows are at least 96 / 120 / 180 / 260 / 260 bars where available; construction anchors can enlarge smaller windows, up to the default cap. Full history retains all saved bars.
- Pro Fibonacci, five SMAs, regression and available parallel channels remain on by default. Missing channel evidence is stated, rather than creating decorative rails. Both displayed directions retain their checkpoints. Chart headings, text exports and the web strategy section identify the holding horizon.

The profile needs empirical calibration and forward validation before making performance claims. Passing software checks establishes consistency and evidence chronology, not profitability or a probability of reaching an objective.

## Validation

The four uploaded public-candle reconstructions retain their original v2 numeric identities: `0c8d3da7`, `6b97b8bc`, `7df9442b`, `367da094`. The new method is replayed separately on those same cutoffs. Fast adds 520 real public 5m candles, fetched in two read-only OKX requests, plus the existing 15m candles.

- Domain: 37 tests passed.
- Analysis: 138 tests passed, including all five profiles, BUY/SELL breakout and reaction qualification, primary confirmation chronology, failed-attempt reset, major stop scale, nearest-checkpoint reward, fresh primary rechecks and immutable older reports.
- Web: 190 tests passed, including strategy/horizon rendering in web and Telegram, existing manual tickets and report handoff behavior.
- Targeted API: 24 tests passed, including authenticated saved-report rechecks and synthetic X Layer USD₮0 Market/Limit quote reviews for v2/v3/v4.
- English/Chinese delivery: all five profiles matched their TXT/Telegram document output; ten caption/message comparisons passed. Captions were 361–828 characters and messages 1,448–3,261 characters.

Local replay artifacts are in `.tmp/global-audit-fixes`, including each profile's JSON, TXT, default PNG/SVG, study views and Telegram rendering. They are historical replays, not five new purchased reports. No model call, wallet spending, broadcast, Telegram send, automation change or environment change was needed.

- Browser: 24 desktop/mobile/Telegram/guide cases passed with no runtime errors or horizontal overflow. Checks verified default Fibonacci, five SMAs and regression, optional toggles, both available channel rails and preserved chart instances.
- Exact Vercel frontend build: exit 0 with compiled market/analysis outputs absent. The production TypeScript dependency list contained no market/analysis server source and no web test files. Existing annotation and bundle-size warnings were non-fatal.

All **389 unit/API tests** passed without skips. Default PNGs and native desktop/mobile/Telegram screenshots were inspected. Delivery results are retained in `delivery-validation.json`, browser results in `browser/validation.json`, and clean-build results in `.tmp/vercel-strategy-result.json`.

## Primary references and limits

[CME: Chart time frames](https://www.cmegroup.com/education/courses/using-the-trading-simulator/trading-sim-in-30-seconds-chart-time-frames) supports separating broader daily support/resistance from smaller-chart entry timing. [TradingView: Multi-timeframe analysis](https://www.tradingview.com/support/solutions/43000591555-leveraging-multi-timeframe-analysis/) explains the higher/lower timeframe distinction. [CME: Support and resistance](https://www.cmegroup.com/education/courses/trading-and-analysis/support-and-resistance) informs the distinction between objectives and intervening levels.

[TradingView: Other timeframes and data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/) and [Repainting](https://www.tradingview.com/pine-script-docs/concepts/repainting/) inform the completed-bar and information-availability constraints. None prescribes PULSE's exact ATR parameters, trade selection, or a proprietary Vilarso algorithm. The supplied Vilarso screenshot is a presentation reference, not a reproducible formula or authority for invented targets.
