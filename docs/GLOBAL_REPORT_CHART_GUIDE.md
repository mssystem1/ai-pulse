# Global report chart guide

The English and Chinese app guide is at [Docs → Chart & indicator guide](https://app.ai-pulse.tech/docs#docs-global-chart). It explains the controls in the Global report's **Pro structure and setup evidence** section. Available studies depend on the saved report and report depth.

## Start with the saved setup

1. Check the instrument, primary timeframe, snapshot time and captured quote. A report describes its saved snapshot; the moving chart clock does not refresh its analysis.
2. Read the direction evidence and exact entry condition, then locate **Entry**, **SL**, **Hard SL** and available **TP** zones. A conditional setup is a plan for a new reaction, not an order or a claim that a prior move is still available.
3. Compare the primary chart with the lower-timeframe **Entry study** and broader **Context** chart. They answer different questions and can have different completed-close times.
4. Use the controls below to inspect the evidence. Use **Download chart PNG** for the chart report or **Download report TXT** for its written analysis and source details.

## Views, scale and reset controls

| Control | What it does | When to use it |
| --- | --- | --- |
| **Setup view** | Restores the report's default setup studies and export view. Keeps interactive zoom and pan. | Return to saved trend, value and range references. |
| **Structure view** | Selects saved structural studies, including available channels, moving averages, measured Fibonacci and wave hypotheses. Keeps interactive zoom and pan. The report overview/export uses the structural view. | Examine the wider structural evidence. |
| **Full history** | Fits all saved primary candles, enables value-context scale and opens candle inspection on mobile. | Compare the setup with the history actually returned by the source. |
| **Value context** | Toggles whether the full enabled value-study series contributes to automatic price scaling, rather than focusing that scaling near the visible candles and setup. Keeps zoom, pan and manual price scale. | Inspect distant value references. This does not change the saved VWAP anchor or data feed. |
| **Reset studies** | Restores default indicators without resetting the viewport. | Undo indicator changes while keeping the candles you are inspecting. |
| **Reset view** | Restores the default time window and automatic price scale. Keeps selected indicator layers. | Return from manual inspection to the starting range. |
| **Show measured swing** | Explicitly fits the history needed for saved Fibonacci anchors. Appears with an available measured Fibonacci study. | Find both endpoints of a swing outside the current view. |
| **Inspect candles / Show full map** | Switches mobile presentation between the interactive candle chart and complete saved overview. | Use gestures for detail, then return to the whole plan. |

New Pro reports normally open with 120 candles for 15m/1H, 180 for 4H and 260 for daily/weekly, limited by saved coverage. **Full history** means all available saved candles, not unlimited live market history. A different snapshot opens its own initial view.

Drag to pan; use a wheel or pinch gesture to zoom time. Drag the price axis to adjust its scale. The same snapshot retains zoom and pan through report polling, resizing, language and appearance changes, and study switches. Axis double-click does not reset it. **Reset view**, **Full history** and **Show measured swing** deliberately change the displayed range.

## Indicator settings

Open **Indicator settings** and press a study to show or hide it. Pressed controls identify selected layers. Missing saved evidence is not replaced with invented data; controls such as channels, Fibonacci and VWAP can be unavailable. The available set can differ between assets, timeframes and older reports.

| Study | How to read it |
| --- | --- |
| **EMA 12 / 25** | A short trend ribbon from primary candles. A touch or cross alone does not prove an entry reaction. |
| **Anchored VWAP** | Saved volume-weighted value from the anchor named in the caption. Another timeframe, venue or anchor can produce different levels. |
| **VWAP bands** | Saved deviations around that VWAP. Turning bands on also enables VWAP. Bands are not automatically targets for every setup. |
| **Range references** | Saved support/resistance zones and observed range legs. A dotted center is a geometric midpoint, not a volume-profile POC. |
| **Wave hypotheses** | Candidate Elliott structure and its anchors, read alongside the setup evidence. |
| **Broad / Local parallel channel** | Saved channels over different spans. Unavailable channels mean the snapshot did not supply the required evidence. |
| **Channel midlines** | Centers of available saved parallel channels. |
| **SMA 21/55/89/144/233** | Longer trend averages. The Context mini chart separately shows its own SMA55. |
| **Regression 120 ±2σ** | A statistical channel over the saved 120-bar window, separate from an evidenced parallel channel. |
| **Fibonacci retracement** | Retracements of the measured Fib A → Fib B swing. Use **Show measured swing** to find its endpoints. These anchors are distinct from Elliott wave letters. |
| **Confirmed pivots** | Saved swing points with available confirmation. A recent observed extreme may be identified separately before pivot confirmation. |
| **ATR14** | A volatility reference for the primary timeframe. It does not move the fixed protective stop. |
| **Volume profile / Trade footprint** | Available when actual executed-trade evidence is saved. Read venue, UTC window, POC/VAL/VAH, row size and taker sell/buy captions. Zoom retains the original window. |

Volume bars alone do not supply a volume profile, footprint or historical order book. A historical profile describes its own dated window and does not establish current order flow. Profile references begin at their source window rather than extending across earlier macro history.

## Primary chart, entry study and context

The primary chart defines the selected horizon. The Entry study refines the stated reaction; the Context mini chart compares the broader market. Read each panel's timeframe instead of treating every candle as the same duration. Panel availability depends on saved coverage; missing entry or context candles are shown as unavailable.

| Report | Main question | Entry study | Broader context |
| --- | --- | --- | --- |
| **15m · Fast** | Session value, session range and fast reactions | 5m | 1H |
| **1H · Intraday** | Weekly value, intraday structure and nearby levels | 15m | 4H |
| **4H · Swing** | Swing structure, value and active balance | 1H | 1D UTC |
| **1D · Position** | Multi-month recovery or decline, daily balance and position levels | 4H | 1W UTC |
| **1W · Macro** | Cycle value, major decline/recovery legs and weekly support/resistance | 1D UTC | 1M UTC |

Different horizons can share a swing or price level. Their entry conditions, protection and objectives still use their own source timeframe. Weekly recovery does not itself establish an intraday entry. The broader trend and a conditional reclaim or rejection can point in different directions; read the dated evidence and selected setup separately.

The chart clock shows current local time, seconds and timezone. Candle axes and saved source times use UTC. **Snapshot time**, the **quote captured at that snapshot**, and **last completed primary/entry closes** are distinct. A weekly close can be older than today's quote. An older anchor date identifies a level's origin, not the report's freshness. Reviewing or exporting saved analysis does not obtain current market data.

## Entry, protection and objectives

Entry and TP zones come from saved source ranges or candle reactions. An exact reference remains a point when no supported interval is available. The **SL zone** shows structural invalidation and its protective margin; **Hard SL** is the fixed outer stop used in risk calculations. A range does not authorize widening that stop after entry.

Percentages and reward/risk use the least favorable entry in the range and the first target-zone boundary. Read the nearer obstacle as well as TP1. If TP1 offers less than 1R, its reward is smaller than the full stop risk; later targets do not remove that limitation. Overlapping target zones are consolidated.

A conditional plan requires the new completed reaction stated in its entry condition. Earlier touches or a move that already reached an objective do not establish a new entry. Confirmation and execution have separate prices: after confirmation, entry remains limited to the displayed Entry range. If price has left it, wait for a return or reassess. A confirmation close outside the range does not inherit its reward/risk.

An entry away from the latest quote does not predict a required trip to that price. Future chart space does not predict arrival time. A confirmed signal is not an order fill. Review a fresh executable quote, position size and protection if you choose to trade; Spot SELL reduces owned inventory, and SHORT research does not open leverage.

## Current guide illustrations

The in-app guide uses the current renderer with **historical public candles**. Prices are educational examples, not current signals. The gallery shows chart and Entry study excerpts; the full report and downloaded PNG also include written evidence. The 15m example has no saved 5m candles, so its Entry study explicitly shows that evidence as unavailable.

Versioned illustrations cover all five primary horizons in English/Chinese and light/dark appearances. Controls examples identify view presets and indicator settings; save examples show the file preview and final Save/Share actions:

- `apps/web/public/docs/global-chart/chart-guide-20261027-{15m,1H,4H,1Dutc,1Wutc}-{light,dark}-{en,zh}.png`
- `apps/web/public/docs/global-chart/chart-controls-20261027-{light,dark}-{en,zh}.png`
- `apps/web/public/docs/global-chart/chart-text-download-20261027-{light,dark}-{en,zh}.png`
- `apps/web/public/docs/global-chart/chart-save-20261027-{light,dark}-{en,zh}.png`

Clarity uses light charts; other appearances retain dark charts. Appearance changes preserve saved prices and inspection range.

## Download PNG or TXT

**Download chart PNG** is in the chart toolbar. **Download report TXT** is in the report heading.

1. Choose the download and wait for the file preview.
2. Press **Save file** or, where supported, **Share / Save to Files**. The final tap opens the device save/share interface.
3. Supported Telegram clients use a native download prompt; older clients can open the secure file in the browser. On iPhone or Android, the image preview also supports touch-and-hold saving. TXT remains fully selectable.
4. Canceling leaves the preview available to retry. If a secure link expires, close and reopen Download to prepare a new one.

PNG preserves selected appearance and study layers as a **full report map**, not a screenshot of temporary inspection zoom. Server images use bundled Inter/Chinese fonts and target 3,900 pixels wide; long reports scale down within 16 million pixels and mobile canvas limits. The title leads directly to the timeframe row. Snapshot, captured quote and completed-close references remain in the evidence section; the app and TXT retain full source metadata.

Export reads the saved report without purchasing analysis, changing setup prices or refreshing market data. Private file links retain existing ownership checks and expire after five minutes. If secure download is unavailable, the dialog offers a local preview and device sharing where supported.

This public guide covers product use and visible evidence. It does not disclose private selection rules, tuning or confidential research. Software validation and historical examples do not establish guaranteed performance or mirror a trader's private account.
