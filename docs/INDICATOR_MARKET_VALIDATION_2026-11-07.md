# Indicator Market and Terminal usability validation — 7 November 2026

The implementation passes the local API, browser and funded Base acceptance checks below. It is committed locally; these checks do not establish that the deployed public app already contains the changes.

## Delivered behavior

- Desktop **Save file** downloads PNG/TXT directly, including locally prepared exports. **Share / Save to Files** remains a separate action. Mobile/Telegram fallbacks are retained.
- Market-tools execution and liquidity windows follow the selected chart horizon by default. Manual overrides persist through timeframe changes; **Follow chart timeframe** restores automatic selection.
- Ask PULSE entry buttons have one recognizable appearance. Explicit retained-session evidence overrides a newer parent assessment when opening a question. The actual model is recorded with each answer.
- Ask PULSE inherits `GROK_MODEL` when `GROK_COPILOT_MODEL` is omitted/empty. Templates/defaults use `grok-4.7`; reasoning effort and output limits are configurable. A live evidence-bound answer returned `model: grok-4.7`.
- Indicator Market supports two genuine numerical TAP-02 kernels, installation, file import/export, creator-labelled packages, authenticated catalog publication, immutable versions and owner-only unpublishing. Another standalone host reproduced the exported numerical calculations.
- README, landing copy, app guide and repository documentation describe the delivered workflow and current limits. Existing header/navigation and trading strategies were retained.

## Automated checks

| Suite | Passed | Skipped |
|---|---:|---:|
| Domain | 85 | 0 |
| Web | 292 | 0 |
| API | 508 | 1 |
| Analysis | 392 | 0 |
| Config | 14 | 0 |
| **Total** | **1,291** | **1** |

The optional Redis-specific automated case was skipped by its existing opt-in gate. Actual durable Redis storage was exercised by the funded integration run. Final focused rechecks cover source-edge buckets, selected evidence, Redis JSON decoding, immutable versions, publishing ownership and quota rejection before blob storage. API TypeScript and the production web build passed.

Raw logs are under `.tmp/indicator-market-audit/`. Existing dependency annotations and bundle-size warnings remain in the production build log; there were no build errors.

## Actual wallet / Base acceptance

The signer matched configured `TEST_WALLET_ADDRESS`. An expired pass required **one 1.50 USDC 24-hour purchase on Base**. Subsequent runs reused that grant. The receipt was checked against the configured USDC contract, payer, payee and exact 1,500,000 atomic-unit transfer.

Transaction: [0x90309f954c88830bf8208c3610e339bd5ed380ebc35d81d53cb73e864a3a841f](https://basescan.org/tx/0x90309f954c88830bf8208c3610e339bd5ed380ebc35d81d53cb73e864a3a841f), Base block 54,330,055. Grant expires **8 November 2026, 12:59:38 UTC**. No exchange order or Telegram message was sent.

With the real wallet grant, the test authenticated, published a temporary QA package, reloaded its exact bytes, verified the publisher, then unpublished it. It calculated CVD from fresh BTC executions and obtained a live Grok 4.7 explanation bound to the selected source capture. Daily, weekly and monthly session endpoints returned correctly bounded windows; their backfill remained incomplete in this environment. These reads do not prove full macro history coverage.

The full PULSE app was then opened in Chrome with a restricted test-wallet message signer. Checks passed for unchanged navigation, Terminal after Portfolio, owner sign-in, the real pass countdown, live chart/indicator panes, catalog installation, AI-button context/model and layouts at 1,440px and 390px in Clarity and dark themes. No runtime exceptions or transaction-signing requests occurred. Mobile viewports were emulated; physical phones were not tested.

## Export and portability checks

The report export audit passed **20 page cases / 50 export checks** with 80 successful local export HTTP requests. It covered actual desktop PNG/TXT downloads, desktop local/offline preparation, explicit sharing, mobile fallbacks, Telegram compatibility and visible canvas failures. It made no wallet payments, model calls or Telegram sends.

In Chrome, an exported CVD file was imported by the independent static host: buy 120, sell 80, prior CVD 20 produced delta **40** and CVD **60**. The independently imported buyer-participation circuit produced **60%**. Valid imports installed; modified netlists were rejected. All five timeframe defaults and preservation of manual session/book choices were checked through component remounts.

## Problems found by the funded audit and fixed

1. Redis decoded a bare top-level package JSON string into an object. Packages now store exact export bytes in an envelope, preserving checksum validation across both storage adapters. A JSON-decoding adapter regression test covers this behavior.
2. Live assessment display buckets could begin before the actual captured execution interval. The adapter clips boundary labels to the genuine source window without discarding observed volume or inventing earlier executions. A regression test covers partial first/last buckets.

## Limits

This is the first portable Indicator Market release. Numerical kernels run locally and have **not** been registered/fabricated on X Layer. The catalog is PULSE-hosted; the independent host demonstrates compatibility without claiming adoption by unrelated applications. Only two reviewed formulas are accepted; arbitrary creator code, paid indicator sales and creator payouts are not implemented.

Missing historical source intervals remain unknown. Incomplete session responses and stale sources are labelled; current quotes or recent samples do not become full monthly profiles. No test establishes a profitable trading edge or complete third-party platform parity.

See [implementation and integration guide](PULSE_INDICATOR_MARKET.md) and [machine-readable validation](INDICATOR_MARKET_VALIDATION_2026-11-07.json).
