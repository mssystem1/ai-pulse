# Terminal chart interaction and multiple targets

This follows the user's November 18 deployed-chart report. Local corrections are separate from the deployed product audit in `TERMINAL_DEPLOYED_E2E_2026-11-18.md`.

## Chart defect and correction

Live candle updates rebuilt the full series and reapplied `getVisibleRange()` through `setVisibleRange()`. Those timestamps discard fractional bar positions. In an isolated Chrome run of the deployed source, the next quote moved a wheel-zoomed boundary by 0.71 bars on 1H, 0.28 on daily and 0.43 on weekly. Quotes during dragging also changed the time span. Double-click axis reset had been explicitly disabled.

The corrected chart updates a single forming candle and volume bar. Indicator refresh, hidden-tab restoration and assessment replacement preserve the logical range, including its fractional positions. Native mouse wheel, dragging, axis scaling, double-click reset and touch pinch are enabled. The unselected alternate does not expand the selected plan's automatic price range. An empty indicator list has stable identity, avoiding redundant update effects. Phone inspection uses the available width instead of forcing a 760-pixel canvas.

The native Chrome regression passed wheel zoom in and out, horizontal dragging while quotes arrive, price-axis dragging, vertical panning with manual scale, manual-range persistence across assessment replacement, price-axis double-click reset, phone swipe and two-finger pinch. Quote updates produced zero measured time-range drift on 1H, daily and weekly. The test uses real chart rendering and browser input events with captured market data; it makes no payments or API mutations.

Run from the repository root:

```powershell
node scripts/audit-terminal-chart-interaction-browser.mjs --fixture <market-snapshots.json>
```

The fixture maps `1H`, `1Dutc`, `1Wutc` to objects containing `report`. Screenshots and measurements are written under `.tmp/terminal-chart-gesture-audit/`. It requires installed Chrome and the existing esbuild dependencies.

## TP1, TP2 and TP3

The previous structural-edge correction intentionally retained only the first obstacle. The new version retains that exact TP1, then supplies up to two additional distinct, source-backed objectives from the same primary timeframe. It neither invents a third target nor skips the first obstacle to improve reward. Both the selected and opposing plan cards display their complete target lists. Existing report charts and exports already support three targets.

For the captured November 17 BTC evidence, the corrected daily short has targets 64,706.3, 63,042.8 and 59,111.2; the weekly short has 65,000, 63,127.9 and 53,269. These are historical fixture checks, not current market instructions. Selection continues past overlapping bands to find the next independent objective, preserving TP1 and the fixed stop.

The revision uses `source-limits-v3` and `structural-edge-passive-v3`. Earlier v2 records remain valid archives. Free review creates a separate corrected artifact; new configuration identity prevents the replacement from silently modifying an existing scenario's risk and target allocations. Three-target allocations are 50% / 30% / 20%; two targets use 50% / 50%.

## Verification boundary

The local gesture test establishes interaction behavior under controlled quote and assessment updates. It does not establish the production deployment of this correction, exchange fills, trading profitability or completion of every deployed product workflow. The deployed audit records its own evidence and remaining limitations separately.
