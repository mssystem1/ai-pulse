# BTC setup correctness and saved-path audit — 18 November 2026

This audit follows the user's request to check BTC entry availability, protection and objectives after the chart and setup revisions. It is bounded to retained reports and their later price observations. It does not restart the stopped strategy searches or change parameters to improve historical outcomes. All prices below belong to the dated saved snapshots; they are not current trading instructions.

## Inputs and chronology

- Retained original 17 November 09:34 UTC hourly, daily and weekly snapshots: `.tmp/terminal-nine-qa/markets.json`.
- Current-policy retrospective reviews generated directly from those same saved sources. Snapshot clocks, primary candles and entry-study data are asserted unchanged. These reviews were not prospectively published trades on November 17.
- Actual deployed 18 November 12:02 UTC captures: `.tmp/deployed-terminal-retest-20261118/deployed-markets.json`.
- Later price observations: 520 completed 15-minute BTC-USDT OKX spot candles retained in the November 18 hourly entry study, through November 18 12:00 UTC. The replay checks publication-straddling candles and continuous coverage.

The runner validates each source report, preserves its priced contract, and inspects selected plans and available alternates independently. Thirteen plan views are included. Eight have later completed observations; the five plan views in the deployed November 18 captures have no completed observation later than their retained lifecycle cursor in these inputs. They are not assigned a later outcome.

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

The revision therefore improves source and risk consistency, but this sample does not establish improved entry availability. Both revised selected short limits remained unfilled in the roughly 26-hour window. Their daily and weekly entry deadlines were still open at the observation cutoff. Targets touched before a future structural-limit entry were not counted as exits or profit. Neither the stored levels nor this replay predict that BTC must rally to an entry and then fall.

Older October 27 long reports were also inspected. They retained daily and weekly levels but lacked a complete saved execution policy. Later touches of their numerical levels alone cannot reconstruct a verified trade outcome. They are excluded from the execution-path results above.

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

The lifecycle tests failed at both equality cases before the fix and passed afterward. Final focused runs passed 61 analysis tests and 25 API scenario/watch tests. Analysis, API and production web builds passed. The three finer-input rejection checks passed for their intended coverage, identity and OHLC reasons.

Coarse saved-path replay:

```powershell
node --import tsx scripts/audit-btc-saved-setup-paths.mjs
```

Refine the one disputed interval using its already saved public response:

```powershell
node --import tsx scripts/audit-btc-saved-setup-paths.mjs --fine=.tmp/btc-setup-path-audit-20261118/disputed-bar-1m.json --out=.tmp/btc-setup-path-audit-20261118/with-fine
```

The runner accepts `--original`, `--later` and `--out` paths for equivalent retained captures. It generates no new market report or model response. No wallet, payment or live order was used in this audit. There is no win-rate or profitability qualification from these few selected snapshots. The newer deployed setups require later source observations before their outcomes can be assessed.
