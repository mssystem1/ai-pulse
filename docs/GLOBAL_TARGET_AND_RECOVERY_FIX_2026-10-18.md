# BTC Global target and processing incident — 18 October 2026

Historical incident record. Current entry-evidence rules, limitations and backtest results are documented in the [reopened October 20 audit](GLOBAL_REPORT_AUDIT_2026-10-20.md).

**Subsequent strategy correction:** the [single-setup audit](GLOBAL_SINGLE_SETUP_STRATEGY_2026-10-18.md) adds one strategy per report and restores its conditional projected move while retaining every target/recovery fix here. The LONG prices below are forensic candidate calculations, not a second published setup. Earlier target-only artifacts are historical intermediate results.

The reported daily report `9d763a0a` had a real target-selection defect. LONG Entry was 82,285–82,357.02, SL 80,737.48, and TP1 82,473.60: only 116.58 above the least favorable entry, approximately **0.14% / 0.07R**. The previous audit checked consistent prices across outputs but did not catch that this historical pivot had lost its resistance role. Its target-selection conclusion is superseded by this correction.

## Target cause and correction

`globalTradeMap.ts` formerly selected price-sorted confirmed pivots without checking their subsequent history or requiring a resistance high for LONG / support low for SHORT. The May 10 high at 82,473.60 was already crossed by later completed daily closes, including October 10–13. A pivot's historical confirmation was incorrectly treated as proof that it remained a current barrier. Blocking entry for weak reward did not make that target appropriate.

The new `active-zones-v1` policy:

- Uses confirmed primary-frame highs for LONG resistance and lows for SHORT support within the selected strategy horizon.
- Excludes a pivot when a later completed close crosses its price after its confirmation became knowable. Wicks alone do not consume its role. A later confirmed interaction can establish a new level; merely crossing back cannot revive the old pivot.
- Groups active prices within 0.20 primary-frame ATR and uses the nearest edge, without allowing a consumed pivot in the same cluster to reappear.
- Uses confirmed active swings even when they are Fibonacci measurement endpoints: that coincidence cannot erase a genuine barrier. Derived Fibonacci prices alone do not become targets. Unsupported extensions and later targets remain unavailable.
- Validates active target anchors and their nearest edge in the report schema. Stops and entry confirmation remain independent; insufficient reward still blocks entry. Nearby genuine barriers cannot be skipped merely to improve R:R.
- Blocks a fresh setup recheck if new completed candles have consumed the saved TP1; crossing back later cannot turn spent reward into a fresh target.

For the exact reported snapshot:

| LONG plan | Old | Corrected |
|---|---|---|
| Entry | 82,285–82,357.02 | unchanged |
| SL | 80,737.48 | unchanged |
| TP1 | 82,473.60 / +0.14% | **84,361.60 / +2.43%**, confirmed October 12 resistance |
| TP2 | 84,361.60 | **87,238.30 / +5.93%**, nearest edge of the 87,238.30–87,399 resistance zone |
| TP3 | 87,399 | unavailable: no further supported target in this snapshot |
| R:R to TP1 | 0.07 | **1.24**, still below the 1.50 entry gate |

The close-consumption rule, ATR grouping, endpoint treatment and 1.50R gate are **PULSE research choices**, not TradingView requirements or validated profitability claims. TradingView's [Long Position tool](https://www.tradingview.com/support/solutions/43000517002-long-position-drawing-tool/) lets an analyst set entry, target and stop. Its [Fibonacci guide](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/) describes potential support/resistance from measured extremes, and its [Parallel Channel guide](https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/) explains anchored channel geometry. None mandates making every historical pivot a TP. These relevant official guides were inspected; this is not a claim to have reviewed every TradingView page.

## Processing cause and recovery

The HAR contains 190 requests but omits all response bodies. Job polling returned 200, and a report GET also returned 200. Those statuses alone do not prove what the UI received. Recovery used the existing private capability and verified that the settled receipt belongs to `TEST_WALLET_ADDRESS` on Base. No new payment, model request, trade or wallet signature was needed.

The persisted production job `1bc574b6-27ce-4690-bdce-7c83f09222df` records:

| Event | UTC |
|---|---|
| Payment settled / initial worker claim | 13:47:00 |
| Initial AI-generation stage | 13:47:00 |
| Replacement worker claim | 13:52:26 |
| Validation | 13:52:46 |
| Completed and stored | 13:52:48 |

