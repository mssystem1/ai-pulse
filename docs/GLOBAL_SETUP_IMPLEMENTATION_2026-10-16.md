# Global setup implementation · 16 October 2026

The [investigation](GLOBAL_REPORT_INVESTIGATION_2026-10-16.md) established why the daily archive-high target, small-looking stops and persistent WAIT states were confusing. This change implements separate market-map, technical-assessment and quoted-order-review decisions. It does not make a forecast or force a trade.

The original purchased report remains immutable. No new report payment, model request, Telegram send or wallet transaction is needed for a technical recheck.

## Market map and charts

- Ordinary targets, recount endpoints and stress endpoints use the same four-ATR relevance bound. The nearest actual obstacle is retained even outside that bound; it is never skipped to improve reward. More distant historical levels remain separately labelled context, with date and distance where available.
- The October 16 daily 126,200 archive high and 4H 62,268.50 archive low no longer create ordinary setup arrows or stretch the setup price scale.
- Setup view uses 20–64 recent completed candles: daily up to 32, weekly up to 24. Structure view shows 180; Full history shows the archive. The PNG download follows the selected view. Optional studies preserve the price scale and are clipped to the price pane. They do not squeeze candles when enabled together.
- The chart shows a planned risk band. The card/TXT state total entry-to-stop distance in price, percent and the selected timeframe's ATR. A stop inside one ATR carries an explicit ordinary-volatility warning.
- TXT/PNG filenames and image captions carry a timestamp and short non-secret report reference. These references never authorize report access.

## Conditions and timing

The report distinguishes No trade, invalidated/expired attempts, waiting for confirmation, waiting for a later retest and technical validity. Failed nearest-obstacle reward is No trade; another confirming candle cannot repair that arithmetic. Directional research does not imply an executable order.

New reports and fresh assessments use `completed-v2` timing: a retest must complete within three full bars after confirmation closes. Entry remains valid for two full bars after the retest closes. A failed bar cannot simultaneously restart its own attempt. The next candle close and applicable deadlines are stated explicitly. Calendar months remain calendar months.

Rechecks use new completed candles against the saved trigger, boundary and targets. They do not silently select a new market map. Revised original candles, gaps, stale data/context, reached objectives or invalidated/expired attempts block a new entry. Quotes cannot substitute for a completed-candle test.

The observed stop clears both the retest extreme and the structural boundary, with the declared ATR buffer. The permitted entry range is constrained by reward to the nearest obstacle rather than a generic 0.05-ATR band. New observed protection can therefore differ from the original planning reference and must be loaded explicitly.

The reference buffer remains 0.2 ATR. [Bounded walk-forward diagnostics](GLOBAL_SETUP_CALIBRATION_2026-10-16.md) compared wider buffers but produced too few independent observations to justify a supposed optimum. No calibrated win rate, optimal holding period or guaranteed stop fill is claimed.

## Fresh assessment and order review

`POST /v1/global/setup-assessment` accepts an existing saved-report access capability:

```json
{"access":{"kind":"job","id":"EXISTING_JOB_ID","token":"EXISTING_RECOVERY_CAPABILITY"}}
```

Wallet-history sessions and existing, non-revoked share capabilities are also supported. The API loads the saved report itself. Client reports, fee assertions and unknown input fields are rejected. The response contains `pulse-global-assessment-v1`, source reference/time, fresh completed-candle evidence, status, deadlines, observed protection and blockers. No authorization capability, payer or model prose is returned.

An optional `trade` supplies the actual network, contracts, amount, wallet, Market/Limit choice, slippage settings and ticket TP/SL. The server checks the reviewed representation, exact quote identity/decimals, settlement balance, current entry and reverse route, network-fee evidence, currency conversion, entry range and modeled net R:R ≥ 1.50. Limit review also checks its minimum output. Unknown fees never become zero. USDT research references are converted to USDC execution prices using a current USDC/USDT rate; the ticket must load those converted protection levels. Cash risk remains explicitly labelled in the research currency. A Limit handoff starts from the completed-price reference within the permitted range, rather than automatically choosing the maximum gross-only reward boundary.

