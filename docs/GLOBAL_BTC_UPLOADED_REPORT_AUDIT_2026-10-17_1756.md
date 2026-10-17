# Audit of the four uploaded BTC reports

17 October 2026. Reviewed against local commit `3e54d0a`, including its report implementation from `9530d4d`.

**Verdict: these reports do not pass the requested professional presentation and setup-consistency review.** The reward arithmetic and several data disclosures are correct. The directional hierarchy, channel visibility, entry-versus-scenario distinction and parts of the candidate planner still need correction. Passing the earlier functional tests did not establish those qualities; those tests missed the failures documented here.

This is an audit and correction specification. No production code, environment, automation, wallet state or deployed report was changed. No additional report purchase or model call was made.

## Evidence and reconstruction

Read all four uploaded TXT files and inspected all six PNG files, including the three 1H study variants, plus the web screenshot embedded in the request:

| Frame | Exact uploaded reference | Fetched timestamp, UTC | PNG files |
| --- | --- | --- | --- |
| 1H | `0c8d3da7` | 2026-10-17 17:56:22.029 | Original, `(1)`, `(2)` |
| 4H | `6b97b8bc` | 2026-10-17 17:54:54.581 | Original |
| 1D UTC | `7df9442b` | 2026-10-17 17:47:28.435 | Original |
| 1W UTC | `367da094` | 2026-10-17 17:50:17.591 | Original |

Retrieved public OKX historical candles at those observation cutoffs: 15m, 1H, 4H, daily UTC, weekly UTC and monthly UTC. Replayed the existing numeric report calculator without Grok. **All four reconstructed canonical numeric references match the uploaded references**, as do the completed-close prices and displayed indicators. This makes the planner and rendering findings reproducible against these particular reports rather than a different BTC snapshot.

The replay used 13 public data requests, zero model calls, zero payments and zero wallet operations. It retained 520 bars per intraday/daily series, 457 weekly bars and 105 monthly bars. The uploads do not include their original raw report JSON: matching the application's eight-character numeric-map reference is useful corroboration, not a cryptographic proof of byte-identical original data or narrative. SHA-256 hashes of the actual uploaded files are recorded separately.

Local evidence is in `.tmp/uploaded-btc-audit-1756/`: `evidence.json` contains attachment hashes and independent arithmetic; `reconstruction.json` contains numeric-map comparisons and candidates; `verified-findings.json` records channel visibility, anchors and candidate geometry. Four `*-default.png` images reproduce the default renderer independently of the uploaded indicator selections. The files are local QA artifacts and are not published app documentation.

## Findings by timeframe

| Frame | Verified observation | Main problem | Assessment |
| --- | --- | --- | --- |
| 1H | Close 81,263.60; SMA55 81,784.15; the average's ten-bar change is **+45.03**. Primary bias is mixed. A falling broad channel and a candidate down 1–2 sketch are saved. | Recovery becomes the main route by fallback; its rejected buy dominates the headline. Both candidate directions fail minimum reward. The broad channel's upper rail is outside the viewport. | Fails direction hierarchy and structural visibility. This is not a confirmed downtrend merely because price is below an average. |
| 4H | Close 81,349.60; an evidenced range of 80,809.50–84,166.30, with down swing structure. Broad and local falling channels are saved. | Range-edge planning and tactical internal-resistance selling are conflated. The broad upper rail is clipped. The large gray future zigzag is authored geometry, not calculated wave evidence. | Range context is defensible; the selected setup and drawing need clearer justification. |
| 1D UTC | Last completed close 81,617.50. Swing structure is down; SMA evidence is rising; combined bias is mixed. Buy reference offers 0.12R. | A mixed/down-structure market is introduced through a rejected LONG/continuation idea. There is no saved qualifying parallel channel. | Rejecting this buy is correct; presenting it as the dominant setup is not useful. |
| 1W UTC | Last weekly close 83,760.40 on October 12; latest completed daily entry evidence is 81,617.50 on October 17. Bias is mixed; the buy reference offers 2.09R. | The entry sentence uses a daily close/retest, while the same-level recovery under Possible moves uses a weekly close/retest. Macro Fibonacci anchors and most Elliott history are outside the 24-bar view. | A conditional recovery can be researched, but it is not a current buy signal and its confirmation contract is ambiguous. |

Different timeframe directions are not inherently an error. A four-hour pullback can occur inside a weekly recovery hypothesis. The reports must explain the nesting and its separate price conditions; they must not turn a conditional higher-frame idea into an unconditional LONG recommendation or force every timeframe to agree.

