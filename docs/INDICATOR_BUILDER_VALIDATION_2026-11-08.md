# Indicator builder follow-up — 8 November 2026

The seven reported builder/workflow issues are addressed by the native template builder, actual-source preview and chart application described below. Full local browser acceptance completed at **2026-11-08 08:54:55 UTC**, with **37 browser checks, 14 screenshots and zero browser exceptions**. The connected API/browser run recorded **41 checks**. It reconciled the existing real Base creator-service payment and requested **zero new payment signatures**. Local acceptance does not establish that the public deployed app already contains these changes or that an indicator is profitable.

This extends the [7 November second-release record](INDICATOR_MARKET_V2_VALIDATION_2026-11-07.md). The original funded browser checkout and the completed no-new-payment workflow run are separate evidence, detailed below. Any later release validation must be recorded with its own completed artifact timestamp rather than inferred from a running log.

## Seven reported issues and resulting behavior

| # | Reported issue | Fix and how to use it | Evidence and current boundary |
|---:|---|---|---|
| 1 | How is an indicator created? Why are import/export the first steps instead of creating it inside Create indicator? | Create indicator now starts with working templates. Inputs & formula and Appearance sit beside a preview using the selected market's captured executions. Add & view on chart installs it; Save draft stores it privately in this browser. Publish is optional. | Actual browser creation previewed real executions, saved/restored a draft, generated an identity and applied the study to the native chart. It also published, discovered and unpublished the exact version. |
| 2 | Why should ordinary users import files? | They do not need to. Catalog installation and native creation work inside PULSE. Move a saved indicator between apps is an optional disclosure for import/export, backup and compatible-host use. | Actual UI export created a file; removal and file-input reimport restored the identical manifest/netlist. These are portability checks, not prerequisites for normal chart use. |
| 3 | Why must the user invent a Package ID? | The builder generates its package ID and version. A friendly indicator name is the main identity the trader sees. Technical identity appears only in optional details. | The live browser installed an automatically generated `trader.*` ID and checked its nonempty chart output; no Package ID input was required. |
| 4 | Where is the created indicator on the chart? | Add & view on chart opens Trading Terminal and focuses the actual input window. Installed studies have named native chart panes on the shared time axis, with their own units and plotted-point information. Catalog View chart and optional inspection controls reopen them. | The completed 08:54 run verified **19 plotted BTC values** for the created indicator, a custom Above 60% condition on the percentage pane, daily/weekly Reset versus source-window inspection, and Spot/Futures formatting. A title alone was not accepted as proof of plotted data. |
| 5 | How is this useful for trading, and can it author real stateful studies instead of a toy 120/80 ABI calculator? | Templates include buyer participation, volume delta, CVD, Delta % with EMA 8 and Rolling executed delta 20. The bounded v3 recipe adds causal EMA/SMA/rolling sum/cumulative state and threshold/crossover conditions to the actual compiled per-bar math, with line/histogram plotting. Advanced expressions remain optional. The weighted-flow example is explicitly asymmetric, not ordinary net volume. | Domain tests, 108 real-source study evaluations and independent-host browser cases passed. Real-source captures remained partial; Rolling 20 appropriately stayed in warm-up when fewer than twenty eligible contiguous bars existed. Separate numerical fixtures verified full-window rolling/SMA/EMA/cumulative state and gap/crossover behavior; they were not marketed as live trades. |
| 6 | Why must users enter a processor/circuit ID or verify X Layer after creating an indicator? What does Tapeout actually do? | Ordinary creation, installation and publication require no manual processor/circuit fields. The numerical per-bar formula actually executes through a TAP-02 NAND circuit. A verified X Layer reference identifies that executable numerical core; technical deployment details are separate developer tools. | Existing real registrations remain recorded in the prior acceptance document. They do not certify exchange feeds, the entire host-side rolling state, creator originality or profitability. A local study does not silently become a new registered circuit. |
| 7 | Provide a real complete worked workflow. | The app handbook starts with Buyer participation on the selected market, actual captured inputs and Add to chart. The builder guide walks through Rolling 20, twenty full contiguous source bars, real preview, Add & view on chart, saved drafting and optional publication. Illustrations are labelled examples; actual-session screenshots show real captured inputs. | The completed workflow covers preview, draft restore, native chart application, publication discovery, actual file portability, complete independent series calculation, tamper rejection and handbook/landing navigation. Funded browser checkout and delisted-version restoration have separate real payment evidence. |

