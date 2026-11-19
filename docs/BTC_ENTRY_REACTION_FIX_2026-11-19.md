# BTC daily and weekly entry correction

Status: implementation, incident replay and production UI verification completed on November 19, 2026. Production code `cd22321` passed Railway and Vercel deployment checks. Both BTC horizons show all three sourced targets in their cards and native chart.

The earlier audit is retained in `BTC_SETUP_QUALITY_AUDIT_2026-11-18.md`. Its archived prices and observations have not been rewritten.

## Cause and behavior

The disputed daily short used the distant daily EMA ribbon as its entry and a primary swing for protection. It required a large recovery to reach the entry. The weekly assessment could keep its slower recovery direction after daily support had broken. The first-obstacle 1R gate also rejected partial exits even when later sourced targets supported the requested staged plan. These were construction and selection problems; the chart did not establish that BTC would rally to the old entry and then fall to its targets.

`source-limits-v5` uses completed evidence on the declared execution timeframe: 4H for daily plans and daily candles for weekly plans. A completed rejection or sweep supplies its body edge; a completed break supplies the previously known broken boundary. A surviving newer break can change execution direction independently of the slower primary assessment. The selected plan and opposing alternative retain separate sources, prices and risk checks.

The first live verification of `663d7a5` found a remaining source-selection defect: a newer 1H reclaim could override the daily report's available 4H entry study. That long failed admission while a valid 4H short remained the alternate. V5 pins reclaim selection and eligibility prices to the actual execution frame and validates the selected and alternate event/reference clocks. Execution timing overrides retain V5; archived research selection requires the explicit `sourceSelection: "legacy-v4"` setting. Earlier V4 reports remain readable and receive a free correction. The exact November 19 production report is now an additional frozen regression: the corrected selected short uses entry 63,123.60, fixed 4H SL 63,772.70 and three sourced targets; its planned allocated payoff is 2.40R before costs.

The live checks also found that installed-study timestamps and native layout timing could suppress initial plan padding. Initial view and Reset now use the plotted clock, wait for native time-scale readiness and allow a queued range to paint before saving it. The untouched default view refits when its container narrows; real wheel, pointer and touch interaction switch to preserving the user's exact logical range through resize and refresh. The final deployed chart passed both target and interaction checks.

Protection is fixed using ATR from that source candle: 0.2 ATR beyond the wick, with at least 0.5 ATR between entry and stop. A broken-boundary retest uses that boundary with the same minimum ATR distance. Refreshing a retained source cannot change its stop or renew its 16-source-bar deadline. A new assessment can select a different surviving source after the former source fails, expires or ceases to be a resting limit; that is a new plan, not a revision to a saved order contract. Passive limits require no extra confirmation candle. A price touch remains an observation; exchange execution is separate.

The planner keeps up to three distinct sourced exits. A nearer execution-frame obstacle becomes TP1 when needed; remaining exits retain the primary timeframe. All three appear in the main chart and setup cards. The smaller entry chart draws targets inside its own scale and identifies off-scale targets.

The user approved TP1 below 1R when planned weighted payoff is at least 1R before costs. The registered allocations are 50/50 for two targets and 50/30/20 for three. The first nearby obstacle must have an actual partial exit; overlapping opposition, invalid protection and ended opportunities still block admission. The UI shows TP1 R, allocations, planned weighted R and exposure of the remaining position to the fixed stop. These numbers do not establish expected profit.

## Frozen November 17 comparison

| Plan | Original entry | Revised entry | Fixed SL | SL distance | Three revised first-contact exits |
| --- | --- | --- | --- | --- | --- |
| Daily short | 70,613.81–74,225.62 | 65,057.40 | 65,667.21 | 0.94% | 64,706.30; 63,042.80; 61,055.50 |
| Weekly short | 65,407.10–66,955.00 | 65,000.00 | 66,332.20 | 2.05% | 64,706.30; 63,127.90; 55,862.00 |

Daily entry and protection use a completed 4H rejection. Weekly entry uses a completed daily break of 65,000, with daily protection, a daily partial TP1 and weekly later objectives. The daily stop previously lay at 81,732.88, a 15.75% distance from the old entry. Revised daily planned weighted payoff is 2.59R; weekly is 1.90R. Source prices are chosen before payoff is measured; the planner does not search older entries or move stops to clear the floor.

## Replay scope and limits

Six original daily/weekly reports from November 6, 17 and 18, plus the November 19 production regression, are frozen with source-file hashes. The historical replay compares the first six original contracts with retrospective fixed-rule candidates at the same publication clocks. Later confirmed public OKX candles are independently checked against retained raw responses, with one-minute windows reconciled to their parent OHLC where available. Pre-publication bars cannot create entries. Same-bar uncertainty remains ambiguous.