## 1. Channels: defaults, clipping and absent constructions are different problems

The checkbox defaults are already enabled in `GlobalMarketChart.tsx`: `channel: true, localChannel: true`. Merely changing those defaults again will not repair this issue.

The default scale uses candles, mapped horizontal levels and some plan prices. It does **not** include the enabled parallel-channel rails. The shared SVG renderer has the same omission. The geometry clipper then correctly clips a channel to that incorrectly chosen viewport.

| Default chart | Broad lower rail at last bar | Broad upper rail at last bar | Visible price-axis maximum | Actual default SVG |
| --- | --- | --- | --- | --- |
| 1H | 80,751.79 | 83,946.38 | 83,140.40 | Lower rail drawn; upper rail absent |
| 4H | 80,729.36 | 85,795.74 | 84,820.25 | Lower rail drawn; upper rail absent |

The 4H local channel, about 80,587.30–83,833.60 at the last bar, has both rails drawn. This is why a gray local structure can be visible while the orange broad channel looks missing. The 1H orange line near the bottom is only one rail of a much larger construction; the cyan lines in the study variants are regression, not the missing orange upper rail.

There are three additional issues:

- The default view shows 32 1H bars, 47 4H bars, 32 daily bars and 24 weekly bars in these uploads. The 1H broad anchors are October 13–16; the 4H broad anchors are September 28–October 16. Important anchors are outside the view.
- Trend and Fibonacci presets explicitly set both parallel-channel flags to false. A preset therefore removes previously enabled structural context without making the distinction clear.
- The daily and weekly reconstructions contain **zero qualifying parallel channels**. Their active-looking controls cannot produce a channel. The detector's containment, width, span and touch rules explain what is being tested, but its output does not tell the reader why candidates failed. An absent construction must not be fabricated to satisfy the appearance of the reference screenshot.

The broad detector also examines only the last 180 candles. Calling its best fit “broad” does not mean it matches the much longer structure drawn in the author's earlier BTC example. Its present containment requirement can also remove a channel after a meaningful break; a historically valid channel with price now outside it deserves a separately evidenced state rather than automatic disappearance.

**Correction:** make structural coverage the default; fit the selected channel's relevant anchors and both rails, or explicitly disclose an off-screen boundary and offer a fit action. Preserve structural layers across study presets. Disable absent channel controls with a reason. Distinguish parallel and regression channels in color, legend and names. Investigate candidate rejection and broader lookbacks before changing detection thresholds; do not hardcode a rising channel to resemble one historical screenshot.

Code: [chart defaults and autoscale](../apps/web/src/GlobalMarketChart.tsx), [SVG scale and channel clipping](../packages/domain/src/globalChart.ts), [fixed setup window](../packages/domain/src/globalPolicy.ts), [channel detector](../packages/analysis/src/globalStructures.ts).

## 2. Mixed evidence can become a bullish main route by array order

The primary frame evidence and the route constructor do not use one market-classification result. In the 1H reconstruction, the frame bias is mixed. The constructor's simpler SMA test does not establish an up/down trend, and there is no measured horizontal range. It creates recovery before correction, then promotes `paths[0]` when no path has a main role. Recovery consequently becomes main without positive directional evidence.

The candidate scorer then gives all reward failures the same score and breaks ties using the main path. In this 1H report:

- Buy candidate: **0.2834R**, no confirmation/retest.
- Sell candidate: **0.3569R**, no current confirmation/retest and an earlier failed attempt.

Neither is a qualified entry. LONG is not selected because it is an executable or clearly superior trade. The daily report has the same presentation consequence: buy approximately 0.1191R, sell approximately 1.3754R; both fail the stated 1.50R floor, and the rejected buy remains dominant.

Opposing wave and recovery hypotheses can legitimately coexist. The defect is the unsupported priority and its presentation as the report's main directional result, not their mere coexistence.

**Correction:** separate observed market classification, scenario priority and trade qualification. Mixed evidence must remain mixed until an explicit structure rule resolves it. Evaluate BUY and SELL candidates symmetrically; if neither qualifies, retain the useful price map without elevating a rejected candidate to an apparent trade call. Explain what new observed structure would make a setup possible. Keep the 1.50R gate; do not replace the headline with SHORT simply because the old LONG failed.

Code: [route construction and main fallback](../packages/analysis/src/globalReport.ts), [candidate scoring](../packages/domain/src/globalTradePlan.ts), [heading selection](../packages/domain/src/globalSetupLanguage.ts), [market-view wording](../packages/domain/src/globalDecision.ts).