The existing PULSE header and top tabs remain. All seven Terminal sidebar destinations were actually opened in this run, preserving the market selection; the test was not limited to counting navigation buttons.

## Implemented calculation and source rules

The additive `pulse-indicator-v3` recipe is:

`executed source → compiled per-bar numerical kernel → series transforms → optional condition → plot`

- The bounded expression inputs are executed `buy` and `sell` quantities. Arithmetic and `abs/min/max/clamp` compile to actual NAND calculations with dimension, range and resource checks.
- Up to four causal transforms are supported. EMA, SMA and rolling-sum periods are integers from 2 to 200 **source bars**. Cumulative sum is explicit host state.
- SMA and rolling sum require a full contiguous window. EMA seeds from the first full-period SMA and then updates with `2 / (period + 1)`. Chained transforms each have their own warm-up.
- Missing/invalid observations reset state and prior condition memory. No look-ahead, interpolation, zero filling or partial-window average fills unknown history.
- A clipped source edge shorter than the declared interval is excluded from all transforms, including cumulative sum. Without transforms its raw per-bar reading can remain visible as partial, but cannot confirm a crossover.
- The preview identifies its last resolved reading time. It may be older than the newest capture while the study is warming up or the latest source bar is partial.
- Percentage display converts basis points explicitly; portable JSON retains the declared numerical units. Spot base-asset quantities and Futures contract quantities are not substituted for one another.
- Conditions describe observed measurements. They do not automatically create Radar watches, Telegram subscriptions or exchange orders.

This is a bounded native flow-study builder. General Pine compatibility, arbitrary OHLC/price inputs, unrestricted scripts, multiple custom plots and a complete third-party scripting platform are not implemented. Kernel verification does not certify the full host-side series state or trading results.

## Automated, build and workflow checks

| Check | Observed result | Evidence |
|---|---|---|
| Full web suite | **314 passed**, 0 failed | `.tmp/indicator-builder-web-tests.log` |
| Full domain suite | **106 passed**, 0 failed | `.tmp/indicator-builder-domain-tests.log` |
| Full API suite | **528 passed**, 1 optional test skipped, 0 failed | `.tmp/indicator-builder-api-tests.log` |
| API production build | Passed TypeScript build | `.tmp/indicator-builder-api-build.log` |
| Web production build | Passed; existing annotation/chunk-size warnings remain | `.tmp/indicator-builder-web-build.log` |
| Live source matrix | **108 study evaluations** completed without the reported source-window exception | `.tmp/indicator-builder-source-matrix.log` |
| Complete browser workflow, 08:54 UTC | **37 checks**, 14 screenshots, 0 browser exceptions, 0 new payment signatures | `.tmp/indicator-market-e2e/browser/indicator-browser-validation.json` |
| Connected API/browser workflow, 08:54 UTC | **41 checks**, including reconciliation of the already settled creator payment | `.tmp/indicator-builder-release-validation.log`, `.tmp/indicator-market-e2e/funded-validation.json` |

Counts above are observed completed checks. The browser suite is a subset of the connected API/browser run, so 37 and 41 must not be summed as independent workflows. The automated suites contain **948 passed tests and one optional skip** in total. They validate implementation behavior, not trading returns or complete historical market coverage.

## Live source matrix: coverage and limits

The matrix evaluated BTC-USDT at **15m, 1H, 4H, 1D UTC and 1W UTC**, plus ETH-USDT at **1D UTC**. Each selection used Spot and Futures independently, with nine studies each: three existing numerical catalog kernels and six v3 templates/examples. That is `6 selections × 2 streams × 9 studies = 108` evaluations.

All source captures in this run were **partial**, from the stated public execution source. Success here establishes source-window admission, finite/ordered inputs and calculation behavior on the supplied captures. It does not establish complete daily/weekly/monthly execution coverage, a full historical session, an accurate backtest or a profitable setup. A study can pass admission and legitimately return no resolved Rolling 20 points while it waits for enough eligible history.

## Completed browser workflow

The completed run used the actual local app/API, durable storage, real market captures and the configured test wallet's existing paid access. Payment signing was disabled for this run. Its artifact timestamp is **2026-11-08T08:54:13.129Z**; the enclosing API/browser result completed at **2026-11-08T08:54:13.136Z**.

