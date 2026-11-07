# PULSE Indicator Market

PULSE Indicator Market turns numerical calculations into versioned, portable trading tools. It has visible destinations in Trading Terminal: **Indicators Market** for discovery and installation and **Create indicator** for authoring. Installed tools appear alongside the price chart. The public landing has a dedicated **PULSE Indicator Market** section, and the app has illustrated [installation](https://app.ai-pulse.tech/docs#docs-indicator-market) and [creator](https://app.ai-pulse.tech/docs#docs-create-indicator) guides.

The PULSE header and top-level tabs remain intact. Trading Terminal stays immediately after Portfolio. Its seven-section workspace separates Trading Terminal, Market tools, Market Radar, Create indicator, Indicators Market, My opened positions and Alerts & Activity. One selected market and timeframe carry between sections. Terminal passes, Global reports and creator indicator services remain separate products.

## Use it

1. Open Trading Terminal with an active pass and select the market and primary timeframe. Open **Indicators Market**: `/trading-terminal?terminalSection=indicators`.
2. Leave **Market-tools execution window → Follow chart timeframe** selected, or deliberately choose a UTC session. This is the source window for installed indicators as well as the execution tools.
3. Review the formula, supported inputs, creator wallet, immutable version, price and deployment status. Use **Add to chart** for a free tool. A paid managed-service listing first requires its separate reviewed quote and explicit payment. The formula remains open.
4. Open **Trading Terminal** to compare the installed pane with price on the shared chart time axis. Quantity and percentage indicators keep their own scale. **Inspect execution window on chart** zooms to the retained input window; daily or weekly candles do not imply that an indicator has daily or weekly execution coverage. Hover or tap its pane to inspect values. The pane names the market, Spot/Futures stream, units, source window and coverage.
5. Use **Export** to save its `.pulse-indicator.json` file. Another compatible host can import the same numerical circuit. No wallet credential, journal or private market history is in that package.
6. Open **independent host**, import the file and enter numeric execution inputs. This separate HTML/ES-module application runs without PULSE's application bundle, API or wallet connection. It demonstrates portability, rather than claiming that unrelated third-party applications already support the format.

Example: with 120 units bought and 80 sold, delta is +40. A previous cumulative delta of +20 becomes +60. Buyer participation is 60%. These are executed-volume measurements, not forecasts or automatic entries.

## Create and share

Open **Create indicator**: `/trading-terminal?terminalSection=creator`. Enter the package ID, title, description, creator display name and semantic version, then choose a built-in formula or write a bounded expression. Validate numerical output, install it on your own chart and export/import the exact package before publishing. The publishing wallet is authenticated; the typed creator name is display information. `pulse.*` IDs are reserved for built-ins.

### Custom formula language

**`pulse-flow-expr-v1`** compiles creator expressions to TAP-02 NAND gates. It supports `buy`, `sell`, integer constants, parentheses, unary `+`/`-`, arithmetic `+ - * /`, and `abs`, `min`, `max`, `clamp`. Output is per bucket or cumulative, with an explicit volume, ratio, basis-points or scalar label. Buy and sell quantities share the host's declared scale.

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

Both kernels carry actual combinational NAND netlists using TAP-02 signal numbering, least-significant-first bit packing and final-signal outputs. The calculations execute through these gates; the circuit is not a decorative approval flag. CVD computes subtraction and signed accumulation. Buyer participation computes multiplication and integer division.

Local packages retain an unregistered publication declaration. A catalog listing can separately attach a **verified X Layer registration record** containing its processor, circuit ID, verification block and optional transaction reference. The publisher-only registration endpoint independently checks deployed ports/netlist and numerical vectors through two RPC sources before returning registered status. A creator-provided address alone is not accepted as evidence.

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
- CVD resets at the selected source-window start. Uncollected intervals are excluded and explicitly marked partial. Lines break across known bucket gaps; the result is not reconstructed through missing executions.
- Assessment display buckets are clipped to their genuinely observed source-window edges without adding or removing executed quantities. The input ABI uses uint16 buy/sell quantities and, for CVD, signed int32 prior accumulation. The chart host applies a shared volume scale; its quantum and CVD absolute error bound appear under **Calculation & portability**. Buyer-share rounding can leave tiny-volume buckets unresolved.
- Sources and packages have bounded sizes, ordered timestamps and finite quantities. Up to 1,024 input buckets and eight installed packages are supported. A malformed or oversized input fails visibly.
- Imported files cannot execute JavaScript, fetch an external URL, invoke a wallet or change trading conditions. The app verifies built-in netlists and rebuilds admitted formula circuits to check their declared calculation, ports and prerequisites. The independent demonstration host bounds circuit structure but does not endorse a formula or creator.
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

The standalone files `/indicator-market/portable-host.html` and `/indicator-market/tap02-host.js` demonstrate an independent numeric host. They can be served by another static application. Integrators remain responsible for truthful market inputs, source coverage and their host's security.

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

This uses an existing wallet-wide pass and refuses to sign a new payment without `--spend`. That flag permits the strictly capped 1.50 USDC Base 24-hour test pass when access is absent; it is not blanket authorization for creator purchases or X Layer fabrication. Its persisted marker prevents automatic repayment after an uncertain attempt; reconcile the original receipt first. Artifacts are written under `.tmp/indicator-market-e2e/`, with proof encrypted rather than printed. The browser uses only a restricted ownership-message signer; it cannot send a transaction. QA catalog publications are removed after testing.

## Ask PULSE and models

Purple **✦ / Ask PULSE** buttons open an evidence-bound question. Indicator explanations use the selected execution-stream capture, with its original timestamps and setup binding. A model cannot change the circuit's results or the saved setup.

Ask PULSE uses `GROK_COPILOT_MODEL` when explicitly set; an empty/omitted value inherits `GROK_MODEL` (default `grok-4.7`). `GROK_REASONING_COPILOT` controls explanation effort (default low); `GROK_MAX_OUTPUT_COPILOT` controls its output limit. The service catalog and each newly saved answer record the selected/returned model. Explicit older overrides remain intentional operator settings. Restart/redeploy the service after changing its environment.

Grok 4.7 is documented for reasoning and knowledge work; model-provider benchmarks do not establish profitable trading performance. [Official model documentation](https://docs.x.ai/developers/models/grok-4.7).