The cost model includes current round-trip route loss, both network estimates and a two-sided slippage budget. OKX documents `tradeFee` as a USD network-fee estimate; `estimateGasFee` is not substituted for a USD amount. [OKX quote reference](https://web3.okx.com/onchainos/dev-docs/trade/dex-get-quote).

Technical checks last at most 60 seconds; quotes at most 30 seconds. Ready means **ready for order review**, with gas, account setup and protection still reviewed before wallet approval. Future routes and stop fills can change. It does not broadcast an order.

Market and Limit handoffs retain observed TP/SL. Changing amount, contracts, slippage, minimum output or protection invalidates the review. A chosen cash-risk budget can block readiness and supplies a sizing reference. Report-based Limit orders expire at the technical entry deadline, rather than the generic 30-day manual-order deadline. An expired quote review must be refreshed before opening the wallet; a token approval already confirmed onchain is not undone.

X Layer uses the registry's USD₮0 settlement asset and the [officially published xBTC contract](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts). Its symbol and eight decimals were checked directly on chain. Synthetic Market/Limit regressions cover this exact pair and reject quotes returned for another chain. Contract/chain checks are independent of a token's display symbol.

Owned-Spot sells remain distinct from leveraged short research. No hypothetical short TP/SL is copied into a Spot buy. Explicit manual tickets remain available. Automatic quoted readiness currently requires a reviewed contract and supported research/settlement currency conversion; unreviewed representations and Robinhood rebasing stay in explicit manual review. Existing trading functionality remains available there.

## Telegram and agent delivery

The authenticated Telegram research route `POST /v1/telegram/ton/orders/:id/setup-assessment` rechecks an owned completed report directly. It requires no EVM handoff, wallet or new share. Regular Telegram summaries, image captions, TXT and MCP-compatible fields use the shared status and risk presentation; full text retains all conditions. The illustrated app guide includes new No-trade, focused-risk and workflow images.

## Validation

All validation uses saved public OHLCV or synthetic data. The numerical replay covers October 14/16, four timeframes, Quick/Pro and English/Chinese. Tests include successful technical qualification and quoted Market/Limit review; stale/revised evidence, failed/expired attempts, reached targets, low net reward, missing fees, wrong contracts, altered protection, weak minimum output, unauthorized access and revoked shares.

The browser audits exercise desktop/mobile report rendering, Telegram research rendering, chart views/studies, illustrated docs and both Market/Limit handoffs. Screenshots are captured and visually inspected; the workflow harness explicitly checks the mobile viewport and blocks external requests.

Completed local checks: 91 API/domain/analysis regressions and 17 web tests passed without skips; the additional X Layer regression and related token/quote checks also passed (12 tests in that focused run, overlapping the earlier suite). All 32 saved-candle replays passed. The production-bundle audit passed 20 desktop/mobile/report/Telegram/docs cases with no runtime errors; the interactive workflow audit passed four Market/Limit and viewport combinations. Schema, domain, analysis, API and production web builds passed. These checks do not establish trading profitability or replace deployment validation.

The four user-authorized BTC Global Pro reports were subsequently purchased against the updated local API on X Layer, one each for 1H, 4H, 1D and 1W, at 0.30 USD₮0 each (1.20 total). Their actual TXT/PNG outputs, receipts and desktop/mobile rendering were audited. The weekly job retains its partial-history status (470/520 bars). See the [local live-validation report](GLOBAL_LOCAL_BTC_VALIDATION_2026-10-17.md) for results and the final display corrections found during that audit. No deployment was required for those local purchases.

Reproduce after building schemas, domain, analysis and API:

```powershell
node scripts/validate-global-setup.mjs --write-docs
node scripts/global-stop-diagnostics.mjs --write-docs
node scripts/validate-global-workflow-ui.mjs
```

The last command requires the localhost Vite server on port 5190 and Chrome. Local artifacts are under `.tmp/global-setup-validation/` and `.tmp/global-workflow-ui/`. Private saved reports, provider prose, wallet metadata and authorization material are excluded from committed fixtures and illustrations.
