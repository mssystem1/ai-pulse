# BTC setup correctness and saved-path audit — 18 November 2026

This audit follows the user's request to check BTC entry availability, protection and objectives after the chart and setup revisions. It is bounded to retained reports and their later price observations. It does not restart the stopped strategy searches or change parameters to improve historical outcomes. All prices below belong to the dated saved snapshots; they are not current trading instructions.

## Inputs and chronology

- Retained original 17 November 09:34 UTC hourly, daily and weekly snapshots: `.tmp/terminal-nine-qa/markets.json`.
- Current-policy retrospective reviews generated directly from those same saved sources. Snapshot clocks, primary candles and entry-study data are asserted unchanged. These reviews were not prospectively published trades on November 17.
- Actual deployed 18 November 12:02 UTC captures: `.tmp/deployed-terminal-retest-20261118/deployed-markets.json`.
- Earlier later-price observations: 520 completed 15-minute BTC-USDT OKX spot candles retained in the November 18 hourly entry study, through November 18 12:00 UTC.
- A separate bounded public candle capture extends the frozen November 17 and November 18 daily and weekly contracts through 15:45 UTC on November 18. It contains 121 completed 15-minute candles from 09:30 UTC, including publication-straddling intervals; each straddler is checked for possible entry overlap and excluded from event replay. The capture used one public request, retained the raw response and hash, and did not include an unfinished or future candle.

The runner validates each source report, preserves its priced contract, and inspects selected plans and available alternates independently. Thirteen plan views are included. The original saved-path input still ends before the November 18 report publication, so its deployed hourly views have no later observation. The separate path input binds the actual November 17 and November 18 daily/weekly selected scenario IDs and revisions, then adds continuous post-publication observations for those contracts. Each saved candle must match a confirmed OHLCV row in a raw response whose SHA-256, HTTP status and exchange response code validate. Conflicting duplicate response rows reject. Saved-path replay consumes only the selected path frame; it never merges 15-minute and finer-resolution candles. A candle path must include the bucket containing the earliest frozen publication. The saved November 18 weekly alternate is not treated as a selected contract.

Original input hashes and generated-review hashes are in `.tmp/btc-setup-path-audit-20261118/audit.json`. Input files are checked again after replay. The runner blocks network access. One separately recorded public exchange request was used to investigate the single ambiguous candle described below; the replay itself remains offline.

## Why the old daily and weekly setups were problematic

| Retained November 17 plan | Entry | Fixed stop | Nearest-obstacle clearance | Observed later path |
| --- | --- | --- | --- | --- |
| Original daily short | 70,613.81–74,225.62 | 81,732.88 | 0.53R; below the saved 1R floor | Entry area not reached in the retained window |
| Original weekly short | 65,407.10–66,955.00 | 68,769.64 | 0.12R; below the saved 1R floor | Entry area touched at the 14:45 UTC candle close on November 17, but the plan did not clear admission |
| Revised daily short | 67,300.00 | 67,832.88 | 4.87R | Entry not touched by November 18 12:00 UTC |
| Revised weekly short | 66,955.00 | 68,769.64 | 1.08R | Entry not touched by November 18 12:00 UTC |

The original daily plan used a lagging daily EMA region, about 9.64% from its captured quote. Its stop distance was about 15.75% of entry. The revised daily plan uses a retained daily resistance zone, about 4.50% from the same captured quote, with a stop distance of about 0.79%. Its protection and objectives remain daily sources; its execution frame is 4H.

The weekly revision uses the outer edge of its retained weekly resistance zone. The entry is farther from the captured quote than the old zone's facing edge: about 3.95%, versus 1.55%. Weekly stop distance at the revised entry is about 2.71%. Its execution frame is daily. Moving the weekly entry back to the old facing edge while keeping its same protection and nearest opposing level would restore the inadequate clearance; it would not establish a better supported setup.

The revision therefore improves source and risk consistency, but this sample does not establish improved entry availability. The November 18 daily and weekly selected short limits remained unfilled through the latest capture at 15:45 UTC. Their entry deadlines were still open. The daily contract had 14 pre-entry TP1 touch observations; the weekly contract had 15 pre-entry target touch observations across TP1 and TP2. These are repeated price-path observations before entry, not exits. Both scenarios remain awaiting location with no exit allocation and full remaining fraction. Targets touched before a future structural-limit entry are not counted as exits or profit. Neither the stored levels nor this replay predicts that BTC must rally to an entry and then fall.