- Wallet ownership sign-in, existing real paid Terminal access and its ticking server-based countdown.
- Existing header and second-position Trading Terminal tab; actual navigation through all seven workspace sections while retaining the selected market.
- Registered catalog information, installation and contextual Ask PULSE entry.
- Native builder with actual market data, automatic identity, browser-local draft saving/restoration and an applied chart series with 24 plotted BTC values.
- Publish, discover and unpublish of the exact created version.
- Editing a buyer-participation condition to Above 60% and carrying the exact condition to its named native chart pane.
- Daily and weekly chart Reset versus actual source-time inspection, without substituting the primary candle interval for execution timestamps.
- Automatic version advancement after changing free/paid terms, without publishing or requesting a payment.
- Real captured Spot execution prices at micro inspection zoom; primary candles retain their timeframe. Four native indicator panes remained at least 100 pixels high, and the RSI label followed its actual pane.
- Switching an installed quantity study from Spot BTC units to Futures contracts on the native chart.
- Indicator Market layouts at 1440px and 390px in Base and X Layer appearances, with no horizontal overflow.
- Actual export download, removal and file-input reimport of the identical custom package. The recorded netlist hash was `7ec83d359225f26546cda63e34a484947b4208f38048bea6fadfd23617e531da`.
- Independent host reproduction of the exported kernel for `120,80 → 160`, `10,80 → -60` and `0,0 → 0`, without PULSE API or wallet use.
- Independent evaluation of the actual exported v3 recipe over three explicit numerical source rows. That directly exported weighted-flow recipe has no rolling transforms.
- Separate explicit numerical QA recipes using the actual exported kernel verified rolling sum, SMA, EMA and cumulative state over eight source rows with a gap. Each case checked full-window warm-up, reset behavior, a genuine zero crossover and the absence of an invented first post-gap crossover. These are arithmetic fixtures, not captured market history.
- Rejection of a tampered forward-reference circuit followed by restoration of the original exported package.
- Both handbook entry points and the public landing's dedicated Indicator Market section/direct Terminal link.

An earlier harness selector error was corrected before this completed run. The authoritative completed artifacts are the timestamped validation JSON files above; earlier failure artifacts describe prior attempts and do not supersede them. The 14 screenshots include desktop/mobile builder previews, the applied condition chart, daily/weekly inspection, both appearances, export/import, independent-host output and handbook/landing examples.

## Real Base creator checkout

The original funded browser stage reviewed and settled **one 0.001 native-USDC creator-service purchase on Base**. The settlement endpoint returned `201`, and managed installation followed in the browser. The buyer used its existing real paid Terminal pass. Creator access for QA was an explicit local fixture, not a second real Terminal-pass purchase. The later completed 08:54 run reconciled this same receipt without a new payment signature or debit.

- QA listing: `pmi_d14db177e2650c533305128d205ee68d`, version `4.0.0`.
- Amount: `1000` atomic USDC units.
- Reconciled transaction: `0x00d8a5fae4090004b70957c49821904583fa3dfabeca02082193a0e24c003f15`.
- Creator recipient: `0x41d4def3019ff03d2a4dfcc7690e887e95250ec8`.
- One reviewed typed payment signature was recorded. After delisting/removing, browser restoration reused the purchased entitlement without requesting a second signature.
- The 0.001 amount is a deliberately small test listing price. It is not the Terminal pass price, a mandatory indicator price or an automatic renewal.

Original funded-stage evidence: `.tmp/indicator-builder-live-e2e.log`, `.tmp/indicator-market-e2e/browser-service-purchase.json`, `creator-checkout-review-1440.png` and `creator-purchase-restored-1440.png`. The latter screenshots are under `.tmp/indicator-market-e2e/browser/`. Completed receipt reconciliation is recorded in `.tmp/indicator-market-e2e/funded-validation.json`. Keys and authorization payloads are not public evidence. Retrying acceptance must reuse/reconcile this purchase instead of requesting another debit.

X Layer USDT0 and Arbitrum native-USDC routes have real **unsigned** challenge/API checks and payment regression coverage. **No funded USDT0 or Arbitrum creator purchase is claimed here.** Real OKB circuit-registration transactions are separate operations and are not USDT0 settlement tests. No exchange orders or Telegram notifications were sent by this builder acceptance workflow.

## Release and operational boundaries

The final local acceptance completed at **2026-11-08T08:54:55.655Z** with 37 browser checks, 41 connected checks, zero browser exceptions and no new payment signatures. Automatic versioning, readable chart panes, the captured Spot price context and both real guide images were included. API and web production builds passed. Physical iOS/Android testing, unrelated third-party app adoption, full retained macro-session coverage and trading profitability remain outside this acceptance. These changes and this acceptance record are included in the local implementation commit; deployment is separate.