## 3. Range candidates are filtered out, and their target policy needs repair

The 4H context is RANGE, but its selected plan is a resistance-rejection study at **82,800**, inside the range. Its named resistance zone is **84,147.10–84,166.30**. An internal pivot can be a legitimate tactical resistance; it must be identified as internal and its selection explained. It is not the upper range edge.

The planner calculates range-buy and range-sell candidates, then excludes them from selection unless they already have a confirmation timestamp. It retains other unconfirmed/ended directional candidates. In this snapshot, the selected internal-resistance short has an earlier objective-completion record, while prospective range-edge candidates are excluded. Requiring an observed signal before execution is correct; excluding an entire family from **prospective planning** while permitting other unconfirmed families is inconsistent.

Simply removing this filter would introduce another problem. The range calculator assigns the opposite edge as its first target. Its own map contains intermediate swing levels:

| Candidate | Current final-edge target | Existing intermediate mapped swing levels |
| --- | --- | --- |
| Buy near support | 84,147.10 | 82,800; 82,902.80; 83,168.90; 83,530.10; 83,884 |
| Sell near resistance | 81,032.80 | 83,884; 83,530.10; 83,168.90; 82,902.80; 82,800 |

Those unselected candidates advertise approximately **11.31R** and **44.73R** to the opposite edge. These figures are not in the uploaded selected setup, but the replay exposes a defect in the proposed alternatives. Using the first listed intervening swing would reduce them to about 6.38R and 3.45R respectively, before costs; whether each swing is a material obstacle needs an explicit policy. The opposite edge may be a final objective, but it cannot silently be called the nearest/first structural obstacle.

**Correction:** classify range-edge buys/sells and internal-level tactical setups separately. Rank prospective candidates consistently. Build an explicit, source-backed hierarchy of material obstacles and map TP1/intermediate/final objectives accordingly. Make that policy consistent with the entry timeframe. Do not discard nearby obstacles solely to improve R:R.

Code: [range candidate geometry](../packages/domain/src/globalEntryPlan.ts), [range selection filter](../packages/domain/src/globalTradePlan.ts).

## 4. The arithmetic passes; the meaning and provisional geometry need work

Independent calculation from the displayed, rounded prices:

| Report | Worst displayed entry | Planned SL | First displayed objective | Reward / risk |
| --- | --- | --- | --- | --- |
| 1H buy | 81,413.43 | 81,023.67 | 81,523.90 | 110.47 / 389.76 = **0.28R** |
| 4H sell | 82,775.07 | 82,953.44 | 81,032.80 | 1,742.27 / 178.37 = **9.77R** |
| 1D buy | 82,362.48 | 80,732.02 | 82,556.60 | 194.12 / 1,630.46 = **0.12R** |
| 1W buy | 83,067.25 | 80,174.74 | 89,111.00 | 6,043.75 / 2,892.51 = **2.09R** |

Rejecting the hourly and daily buy references is correct under the configured risk rule. Another close or retest cannot repair their reward while the same entry/stop/first objective remain in place. A later observed structure can justify a different setup; arbitrarily tightening protection or deleting TP1 cannot.

