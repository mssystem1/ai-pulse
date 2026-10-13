# Global chart research and reading guide

This note records the public documentation reviewed for the October chart correction. The end-user guide is available in the app at `/docs#docs-global-chart` in English and Chinese. Five historical chart images show the setup, trend/regression, Fibonacci, VWAP/ATR/pivots and RSI/context, with captions and links to full-resolution PNGs. They are rendered from the saved paid BTC-USDT snapshot; image provenance is stored under `apps/web/public/docs/global-chart/provenance.json`.

## What Vilarso publishes

The [author's public Pro guide](https://t.me/s/vilarsopro?q=%23VilarsoPro) documents multiple moving averages, regression, fractal high/low signals, configurable activity/volatility and three trading modes. It warns that a signal can appear or disappear before the candle closes.

The [author's Pro script description](https://www.tradingview.com/script/G6hpaqTy-vilarso-pro/) describes average-price calculations, volume, volatility, candle patterns and a regression channel. The script is invite-only. Its public documentation does not supply the current proprietary calculation code.

The separate [Vilarso Trend description](https://www.tradingview.com/script/c9nPoO7m-vilarso-trend/) describes an oscillator with fast/slow moving averages, zones above/below zero and divergence interpretation. It is protected source. PULSE's RSI14 is a different indicator; it must not be presented as Vilarso Trend.

The [public market channel](https://t.me/s/vilarsofree) and supplied screenshots show concise commentary, conditional paths, cancellations and named levels. The available sources do not establish that LT/UF/DF/B1/B2/S1/S2 are ordinary Fibonacci retracement ratios. PULSE's stage names and measured levels have their own definitions.

## Chart decision

Use a readable setup as the starting point. Quick shows completed candles, volume, SMA55, the available swing channel, an evidence-qualified Elliott hypothesis and two conditional paths. An unsupported count stays `Count unclear`.

Pro adds a third conditional path, independently observed higher-timeframe context, RSI14 and optional studies. Setup, Trend and Fibonacci views answer different questions. The SMA family, regression, anchored VWAP, confirmed pivots and ATR are available through Indicator settings. They do not become independent confirmations merely because they agree: several are derived from the same price series.

The Spot card and chart resolve the same saved trigger, targets and cancellation floor. Watching has no invented entry, protective SL or net R:R. A confirmed setup can support the existing separate Market/Limit review and eligible TP/SL prefill. No chart control submits an order.

Indicator visibility changes preserve the existing chart and time viewport. Recent-candle and setup views reserve room for conditional paths. Panning into older history hides future routes and stops distant scenario targets from stretching the historical price scale. Projected swing-channel segments are clipped inside the price pane. RSI has its own pane; context is outside that pane in the interactive view.

## Fibonacci drawing

[TradingView's drawing documentation](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/) describes two extreme anchors, a reference diagonal, horizontal ratio lines, fills, labels and optional line extension. Retracement and extension tools are distinct.

PULSE uses the saved confirmed A→B swing on a linear price scale. Zero is B; one is A. Retracement prices are `B − (B − A) × ratio`, for `0, 0.236, 0.382, 0.5, 0.618, 0.786, 1`. The drawing shows the reference diagonal, faint measured range, ratio/percentage/price labels and left-extended horizontal lines. The first and last ratios identify B and A. Labels can be omitted when too close together; their lines retain the actual price coordinates.

Older reports containing three internal ratios use those same saved anchors to display the complete standard retracement drawing. Saved market data, trade levels and report interpretation are not recalculated. Missing, unconfirmed or inconsistent anchor evidence makes Fibonacci unavailable. The report engine also requires the measured confirmed leg to span at least twice the current ATR14; a smaller latest leg leaves Fibonacci unavailable. Retracement lines never silently replace Spot targets or protective SL.

## TradingView API evaluation

The app already uses TradingView Lightweight Charts 5.2.1. Its [official product comparison](https://tradingview.github.io/lightweight-charts/docs/product-comparison) explains that indicators must be calculated and plotted by the application. Advanced Charts includes built-in studies and drawing tools, requires separate access and connects to an application datafeed. Hosted widgets use TradingView data and cannot consume PULSE's saved report snapshot.

The immediate correction therefore keeps the current library and fixes lifecycle, scaling, annotation bounds and study selection. A later Advanced Charts integration would require library access and a snapshot-bound datafeed. It cannot be represented as a simple API URL change or as access to Vilarso's protected code.

## Validation evidence

Browser evidence is stored under `.tmp/asp-audit/browser-after-fixes`. It uses the actual paid Base Quick/Pro snapshots in the rebuilt application, intercepting only the read-only shared-report response. All browser mutations are blocked. These are local rendering checks, not evidence that the correction is deployed.

Review includes desktop/mobile screenshots, an all-studies view, Fibonacci, time zoom followed by indicator toggles, historical pan, and the in-app guide. Domain checks cover rising/falling Fibonacci prices, unconfirmed/inconsistent anchors, channel clipping and preserved canonical Spot levels. API checks cover report and Telegram delivery. Required deployment and marketplace review checks are tracked separately in the ASP audit.
