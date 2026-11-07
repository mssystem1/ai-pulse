# PULSE Indicator Market

The first release adds portable financial calculations to Trading Terminal. It includes a usable catalog, local installation, creator packages, publishing, unpublishing, file import/export and an independent static host. Existing navigation, report prices, setup strategies and pass prices are unchanged.

## Use it

1. Open Trading Terminal with an active pass and select the market and primary timeframe.
2. Leave **Market-tools execution window → Follow chart timeframe** selected, or deliberately choose a UTC session. This is the source window for installed indicators as well as the execution tools.
3. Open **Browse indicators**. Add **Cumulative executed delta** or **Buyer participation**. The installed pane names the instrument, Spot/Futures stream, source window and coverage.
4. Use **Export** to save its `.pulse-indicator.json` file. Another compatible host can import the same numerical circuit. No wallet credential, journal or market history is in that package.
5. Open **independent host**, import the file and enter numeric execution inputs. This separate HTML/ES-module application runs without PULSE's application bundle, API or wallet connection. It demonstrates portability, rather than claiming that unrelated third-party applications already support the format.

Example: with 120 units bought and 80 sold, delta is +40. A previous cumulative delta of +20 becomes +60. Buyer participation is 60%. These are executed-volume measurements, not forecasts or automatic entries.

## Create and share

**Create package** accepts an ID, creator display name, title, description, semantic version and one supported formula. Validate it, add it locally, export it, or explicitly choose **Publish to PULSE catalog**. Publishing reveals the package and the publishing wallet to other Terminal members. The wallet is authenticated independently of the unverified creator display name. `pulse.*` IDs are reserved for built-ins.

The first release supports two reviewed formula kernels, not arbitrary uploaded scripts. Different descriptions do not change their formulas. A changed formula requires a new supported kernel and tests. Versions published by the same wallet cannot silently change content. Unpublishing removes catalog discovery; recipients retain previously exported copies.

There is no separate indicator payment or creator payout in this release. Terminal access follows existing environment-configured passes. A future paid marketplace needs explicit pricing, creator terms, distribution and payment design; none is silently inferred here.

## What Tapeout does

Both kernels carry actual combinational NAND netlists using TAP-02 signal numbering, least-significant-first bit packing and final-signal outputs. The calculations execute through these gates; the circuit is not a decorative approval flag. CVD computes subtraction and signed accumulation. Buyer participation computes multiplication and integer division.

Packages currently declare `publication: {chainId:196, registered:false}`. The PULSE catalog is application-hosted. These numeric circuits have **not** been fabricated or registered on X Layer. There is no claim of an onchain registry, creator ownership enforcement or network-wide application compatibility. Existing Terminal Radar's deployed circuit integration is separate.

The next onchain milestone requires deploying/fabricating the actual numeric kernels, verifying deployed netlists and numeric outputs on X Layer, and adding explicit processor/circuit identities to a new validated publication format. That work must not be represented by changing `registered` to true locally.

Sources: [TAP-02 netlist semantics](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md), [Fab X circuit calls and containers](https://fabx.tech/en/about).

## Source coverage and precision

- Inputs come from the exact selected execution source. Spot base-asset quantities and Futures contract quantities remain separate. Missing Futures data never falls back to Spot.
- CVD resets at the selected source-window start. Uncollected intervals are excluded and explicitly marked partial. Lines break across known bucket gaps; the result is not reconstructed through missing executions.
- Assessment display buckets are clipped to their genuinely observed source-window edges without adding or removing executed quantities. The input ABI uses uint16 buy/sell quantities and, for CVD, signed int32 prior accumulation. The chart host applies a shared volume scale; its quantum and CVD absolute error bound appear under **Calculation & portability**. Buyer-share rounding can leave tiny-volume buckets unresolved.
- Sources and packages have bounded sizes, ordered timestamps and finite quantities. Up to 1,024 input buckets and eight installed packages are supported. A malformed or oversized input fails visibly.
- Imported files cannot execute JavaScript, fetch an external URL, invoke a wallet or change trading conditions. The app verifies the complete reviewed netlist, ports and prerequisites. The independent demonstration host bounds circuit structure but does not endorse a formula or creator.
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

All catalog routes require wallet authentication and an active Terminal pass:

| Route | Purpose |
|---|---|
| `GET /v1/terminal/indicators` | Small built-in/community catalog; no private workspace data |
| `GET /v1/terminal/indicators/:id` | Load a validated package and publishing identity |
| `POST /v1/terminal/indicators` | Explicitly publish `{manifest}`; identical versions are idempotent |
| `DELETE /v1/terminal/indicators/:id` | Publishing wallet removes its own catalog entry |

The existing `FEATURE_TRADING_TERMINAL` flag gates this feature. No additional pass or automatic payment is introduced.

### Reproduce the funded acceptance test

From the repository root, with the configured test wallet, durable storage and provider credentials:

```powershell
node --import tsx scripts/audit-terminal-indicator-market.ts --live --browser
```

This uses an existing wallet-wide pass and refuses to sign a new payment without `--spend`. To authorize the strictly capped 1.50 USDC Base 24-hour test purchase when access is absent, append `--spend`. Its persisted purchase marker prevents automatic repayment after an uncertain attempt; reconcile that original receipt before starting another purchase. Artifacts are written under `.tmp/indicator-market-e2e/`, with any payment proof encrypted rather than printed. The browser receives only a restricted ownership-message signer; it cannot send a transaction. QA catalog publications are removed after testing.

## Ask PULSE and models

Purple **✦ / Ask PULSE** buttons open an evidence-bound question. Indicator explanations use the selected execution-stream capture, with its original timestamps and setup binding. A model cannot change the circuit's results or the saved setup.

Ask PULSE uses `GROK_COPILOT_MODEL` when explicitly set; an empty/omitted value inherits `GROK_MODEL` (default `grok-4.7`). `GROK_REASONING_COPILOT` controls explanation effort (default low); `GROK_MAX_OUTPUT_COPILOT` controls its output limit. The service catalog and each newly saved answer record the selected/returned model. Explicit older overrides remain intentional operator settings. Restart/redeploy the service after changing its environment.

Grok 4.7 is documented for reasoning and knowledge work; model-provider benchmarks do not establish profitable trading performance. [Official model documentation](https://docs.x.ai/developers/models/grok-4.7).
