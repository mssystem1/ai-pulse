# Global chart guide refresh — 28 October 2026

The Global chart documentation now explains the current report panel and download flow. Illustration version `20261027` began on 27 October and was validated on 28 October. The repository changes are prepared for manual deployment; this audit does not establish that the public site has received them.

## Changes

- Reworked the English/Chinese in-app guide at `/docs#docs-global-chart` around the actual controls: Setup view, Structure view, Value context, Full history, separate view/study resets, indicator availability, mobile inspection and the primary/entry/context timeframe map.
- Added nearby chart hints and stronger visual emphasis for **Download chart PNG** in the chart toolbar and **Download report TXT** in the report heading. The guide shows both locations and the prepare → preview → Save/Share flow.
- Replaced stale illustrations with 20 current-renderer gallery images: all five horizons, English/Chinese and light/dark appearances. Refreshed 10 legacy image URLs and added 12 actual browser captures at 2× resolution covering the controls, TXT action and save dialog.
- Updated the Markdown chart guide and README. Clarified saved-analysis timestamps, viewport persistence, source-backed price zones, fixed Hard SL, missing evidence and export behavior.

**Reset view** restores the default time window and automatic price scale. **Reset studies**, Setup view, Structure view and individual studies preserve interactive inspection. Full history and Show measured swing explicitly fit their requested history. PNG export is a full report map with selected studies and appearance, rather than a screenshot of temporary zoom.

The 15m historical example explicitly identifies its unavailable 5m entry study. Missing coverage is not synthesized. The gallery captions distinguish educational chart excerpts from the full report and its written evidence.

## Validation status

| Check | Recorded result |
| --- | --- |
| Production web build | Passed |
| Web test suite | 208 tests passed |
| Generated gallery and legacy assets | 20 gallery PNGs and 10 refreshed legacy images |
| Actual browser UI captures | 12 captures at 2× resolution |
| Report/browser cases | 40 cases passed their functional checks |
| Export assertions | 90 functional assertions passed |
| Docs/browser coverage | 8 cases and 40 gallery choices passed their checks |
| Initial combined harness completion | Functional checks passed; its final bookkeeping assertion failed because **blocked** wallet-SDK telemetry requests to `/amp`, `/batch` and `/metrics` were classified as report mutations |
| Targeted Docs rerun | Passed with exit code 0: 8 Docs cases, 40 gallery selections, 12 reused UI captures, zero runtime errors and zero application mutations |
| Measured Docs text contrast | Minimum 5.75:1 in Clarity and 6.45:1 in dark appearance across the 8 cases |

The harness now classifies verified SDK telemetry separately from application mutations while continuing to block unknown writes. The targeted rerun observed only the verified Coinbase `/amp` and WalletConnect `/batch` telemetry origins, with no unknown application mutations, and passed after this correction. The initial combined run's bookkeeping failure remains recorded above; it is not presented as a clean exit for that earlier run.

Browser screenshots and initial validation artifacts are retained locally in `.tmp/global-chart-guide-browser`. The successful targeted rerun is recorded in `.tmp/global-chart-guide-docs-only/guide-validation.json`. Physical iOS/Android devices and their native save/share dialogs were not tested in this phase. Browser emulation and simulated client interfaces do not replace that device verification.

## Reproduction

Run from the repository root after dependencies are installed:

```sh
npm run build -w @pulse/analysis
node scripts/render-global-guide.mjs
npm run build -w @pulse/web
npm run test -w @pulse/web
node scripts/audit-global-chart-guide.mjs --report-dir=.tmp/global-chart-guide-refresh/reports --themes=base,xlayer --output-dir .tmp/global-chart-guide-browser
node scripts/audit-global-chart-guide.mjs --docs-only --report-dir=.tmp/global-chart-guide-refresh/reports --themes=base,xlayer --output-dir .tmp/global-chart-guide-docs-only
```

The first browser command produced the recorded combined functional results and initial bookkeeping failure. The targeted `--docs-only` command passed with exit code 0 after classification was corrected. It reused the 12 browser captures and verified all 8 Docs cases and 40 gallery selections with zero runtime errors and zero application mutations.

## Sources and privacy

The illustrations use the tracked public historical candle fixture `packages/analysis/src/globalReport.oct20-fixture.json` and the current report renderer. The public asset manifest records provenance. Captures use those public examples rather than private wallet reports.

This phase made no model calls, payments, orders or remote API writes. It did not run trading strategy backtests. Public documentation explains product controls and visible evidence; it excludes private strategy recipes, tuning and confidential research. Historical illustrations and software tests do not establish trading performance.