Total delivery took **5m 48s**. The replacement worker completed in **22.08 seconds**; its AI stage lasted approximately 20 seconds. Regeneration attempts were zero. The repeated worker claim and gap match recovery after the original **300-second lease** expired, plus queue scheduling. Why the first worker stopped renewing is not recorded in the job; hosting logs would be needed to distinguish a restart, crash or other interruption.

The code previously had no graceful report-worker shutdown. It now releases its own jobs immediately on SIGTERM/SIGINT and aborts in-flight Global AI work. Crash recovery uses a **60-second lease**, renewed every 10 seconds; actual resumption also depends on healthy storage, maintenance scheduling and available capacity. Stage updates and final publication check lease ownership atomically, and completion is absorbing and idempotent. An obsolete worker cannot replace the replacement's report. Cancellation does not consume a model-regeneration attempt.

Two client weaknesses also contributed to misleading processing/recovery behavior: pending wallet-history rows did not refresh, and report fetches had no deadline. Recovery could also clear saved access after a missing or superseded payload. The patch refreshes pending history, bounds status/report fetches, serializes manual recovery, checks request ownership before applying/clearing state, and retains recovery access on failed delivery.

The new animated step list follows actual server stages: market data → structure → AI analysis → asset context → verification/saving → opening. It scrolls its own current step into view, displays total/stage elapsed time and the last successful check, highlights unusually long steps, supports reduced motion, and never fabricates a percentage or claims the worker is alive from a 200 polling response alone.

## Existing reports and artifacts

Original reports remain stored unchanged. The authenticated `POST /v1/global/target-review` route supplies a separately referenced technical correction using saved candles only. The web report offers **Review setup and targets · free**, and chart/TXT downloads use that reviewed map. Setup rechecks use the corrected policy too. New reports use it by default. No purchased model prose is presented as newly generated analysis.

- Reported daily review `1b9016a5`: [TXT](../.tmp/global-stalled-job-2026-10-18/corrected/BTC-1Dutc-target-review-1b9016a5.txt), [LONG chart](../.tmp/global-stalled-job-2026-10-18/corrected/BTC-1Dutc-target-review-1b9016a5-long.png), [SHORT chart](../.tmp/global-stalled-job-2026-10-18/corrected/BTC-1Dutc-target-review-1b9016a5-short.png).
- Intermediate target-only reviews of the earlier four paid reports: 1H `b6965a9b`, 4H `592f5f71`, 1D `c8d4e519`, 1W `c953e66c`. Original references remain unchanged in their audit.
- Reproduce a correction: `node scripts/review-global-targets.mjs <saved-delivery.json> <output-directory>`.
- Public regression evidence contains only OHLCV: `packages/analysis/src/globalTargets.oct18-fixture.json`. HAR capabilities, receipts and complete authenticated deliveries remain in gitignored private files.

## Validation and release

Regression coverage includes the exact daily prices, consumed pivots within a later cluster, short symmetry, confirmation-time ordering, wick-only tests, fresh same-side pivots, schema rejection of consumed targets, unchanged original snapshots, authenticated free review without market/model calls, shutdown release, lease ownership and immutable completion, persisted stage timing, and completed-report recovery. README, main in-app docs, chart guide and generated historical guide images are updated with the policy.

Before the single-setup extension, analysis/domain tests passed **223/223**; web tests pass **202/202**; the full API suite passes **382**, with **one existing skip**. Changed packages pass TypeScript, and the production frontend builds using Vite's runner configuration loader. Existing bundle-size and third-party annotation warnings remain. The initial API-suite failure was reproduced with the prior app source: its Arc fixture test inherited the developer's xAI credentials. The fixture configuration now explicitly disables that live key; actual application configuration is unchanged. No live model request was sent by the fixture.

Browser evidence covers desktop/mobile overflow, all generation stages and active-step scrolling, reduced motion, all five appearances, access retention after an empty report response, automatic completion and free target review. Screenshots and results are under `.tmp/global-stalled-job-2026-10-18/browser/`. Reproduce with a local Vite server on port 5263 and `node scripts/audit-global-report-progress.mjs`; the audit uses only the public OHLCV fixture and fake capabilities and blocks external requests.

This is a local source correction. API and frontend must be released together to expose the corrected generation, free review and progress widget on the hosted app. No production deployment was performed.