At their original November 18 publication, the captured daily quote was 64,187.6 against its 67,300 short limit; the captured weekly quote was 64,186.8 against its 66,955 short limit. Both were admission-eligible under their saved geometry (4.94R and 1.08R first-obstacle clearance respectively). Through the later 15:45 UTC candle capture there were zero post-publication entry touches and zero post-entry TP or SL observations. Both scenarios remain open and right-censored at that cutoff, not expired or completed.

Older October 27 long reports were also inspected. They retained daily and weekly levels but lacked a complete saved execution policy. Later touches of their numerical levels alone cannot reconstruct a verified trade outcome. The November 6 terminal audit archives contain complete passive execution policies. A bounded public OKX history capture now covers both original publication-to-deadline windows with 769 uninterrupted confirmed 15-minute BTC-USDT candles (three requests, below the eight-request cap). Each archived input hash, frozen scenario/revision, raw response hash and candle OHLCV rows are retained in `.tmp/btc-setup-path-audit-20261118/nov6-contract-history.json`; the offline replay is `.tmp/btc-setup-path-audit-20261118/nov6-contract-replay.json`.

Both November 6 plans failed their original admission checks, so the path review does not qualify them as admissible setups. The daily long limit at 74,955.5–76,265.2 has a 15-minute publication-straddling candle whose entire OHLC range (75,628.4–75,774.8) lies inside the entry zone. A bounded, confirmed 1-minute capture reconciles all 15 candles to that parent OHLC. The minute straddling the 05:56:43.838 UTC publication also overlaps the entry zone, so its post-publication portion leaves at most 16.162 seconds of uncertainty about the earliest possible touch. The first complete post-publication minute observation closes at 05:58 UTC and still overlaps the zone. This is a price observation, not an exact fill time. The saved stop was 74,464.09; targets were 81,751.75, 84,495.03 and 87,238.30. Across the two entry-zone edges, stop distance ranges from 491.41 to 1,801.11 (0.66%–2.36% of the corresponding entry edge; 0.20–0.73 of the saved 2,457.06 daily ATR). The saved setup deadline was November 8 05:56 UTC, which stopped new entry observations; because a price touch had already been observed, the frozen lifecycle continued monitoring exits afterward. The saved stop was observed at November 8 22:00 UTC, with no target exit. A passive touch is not evidence of an exchange fill.

The weekly long limit at 76,577.28–78,675.28 was never touched. Neither its 15-minute publication-straddling OHLC nor the shared 1-minute straddling candle overlaps that entry zone. Its saved stop at 73,739.35 was observed below entry on November 8 at 22:00 UTC, invalidating the premise before entry. Across its two entry-zone edges, stop distance ranges from 2,837.92 to 4,935.93 (3.71%–6.27% of the corresponding edge; 0.47–0.81 of the saved 6,080.73 weekly ATR); targets were 84,479–87,399 and 93,674.10–97,925.40. Its original deadline was November 14 05:56 UTC. This is a pre-entry stop breach, not a stopped trade. Both paths were replayed through the captured November 14 06:00 UTC cutoff. Their deadline-straddling candles did not cross a still-relevant stop or target: the daily limit had already been observed and that bar stayed above its stop and below its targets; the weekly setup had already been invalidated. Finer bars were not needed. Neither archived contract passed admission, and neither path establishes exchange fills or realized PnL.

The November 17 published daily and weekly contracts do provide one longer path observation. The daily short limit was not touched through November 18 15:45 UTC. The weekly short limit had one post-publication entry touch at November 17 14:45 UTC; its saved TP1 was touched the next day at November 18 14:45 UTC, completing the observation-only scenario with its saved 100% target allocation. That weekly plan failed its own admission gate at 0.12R first-obstacle clearance, so the path is not an admissible setup or performance sample. It records price observations only, not an exchange fill or realized PnL. These examples do not provide an admission-eligible completed daily/weekly performance sample.

## Alternate and one-minute sequence check

The daily retrospective alternate was a long limit at 64,049 with a fixed stop at 63,374.1026147. Both prices appeared in the November 17 15:45–16:00 UTC candle, so the initial 15-minute replay correctly retained an ambiguous outcome.