The 1H stop is explicitly a **1H mapped-boundary fallback plus a 15m allowance**, about 4.27 of the entry frame's ATR. It is not an observed 15m reaction stop. The 4H short risk is about 0.72 of 1H ATR and depends on a future rejection after a substantial rally. The weekly planned risk is about 1.28 daily ATR. Neither percent distance nor an ATR multiple alone proves that a stop is appropriate. The swing/reaction, timeframe and acceptable cash loss must be identified; costs and ordinary volatility matter. [CME's stop and position-size guidance](https://www.cmegroup.com/education/courses/trade-and-risk-management/proper-position-size).

Prospective watch areas currently straddle their trigger, while confirmed entry geometry is recalculated from the actual reaction/retest. That can be reasonable if the two are clearly distinguished. It is misleading to present the provisional area's R:R as a stable executable setup. For example, the unselected weekly short's 1.50R band is 83,006.64–83,067.25, **above** its 82,842 breakdown trigger, whereas a confirmed held downside retest is recalculated on the other side. This is not evidence of a currently executable 1.50R short.

**Correction:** distinguish watch area, provisional example prices and observed entry/SL. Show the stop's anchor and timeframe. Recalculate R:R after the actual signal and quote. Rejected geometry belongs in a concise explanation or details, not a prominent “setup” table competing with the valid market map. TradingView's position tool permits planning entry/stop/target and risk before an order, but a planning drawing does not supply confirmation or a fill. [TradingView position tools](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/).

## 5. Confirmation frames and chart stages need one explicit contract

The weekly report's Next condition says a completed **daily UTC** close above 82,842 followed by a held retest. Possible moves describes a completed **weekly UTC** close/retest above the same price. Daily entry evidence and weekly structure conditions can both be useful, but they are not equivalent conditions. Their names and drawing labels currently do not distinguish them sufficiently.

The same split exists in the daily report: the setup uses 4H evidence while the route sentence uses the primary daily frame. Raw `1Dutc`/`1Wutc` tokens also remain in parts of the TXT despite prettier labels elsewhere.

**Correction:** retain separate `structureTimeframe` and `entryTimeframe` meanings in the presentation contract. An entry-labelled route uses the exact entry rule and frame everywhere: card, chart, entry panel, TXT, Telegram and recheck. A higher-frame structure route must say explicitly that it describes structure rather than another entry confirmation. The weekly header should show the newer completed daily entry close alongside the older weekly reference, so a weekly close already above the level is not mistaken for a currently confirmed daily buy.

Code: [primary-frame path prose](../packages/domain/src/globalPresentation.ts), [entry-frame conditions](../packages/domain/src/globalSetupLanguage.ts), [actual entry panel](../packages/domain/src/globalEntryChart.ts).

## 6. Fibonacci arithmetic is standard; anchor context is missing

The 1H reconstruction uses **82,928.50 on October 16 at 11:00 UTC → 80,809.50 at 17:00 UTC**. Its 50% retracement is correctly **81,869.00**; the displayed 38.2% and 61.8% values are also correct. This is not a reason to change the Fibonacci formula.

The weekly reconstruction uses **24,220 on August 14, 2023 → 124,500 on August 11, 2025**. Its 50% level of **74,360** and 38.2% level of **86,193.04** are correct. Both actual endpoints are outside the 24-week view. The visible Elliott B and C labels are different anchors. Without the dates and swing scope, the reader cannot know what the weekly Fibonacci study measures.

**Correction:** name the measured swing and both dates/prices; distinguish macro from local retracements. Give Fibonacci anchors different labels from Elliott A/B/C. Offer a fit-to-anchors action and an off-screen note. Show only useful nearby ratios in the default structure view; keep the full study optional. TradingView defines retracement from two extreme points with configurable ratio levels. [Fibonacci retracement guidance](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/).

## 7. Elliott labels need leg direction and visible evidence

The hourly and daily reports have a partial down 1–2 candidate. That is a sketch of a possible structure; it does not establish a complete impulse or a confirmed wave 3. The 4H report similarly has a candidate 3, with waves 4–5 unobserved.

The weekly TXT says `abc correction · C? · up`, although its visible B-to-C leg falls. The code stores the **preceding impulse's direction** in this field, not the current correction leg's direction. That is a semantic ambiguity rather than proof that every anchor is mathematically invalid.

The fixed narrow view hides the preceding weekly 0–5 structure. A B/C fragment cannot make the complete count intelligible. The planner's alternating-pivot tests also do not implement full nested Elliott analysis; source validation itself acknowledges unverified subdivisions. TradingView's described pattern recognition checks internal impulse/zigzag structures and nesting. [Elliott theory and tools](https://www.tradingview.com/support/solutions/43000653212-elliott-wave-theory-and-tools/).

**Correction:** distinguish parent trend, current leg direction and entry scenario. Label weekly evidence as a candidate ABC correction of the prior upward impulse, with a downward candidate C leg. Show complete relevant anchor history or a clear linked structure view. Use plain swing-structure labels when a defensible Elliott interpretation is unavailable; do not invent waves to make the chart look complete.

## 8. The future drawing and text hierarchy overstate precision

The 4H gray zigzag repeatedly bounces between the range edges in future space. Source code draws those points at fixed fractions of that space. They are not fitted turns, observed future pivots or a wave forecast. A schematic label helps, but the large solid path still visually suggests a precise sequence. Rejected 1H/daily buy ideas also retain prominent green “Main” arrows.

The exported files are 1300 pixels wide, with some labels rendered at only 8–10 pixels. The setup condition, quote reminder and level lists are repeated across several sections and a dense chart footer. Turning on all studies adds regression, five SMAs, Fibonacci, VWAP, pivots and ATR on top of structural rails. Functional absence of overflow is not the same as legibility or interpretability.

**Correction:** use a restrained structure map and explicit conditional level gates, not arbitrary future oscillation paths. Keep one main structure and one material alternative; give BUY/SELL entry marks their own named timeframe. Use a compact, readable setup summary, with longer evidence in TXT/details. Define indicator priority, label collision rules and a high-resolution native export. Preserve the same facts and setup contract across desktop, mobile, PNG and Telegram.

## What the Vilarso and TradingView comparison actually establishes

Vilarso's public PRO description uses averages, volume, volatility and candle behavior, with a linear-regression channel. It is an invite-only implementation. The author's public instructions distinguish an alert from an immediate trade and discuss supplementary SMAs, regression and pivots. This supports the user's expectation of a coherent directional chart, contextual studies and intelligible BUY/SELL conditions; it does not certify PULSE's fixed thresholds or disclose the protected algorithm. [Vilarso PRO](https://www.tradingview.com/script/G6hpaqTy-vilarso-pro/), [author's instructions](https://t.me/s/vilarsopro?q=%23VilarsoPro).

Vilarso Trend is a separate protected oscillator with its own zones and moving-average interpretation. RSI14 is not a replication of it. [Vilarso Trend](https://www.tradingview.com/script/c9nPoO7m-vilarso-trend/).

Parallel channels and regression channels are different constructions. TradingView exposes parallel-channel endpoints and price offset; regression channels use a baseline and deviation bands. A user must be able to identify which construction is shown. [Parallel channel](https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/), [regression trend](https://www.tradingview.com/support/solutions/43000518108-regression-trend-drawing-tool/).

The earlier Binance 4H author screenshot remains useful for its broad/local structural hierarchy and conditional range interpretation. Its manually visible lines do not establish a unique algorithm, and its venue, session, observation time and anchors differ from these OKX UTC reports. Exact prices or channel slopes should not be copied from it. The 1.50R floor, 0.10 ATR allowance, range/channel tolerances and fixed lookbacks are PULSE parameters; this audit found no public basis for presenting them as Vilarso's prescribed settings.

Switching the chart library alone cannot fix candidate ranking, stop provenance, missing channel constructions or conflicting confirmation frames. Those originate in PULSE's own calculation and presentation code.

## Correction plan and acceptance criteria

| Order | Work | Acceptance using these exact four reconstructed snapshots |
| --- | --- | --- |
| 1 | One market-classification result; symmetric BUY/SELL scenario and qualification records. Remove array-order bullish priority and all-failed headline selection. | 1H/daily retain mixed structure; neither rejected buy is promoted to a trade call. Both directions' reasons remain inspectable. |
| 2 | Repair range candidate eligibility and material-obstacle/TP policy together. Name internal versus edge setups. | 4H can show conditional edge studies without claiming observed entries; no 44.73R “first obstacle” figure that ignores its own intervening levels. The selected tactical 82,800 sell is justified explicitly. |
| 3 | One entry contract across chart, TXT, app, Telegram and recheck; separate higher-frame structure conditions. | The weekly daily-entry rule is identical wherever entry is described. Weekly-structure conditions have a different explicit label. No raw `utc` tokens in human prose. |
| 4 | Fit structural history and both enabled channel rails; add availability and break-state information; keep structural layers across presets. | Both 1H and 4H broad rails are visible in the default view or explicitly disclosed as off-screen. Daily/weekly do not offer a working-looking nonexistent channel. No fabricated rail. |
| 5 | Separate provisional watch geometry from observed entry/protection; explain stop anchors, costs and first obstacles. | 0.28R/0.12R remain rejected; no stop squeezing or target deletion. A fresh observed reaction can create a new justified entry. No provisional price is copied as observed TP/SL. |
| 6 | Correct Elliott direction semantics and Fibonacci anchor context; simplify future arrows and labels. | Weekly C-leg direction and macro Fib dates are clear. The default 1H map remains readable; enabling studies does not erase its structural context. |
| 7 | Validate the actual trader-facing result before another paid rollout. | Offline replay of these four maps; default and study screenshots on desktop/mobile; TXT/PNG/Telegram field comparison; positive and negative entry cases; exact clean Vercel build. Retain manual Market/Limit buy/sell and editable TP/SL. |

The first six items need implementation before another claim that the reports meet the agreed professional design. Reuse these public-candle reconstructions and existing paid report access for that work; another round of four paid calls is not required to reproduce the current defects. Historical performance evaluation is a separate requirement before claiming that a new parameter profile is profitable.