The revised November 17 selected daily and weekly entry prices were later touched. Daily TP1 and weekly TP1/TP2 were later observed; their remaining portions were still open at the retained November 18 cutoff. The November 18 selected limits remained unfilled through that cutoff. An opposing daily candidate had a partial target followed by a stop. The earlier November 6 revised candidates remained risk-rejected under the approved weighted floor (approximately 0.75R daily and 0.69R weekly); the weekly entry also overlapped primary support. Those weak cases remain visible. No weights or targets were fitted retrospectively to admit them.

Minute refinement places the November 17 weekly entry observation at 12:00 UTC. The November 18 daily alternate has an entry observation at 14:35 followed by its fixed stop at 14:41. The November 6 retrospective daily entry and TP1 occur in the same one-minute candle; their order remains ambiguous. The original November 6 daily publication also has an unresolved entry-overlapping one-minute straddle. Neither interval is assigned an invented order of events.

These selected incident snapshots are a causal regression sample. They do not qualify a win rate, profitability, fills, fees or slippage. There were no wallet actions, payments or venue orders in this replay.

## Verification

- Full analysis suite: 429/429 tests passed, including unrelated hourly-price isolation and explicit legacy compatibility.
- Web report, chart quote and Terminal client checks: 51/51 passed.
- API assessment, price-path and scenario checks: 11/11 passed.
- Full production build: all packages, API and web completed with npm exit code 0.
- New frozen-source tests bind entry, source ATR, fixed stop, expiry, target count and allocations; forged sources, later ATR and altered weights fail validation.
- Seven tampered replay inputs were rejected: wrong market, missing parent interval, future capture, altered parent OHLC, bad response hash, missing minute and altered minute OHLC.
- Browser inspection used the real chart and setup components with frozen fixtures. Daily/weekly TP1–TP3 were present; weekly dark and Clarity displays were inspected; wheel zoom and mouse pan changed the chart; no horizontal page overflow was observed at the desktop viewport.
- A native-browser regression adds an indicator after mounting and narrows the chart from 1,115 to 709 pixels. Daily and weekly TP1–TP3 remain visible without Reset; real wheel zoom and mouse drag change the range, and a report refresh and resize preserve its exact fractional coordinates.

Immutable raw-response inputs and replay results are in `docs/evidence/btc-entry-reactions-2026-11-19/`. Reproduce without network access:

```powershell
node --import tsx scripts/audit-btc-entry-reactions.mjs --path=docs/evidence/btc-entry-reactions-2026-11-19/later-15m.json.gz --minutes=docs/evidence/btc-entry-reactions-2026-11-19/later-1m.json.gz --out=.tmp/btc-replay-later.json
node --import tsx scripts/audit-btc-entry-reactions.mjs --path=docs/evidence/btc-entry-reactions-2026-11-19/nov6-15m.json.gz --minutes=docs/evidence/btc-entry-reactions-2026-11-19/nov6-1m.json.gz --out=.tmp/btc-replay-nov6.json
node --test scripts/audit-btc-entry-reactions.test.mjs
```

## Production verification

The deployed app was checked with the existing TEST pass on Base at approximately 03:50 UTC on November 19. No payment or venue order was submitted. The app loaded `index-DvqHLnsR.js` and returned `source-limits-v5` reports. Schema validation, exact native-chart target prices, matching setup cards, absence of a passive-limit WAIT gate and desktop overflow checks all passed.

| Primary horizon | Entry source | Entry | Fixed SL | TP1 first contact | TP2 first contact | TP3 first contact |
| --- | --- | --- | --- | --- | --- | --- |
| Daily | Completed 4H rejection | 64,239.90 | 64,832.13 | 63,042.80 | 61,055.50 | 58,628.10 |
| Weekly | Completed daily rejection | 64,947.50 | 66,271.44 | 63,127.90 | 55,862.00 | 49,393.50 |

These are captured conditional plans. They do not predict a return to entry. Both passed their saved risk rules at the captured assessment. The daily report retained a separately sourced long alternate. The current weekly report had no surviving opposing daily reaction. Its nearby structural buy edge had already been crossed in the inspected snapshot, and a farther support source failed the payoff floor; no substitute or tighter stop was manufactured to force an alternate.

Real wheel zoom changed the deployed weekly native range from `202..575` to `205.01006036217302..575`; drag pan changed it to `168.88933601609654..538.8792756539235`. A successful Refresh evidence response preserved that exact fractional range. The repeated test passed without pressing Reset. The isolated TEST workspace was then locked and its browser/signer process exited.

Recorded evidence:

- [Deployment, report and interaction results](evidence/btc-entry-reactions-2026-11-19/production-verification.json)
- [Daily chart with TP1–TP3](evidence/btc-entry-reactions-2026-11-19/production-1Dutc.png)
- [Weekly chart with TP1–TP3](evidence/btc-entry-reactions-2026-11-19/production-1Wutc.png)

The historical incident sample and these UI checks do not establish a general win rate or future profitability. Risk-rejected historical cases and ambiguous intrabar outcomes remain recorded above.