A public OKX historical-candle request returned all 15 completed one-minute candles for that exact interval. Their aggregate open/high/low/close matched the original retained 15-minute candle exactly: 64,194.1 / 64,246.1 / 63,336.9 / 64,112.8. The refined replay replaces only that completely reconciled parent interval.

The one-minute evidence shows the entry level inside the 15:47–15:48 UTC candle and the stop level inside the later 15:54–15:55 UTC candle. The engine therefore records an entry price observation followed by a stop price observation, with no target exits. It does not establish an exchange fill, quantity, fees or realized PnL. This alternate was generated retrospectively, so this is a software-path check rather than a historical trading claim.

The revised weekly alternate at 56,555 was not reached. The hourly retrospective review has a publication-straddling candle that could have touched entry; the retained 15-minute data cannot resolve the exact post-publication path in that interval, so its coverage is explicitly limited.

Raw exchange response, request metadata and hashes: `.tmp/btc-setup-path-audit-20261118/disputed-bar-1m-raw.json` and `disputed-bar-1m.json`. Refined replay: `.tmp/btc-setup-path-audit-20261118/with-fine/audit.json`. Missing minutes, wrong market identity and inconsistent parent OHLC were separately tested and rejected before refinement.

## Concrete lifecycle defect and correction

The lifecycle accepted new entry touches exactly at the setup deadline or confirmation-fill deadline, while the decision display required the deadline to remain strictly in the future. Both pre-entry expiry comparisons now use an exclusive deadline consistently.

Regression tests demonstrate the former failures and the corrected behavior:

- A touch immediately before the setup deadline can still qualify; a touch at the deadline expires.
- A confirmed retest touch immediately before its fill deadline can still qualify; equality expires.
- An already-entered scenario continues processing exits at and after its original entry deadline.

No entry, stop, target, allocation, strategy selection or policy identifier was changed by this fix. The change does not rewrite stored historical observations or claim better strategy outcomes.

## Verification and reproduction

The lifecycle tests failed at both equality cases before the fix and passed afterward. Final focused runs passed 61 analysis tests and 25 API scenario/watch tests. Analysis, API and production web builds passed. The earlier fine-candle negative cases passed; the extended saved-path input also rejects wrong market identity, a missing interval, a future cutoff, a forged frozen revision, and a mismatched frame override.

Coarse saved-path replay:

```powershell
node --import tsx scripts/audit-btc-saved-setup-paths.mjs
```

Refine the one disputed interval using its already saved public response:

```powershell
node --import tsx scripts/audit-btc-saved-setup-paths.mjs --fine=.tmp/btc-setup-path-audit-20261118/disputed-bar-1m.json --out=.tmp/btc-setup-path-audit-20261118/with-fine
```

The runner accepts `--original`, `--later`, `--path`, `--path-frame` and `--out`. The path input must retain source identity, frozen scenario/revision IDs, request provenance, continuous confirmed bars, and a capture cutoff no earlier than its final bar close. The replay blocks network access. Ten negative inputs were rejected, covering wrong market, missing candle, future cutoff, forged revision, mismatched frame, forged candle OHLC, falsified HTTP status, falsified raw response code, conflicting duplicate response rows, and a missing publication prefix. Capture only through the current time with the bounded utility, then replay offline:

```powershell
node .tmp/btc-setup-path-audit-20261118/capture-frozen-contracts.mjs
node --import tsx scripts/audit-btc-saved-setup-paths.mjs --path=.tmp/btc-setup-path-audit-20261118/deployed-15m-through-now.json --path-frame=15m --out=.tmp/btc-setup-path-audit-20261118/deployed-through-now
node .tmp/btc-setup-path-audit-20261118/validate-path-negatives.mjs
```

The archived November 6 daily and weekly contracts were captured and replayed without changing their published policies:

```powershell
node .tmp/btc-setup-path-audit-20261118/capture-nov6-contract-history.mjs
node --import tsx .tmp/btc-setup-path-audit-20261118/replay-nov6-contract-history.mjs
```

The capture is limited to eight public history-candle requests and never requests future candles. It freezes the November 17 and November 18 daily/weekly scenario IDs, revisions and publication clocks. The runner continues to preserve the original snapshot files and does not generate another market report or model response. No wallet, payment or live order was used in this audit. There is no win-rate or profitability qualification from these selected snapshots. The November 18 contracts still need post-publication observations as time passes; the one older weekly TP1 observation was admission-blocked and cannot validate setup quality.
