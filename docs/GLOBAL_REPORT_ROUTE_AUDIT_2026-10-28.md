# Global report route audit — 28 October 2026

This audit records repository corrections to saved Global report plans and their public chart guide. Deployment is a separate operator action.

The reviewed source snapshots were captured on 27 October 2026 at 21:45-21:46 UTC (28 October, 01:45-01:46 in Samara). Local corrections reused their original saved candles and captured quotes; no fresh quotes were requested.

## Corrected interpretation

- A previously visited support or resistance level can still obstruct a new Entry-to-target route. The latest completed close on its own source timeframe determines a pivot's current role; a wick or lower-timeframe spike does not by itself erase primary-timeframe evidence.
- Route checks start at the planned Entry. The captured quote being past an obstacle does not remove it from a future entry's route. An earlier move through an objective does not establish that a newly displayed plan entered or earned that reward.
- Genuine opposing-zone boundaries remain available in nearest-first order. Duplicate price/timeframe references do not inflate the evidence.
- Entry overlapping an opposing zone is explicitly treated as limited clear room ahead. A farther target cannot conceal that limitation, and the protective stop is not moved to improve the displayed result.
- The original source price and the conservative selected Entry fill are separate references. The report retains the sources and times for protection and objectives.
- Earlier saved plans remain readable. Free technical review uses their original saved candles, preserves the purchased original and does not fetch current market data.

For example, an Entry at 100, stop at 95 and target at 110 offers 2R to that target. Active resistance at 101 leaves only 0.2R before the nearer obstacle. The larger target alone does not establish favorable clearance. These are generic explanatory prices, not a trading recommendation.

## Guide and illustrations

The English/Chinese in-app guide, [chart user guide](GLOBAL_REPORT_CHART_GUIDE.md) and README explain route obstacles, overlapping Entry zones and free review in public product language. They do not publish selection recipes, tuning or confidential research.

Gallery illustration version `20261028` uses the tracked public historical fixture `packages/analysis/src/globalReport.oct20-fixture.json` and the current report renderer. All five horizons have English/Chinese and light/dark variants. Unchanged toolbar, TXT and Save/Share captures retain version `20261027`; older assets remain available. The 15m example explicitly shows unavailable 5m Entry-study coverage rather than synthesizing candles.

Final regeneration passed: 20 versioned illustrations and ten refreshed legacy images, all from the public fixture, with zero network or model calls. An opposite-theme visual review found an SL price badge colliding with an axis tick and a weekly legend covering a target. Both layout defects are corrected: the badge clears the tick and the legend avoids target levels. The final web build passed. Browser validation reused the 12 unchanged public UI captures; all 63 public image hashes remained unchanged during private-report checks. Purchased original report hashes were also preserved.

## Validation checkpoint

- Schema, domain, analysis, API and web builds passed.
- Complete domain tests passed 51/51 after the layout corrections; focused layout tests passed 5/5 and focused route tests passed 5/5. Web tests passed 208/208, and the final web production build passed.
- An independent audit passed 28 adversarial checks and five integration cases. Saved-source review passed for all five horizons and produced ten high-resolution PNGs; all five horizons received visual review.
- The complete Global analysis suite passed 277/277 with zero failures. The targeted five affected files passed 46/46, including the new route regressions; no stale assertions remain.
- First browser phase: 40 report cases and 90 download checks passed, with 160 intercepted export requests. The download checks include 88 recorded file/share results and two intentional canvas-failure cases that correctly showed visible errors. The saved report checkpoint contains zero recorded runtime errors and zero product writes.
- The combined run later failed its Docs terminal guard because three blocked Coinbase SDK telemetry POSTs to its exact /metrics endpoint were misclassified as product writes. The verified origin/path is now classified separately as blocked SDK telemetry. The stored checkpoint preserves the clean report/export results, while the original terminal-guard failure remains recorded. The guard against unknown product writes remains in place.
- Second browser phase: the targeted Docs-only run completed with exit code 0 across eight cases and 40 gallery choices, reusing 12 public captures. It recorded zero runtime errors and zero product writes. Known external SDK telemetry remained blocked.
- Recorded Clarity report text contrast was at least 11.55:1 across 20 stored artifacts and 800 samples. Docs minimum text contrast was 5.75:1 in Clarity and 6.45:1 in the dark appearance.

The checks establish software behavior and evidence preservation. They do not establish live entry readiness, actual fills, profitability or a win rate. No fresh-market validation is claimed for a review of saved candles. Native iOS/Android save/share dialogs were not tested on physical devices.

## Reproduce the public guide checks

After building the shared schema/domain/analysis packages:

```sh
node scripts/render-global-guide.mjs
npm run build -w @pulse/web
npm run test -w @pulse/web
node scripts/audit-global-chart-guide.mjs --docs-only --report-dir=.tmp/global-chart-guide-refresh/reports --themes=base,xlayer --output-dir .tmp/global-route-guide-docs-v7
```

The guide generator reads only tracked public candles and local renderer code. Public images contain no wallet data, payment receipts, credentials or private report payloads. This documentation phase makes no model calls, payments, orders or strategy backtests.
