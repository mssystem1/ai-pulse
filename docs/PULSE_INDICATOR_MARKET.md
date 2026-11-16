# PULSE Indicator Market

PULSE Indicator Market turns numerical calculations into versioned, portable trading tools. It has dedicated destinations in Trading Terminal: **Indicator Market** for discovery/purchases, **Create indicator** for authoring and **My indicators** for creations, purchases and chart use. Installed tools appear alongside the price chart. The public landing has a dedicated **PULSE Indicator Market** section, and the app has illustrated [installation](https://app.ai-pulse.tech/docs#docs-indicator-market) and [creator](https://app.ai-pulse.tech/docs#docs-create-indicator) guides.

The PULSE header and top-level tabs remain intact. Trading Terminal stays immediately after Portfolio. Its eight-section workspace separates Trading Terminal, Market tools, Market Radar, Create indicator, Indicator Market, My indicators, My open positions and Alerts & activity. One selected market and timeframe carry between sections. Terminal passes, Global reports and creator indicator services remain separate products.

## Use it

1. Open Trading Terminal with an active pass and select the market and primary timeframe. Open **Indicators Market**: `/trading-terminal?terminalSection=indicators`.
2. For a first reading, select **Buyer participation** and **Add to chart**. Free tools install directly. Paid managed-service listings require their separate reviewed quote and explicit payment first.
3. Open **Trading Terminal** and compare the installed percentage pane with price on the shared time axis. Quantity and percentage studies keep independent scales. Hover or tap a resolved point to inspect its timestamp and value. Check the named market, Spot/Futures stream, source interval, covered dates and gaps.
4. Read actual bought/sold quantities for the same source bucket in the source details or Market tools. You do not need to type test numbers, import a file, provide a package ID or enter a contract address to use an indicator.
5. In **My indicators → Applied & installed indicators**, show/hide changes its visibility; Remove uninstalls it. **Inspect execution window on chart** is an optional way to inspect the covered input window. The printed source interval defines each calculation bar: twenty one-minute bars remain twenty minutes on a daily price chart. A broad price timeframe cannot manufacture historical executions.

Worked reading: buyer participation is `buy / (buy + sell)`. If a captured bucket really contains 120 bought and 80 sold, its buyer share is 60% and normalized delta is 20%. Those numbers are an illustration; the live preview uses actual source quantities. Compare its corresponding candle and nearby price level. Aggressive buying can coincide with flat or falling price; participation is evidence about executions, not an automatic entry.

## Visual and script Studio

**Create indicator** opens **Visual & script Studio**. Start with a working price, volatility, executed-flow or sequential-condition template. Enter **Indicator name** and **Publisher name**; IDs and versions are automatic. Publisher names appear on catalog cards, creations, installed studies, purchases and the native chart legend. The publishing wallet identifies the account that published a version; a typed name alone is not verified identity.

| Studio template | Source and chart result |
|---|---|
| EMA trend 20 / 50 | Completed primary-timeframe closes; two price overlays and a separate crossover condition |
| Bollinger-style bands 20 / 2 | SMA20 plus/minus two population standard deviations on price |
| RSI 14 | Wilder-smoothed completed-close RSI in a percentage pane; fourteen close changes required |
| ATR 14 & volatility bands | Wilder true range plus close ± two ATR price overlays |
| Sweep → reclaim → hold stateflow | Capture the prior twenty-bar low at the sweep, then require distinct later reclaim/hold bars within the configured window |
| Tapeout executed delta & EMA 8 | Actual bought-minus-sold quantities through the numerical NAND kernel, then an eight-execution-source-bar EMA |

**Visual blocks** connects earlier inputs to calculations and named outputs. Select periods, source nodes and sequential-condition stages. Each output declares its price-overlay/indicator-pane destination, line/histogram style, units and color. **Script editor** edits the same graph; **Compile script & update preview** must succeed before that text becomes the working calculation. No arbitrary JavaScript runs.

### Complete example: EMA overlays and crossover

1. Select a market/timeframe in Trading Terminal, open Create indicator and choose **EMA trend 20 / 50**. Fill in your publisher name and a useful indicator name.
2. Inspect the `close → EMA20`, `close → EMA50` and crossover blocks, or open Script editor and compile:

```text
fast = ema(close,20)
slow = ema(close,50)
cross = crossover(fast,slow)
plot(fast,"EMA 20","price","line","price","#22d3ee")
plot(slow,"EMA 50","price","line","price","#fbbf24")
plot(cross,"Bullish EMA crossover","indicator","histogram","scalar","#34d399")
```

3. Preview actual completed candles for the chosen primary timeframe. EMA50 needs fifty contiguous eligible closes. Warm-up and gaps remain blank; a crossover requires earlier and current resolved values. It cannot cross a source gap.
4. **Save to My indicators** retains a private device-local working copy. **Add & view on chart** applies the calculation and opens its plotted chart. EMA20/50 are price overlays; the named crossover appears in an indicator pane, with its own units and publisher legend.
5. Open **My indicators** to reopen a creation, manage applied studies or restore a purchased version. Reopening a creation makes a new working version; it does not alter a previously purchased package.
6. Publishing is optional. On Create indicator, choose a calculation reference only when an exact matching registered numerical core is recommended. A pure price graph should remain **Local calculation**. In **Publish or sell this indicator**, describe the tool and choose free access or a paid version; publish only after inspecting its real preview.

### Stateflow and language boundaries

The stateflow template first detects a sweep of the prior twenty-bar low, captures that boundary and compares later reclaim/hold conditions against the captured level. Distinct later completed bars must advance each stage within the configured span. Gaps reset state. This is an indicator event; it does not automatically create Market Radar, Telegram delivery, an order or a position.

The additive **`pulse-indicator-v4`** format carries a bounded causal graph with up to **64 ordered nodes**, **8 plots**, and periods **1–200**. Sources are completed `open/high/low/close/volume` and actual executed `buy/sell`. Supported operations include arithmetic, EMA/SMA/sum, population standard deviation, rolling extrema, RSI, ATR, lag, comparisons/crosses, captured values and ordered sequences. Cycles, forward references, lookahead, loops, imports, external fetches and arbitrary code are rejected. Mixed price/flow calculations require aligned actual source clocks; missing alignment remains unknown. This is a PULSE language and does not accept unrestricted Pine scripts.

The earlier **Executed-flow builder** remains available for v3 formula/rolling recipes described below. v1/v2/v3 packages remain readable. OHLCV and stateful graph calculations run in the compatible host. A `tap_delta(buy,sell)` block executes the exact per-bar delta using Tapeout; pure price graphs do not silently use the bundled flow core.

### Reuse a registered calculation while creating

The **Portable calculation core** picker is on **Create indicator**, before publication. It lists recommended cores from the existing registered catalog only when the numerical netlist, input bits and output bits match exactly. It deduplicates the same processor/circuit. Select a recommendation without entering an address, or leave Local calculation. Advanced creators can supply another existing reference on this same page; manual attachment fields are not in the marketplace.

PULSE independently checks a selected reference before attaching it to the published version. If the listing publishes but this separate check fails, the UI explicitly reports that the listing exists without the reference; it does not claim a successful attachment. The same unchanged version can retry. A reference identifies reusable math across compatible Tapeout apps. It cannot improve returns, certify exchange data, prove an entire host graph ran on-chain or replace a trading strategy. A pure price graph without an active numerical kernel is never recommended an unrelated flow registration.

Actual UI captures for this workflow: [Studio](../apps/web/public/docs/indicator-studio-live-example.png), [My indicators](../apps/web/public/docs/indicator-my-library-live-example.png). They are historical test-session images; check market, timeframe, coverage and UTC clocks instead of treating them as a current call.

## My indicators and purchasing

**My indicators** is a separate sidebar destination: `/trading-terminal?terminalSection=my-indicators`.

- **Created by you:** private creations/drafts saved on this device; Open in builder edits a working copy.
- **Your published indicators:** catalog versions published by the signed-in wallet.
- **Purchased indicators:** immutable wallet-owned receipts with restoration even after delisting.
- **Applied & installed indicators:** show/hide, View chart, export or remove installed packages. Numerical mini-previews are collapsed; the shared Terminal chart is the trading view.

In Indicator Market read the publisher name/wallet, exact version, description and offer. Select an enabled payment network in the existing header, choose **Review purchase**, then review indicator, publisher recipient, token, network, amount and quote expiry. Approve the exact payment once. The purchased version installs and the receipt appears in My indicators. Restoring it never charges again, and delisting does not replace its bytes with a newer package. Unresolved payment acknowledgement must recover the original transaction instead of requesting another payment. Buying an indicator does not renew a Terminal pass, buy future versions or purchase profitable trades. Private working copies are browser-local; purchase receipts are service-backed and wallet-scoped.

## Executed-flow builder

Select **Executed-flow builder** on Create indicator for the earlier formula-and-series workflow. Imports and technical IDs are optional. Authoring, preview and chart use do not require a file or circuit address. Publisher name is visible; the wallet identifies a publication.

### Templates and a worked build

| Template | Formula and series behavior | Usable output |
|---|---|---|
| Buyer participation | Buyer volume divided by total executed volume; BPS arithmetic displayed as percent | A valid covered bar with non-zero volume |
| Volume delta | `buy - sell` for each source bar | A valid covered bar |
| Cumulative executed delta | Per-bar delta followed by cumulative host state | First full covered source bar of a contiguous segment; gaps restart it |
| Delta % with EMA 8 | Normalized delta followed by an eight-bar EMA | Eight contiguous valid inputs, seeded by their SMA |
| Rolling executed delta 20 | Per-bar delta followed by a twenty-bar rolling sum | Twenty contiguous valid source bars |

To build **Rolling executed delta 20**, keep the selected market, choose its template and read the source → formula → rolling → condition → plot pipeline. In Inputs & formula, the period is twenty **source bars**, whose actual duration is printed. The first nineteen full, valid bars have no rolling result. The twentieth sums all twenty deltas; each subsequent result drops the oldest and adds the newest. A clipped short edge does not count as a full bar; ten eligible bars cannot produce a fabricated twenty-bar sum. A gap clears the window and requires twenty new contiguous valid bars. Choose line or histogram in Appearance, inspect the real preview, then Add & view on chart or Save draft. Publishing is optional after that workflow works. **Open saved draft** restores a browser-local draft against the market currently selected, not its old capture.

An optional weighted-flow example uses `2 * buy - sell`; it is deliberately asymmetric and must not be presented as ordinary net volume or a profitable default.

### Portable series recipe

`pulse-indicator-v3` adds an explicit bounded **causal host series** recipe to a compiled per-bar formula. Older v1 kernels and v2 formulas remain readable. Its order is:

`executed source → TAP-02 per-bar numerical kernel → series transforms → optional condition → plot`

- Up to four transforms: EMA, SMA or rolling sum with integer periods from 2 to 200, or cumulative sum.
- SMA and rolling sum wait for their entire input period. EMA also waits for a full period, seeds with its SMA and then applies `alpha = 2 / (period + 1)`. Chained transforms each require their own valid input warm-up.
- A captured source edge whose `end - ts` is shorter than the declared interval is partial. It is excluded from every transform, including cumulative sum, rather than counted as a complete warm-up bar. A study without transforms can still expose that bar's raw numerical reading with `partial: true`; it cannot confirm a crossover. The latest resolved output may therefore predate the newest captured point; the preview names its actual time.
- A source gap or unresolved input clears all rolling/cumulative state and prior condition memory. No interpolation, zero filling, look-ahead or partial-window average is used. The new segment starts and warms up explicitly.
- Optional conditions are strictly above/below, cross above or cross below a finite threshold. A crossover requires available previous/current outputs and cannot bridge a gap. These conditions describe measurements; they do not silently create Radar watches, Telegram subscriptions or exchange orders.
- Plots are lines or histograms. Percentage display converts BPS output to percent explicitly, retaining the raw numerical units for portable evaluation.

The host performs series state, conditions and plotting; the NAND circuit performs the actual per-bar calculation. A registered kernel does not mean an entire EMA/rolling/condition pipeline ran on-chain. The exported recipe declares this split so another host can reproduce it. This v3 mode is the bounded executed-flow builder. Studio v4 separately supports the completed-OHLCV graph above; neither mode provides unrestricted Pine/MMT language parity or changes a report strategy.

### Custom formula language

**`pulse-flow-expr-v1`** compiles optional advanced expressions to TAP-02 NAND gates. It supports `buy`, `sell`, integer constants, parentheses, unary `+`/`-`, arithmetic `+ - * /`, and `abs`, `min`, `max`, `clamp`. v2 formulas support per-bucket or cumulative output; v3 keeps the kernel per-bar and declares cumulative behavior in its host series recipe. Outputs carry an explicit volume, ratio, basis-points or scalar label. Buy and sell quantities within each evaluation share its declared scale. v3 scales each source bar separately, decodes the kernel result back to source units and then applies the host series recipe.

| Expression | Buy 120, sell 80 | Meaning |
|---|---:|---|
| `buy - sell` | 40 | Net executed quantity in the bucket |
| `buy + sell` | 200 | Total covered quantity |
| `max(buy - sell, 0)` | 40 | Positive part of delta |

Changing metadata does not change a formula. Changing the expression changes its compiled circuit. The compiler bounds expression structure, gate count and possible signed-int32 overflow. It also checks dimensions: volume output must scale linearly with quantity; ratio, basis-point and scalar output must be independent of quantity scale. For example, `min(buy,100)` is rejected because a fixed dimensionless constant cannot be treated as a native quantity under the host's scale. `max(buy - sell,0)` is valid. Integer division truncates toward zero; division by zero is unresolved. The host checks gate output against independent arithmetic. This is a bounded **executed-flow expression language**, not an unrestricted price/volume scripting platform. It cannot execute JavaScript, fetch URLs, access a wallet or modify trade setups. Unsupported functions are rejected visibly.

Published content and commercial terms are immutable for that wallet/package/version. A change requires a new version. Unpublishing removes catalog discovery; recipients keep exported copies.

### Paid creator service

A paid listing sells its declared **versioned managed Terminal service**: installation access and any update/support terms explicitly included in the quote. It does not sell secrecy for an open formula or guarantee trading results. Do not assume unspecified future versions are included.

Checkout uses the selected, enabled payment network from the existing PULSE header. It shows the exact listing/version, package identity, creator recipient, network, token, amount and service description before signing. The service price goes directly to the quoted creator: **100% creator proceeds, 0% additional platform fee**. Network gas is separate. This is a direct payment on the reviewed chain, not a bridge or an automatic conversion.

| Indicator-service checkout | Chain ID | Settlement token |
|---|---:|---|
| X Layer | 196 | USDT0 |
| Base | 8453 | Native USDC |
| Arbitrum One | 42161 | Native USDC |

Routes are offered only when their network and payment configuration are enabled. Arc and Robinhood indicator-service checkout are not implemented; their other PULSE service payment paths are independent. A Terminal pass purchased on one supported network supplies owner-wide access, but an indicator quote remains bound to its own network/token and creator recipient. A quote for Base USDC cannot be paid or recovered using a different chain's transfer.

An active Terminal pass is required for managed Terminal installation. The indicator purchase does not buy or renew a pass; a pass does not silently purchase paid tools. There is no recurring indicator debit. The private purchase/sales view records entitlements and creator receipts by exact version.

The server snapshots terms in an expiring quote and binds payer/payee/asset/amount to the authorization. Repeated requests recover their original result. One payment authorization cannot serve a different quote. If settlement or response delivery is uncertain, **recover the original purchase before paying again**. Already entitled wallets restore installation rather than purchase twice.

## What Tapeout does

Numerical kernels carry actual combinational NAND netlists using TAP-02 signal numbering, least-significant-first bit packing and final-signal outputs. These numerical calculations execute through the gates. The v1 CVD kernel computes subtraction and signed accumulation; buyer participation computes multiplication and integer division; v2/v3 creator kernels compute their compiled per-bar expression. A v4 graph executes its numerical delta kernel only when an explicit `tap_delta` node is active. Pure OHLCV graphs use host calculations without claiming kernel execution. Rolling/EMA state, graph calculations, comparisons and visuals execute explicitly in the host and are not proved by a numerical-core registration.

Local packages retain an unregistered publication declaration. A catalog listing can separately attach a **verified X Layer registration record** containing its processor, circuit ID, verification block and optional transaction reference. The publisher-only registration endpoint independently checks deployed ports/netlist and numerical vectors through two RPC sources before returning registered status. A creator-provided address alone is not accepted as evidence.

For the trader, this means an inspectable, reusable numerical calculation instead of dependence on a screenshot or vendor-only expression. A compatible application can supply its own inputs and evaluate the same netlist, and a registered per-bar kernel also has a checkable on-chain executable identity. Neither ordinary preview nor installation requires manual circuit fields, transaction signing or deployment. Technical deployment controls remain optional developer tools.

Publishing to PULSE, local preview and X Layer circuit registration are separate steps. Radar's existing circuit does not register an indicator. A verified existing deployment can be attached only when it matches that package. Fabrication itself requires a real transaction and feasible circuit size/gas. The app must not claim success from a browser flag or a quote. Review the listing's actual deployment status; this document does not assert that every built-in or creator formula has been fabricated. Registration does not prove exchange-feed truth or establish hackathon acceptance.

### Registered numerical indicators

On 7 November 2026, these three actual numerical circuits were registered on X Layer mainnet (chain 196), under PULSE processor **`0x9e2849c04a513fe64db07521cbe52d078d905c0e`**. The registration verifier compared deployed netlists/ports and six numerical vectors per circuit through independent RPC sources. Status is pinned to the recorded verification blocks.

| Package | Circuit ID | Verification block | Registration transaction |
|---|---:|---:|---|
| `pulse.executed-cvd` | 1 | 75306038 | `0xb76e235f963aae58a87a986a05ce3235d1cb343477431c28ebe1109a5674b5b0` |
| `pulse.buy-participation` | 2 | 75306050 | `0x93ed43b65c7e35111da2d2ab291e907e74910405b36c8dd9ddb020a6c1b37287` |
| `pulse.weighted-flow` | 3 | 75306061 | `0x992e2490d42e45560e3205d640d2c41598fcf10dde5664910adde83beb1f3c8d` |

Processor creation, numerical parts and all three registrations cost **0.012230791172616297 OKB**, including transaction gas, within the approved 0.020 OKB cap. These records identify the deployed calculations. Browser previews and chart updates run locally without another registration transaction. A new creator formula requires its own matching deployment before it can carry registered status; publishing alone does not create one.

Sources: [TAP-02 netlist semantics](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md), [Fab X circuit calls and containers](https://fabx.tech/en/about).

## Source coverage and precision

- Inputs come from the exact selected execution source. Spot base-asset quantities and Futures contract quantities remain separate. Missing Futures data never falls back to Spot.
- v3 cumulative studies start at the source segment's beginning and reset after a gap. Legacy CVD starts at the selected source-window start. Uncollected intervals are excluded and explicitly marked partial. Lines break across known bucket gaps; missing executions are not reconstructed.
- A v3 full-window calculation cannot use a short clipped source bar as a complete observation. The point remains partial/unknown for transforms; the host must preserve its flag, reset and warm-up semantics. Plain per-bar values can be visible with a partial flag but must not confirm crossovers.
- Assessment display buckets are clipped to genuinely observed source-window edges without adding or removing executions. The numeric ABI uses uint16 buy/sell quantities and signed int32 prior input where required. Legacy kernels/v2 formulas use a shared source-window quantum; v3 uses each bar's maximum buy/sell quantity divided by 65,535 (or quantum 1 for zero volume), rounds those inputs, then decodes quantity output before host transforms. Integer division and input quantization introduce error. The legacy CVD error bound is not a universal bound for custom, smoothed or rolling studies. A legacy shared scale can leave tiny-volume buckets unresolved; division by a zero denominator remains unknown in every version.
- Sources and packages have bounded sizes, ordered timestamps and finite quantities. Up to 1,024 input buckets and eight installed packages are supported. A malformed or oversized input fails visibly.
- Imported files cannot execute JavaScript, fetch an external URL, invoke a wallet or change trading conditions. The app verifies built-in netlists and rebuilds admitted formula circuits to check their declared calculation, ports and prerequisites. v3 parsing also bounds transforms, periods and condition parameters. The independent host must implement the same causal recipe, gap resets and full-window warm-up; successful per-bar evaluation alone does not verify a full rolling study. It does not endorse a formula or creator.
- Installed files are browser-local; export them for recovery. The shared catalog stores up to 100 publications, 20 per publishing wallet, Catalog metadata has 365-day retention refreshed by catalog mutations; each package has 365-day retention from its latest publication. Republish an expired package from its original export. Retain exports for durable recovery.

## Integration

Browser-safe library exports from `@pulse/domain`:

```ts
const manifest = parseIndicatorPackage(json);
const result = evaluateIndicator(manifest, {
  instId: "BTC-USDT", timeframe: "1H", source: "your-executed-volume-feed",
  status: "available", knownAt, windowStart, windowEnd, units: "base",
  points: [{ ts, buy, sell }]
});
```

For v4 Studio packages, also supply actual completed price inputs when required: `price: {source,status,knownAt,windowStart,windowEnd,intervalMs,candles}`. Each candle carries `ts,end,open,high,low,close,volume`; declared missing intervals remain unknown. `result.outputs` lists each declared plot with its resolved timestamped values. Do not interpret its multiple price/RSI/condition outputs using the per-bar kernel's volume units.

The standalone files `/indicator-market/portable-host.html` and `/indicator-market/tap02-host.js` demonstrate an independent host. They can be served by another static application. Integrators remain responsible for truthful market inputs, source coverage and their host's security. Graph execution and numerical-kernel execution remain explicitly distinguished.

Wallet authentication and the Terminal feature gate apply. Publishing and managed-service purchase require an active Terminal pass. Private purchase/sales data stays scoped to the signed-in wallet:

| Route | Purpose |
|---|---|
| `GET /v1/terminal/indicators` | Small built-in/community catalog; no private workspace data |
| `GET /v1/terminal/indicators/:id` | Load a validated package and publishing identity |
| `POST /v1/terminal/indicators` | Publish `{manifest,offer?}`; offer uses `priceUsdc` and optional service description; identical versions are idempotent |
| `DELETE /v1/terminal/indicators/:id` | Publishing wallet removes its own catalog entry |
| `POST /v1/terminal/indicators/:id/registration` | Attach independently verified `{processor,circuitId,transactionHash?}` |
| `POST /v1/terminal/indicators/:id/quote` | Review a service quote with `{requestId,network}`; network is `xlayer`, `base` or `arbitrum` |
| `POST /:network/v1/terminal/indicators/purchases/:quoteId` | Settle on the quoted enabled network with `{requestId}` and x402 authorization |
| `POST /v1/terminal/indicators/purchases/:quoteId/recover` | Restore the original purchase using its transaction hash when needed |
| `GET /v1/terminal/indicators/purchases` | This wallet's private purchase and creator-sales records |

| Environment variable | Default | Purpose |
|---|---:|---|
| `FEATURE_TRADING_TERMINAL` | `0` | Enables Terminal and Indicator Market; use `1` for full tests |
| `INDICATOR_MARKET_MIN_PRICE_USDC` | `0.001` | Minimum paid creator-service price; choose a free listing for zero-cost installation |
| `INDICATOR_MARKET_MAX_PRICE_USDC` | `1000` | Maximum creator-service price; free listings remain available |
| `INDICATOR_MARKET_QUOTE_TTL_SECONDS` | `900` | Review-to-authorization quote lifetime |

The selected network's provider/payment configuration and durable storage are required for live creator checkout. An unconfigured route fails without requesting payment. The legacy `priceUsdc` field and `_PRICE_USDC` environment names carry the stablecoin-denominated listing price for compatibility; the reviewed quote identifies the actual settlement token and atomic amount. No fiat conversion or guaranteed stablecoin exchange rate is implied. Terminal pass prices remain in their own `PRICE_TERMINAL_PASS_*` variables. Browsing, importing or opening a listing never authorizes an automatic charge.

### Reproduce the funded acceptance test

The [7 November first-release acceptance record](INDICATOR_MARKET_VALIDATION_2026-11-07.md) predates custom formulas, paid creator service and verified indicator registration. It proves its recorded catalog, arithmetic, import/export and pass paths only. New acceptance evidence must distinguish live payments/deployments from test doubles and deployment-limited paths.

The [second-release record](INDICATOR_MARKET_V2_VALIDATION_2026-11-07.md) records three actual X Layer registrations and a real **0.001 USDC Base** creator-service purchase. Retrying recovered the same receipt without another charge; installation of the purchased custom version restored after delisting. The buyer used its real paid Terminal pass; the test creator used an explicit local QA access grant. The small amount is a test listing price, not the Terminal pass price. This funded run does **not** establish live payment acceptance on X Layer USDT0 or Arbitrum USDC; those routes have separate code-level validation and need their own funded acceptance evidence.

From the repository root, with the configured test wallet, durable storage and provider credentials:

```powershell
node --import tsx scripts/audit-terminal-indicator-market.ts --live --browser
```

This reuses an existing wallet-wide pass and refuses new payment authorization without `--spend`. Its Base pass ceiling is 1.50 USDC for 24 hours when access is absent; it is not blanket permission for creator purchases or X Layer fabrication. The separate `--commerce --browser --browser-commerce` path tests the actual creator checkout UI against its pinned QA listing and original receipt. With `--spend`, that path permits only its specifically bounded 0.001 USDC Base creator authorization when no original attempt exists. Its persisted marker prevents automatic repayment after an uncertain attempt; reconcile the original receipt first. Artifacts are under `.tmp/indicator-market-e2e/`, with proof encrypted rather than printed. The test browser has restricted ownership signing and narrowly validated typed-payment signing; it cannot send arbitrary wallet transactions. QA catalog publications are removed after testing. A prior successful payment is evidence for its recorded checkout, not automatic acceptance of later UI or language changes.

## Ask PULSE and models

Purple **✦ / Ask PULSE** buttons open an evidence-bound question. Indicator explanations use the selected execution-stream capture, with its original timestamps and setup binding. A model cannot change the circuit's results or the saved setup.

Ask PULSE uses `GROK_COPILOT_MODEL` when explicitly set; an empty/omitted value inherits `GROK_MODEL` (default `grok-4.7`). `GROK_REASONING_COPILOT` controls explanation effort (default low); `GROK_MAX_OUTPUT_COPILOT` controls its output limit. The service catalog and each newly saved answer record the selected/returned model. Explicit older overrides remain intentional operator settings. Restart/redeploy the service after changing its environment.

Grok 4.7 is documented for reasoning and knowledge work; model-provider benchmarks do not establish profitable trading performance. [Official model documentation](https://docs.x.ai/developers/models/grok-4.7).


## November 16 local workflow acceptance

See [the ten-issue record](TERMINAL_TEN_ISSUE_AUDIT_2026-11-16.md) for the current Studio/library/circuit-selection and resource-control checks. The offline replay uses committed public BTC inputs, local API state and TEST_WALLET_ADDRESS login. It generates no fresh paid report, uses no Railway/Redis and does not sign a payment. This is separate from the earlier funded acceptance records above.
