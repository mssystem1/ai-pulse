# Market tools deployment follow-up — 7 November 2026

This follow-up fixes the three deployed problems reported on 6 November: nearly empty liquidity charts, unexplained missing intervals, and Market tools disappearing. Changes are local until deployed. The [validation record](TERMINAL_MARKET_TOOLS_FIX_2026-11-07.json) retains test counts, browser cases, real source clocks and guide image hashes.

## Findings and fixes

| Reported problem | Cause | Correction |
| --- | --- | --- |
| Tools disappear below the chart | Session conversion required the requested end time to precede the last collected observation, including empty sessions whose source clock is zero. The UI then gated every tool on that failed request. | Empty and incomplete sessions return their honest collection state. The five independently captured tools remain mounted during loading, errors and backfill. Assessment samples and selected-session executions have distinct labels and evidence bindings. |
| Only a few live book observations | Public history was tied to the unrelated trading-automation switch. Slow archive work could also consume the shared collection cycle. | The Terminal/history flags start public collection on long-lived hosts. Live books have an independent timer, provider client and fenced lease. Archive work cannot block that sampler. Requested sessions receive bounded priority while backlog resumes. |
| Valid current books rejected | Real public responses showed the exchange clock roughly 9–10 seconds ahead of this host. Both collection and display used a five-second uncalibrated future bound. | Official HTTPS response timing supplies bounded offset/uncertainty metadata. Local receipt time is preserved. Stale books, malformed calibration and implausible future timestamps still fail validation. Completed-minute cutoffs do not move forward. |
| Heatmap looks blank across hours/days | Sparse observations were fitted to the whole requested interval and price extent. A full day's movement also made a narrow near-price ladder difficult to read. | Fit captured history is the default. Display span offers the latest 15 minutes, hour or full captured period. Separate captured periods and Full selected interval remain available. Real gaps and unknown price depth stay hatched. |
| Missing intervals give little explanation | A generic missing observation message hid archive publication and retry state. | Coverage distinguishes retained slots, displayed observations, unpublished archives, validation failures and scheduled retries. Exact missing interval times remain inspectable. |
| Current tools are hard to discover on phones | The five tabs required horizontal scrolling. | Tabs wrap visibly on narrow screens; the session retry action and source scope remain readable. |

Source timestamps and local retrieval timestamps remain distinct. Calibration is not proof of exchange data authenticity, a fill, or future order persistence. The current source retains the configured number of levels per side; deeper and hidden liquidity are not invented.

## Using the updated tools

1. Open Terminal's Market view and choose a market/timeframe as before. Value & levels, Buy/sell flow, Footprint, Open interest & funding, and Order book remain visible.
2. Select a UTC execution session. While it loads or backfills, **Assessment execution sample** identifies the bounded assessment capture. Once retained executions are available, **Selected UTC execution session** identifies that source. Spot and Futures coverage remain separate; neither substitutes for the other.
3. For liquidity, choose the history interval, then use **Fit captured history** and **Display span**. The default latest captured hour makes near-price depth readable. Use **Captured period** for earlier separated history and **Full selected interval** to inspect the wider gap pattern.
4. Hover/tap a band for its price range, actual source time, local retrieval time and displayed bid/offer quantity. Read clock calibration when shown. An unknown region is different from a known zero inside the returned ladder.
5. Expand **Missing source intervals** for exact times and reasons. **Collect / backfill this market** requests another batch; background collection also continues without an open browser on a long-lived API host.

The bilingual app guide explains these controls and retains real historical examples. Eight guide captures were regenerated from actual components using the complete 1 November BTC execution session and order-book archive, including the new liquidity viewport and inspector.

## Deployment configuration

On a long-lived API host, enable `FEATURE_TRADING_TERMINAL=1` and `TERMINAL_HISTORY_ENABLED=1` with durable Redis/KV storage. Public history no longer requires `AUTOMATION_WORKER_ENABLED=1`. That switch retains its separate meaning for other automation.

Serverless hosts need a regular authenticated automation-tick schedule. A browser-only collection loop cannot provide continuous history while nobody has the page open. Existing `TERMINAL_HISTORY_*` limits control retention, sampling, levels, markets and work budgets; pass prices are unchanged.

## Validation

- **1,317 tests passed**: analysis 392, domain 78, market 57, web 283, API 507. One optional real Redis integration test was skipped because an isolated test instance was not configured.
- **65 actual Chrome checks**: 15 history/tool workflow and transport-race checks, 23 liquidity checks, 27 guide/component checks. Coverage includes five themes, desktop/phone widths, source failures, empty sessions, independent Spot/Futures streams, retry, owner/window changes, sparse periods, calibrated clocks and explicit gaps. Zero browser JavaScript errors.
- Domain, market, analysis, API and web builds passed. Vite retains existing dependency-annotation and bundle-size warnings.
- **Nine consecutive fresh public BTC order-book reads succeeded**, with zero rejections after calibration. The real storage and display model retained three distinct minute samples with positive bids/offers and honest missing-hour coverage. This is a two-minute acquisition check, not a claim of complete historical coverage.
- Real source checks also distinguished an available dated archive from an unpublished current archive. The complete historical guide fixture remains 177,587 executions and 1,440 genuine minute book observations.
- The Telegram workflow test was isolated from production environment credentials. Its transport remains captured locally; no real bot message was sent.

The earlier suite missed the normal zero-clock/empty-storage route condition because its stub populated the source clock from the request clock. The new regression exercises the real history storage/aggregation through the authenticated route, both before collection and with a growing incomplete tail.

No production deployment, push, payment, exchange order, real Telegram send or production-storage write was performed for this follow-up. The unrelated working-tree `package.json` changes are excluded.

## Remaining source limits

Unrecorded recent order-book intervals cannot be reconstructed before the exchange publishes the exact dated archive. A new deployment therefore needs genuine collection time; a wider requested interval does not create historical depth. Missing ranges stay visible and backfill resumes when data is available.

Busy execution backfills can lag the newest tail while their backward cursor completes. Such coverage remains incomplete and separately timestamped; the assessment execution sample remains available. Default 50-level captures cover near-price depth, not the entire exchange book, hidden orders or a liquidation map.

Trading Rules was rejected. The separate [PULSE Execution Lab proposal](PULSE_TAPEOUT_EXECUTION_LAB_PROPOSAL.md) describes a possible reusable Tapeout numerical workload and remains design-only, pending review and X Layer feasibility measurements.
